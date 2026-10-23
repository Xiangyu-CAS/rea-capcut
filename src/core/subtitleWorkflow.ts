import { clone, id, snapToFrame, splitClip } from "./model";
import type { Clip, Keyframe, Project, TextStyle } from "./types";

export const TEXT_MOTIONS = ["none", "fade", "slide-up", "zoom"] as const;
export type TextMotion = (typeof TEXT_MOTIONS)[number];
export interface SubtitleAnimation {
  entrance: TextMotion;
  exit: TextMotion;
  inDuration: number;
  outDuration: number;
  distance: number;
  hold?: "still" | "pulse";
  pulseAmount?: number;
}
export type SubtitleStyleValues = Pick<
  TextStyle,
  | "fontSize"
  | "color"
  | "background"
  | "bold"
  | "align"
  | "stroke"
  | "strokeWidth"
>;
export const SUBTITLE_STYLE_FIELDS = [
  "fontSize",
  "color",
  "background",
  "bold",
  "align",
  "stroke",
  "strokeWidth",
] as const;

/** Bake editable ordinary keys; preview, export, trim and persistence need no new renderer. */
export function subtitleAnimation(
  clip: Clip,
  options: SubtitleAnimation,
  fps: number,
): Clip {
  if (
    !TEXT_MOTIONS.includes(options.entrance) ||
    !TEXT_MOTIONS.includes(options.exit)
  )
    throw new Error("不支持的文字动画");
  for (const value of [options.inDuration, options.outDuration])
    if (!Number.isFinite(value) || value < 0 || value > 60)
      throw new Error("入场/出场时长须为 0～60 秒");
  if (
    !Number.isFinite(options.distance) ||
    options.distance < 0 ||
    options.distance > 10000
  )
    throw new Error("滑动距离须为 0～10000 像素");
  const hold = options.hold ?? "still",
    pulseAmount = options.pulseAmount ?? 0.08;
  if (
    !["still", "pulse"].includes(hold) ||
    !Number.isFinite(pulseAmount) ||
    pulseAmount < 0 ||
    pulseAmount > 0.5
  )
    throw new Error("停留动画或呼吸幅度无效（0～50%）");
  const enter =
    options.entrance === "none" ? 0 : snapToFrame(options.inDuration, fps);
  const exit =
    options.exit === "none" ? 0 : snapToFrame(options.outDuration, fps);
  if (
    (options.entrance !== "none" && enter < 1 / fps - 1e-9) ||
    (options.exit !== "none" && exit < 1 / fps - 1e-9)
  )
    throw new Error("启用的动画至少需要一帧");
  if ((enter || exit) && enter + exit > clip.duration - 1 / fps + 1e-9)
    throw new Error(
      `字幕“${clip.text?.text.slice(0, 20)}”太短：入场和出场后须留至少一帧停留，未修改任何字幕`,
    );
  const holdEnd = clip.duration - exit,
    midpoint = snapToFrame((enter + holdEnd) / 2, fps);
  if (
    hold === "pulse" &&
    (holdEnd - enter < 2 / fps - 1e-9 ||
      midpoint <= enter ||
      midpoint >= holdEnd)
  )
    throw new Error("呼吸动画至少需要两帧停留，未修改任何字幕");
  const result = clone(clip);
  result.fadeIn = result.fadeOut = 0;
  delete result.videoFadeWindow;
  result.keyframes = result.keyframes.filter(
    (k) => !["y", "scale", "opacity"].includes(k.property),
  );
  if (
    options.entrance === "none" &&
    options.exit === "none" &&
    hold === "still"
  )
    return result;
  for (const property of ["y", "scale", "opacity"] as const) {
    const base = clip.transform[property];
    const endpoint = (motion: TextMotion, incoming: boolean) =>
      property === "opacity"
        ? motion === "none"
          ? base
          : 0
        : property === "scale"
          ? base * (motion === "zoom" ? 0.8 : 1)
          : base +
            (motion === "slide-up"
              ? (incoming ? 1 : -1) * options.distance
              : 0);
    const points: [number, number, Keyframe["easing"]][] = [
      [0, endpoint(options.entrance, true), "linear"],
    ];
    if (enter) points.push([enter, base, "easeOut"]);
    const pulse = hold === "pulse" && property === "scale";
    if (pulse) points.push([midpoint, base * (1 + pulseAmount), "easeInOut"]);
    if (exit) points.push([holdEnd, base, pulse ? "easeInOut" : "linear"]);
    points.push([
      clip.duration,
      endpoint(options.exit, false),
      pulse && !exit ? "easeInOut" : "easeIn",
    ]);
    result.keyframes.push(
      ...points.map(([time, value, easing]) => ({
        id: id(),
        time,
        value,
        easing,
        property,
      })),
    );
  }
  return result;
}

