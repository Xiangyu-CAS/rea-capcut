import { stat } from "node:fs/promises";
import { beatSource, MAX_BEAT_MARKS, validateBeatAnalysis, type BeatAnalysis } from "../src/core/beats";
import type { Project } from "../src/core/types";
import { runMediaTool } from "./media";

const sampleRate = 8000;
const hop = 80;
const hopsPerSecond = sampleRate / hop;

/** Local onset envelope with separate low/high bands. Correlation estimates
 * the beat period; each mark is then anchored to a nearby measured onset. */
function detectBeats(pcm: Buffer, signal: AbortSignal): BeatAnalysis {
  const count = Math.floor(pcm.length / (2 * hop));
  const novelty = new Float32Array(count);
  let low = 0, lastBass = 0, lastTreble = 0, peak = 0, baseline = 0;
  for (let frame = 0; frame < count; frame++) {
    if (frame % 2048 === 0) signal.throwIfAborted();
    let bass = 0, treble = 0;
    for (let i = 0; i < hop; i++) {
      const sample = pcm.readInt16LE((frame * hop + i) * 2) / 32768;
      low += (sample - low) * 0.12;
      bass += low ** 2;
      treble += (sample - low) ** 2;
    }
    bass = Math.sqrt(bass / hop);
    treble = Math.sqrt(treble / hop);
    const energy = 0.7 * Math.max(0, bass - lastBass * 1.12) + 0.3 * Math.max(0, treble - lastTreble * 1.12);
    novelty[frame] = Math.max(0, energy - baseline * 3);
    peak = Math.max(peak, novelty[frame]);
    baseline += (energy - baseline) * 0.02;
    lastBass = bass;
    lastTreble = treble;
  }
  const onsets: { frame: number; weight: number }[] = [];
  for (let frame = 0; frame < count; frame++) {
    const strength = novelty[frame];
    if (strength < Math.max(0.002, peak * 0.06) || strength < (novelty[frame - 1] ?? 0) ||
        strength <= (novelty[frame + 1] ?? 0)) continue;
    const previous = onsets.at(-1);
    if (previous && frame - previous.frame < 10) {
      if (strength > previous.weight) onsets[onsets.length - 1] = { frame, weight: strength };
    } else onsets.push({ frame, weight: strength });
  }
  if (onsets.length < 4) throw new Error("No regular beat was detected.");
  const period = new Float32Array(241);
  for (let i = 0; i < onsets.length; i++) {
    const a = onsets[i];
    for (let j = i + 1; j < onsets.length; j++) {
      const b = onsets[j], distance = b.frame - a.frame;
      if (distance > 238) break;
      const score = Math.sqrt(a.weight * b.weight);
      for (let k = -2; k <= 2; k++) period[distance + k] += score * (1 - Math.abs(k) / 3);
    }
  }
  let lag = 50, quality = 0;
  for (let candidate = 28; candidate <= 120; candidate++) {
    const preference = 1 - Math.min(0.23, Math.abs(Math.log(candidate / 52)) * 0.19);
    const score = (period[candidate] + 0.28 * period[candidate * 2]) * preference;
    if (score > quality) { lag = candidate; quality = score; }
  }
  if (quality < onsets.reduce((sum, item) => sum + item.weight, 0) * 0.14)
    throw new Error("No regular beat was detected.");
  const phaseScores = new Float32Array(lag);
  for (const { frame, weight } of onsets)
    for (let d = -3; d <= 3; d++)
      phaseScores[(frame + lag + d) % lag] += weight * (1 - Math.abs(d) / 4);
  let phase = phaseScores.indexOf(Math.max(...phaseScores));
  const times: number[] = [];
  let cursor = 0;
  const tolerance = Math.max(3, Math.round(lag * 0.12));
  for (; phase < count && times.length < MAX_BEAT_MARKS; phase += lag) {
    while (cursor < onsets.length && onsets[cursor].frame < phase - tolerance) cursor++;
    let best: (typeof onsets)[number] | undefined;
    for (let i = cursor; i < onsets.length && onsets[i].frame <= phase + tolerance; i++) {
      if (!best || onsets[i].weight > best.weight) best = onsets[i];
    }
    if (!best) continue;
    times.push(best.frame / hopsPerSecond);
    // Follow small tempo drift without abandoning the estimated meter.
    phase += Math.round((best.frame - phase) / 2);
  }
  if (times.length < 4) throw new Error("No regular beat was detected.");
  return { bpm: Math.round(60 * hopsPerSecond / lag * 10) / 10, times };
}

export async function analyzeBeats(project: Project, assetId: string, signal: AbortSignal, report: (progress: number) => void) {
  const asset = beatSource(project, assetId);
  signal.throwIfAborted();
  const before = await stat(asset.path);
  if (!before.isFile()) throw new Error("Audio source is unavailable.");
  report(0);
  const pcm = await runMediaTool("ffmpeg", [
    "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", asset.path,
    "-map", "0:a:0", "-t", String(asset.duration), "-vn", "-sn", "-dn",
    "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
  ], 5 * 60_000, 32 * 1024 * 1024, { signal });
  report(0.85);
  const analysis = validateBeatAnalysis(detectBeats(pcm, signal), asset.duration);
  const after = await stat(asset.path);
  signal.throwIfAborted();
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new Error("Audio source changed during analysis.");
  report(1);
  return analysis;
}
