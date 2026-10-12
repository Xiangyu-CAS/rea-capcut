import { verifyEditorViewport } from './uiGeometry';
/** Verify track controls through the real desktop App/Timeline/store wiring. */
import { _electron as electron, expect, type Page } from "@playwright/test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { generateFixtures } from "../scripts/generate-fixtures";
import { importAssets } from "../electron/media";
import { createClip, createProject, createTrack } from "../src/core/model";
import type { Project } from "../src/core/types";
const root = process.cwd(),
  output = path.join(root, ".test-output", "track-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const fixtures = await generateFixtures(path.join(output, "media")),
  assets = await importAssets(
    [fixtures.video, fixtures.audio],
    path.join(output, "fixture-cache"),
  );
const project = createProject("轨道管理验收");
project.assets = assets;
project.tracks = [
  createTrack("video", "主画面"),
  createTrack("video", "叠加画面"),
  createTrack("audio", "音乐"),
];
project.clips = [
  { ...createClip(assets[0], project.tracks[0].id, 0, 30), duration: 2 },
  { ...createClip(assets[0], project.tracks[0].id, 1, 30), duration: 2 },
  createClip(assets[1], project.tracks[2].id, 0, 30),
];
const original = path.join(output, "fixture.reacut"),
  saved = path.join(output, "edited.reacut");
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
  args: [path.join(root, "dist-electron", "main.cjs")],
  env,
  timeout: 30_000,
});
let page: Page | undefined;
const errors: string[] = [];
try {
  await app.evaluate(
    ({ dialog }, files) => {
      (dialog as any).showOpenDialog = async () => ({
        canceled: false,
        filePaths: [files.original],
      });
      (dialog as any).showSaveDialog = async () => ({
        canceled: false,
        filePath: files.saved,
      });
      (dialog as any).showMessageBox = async () => ({
        response: 2,
        checkboxChecked: false,
      });
    },
    { original, saved },
  );
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector(".app-shell");
  const initialGeometry = await verifyEditorViewport(page);
  await page.getByRole("button", { name: "文件菜单", exact: true }).click();
  await page.getByRole("button", { name: "打开项目", exact: false }).click();
  await expect(page.locator(".tl-clip")).toHaveCount(3);
  let firstSave = true;
  const save = async (): Promise<Project> => {
    const before = await stat(saved)
      .then((s) => s.mtimeMs)
      .catch(() => -1);
    if (firstSave) {
      firstSave = false;
      await page!.getByRole("button", { name: "文件菜单", exact: true }).click();
      await page!.getByRole("button", { name: "另存为", exact: false }).click();
    } else {
      await page!.getByRole("button", { name: "保存项目", exact: true }).click();
    }
    await expect
      .poll(() =>
        stat(saved)
          .then((s) => s.mtimeMs)
          .catch(() => -1),
      )
      .toBeGreaterThan(before);
    return JSON.parse(await readFile(saved, "utf8"));
  };
  const first = page.locator(`[data-clip-id="${project.clips[0].id}"]`),
    source = page.locator(`[data-track-id="${project.tracks[0].id}"]`),
    target = page.locator(`[data-track-id="${project.tracks[1].id}"]`);
  const clipBox = (await first.boundingBox())!,
    sourceBefore = (await source.boundingBox())!,
    targetBefore = (await target.boundingBox())!;
  await page.mouse.move(clipBox.x + 25, clipBox.y + 25);
  await page.mouse.down();
  await page.mouse.move(clipBox.x + 25, targetBefore.y + 25, { steps: 10 });
  assert.equal((await source.boundingBox())!.height, sourceBefore.height);
  assert.equal((await target.boundingBox())!.y, targetBefore.y);
  await page.mouse.up();
  let edited = await save();
  assert.equal(
    edited.clips.find((c) => c.id === project.clips[0].id)?.trackId,
    project.tracks[1].id,
  );
  await page.getByRole("button", { name: "音乐轨道操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "重命名轨道", exact: true }).click();
  await page
    .getByRole("textbox", { name: "轨道名称", exact: true })
    .fill("背景音乐");
  await page
    .getByRole("textbox", { name: "轨道名称", exact: true })
    .press("Enter");
  edited = await save();
  assert.equal(edited.tracks[2].name, "背景音乐");
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "向上移动轨道", exact: true })
    .click();
  edited = await save();
  assert.equal(edited.tracks[1].id, project.tracks[2].id);
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "向下移动轨道", exact: true })
    .click();
  edited = await save();
  assert.deepEqual(
    edited.tracks.map((t) => t.id),
    project.tracks.map((t) => t.id),
  );
  await page.getByRole("button", { name: "锁定背景音乐", exact: true }).click();
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  for (const action of ["重命名轨道", "向上移动轨道", "删除轨道"])
    await expect(
      page.getByRole("menuitem", { name: action, exact: true }),
    ).toBeDisabled();
  await page.getByRole("button", { name: "解锁背景音乐", exact: true }).click();
  await page.getByRole("button", { name: "锁定叠加画面", exact: true }).click();
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "向上移动轨道", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "解锁叠加画面", exact: true }).click();
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除轨道", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "删除轨道确认", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  edited = await save();
  assert.equal(
    edited.clips.length,
    3,
    "delete shortcut must not edit selected clips while confirmation is open",
  );
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除轨道", exact: true }).click();
  await page
    .getByRole("button", { name: "删除轨道和片段", exact: true })
    .click();
  edited = await save();
  assert.equal(edited.tracks.length, 2);
  assert.equal(edited.clips.length, 2);
  assert.equal(edited.assets.length, 2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  edited = await save();
  assert.equal(edited.tracks.length, 3);
  assert.equal(edited.clips.length, 3);
  assert.equal(edited.tracks[2].name, "背景音乐");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "添加轨道", exact: true }).click();
    await page.getByRole("button", { name: "视频轨道", exact: true }).click();
  }
  await page.locator(".tl-scroll").evaluate((el) => {
    el.scrollTop = 140;
  });
  const scrollBox = (await page.locator(".tl-scroll").boundingBox())!;
  await expect
    .poll(async () => {
      const handle = (await page!
        .getByRole("slider", { name: "播放位置", exact: true })
        .boundingBox())!;
      return handle.y >= scrollBox.y && handle.y < scrollBox.y + 30;
    })
    .toBe(true);
  assert.deepEqual(errors, []);
  await mkdir(path.join(root, "docs", "screenshots"), { recursive: true });
  const finalGeometry = await verifyEditorViewport(page);
  await page.screenshot({
    path: path.join(root, "docs", "screenshots", "electron-track-tools.png"),
  });
  const evidence = {
    passedAt: new Date().toISOString(),
    initialGeometry, finalGeometry,
    project: saved,
    checks: [
      "frozen cross-track drag geometry",
      "App rename callback persists project name",
      "App track up/down order",
      "locked track and locked neighbor reject modifications",
      "nonempty track delete confirms and blocks edit shortcuts",
      "track+clips deletion preserves assets",
      "single undo restores deleted track+clips",
      "sticky playhead handle after vertical scroll",
    ],
    errors,
  };
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Native track UI checks passed", JSON.stringify(evidence));
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    console.error(
      "Visible UI:",
      (await page.locator("body").innerText()).slice(-4000),
    );
  }
  throw error;
} finally {
  await app.close();
}
