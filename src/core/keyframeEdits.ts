import type { Clip, Keyframe, Project } from "./types";
import {
  clone,
  evaluateKeyframes,
  id,
  snapToFrame,
  validateProject,
} from "./model";
import { EASINGS } from "./easing";
export const KEY_PROPERTIES = [
  "x",
  "y",
  "scale",
  "rotation",
  "opacity",
  "volume",
] as const;
export const KEY_LABELS: Record<Keyframe["property"], string> = {
  x: "位置 X",
  y: "位置 Y",
  scale: "缩放",
  rotation: "旋转",
  opacity: "透明度",
  volume: "音量",
};
export const EASING_LABELS: Record<Keyframe["easing"], string> = {
  linear: "线性",
  easeIn: "缓入",
  easeOut: "缓出",
  easeInOut: "缓入缓出",
};
export function keyLimits(property: Keyframe["property"]): [number, number] {
  return property === "scale"
    ? [0.000001, 10]
    : property === "opacity"
      ? [0, 1]
      : property === "volume"
        ? [0, 4]
        : [-1e9, 1e9];
}
function finish(p: Project, clip: Clip, keys: Keyframe[]): Keyframe[] {
  if (p.tracks.find((t) => t.id === clip.trackId)?.locked)
    throw new Error("请先解锁轨道");
  const result = validateProject({
    ...p,
    clips: p.clips.map((c) =>
      c.id === clip.id ? { ...c, keyframes: keys } : c,
    ),
  });
  return result.clips.find((c) => c.id === clip.id)!.keyframes;
}
export function putKey(
  p: Project,
  clip: Clip,
  property: Keyframe["property"],
  time: number,
): { keys: Keyframe[]; id: string } {
  const at = Math.min(clip.duration, Math.max(0, snapToFrame(time, p.fps)));
  const old = clip.keyframes.find(
    (k) => k.property === property && Math.abs(k.time - at) < 1e-8,
  );
  if (old) return { keys: clip.keyframes, id: old.id };
  const evaluated = evaluateKeyframes(clip, at);
  const key: Keyframe = {
    id: id(),
    time: at,
    property,
    value:
      property === "volume" ? evaluated.volume : evaluated.transform[property],
    easing: "linear",
  };
  return { keys: finish(p, clip, [...clip.keyframes, key]), id: key.id };
}
/** Moving points preserves their interval windows; explicitly changing easing resets the window. */
export function editKey(
  p: Project,
  clip: Clip,
  keyId: string,
  patch: Partial<Pick<Keyframe, "time" | "value" | "easing">>,
): Keyframe[] {
  const key = clip.keyframes.find((k) => k.id === keyId);
  if (!key) throw new Error("关键帧已不存在");
  if (
    (patch.time !== undefined && !Number.isFinite(patch.time)) ||
    (patch.value !== undefined && !Number.isFinite(patch.value))
  )
    throw new Error("请输入有限数值");
  const next = { ...key, ...patch };
  if (patch.time !== undefined)
    next.time = Math.min(
      clip.duration,
      Math.max(0, snapToFrame(patch.time, p.fps)),
    );
  if (patch.easing !== undefined) {
    if (!EASINGS.includes(patch.easing)) throw new Error("无效缓动");
    delete next.easingWindow;
  }
  if (
    clip.keyframes.some(
      (k) =>
        k.id !== key.id &&
        k.property === key.property &&
        Math.abs(k.time - next.time) < 1e-8,
    )
  )
    throw new Error("这个时间已有同属性关键帧");
  return finish(
    p,
    clip,
    clip.keyframes.map((k) => (k.id === key.id ? next : k)),
  );
}
export function deleteKeys(p: Project, clip: Clip, ids: string[]): Keyframe[] {
  return finish(
    p,
    clip,
    clip.keyframes.filter((k) => !ids.includes(k.id)),
  );
}
export interface KeyClipboard {
  keys: Keyframe[];
}
export function copyKeys(clip: Clip, ids: string[]): KeyClipboard {
  const keys = clip.keyframes.filter((k) => ids.includes(k.id));
  if (!keys.length) throw new Error("请先选择关键帧");
  const start = Math.min(...keys.map((k) => k.time));
  return { keys: keys.map((k) => ({ ...clone(k), time: k.time - start })) };
}
/** Paste relative to the playhead, replace collisions atomically, reject overflow. */
export function pasteKeys(
  p: Project,
  clip: Clip,
  clipboard: KeyClipboard,
  time: number,
): { keys: Keyframe[]; ids: string[] } {
  if (!clipboard.keys.length) throw new Error("关键帧剪贴板为空");
  if (
    p.assets.find((a) => a.id === clip.assetId)?.kind === "audio" &&
    clipboard.keys.some((k) => k.property !== "volume")
  )
    throw new Error("音频片段只能粘贴音量关键帧");
  const at = snapToFrame(time, p.fps);
  const inserted = clipboard.keys.map((k) => ({
    ...clone(k),
    id: id(),
    time: snapToFrame(at + k.time, p.fps),
  }));
  if (inserted.some((k) => k.time < 0 || k.time > clip.duration + 1e-8))
    throw new Error("粘贴范围超出片段，请移动播放头或选择更少的关键帧");
  // A lower target frame rate can collapse two copied keys into one tick.
  if (
    inserted.some((k, i) =>
      inserted
        .slice(i + 1)
        .some((v) => v.property === k.property && v.time === k.time),
    )
  )
    throw new Error("目标帧率下关键帧重叠，无法粘贴");
  const keys = [
    ...clip.keyframes.filter(
      (k) =>
        !inserted.some(
          (v) => v.property === k.property && Math.abs(v.time - k.time) < 1e-8,
        ),
    ),
    ...inserted,
  ];
  return { keys: finish(p, clip, keys), ids: inserted.map((k) => k.id) };
}
