import type { Clip, MediaAsset, Project, TrackKind } from "./types";
import {
  createProject,
  createTrack,
  createClip,
  id,
  validateProject,
} from "./model";

type ObjectValue = Record<string, unknown>;
export interface CapcutImportOptions {
  name?: string;
  mediaUrl?: (path: string) => string;
}
export interface CapcutImportResult {
  project: Project;
  warnings: string[];
}
const object = (v: unknown): ObjectValue =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as ObjectValue) : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const string = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const number = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const seconds = (v: unknown) => number(v) / 1_000_000;
const bounded = (v: unknown, low: number, high: number, fallback: number) =>
  Math.max(low, Math.min(high, number(v, fallback)));
const identityUrl = (path: string) => path;

/** Experimental, lossy conversion of decoded tracks/materials JSON.
 * Desktop envelope decoding is handled before this platform-neutral converter. */
export function importCapcutDraft(
  input: unknown,
  options: CapcutImportOptions = {},
): CapcutImportResult {
  if (typeof input === "string") {
    const source = input.trim().replace(/^\uFEFF/, "");
    if (!source.startsWith("{"))
      throw new Error(
        "剪映草稿是不透明载荷，请在桌面客户端中通过剪映草稿导入功能打开。",
      );
    try {
      input = JSON.parse(source);
    } catch {
      throw new Error("剪映草稿 JSON 无法解析");
    }
  }
  const draft = object(input);
  // Modern empty timelines omit tracks. Require the observed versioned draft
  // structure so arbitrary objects and malformed tracks still fail validation.
  const sparseEmpty =
    draft.tracks === undefined &&
    typeof draft.id === "string" && draft.id.length > 0 &&
    Number.isInteger(draft.version) && number(draft.version) > 0 &&
    typeof draft.new_version === "string" && draft.new_version.length > 0 &&
    (draft.duration === undefined || draft.duration === 0) &&
    Object.keys(object(draft.materials)).length === 0 &&
    number(object(draft.canvas_config).width) > 0 &&
    number(object(draft.canvas_config).height) > 0;
  const tracks = sparseEmpty ? [] : draft.tracks;
  if (
    !Array.isArray(tracks) ||
    !draft.materials ||
    typeof draft.materials !== "object" ||
    Array.isArray(draft.materials)
  )
    throw new Error("不是支持的剪映草稿：需要 tracks 和 materials，或有效的空白时间线结构。");
  if (tracks.length > 1000) throw new Error("草稿轨道数量超过导入限制");
  const warnings: string[] = [
    "实验性导入：仅转换基础时间线，部分效果和文字样式会丢失，请核对预览与导出。",
  ];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const project = createProject(
    options.name ?? string(draft.name, "剪映导入项目"),
  );
  // The controlled native export uses black when no canvas background is set.
  project.background = "#000000";
  const canvas = object(draft.canvas_config);
  const hasCanvasDimensions =
    number(canvas.width) > 0 && number(canvas.height) > 0;
  if (hasCanvasDimensions) {
    project.width = Math.round(bounded(canvas.width, 16, 7680, 1920));
    project.height = Math.round(bounded(canvas.height, 16, 7680, 1080));
  }
  const fps = number(draft.fps, 30);
  project.fps = [24, 25, 30, 50, 60].includes(fps) ? fps : 30;
  if (fps !== project.fps) warn(`帧率 ${fps} 不受支持，已改为 30 fps。`);
  project.tracks = [];
  project.assets = [];
  project.clips = [];
  const materials = object(draft.materials);
  const materialById = new Map<
    string,
    { category: string; data: ObjectValue }
  >();
  let materialCount = 0;
  for (const [category, items] of Object.entries(materials))
    for (const item of array(items)) {
      if (++materialCount > 100000) throw new Error("草稿素材数量超过导入限制");
      const data = object(item),
        materialId = string(data.id);
      if (materialId) materialById.set(materialId, { category, data });
    }
  const assets = new Map<string, MediaAsset>();
  const makeAsset = (
    materialId: string,
    category: string,
    data: ObjectValue,
  ): MediaAsset | undefined => {
    const known = assets.get(materialId);
    if (known) return known;
    const type = string(data.type);
    const kind =
      category === "audios"
        ? "audio"
        : ["photo", "image"].includes(type)
          ? "image"
          : type === "video" || type === ""
            ? "video"
            : undefined;
    if (!kind) {
      warn(`素材类型 ${type || category} 不受支持，相关片段已跳过。`);
      return undefined;
    }
    const path = string(data.path);
    if (
      path &&
      (!/^(\/|[a-zA-Z]:[\\/])/.test(path) ||
        path.includes("\0") ||
        path.length > 32768)
    ) {
      warn("素材路径不是支持的本机绝对路径，相关片段已跳过。");
      return undefined;
    }
    if (!path) {
      warn(
        `素材 ${string(data.material_name, materialId)} 没有本地路径，相关片段已跳过。`,
      );
      return undefined;
    }
    const asset: MediaAsset = {
      id: id(),
      kind,
      path,
      url: (options.mediaUrl ?? identityUrl)(path),
      name: string(
        data.material_name,
        string(data.name, path.split(/[\\/]/).pop() ?? "素材"),
      ),
      duration: bounded(seconds(data.duration), 0, 86400 * 8, 0),
      width: bounded(data.width, 0, 100000, 0),
      height: bounded(data.height, 0, 100000, 0),
      fps: bounded(data.fps, 0, 1000, project.fps),
      hasAudio: kind === "audio" || kind === "video",
      missing: false,
    };
    assets.set(materialId, asset);
    project.assets.push(asset);
    return asset;
  };
  let originalCanvas: { width: number; height: number } | undefined;
  const positions = new Map<Clip, { x: number; y: number }>();
  const inferredDurations = new Set<string>();
  const trackLayers = new Map<string, number>();
  const unmappedSettings = new Set<string>();
  const settingNames: Record<string, string> = {
    canvases: "画布背景", placeholder_infos: "占位设置",
    sound_channel_mappings: "声道设置", material_colors: "素材颜色",
    vocal_separations: "人声分离", material_animations: "片段动画",
    transitions: "转场", video_effects: "视频特效", audio_effects: "音频效果",
    audio_fades: "声音淡入淡出", masks: "蒙版",
  };
  let totalSegments = 0;
  for (const rawTrack of tracks) {
    const sourceTrack = object(rawTrack),
      kind = string(sourceTrack.type);
    if (!["video", "audio", "text"].includes(kind)) {
      warn(`轨道类型 ${kind || "未知"} 不受支持，已跳过。`);
      continue;
    }
    const track = createTrack(
      kind as TrackKind,
      string(
        sourceTrack.name,
        { video: "视频", audio: "音频", text: "文字" }[kind],
      ),
    );
    project.tracks.push(track);
    const layers = array(sourceTrack.segments)
      .map((item) => object(item).track_render_index)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const uniqueLayers = [...new Set(layers)];
    trackLayers.set(track.id, uniqueLayers[0] ?? project.tracks.length - 1);
    if (uniqueLayers.length > 1)
      warn("同轨片段的图层顺序不同，已按首个片段的轨道层级导入；请核对遮挡关系。");
    for (const rawSegment of array(sourceTrack.segments)) {
      if (++totalSegments > 10000) throw new Error("草稿片段数量超过导入限制");
      const segment = object(rawSegment),
        materialId = string(segment.material_id),
        material = materialById.get(materialId);
      if (!material) {
        warn(`片段引用的素材 ${materialId || "未知"} 不存在，已跳过。`);
        continue;
      }
      const target = object(segment.target_timerange),
        source = object(segment.source_timerange);
      const start = seconds(target.start),
        duration = seconds(target.duration),
        sourceIn = seconds(source.start);
      if (
        start < 0 ||
        duration <= 0 ||
        start + duration > 86400 ||
        sourceIn < 0 ||
        sourceIn > 86400 * 8
      ) {
        warn("存在无效时间范围的片段，已跳过。");
        continue;
      }
      let asset: MediaAsset | undefined;
      if (kind === "text") {
        if (
          material.category !== "texts" ||
          !["text", "subtitle", ""].includes(string(material.data.type))
        ) {
          warn("非基础文字素材已跳过。");
          continue;
        }
      } else {
        if (material.category !== (kind === "audio" ? "audios" : "videos")) {
          warn("素材类型与轨道不一致，已跳过相关片段。");
          continue;
        }
        asset = makeAsset(materialId, material.category, material.data);
        if (!asset) continue;
        if (asset.duration === 0 && asset.kind !== "image")
          inferredDurations.add(asset.id);
      }
      const clip = createClip(asset, track.id, start, project.fps);
      clip.start = start;
      clip.duration = duration;
      clip.sourceIn = sourceIn;
      const refs = array(segment.extra_material_refs).map((v) => string(v));
      const speedMaterial = refs
        .map((ref) => materialById.get(ref))
        .find((m) => m?.category === "speeds");
      const speed = number(
        speedMaterial?.data.speed,
        asset?.kind === "image" || !asset
          ? 1
          : seconds(source.duration) / duration || 1,
      );
      if (speed < 0.1 || speed > 8) {
        warn(`片段速度 ${speed} 超出 0.1–8 倍范围，已跳过。`);
        continue;
      }
      if (asset && asset.kind !== "image") {
        const extent = sourceIn + duration * speed;
        if (extent > 86400 * 8) {
          warn("源素材时间范围超出支持范围，相关片段已跳过。");
          continue;
        }
        if (inferredDurations.has(asset.id)) {
          asset.duration = Math.max(asset.duration, extent);
          warn(
            "部分素材缺少时长，已由基础片段推断；请重新链接素材确认真实时长。",
          );
        } else if (extent > asset.duration + 0.08) {
          warn("片段超出记录的源素材时长，已跳过。");
          continue;
        }
        if (
          seconds(source.duration) > 0 &&
          Math.abs(seconds(source.duration) - duration * speed) > 0.08
        )
          warn("源/目标时间范围与基础速度存在差异；曲线变速等可能未保留。");
      }
      clip.speed = speed;
      clip.volume = bounded(segment.volume, 0, 4, 1);
      if (clip.volume !== number(segment.volume, 1))
        warn("片段音量超出支持范围，已限制到 0–4 倍；请核对声音。");
      const transform = object(segment.clip),
        position = object(transform.transform),
        scale = object(transform.scale),
        flip = object(transform.flip);
      clip.transform.scale = bounded(scale.x, 0.05, 10, 1);
      clip.transform.rotation = bounded(transform.rotation, -1e9, 1e9, 0);
      clip.transform.opacity = bounded(transform.alpha, 0, 1, 1);
      if (clip.transform.scale !== number(scale.x, 1))
        warn("片段缩放超出支持范围，已限制到 0.05–10 倍。");
      if (clip.transform.opacity !== number(transform.alpha, 1))
        warn("片段透明度超出支持范围，已限制到 0–1。");
      clip.transform.flipX = flip.horizontal === true;
      clip.transform.flipY = flip.vertical === true;
      if (number(scale.y, number(scale.x, 1)) !== number(scale.x, 1))
        warn("非等比缩放导入为统一缩放，画面可能改变。");
      if (kind === "text") {
        const text = parseText(material.data.content);
        if (text === undefined || text.length > 20000) {
          warn("无法解析文字内容的片段已跳过。");
          continue;
        }
        clip.text!.text = text;
        clip.name = text.slice(0, 30) || "文字";
        warn(
          "文字内容已保留；剪映字体、花字、样式和排版未映射，使用 ReaCut 默认样式。",
        );
      }
      if (segment.reverse === true) warn("倒放未支持，该片段按正向播放。");
      if (
        array(segment.common_keyframes).length ||
        Object.keys(object(segment.keyframes)).length
      )
        warn("剪映关键帧未映射，保留片段的静态参数。");
      for (const ref of refs) {
        const extra = materialById.get(ref);
        if (extra && extra.category !== "speeds")
          unmappedSettings.add(settingNames[extra.category] ?? "其他附加效果");
        if (
          extra?.category === "speeds" &&
          array(extra.data.curve_speed).length
        )
          warn("曲线变速未支持，仅保留基础速度。");
      }
      if (Object.keys(object(material.data.crop)).length)
        warn("剪映裁切信息未映射，使用完整素材画面。");
      // Only accepted visual segments may establish an unspecified canvas.
      // Library-only materials and rejected clips must not affect its size.
      if (!hasCanvasDimensions && !originalCanvas && kind === "video" && asset) {
        const width = number(material.data.width),
          height = number(material.data.height);
        if (
          Number.isInteger(width) &&
          width > 0 &&
          width <= 100000 &&
          Number.isInteger(height) &&
          height > 0 &&
          height <= 100000
        )
          originalCanvas = { width, height };
      }
      positions.set(clip, { x: number(position.x), y: number(position.y) });
      project.clips.push(clip);
    }
  }
  if (!hasCanvasDimensions) {
    if (originalCanvas) {
      project.width = Math.round(bounded(originalCanvas.width, 16, 7680, 1920));
      project.height = Math.round(bounded(originalCanvas.height, 16, 7680, 1080));
      warn(
        `草稿没有有效画布尺寸，已由首个可导入视觉片段推断为 ${project.width} × ${project.height}；请核对画布比例。`,
      );
    } else {
      warn(
        "草稿没有有效画布尺寸，也没有可用于推断的视觉片段，已使用默认 1920 × 1080。请核对画布比例。",
      );
    }
  }
  for (const [clip, position] of positions) {
    clip.transform.x = bounded((position.x * project.width) / 2, -1e9, 1e9, 0);
    clip.transform.y = bounded((-position.y * project.height) / 2, -1e9, 1e9, 0);
  }
  // Native higher track_render_index is drawn above lower values. ReaCut's
  // first track is the top layer; source array order is the fallback.
  project.tracks.sort((a, b) => trackLayers.get(b.id)! - trackLayers.get(a.id)!);
  if (!project.tracks.length) project.tracks = [createTrack("video")];
  if (!project.clips.length) warn("没有可导入的基础片段。");
  if (unmappedSettings.size)
    warn(`未转换的附加设置：${[...unmappedSettings].join("、")}。请核对相关效果。`);
  const bg = object(canvas.background);
  if (Object.keys(bg).length)
    warn("剪映画布背景未映射，使用黑色背景。");
  return { project: validateProject(project), warnings };
}

function parseText(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  if (!content.trim().startsWith("{")) return content;
  try {
    const value = object(JSON.parse(content));
    return typeof value.text === "string" ? value.text : undefined;
  } catch {
    return undefined;
  }
}
