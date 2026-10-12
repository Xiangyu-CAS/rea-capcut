import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createClip, createProject } from "../src/core/model";
import {
  applyChromaKey,
  applyShapeMask,
  getCropPixels,
} from "../src/core/visual";
import { createExportArguments } from "../electron/export";
import { importAssets, runMediaTool } from "../electron/media";
import type { Clip, MediaAsset, ShapeMask } from "../src/core/types";
import { DEFAULT_ADJUSTMENTS } from "../src/core/defaults";

let directory: string;
let asset: MediaAsset;
let source: Uint8ClampedArray;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "reacut-visual-"));
  const canvas = createCanvas(32, 32);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const rgba =
        y < 16
          ? x >= 4 && x < 8
            ? [30, 230, 30, 128]
            : x < 16
              ? [0, 255, 0, 255]
              : [255, 0, 0, 128]
          : x < 16
            ? [0, 0, 255, 64]
            : [255, 255, 255, 255];
      pixels.data.set(rgba, (y * 32 + x) * 4);
    }
  source = new Uint8ClampedArray(pixels.data);
  context.putImageData(pixels, 0, 0);
  const file = path.join(directory, "alpha-chart.png");
  await writeFile(file, canvas.toBuffer("image/png"));
  [asset] = await importAssets([file], path.join(directory, "cache"));
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function nativeFrame(
  overrides: Partial<Clip>,
  media = asset,
): Promise<Buffer> {
  const project = createProject("visual-alpha-test");
  project.width = 32;
  project.height = 32;
  project.fps = 10;
  project.background = "#804080";
  project.assets = [media];
  project.clips = [
    {
      ...createClip(media, project.tracks[1].id, 0, 10),
      duration: 1,
      ...overrides,
    },
  ];
  const args = await createExportArguments(
    project,
    {
      path: path.join(directory, "out.mp4"),
      width: 32,
      height: 32,
      fps: 10,
      quality: "high",
      format: "mp4",
    },
    directory,
    path.join(directory, "out.mp4"),
  );
  const index = args.indexOf("-filter_complex");
  // Execute the actual export filter graph with uncompressed output to isolate rendering from H264 quantization.
  const graph = args[index + 1].replace(
    "format=yuv420p[vout]",
    "format=rgba[vout]",
  );
  return runMediaTool("ffmpeg", [
    ...args.slice(0, index),
    "-filter_complex",
    graph,
    "-map",
    "[vout]",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "pipe:1",
  ]);
}

function compositeExpected(data: Uint8ClampedArray): Uint8ClampedArray {
  const background = [128, 64, 128];
  const result = new Uint8ClampedArray(data.length);
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel++)
      result[index + channel] = Math.round(
        (data[index + channel] * data[index + 3]) / 255 +
          background[channel] * (1 - data[index + 3] / 255),
      );
    result[index + 3] = 255;
  }
  return result;
}

