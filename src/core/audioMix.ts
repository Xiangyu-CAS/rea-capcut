import type { Clip, MediaAsset, Project } from "./types";
import type { BeatAnalysis } from "./beats";

export interface AudioInterval { start: number; end: number }
export interface DuckingOptions {
  reductionDb: number;
  attack: number;
  release: number;
  thresholdDb: number;
}

export interface AudioDucking extends DuckingOptions {
  regions: AudioInterval[];
}

export type AudioAnalysisRequest =
  | { mode: "normalize"; clipIds: readonly string[]; targetLufs: number }
  | { mode: "duck"; voiceTrackId: string; musicTrackId: string; options: DuckingOptions }
  | { mode: "beats"; assetId: string };
export interface LoudnessMeasurement { clipId: string; lufs: number; truePeakDb: number; gainDb: number }
export type AudioAnalysisResult =
  | { mode: "normalize"; measurements: LoudnessMeasurement[] }
  | { mode: "duck"; regions: AudioInterval[] }
  | { mode: "beats"; analysis: BeatAnalysis };
export interface AudioAnalysisProgress { jobId: string; progress: number }

export const DEFAULT_DUCKING: DuckingOptions = {
  reductionDb: 12, attack: 0.12, release: 0.35, thresholdDb: -40,
};
export const MAX_DUCK_REGIONS = 512;
export const dbGain = (db: number) => 10 ** (db / 20);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function validateDuckingOptions(input: unknown): DuckingOptions {
  const options = input as Partial<DuckingOptions> | null;
  if (!options || !inRange(options.reductionDb, 1, 36) ||
      !inRange(options.attack, 0.02, 3) || !inRange(options.release, 0.02, 5) ||
      !inRange(options.thresholdDb, -65, -15))
    throw new Error("Invalid ducking settings.");
  return {
    reductionDb: options.reductionDb, attack: options.attack,
    release: options.release, thresholdDb: options.thresholdDb,
  };
}

export function validateAudioDucking(input: unknown): AudioDucking {
  const options = validateDuckingOptions(input);
  const regions = (input as AudioDucking).regions;
  if (!Array.isArray(regions) || !regions.length || regions.length > MAX_DUCK_REGIONS)
    throw new Error("Invalid ducking regions.");
  let lastEnd = 0;
  for (const interval of regions) {
    if (!interval || !inRange(interval.start, lastEnd, 86400) ||
        !inRange(interval.end, interval.start, 86400) || interval.end <= interval.start)
      throw new Error("Invalid ducking regions.");
    lastEnd = interval.end;
  }
  return { ...options, regions };
}

/** Nearby activity shares a single reduction, so short pauses don't lift the music. */
export function mergeAudioIntervals(intervals: AudioInterval[], gap = 0): AudioInterval[] {
  const merged: AudioInterval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + gap + 1e-6)
      previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

export function duckingEnvelope(ducking: AudioDucking) {
  const { attack, release, reductionDb, regions } = ducking;
  return {
    attack, release, gain: dbGain(-reductionDb),
    regions: mergeAudioIntervals(regions, attack + release),
  };
}

export function duckingGain(envelope: ReturnType<typeof duckingEnvelope>, time: number): number {
  const { attack, release, gain, regions } = envelope;
  let lo = 0, hi = regions.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (regions[mid].end + release <= time) lo = mid + 1;
    else hi = mid;
  }
  const region = regions[lo];
  if (!region || time <= region.start - attack) return 1;
  if (time < region.start) return 1 + (gain - 1) * (time - region.start + attack) / attack;
  if (time <= region.end) return gain;
  return gain + (1 - gain) * (time - region.end) / release;
}

export function normalizableClips(project: Project, clipIds: readonly string[]): Clip[] {
  const selected = new Set(clipIds);
  const available = new Set(project.assets.filter(asset =>
    asset.hasAudio && !asset.missing && (asset.kind === "audio" || asset.kind === "video"),
  ).map(asset => asset.id));
  const editable = new Set(project.tracks.filter(track => !track.locked).map(track => track.id));
  return project.clips.filter(clip =>
    selected.has(clip.id) && editable.has(clip.trackId) && available.has(clip.assetId ?? ""));
}

export function audioAnalysisSources(project: Project, request: AudioAnalysisRequest): { clip: Clip; asset: MediaAsset }[] {
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const sources = (clips: Clip[]) => clips.map(clip => {
    const asset = assets.get(clip.assetId ?? "");
    if (!asset?.hasAudio || asset.missing || asset.kind === "image")
      throw new Error("Choose an available audio or video clip with sound.");
    return { clip, asset };
  });
  if (request?.mode === "normalize") {
    if (!inRange(request.targetLufs, -30, -10)) throw new Error("Choose a loudness target from -30 to -10 LUFS.");
    if (!Array.isArray(request.clipIds) || !request.clipIds.length || request.clipIds.length > 200)
      throw new Error("Select 1–200 available audio clips.");
    const clips = normalizableClips(project, request.clipIds);
    if (clips.length !== request.clipIds.length) throw new Error("Choose distinct, unlocked clips with available audio.");
    if (clips.reduce((sum, clip) => sum + clip.duration * clip.speed, 0) > 3600)
      throw new Error("Audio analysis supports up to 60 minutes of source audio.");
    return sources(clips);
  }
  if (request?.mode !== "duck") throw new Error("Invalid audio analysis request.");
  validateDuckingOptions(request.options);
  const voice = project.tracks.find(track => track.id === request.voiceTrackId);
  const music = project.tracks.find(track => track.id === request.musicTrackId);
  if (!voice || voice.muted || voice === music || music?.kind !== "audio" || music.locked)
    throw new Error("Choose separate voice and unlocked music tracks.");
  const clips = project.clips.filter(clip =>
    clip.trackId === voice.id && !clip.muted && assets.get(clip.assetId ?? "")?.hasAudio);
  if (!clips.length || !project.clips.some(clip => clip.trackId === music.id && assets.get(clip.assetId ?? "")?.hasAudio))
    throw new Error("The selected tracks must contain audio.");
  if (clips.length > 200 || clips.reduce((sum, clip) => sum + clip.duration * clip.speed, 0) > 3600)
    throw new Error("Voice analysis supports up to 200 clips and 60 minutes of source audio.");
  return sources(clips);
}
