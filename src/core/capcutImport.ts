import type { CapcutTimelineDraft, Clip, CropRect, Keyframe, MediaAsset, Project, ProjectTimeline, TrackKind } from "./types";
import { MAX_PROJECT_TIMELINES, MAX_TIMELINE_NAME, timelineContent, timelineLabel } from "./projectTimelines";
import { averageSpeed, validateSpeedCurve } from "./speedCurve";
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

export function importCapcutTimelines(drafts: CapcutTimelineDraft[], name: string, activeId?: string): CapcutImportResult {
  if (drafts.length < 1 || drafts.length > MAX_PROJECT_TIMELINES)
    throw new Error("Invalid number of CapCut timelines.");
  const project = createProject(name);
  const sharedMedia = new Map<string, MediaAsset>();
  const warnings = new Set<string>();
  const timelines: ProjectTimeline[] = drafts.map((draft, index) => {
    const converted = importCapcutDraft(draft.text, { name: draft.name });
    for (const warning of converted.warnings) warnings.add(warning);
    const references = new Map<string, string>();
    for (const asset of converted.project.assets) {
      const key = JSON.stringify([asset.kind, asset.path]);
      const shared = sharedMedia.get(key);
      if (shared) shared.duration = Math.max(shared.duration, asset.duration);
      else sharedMedia.set(key, asset);
      references.set(asset.id, shared?.id ?? asset.id);
    }
    const timeline = timelineContent(converted.project);
    return {
      ...timeline,
      id: draft.id, index,
      name: draft.name.trim().slice(0, MAX_TIMELINE_NAME) || `Timeline ${index + 1}`,
      clips: timeline.clips.map(clip => clip.assetId ? { ...clip, assetId: references.get(clip.assetId)! } : clip),
    };
  });
  const active = timelines.find(timeline => timeline.id === activeId) ?? timelines[0];
  return {
    project: validateProject({
      ...project, ...timelineContent(active),
      activeTimeline: timelineLabel(active),
      otherTimelines: timelines.filter(timeline => timeline !== active),
      assets: [...sharedMedia.values()],
    }),
    warnings: [...warnings],
  };
}

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
  const segments = new Map<Clip, { x: number; y: number; metadata: ObjectValue }>();
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
      let speed = number(
        speedMaterial?.data.speed,
        asset?.kind === "image" || !asset
          ? 1
          : seconds(source.duration) / duration || 1,
      );
      const curve = object(speedMaterial?.data.curve_speed);
      if (Object.keys(curve).length || array(speedMaterial?.data.curve_speed).length) {
        try {
          if (!asset || asset.kind === "image") throw new Error();
          const points = validateSpeedCurve(array(curve.speed_points).map(raw => {
            const point = object(raw);
            return { position: point.x, rate: point.y };
          }));
          const average = averageSpeed(points);
          if (seconds(source.duration) <= 0 || Math.abs(seconds(source.duration) - duration * average) > 0.08)
            throw new Error();
          clip.speedCurve = points;
          speed = average;
        } catch {
          warn("部分变速曲线无法验证源范围，已保留基础速度。");
        }
      }
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
        const text = parseText(material.data);
        if (text === undefined || text.text.length > 20000) {
          warn("无法解析文字内容的片段已跳过。");
          continue;
        }
        clip.text = { ...clip.text!, ...text };
        clip.name = text.text.slice(0, 30) || "文字";
        warn(
          "文字保留内容及支持的基础样式；字体、花字和富文本排版使用 ReaCut 样式。",
        );
      }
      if (segment.reverse === true) warn("倒放未支持，该片段按正向播放。");
      for (const ref of refs) {
        const extra = materialById.get(ref);
        if (extra && extra.category !== "speeds")
          unmappedSettings.add(settingNames[extra.category] ?? "其他附加效果");
      }
      if (asset && Object.keys(object(material.data.crop)).length) {
        const crop = parseCrop(object(material.data.crop));
        if (crop) clip.crop = crop;
        else warn("部分裁切无法转成矩形，相关片段使用完整素材画面。");
      }
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
      segments.set(clip, { x: number(position.x), y: number(position.y), metadata: segment });
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
  for (const [clip, position] of segments) {
    clip.transform.x = bounded((position.x * project.width) / 2, -1e9, 1e9, 0);
    clip.transform.y = bounded((-position.y * project.height) / 2, -1e9, 1e9, 0);
    clip.keyframes = importBasicKeyframes(position.metadata, clip, project, warn);
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

function parseText(material: ObjectValue): (Partial<NonNullable<Clip["text"]>> & { text: string }) | undefined {
  const { content } = material;
  if (typeof content !== "string") return undefined;
  let text = content, style: ObjectValue = {};
  if (content.trim().startsWith("{")) {
    try {
      const value = object(JSON.parse(content));
      if (typeof value.text !== "string") return undefined;
      text = value.text;
      const runs = array(value.styles);
      const run = object(runs[0]);
      const [start, end] = array(run.range);
      if (runs.length === 1 && (run.range === undefined || (start === 0 && end === text.length)))
        style = run;
    } catch { return undefined; }
  }
  const result: Partial<NonNullable<Clip["text"]>> & { text: string } = { text };
  const solid = object(object(object(style.fill).content).solid);
  const rgb = array(solid.color);
  if (rgb.length >= 3 && rgb.slice(0, 3).every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) {
    result.color = "#" + rgb.slice(0, 3).map(value => Math.round(Number(value) * 255).toString(16).padStart(2, "0")).join("");
  } else if (/^#[0-9a-f]{6}$/i.test(string(material.text_color))) result.color = string(material.text_color);
  if (typeof style.bold === "boolean") result.bold = style.bold;
  if (material.alignment === 0) result.align = "left";
  if (material.alignment === 1) result.align = "center";
  if (material.alignment === 2) result.align = "right";
  const size = number(style.size, number(material.font_size));
  if (size > 0) result.fontSize = Math.max(1, Math.min(1000, size * 72 / 15));
  return result;
}

function parseCrop(crop: ObjectValue): CropRect | undefined {
  const x = number(crop.upper_left_x, NaN), y = number(crop.upper_left_y, NaN);
  const right = number(crop.lower_right_x, NaN), bottom = number(crop.lower_right_y, NaN);
  if (![x, y, right, bottom].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
      right - x < 0.01 || bottom - y < 0.01) return;
  const corners = { upper_right_x: right, upper_right_y: y, lower_left_x: x, lower_left_y: bottom };
  if (Object.entries(corners).some(([name, expected]) =>
    crop[name] !== undefined && Math.abs(number(crop[name], Infinity) - expected) > 1e-6)) return;
  return { x, y, width: right - x, height: bottom - y };
}

const keyProperties: Record<string, Keyframe["property"]> = {
  KFTypePositionX: "x", KFTypePositionY: "y",
  KFTypeScaleX: "scale", UNIFORM_SCALE: "scale",
  KFTypeRotation: "rotation", KFTypeAlpha: "opacity", KFTypeVolume: "volume",
};

function importBasicKeyframes(segment: ObjectValue, clip: Clip, project: Project, warn: (message: string) => void): Keyframe[] {
  const converted = new Map<string, Keyframe>();
  let partial = Object.keys(object(segment.keyframes)).length > 0;
  for (const raw of array(segment.common_keyframes)) {
    const lane = object(raw);
    const type = string(lane.property_type);
    const property = Object.hasOwn(keyProperties, type) ? keyProperties[type] : undefined;
    if (!property) { partial = true; continue; }
    for (const entry of array(lane.keyframe_list)) {
      const key = object(entry), time = seconds(key.time_offset);
      let value = number(array(key.values)[0], NaN);
      if (typeof key.time_offset !== "number" || !Number.isFinite(key.time_offset) ||
          time < 0 || time > clip.duration || !Number.isFinite(value) || converted.size >= 400) {
        partial = true;
        continue;
      }
      if (property === "x") value *= project.width / 2;
      if (property === "y") value *= -project.height / 2;
      if (property === "scale") value = Math.max(0.000001, Math.min(10, value));
      if (property === "opacity" || property === "volume") value = Math.max(0, Math.min(property === "opacity" ? 1 : 4, value));
      if (Math.abs(value) > 1e9) { partial = true; continue; }
      if (key.curveType !== undefined && key.curveType !== "Line") partial = true;
      converted.set(`${property}:${time}`, { id: id(), time, property, value, easing: "linear" });
    }
  }
  if (partial) warn("部分关键帧或插值方式未映射；已转换的关键帧使用线性插值。");
  return [...converted.values()];
}
