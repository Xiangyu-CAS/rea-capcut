import { EASINGS, easingProgress } from "./easing";
import type {
  Clip,
  MediaAsset,
  Project,
  TrackKind,
  Track,
  Keyframe,
  FadeWindow,
} from "./types";
import {
  DEFAULT_TRANSFORM,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_TEXT,
} from "./defaults";
export const id = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export const snapToFrame = (time: number, fps: number) =>
  Math.round(time * fps) / fps;
export const projectDuration = (project: Project): number =>
  project.clips.reduce(
    (end, clip) => Math.max(end, clip.start + clip.duration),
    0,
  );
export function createProject(name = "未命名项目"): Project {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: id(),
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#101015",
    assets: [],
    tracks: [
      createTrack("text", "文字"),
      createTrack("video", "视频 1"),
      createTrack("audio", "音频 1"),
    ],
    clips: [],
    createdAt: now,
    updatedAt: now,
  };
}
export function createTrack(kind: TrackKind, name?: string): Track {
  return {
    id: id(),
    kind,
    name:
      name ??
      { video: "视频", image: "画面", audio: "音频", text: "文字" }[kind],
    muted: false,
    hidden: false,
    locked: false,
  };
}
export function createClip(
  asset: MediaAsset | undefined,
  trackId: string,
  start: number,
  fps: number,
): Clip {
  return {
    id: id(),
    trackId,
    assetId: asset?.id,
    name: asset?.name ?? "默认文本",
    start: snapToFrame(Math.max(0, start), fps),
    duration:
      asset?.kind === "image" || !asset ? 5 : Math.max(1 / fps, asset.duration),
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    transform: { ...DEFAULT_TRANSFORM },
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    text: !asset ? { ...DEFAULT_TEXT } : undefined,
    fadeIn: 0,
    fadeOut: 0,
    audioFadeIn: 0,
    audioFadeOut: 0,
    keyframes: [],
  };
}
/** Fade time is in clip-local timeline seconds; cut windows preserve the original envelope. */
export function fadeWindow(clip: Clip, kind: "video" | "audio"): FadeWindow {
  return kind === "video"
    ? (clip.videoFadeWindow ?? {
        offset: 0,
        duration: clip.duration,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut,
      })
    : (clip.audioFadeWindow ?? {
        offset: 0,
        duration: clip.duration,
        fadeIn: clip.audioFadeIn,
        fadeOut: clip.audioFadeOut,
      });
}
export function evaluateFade(
  clip: Clip,
  time: number,
  kind: "video" | "audio",
): number {
  const window = fadeWindow(clip, kind),
    local = window.offset + time;
  const incoming =
    window.fadeIn > 0 ? Math.max(0, Math.min(1, local / window.fadeIn)) : 1;
  const outgoing =
    window.fadeOut > 0
      ? Math.max(0, Math.min(1, (window.duration - local) / window.fadeOut))
      : 1;
  return incoming * outgoing;
}
function preserveFades(original: Clip, next: Clip, offset: number): void {
  for (const kind of ["video", "audio"] as const) {
    const window = fadeWindow(original, kind);
    if (window.fadeIn > 0 || window.fadeOut > 0)
      next[kind === "video" ? "videoFadeWindow" : "audioFadeWindow"] = {
        ...window,
        offset: window.offset + offset,
      };
  }
}
export function splitClip(
  project: Project,
  clipId: string,
  time: number,
): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  if (
    !Number.isFinite(time) ||
    !clip ||
    project.tracks.find((t) => t.id === clip.trackId)?.locked
  )
    return project;
  const at = snapToFrame(time, project.fps),
    leftDuration = at - clip.start;
  if (
    leftDuration < 1 / project.fps - 1e-9 ||
    clip.duration - leftDuration < 1 / project.fps - 1e-9
  )
    return project;
  const right: Clip = {
    ...clone(clip),
    id: id(),
    start: at,
    duration: clip.duration - leftDuration,
    sourceIn: clip.sourceIn + leftDuration * clip.speed,
    fadeIn: 0,
    audioFadeIn: 0,
    keyframes: sliceKeyframes(clip, leftDuration, clip.duration),
  };
  const left = {
    ...clip,
    duration: leftDuration,
    fadeOut: 0,
    audioFadeOut: 0,
    keyframes: sliceKeyframes(clip, 0, leftDuration),
  };
  preserveFades(clip, left, 0);
  preserveFades(clip, right, leftDuration);
  for (const field of [
    "fadeIn",
    "fadeOut",
    "audioFadeIn",
    "audioFadeOut",
  ] as const) {
    left[field] = Math.min(left[field], left.duration);
    right[field] = Math.min(right[field], right.duration);
  }
  return {
    ...project,
    clips: project.clips.flatMap((c) =>
      c.id === clipId ? [left, right] : [c],
    ),
  };
}
export function trimClip(
  project: Project,
  clipId: string,
  edge: "start" | "end",
  time: number,
): Project {
  const original = project.clips.find((c) => c.id === clipId);
  if (
    !Number.isFinite(time) ||
    !original ||
    project.tracks.find((t) => t.id === original.trackId)?.locked
  )
    return project;
  const clip = clone(original),
    asset = project.assets.find((a) => a.id === clip.assetId);
  const min = 1 / project.fps,
    at = snapToFrame(time, project.fps);
  if (edge === "start") {
    const lower =
      asset && asset.kind !== "image"
        ? Math.max(0, clip.start - clip.sourceIn / clip.speed)
        : 0;
    const next = Math.max(
      lower,
      Math.min(at, clip.start + clip.duration - min),
    );
    const delta = next - clip.start;
    clip.sourceIn = Math.max(0, clip.sourceIn + delta * clip.speed);
    clip.duration -= delta;
    clip.start = next;
    clip.keyframes = sliceKeyframes(original, delta, original.duration);
  } else {
    const max =
      asset && asset.kind !== "image"
        ? clip.start + (asset.duration - clip.sourceIn) / clip.speed
        : Infinity;
    clip.duration = Math.max(min, Math.min(at, max) - clip.start);
    clip.keyframes = sliceKeyframes(original, 0, clip.duration);
  }
  preserveFades(original, clip, clip.start - original.start);
  for (const field of [
    "fadeIn",
    "fadeOut",
    "audioFadeIn",
    "audioFadeOut",
  ] as const)
    clip[field] = Math.min(clip[field], clip.duration);
  if (clip.start === original.start && clip.duration === original.duration)
    return project;
  return {
    ...project,
    clips: project.clips.map((c) => (c.id === clipId ? clip : c)),
  };
}
export function changeClipSpeed(
  project: Project,
  clipId: string,
  speed: number,
): Project {
  const clip = project.clips.find((c) => c.id === clipId);
  if (
    !clip ||
    project.tracks.find((t) => t.id === clip.trackId)?.locked ||
    !Number.isFinite(speed) ||
    speed < 0.1 ||
    speed > 8 ||
    speed === clip.speed
  )
    return project;
  const ratio = clip.speed / speed;
  const next = {
    ...clip,
    speed,
    duration: clip.duration * ratio,
    keyframes: clip.keyframes.map((k) => ({ ...k, time: k.time * ratio })),
    fadeIn: clip.fadeIn * ratio,
    fadeOut: clip.fadeOut * ratio,
    audioFadeIn: clip.audioFadeIn * ratio,
    audioFadeOut: clip.audioFadeOut * ratio,
  };
  for (const field of ["videoFadeWindow", "audioFadeWindow"] as const)
    if (clip[field]) {
      const w = clip[field]!;
      next[field] = {
        offset: w.offset * ratio,
        duration: w.duration * ratio,
        fadeIn: w.fadeIn * ratio,
        fadeOut: w.fadeOut * ratio,
      };
    }
  return {
    ...project,
    clips: project.clips.map((c) => (c.id === clipId ? next : c)),
  };
}

