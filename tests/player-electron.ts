import { _electron as electron, expect } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { generateFixtures } from "../scripts/generate-fixtures";
import { createProject, createClip, createTrack } from "../src/core/model";
import { importAssets } from "../electron/media";
import type { Project } from "../src/core/types";

const root = process.cwd(),
  output = path.join(root, ".test-output", "player-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const fixtures = await generateFixtures(path.join(output, "media"));
const asset = (
  await importAssets([fixtures.video], path.join(output, "cache"))
)[0];
const project = createProject("播放器交互验收");
project.width = 320;
project.height = 180;
const track = createTrack("video", "视频轨道");
const clip = createClip(asset, track.id, 0, project.fps);
clip.duration = 3;
clip.keyframes = [
  { id: "x-first", property: "x", time: 0, value: 0, easing: "linear" },
  { id: "x-last", property: "x", time: 3, value: 0, easing: "linear" },
];
project.assets = [asset];
project.tracks = [track];
project.clips = [clip];
const saved = path.join(output, "player.reacut");
await writeFile(saved, JSON.stringify(project));
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
env.REACUT_USER_DATA = path.join(output, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({
  args: [path.join(root, "dist-electron", "main.cjs"), saved],
  env,
  timeout: 30000,
});
const errors: string[] = [];
const page = await app.firstWindow();
page.on("pageerror", (e) => errors.push(e.message));
try {
  await app.evaluate(({ dialog }, file) => {
    (dialog as any).showSaveDialog = async () => ({
      canceled: false,
      filePath: file,
    });
    (dialog as any).showMessageBox = async () => ({ response: 2 });
  }, saved);
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  await page.locator(".tl-clip").click();
  const pixel = () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(".player-panel canvas")!;
      return [
        ...c.getContext("2d")!.getImageData(2, Math.floor(c.height / 2), 1, 1)
          .data,
      ];
    });
  await expect
    .poll(
      async () => {
        const p = await pixel();
        return p[0] > 180 && p[1] < 70 && p[2] < 70;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const box = (await page.locator(".player-panel canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, {
    steps: 5,
  });
  // The canvas moves while the pointer is still held, before any project commit.
  await expect
    .poll(async () => {
      const p = await pixel();
      return p[0] < 40 && p[1] < 40 && p[2] < 40;
    })
    .toBe(true);
  await page.mouse.up();
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(page.locator(".save-dot")).not.toHaveClass(/dirty/);
  let savedProject: Project = JSON.parse(await readFile(saved, "utf8"));
  const moved = savedProject.clips[0],
    delta = (50 * 320) / box.width;
  assert(Math.abs(moved.transform.x - delta) < 0.1);
  assert(
    moved.keyframes.every((k) => Math.abs(k.value - delta) < 0.1),
    "Dragging must shift the complete keyframed path",
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect
    .poll(async () => {
      const p = await pixel();
      return p[0] > 180 && p[1] < 70 && p[2] < 70;
    })
    .toBe(true);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(page.locator(".save-dot")).not.toHaveClass(/dirty/);
  savedProject = JSON.parse(await readFile(saved, "utf8"));
  assert.equal(savedProject.clips[0].transform.x, 0);
  assert(savedProject.clips[0].keyframes.every((k) => k.value === 0));
  await page.locator(".player-panel .panel-heading").click();
  await page.keyboard.press("End");
  await expect(page.locator(".timecode strong")).toHaveText("00:00:03:00");
  const center = () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(".player-panel canvas")!;
      return [
        ...c
          .getContext("2d")!
          .getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1)
          .data,
      ];
    });
  await expect
    .poll(
      async () => {
        const p = await center();
        return p[0] > 180 && p[1] < 70 && p[2] < 70;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  assert.deepEqual(errors, []);
  const evidence = {
    passedAt: new Date().toISOString(),
    checks: [
      "real decoded preview",
      "live pointer drag before commit",
      "keyframed path moves together",
      "drag produces one undo step",
      "project end keeps final frame visible",
    ],
    errors,
  };
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Desktop player checks passed:", evidence);
} catch (error) {
  await page
    .screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
