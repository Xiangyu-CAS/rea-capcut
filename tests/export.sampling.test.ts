import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createClip, createProject } from "../src/core/model";
import type { ExportOptions, ExportProgress, MediaAsset, Project } from "../src/core/types";
import { findMediaTool, runMediaTool } from "../electron/media";
import { startExport } from "../electron/export";
import { averageSpeed, sourceOffsetAt, timelineOffsetAt, type SpeedPoint } from "../src/core/speedCurve";

const width = 32, height = 32, frameBytes = width * height * 3;
let directory: string;
interface FrameSource {
  asset: MediaAsset;
  timestamps: number[];
  colors: number[][];
}
type SourceKind = "lossless" | "long-gop" | "vfr";
const sources = new Map<string, FrameSource>();

async function rawFrames(file: string): Promise<Buffer> {
  return runMediaTool("ffmpeg", [
    "-v", "error", "-i", file, "-map", "0:v:0", "-fps_mode", "passthrough",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ]);
}

async function source(fps: number, kind: SourceKind = "lossless"): Promise<FrameSource> {
  const key = `${kind}-${fps}`;
  const existing = sources.get(key);
  if (existing) return existing;
  const duration = kind === "long-gop" ? 8 : 4;
  const file = path.join(directory, `frame-identity-${key}.${kind === "lossless" ? "nut" : "mp4"}`);
  // Every source frame has a distinct RGB color. Lossless cases retain exact
  // colors/rational PTS; GOP/VFR cases verify identities after H264 decoding.
  // Static-color intervals therefore cannot hide incorrect source sampling.
  const argumentsForSource = [
    "-v", "error", "-y", "-f", "lavfi", "-i",
    `nullsrc=s=${width}x${height}:r=${fps}:d=${duration},format=gbrp,geq=r='16+32*mod(N,8)':g='16+32*mod(floor(N/8),8)':b='16+32*floor(N/64)'`,
  ];
  if (kind === "vfr")
    argumentsForSource.push("-vf", "select='lt(n,12)*not(mod(n,3))+between(n,72,85)+gte(n,105)*not(mod(n,5))'", "-fps_mode", "vfr");
  if (kind === "lossless") argumentsForSource.push("-c:v", "ffv1");
  else argumentsForSource.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "14", "-g", "90", "-bf", "3", "-x264-params", "scenecut=0:b-adapt=0");
  argumentsForSource.push(file);
  await runMediaTool("ffmpeg", argumentsForSource);
  const probe = JSON.parse((await runMediaTool("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_frames",
    "-show_entries", "stream=time_base:frame=best_effort_timestamp,pict_type,key_frame", "-of", "json", file,
  ])).toString("utf8"));
  const [numerator, denominator] = probe.streams[0].time_base.split("/").map(Number);
  const timestamps: number[] = probe.frames.map((frame: { best_effort_timestamp: number }) =>
    Number(frame.best_effort_timestamp) * numerator / denominator);
  if (kind === "long-gop") {
    expect(probe.frames.some((frame: { pict_type: string }) => frame.pict_type === "B")).toBe(true);
    const keyTimes: number[] = probe.frames.filter((frame: { key_frame: number }) => frame.key_frame === 1)
      .map((frame: { best_effort_timestamp: number }) => Number(frame.best_effort_timestamp) * numerator / denominator);
    expect(keyTimes[1] - keyTimes[0]).toBeGreaterThanOrEqual(2.9);
  }
  if (kind === "vfr")
    expect(Math.max(...timestamps.slice(1).map((time, index) => time - timestamps[index]))).toBeGreaterThan(1.5);
  const decoded = await rawFrames(file);
  expect(decoded.length / frameBytes).toBe(timestamps.length);
  const colors = timestamps.map((_, index) => {
    const offset = index * frameBytes + ((height / 2) * width + width / 2) * 3;
    return [...decoded.subarray(offset, offset + 3)];
  });
  expect(new Set(colors.map(color => color.join(","))).size).toBe(timestamps.length);
  const result: FrameSource = {
    asset: {
      id: randomUUID(), name: `Source ${fps} fps`, path: file, url: file,
      kind: "video", duration, width, height, fps, hasAudio: false,
    },
    timestamps, colors,
  };
  sources.set(key, result);
  return result;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "reacut-source-sampling-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function render(project: Project, options: ExportOptions): Promise<ExportProgress> {
  return new Promise<ExportProgress>((resolve, reject) => {
    void startExport(project, options, progress => {
      if (progress.status === "complete") resolve(progress);
      if (progress.status === "error" || progress.status === "cancelled")
        reject(new Error(progress.message ?? progress.status));
    }).catch(reject);
  });
}