export function splitSubtitle(
  project: Project,
  clip: Clip,
  at: number,
  offset: number,
): Project {
  if (clip.linkId) throw new Error("请先解除关联再拆分字幕");
  if (!Number.isFinite(at)) throw new Error("播放头时间无效");
  const time = snapToFrame(at, project.fps);
  if (
    time - clip.start < 1 / project.fps - 1e-9 ||
    clip.start + clip.duration - time < 1 / project.fps - 1e-9
  )
    throw new Error("播放头须在字幕内部，两侧至少一帧");
  const content = clip.text!.text;
  const boundaries = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      content,
    ),
  ].map((s) => s.index);
  if (
    !Number.isInteger(offset) ||
    offset <= 0 ||
    offset >= content.length ||
    !boundaries.includes(offset) ||
    !content.slice(0, offset).trim() ||
    !content.slice(offset).trim()
  )
    throw new Error("请把文本光标放在文案中间，勿拆开组合字符或表情");
  const result = splitClip(project, clip.id, time),
    originalIds = new Set(project.clips.map((c) => c.id));
  const left = result.clips.find((c) => c.id === clip.id)!,
    right = result.clips.find((c) => !originalIds.has(c.id));
  if (!right) throw new Error("无法拆分此字幕");
  for (const [c, value] of [
    [left, content.slice(0, offset)],
    [right, content.slice(offset)],
  ] as const) {
    c.text = { ...c.text!, text: value };
    c.name = value.slice(0, 4096);
  }
  return result;
}

/** Consecutive list entries merge across gaps/overlaps; the first cue owns appearance. */
export function mergeSubtitles(project: Project, clips: Clip[]): Project {
  if (clips.length < 2) throw new Error("请选择至少两条相邻字幕");
  if (clips.some((c) => c.linkId)) throw new Error("请先解除关联再合并字幕");
  const ordered = project.clips
    .filter((c) => c.trackId === clips[0].trackId && c.text)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const ids = new Set(clips.map((c) => c.id)),
    selected = ordered.filter((c) => ids.has(c.id));
  const index = ordered.indexOf(selected[0]);
  if (
    !ordered.slice(index, index + selected.length).every((c) => ids.has(c.id))
  )
    throw new Error("所选字幕必须在当前轨道列表中连续，不能跨过未选字幕");
  const first = selected[0],
    content = selected.map((c) => c.text!.text).join("\n");
  if (content.length > 20000) throw new Error("合并后超过 20000 字");
  const end = Math.max(...selected.map((c) => c.start + c.duration)),
    duration = end - first.start,
    ratio = duration / first.duration;
  const merged = clone(first);
  merged.duration = duration;
  merged.text!.text = content;
  merged.name = content.slice(0, 4096);
  merged.keyframes = merged.keyframes.map((k) => ({
    ...k,
    time: k.time * ratio,
  }));
  for (const field of [
    "fadeIn",
    "fadeOut",
    "audioFadeIn",
    "audioFadeOut",
  ] as const)
    merged[field] *= ratio;
  for (const field of ["videoFadeWindow", "audioFadeWindow"] as const)
    if (merged[field]) {
      const w = merged[field]!;
      for (const k of ["duration", "offset", "fadeIn", "fadeOut"] as const)
        w[k] *= ratio;
    }
  return {
    ...project,
    clips: project.clips.flatMap((c) =>
      c.id === first.id ? [merged] : ids.has(c.id) ? [] : [c],
    ),
  };
}
