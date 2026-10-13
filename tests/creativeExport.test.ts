/** Render the actual FFmpeg graph; compare transition geometry and animated output pixels. */
import { beforeAll, afterAll, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProject, createClip } from "../src/core/model";
import {
  applyTransition,
  motionPatch,
  TRANSITION_PRESETS,
  MOTION_PRESETS,
} from "../src/core/creativePresets";
import { createExportArguments } from "../electron/export";
import { importAssets, runMediaTool } from "../electron/media";
import type { MediaAsset, Project } from "../src/core/types";
let dir: string, assets: MediaAsset[];
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reacut-recipes-"));
  const files = [];
  for (const [index, color] of ["#ff0000", "#0000ff"].entries()) {
    const c = createCanvas(160, 90),
      x = c.getContext("2d");
    x.fillStyle = color;
    x.fillRect(0, 0, 160, 90);
    const file = path.join(dir, `${index}.png`);
    await writeFile(file, c.toBuffer("image/png"));
    files.push(file);
  }
  assets = await importAssets(files, path.join(dir, "cache"));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
function project() {
  const p = createProject();
  p.width = 160;
  p.height = 90;
  p.fps = 20;
  p.background = "#000000";
  p.assets = assets;
  p.clips = assets.map((a, i) => ({
    ...createClip(a, p.tracks[1].id, i, 20),
    duration: 1,
  }));
  return p;
}
async function frame(p: Project, time: number) {
  const output = path.join(dir, "out.mp4");
  const args = await createExportArguments(
    p,
    {
      path: output,
      width: 160,
      height: 90,
      fps: 20,
      quality: "high",
      format: "mp4",
    },
    dir,
    output,
  );
  const i = args.indexOf("-filter_complex");
  return runMediaTool("ffmpeg", [
    ...args.slice(0, i),
    "-filter_complex",
    args[i + 1],
    "-map",
    "[vout]",
    "-ss",
    String(time),
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ]);
}
const pixel = (b: Buffer, x: number, y: number) => [
  ...b.subarray((y * 160 + x) * 3, (y * 160 + x) * 3 + 3),
];
it.each(TRANSITION_PRESETS)(
  "exports $name with the expected before/after images",
  async (recipe) => {
    const p = project(),
      r = applyTransition(p, p.clips[0].id, recipe.id, 0.4).project;
    const before = await frame(r, 0.1),
      after = await frame(r, 1.5);
    expect(pixel(before, 80, 45)[0]).toBeGreaterThan(240);
    expect(pixel(after, 80, 45)[2]).toBeGreaterThan(240);
    const middle = await frame(r, recipe.id === "dip" ? 1 : 0.8);
    if (recipe.id === "dissolve") {
      const c = pixel(middle, 80, 45);
      expect(c[0]).toBeGreaterThan(90);
      expect(c[2]).toBeGreaterThan(90);
      expect(c[0] + c[2]).toBeGreaterThan(240);
    }
    if (recipe.id === "dip")
      expect(Math.max(...pixel(middle, 80, 45))).toBeLessThan(15);
    if (recipe.id === "slide-left") {
      expect(pixel(middle, 20, 45)[0]).toBeGreaterThan(230);
      expect(pixel(middle, 140, 45)[2]).toBeGreaterThan(230);
    }
    if (recipe.id === "slide-right") {
      expect(pixel(middle, 20, 45)[2]).toBeGreaterThan(230);
      expect(pixel(middle, 140, 45)[0]).toBeGreaterThan(230);
    }
    if (recipe.id === "slide-up") {
      expect(pixel(middle, 80, 10)[0]).toBeGreaterThan(230);
      expect(pixel(middle, 80, 80)[2]).toBeGreaterThan(230);
    }
    if (recipe.id === "slide-down") {
      expect(pixel(middle, 80, 10)[2]).toBeGreaterThan(230);
      expect(pixel(middle, 80, 80)[0]).toBeGreaterThan(230);
    }
    if (recipe.id === "zoom" || recipe.id === "spin") {
      expect(pixel(middle, 2, 2)[0]).toBeGreaterThan(230);
      expect(pixel(middle, 80, 45)[2]).toBeGreaterThan(60);
    }
  },
);
it.each(MOTION_PRESETS)("exports changing frames for $name", async (recipe) => {
  const p = project();
  p.clips = p.clips.slice(0, 1);
  p.clips[0].transform.scale = 0.65;
  p.clips[0] = { ...p.clips[0], ...motionPatch(p.clips[0], recipe.id, p) };
  const first = await frame(p, 0),
    middle = await frame(p, 0.25);
  expect(first.length).toBe(160 * 90 * 3);
  expect(middle.equals(first)).toBe(false);
});
