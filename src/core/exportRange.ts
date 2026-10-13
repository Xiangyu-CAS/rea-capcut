import type { ExportOptions, Project } from "./types";
import { projectDuration } from "./model";
export function resolveExportRange(project: Project, options: Pick<ExportOptions, "fps" | "range">): { start: number; end: number; duration: number } {
  const total = projectDuration(project), range = options.range;
  if (range === undefined) return { start: 0, end: total, duration: total };
  if (!range || typeof range !== "object" || Array.isArray(range) || Object.keys(range).some(key => key !== "start" && key !== "end") ||
      typeof range.start !== "number" || typeof range.end !== "number" || !Number.isFinite(range.start) || !Number.isFinite(range.end) ||
      range.start < 0 || range.end > total + 1e-8 || range.end - range.start < 1 / options.fps - 1e-8)
    throw new Error("导出区间必须位于时间线内，且至少包含一帧");
  return { start: range.start, end: Math.min(total, range.end), duration: Math.min(total, range.end) - range.start };
}
export function selectedClipRange(project: Project, ids: string[]): { start: number; end: number } | undefined {
  const clips = project.clips.filter(clip => ids.includes(clip.id));
  if (!clips.length) return undefined;
  return { start: Math.min(...clips.map(clip => clip.start)), end: Math.max(...clips.map(clip => clip.start + clip.duration)) };
}
