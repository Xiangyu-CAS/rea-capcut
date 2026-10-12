import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  access,
  stat,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Clip,
  ExportOptions,
  ExportProgress,
  MediaAsset,
  Project,
} from "../src/core/types";
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
} from "../src/core/defaults";
import { splitClip, trimClip } from "../src/core/model";
import {
  applyColorAdjustments,
  colorAdjustmentFilters,
} from "../src/core/color";
import {
  importAssets,
  probeFile,
  runMediaTool,
  systemFontFamilies,
  systemMediaInfo,
} from "../electron/media";
import {
  cancelAllExports,
  cancelExport,
  startExport,
} from "../electron/export";
import { generateFixtures } from "../scripts/generate-fixtures";

let directory: string;
let assets: MediaAsset[];
let temporal: MediaAsset;
let quadrants: MediaAsset;
const settings = (
  name: string,
  overrides: Partial<ExportOptions> = {},
): ExportOptions => ({
  path: path.join(directory, name),
  width: 160,
  height: 90,
  fps: 10,
  quality: "draft",
  format: "mp4",
  ...overrides,
});
function clip(
  asset: MediaAsset | undefined,
  trackId: string,
  overrides: Partial<Clip> = {},
): Clip {
  return {
    id: randomUUID(),
    trackId,
    assetId: asset?.id,
    name: asset?.name ?? "标题",
    start: 0,
    duration: 2,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    muted: false,
    transform: { ...DEFAULT_TRANSFORM },
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    fadeIn: 0,
    fadeOut: 0,
    audioFadeIn: 0,
    audioFadeOut: 0,
    keyframes: [],
    ...overrides,
  };
}
function project(clips: Clip[]): Project {
  return {
    version: 1,
    id: randomUUID(),
    name: "导出测试",
    width: 160,
    height: 90,
    fps: 10,
    background: "#000000",
    assets,
    tracks: [
      {
        id: "title",
        name: "标题",
        kind: "text",
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: "overlay",
        name: "叠加",
        kind: "image",
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: "video",
        name: "视频",
        kind: "video",
        muted: false,
        hidden: false,
        locked: false,
      },
      {
        id: "audio",
        name: "音频",
        kind: "audio",
        muted: false,
        hidden: false,
        locked: false,
      },
    ],
    clips,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
async function render(
  p: Project,
  options: ExportOptions,
): Promise<ExportProgress[]> {
  const progress: ExportProgress[] = [];
  await new Promise<void>((resolve, reject) => {
    void startExport(p, options, (event) => {
      progress.push(event);
      if (event.status === "complete") resolve();
      if (event.status === "error" || event.status === "cancelled")
        reject(new Error(event.message ?? event.status));
    }).catch(reject);
  });
  return progress;
}
async function frame(file: string, second: number): Promise<Buffer> {
  return runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(second),
    "-i",
    file,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ]);
}
const pixel = (buffer: Buffer, x: number, y: number, width = 160): number[] => [
  ...buffer.subarray((y * width + x) * 3, (y * width + x) * 3 + 3),
];
async function rms(
  file: string,
  start: number,
  duration = 0.2,
): Promise<number> {
  const audio = await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(start),
    "-i",
    file,
    "-t",
    String(duration),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  let energy = 0;
  for (let i = 0; i < audio.length; i += 4) energy += audio.readFloatLE(i) ** 2;
  return Math.sqrt(energy / (audio.length / 4));
}
async function frequencyEnergy(
  file: string,
  start: number,
  hz: number,
): Promise<number> {
  const audio = await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(start),
    "-i",
    file,
    "-t",
    "0.1",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  let real = 0;
  let imaginary = 0;
  for (let i = 0; i < audio.length / 4; i++) {
    const angle = (i * 2 * Math.PI * hz) / 48000;
    const value = audio.readFloatLE(i * 4);
    real += value * Math.cos(angle);
    imaginary += value * Math.sin(angle);
  }
  return Math.hypot(real, imaginary);
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "reacut-integration-"));
  const fixture = await generateFixtures(directory);
  assets = await importAssets(
    [fixture.video, fixture.audio, fixture.image],
    path.join(directory, "cache"),
  );
  [temporal, quadrants] = await importAssets(
    [fixture.temporal, fixture.quadrants],
    path.join(directory, "cache"),
  );
  assets.push(temporal, quadrants);
}, 60_000);
afterAll(async () => {
  await cancelAllExports();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("real local media and FFmpeg export", () => {
  it("probes Unicode and punctuation paths, thumbnails, audio and dimensions", async () => {
    expect((await systemMediaInfo()).ffmpeg).toBe(true);
    expect(assets.slice(0, 3).map((a) => a.kind)).toEqual([
      "video",
      "audio",
      "image",
    ]);
    expect(systemFontFamilies().length).toBeGreaterThan(0);
    expect(assets[0]).toMatchObject({
      width: 160,
      height: 90,
      fps: 10,
      hasAudio: true,
    });
    expect(assets[0].duration).toBeCloseTo(4, 1);
    expect(new URL(assets[0].url).searchParams.get("path")).toBe(
      assets[0].path,
    );
    expect(assets[0].thumbnail).toContain("reacut-media://asset?path=");
    expect(assets[1].waveform?.length).toBeGreaterThan(0);
    expect(Math.min(...assets[1].waveform!.slice(4, -4))).toBeGreaterThan(0.9);
    expect(assets[2]).toMatchObject({
      width: 80,
      height: 40,
      duration: 0,
      hasAudio: false,
    });
  });

  it("creates and reuses local Chromium preview proxies while keeping original export sources", async () => {
    const mkv = path.join(directory, "容器.mkv");
    const aiff = path.join(directory, "音频.aiff");
    const tiff = path.join(directory, "图片.tiff");
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      temporal.path,
      "-c",
      "copy",
      mkv,
    ]);
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      assets[1].path,
      "-c:a",
      "pcm_s16be",
      aiff,
    ]);
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      quadrants.path,
      "-frames:v",
      "1",
      tiff,
    ]);
    const imported = await importAssets(
      [mkv, aiff, tiff],
      path.join(directory, "cache"),
    );
    expect(
      imported.every((asset) => asset.previewUrl && !asset.previewError),
    ).toBe(true);
    expect(imported.map((asset) => asset.path)).toEqual([mkv, aiff, tiff]);
    const paths = imported.map((asset) =>
      new URL(asset.previewUrl!).searchParams.get("path")!,
    );
    expect(paths.map((file) => path.extname(file))).toEqual([
      ".mp4",
      ".m4a",
      ".png",
    ]);
    expect(
      (await probeFile(paths[0])).streams.find(
        (stream) => stream.codec_type === "video",
      )?.codec_name,
    ).toBe("h264");
    expect(
      (await probeFile(paths[1])).streams.find(
        (stream) => stream.codec_type === "audio",
      )?.codec_name,
    ).toBe("aac");
    expect(pixel(await frame(paths[0], 2.5), 80, 45)[2]).toBeGreaterThan(220);
    const cachedTime = (await stat(paths[0])).mtimeMs;
    expect(
      (await importAssets([mkv], path.join(directory, "cache")))[0].previewUrl,
    ).toBe(imported[0].previewUrl);
    expect((await stat(paths[0])).mtimeMs).toBe(cachedTime);
  }, 60_000);

  it("converts H264 4:4:4 into a Chromium-compatible 4:2:0 preview", async () => {
    const source = path.join(directory, "h264-high444.mp4");
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      temporal.path,
      "-vf",
      "format=yuv444p",
      "-c:v",
      "libx264",
      "-profile:v",
      "high444",
      "-an",
      source,
    ]);
    const [asset] = await importAssets([source], path.join(directory, "cache"));
    expect(asset.previewUrl).toBeTruthy();
    expect(asset.previewError).toBeUndefined();
    const proxy = new URL(asset.previewUrl!).searchParams.get("path")!;
    expect(
      (await probeFile(proxy)).streams.find(
        (stream) => stream.codec_type === "video",
      )?.pix_fmt,
    ).toBe("yuv420p");
    expect(pixel(await frame(proxy, 2.5), 80, 45)[2]).toBeGreaterThan(220);
  }, 60_000);

  it("provides a local HEVC preview when a source encoder is available", async (context) => {
    const encoders = await runMediaTool("ffmpeg", [
      "-hide_banner",
      "-encoders",
    ]);
    if (!encoders.toString().includes("libx265")) context.skip();
    const source = path.join(directory, "hevc.mp4");
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      temporal.path,
      "-c:v",
      "libx265",
      "-x265-params",
      "log-level=error:pools=1:frame-threads=1",
      "-c:a",
      "copy",
      source,
    ]);
    const [asset] = await importAssets([source], path.join(directory, "cache"));
    expect(asset.previewUrl).toBeTruthy();
    expect(asset.previewError).toBeUndefined();
    const proxy = new URL(asset.previewUrl!).searchParams.get("path")!;
    expect(
      (await probeFile(proxy)).streams.find(
        (stream) => stream.codec_type === "video",
      )?.codec_name,
    ).toBe("h264");
    expect(pixel(await frame(proxy, 2.5), 80, 45)[2]).toBeGreaterThan(220);
    expect(await frequencyEnergy(proxy, 2.5, 1760)).toBeGreaterThan(
      (await frequencyEnergy(proxy, 2.5, 880)) * 10,
    );
  }, 60_000);

  it("composites timed video, image and actual Chinese text; changes fps and resolution", async () => {
    const p = project([
      clip(assets[0], "video", { duration: 1, speed: 2, sourceIn: 1 }),
      clip(assets[2], "overlay", {
        duration: 1,
        transform: { ...DEFAULT_TRANSFORM, scale: 0.25 },
      }),
      clip(undefined, "title", {
        start: 2,
        duration: 1,
        text: {
          ...DEFAULT_TEXT,
          text: "中文标题",
          fontSize: 22,
          strokeWidth: 0,
        },
      }),
    ]);
    const options = settings("composition.mp4", {
      width: 320,
      height: 180,
      fps: 20,
    });
    const events = await render(p, options);
    expect(events.at(-1)?.status).toBe("complete");
    const probe = await probeFile(options.path);
    const video = probe.streams.find((s) => s.codec_type === "video");
    expect(video).toMatchObject({ width: 320, height: 180 });
    expect(Number(probe.format.duration)).toBeCloseTo(3, 1);
    expect(probe.streams.some((s) => s.codec_type === "audio")).toBe(true);
    const first = await frame(options.path, 0.4);
    const corner = pixel(first, 10, 10, 320);
    const center = pixel(first, 160, 90, 320);
    expect(corner[0]).toBeGreaterThan(220);
    expect(corner[2]).toBeLessThan(20);
    expect(center[2]).toBeGreaterThan(220);
    expect(center[0]).toBeLessThan(20);
    const gap = await frame(options.path, 1.5);
    expect(
      gap.reduce((maximum, value) => Math.max(maximum, value), 0),
    ).toBeLessThan(20);
    const title = await frame(options.path, 2.5);
    expect([...title].filter((value) => value > 180).length).toBeGreaterThan(
      300,
    );
  }, 60_000);

  it("maps a changing video source through trim, speed and a delayed timeline start while keeping audio pitch", async () => {
    const options = settings("timing.mp4");
    await render(
      project([
        clip(temporal, "video", {
          sourceIn: 1,
          speed: 2,
          start: 0.5,
          duration: 1,
        }),
      ]),
      options,
    );
    expect(pixel(await frame(options.path, 0.2), 80, 45)).toEqual([0, 0, 0]);
    const first = pixel(await frame(options.path, 0.6), 80, 45);
    expect(first[1]).toBeGreaterThan(100);
    expect(first[0]).toBeLessThan(20);
    expect(first[2]).toBeLessThan(20);
    const second = pixel(await frame(options.path, 1.2), 80, 45);
    expect(second[2]).toBeGreaterThan(220);
    expect(second[1]).toBeLessThan(20);
    expect(await rms(options.path, 0.1)).toBeLessThan(0.001);
    expect(await frequencyEnergy(options.path, 0.65, 880)).toBeGreaterThan(
      (await frequencyEnergy(options.path, 0.65, 1760)) * 10,
    );
    expect(await frequencyEnergy(options.path, 1.2, 1760)).toBeGreaterThan(
      (await frequencyEnergy(options.path, 1.2, 880)) * 10,
    );
  }, 60_000);

  it("exports slow motion at the chosen duration and preserves the source audio pitch", async () => {
    const options = settings("slow.mp4");
    await render(
      project([clip(temporal, "video", { speed: 0.5, duration: 3 })]),
      options,
    );
    expect(Number((await probeFile(options.path)).format.duration)).toBeCloseTo(
      3,
      1,
    );
    expect(pixel(await frame(options.path, 1.0), 80, 45)[0]).toBeGreaterThan(
      220,
    );
    expect(pixel(await frame(options.path, 2.5), 80, 45)[1]).toBeGreaterThan(
      100,
    );
    expect(await frequencyEnergy(options.path, 1.0, 440)).toBeGreaterThan(
      (await frequencyEnergy(options.path, 1.0, 880)) * 10,
    );
    expect(await frequencyEnergy(options.path, 2.5, 880)).toBeGreaterThan(
      (await frequencyEnergy(options.path, 2.5, 440)) * 10,
    );
  }, 60_000);

  it("normalizes anamorphic sample pixels to the intended display aspect ratio", async () => {
    const source = path.join(directory, "anamorphic.mp4");
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      assets[0].path,
      "-vf",
      "setsar=2",
      "-c:v",
      "libx264",
      "-an",
      source,
    ]);
    const [asset] = await importAssets([source], path.join(directory, "cache"));
    expect(asset).toMatchObject({ width: 320, height: 90 });
    const options = settings("aspect.mp4");
    const p = project([clip(asset, "video")]);
    p.assets = [asset];
    await render(p, options);
    const output = await frame(options.path, 0.5);
    expect(pixel(output, 80, 45)[0]).toBeGreaterThan(220);
    expect(pixel(output, 80, 10)).toEqual([0, 0, 0]);
    expect(
      (await probeFile(options.path)).streams.find(
        (stream) => stream.codec_type === "video",
      )?.sample_aspect_ratio,
    ).toBe("1:1");
  }, 60_000);

  it("mixes tracks additively, ignores hidden video without muting audio, and interpolates clip-local audio volume", async () => {
    const baseline = settings("mix-baseline.mp4");
    const mixed = settings("mixed.mp4");
    const animated = settings("audio-keys.mp4");
    await render(project([clip(assets[1], "audio")]), baseline);
    const hidden = project([
      clip(assets[1], "audio"),
      clip(assets[1], "video"),
    ]);
    hidden.tracks.find((t) => t.id === "video")!.hidden = true;
    await render(hidden, mixed);
    const ratio =
      (await rms(mixed.path, 0.8)) / (await rms(baseline.path, 0.8));
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
    await render(
      project([
        clip(assets[1], "audio", {
          start: 0.5,
          keyframes: [
            {
              id: "v0",
              time: 0,
              property: "volume",
              value: 0,
              easing: "linear",
            },
            {
              id: "v1",
              time: 2,
              property: "volume",
              value: 1,
              easing: "linear",
            },
          ],
        }),
      ]),
      animated,
    );
    const early =
      (await rms(animated.path, 0.9, 0.1)) /
      (await rms(baseline.path, 0.9, 0.1));
    const late =
      (await rms(animated.path, 2.0, 0.1)) /
      (await rms(baseline.path, 1.5, 0.1));
    expect(early).toBeGreaterThan(0.15);
    expect(early).toBeLessThan(0.3);
    expect(late).toBeGreaterThan(0.7);
    expect(late).toBeLessThan(0.85);
  }, 60_000);

  it("renders native image quadrants with flips, rotation and animated scale", async () => {
    const flipped = settings("flip.mp4");
    await render(
      project([
        clip(quadrants, "overlay", {
          transform: {
            ...DEFAULT_TRANSFORM,
            scale: 0.5,
            flipX: true,
            flipY: true,
          },
        }),
      ]),
      flipped,
    );
    const flipFrame = await frame(flipped.path, 0.5);
    const yellow = pixel(flipFrame, 60, 35);
    expect(yellow[0]).toBeGreaterThan(220);
    expect(yellow[1]).toBeGreaterThan(220);
    expect(yellow[2]).toBeLessThan(20);
    expect(pixel(flipFrame, 100, 55)[0]).toBeGreaterThan(220);
    const rotated = settings("rotation.mp4");
    await render(
      project([
        clip(quadrants, "overlay", {
          transform: { ...DEFAULT_TRANSFORM, scale: 0.5, rotation: 90 },
        }),
      ]),
      rotated,
    );
    const rotateFrame = await frame(rotated.path, 0.5);
    expect(pixel(rotateFrame, 90, 25)[0]).toBeGreaterThan(220);
    expect(pixel(rotateFrame, 90, 25)[2]).toBeLessThan(20);
    expect(pixel(rotateFrame, 70, 25)[2]).toBeGreaterThan(220);
    expect(pixel(rotateFrame, 45, 45)).toEqual([0, 0, 0]);
    const scaled = settings("scale-keys.mp4");
    await render(
      project([
        clip(assets[2], "overlay", {
          keyframes: [
            {
              id: "s0",
              time: 0,
              property: "scale",
              value: 0.1,
              easing: "linear",
            },
            {
              id: "s1",
              time: 2,
              property: "scale",
              value: 0.8,
              easing: "linear",
            },
          ],
        }),
      ]),
      scaled,
    );
    expect(pixel(await frame(scaled.path, 0.1), 40, 45)[2]).toBeLessThan(20);
    expect(pixel(await frame(scaled.path, 1.8), 40, 45)[2]).toBeGreaterThan(
      220,
    );
  }, 60_000);

  it("preserves a sliced easing curve in actual exported frames", async () => {
    const full = settings("easing-full.mp4");
    const sliced = settings("easing-sliced.mp4");
    const left = {
      id: "left",
      time: 0,
      property: "x" as const,
      value: -40,
      easing: "linear" as const,
    };
    const right = {
      id: "right",
      time: 2,
      property: "x" as const,
      value: 40,
      easing: "easeInOut" as const,
    };
    await render(
      project([
        clip(assets[2], "overlay", {
          transform: { ...DEFAULT_TRANSFORM, scale: 0.25 },
          keyframes: [left, right],
        }),
      ]),
      full,
    );
    await render(
      project([
        clip(assets[2], "overlay", {
          duration: 1,
          transform: { ...DEFAULT_TRANSFORM, scale: 0.25 },
          keyframes: [
            { ...left, value: 0 },
            { ...right, time: 1, easingWindow: { start: 0.5, end: 1 } },
          ],
        }),
      ]),
      sliced,
    );
    for (const t of [0.1, 0.3, 0.6]) {
      const original = await frame(full.path, t + 1);
      const after = await frame(sliced.path, t);
      let difference = 0;
      for (let i = 0; i < original.length; i++)
        difference += Math.abs(original[i] - after[i]);
      expect(difference / original.length).toBeLessThan(1);
    }
  }, 60_000);

  it("preserves the original video and audio fade envelope after splitting and trimming", async () => {
    const full = settings("fade-full.mp4");
    const split = settings("fade-split.mp4");
    const trimmed = settings("fade-trimmed.mp4");
    const visual = clip(assets[2], "overlay", { fadeIn: 1.5, fadeOut: 1.5 });
    const audio = clip(assets[1], "audio", {
      audioFadeIn: 1.5,
      audioFadeOut: 1.5,
    });
    const original = project([visual, audio]);
    await render(original, full);
    await render(
      splitClip(splitClip(original, visual.id, 0.5), audio.id, 0.5),
      split,
    );
    let cropped = trimClip(
      trimClip(original, visual.id, "start", 0.5),
      audio.id,
      "start",
      0.5,
    );
    cropped = {
      ...cropped,
      clips: cropped.clips.map((clip) => ({ ...clip, start: 0 })),
    };
    await render(cropped, trimmed);
    for (const t of [0.1, 0.3, 0.6, 0.9]) {
      const before = pixel(await frame(full.path, t + 0.5), 80, 45)[2];
      expect(
        Math.abs(pixel(await frame(split.path, t + 0.5), 80, 45)[2] - before),
      ).toBeLessThan(5);
      expect(
        Math.abs(pixel(await frame(trimmed.path, t), 80, 45)[2] - before),
      ).toBeLessThan(5);
      const baseline = await rms(full.path, t + 0.5, 0.08);
      expect((await rms(split.path, t + 0.5, 0.08)) / baseline).toBeCloseTo(
        1,
        1,
      );
      expect((await rms(trimmed.path, t, 0.08)) / baseline).toBeCloseTo(1, 1);
    }
  }, 60_000);

  it("keeps extended fade windows silent and transparent outside the original fade envelope", async () => {
    const options = settings("fade-extension.mp4");
    const window = { offset: -0.5, duration: 2, fadeIn: 0.5, fadeOut: 0.5 };
    await render(
      project([
        clip(assets[2], "overlay", { duration: 3, videoFadeWindow: window }),
        clip(assets[1], "audio", { duration: 3, audioFadeWindow: window }),
      ]),
      options,
    );
    expect(pixel(await frame(options.path, 0.2), 80, 45)[2]).toBeLessThan(5);
    expect(pixel(await frame(options.path, 1.5), 80, 45)[2]).toBeGreaterThan(
      220,
    );
    expect(pixel(await frame(options.path, 2.8), 80, 45)[2]).toBeLessThan(5);
    expect(await rms(options.path, 0.1)).toBeLessThan(0.001);
    expect(await rms(options.path, 1.5)).toBeGreaterThan(0.05);
    expect(await rms(options.path, 2.8)).toBeLessThan(0.001);
  }, 60_000);

  it("preserves source audio volume, fades and mute without normalizing volume away", async () => {
    const loud = settings("loud.mp4");
    const quiet = settings("quiet.mp4");
    await render(project([clip(assets[1], "audio")]), loud);
    await render(
      project([
        clip(assets[1], "audio", {
          volume: 0.2,
          audioFadeIn: 0.5,
          audioFadeOut: 0.5,
        }),
      ]),
      quiet,
    );
    const ratio = (await rms(quiet.path, 0.8)) / (await rms(loud.path, 0.8));
    expect(ratio).toBeGreaterThan(0.15);
    expect(ratio).toBeLessThan(0.25);
    expect(await rms(quiet.path, 0.01, 0.08)).toBeLessThan(
      (await rms(quiet.path, 0.8)) * 0.4,
    );
    expect(await rms(quiet.path, 1.9, 0.08)).toBeLessThan(
      (await rms(quiet.path, 0.8)) * 0.4,
    );
    const muted = settings("muted.mov", { format: "mov" });
    await render(project([clip(assets[0], "video", { muted: true })]), muted);
    expect(
      (await probeFile(muted.path)).streams.some(
        (s) => s.codec_type === "audio",
      ),
    ).toBe(false);
  }, 60_000);

  it("applies color adjustment, opacity animation, position and video fading to rendered pixels", async () => {
    const animated = settings("animated.mp4");
    await render(
      project([
        clip(assets[2], "overlay", {
          transform: { ...DEFAULT_TRANSFORM, scale: 0.4 },
          fadeIn: 0.4,
          fadeOut: 0.4,
          keyframes: [
            { id: "a", time: 0, property: "x", value: -40, easing: "linear" },
            { id: "b", time: 2, property: "x", value: 40, easing: "easeInOut" },
            {
              id: "c",
              time: 0,
              property: "opacity",
              value: 1,
              easing: "linear",
            },
            {
              id: "d",
              time: 2,
              property: "opacity",
              value: 0.5,
              easing: "linear",
            },
          ],
        }),
      ]),
      animated,
    );
    expect(pixel(await frame(animated.path, 0), 40, 45)[2]).toBeLessThan(30);
    expect(pixel(await frame(animated.path, 0.5), 46, 45)[2]).toBeGreaterThan(
      180,
    );
    expect(pixel(await frame(animated.path, 1.5), 114, 45)[2]).toBeGreaterThan(
      110,
    );
    expect(pixel(await frame(animated.path, 1.9), 119, 45)[2]).toBeLessThan(90);
    const desaturated = settings("grayscale.mp4");
    await render(
      project([
        clip(assets[0], "video", {
          adjustments: { ...DEFAULT_ADJUSTMENTS, saturation: 0 },
          muted: true,
        }),
      ]),
      desaturated,
    );
    const rgb = pixel(await frame(desaturated.path, 0.5), 80, 45);
    expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThan(8);
  }, 60_000);

  it("matches preview RGB adjustment stages and straight alpha in real FFmpeg output", async () => {
    const input = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128, 72, 140, 210, 64, 255,
      255, 255, 0, 127, 128, 129, 255, 16, 38, 220, 255, 230, 190, 32, 255,
    ]);
    const raw = path.join(directory, "color-chart.rgba");
    await writeFile(raw, input);
    for (const adjustments of [
      { ...DEFAULT_ADJUSTMENTS, brightness: 0.2 },
      { ...DEFAULT_ADJUSTMENTS, brightness: -0.4, contrast: 2.2 },
      { ...DEFAULT_ADJUSTMENTS, saturation: 0 },
      { ...DEFAULT_ADJUSTMENTS, saturation: 3 },
      { ...DEFAULT_ADJUSTMENTS, temperature: -0.4 },
      {
        ...DEFAULT_ADJUSTMENTS,
        brightness: 0.08,
        contrast: 1.3,
        saturation: 0.6,
        temperature: 0.7,
      },
    ]) {
      const expected = new Uint8ClampedArray(input);
      applyColorAdjustments(expected, adjustments);
      const output = await runMediaTool("ffmpeg", [
        "-v",
        "error",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        "8x1",
        "-i",
        raw,
        "-vf",
        colorAdjustmentFilters(adjustments).join(","),
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "pipe:1",
      ]);
      for (let index = 0; index < expected.length; index++) {
        if (index % 4 === 3) expect(output[index]).toBe(expected[index]);
        else
          expect(Math.abs(output[index] - expected[index])).toBeLessThanOrEqual(
            1,
          );
      }
    }
    const adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      brightness: 0.08,
      contrast: 1.3,
      saturation: 0.6,
      temperature: 0.7,
    };
    const options = settings("matching-color.mp4", { quality: "high" });
    await render(
      project([clip(quadrants, "overlay", { adjustments })]),
      options,
    );
    const output = await frame(options.path, 0.5);
    for (const [position, color] of [
      [
        [40, 25],
        [255, 0, 0],
      ],
      [
        [120, 25],
        [0, 255, 0],
      ],
      [
        [40, 65],
        [0, 0, 255],
      ],
      [
        [120, 65],
        [255, 255, 0],
      ],
    ] as const) {
      const expected = new Uint8ClampedArray([...color, 255]);
      applyColorAdjustments(expected, adjustments);
      const rgb = pixel(output, position[0], position[1]);
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(rgb[channel] - expected[channel])).toBeLessThan(5);
    }
  }, 60_000);

  it("retains every source alpha byte through the high-saturation native 16-bit path", async () => {
    const data = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++)
      data.set([(i * 17) % 256, (i * 47) % 256, (i * 91) % 256, i], i * 4);
    const raw = path.join(directory, "all-alpha.rgba");
    await writeFile(raw, data);
    const adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      saturation: 3,
      temperature: 0.3,
      brightness: 0.03,
      contrast: 1.2,
    };
    const expected = new Uint8ClampedArray(data);
    applyColorAdjustments(expected, adjustments);
    const output = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgba",
      "-video_size",
      "256x1",
      "-i",
      raw,
      "-vf",
      colorAdjustmentFilters(adjustments).join(","),
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "pipe:1",
    ]);
    for (let i = 0; i < output.length; i++) {
      if (i % 4 === 3) expect(output[i]).toBe(expected[i]);
      else expect(Math.abs(output[i] - expected[i])).toBeLessThanOrEqual(1);
    }
  });

  it("refuses invalid source ranges and protects an existing export when cancelled", async () => {
    await expect(
      startExport(
        project([clip(assets[0], "video", { duration: 10 })]),
        settings("invalid.mp4"),
        () => {},
      ),
    ).rejects.toThrow("超出源素材时长");
    await expect(
      startExport(
        project([clip(assets[0], "video")]),
        settings("unused.mp4", { path: assets[0].path }),
        () => {},
      ),
    ).rejects.toThrow("不能覆盖");
    if (process.platform !== "win32") {
      const aliasPath = path.join(directory, "source-alias.mp4");
      await symlink(assets[0].path, aliasPath);
      const alias = { ...assets[0], path: aliasPath };
      const aliasedProject = project([clip(alias, "video")]);
      aliasedProject.assets = [alias];
      await expect(
        startExport(
          aliasedProject,
          settings("unused.mp4", { path: assets[0].path }),
          () => {},
        ),
      ).rejects.toThrow("不能覆盖");
    }
    const options = settings("existing.mp4");
    await writeFile(options.path, "original output");
    const completed = new Promise<ExportProgress>(async (resolve, reject) => {
      try {
        const { jobId } = await startExport(
          project([clip(assets[2], "overlay", { duration: 20 })]),
          options,
          (event) => {
            if (["cancelled", "error", "complete"].includes(event.status))
              resolve(event);
          },
        );
        await cancelExport(jobId);
      } catch (error) {
        reject(error);
      }
    });
    expect((await completed).status).toBe("cancelled");
    expect((await readFile(options.path)).toString()).toBe("original output");
    await expect(access(path.join(directory, "invalid.mp4"))).rejects.toThrow();
  }, 60_000);

  it("reports asynchronous preparation errors and cancels a running FFmpeg child without replacing an existing file", async () => {
    const brokenAsset = {
      ...assets[0],
      path: path.join(directory, "missing.mp4"),
    };
    const broken = project([clip(brokenAsset, "video")]);
    broken.assets = [brokenAsset];
    const errored = await new Promise<ExportProgress>((resolve, reject) => {
      void startExport(broken, settings("broken.mp4"), (event) => {
        if (event.status === "error") resolve(event);
      }).catch(reject);
    });
    expect(errored.status).toBe("error");
    expect(errored.message).toContain("ENOENT");
    const options = settings("running-cancel.mp4", {
      width: 640,
      height: 360,
      fps: 30,
      quality: "high",
    });
    await writeFile(options.path, "keep existing");
    let renderingUpdates = 0;
    const cancelled = await new Promise<ExportProgress>((resolve, reject) => {
      void startExport(
        project([clip(assets[2], "overlay", { duration: 60 })]),
        options,
        (event) => {
          if (event.status === "rendering" && ++renderingUpdates === 2)
            void cancelExport(event.jobId);
          if (["cancelled", "error", "complete"].includes(event.status))
            resolve(event);
        },
      ).catch(reject);
    });
    expect(renderingUpdates).toBeGreaterThanOrEqual(2);
    expect(cancelled.status).toBe("cancelled");
    expect((await readFile(options.path)).toString()).toBe("keep existing");
    await cancelAllExports();
    expect(
      (await readdir(directory)).filter((file) => file.startsWith(".reacut-")),
    ).toEqual([]);
  }, 60_000);
});
