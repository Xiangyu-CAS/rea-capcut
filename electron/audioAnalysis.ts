import { stat } from "node:fs/promises";
import {
  audioAnalysisSources, MAX_DUCK_REGIONS, mergeAudioIntervals,
  type AudioAnalysisRequest, type AudioAnalysisResult, type AudioInterval, type LoudnessMeasurement,
} from "../src/core/audioMix";
import type { Project } from "../src/core/types";
import { clipAudioFilters, sourceAudioFilters } from "./audioFilters";
import { number } from "./filterExpressions";
import { runMediaTool } from "./media";

function complementSilence(log: string, start: number, duration: number): AudioInterval[] {
  const regions: AudioInterval[] = [];
  let audibleStart: number | undefined = 0;
  for (const event of log.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi)) {
    const time = Math.min(duration, Math.max(0, Number(event[2])));
    if (event[1] === "end") audibleStart = time;
    else {
      if (audibleStart !== undefined && time > audibleStart)
        regions.push({ start: start + audibleStart, end: start + time });
      audibleStart = undefined;
    }
  }
  if (audibleStart !== undefined && audibleStart < duration)
    regions.push({ start: start + audibleStart, end: start + duration });
  return regions;
}

export async function analyzeAudio(
  project: Project, request: AudioAnalysisRequest, signal: AbortSignal,
  report: (progress: number) => void,
): Promise<AudioAnalysisResult> {
  const sources = audioAnalysisSources(project, request);
  const total = sources.reduce((duration, { clip }) => duration + clip.duration, 0);
  const intervals: AudioInterval[] = [];
  const measurements: LoudnessMeasurement[] = [];
  let completed = 0;
  for (const { clip, asset } of sources) {
    signal.throwIfAborted();
    const before = await stat(asset.path);
    if (!before.isFile()) throw new Error("Audio source is unavailable.");
    const filters = request.mode === "normalize"
      ? [...sourceAudioFilters(clip), `loudnorm=I=${number(request.targetLufs)}:TP=-1.5:LRA=11:print_format=json`]
      : [...clipAudioFilters(clip), `apad=whole_dur=${number(clip.duration)}`,
        `silencedetect=noise=${number(request.options.thresholdDb)}dB:d=0.18`];
    let diagnostic = "", progressText = "";
    report(completed / total);
    await runMediaTool("ffmpeg", [
      "-hide_banner", "-nostdin", "-nostats", "-v", "info",
      "-ss", number(clip.sourceIn), "-t", number(clip.duration * clip.speed), "-i", asset.path, "-map", "0:a:0",
      "-af", filters.join(","), "-vn", "-sn", "-dn",
      "-progress", "pipe:1", "-f", "null", "-",
    ], 15 * 60_000, 2 * 1024 * 1024, {
      signal,
      onDiagnostic: chunk => {
        // Keep a bound for malformed or extremely fragmented audio.
        if (diagnostic.length < 512 * 1024) diagnostic += chunk;
      },
      onOutput: chunk => {
        const lines = (progressText + chunk).split("\n");
        progressText = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("out_time_us=")) continue;
          const time = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(time))
            report((completed + Math.max(0, Math.min(clip.duration, time))) / total);
        }
      },
    });
    signal.throwIfAborted();
    const after = await stat(asset.path);
    if (before.ino !== after.ino || before.dev !== after.dev ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error("Audio source changed during analysis.");
    if (diagnostic.length >= 512 * 1024) throw new Error("Audio analysis has too many activity events.");
    if (request.mode === "normalize") {
      const lufs = Number(diagnostic.match(/"input_i"\s*:\s*"([^"]+)"/)?.[1]);
      const truePeakDb = Number(diagnostic.match(/"input_tp"\s*:\s*"([^"]+)"/)?.[1]);
      if (!Number.isFinite(lufs) || lufs <= -70 || !Number.isFinite(truePeakDb))
        throw new Error("This clip is too short or quiet to measure loudness.");
      // A static gain preserves dynamics. The source's true peak takes precedence over LUFS.
      const gainDb = Math.min(24, request.targetLufs - lufs, -1.5 - truePeakDb);
      if (gainDb < -36) throw new Error("The source requires more than 36 dB of attenuation.");
      measurements.push({ clipId: clip.id, lufs, truePeakDb, gainDb });
    } else intervals.push(...complementSilence(diagnostic, clip.start, clip.duration));
    completed += clip.duration;
  }
  if (request.mode === "normalize") {
    report(1);
    return { mode: "normalize", measurements };
  }
  const regions = mergeAudioIntervals(intervals);
  if (!regions.length) throw new Error("No sound crossed the voice threshold on this track.");
  if (regions.length > MAX_DUCK_REGIONS)
    throw new Error("Too many voice intervals. Analyze a shorter section or adjust the threshold.");
  report(1);
  return { mode: "duck", regions };
}
