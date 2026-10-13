import { clone, snapToFrame, trimClip, validateProject } from "./model";
import type { Clip, Project } from "./types";

export type SubtitleEdit =
  | { type: "cue"; text: string; start: number; end: number }
  | { type: "offset"; seconds: number }
  | { type: "replace"; find: string; replacement: string }
  | { type: "style"; referenceId: string };

export interface SubtitleEditPlan {
  base: string;
  project: Project;
  changedIds: string[];
}

function text(value: unknown, label: string, empty = true): asserts value is string {
  if (typeof value !== "string" || value.length > 20000 || value.includes("\0") || (!empty && !value.length))
    throw new Error(`${label}无效（最多 20000 字）`);
}
function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}必须是有限数值`);
}
function cue(project: Project, id: string, editable = true): Clip {
  const clip = project.clips.find(c => c.id === id);
  const track = project.tracks.find(t => t.id === clip?.trackId);
  if (!clip?.text || track?.kind !== "text") throw new Error("所选字幕不存在或不是文字片段");
  if (editable && track.locked) throw new Error(`轨道“${track.name}”已锁定，请先解锁`);
  return clip;
}

/** Prepare on a clone. Overlapping cues are legal; none of the targets may fail silently. */
export function prepareSubtitleEdit(input: Project, ids: readonly string[], edit: SubtitleEdit): SubtitleEditPlan {
  let project = validateProject(clone(input));
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || new Set(ids).size !== ids.length)
    throw new Error("请选择不重复的字幕");
  const originals = ids.map(id => cue(project, id));
  if (new Set(originals.map(c => c.trackId)).size !== 1) throw new Error("每次批量操作只能修改一个字幕轨道");
  if (!edit || typeof edit !== "object") throw new Error("字幕操作无效");
  if (edit.type === "cue") {
    if (ids.length !== 1) throw new Error("逐条编辑只能选择一条字幕");
    text(edit.text, "字幕内容"); finite(edit.start, "开始时间"); finite(edit.end, "结束时间");
    if (edit.start < 0 || edit.end > 86400 || edit.end <= edit.start) throw new Error("字幕时间须在 0～86400 秒内，结束时间须晚于开始时间");
    const start = snapToFrame(edit.start, project.fps), end = snapToFrame(edit.end, project.fps);
    if (end - start < 1 / project.fps - 1e-9) throw new Error("字幕时长至少为一帧");
    const original = originals[0];
    const originalEnd = original.start + original.duration;
    if (Math.abs(end - start - original.duration) < 1e-9 || start >= originalEnd || end <= original.start) {
      // A translated or disjoint cue is a move, not a crop of its old absolute envelope.
      // Keep its local animation/fades so moving an animated caption does not make it disappear.
      original.start = start;
      project = trimClip(project, original.id, "end", end);
    } else {
      if (end > originalEnd) project = trimClip(project, original.id, "end", end);
      if (start < original.start) project = trimClip(project, original.id, "start", start);
      project = trimClip(project, original.id, "start", start);
      project = trimClip(project, original.id, "end", end);
    }
    const next = cue(project, original.id);
    if (Math.abs(next.start - start) > 1e-8 || Math.abs(next.start + next.duration - end) > 1e-8)
      throw new Error("无法应用所选字幕时间");
    next.text!.text = edit.text;
    next.name = edit.text.slice(0, 4096);
  } else if (edit.type === "offset") {
    finite(edit.seconds, "偏移量");
    if (Math.abs(edit.seconds) > 86400) throw new Error("偏移量超出范围");
    const delta = snapToFrame(edit.seconds, project.fps);
    for (const clip of originals) {
      const start = snapToFrame(clip.start + delta, project.fps);
      if (start < 0 || start + clip.duration > 86400) throw new Error("偏移后字幕超出时间线范围，未修改任何字幕");
      clip.start = start;
    }
  } else if (edit.type === "replace") {
    text(edit.find, "查找内容", false); text(edit.replacement, "替换内容");
    for (const clip of originals) {
      const pieces = clip.text!.text.split(edit.find);
      const size = clip.text!.text.length + (pieces.length - 1) * (edit.replacement.length - edit.find.length);
      if (size > 20000) throw new Error("替换后的字幕内容无效（最多 20000 字）");
      const value = pieces.join(edit.replacement);
      text(value, "替换后的字幕内容");
      clip.text!.text = value; clip.name = value.slice(0, 4096);
    }
  } else if (edit.type === "style") {
    const reference = cue(project, edit.referenceId, false);
    const { text: _content, ...style } = reference.text!;
    for (const clip of originals) clip.text = { ...clip.text!, ...clone(style) };
  } else throw new Error("不支持的字幕操作");
  project = validateProject(project);
  return {
    base: JSON.stringify(input), project,
    changedIds: ids.filter(id => JSON.stringify(input.clips.find(c => c.id === id)) !== JSON.stringify(project.clips.find(c => c.id === id))),
  };
}

/** A user can keep an edit form open while the project changes elsewhere. Never overwrite it. */
export function applySubtitleEdit(current: Project, plan: SubtitleEditPlan): Project {
  if (JSON.stringify(current) !== plan.base) throw new Error("项目已变化，请重新检查字幕修改后再应用");
  return validateProject(clone(plan.project));
}