describe("real crop / chroma / mask composition", () => {
  it("preserves existing source alpha while keying the selected RGB color", async () => {
    const chromaKey = {
      enabled: true,
      color: "#00ff00",
      similarity: 0.1,
      blend: 0.2,
    };
    const expected = new Uint8ClampedArray(source);
    applyChromaKey(expected, chromaKey);
    const composed = compositeExpected(expected);
    const actual = await nativeFrame({ chromaKey });
    for (let index = 0; index < actual.length; index++)
      expect(Math.abs(actual[index] - composed[index])).toBeLessThanOrEqual(1);
  });

  it.each<ShapeMask>([
    {
      shape: "rectangle",
      width: 0.75,
      height: 0.5,
      feather: 0.15,
      invert: false,
    },
    { shape: "ellipse", width: 0.75, height: 0.8, feather: 0.2, invert: false },
    { shape: "ellipse", width: 0.5, height: 0.75, feather: 0, invert: true },
  ])(
    "matches static mask edges, feather and inversion ($shape, invert=$invert)",
    async (mask) => {
      const chromaKey = {
        enabled: true,
        color: "#00ff00",
        similarity: 0.1,
        blend: 0.2,
      };
      const expected = new Uint8ClampedArray(source);
      applyChromaKey(expected, chromaKey);
      applyShapeMask(expected, 32, 32, mask);
      const composed = compositeExpected(expected);
      const actual = await nativeFrame({ chromaKey, mask });
      for (let index = 0; index < actual.length; index++)
        expect(Math.abs(actual[index] - composed[index])).toBeLessThanOrEqual(
          1,
        );
    },
  );

  it("quantizes crop rectangles and contains the resulting aspect ratio", async () => {
    expect(getCropPixels({ width: 32, height: 32 })).toEqual({
      x: 0,
      y: 0,
      width: 32,
      height: 32,
    });
    expect(
      getCropPixels(
        { width: 32, height: 32 },
        { x: 0.25, y: 0, width: 0.5, height: 1 },
      ),
    ).toEqual({ x: 8, y: 0, width: 16, height: 32 });
    const actual = await nativeFrame({
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
    });
    const rgb = (x: number, y: number) => [
      ...actual.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3),
    ];
    expect(rgb(2, 8)).toEqual([128, 64, 128]);
    expect(rgb(30, 8)).toEqual([128, 64, 128]);
    expect(rgb(10, 8)).toEqual([0, 255, 0]);
    const red = rgb(20, 8);
    expect(red[0]).toBeGreaterThan(188);
    expect(red[1]).toBeLessThan(35);
    expect(red[2]).toBeLessThan(68);
    expect(
      getCropPixels(
        { width: 32, height: 32 },
        { x: 0.999, y: 0.999, width: 0.001, height: 0.001 },
      ),
    ).toEqual({ x: 31, y: 31, width: 1, height: 1 });
  });

  it("blurs keyed transparent edges without leaking the hidden green RGB into the background", async () => {
    const actual = await nativeFrame({
      chromaKey: {
        enabled: true,
        color: "#00ff00",
        similarity: 0.15,
        blend: 0,
      },
      adjustments: { ...DEFAULT_ADJUSTMENTS, blur: 2 },
    });
    const rgb = (x: number, y: number) => [
      ...actual.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3),
    ];
    const background = rgb(2, 6);
    expect(background).toEqual([128, 64, 128]);
    const edge = rgb(14, 6);
    expect(edge[0]).toBeGreaterThan(128);
    expect(edge[1]).toBeLessThanOrEqual(65);
    expect(edge[2]).toBeLessThanOrEqual(128);
    const visible = rgb(23, 6);
    expect(visible[0]).toBeGreaterThan(185);
    expect(visible[1]).toBeLessThan(35);
  });

  it("normalizes sample aspect ratio before quantizing a source crop", async () => {
    const file = path.join(directory, "sar-crop.mp4");
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-loop",
      "1",
      "-i",
      asset.path,
      "-vf",
      "setsar=2",
      "-t",
      "1",
      "-r",
      "10",
      "-c:v",
      "libx264",
      "-crf",
      "0",
      "-pix_fmt",
      "yuv420p",
      file,
    ]);
    const [media] = await importAssets([file], path.join(directory, "cache"));
    expect(media).toMatchObject({ width: 64, height: 32 });
    const output = await nativeFrame(
      { crop: { x: 0.5, y: 0, width: 0.5, height: 1 } },
      media,
    );
    const rgb = (x: number, y: number) => [
      ...output.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3),
    ];
    // The right half of a 2:1 display source is square; it fills the square output without letterboxing.
    expect(rgb(2, 6)[0]).toBeGreaterThan(245);
    expect(rgb(29, 6)[0]).toBeGreaterThan(245);
    expect(rgb(16, 25).every((value) => value > 245)).toBe(true);
  });
});
