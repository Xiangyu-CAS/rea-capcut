import type { Clip, Project, Track } from "./types";
import { MAX_ASSISTANT_MEDIA, type AssistantMediaSelection, type AssistantMode, type AssistantTranscription } from "./assistantTypes";
import { clone, createClip, createTrack, projectDuration, snapToFrame, validateProject } from "./model";
import { applySpeech, speechSource, type SpeechRecognitionRequest } from "./speech";

import { linkedIds, moveLinked, speedLinked, splitLinked, trimLinked } from "./timelineEdits";

const adviceOnly = [
  /(?:只|仅)(?:需|要)?(?:给|提供)?我?(?:一些|几条)?(?:(?:修改|剪辑)?建议|意见|反馈|分析)/,
  /\b(?:advice|suggestions|feedback) only\b/i,
  /\b(?:only|just) (?:suggest|recommend|explain|(?:give|offer|provide|share)(?: me)? (?:some )?(?:advice|suggestions|feedback))\b/i,
];
const previewFirst = [
  /(?:先|只|仅)(?:给我|让我)?预览|(?:给我|让我)预览|(?:等待?|待)(?:我|用户)?确认/,
  /\b(?:preview (?:first|only)|(?:first|only|just) preview|(?:show|give) me (?:a|the) preview)\b/i,
  /\b(?:wait for (?:my|user) (?:confirmation|approval)|before (?:applying|you apply))\b/i,
];
const noEdits = [
  /(?:不要|暂不|别|请勿)(?:直接|实际)?(?:剪辑?|动手|编辑|应用|入轨|(?:修改|改动|改)(?:项目|时间线)?)(?=\s*(?:[，。！？、,.!?；;]|$))/,
  /\b(?:don't|do not|without) (?:edit(?:ing)?|apply(?:ing)?)(?: (?:anything|it|the (?:edit|changes|project|timeline)))?(?: yet)?(?=\s*(?:[,.!?;]|$))/i,
  /\b(?:don't|do not|without) mak(?:e|ing) (?:any )?changes(?: to (?:the )?(?:project|timeline))?(?: yet)?(?=\s*(?:[,.!?;]|$))/i,
];

// Wording in the current message can narrow the composer's mode, never grant edits.
export function assistantRequestMode(mode: AssistantMode, prompt: string): AssistantMode {
  if (mode === "answer") return mode;
  const text = prompt.normalize("NFKC").replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"\n]*"/g, " ").replaceAll("’", "'");
  if (adviceOnly.some(pattern => pattern.test(text))) return "answer";
  if (previewFirst.some(pattern => pattern.test(text))) return "preview";
  return noEdits.some(pattern => pattern.test(text)) ? "answer" : mode;
}

const fields: Record<string, string[]> = {
  addText: ["text", "start", "duration", "fontSize", "color", "x", "y"],
  addCaptions: ["transcriptionId", "translations"],
  addAsset: ["assetId", "start", "trackId", "sourceIn", "duration"],
  trimClip: ["clipId", "edge", "time"], splitClip: ["clipId", "time"],
  deleteClip: ["clipId"], moveClip: ["clipId", "start", "trackId"],
  setSpeed: ["clipId", "speed"], setVolume: ["clipId", "volume", "muted"],
  setText: ["clipId", "text"], setTransform: ["clipId", "x", "y", "scale", "rotation", "opacity"],
  setFades: ["clipId", "fadeIn", "fadeOut", "audioFadeIn", "audioFadeOut"],
  setProject: ["name", "width", "height", "fps", "background"],
};
const labels: Record<string, string> = {
  addText: "添加文字", addCaptions: "添加字幕", addAsset: "添加素材片段", trimClip: "裁剪片段", splitClip: "分割片段",
  deleteClip: "删除片段", moveClip: "移动片段", setSpeed: "调整速度", setVolume: "调整音量",
  setText: "修改文字", setTransform: "调整画面", setFades: "调整淡入淡出", setProject: "调整项目",
};
const englishLabels: Record<string, string> = {
  addText: "Add text", addCaptions: "Add subtitles", addAsset: "Add media clip", trimClip: "Trim clip", splitClip: "Split clip",
  deleteClip: "Delete clip", moveClip: "Move clip", setSpeed: "Change speed", setVolume: "Change volume",
  setText: "Edit text", setTransform: "Adjust picture", setFades: "Adjust fades", setProject: "Change project",
};
function number(value: unknown, name: string, min = 0, max = 86400): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} 超出支持范围`);
  return value;
}
function text(value: unknown, name: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new Error(`${name} 无效`);
  return value;
}
function color(value: unknown): string {
  const result = text(value, "颜色", 9);
  if (!/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(result)) throw new Error("颜色必须使用十六进制格式");
  return result;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("编辑建议格式无效");
  return value as Record<string, unknown>;
}
export interface AssistantEditPreview {
  project: Project;
  descriptions: string[];
  before: { clips: number; duration: number };
  after: { clips: number; duration: number };
}

/** Validate every operation on a clone. No partial edits, disk writes or arbitrary code. */
export function previewAssistantEdits(input: Project, actions: unknown, language: "zh-CN" | "en" = "zh-CN", transcriptions: readonly AssistantTranscription[] = []): AssistantEditPreview {
  if (!Array.isArray(actions) || !actions.length || actions.length > 40)
    throw new Error("每次编辑建议须包含 1–40 项修改");
  let project = validateProject(clone(input));
  const availableTranscriptions = new Map(transcriptions.map(result => [result.id, result]));
  const descriptions: string[] = [];
  const word = (zh: string, en: string) => language === "zh-CN" ? zh : en;
  const trackLabel = (name: string) => word(`轨道“${name}”`, `Track “${name}”`);
  const compatible = (track: Track, clip: Clip) => clip.text ? track.kind === "text" :
    project.assets.some(asset => asset.id === clip.assetId &&
      (track.kind === asset.kind || (track.kind === "video" && asset.kind === "image")));
  const requireClip = (value: unknown): Clip => {
    const clip = project.clips.find(c => c.id === text(value, "片段 ID", 256));
    if (!clip) throw new Error("建议引用的片段不存在，请重新生成");
    if (project.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error(`“${clip.name}”所在轨道已锁定`);
    return clip;
  };
  // Materialize captions after media edits so the saved timing maps to the final clip placement.
  const ordered = actions.map(record).sort((a, b) => Number(a.type === "addCaptions") - Number(b.type === "addCaptions"));
  for (const action of ordered) {
    const type = text(action.type, "操作", 40);
    if (!Object.hasOwn(fields, type) || Object.keys(action).some(key => key !== "type" && !fields[type].includes(key)))
      throw new Error("助手提出了不支持的操作或字段");
    let target = "", detail = "";
    if (type === "addText") {
      const content = text(action.text, "文字内容");
      let track = project.tracks.find(t => t.kind === "text" && !t.locked);
      if (!track) { track = createTrack("text", word("助手文字", "Agent text")); project.tracks.unshift(track); }
      const clip = createClip(undefined, track.id, number(action.start, "起点"), project.fps);
      clip.duration = Math.max(1 / project.fps, snapToFrame(number(action.duration, "时长", 1 / project.fps), project.fps));
      clip.name = content.slice(0, 80); clip.text!.text = content;
      if (action.fontSize !== undefined) clip.text!.fontSize = number(action.fontSize, "字号", 8, 500);
      if (action.color !== undefined) clip.text!.color = color(action.color);
      for (const key of ["x", "y"] as const)
        if (action[key] !== undefined) clip.transform[key] = number(action[key], "位置", -10000, 10000);
      project.clips.push(clip); target = content.length > 180 ? content.slice(0, 180) + "…" : content;
      detail = `${clip.start.toFixed(2)}s · ${clip.duration.toFixed(2)}s · ${word("字号", "Font size")} ${clip.text!.fontSize} · ${clip.text!.color} · ${word("位置", "Position")} (${clip.transform.x}, ${clip.transform.y})`;
    } else if (type === "addCaptions") {
      const transcriptionId = text(action.transcriptionId, "字幕转录 ID", 100);
      const transcription = availableTranscriptions.get(transcriptionId);
      if (!transcription) throw new Error(word("字幕转录已失效，请重新识别。", "The transcription is unavailable. Recognize the source again."));
      availableTranscriptions.delete(transcriptionId);
      const { request, time } = transcription;
      const before = speechSource(input, request.source, request.range);
      const source = speechSource(project, request.source, request.range);
      if (source.asset.id !== before.asset.id || source.sourceIn !== before.sourceIn || Math.abs(source.duration - before.duration) > 1e-6)
        throw new Error(word("源素材选段已变化，请重新识别。", "The source range changed. Recognize it again."));
      let cues = transcription.cues;
      if (action.translations !== undefined) {
        const translations = action.translations;
        if (!Array.isArray(translations) || translations.length !== cues.length)
          throw new Error(word("译文需要与识别出的字幕逐条对应。", "Provide one translation for each recognized caption, in order."));
        cues = cues.map((cue, index) => ({ ...cue, text: text(translations[index], word("字幕译文", "Caption translation"), 10000) }));
      }
      project = applySpeech(project, request, { mode: "asr", cues }, time, {
        captions: word("字幕", "Subtitles"), voice: "",
      }).project;
      target = source.asset.name;
      detail = word(`${cues.length} 条字幕`, `${cues.length} subtitles`);
    } else if (type === "addAsset") {
      const asset = project.assets.find(a => a.id === text(action.assetId, "素材 ID", 256));
      if (!asset || asset.missing) throw new Error("建议引用的素材不存在或已丢失");
      let track = action.trackId === undefined
        ? project.tracks.find(t => !t.locked && (t.kind === asset.kind || (t.kind === "video" && asset.kind === "image")))
        : project.tracks.find(t => t.id === text(action.trackId, "轨道 ID", 256));
      if (action.trackId !== undefined && !track) throw new Error("目标轨道不存在");
      if (!track) { track = createTrack(asset.kind); project.tracks.push(track); }
      const clip = createClip(asset, track.id, number(action.start, "起点"), project.fps);
      if (track.locked || !compatible(track, clip)) throw new Error("目标轨道已锁定或类型不兼容");
      if (action.sourceIn !== undefined) {
        clip.sourceIn = number(action.sourceIn, "源素材入点");
        if (asset.kind === "image" && clip.sourceIn !== 0) throw new Error("图片的源素材入点须为零");
        if (clip.sourceIn > 0 && action.duration === undefined) clip.duration = asset.duration - clip.sourceIn;
      }
      if (action.duration !== undefined) clip.duration = number(action.duration, "时长", 1 / project.fps);
      if (asset.kind !== "image" && (action.duration !== undefined || clip.sourceIn > 0) &&
          (clip.duration < 1 / project.fps - 1e-6 || clip.sourceIn + clip.duration > asset.duration + 1e-6))
        throw new Error("片段时长超出素材范围");
      project.clips.push(clip); target = asset.name;
      detail = `${clip.start.toFixed(2)}s · ${clip.duration.toFixed(2)}s · ${trackLabel(track.name)}`;
      if (clip.sourceIn > 0) detail += ` · ${word("源素材入点", "Source in")} ${clip.sourceIn.toFixed(2)}s`;
    } else if (type === "setProject") {
      if (Object.keys(action).length < 2) throw new Error("项目修改为空");
      if (action.name !== undefined) project.name = text(action.name, "项目名称", 200);
      for (const key of ["width", "height"] as const) if (action[key] !== undefined) {
        const value = number(action[key], "画布尺寸", 16, 7680);
        if (!Number.isInteger(value)) throw new Error("画布尺寸必须为整数"); project[key] = value;
      }
      if (action.fps !== undefined) {
        const fps = number(action.fps, "帧率", 24, 60);
        if (![24, 25, 30, 50, 60].includes(fps)) throw new Error("不支持该帧率"); project.fps = fps;
      }
      if (action.background !== undefined) project.background = color(action.background);
      target = project.name;
      detail = [
        action.name !== undefined ? word(`名称“${project.name}”`, `Name “${project.name}”`) : "",
        action.width !== undefined || action.height !== undefined ? `${word("画布", "Canvas")} ${project.width}×${project.height}` : "",
        action.fps !== undefined ? `${project.fps}fps` : "",
        action.background !== undefined ? `${word("背景", "Background")} ${project.background}` : "",
      ].filter(Boolean).join(" · ");
    } else {
      const clip = requireClip(action.clipId); target = clip.name;
      const temporal = ['moveClip','trimClip','splitClip','setSpeed','deleteClip'].includes(type);
      const members = linkedIds(project, [clip.id]);
      if (temporal && project.clips.some(c => members.includes(c.id) && project.tracks.find(t => t.id === c.trackId)?.locked))
        throw new Error('关联片段所在轨道已锁定');
      if (temporal && clip.linkId) target += word("（含关联画声）", " (with linked audio or video)");
      switch (type) {
        case "deleteClip": project.clips = project.clips.filter(c => !members.includes(c.id)); break;
        case "splitClip": {
          const at = snapToFrame(number(action.time, "分割时间"), project.fps);
          if (at < clip.start + 1 / project.fps - 1e-6 || at > clip.start + clip.duration - 1 / project.fps + 1e-6)
            throw new Error("分割点须位于片段内部");
          const next = splitLinked(project, [clip.id], at);
          if (next === project) throw new Error("分割点未形成有效片段，请重新选择片段内部的帧边界");
          project = next; detail = `${at.toFixed(2)}s`; break;
        }
        case "trimClip": {
          if (action.edge !== "start" && action.edge !== "end") throw new Error("裁剪边缘无效");
          const at = number(action.time, "裁剪时间");
          // A natural-language cut is deliberately bounded to the existing clip.
          if (at < clip.start || at > clip.start + clip.duration ||
            (action.edge === "start" ? clip.start + clip.duration - at : at - clip.start) < 1 / project.fps - 1e-6)
            throw new Error("裁剪时间须位于当前片段范围内");
          project = trimLinked(project, clip.id, action.edge, at); detail = `${action.edge === "start" ? word("起点", "Start") : word("终点", "End")} ${at.toFixed(2)}s`; break;
        }
        case "moveClip": {
          const at = snapToFrame(number(action.start, "起点"), project.fps);
          if (action.trackId !== undefined) {
            const track = project.tracks.find(t => t.id === text(action.trackId, "轨道 ID", 256));
            if (!track || track.locked || !compatible(track, clip)) throw new Error("目标轨道不可用或类型不兼容");
          }
          project = moveLinked(project, [clip.id], at - clip.start, action.trackId as string | undefined);
          detail = `${at.toFixed(2)}s${action.trackId !== undefined ? ` · ${trackLabel(project.tracks.find(t => t.id === action.trackId)!.name)}` : ""}`; break;
        }
        case "setSpeed": project = speedLinked(project, clip.id, number(action.speed, "速度", .1, 8)); detail = `${action.speed}×`; break;
        case "setVolume":
          if (clip.keyframes.some(key => key.property === "volume"))
            throw new Error("该片段已有音量关键帧，请先在属性面板调整或移除对应关键帧，再生成音量建议");
          clip.volume = number(action.volume, "音量", 0, 4);
          if (action.muted !== undefined) {
            if (typeof action.muted !== "boolean") throw new Error("静音参数无效"); clip.muted = action.muted;
          }
          detail = `${Math.round(clip.volume * 100)}%${action.muted === undefined ? "" : ` · ${clip.muted ? word("静音", "Muted") : word("取消静音", "Unmuted")}`}`; break;
        case "setText": if (!clip.text) throw new Error("该片段不是文字"); clip.text.text = text(action.text, "文字内容"); detail = clip.text.text.length > 180 ? clip.text.text.slice(0, 180) + "…" : clip.text.text; break;
        case "setTransform": {
          if (Object.keys(action).length < 3) throw new Error("画面修改为空");
          if (clip.keyframes.some(key => action[key.property] !== undefined))
            throw new Error("所修改的画面属性已有关键帧，请先在属性面板调整或移除对应关键帧，再生成建议");
          for (const key of ["x", "y", "scale", "rotation", "opacity"] as const) if (action[key] !== undefined)
            clip.transform[key] = number(action[key], key, key === "scale" ? .01 : key === "opacity" ? 0 : -10000, key === "scale" ? 10 : key === "opacity" ? 1 : 10000);
          detail = (["x", "y", "scale", "rotation", "opacity"] as const)
            .filter(key => action[key] !== undefined)
            .map(key => `${{ x: "X", y: "Y", scale: word("缩放", "Scale"), rotation: word("旋转", "Rotation"), opacity: word("透明度", "Opacity") }[key]} ${clip.transform[key]}${key === "rotation" ? "°" : key === "scale" ? "×" : ""}`).join(" · "); break;
        }
        case "setFades":
          for (const key of ["fadeIn", "fadeOut", "audioFadeIn", "audioFadeOut"] as const)
            clip[key] = number(action[key], "淡化时长", 0, clip.duration);
          delete clip.videoFadeWindow; delete clip.audioFadeWindow;
          detail = `${word("画面淡入", "Video fade in")} ${clip.fadeIn}s · ${word("淡出", "Video fade out")} ${clip.fadeOut}s · ${word("声音淡入", "Audio fade in")} ${clip.audioFadeIn}s · ${word("淡出", "Audio fade out")} ${clip.audioFadeOut}s`; break;
      }
    }
    descriptions.push(`${word(labels[type], englishLabels[type])}${word("：", " · ")}${target}${detail ? ` · ${detail}` : ""}`);
  }
  project = validateProject(project);
  return { project, descriptions, before: { clips: input.clips.length, duration: projectDuration(input) }, after: { clips: project.clips.length, duration: projectDuration(project) } };
}

const safeName = (value: string, max = 120) => value
  .replace(/(?:[a-z][a-z\d+.-]*:\/\/|reacut-media:|[A-Za-z]:[\\/]|\\\\|\/)[^\s]*/gi, "[本地内容]")
  .replace(/\0/g, "").slice(0, max);
const safeId = (value: string) => value.length <= 256 && !/[\0\s/\\:]/.test(value);

/** Media selections are session data. Recheck them against the current asset and range before sharing. */
export function assistantMediaSelection(project: Project, selections: readonly AssistantMediaSelection[]): AssistantMediaSelection[] {
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const selected = new Map<string, AssistantMediaSelection>();
  for (const { assetId, range } of selections.slice(0, MAX_ASSISTANT_MEDIA)) {
    const asset = assets.get(assetId);
    if (!asset || asset.missing || !safeId(assetId)) continue;
    if (!range) { selected.set(assetId, { assetId }); continue; }
    const { sourceIn, duration } = range;
    if (!Number.isFinite(sourceIn) || !Number.isFinite(duration) || sourceIn < 0 || duration <= 0 || duration > 86400 ||
      (asset.kind === "image" ? sourceIn !== 0 : sourceIn + duration > asset.duration + 1e-6)) continue;
    selected.set(assetId, { assetId, range: { sourceIn, duration } });
  }
  return [...selected.values()];
}

export function assistantTranscriptionRequest(
  source: unknown,
  language: unknown = "auto",
  media: readonly AssistantMediaSelection[] = [],
): SpeechRecognitionRequest {
  const [kind, sourceId] = typeof source === "string" ? source.split(":", 2) : [];
  if ((kind !== "clip" && kind !== "asset") || !sourceId || !safeId(sourceId) || source !== `${kind}:${sourceId}`)
    throw new Error("Use clip:<id> or asset:<id> from the open project.");
  if (language !== "auto" && language !== "zh" && language !== "en")
    throw new Error("Use auto, zh, or en for the spoken language.");
  const range = kind === "asset" ? media.find(item => item.assetId === sourceId)?.range : undefined;
  return { mode: "asr", source, language, ...(range ? { range } : {}) };
}

/** Explicit allowlist: no asset URLs, absolute paths, thumbnails, waveforms or media bytes. */
export function assistantProjectContext(project: Project, selectedIds: string[], playhead: number, referenceAssetIds: string[] = [], media: readonly AssistantMediaSelection[] = []): string {
  const selected = new Set(selectedIds);
  const selectedMedia = assistantMediaSelection(project, media);
  const references = new Set([...selectedMedia.map(item => item.assetId), ...referenceAssetIds]);
  const rankedClips = [...project.clips].filter(c => safeId(c.id) && safeId(c.trackId) && (!c.assetId || safeId(c.assetId)))
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id))).slice(0, 100);
  const trackPriority = new Map([...new Set(rankedClips.map(c => c.trackId))].map((id, index) => [id, index]));
  const tracks = [...project.tracks].filter(t => safeId(t.id))
    .sort((a, b) => (trackPriority.get(a.id) ?? Infinity) - (trackPriority.get(b.id) ?? Infinity)).slice(0, 40);
  const trackIds = new Set(tracks.map(t => t.id));
  const assetPriority = new Map([...new Set(rankedClips.map(c => c.assetId))].map((id, index) => [id, index]));
  const assets = [...project.assets].filter(a => safeId(a.id))
    .sort((a, b) => Number(references.has(b.id)) - Number(references.has(a.id)) ||
      (assetPriority.get(a.id) ?? Infinity) - (assetPriority.get(b.id) ?? Infinity)).slice(0, 100);
  const assetIds = new Set(assets.map(a => a.id));
  const clips = rankedClips.filter(c => trackIds.has(c.trackId) && (!c.assetId || assetIds.has(c.assetId)));
  const summary = {
    projectId: safeId(project.id) ? project.id : "redacted-project", name: safeName(project.name),
    timeline: project.activeTimeline ? safeName(project.activeTimeline.name) : undefined,
    canvas: { width: project.width, height: project.height, fps: project.fps, background: project.background },
    playhead, selectedIds: clips.filter(c => selected.has(c.id)).map(c => c.id), duration: projectDuration(project),
    selectedMedia: selectedMedia.length ? selectedMedia : undefined,
    referenceAssetIds: referenceAssetIds.length ? referenceAssetIds.filter(id => assetIds.has(id)) : undefined,
    assets: assets.map(a => ({ id: a.id, name: safeName(a.name), kind: a.kind, duration: a.duration, width: a.width, height: a.height, missing: !!a.missing, hasAudio: !!a.hasAudio })),
    tracks: tracks.map(t => ({ id: t.id, name: safeName(t.name), kind: t.kind, locked: t.locked })),
    clips: clips.map(c => ({ id: c.id, name: safeName(c.name), assetId: c.assetId, trackId: c.trackId, start: c.start, duration: c.duration, sourceIn: c.sourceIn, speed: c.speed, volume: c.volume, muted: c.muted,
      transform: { x: c.transform.x, y: c.transform.y, scale: c.transform.scale, rotation: c.transform.rotation, opacity: c.transform.opacity, flipX: c.transform.flipX, flipY: c.transform.flipY },
      animatedProperties: [...new Set(c.keyframes.map(k => k.property))],
      text: c.text ? safeName(c.text.text, 500) : undefined })),
    truncated: clips.length !== project.clips.length || assets.length !== project.assets.length || tracks.length !== project.tracks.length,
  };
  let serialized = JSON.stringify(summary);
  const bytes = new TextEncoder();
  // Leave headroom below the IPC/backend limit. Drop lower-priority clips first;
  // retain every reference used by the remaining clips, especially selection.
  while (bytes.encode(serialized).byteLength > 90_000) {
    summary.truncated = true;
    if (summary.clips.length > 1) summary.clips.pop();
    else if (summary.assets.length > 1) {
      const referenced = new Set([...references, ...summary.clips.map(c => c.assetId)]);
      let removable = summary.assets.length - 1;
      while (removable >= 0 && referenced.has(summary.assets[removable].id)) removable--;
      if (removable < 0) break;
      summary.assets.splice(removable, 1);
    } else break;
    summary.selectedIds = summary.clips.filter(c => selected.has(c.id)).map(c => c.id);
    serialized = JSON.stringify(summary);
  }
  return serialized;
}
