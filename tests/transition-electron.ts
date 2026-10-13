/** Real UI dissolve on clips with pre-existing cut fade envelopes, including exported pixel evidence. */
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { importAssets, probeFile, runMediaTool } from "../electron/media";
import { createClip, createProject, createTrack } from "../src/core/model";
import type { Project } from "../src/core/types";

const root = process.cwd();
const output = path.join(root, ".test-output", "transition-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const sources = await Promise.all(
  ["red", "blue"].map(async (color, index) => {
    const file = path.join(output, `${color}.mp4`);
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=320x180:r=24:d=1`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${index ? 880 : 440}:sample_rate=48000:duration=1`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
    return file;
  }),
);
const assets = await importAssets(sources, path.join(output, "cache"));
const project = createProject("已有淡出的叠化验收");
project.width = 320;
project.height = 180;
project.fps = 24;
const track = createTrack("video", "连续画面");
const front = createClip(assets[0], track.id, 0, project.fps);
const next = createClip(assets[1], track.id, 1, project.fps);
front.duration = 1;
next.duration = 1;
front.fadeIn = 0.2;
front.fadeOut = 0.4;
// A previously trimmed fade has its original curve/window; dissolve must retain its incoming curve only.
front.videoFadeWindow = {
  offset: 0.1,
  duration: 1.1,
  fadeIn: 0.2,
  fadeOut: 0.5,
};
front.audioFadeIn = 0.2;
front.audioFadeOut = 0.4;
front.audioFadeWindow = {
  offset: 0.1,
  duration: 1.1,
  fadeIn: 0.2,
  fadeOut: 0.4,
};
next.videoFadeWindow = { offset: 0.2, duration: 1.2, fadeIn: 0.3, fadeOut: 0 };
next.audioFadeWindow = { offset: 0.2, duration: 1.2, fadeIn: 0.3, fadeOut: 0 };
project.assets = assets;
project.tracks = [track];
project.clips = [front, next];
const original = path.join(output, "before.reacut");
const saved = path.join(output, "dissolve.reacut");
const exported = path.join(output, "dissolve.mp4");
await writeFile(original, JSON.stringify(project));
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
env.REACUT_USER_DATA = path.join(output, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({
  args: [path.join(root, "dist-electron", "main.cjs"), original],
  env,
  timeout: 30_000,
});
const page = await app.firstWindow();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await app.evaluate(
    ({ dialog }, files) => {
      (dialog as any).showSaveDialog = async (...args: any[]) => ({
        canceled: false,
        filePath:
          args[args.length - 1].title === "导出视频"
            ? files.exported
            : files.saved,
      });
      (dialog as any).showMessageBox = async () => ({
        response: 2,
        checkboxChecked: false,
      });
    },
    { saved, exported },
  );
  await expect(page.locator(".tl-clip")).toHaveCount(2);
  await page
    .locator(`[data-clip-id="${front.id}"]`)
    .click({ position: { x: 25, y: 25 } });
  await page.getByRole("button", { name: "转场", exact: true }).click();
  await page.getByRole("button", {name:"应用叠化转场",exact:true}).click();
  await expect(
    page.getByText("已添加 0.50 秒叠化（后片段提前重叠）", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "文件菜单", exact: true }).click();
  await page.getByRole("button", { name: "另存为", exact: false }).click();
  await expect
    .poll(async () =>
      readFile(saved, "utf8")
        .then((text) => JSON.parse(text).clips[1].start)
        .catch(() => -1),
    )
    .toBe(0.5);
  const result: Project = JSON.parse(await readFile(saved, "utf8"));
  const changedFront = result.clips.find((clip) => clip.id === front.id)!;
  const changedNext = result.clips.find((clip) => clip.id === next.id)!;
  assert.equal(changedFront.fadeOut, 0);
  assert.deepEqual(changedFront.videoFadeWindow, {
    ...front.videoFadeWindow,
    fadeOut: 0,
  });
  assert.equal(changedFront.fadeIn, 0.2);
  assert.equal(changedFront.audioFadeOut, 0.5);
  assert.equal(changedFront.audioFadeWindow, undefined);
  assert.equal(changedNext.start, 0.5);
  assert.equal(changedNext.duration, 1);
  assert.equal(changedNext.fadeIn, 0.5);
  assert.equal(changedNext.audioFadeIn, 0.5);
  assert.equal(changedNext.videoFadeWindow, undefined);
  assert.equal(changedNext.audioFadeWindow, undefined);

  await page.locator(".player-panel .panel-heading").click();
  await page.keyboard.press("Home");
  for (let frame = 0; frame < 18; frame++)
    await page.keyboard.press("ArrowRight");
  await expect(page.locator(".timecode strong")).toHaveText("00:00:00:18");
  const pixel = () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".player-panel canvas")!;
      return Array.from(
        canvas
          .getContext("2d")!
          .getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
          ).data,
      );
    });
  const isHalfDissolve = (rgba: number[]) =>
    rgba[0] > 115 &&
    rgba[0] < 140 &&
    rgba[1] < 8 &&
    rgba[2] > 115 &&
    rgba[2] < 140 &&
    rgba[0] + rgba[2] > 235;
  await expect
    .poll(async () => isHalfDissolve(await pixel()), { timeout: 15_000 })
    .toBe(true);
  const previewPixel = await pixel();
  await page.screenshot({ path: path.join(output, "preview-midpoint.png") });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByText("导出完成", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const probe = await probeFile(exported);
  assert.equal(Number(probe.format.duration), 1.5);
  assert(probe.streams.some((stream) => stream.codec_type === "audio"));
  const raw = await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "0.75",
    "-i",
    exported,
    "-frames:v",
    "1",
    "-vf",
    "format=rgba",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  const centerIndex = (90 * 320 + 160) * 4;
  const exportPixel = Array.from(raw.subarray(centerIndex, centerIndex + 4));
  assert(
    isHalfDissolve(exportPixel),
    `native exported midpoint must have full red/blue complementary brightness: ${exportPixel}`,
  );
  assert(
    previewPixel.every(
      (value, index) => Math.abs(value - exportPixel[index]) <= 5,
    ),
    `preview and native export pixels must agree: ${previewPixel} vs ${exportPixel}`,
  );
  // Both real source tones have complementary .5 gain near this midpoint; a doubled original would exceed this RMS.
  const pcm = await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "0.73",
    "-i",
    exported,
    "-t",
    "0.04",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  let power = 0;
  for (let i = 0; i < pcm.length; i += 4) power += pcm.readFloatLE(i) ** 2;
  const audioRms = Math.sqrt(power / (pcm.length / 4));
  assert(
    audioRms > 0.045 && audioRms < 0.08,
    `audio dissolve must crossfade both tones once: RMS ${audioRms}`,
  );
  assert.deepEqual(errors, []);
  const evidence = {
    passedAt: new Date().toISOString(),
    checks: [
      "UI applies same-track dissolve",
      "old outgoing video envelope cleared, incoming window retained",
      "audio windows reset to complementary fades",
      "next clip overlaps by .5s",
      "midpoint preview has complementary .5/.5 brightness",
      "actual UI export pixels match preview",
      "actual output audio crossfade is audible without duplication",
    ],
    previewPixel,
    exportPixel,
    audioRms,
    saved,
    exported,
    errors,
  };
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Desktop transition checks passed:", JSON.stringify(evidence));
} catch (error) {
  await page
    .screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  console.error("Renderer errors:", errors);
  console.error((await page.locator("body").innerText()).slice(-5000));
  throw error;
} finally {
  await app.close();
}