/** Each destination key owns the interpolation for the interval ending at it. */
function orderedKeys(clip: Clip, property: Keyframe["property"]): Keyframe[] {
  const keys = clip.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.time - b.time);
  return keys.filter(
    (k, i) => i === keys.length - 1 || keys[i + 1].time !== k.time,
  );
}
/** Remap an interval of a smoothstep curve without changing its values or shape. */
function sliceKeyframes(clip: Clip, from: number, to: number): Keyframe[] {
  const result: Keyframe[] = [];
  for (const property of [
    "x",
    "y",
    "scale",
    "rotation",
    "opacity",
    "volume",
  ] as const) {
    const keys = orderedKeys(clip, property);
    if (!keys.length) continue;
    const times = [
      ...new Set([
        from,
        ...keys.filter((k) => k.time > from && k.time < to).map((k) => k.time),
        to,
      ]),
    ].sort((a, b) => a - b);
    for (let i = 0; i < times.length; i++) {
      const at = times[i],
        evaluated = evaluateKeyframes(clip, at);
      const value =
        property === "volume"
          ? evaluated.volume
          : evaluated.transform[property];
      const key: Keyframe = {
        id: id(),
        time: at - from,
        property,
        value,
        easing: "linear",
      };
      if (i > 0) {
        const previous = times[i - 1],
          midpoint = (previous + at) / 2;
        const rightIndex = keys.findIndex((k) => k.time > midpoint);
        if (rightIndex > 0) {
          const left = keys[rightIndex - 1],
            right = keys[rightIndex];
          key.easing = right.easing;
          if (right.easing !== "linear") {
            const window = right.easingWindow ?? { start: 0, end: 1 },
              span = right.time - left.time;
            const start =
              window.start +
              ((window.end - window.start) * (previous - left.time)) / span;
            const end =
              window.start +
              ((window.end - window.start) * (at - left.time)) / span;
            if (start > 0 || end < 1)
              key.easingWindow = {
                start: Math.max(0, start),
                end: Math.min(1, end),
              };
          }
        }
      }
      result.push(key);
    }
  }
  return result;
}
export function evaluateKeyframes(clip: Clip, time: number): Clip {
  const result = { ...clip, transform: { ...clip.transform } };
  for (const property of [
    "x",
    "y",
    "scale",
    "rotation",
    "opacity",
    "volume",
  ] as const) {
    const keys = orderedKeys(clip, property);
    if (!keys.length) continue;
    let value = keys[0].value;
    if (time >= keys[keys.length - 1].time) value = keys[keys.length - 1].value;
    else
      for (let i = 0; i < keys.length - 1; i++)
        if (time >= keys[i].time && time <= keys[i + 1].time) {
          let ratio =
            (time - keys[i].time) / (keys[i + 1].time - keys[i].time || 1);
          ratio = easingProgress(keys[i + 1], ratio);
          value = keys[i].value + (keys[i + 1].value - keys[i].value) * ratio;
          break;
        }
    if (property === "volume") result.volume = value;
    else result.transform[property] = value;
  }
  return result;
}
export function formatTime(time: number, fps = 30) {
  const frames = Math.max(0, Math.round(time * fps));
  const f = frames % fps,
    seconds = Math.floor(frames / fps);
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
    f,
  ]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
