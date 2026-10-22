import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createClip,
  createProject,
  evaluateKeyframes,
  trimClip,
} from "../src/core/model";
import { importAssets, runMediaTool } from "../electron/media";
import { startExport } from "../electron/export";
import type { Keyframe, MediaAsset } from "../src/core/types";
let dir: string, assets: MediaAsset[];
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reacut-keyframe-export-"));
  const video = path.join(dir, "white.mp4");
  await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=white:s=64x64:r=30:d=3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    video,
  ]);
  assets = await importAssets([video], path.join(dir, "cache"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
it.each(["easeIn", "easeOut"] as const)(
  "exports trimmed %s opacity and audio curves with original phase",
  async (easing) => {
    let p = createProject();
    p.width = p.height = 64;
    p.background = "#000000";
    p.assets = assets;
    const c = createClip(assets[0], p.tracks[1].id, 0, 30);
    c.duration = 3;
    c.keyframes = (["opacity", "volume"] as const).flatMap(
      (property) =>
        [
          {
            id: property + "0",
            property,
            time: 0,
            value: 0.1,
            easing: "linear" as const,
          },
          { id: property + "1", property, time: 3, value: 0.9, easing },
        ] as Keyframe[],
    );
    p.clips = [c];
    p = trimClip(p, c.id, "start", 0.5);
    p = trimClip(p, c.id, "end", 2.5);
    const trimmed = p.clips[0];
    const output = path.join(dir, easing + ".mp4");
    await new Promise<void>((resolve, reject) => {
      void startExport(
        p,
        {
          path: output,
          width: 64,
          height: 64,
          fps: 30,
          quality: "high",
          format: "mp4",
          range: { start: 0.5, end: 2.5 },
        },
        (e) => {
          if (e.status === "complete") resolve();
          if (e.status === "error" || e.status === "cancelled")
            reject(new Error(e.message));
        },
      ).catch(reject);
    });
    const raw = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    expect(raw.length).toBe(60 * 64 * 64 * 3);
    for (let frame = 0; frame < 60; frame++) {
      const value = raw[(frame * 64 * 64 + 32 * 64 + 32) * 3];
      expect(
        Math.abs(
          value -
            evaluateKeyframes(trimmed, frame / 30).transform.opacity * 255,
        ),
      ).toBeLessThan(6);
    }
    const pcm = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-vn",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-f",
      "f32le",
      "pipe:1",
    ]);
    for (const time of [0.25, 0.75, 1.25, 1.75]) {
      let energy = 0;
      for (
        let i = Math.round(time * 48000);
        i < Math.round((time + 0.1) * 48000);
        i++
      )
        energy += pcm.readFloatLE(i * 4) ** 2;
      const rms = Math.sqrt(energy / 4800),
        expected = 0.0884 * evaluateKeyframes(trimmed, time + 0.05).volume;
      expect(Math.abs(rms - expected)).toBeLessThan(0.005);
    }
  },
);

it.each([false, true])(
  "renders combined scale/opacity after crop=%s without dynamic-size alpha filter failures",
  async (cropped) => {
    const p = createProject();
    p.width = p.height = 64;
    p.background = "#000000";
    p.assets = assets;
    const c = createClip(assets[0], p.tracks[1].id, 0, 30);
    c.duration = 2;
    c.muted = true;
    if (cropped) c.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    c.keyframes = [
      { id: "s0", property: "scale", time: 0, value: 0.25, easing: "linear" },
      { id: "s1", property: "scale", time: 2, value: 0.75, easing: "easeOut" },
      { id: "o0", property: "opacity", time: 0, value: 0.2, easing: "linear" },
      {
        id: "o1",
        property: "opacity",
        time: 2,
        value: 0.9,
        easing: "easeInOut",
      },
    ];
    p.clips = [c];
    const output = path.join(dir, "combined.mp4");
    await new Promise<void>((resolve, reject) => {
      void startExport(
        p,
        {
          path: output,
          width: 64,
          height: 64,
          fps: 30,
          quality: "high",
          format: "mp4",
        },
        (e) => {
          if (e.status === "complete") resolve();
          if (e.status === "error" || e.status === "cancelled")
            reject(new Error(e.message));
        },
      ).catch(reject);
    });
    const raw = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    expect(raw.length).toBe(60 * 64 * 64 * 3);
    for (let frame = 0; frame < 60; frame++) {
      const tr = evaluateKeyframes(c, frame / 30).transform,
        center = raw[(frame * 64 * 64 + 32 * 64 + 32) * 3];
      expect(Math.abs(center - 255 * tr.opacity)).toBeLessThan(6);
      let span = 0;
      for (let x = 0; x < 64; x++)
        if (raw[(frame * 64 * 64 + 32 * 64 + x) * 3] > center / 2) span++;
      expect(Math.abs(span - 64 * tr.scale)).toBeLessThan(3);
    }
  },
);
