import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
  access,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type {
  Clip,
  ExportOptions,
  ExportProgress,
  Keyframe,
  MediaAsset,
  Project,
  ShapeMask,
} from "../src/core/types";
import { fadeWindow } from "../src/core/model";
import { resolveExportRange } from "../src/core/exportRange";
import { colorAdjustmentFilters } from "../src/core/color";
import { applyShapeMask, getCropPixels } from "../src/core/visual";
import { findMediaTool } from "./media";

interface ExportJob {
  id: string;
  child?: ChildProcess;
  cancelled: boolean;
  committing: boolean;
  temporaryOutput: string;
  directory: string;
  finished: Promise<void>;
}
const jobs = new Map<string, ExportJob>();
let exportsShuttingDown = false;
const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${name} 必须是有限数值。`);
  return value;
};
const number = (value: number): string => Number(value.toFixed(6)).toString();
const color = (value: string): string => {
  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) return `0x${value.slice(1)}`;
  if (/^(black|white|red|green|blue|transparent)$/i.test(value))
    return value === "transparent" ? "black@0" : value;
  throw new Error(`不支持的颜色 ${value}，请使用 #RRGGBB 或 #RRGGBBAA。`);
};

/** Keyframe time is in clip-local timeline seconds, including after a speed change. */
export function keyframeExpression(
  clip: Clip,
  property: Keyframe["property"],
  fallback: number,
  clock = "t",
): string {
  const points = clip.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.time - b.time);
  if (!points.length) return number(fallback);
  const unique = points.filter(
    (p, i) => i === points.length - 1 || points[i + 1].time !== p.time,
  );
  let expression = number(unique[unique.length - 1].value);
  for (let i = unique.length - 2; i >= 0; i--) {
    const left = unique[i];
    const right = unique[i + 1];
    let progress = `((${clock}-${number(left.time)})/${number(right.time - left.time)})`;
    if (right.easing === "easeInOut") {
      const start = right.easingWindow?.start ?? 0;
      const end = right.easingWindow?.end ?? 1;
      const delta = end - start;
      // Cancel the common delta analytically to preserve tiny sliced windows near 0/1.
      const coefficients = [
        6 * start * (1 - start),
        3 * delta * (1 - 2 * start),
        -2 * delta * delta,
      ];
      const precision = (value: number) =>
        Number(value.toPrecision(15)).toString();
      progress = `(${progress}*(${precision(coefficients[0])}+${precision(coefficients[1])}*${progress}+${precision(coefficients[2])}*${progress}*${progress})/${precision(coefficients.reduce((sum, value) => sum + value, 0))})`;
    }
    const interpolation = `(${number(left.value)}+(${number(right.value - left.value)})*${progress})`;
    expression = `if(lt(${clock},${number(right.time)}),${interpolation},${expression})`;
  }
  return `if(lt(${clock},${number(unique[0].time)}),${number(unique[0].value)},${expression})`;
}

function tempoFilters(speed: number): string[] {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.000001)
    filters.push(`atempo=${number(remaining)}`);
  return filters;
}