/** Validate external project data without numeric coercion or defaulting missing fields. */
export function validateProject(input: unknown): Project {
  const fail = (name: string): never => {
    throw new Error(`项目 ${name} 无效`);
  };
  const object = (value: unknown, name: string): Record<string, unknown> => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      fail(name);
    return value as Record<string, unknown>;
  };
  const str = (
    value: unknown,
    name: string,
    max = 4096,
    empty = false,
  ): string => {
    if (
      typeof value !== "string" ||
      value.length > max ||
      (!empty && !value.length) ||
      value.includes("\0")
    )
      fail(name);
    return value as string;
  };
  const num = (
    value: unknown,
    name: string,
    low = -1e9,
    high = 1e9,
  ): number => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < low ||
      value > high
    )
      fail(name);
    return value as number;
  };
  const bool = (value: unknown, name: string): void => {
    if (typeof value !== "boolean") fail(name);
  };
  const list = (value: unknown, name: string, max: number): unknown[] => {
    if (!Array.isArray(value) || value.length > max) fail(name);
    return value as unknown[];
  };
  const choice = (
    value: unknown,
    choices: readonly string[],
    name: string,
  ): void => {
    if (typeof value !== "string" || !choices.includes(value)) fail(name);
  };
  const color = (value: unknown, name: string): void => {
    str(value, name, 32);
    if (
      !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value as string) &&
      !/^(black|white|red|green|blue|transparent)$/i.test(value as string)
    )
      fail(name);
  };
  const p = object(input, "内容");
  if (p.version !== 1) fail("版本（仅支持版本 1）");
  str(p.id, "ID", 256);
  str(p.name, "名称", 4096, true);
  for (const field of ["width", "height"] as const)
    if (!Number.isInteger(num(p[field], field, 16, 7680))) fail(field);
  if (![24, 25, 30, 50, 60].includes(num(p.fps, "帧率"))) fail("帧率");
  color(p.background, "背景颜色");
  for (const field of ["createdAt", "updatedAt"] as const)
    if (!Number.isFinite(Date.parse(str(p[field], field, 64)))) fail(field);
  const rawAssets = list(p.assets, "素材列表", 10000),
    rawTracks = list(p.tracks, "轨道列表", 1000),
    rawClips = list(p.clips, "片段列表", 10000);
  const ids = new Set<string>();
  const recordId = (item: Record<string, unknown>, label: string) => {
    const value = str(item.id, `${label} ID`, 256);
    if (ids.has(value)) fail("重复 ID");
    ids.add(value);
    return value;
  };
  const assets = new Map<string, Record<string, unknown>>(),
    tracks = new Map<string, Record<string, unknown>>();
  for (const raw of rawAssets) {
    const a = object(raw, "素材");
    assets.set(recordId(a, "素材"), a);
    str(a.name, "素材名称", 4096, true);
    str(a.path, "素材路径", 32768);
    str(a.url, "素材 URL", 32768);
    choice(a.kind, ["video", "audio", "image"], "素材类型");
    num(a.duration, "素材时长", 0, 86400 * 8);
    for (const field of ["width", "height"] as const)
      num(a[field], `素材 ${field}`, 0, 100000);
    num(a.fps, "素材帧率", 0, 1000);
    bool(a.hasAudio, "素材音频标记");
    if (a.missing !== undefined) bool(a.missing, "素材丢失标记");
    if (a.thumbnail !== undefined) str(a.thumbnail, "素材缩略图", 32768);
    if (a.previewUrl !== undefined) str(a.previewUrl, "素材预览 URL", 32768);
    if (a.previewError !== undefined)
      str(a.previewError, "素材预览错误", 4096, true);
    if (a.waveform !== undefined)
      for (const v of list(a.waveform, "音频波形", 100000))
        num(v, "音频波形值", 0, 1);
  }
  for (const raw of rawTracks) {
    const t = object(raw, "轨道");
    tracks.set(recordId(t, "轨道"), t);
    str(t.name, "轨道名称", 4096, true);
    choice(t.kind, ["video", "audio", "image", "text"], "轨道类型");
    for (const field of ["muted", "hidden", "locked"] as const)
      bool(t[field], `轨道 ${field}`);
  }
  for (const raw of rawClips) {
    const c = object(raw, "片段");
    recordId(c, "片段");
    str(c.name, "片段名称", 4096, true);
    if (c.linkId !== undefined) str(c.linkId, "画声关联 ID", 256);
    const track = tracks.get(str(c.trackId, "片段轨道 ID", 256));
    if (!track) fail("片段轨道引用");
    const asset =
      c.assetId === undefined
        ? undefined
        : assets.get(str(c.assetId, "片段素材 ID", 256));
    if (c.assetId !== undefined && !asset) fail("片段素材引用");
    const start = num(c.start, "片段起点", 0, 86400),
      duration = num(c.duration, "片段时长", Number.MIN_VALUE, 86400),
      sourceIn = num(c.sourceIn, "源素材起点", 0, 86400 * 8),
      speed = num(c.speed, "速度", 0.1, 8);
    if (start + duration > 86400) fail("时间线时长（最长 24 小时）");
    num(c.volume, "音量", 0, 4);
    bool(c.muted, "片段静音");
    for (const field of [
      "fadeIn",
      "fadeOut",
      "audioFadeIn",
      "audioFadeOut",
    ] as const)
      num(c[field], field, 0, duration);
    for (const field of ["videoFadeWindow", "audioFadeWindow"] as const)
      if (c[field] !== undefined) {
        const w = object(c[field], field);
        num(w.offset, `${field} 偏移`, -86400 * 80, 86400 * 80);
        const full = num(
          w.duration,
          `${field} 原始时长`,
          Number.MIN_VALUE,
          86400 * 80,
        );
        num(w.fadeIn, `${field} 淡入`, 0, full);
        num(w.fadeOut, `${field} 淡出`, 0, full);
      }
    const transform = object(c.transform, "变换");
    for (const field of ["x", "y", "rotation"] as const)
      num(transform[field], field);
    num(transform.scale, "缩放", 0.000001, 10);
    num(transform.opacity, "透明度", 0, 1);
    bool(transform.flipX, "水平翻转");
    bool(transform.flipY, "垂直翻转");
    if (c.crop !== undefined) {
      const crop = object(c.crop, "裁剪");
      const x = num(crop.x, "裁剪 X", 0, 1),
        y = num(crop.y, "裁剪 Y", 0, 1),
        width = num(crop.width, "裁剪宽度", 0.01, 1),
        height = num(crop.height, "裁剪高度", 0.01, 1);
      if (x + width > 1 + 1e-9 || y + height > 1 + 1e-9) fail("裁剪超出素材");
    }
    if (c.chromaKey !== undefined) {
      const chroma = object(c.chromaKey, "色度抠像");
      bool(chroma.enabled, "色度抠像开关");
      str(chroma.color, "抠像颜色", 9);
      if (!/^#[\da-f]{6}$/i.test(chroma.color as string)) fail("抠像颜色");
      num(chroma.similarity, "抠像相似度", 0.01, 1);
      num(chroma.blend, "抠像过渡", 0, 1);
    }
    if (c.mask !== undefined) {
      const mask = object(c.mask, "形状蒙版");
      choice(mask.shape, ["rectangle", "ellipse"], "蒙版形状");
      num(mask.width, "蒙版宽度", 0.01, 1);
      num(mask.height, "蒙版高度", 0.01, 1);
      num(mask.feather, "蒙版羽化", 0, 0.5);
      bool(mask.invert, "蒙版反转");
    }
    const adjustments = object(c.adjustments, "颜色调整");
    num(adjustments.brightness, "亮度", -1, 1);
    num(adjustments.contrast, "对比度", 0, 3);
    num(adjustments.saturation, "饱和度", 0, 3);
    num(adjustments.temperature, "色温", -1, 1);
    num(adjustments.blur, "模糊", 0, 100);
    if (c.text !== undefined) {
      if (asset || track!.kind !== "text") fail("文字片段引用");
      const text = object(c.text, "文字样式");
      str(text.text, "文字内容", 20000, true);
      num(text.fontSize, "字号", 1, 1000);
      str(text.fontFamily, "字体", 256);
      color(text.color, "文字颜色");
      color(text.background, "文字背景");
      color(text.stroke, "文字描边");
      num(text.strokeWidth, "描边宽度", 0, 100);
      choice(text.align, ["left", "center", "right"], "文字对齐");
      bool(text.bold, "粗体");
    } else {
      if (
        !asset ||
        track!.kind === "text" ||
        !(
          track!.kind === asset.kind ||
          (track!.kind === "video" && asset.kind === "image")
        )
      )
        fail("片段轨道与素材类型");
      if (
        asset!.kind !== "image" &&
        sourceIn + duration * speed > (asset!.duration as number) + 0.08
      )
        fail("片段超出源素材时长");
    }
    const keyIds = new Set<string>();
    for (const rawKey of list(c.keyframes, "关键帧列表", 400)) {
      const k = object(rawKey, "关键帧"),
        keyId = str(k.id, "关键帧 ID", 256);
      if (keyIds.has(keyId)) fail("重复关键帧 ID");
      keyIds.add(keyId);
      if (k.easingWindow !== undefined) {
        const w = object(k.easingWindow, "关键帧插值窗口");
        num(w.start, "插值窗口起点", 0, 1);
        num(w.end, "插值窗口终点", 0, 1);
        if (
          (w.start as number) >= (w.end as number) ||
          k.easing === "linear"
        )
          fail("关键帧插值窗口");
      }
      num(k.time, "关键帧时间", 0, duration);
      choice(
        k.property,
        ["x", "y", "scale", "rotation", "opacity", "volume"],
        "关键帧属性",
      );
      choice(k.easing, [...EASINGS], "关键帧插值");
      const low =
        k.property === "scale"
          ? 0.000001
          : ["opacity", "volume"].includes(k.property as string)
            ? 0
            : -1e9;
      const high =
        k.property === "scale"
          ? 10
          : k.property === "opacity"
            ? 1
            : k.property === "volume"
              ? 4
              : 1e9;
      num(k.value, "关键帧值", low, high);
    }
  }
  // Return a detached value so a caller cannot mutate an already validated project through its input.
  return structuredClone(input) as Project;
}
