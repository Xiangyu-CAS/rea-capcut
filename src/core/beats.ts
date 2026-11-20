import type { Clip, MediaAsset, Project } from "./types";
import { sourceOffsetAt, timelineOffsetAt } from "./speedCurve";

export interface BeatAnalysis {
  bpm: number;
  times: number[];
}

export const MAX_BEAT_DURATION = 30 * 60;
export const MAX_BEAT_MARKS = 10000;

export function validateBeatAnalysis(input: unknown, duration: number): BeatAnalysis {
  const result = input as Partial<BeatAnalysis> | null;
  if (!result || typeof result.bpm !== "number" || !Number.isFinite(result.bpm) ||
      result.bpm < 50 || result.bpm > 220 || !Array.isArray(result.times) ||
      !result.times.length || result.times.length > MAX_BEAT_MARKS)
    throw new Error("Invalid beat analysis.");
  let last = -1;
  for (const time of result.times) {
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0 ||
        time <= last || time > duration + 0.05) throw new Error("Invalid beat timestamp.");
    last = time;
  }
  return { bpm: result.bpm, times: result.times };
}

export function beatSource(project: Project, assetId: string): MediaAsset {
  const asset = project.assets.find(item => item.id === assetId);
  if (!asset?.hasAudio || asset.missing || asset.kind === "image")
    throw new Error("Select an available audio or video clip with sound.");
  if (!Number.isFinite(asset.duration) || asset.duration < 2 || asset.duration > MAX_BEAT_DURATION)
    throw new Error("Beat detection supports audio from 2 seconds to 30 minutes.");
  return asset;
}

export function clipBeatTimes(clip: Clip, asset: MediaAsset | undefined, from = clip.start, to = clip.start + clip.duration): number[] {
  const times = asset?.missing ? undefined : asset?.beats?.times;
  if (!times || from > clip.start + clip.duration || to < clip.start) return [];
  const start = clip.sourceIn + sourceOffsetAt(clip, Math.max(0, from - clip.start));
  const end = clip.sourceIn + sourceOffsetAt(clip, Math.min(clip.duration, to - clip.start));
  const atOrAfter = (time: number) => {
    let lo = 0, hi = times.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (times[mid] < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return times.slice(atOrAfter(start - 1e-8), atOrAfter(end + 1e-8))
    .map(time => clip.start + timelineOffsetAt(clip, time - clip.sourceIn));
}

export function projectBeatTimes(project: Project, from = 0, to = Infinity, excluded: string[] = []): number[] {
  const assets = new Map(project.assets.filter(asset => asset.beats).map(asset => [asset.id, asset]));
  if (!assets.size) return [];
  return project.clips.flatMap(clip => excluded.includes(clip.id) ? [] :
    clipBeatTimes(clip, assets.get(clip.assetId ?? ""), from, to));
}