async function exportAndIdentify(
  sample: FrameSource,
  outputFps: number,
  speed: number,
  sourceIn: number,
  duration: number,
  speedCurve?: SpeedPoint[],
): Promise<{ actual: number[]; expected: number[] }> {
  const project = createProject("source-frame-hold-test");
  project.width = width;
  project.height = height;
  project.fps = outputFps;
  project.background = "#000000";
  project.assets = [sample.asset];
  project.clips = [{
    ...createClip(sample.asset, project.tracks.find(track => track.kind === "video")!.id, 0, outputFps),
    speed, sourceIn, duration, speedCurve,
  }];
  const file = path.join(directory, `output-${randomUUID()}.mp4`);
  await render(project, { path: file, width, height, fps: outputFps, quality: "high", format: "mp4" });
  const decoded = await rawFrames(file);
  const count = decoded.length / frameBytes;
  expect(count).toBe(Math.round(duration * outputFps));
  const probe = JSON.parse((await runMediaTool("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "json", file,
  ])).toString("utf8"));
  expect(Number(probe.format.duration)).toBeCloseTo(duration, 5);
  const actual: number[] = [], expected: number[] = [];
  for (let output = 0; output < count; output++) {
    const offset = output * frameBytes + ((height / 2) * width + width / 2) * 3;
    const color = [...decoded.subarray(offset, offset + 3)];
    const distances = sample.colors.map(candidate => candidate.reduce((sum, value, channel) =>
      sum + (value - color[channel]) ** 2, 0));
    const nearest = Math.min(...distances);
    expect(nearest).toBeLessThan(150);
    actual.push(distances.indexOf(nearest));
    const sourceTime = sourceIn + sourceOffsetAt(project.clips[0], output / outputFps);
    let preceding = 0;
    for (let input = 0; input < sample.timestamps.length; input++) {
      if (sample.timestamps[input] > sourceTime + 1e-8) break;
      preceding = input;
    }
    expected.push(preceding);
  }
  return { actual, expected };
}