function validate(project: Project, options: ExportOptions): number {
  if (!project.clips.length) throw new Error("时间线为空，请添加素材再导出。");
  if (!["mp4", "mov"].includes(options.format))
    throw new Error("导出格式必须为 MP4 或 MOV。");
  if (!["draft", "standard", "high"].includes(options.quality))
    throw new Error("未知导出质量。");
  for (const [value, name] of [
    [options.width, "宽度"],
    [options.height, "高度"],
  ] as const) {
    finite(value, name);
    if (value < 2 || value > 8192 || value % 2 || !Number.isInteger(value))
      throw new Error(`${name} 必须为 2–8192 范围内的偶数。`);
  }
  if (!Number.isFinite(options.fps) || options.fps < 1 || options.fps > 120)
    throw new Error("帧率必须为 1–120。");
  if (
    !Number.isFinite(project.width) ||
    !Number.isFinite(project.height) ||
    project.width <= 0 ||
    project.height <= 0
  )
    throw new Error("工程画布尺寸无效。");
  if (!path.isAbsolute(options.path))
    throw new Error("导出位置必须为绝对路径。");
  if (
    project.assets.some(
      (asset) => path.resolve(asset.path) === path.resolve(options.path),
    )
  )
    throw new Error("导出文件不能覆盖工程的源素材，请选择其他位置。");
  color(project.background);
  const range = resolveExportRange(project, options);
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const tracks = new Map(project.tracks.map((t) => [t.id, t]));
  for (const clip of project.clips) {
    if (!tracks.has(clip.trackId))
      throw new Error(`片段 ${clip.name} 的轨道不存在。`);
    for (const name of [
      "start",
      "duration",
      "sourceIn",
      "speed",
      "volume",
      "fadeIn",
      "fadeOut",
      "audioFadeIn",
      "audioFadeOut",
    ] as const)
      finite(clip[name], `${clip.name} ${name}`);
    if (
      clip.start < 0 ||
      clip.duration <= 0 ||
      clip.sourceIn < 0 ||
      clip.speed < 0.05 ||
      clip.speed > 32 ||
      clip.volume < 0 ||
      clip.volume > 4
    )
      throw new Error(`片段 ${clip.name} 的时间、速度或音量超出支持范围。`);
    for (const name of [
      "fadeIn",
      "fadeOut",
      "audioFadeIn",
      "audioFadeOut",
    ] as const)
      if (clip[name] < 0 || clip[name] > clip.duration)
        throw new Error(`片段 ${clip.name} 的淡入淡出时长超出片段。`);
    for (const [name, value] of Object.entries(clip.transform))
      if (typeof value === "number") finite(value, `${clip.name} ${name}`);
    if (
      clip.transform.scale <= 0 ||
      clip.transform.scale > 10 ||
      clip.transform.opacity < 0 ||
      clip.transform.opacity > 1
    )
      throw new Error(`片段 ${clip.name} 的缩放或透明度无效。`);
    for (const [name, value] of Object.entries(clip.adjustments))
      finite(value, `${clip.name} ${name}`);
    const a = clip.adjustments;
    if (
      a.brightness < -1 ||
      a.brightness > 1 ||
      a.contrast < 0 ||
      a.contrast > 3 ||
      a.saturation < 0 ||
      a.saturation > 3 ||
      Math.abs(a.temperature) > 1 ||
      a.blur < 0 ||
      a.blur > 100
    )
      throw new Error(`片段 ${clip.name} 的颜色调整超出支持范围。`);
    if (clip.crop) {
      const c = clip.crop;
      if (
        ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
        c.x < 0 ||
        c.y < 0 ||
        c.width <= 0 ||
        c.height <= 0 ||
        c.x + c.width > 1 + 1e-9 ||
        c.y + c.height > 1 + 1e-9
      )
        throw new Error("裁剪区域必须位于源画面内。");
    }
    if (clip.chromaKey) {
      const key = clip.chromaKey;
      if (
        typeof key.enabled !== "boolean" ||
        !/^#[\da-f]{6}$/i.test(key.color) ||
        !Number.isFinite(key.similarity) ||
        key.similarity < 0.01 ||
        key.similarity > 1 ||
        !Number.isFinite(key.blend) ||
        key.blend < 0 ||
        key.blend > 1
      )
        throw new Error("色度抠像参数无效。");
    }
    if (clip.mask) {
      const mask = clip.mask;
      if (
        !["rectangle", "ellipse"].includes(mask.shape) ||
        ![mask.width, mask.height, mask.feather].every(Number.isFinite) ||
        mask.width <= 0 ||
        mask.width > 1 ||
        mask.height <= 0 ||
        mask.height > 1 ||
        mask.feather < 0 ||
        mask.feather > 1 ||
        typeof mask.invert !== "boolean"
      )
        throw new Error("蒙版参数无效。");
    }
    if (clip.text) {
      if (
        !Number.isFinite(clip.text.fontSize) ||
        clip.text.fontSize < 1 ||
        clip.text.fontSize > 1000 ||
        clip.text.text.length > 20_000
      )
        throw new Error("文字字号或长度超出支持范围。");
      if (
        !Number.isFinite(clip.text.strokeWidth) ||
        clip.text.strokeWidth < 0 ||
        clip.text.strokeWidth > 100
      )
        throw new Error("文字描边宽度无效。");
      color(clip.text.color);
      color(clip.text.stroke);
      if (clip.text.background !== "transparent") color(clip.text.background);
    } else {
      const asset = assets.get(clip.assetId ?? "");
      if (!asset) throw new Error(`片段 ${clip.name} 找不到源素材。`);
      if (asset.missing && clip.start < range.end && clip.start + clip.duration > range.start) throw new Error(`素材丢失：${asset.name}`);
      if (
        asset.kind !== "image" &&
        clip.sourceIn + clip.duration * clip.speed > asset.duration + 0.08
      )
        throw new Error(`片段 ${clip.name} 超出源素材时长，请缩短片段。`);
    }
    if (clip.keyframes.length > 400)
      throw new Error(`片段 ${clip.name} 的关键帧超过 400 个。`);
    for (const key of clip.keyframes) {
      finite(key.time, "关键帧时间");
      finite(key.value, "关键帧数值");
      if (
        !["x", "y", "scale", "rotation", "opacity", "volume"].includes(
          key.property,
        ) ||
        !["linear", "easeInOut"].includes(key.easing)
      )
        throw new Error("未知关键帧属性或插值方式。");
      if (
        key.easingWindow &&
        (!Number.isFinite(key.easingWindow.start) ||
          !Number.isFinite(key.easingWindow.end) ||
          key.easingWindow.start < 0 ||
          key.easingWindow.end > 1 ||
          key.easingWindow.end <= key.easingWindow.start)
      )
        throw new Error("关键帧曲线窗口无效。");
      if (
        key.time < 0 ||
        key.time > clip.duration ||
        (key.property === "scale" && (key.value <= 0 || key.value > 10)) ||
        (key.property === "opacity" && (key.value < 0 || key.value > 1)) ||
        (key.property === "volume" && (key.value < 0 || key.value > 4))
      )
        throw new Error(`片段 ${clip.name} 的关键帧超出支持范围。`);
    }
    for (const window of [clip.videoFadeWindow, clip.audioFadeWindow])
      if (window) {
        if (
          ![
            window.offset,
            window.duration,
            window.fadeIn,
            window.fadeOut,
          ].every(Number.isFinite) ||
          Math.abs(window.offset) > 86400 ||
          window.duration <= 0 ||
          window.duration > 86400 ||
          window.fadeIn < 0 ||
          window.fadeOut < 0 ||
          window.fadeIn > window.duration ||
          window.fadeOut > window.duration
        )
          throw new Error(`片段 ${clip.name} 的淡入淡出窗口无效。`);
      }
  }
  const duration = Math.max(...project.clips.map((c) => c.start + c.duration));
  if (duration > 24 * 3600) throw new Error("单次导出最长支持 24 小时。");
  return duration;
}