describe("actual export source-frame sampling", () => {
  it("holds fractional-seek source frames under an accelerating and decelerating curve", async () => {
    const points = [{ position: 0, rate: 0.5 }, { position: 0.4, rate: 2 }, { position: 1, rate: 0.8 }];
    const result = await exportAndIdentify(await source(30), 30, averageSpeed(points), 0.217, 2, points);
    expect(result.actual).toEqual(result.expected);
  });
  it("places audible events on the expected timeline at both ends of a speed ramp", async () => {
    const input = path.join(directory, "curved-audio.wav");
    await runMediaTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
      "aevalsrc='(between(t,0.8,1.05)+between(t,2.9,3.15))*0.7*sin(2*PI*440*t)':s=48000:d=4",
      "-c:a", "pcm_s16le", input]);
    const project = createProject("Speed ramp audio");
    project.width = project.height = 64;
    const asset: MediaAsset = {
      id: randomUUID(), name: "Pulses", path: input, url: input, kind: "audio",
      width: 0, height: 0, duration: 4, fps: 0, hasAudio: true,
    };
    project.assets = [asset];
    const clip = createClip(asset, project.tracks.find(track => track.kind === "audio")!.id, 0, 30);
    clip.sourceIn = 0.2;
    clip.duration = 3;
    clip.speedCurve = [{ position: 0, rate: 0.5 }, { position: 1, rate: 1.7 }];
    clip.speed = averageSpeed(clip.speedCurve);
    project.clips = [clip];
    const output = path.join(directory, "curved-audio.mp4");
    await render(project, { path: output, width: 64, height: 64, fps: 30, quality: "standard", format: "mp4" });
    const pcm = await runMediaTool("ffmpeg", ["-v", "error", "-i", output, "-vn", "-ac", "1", "-ar", "48000",
      "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"]);
    const energy = (time: number) => {
      let sum = 0;
      const start = Math.round(time * 48000);
      for (let i = start; i < start + 2400; i++) sum += pcm.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / 2400);
    };
    expect(energy(timelineOffsetAt(clip, 0.9 - clip.sourceIn))).toBeGreaterThan(0.15);
    expect(energy(timelineOffsetAt(clip, 3.0 - clip.sourceIn))).toBeGreaterThan(0.15);
    expect(energy(timelineOffsetAt(clip, 1.9 - clip.sourceIn))).toBeLessThan(0.01);
  });

  it.runIf(process.platform === "darwin")("falls back after encoder initialization failure and publishes software output", async () => {
    const media = await source(30);
    const ffmpeg = await findMediaTool("ffmpeg");
    const wrapper = path.join(directory, "simulated-encoder-failure");
    await writeFile(wrapper, `#!/bin/sh
for argument do
  if [ "$argument" = "h264_videotoolbox" ]; then
    printf '%s\\n' 'h264_videotoolbox: cannot initialize encoder' >&2
    exit 1
  fi
done
exec '${ffmpeg.replace(/'/g, "'\\''")}' "$@"
`, { mode: 0o700 });
    const project = createProject("Encoder fallback");
    project.width = project.height = 32;
    project.assets = [media.asset];
    const clip = createClip(media.asset, project.tracks[1].id, 0, 30);
    clip.duration = 1;
    project.clips = [clip];
    const output = path.join(directory, "encoder-recovery.mp4");
    vi.stubEnv("REACUT_FFMPEG", wrapper);
    try {
      const completion = await render(project, {
        path: output, width: 32, height: 32, fps: 30, quality: "standard", format: "mp4", encoder: "videotoolbox",
      });
      expect(completion).toMatchObject({ encoder: "software", encoderFallback: true, path: output });
    } finally { vi.unstubAllEnvs(); }
    expect((await rawFrames(output)).length / frameBytes).toBe(30);
  });
  it.each([
    { label: "1.5x fractional positions", sourceFps: 30, outputFps: 30, speed: 1.5, sourceIn: 0, duration: 2 },
    { label: "0.5x slow motion", sourceFps: 30, outputFps: 30, speed: 0.5, sourceIn: 0, duration: 2 },
    { label: "different source/output rates", sourceFps: 24, outputFps: 30, speed: 1, sourceIn: 0, duration: 2 },
    { label: "downsampled output rate", sourceFps: 30, outputFps: 24, speed: 1, sourceIn: 0, duration: 2 },
    { label: "frame-aligned trim with speed", sourceFps: 30, outputFps: 30, speed: 1.5, sourceIn: 0.5, duration: 1 },
    { label: "fractional trim inpoint", sourceFps: 30, outputFps: 30, speed: 1.5, sourceIn: 0.35, duration: 1 },
    { label: "long-GOP/B-frame middle seek", kind: "long-gop", sourceFps: 30, outputFps: 30, speed: 1.5, sourceIn: 4.35, duration: 1 },
    { label: "long-GOP/B-frame late seek", kind: "long-gop", sourceFps: 30, outputFps: 30, speed: 0.5, sourceIn: 6.05, duration: 1 },
    { label: "VFR seek inside large gap", kind: "vfr", sourceFps: 30, outputFps: 30, speed: 1.5, sourceIn: 1.1, duration: 1.5 },
    { label: "VFR irregular points and following gap", kind: "vfr", sourceFps: 30, outputFps: 30, speed: 0.5, sourceIn: 2.417, duration: 1 },
  ])("holds the previous source PTS for $label", async scenario => {
    const result = await exportAndIdentify(
      await source(scenario.sourceFps, ("kind" in scenario ? scenario.kind : "lossless") as SourceKind), scenario.outputFps, scenario.speed,
      scenario.sourceIn, scenario.duration,
    );
    expect(result.actual).toEqual(result.expected);
  });
});