async function renderText(
  clip: Clip,
  directory: string,
): Promise<{ file: string; width: number; height: number }> {
  const style = clip.text!;
  const family =
    style.fontFamily.replace(/["'\\;\n\r]/g, "").trim() || "sans-serif";
  const font = `${style.bold ? "bold " : ""}${style.fontSize}px "${family}", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Arial Unicode MS", sans-serif`;
  const measurement = createCanvas(1, 1).getContext("2d");
  measurement.font = font;
  measurement.fontVariationSettings = `"wght" ${style.bold ? 700 : 400}`;
  const lines = style.text.split("\n");
  const padding = Math.ceil(style.fontSize * 0.25 + style.strokeWidth);
  const width = Math.max(
    2,
    Math.ceil(
      Math.max(...lines.map((line) => measurement.measureText(line).width), 1),
    ) +
      padding * 2,
  );
  const lineHeight = style.fontSize * 1.3;
  const height = Math.max(
    2,
    Math.ceil(lineHeight * lines.length + padding * 2),
  );
  if (width > 8192 || height > 8192 || width * height > 32_000_000)
    throw new Error("文字图层过大，请减少字号或文字长度。");
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (style.background !== "transparent") {
    context.fillStyle = style.background;
    context.fillRect(0, 0, width, height);
  }
  context.font = font;
  context.textAlign = style.align;
  context.textBaseline = "middle";
  context.fillStyle = style.color;
  context.fontVariationSettings = `"wght" ${style.bold ? 700 : 400}`;
  context.strokeStyle = style.stroke;
  context.lineWidth = style.strokeWidth * 2;
  context.lineJoin = "round";
  const x =
    style.align === "left"
      ? padding
      : style.align === "right"
        ? width - padding
        : width / 2;
  lines.forEach((line, index) => {
    const y = padding + lineHeight * (index + 0.5);
    if (style.strokeWidth > 0) context.strokeText(line, x, y);
    context.fillText(line, x, y);
  });
  const file = path.join(
    directory,
    `${clip.id.replace(/[^\w-]/g, "")}-${randomUUID()}.png`,
  );
  await writeFile(file, canvas.toBuffer("image/png"));
  return { file, width, height };
}

async function renderMask(
  width: number,
  height: number,
  mask: ShapeMask,
  directory: string,
): Promise<string> {
  if (width * height > 64_000_000)
    throw new Error("蒙版素材尺寸过大，请使用较小的源素材。");
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(width, height);
  pixels.data.fill(255);
  applyShapeMask(pixels.data, width, height, mask);
  context.putImageData(pixels, 0, 0);
  const file = path.join(directory, `mask-${randomUUID()}.png`);
  await writeFile(file, canvas.toBuffer("image/png"));
  return file;
}

export async function createExportArguments(
  project: Project,
  options: ExportOptions,
  directory: string,
  output: string,
): Promise<string[]> {
  const duration = validate(project, options);
  const range = resolveExportRange(project, options);
  const args = [
    "-hide_banner",
    "-y",
    "-nostdin",
    "-filter_complex_threads",
    "1",
  ];
  const graph: string[] = [
    `color=c=${color(project.background)}:s=${options.width}x${options.height}:r=${number(options.fps)}:d=${number(duration)},format=rgba[base0]`,
  ];
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const rx = options.width / project.width;
  const ry = options.height / project.height;
  const audios: string[] = [];
  let input = 0;
  let layer = 0;
  // The first track is visually uppermost, just as it is in the editor track list.
  for (const track of [...project.tracks].reverse()) {
    for (const clip of project.clips
      .filter((c) => c.trackId === track.id)
      .sort((a, b) => a.start - b.start)) {
      if (clip.start >= range.end || clip.start + clip.duration <= range.start) continue;
      const asset: MediaAsset | undefined = assets.get(clip.assetId ?? "");
      const text = clip.text ? await renderText(clip, directory) : undefined;
      const visual = Boolean(
        text || asset?.kind === "image" || asset?.kind === "video",
      );
      const audible = !track.muted && !clip.muted && asset?.hasAudio;
      if ((!visual || track.hidden) && !audible) continue;
      const file = text?.file ?? asset!.path;
      await access(file);
      const still = Boolean(text || asset?.kind === "image");
      // Keep the frame immediately before a fractional trim point. Input -ss
      // still seeks to the preceding keyframe; the audio path continues to
      // trim precisely at time zero, while video can retain negative PTS.
      const keepSeekPredecessor =
        !still && asset?.kind === "video" && !track.hidden && clip.sourceIn > 0;
      // Seek before decoding so a late trim in a long recording does not decode its entire prefix.
      args.push(
        ...(still
          ? ["-loop", "1", "-framerate", number(options.fps)]
          : clip.sourceIn > 0
            ? [
                "-ss", number(clip.sourceIn),
                ...(keepSeekPredecessor ? ["-noaccurate_seek"] : []),
              ]
            : []),
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        file,
      );
      const index = input++;
      if (visual && !track.hidden) {
        const filters = [
          keepSeekPredecessor
            ? `trim=end=${number(clip.duration * clip.speed)}`
            : `trim=start=0:duration=${number(still ? clip.duration : clip.duration * clip.speed)}`,
          `setpts=${keepSeekPredecessor ? "PTS" : "(PTS-STARTPTS)"}/${still ? "1" : number(clip.speed)}`,
          // A frame becomes eligible only at its source PTS. Rounding its new
          // output tick up preserves the preceding frame between source PTSs,
          // matching browser seeking instead of selecting a future frame.
          `fps=${number(options.fps)}:round=up${keepSeekPredecessor ? ":start_time=0" : ""}`,
          "format=rgba",
        ];
        const sourceWidth = text?.width ?? asset!.width;
        const sourceHeight = text?.height ?? asset!.height;
        if (!sourceWidth || !sourceHeight)
          throw new Error(`无法确定素材 ${clip.name} 的尺寸。`);
        const crop = getCropPixels(
          { width: sourceWidth, height: sourceHeight },
          clip.crop,
        );
        const width = crop.width;
        const height = crop.height;
        let visualSource = `${index}:v:0`;
        if (clip.crop || clip.mask || clip.chromaKey?.enabled) {
          filters.push(`scale=${sourceWidth}:${sourceHeight}`, "setsar=1");
          if (clip.crop)
            filters.push(
              `crop=w=${width}:h=${height}:x=${crop.x}:y=${crop.y}:exact=1`,
            );
          graph.push(`[${visualSource}]${filters.join(",")}[original${layer}]`);
          filters.length = 0;
          visualSource = `original${layer}`;
        }
        if (clip.chromaKey?.enabled) {
          const key = clip.chromaKey;
          graph.push(
            `[${visualSource}]split=3[keyrgb${layer}][keyold${layer}][keysource${layer}]`,
          );
          graph.push(`[keyold${layer}]alphaextract[keyoldalpha${layer}]`);
          graph.push(
            `[keysource${layer}]colorkey=${color(key.color)}:${number(key.similarity)}:${number(key.blend)},alphaextract[keyalpha${layer}]`,
          );
          graph.push(
            `[keyoldalpha${layer}][keyalpha${layer}]blend=all_mode=multiply:shortest=1[keycombined${layer}]`,
          );
          graph.push(
            `[keyrgb${layer}][keycombined${layer}]alphamerge=shortest=1[keyed${layer}]`,
          );
          visualSource = `keyed${layer}`;
        }
        if (clip.mask) {
          const mask = await renderMask(width, height, clip.mask, directory);
          const maskInput = input++;
          args.push(
            "-loop",
            "1",
            "-framerate",
            number(options.fps),
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            mask,
          );
          graph.push(
            `[${maskInput}:v:0]trim=duration=${number(clip.duration)},setpts=PTS-STARTPTS,format=rgba,alphaextract[shapealpha${layer}]`,
          );
          graph.push(
            `[${visualSource}]split=2[maskrgb${layer}][maskold${layer}]`,
          );
          graph.push(`[maskold${layer}]alphaextract[maskoldalpha${layer}]`);
          graph.push(
            `[maskoldalpha${layer}][shapealpha${layer}]blend=all_mode=multiply:shortest=1[maskcombined${layer}]`,
          );
          graph.push(
            `[maskrgb${layer}][maskcombined${layer}]alphamerge=shortest=1[masked${layer}]`,
          );
          visualSource = `masked${layer}`;
        }
        const a = clip.adjustments;
        filters.push(...colorAdjustmentFilters(a));
        const contain = text
          ? rx
          : Math.min(options.width / width, options.height / height);
        const scale = keyframeExpression(clip, "scale", clip.transform.scale);
        const animatedScale = clip.keyframes.some((key) => key.property === "scale");
        // Keep dynamic scaling on a conversion path, including frames whose size
        // equals the input. FFmpeg 9 can fail when switching to its no-op path.
        // Planar/packed RGB conversion preserves colors and alpha.
        if (animatedScale) filters.push("format=gbrap");
        filters.push(
          `scale=w='max(2,trunc(${number(width * contain)}*(${scale})/2)*2)':h='max(2,trunc(${number(height * contain)}*(${scale})/2)*2)':eval=frame`,
          ...(animatedScale ? ["format=rgba"] : []),
          "setsar=1",
        );
        if (a.blur > 0)
          filters.push(
            "premultiply=inplace=1",
            `gblur=sigma=${number(a.blur * rx)}`,
            "unpremultiply=inplace=1",
          );
        if (clip.transform.flipX) filters.push("hflip");
        if (clip.transform.flipY) filters.push("vflip");
        const rotation = keyframeExpression(
          clip,
          "rotation",
          clip.transform.rotation,
        );
        if (rotation !== "0")
          filters.push(
            `rotate=angle='(${rotation})*PI/180':ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=black@0`,
          );
        const opacity = keyframeExpression(
          clip,
          "opacity",
          clip.transform.opacity,
          "T",
        );
        if (clip.keyframes.some((k) => k.property === "opacity")) {
          graph.push(
            `[${visualSource}]${filters.join(",")},split=2[opacityrgb${layer}][opacitysource${layer}]`,
          );
          filters.length = 0;
          graph.push(
            `[opacitysource${layer}]alphaextract,geq=lum='floor(lum(X,Y)*(${opacity})+0.5)'[opacityalpha${layer}]`,
          );
          graph.push(
            `[opacityrgb${layer}][opacityalpha${layer}]alphamerge=shortest=1[opaque${layer}]`,
          );
          visualSource = `opaque${layer}`;
        } else if (clip.transform.opacity !== 1)
          filters.push(
            `colorchannelmixer=aa=${number(clip.transform.opacity)}`,
          );
        const fade = fadeWindow(clip, "video");
        const fadeOffset =
          fade.fadeIn > 0 || fade.fadeOut > 0 ? Math.max(0, fade.offset) : 0;
        // FFmpeg's fade initialization is unstable with negative PTS; move delayed starts instead.
        const fadeDelay = Math.max(0, -fade.offset);
        if (fadeOffset > 0) filters.push(`setpts=PTS+${number(fadeOffset)}/TB`);
        if (fade.fadeIn > 0)
          filters.push(
            `fade=t=in:st=${number(fadeDelay)}:d=${number(fade.fadeIn)}:alpha=1`,
          );
        if (fade.fadeOut > 0)
          filters.push(
            `fade=t=out:st=${number(fade.duration - fade.fadeOut + fadeDelay)}:d=${number(fade.fadeOut)}:alpha=1`,
          );
        filters.push(`setpts=PTS+${number(clip.start - fadeOffset)}/TB`);
        graph.push(`[${visualSource}]${filters.join(",")}[layer${layer}]`);
        const x = keyframeExpression(
          clip,
          "x",
          clip.transform.x,
          `(t-${number(clip.start)})`,
        );
        const y = keyframeExpression(
          clip,
          "y",
          clip.transform.y,
          `(t-${number(clip.start)})`,
        );
        graph.push(
          `[base${layer}][layer${layer}]overlay=x='(W-w)/2+(${x})*${number(rx)}':y='(H-h)/2+(${y})*${number(ry)}':eval=frame:eof_action=pass:repeatlast=0:enable='gte(t,${number(clip.start)})*lt(t,${number(clip.start + clip.duration)})':format=auto[base${layer + 1}]`,
        );
        layer++;
      }
      if (audible) {
        const filters = [
          `atrim=start=0:duration=${number(clip.duration * clip.speed)}`,
          "asetpts=PTS-STARTPTS",
          ...tempoFilters(clip.speed),
          "aresample=48000",
          "aformat=sample_fmts=fltp:channel_layouts=stereo",
          `atrim=duration=${number(clip.duration)}`,
        ];
        const volume = keyframeExpression(clip, "volume", clip.volume);
        filters.push(`volume='${volume}':eval=frame`);
        const fade = fadeWindow(clip, "audio");
        const fadeOffset =
          fade.fadeIn > 0 || fade.fadeOut > 0 ? Math.max(0, fade.offset) : 0;
        const fadeDelay = Math.max(0, -fade.offset);
        if (fadeOffset > 0)
          filters.push(`asetpts=PTS+${number(fadeOffset)}/TB`);
        if (fade.fadeIn > 0)
          filters.push(
            `afade=t=in:st=${number(fadeDelay)}:d=${number(fade.fadeIn)}`,
          );
        if (fade.fadeOut > 0)
          filters.push(
            `afade=t=out:st=${number(fade.duration - fade.fadeOut + fadeDelay)}:d=${number(fade.fadeOut)}`,
          );
        if (fadeOffset > 0)
          filters.push(`asetpts=PTS-${number(fadeOffset)}/TB`);
        filters.push(`adelay=${Math.round(clip.start * 1000)}:all=1`);
        graph.push(`[${index}:a:0]${filters.join(",")}[audio${audios.length}]`);
        audios.push(`[audio${audios.length}]`);
      }
    }
  }
  graph.push(`[base${layer}]${options.range ? `trim=start=${number(range.start)}:end=${number(range.end)},setpts=PTS-STARTPTS,` : ""}format=yuv420p[vout]`);
  if (audios.length)
    graph.push(
      `${audios.join("")}amix=inputs=${audios.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${number(duration)},alimiter=limit=1:level=false${options.range ? `,atrim=start=${number(range.start)}:end=${number(range.end)},asetpts=PTS-STARTPTS` : ""}[aout]`,
    );
  args.push("-filter_complex", graph.join(";"), "-map", "[vout]");
  if (audios.length)
    args.push(
      "-map",
      "[aout]",
      "-c:a",
      "aac",
      "-b:a",
      options.quality === "draft" ? "128k" : "192k",
    );
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    options.quality === "draft"
      ? "ultrafast"
      : options.quality === "high"
        ? "slow"
        : "medium",
    "-crf",
    options.quality === "draft"
      ? "28"
      : options.quality === "high"
        ? "17"
        : "22",
    "-pix_fmt",
    "yuv420p",
    "-r",
    number(options.fps),
    "-t",
    number(range.duration),
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    "-f",
    options.format,
    output,
  );
  return args;
}

export async function startExport(
  project: Project,
  options: ExportOptions,
  onProgress: (progress: ExportProgress) => void,
): Promise<{ jobId: string }> {
  if (exportsShuttingDown) throw new Error("应用正在关闭。");
  validate(project, options);
  const duration = resolveExportRange(project, options).duration;
  const executable = await findMediaTool("ffmpeg");
  if (exportsShuttingDown) throw new Error("应用正在关闭。");
  const outputIdentity = await realpath(options.path).catch(() =>
    path.resolve(options.path),
  );
  const sourceIdentities = await Promise.all(
    project.assets.map((asset) =>
      realpath(asset.path).catch(() => path.resolve(asset.path)),
    ),
  );
  if (sourceIdentities.includes(outputIdentity))
    throw new Error("导出文件不能覆盖工程的源素材，请选择其他位置。");
  await mkdir(path.dirname(options.path), { recursive: true });
  if (exportsShuttingDown) throw new Error("应用正在关闭。");
  const jobId = randomUUID();
  const directory = await mkdtemp(path.join(tmpdir(), "reacut-export-"));
  if (exportsShuttingDown) {
    await rm(directory, { recursive: true, force: true });
    throw new Error("应用正在关闭。");
  }
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const job: ExportJob = {
    id: jobId,
    cancelled: false,
    committing: false,
    directory,
    temporaryOutput: path.join(
      path.dirname(options.path),
      `.reacut-${jobId}.${options.format}`,
    ),
    finished,
  };
  jobs.set(jobId, job);
  const emit = (
    status: ExportProgress["status"],
    progress: number,
    message?: string,
  ) => {
    try {
      onProgress({
        jobId,
        status,
        progress: Number.isFinite(progress)
          ? Math.max(0, Math.min(1, progress))
          : 0,
        message,
        ...(status === "complete" ? { path: options.path } : {}),
      });
    } catch {
      /* A disconnected renderer must not interrupt output cleanup. */
    }
  };
  emit("preparing", 0);
  void (async () => {
    try {
      const args = await createExportArguments(
        project,
        options,
        directory,
        job.temporaryOutput,
      );
      if (job.cancelled) {
        emit("cancelled", 0);
        return;
      }
      emit("rendering", 0);
      if (job.cancelled) {
        emit("cancelled", 0);
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, args, {
          shell: false,
          windowsHide: true,
        });
        job.child = child;
        let output = "";
        let diagnostic = "";
        child.stdout!.on("data", (data) => {
          output += String(data);
          const lines = output.split("\n");
          output = lines.pop() ?? "";
          for (const line of lines)
            if (line.startsWith("out_time_us="))
              emit(
                "rendering",
                Math.min(0.99, Number(line.slice(12)) / 1_000_000 / duration),
              );
        });
        child.stderr!.on("data", (data) => {
          diagnostic = (diagnostic + String(data)).slice(-12_000);
        });
        child.once("error", reject);
        child.once("close", (code) => {
          if (job.cancelled) resolve();
          else if (code === 0) resolve();
          else
            reject(new Error(`FFmpeg 导出失败：${diagnostic.trim() || code}`));
        });
      });
      if (job.cancelled) {
        emit("cancelled", 0);
        return;
      }
      // Once the atomic replacement starts, cancellation cannot safely undo it.
      job.committing = true;
      await rename(job.temporaryOutput, options.path);
      emit("complete", 1);
    } catch (error) {
      emit(
        job.cancelled ? "cancelled" : "error",
        0,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      await rm(job.temporaryOutput, { force: true }).catch(() => {});
      await rm(directory, { recursive: true, force: true }).catch(() => {});
      jobs.delete(jobId);
      finish();
    }
  })();
  return { jobId };
}

export async function cancelExport(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || job.committing) return;
  job.cancelled = true;
  if (job.child) {
    job.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (
        job.child &&
        job.child.exitCode === null &&
        job.child.signalCode === null
      )
        job.child.kill("SIGKILL");
    }, 2000);
    timer.unref();
  }
}

/** Main process calls this before app shutdown to stop owned FFmpeg children. */
export async function cancelAllExports(): Promise<void> {
  exportsShuttingDown = true;
  await Promise.all(
    [...jobs.values()].map(async (job) => {
      await cancelExport(job.id);
      await job.finished;
    }),
  );
}
