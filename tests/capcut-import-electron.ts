/** Compiled desktop import against synthetic projects; dialogs are replaced only
 * inside this isolated test process. No installed editor or user draft is read. */
import { _electron as electron, expect, type Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createCipheriv, createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { generateFixtures } from "../scripts/generate-fixtures";
import type { Project } from "../src/core/types";

const root = process.cwd();
const output = path.join(root, ".test-output", "capcut-import-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const media = await generateFixtures(path.join(output, "media"));
const projectFolder = path.join(output, "多时间线项目");
const activeFile = path.join(projectFolder, "Timelines", "active", "draft_info.json");
const mainFile = path.join(projectFolder, "Timelines", "main", "draft_info.json");
const rootFile = path.join(projectFolder, "draft_info.json");
const opaqueFile = path.join(output, "opaque", "draft_info.json");
const tamperedFile = path.join(output, "tampered", "draft_info.json");
const saved = path.join(output, "imported.reacut");

/** Independent synthetic carrier generation. No real draft or device metadata. */
function syntheticEnvelope(text: string): string {
  const key = Buffer.from("0123456789abcdef0123456789abcdef", "ascii");
  const iv = Buffer.from("abcdefghijklmnop", "ascii");
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
    const material = Buffer.concat([key, iv]).toString("ascii");
    const positions = [0, 7, 20, 33, 40, 47, 59, 66, 76, 89, 99, 127];
    let carrier = "", cursor = 0;
    for (let index = 0; index < positions.length; index++) {
      const count = positions[index] - carrier.length;
      carrier += body.slice(cursor, cursor + count) + material.slice(index * 4, index * 4 + 4);
      cursor += count;
    }
    return carrier + body.slice(cursor);
  } finally {
    key.fill(0);
    iv.fill(0);
  }
}

const expectedActiveText = JSON.stringify({
  id: "active", version: 360000, new_version: "179.0.0",
  fps: 30,
  canvas_config: { ratio: "original", width: 0, height: 0 },
  materials: { videos: [{
    id: "own-source", type: "video", path: media.video,
    width: 160, height: 90, duration: 4_000_000,
  }] },
  tracks: [{ type: "video", segments: [{
    material_id: "own-source",
    target_timerange: { start: 0, duration: 2_000_000 },
    source_timerange: { start: 0, duration: 2_000_000 },
    clip: { transform: { x: 0.2, y: -0.2 } },
  }] }],
});
const activeCarrier = syntheticEnvelope(expectedActiveText);
const tamperedCarrier = activeCarrier.slice(0, -10) +
  (activeCarrier.at(-10) === "A" ? "B" : "A") + activeCarrier.slice(-9);
const emptyMainText = JSON.stringify({
  id: "main", version: 360000, new_version: "179.0.0",
  config: {}, canvas_config: { width: 160, height: 90 },
  materials: {}, keyframes: {}, render_index_track_mode_on: false,
});
const files = new Map<string, string>([
  [path.join(projectFolder, "Timelines", "project.json"), JSON.stringify({
    version: 0,
    main_timeline_id: "main",
    timelines: [
      { id: "main", name: "空白主时间线", is_marked_delete: false },
      { id: "active", name: "有素材的当前时间线", is_marked_delete: false },
    ],
  })],
  [path.join(projectFolder, "timeline_layout.json"), JSON.stringify({ activeTimeline: "active" })],
  [rootFile, JSON.stringify({ name: "不能代替所选时间线", tracks: [], materials: {} })],
  [mainFile, syntheticEnvelope(emptyMainText)],
  [activeFile, activeCarrier],
  [tamperedFile, tamperedCarrier],
  [opaqueFile, "U3ludGhldGljIG9wYXF1ZSBjYXJyaWVy"],
]);
for (const [file, text] of files) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
const fingerprint = async () => Promise.all([...files.keys()].map(async (file) => ({
  file, sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
})));
const before = await fingerprint();
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
env.REACUT_USER_DATA = path.join(output, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const packagedApp = process.env.REACUT_TEST_APP;
const app = await electron.launch({
  ...(packagedApp ? {
    executablePath: path.join(path.resolve(packagedApp), "Contents", "MacOS", "ReaCut"),
    args: [], cwd: output,
  } : { args: [path.join(root, "dist-electron", "main.cjs")] }),
  env,
});
let page: Page | undefined;
const errors: string[] = [];
try {
  await app.evaluate(({ dialog }, paths) => {
    const state = globalThis as any;
    state.capcutPath = paths.folder;
    state.capcutCanceled = false;
    state.capcutDialogs = 0;
    (dialog as any).showOpenDialog = async () => {
      state.capcutDialogs++;
      return { canceled: state.capcutCanceled, filePaths: [state.capcutPath] };
    };
    (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: paths.saved });
    (dialog as any).showMessageBox = async () => ({ response: 2 });
  }, { folder: projectFolder, saved });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept().catch(() => {}));
  await page.waitForSelector(".app-shell");
  // Electron handles JavaScript confirms through its own native dialog bridge;
  // make this test's replacement consent explicit rather than racing two APIs.
  await page.evaluate(() => { window.confirm = () => true; });
  const selected = await page.evaluate(() => window.editorAPI!.chooseCapcutProject("directory"));
  assert(selected);
  assert.equal(selected.requiresTimelineChoice, true);
  assert.equal(selected.recommendedTimelineId, "active");
  assert.deepEqual(selected.timelines.map(({ id, isActive, isMain }) => ({ id, isActive, isMain })), [
    { id: "main", isMain: true, isActive: false },
    { id: "active", isMain: false, isActive: true },
  ]);
  assert(!JSON.stringify(selected).includes(projectFolder), "Renderer must not receive filesystem plans or paths");
  const rejection = async (token: string, timelineId?: string) => page!.evaluate(async (args) => {
    try {
      await window.editorAPI!.readCapcutDraft(args.token, args.timelineId);
      return "unexpected success";
    } catch (error) { return String(error); }
  }, { token, timelineId });
  assert.match(await rejection(selected.token), /明确选择/);
  assert.match(await rejection(selected.token, "..\/other"), /已有的时间线/);
  const simultaneous = await page.evaluate(async (token) => Promise.all([0, 1].map(async () => {
    try {
      const result = await window.editorAPI!.readCapcutDraft(token, "active");
      return { ok: true as const, text: result.text };
    } catch (error) { return { ok: false as const, error: String(error) }; }
  })), selected.token);
  const active = simultaneous.find((result) => result.ok);
  assert(active?.ok);
  assert.equal(active.text, expectedActiveText, "Main IPC must authenticate and decode the carrier before returning JSON");
  assert.notEqual(active.text, files.get(activeFile));
  assert.equal(simultaneous.filter((result) => result.ok).length, 1);
  const denied = simultaneous.find((result) => !result.ok);
  assert(denied && !denied.ok);
  assert.match(denied.error, /正在读取|已失效/);
  assert.match(await rejection(selected.token, "active"), /已失效/);
  await page.evaluate((token) => window.editorAPI!.discardCapcutProject(token), selected.token);
  const canceledSelection = await page.evaluate(() => window.editorAPI!.chooseCapcutProject("directory"));
  assert(canceledSelection);
  await page.evaluate((token) => window.editorAPI!.discardCapcutProject(token), canceledSelection.token);
  assert.match(await rejection(canceledSelection.token, "active"), /已失效/);
  const openMenuImport = async (label: string) => {
    await page!.getByRole("button", { name: "文件菜单", exact: true }).click();
    await page!.getByRole("button", { name: label, exact: false }).click();
  };
  const chooser = page.getByRole("dialog", { name: "选择剪映时间线", exact: true });
  const initialName = await page.locator(".project-title input").inputValue();
  await openMenuImport("导入剪映项目文件夹");
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("combobox", { name: "剪映时间线" })).toHaveValue("active");
  await chooser.getByRole("combobox").focus();
  await page.keyboard.press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(page.locator(".project-title input")).toHaveValue(initialName);
  await openMenuImport("导入剪映项目文件夹");
  await expect(chooser).toBeVisible();
  await chooser.getByRole("combobox").selectOption("main");
  await chooser.getByRole("button", { name: "导入所选时间线", exact: true }).click();
  await expect(chooser).toHaveCount(0);
  await expect(page.locator(".project-title input")).toHaveValue("空白主时间线");
  await expect(page.locator(".media-item")).toHaveCount(0);
  await openMenuImport("导入剪映项目文件夹");
  await expect(chooser).toBeVisible();
  await page.screenshot({ path: path.join(output, "timeline-choice.png") });
  await chooser.getByRole("button", { name: "导入所选时间线", exact: true }).click();
  await expect(chooser).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".project-title input")).toHaveValue("有素材的当前时间线");
  await expect(page.locator(".media-item")).toHaveCount(1);
  await expect.poll(() => page!.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".player-panel canvas")!;
    const pixel = canvas.getContext("2d")!.getImageData(
      Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
    ).data;
    return pixel[0] > 180 && pixel[1] < 70 && pixel[2] < 70 && pixel[3] > 200;
  }), { timeout: 15_000 }).toBe(true);
  await page.screenshot({ path: path.join(output, "opaque-import-editor.png") });
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(page.locator(".save-dot")).not.toHaveClass(/dirty/);
  const imported: Project = JSON.parse(await readFile(saved, "utf8"));
  assert.equal(imported.clips.length, 1);
  assert.equal(imported.width, 160);
  assert.equal(imported.height, 90);
  assert.equal(imported.clips[0].transform.x, 16);
  assert.equal(imported.clips[0].transform.y, 9);
  assert.equal(imported.assets[0].path, media.video);
  assert.equal(imported.assets[0].missing, false);
  assert(imported.assets[0].thumbnail, "Media must pass through the existing probe workflow");
  if (await page.locator(".toast").count())
    await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  await app.evaluate((_, file) => { (globalThis as any).capcutPath = file; }, activeFile);
  await openMenuImport("导入剪映草稿文件");
  await expect(page.locator(".toast")).toContainText("实验性导入", { timeout: 30_000 });
  await expect(chooser).toHaveCount(0);
  await page.locator(".project-title input").fill("保留当前编辑");
  await page.locator(".project-title input").blur();
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(page.locator(".save-dot")).not.toHaveClass(/dirty/);
  const preservedProject: Project = JSON.parse(await readFile(saved, "utf8"));
  assert.equal(preservedProject.name, "保留当前编辑");
  await app.evaluate((_, file) => { (globalThis as any).capcutPath = file; }, tamperedFile);
  await openMenuImport("导入剪映草稿文件");
  await expect(page.locator(".toast")).toContainText("认证失败", { timeout: 30_000 });
  await expect(page.locator(".project-title input")).toHaveValue("保留当前编辑");
  await expect(page.locator(".media-item")).toHaveCount(1);
  await page.screenshot({ path: path.join(output, "tampered-carrier-preserved.png") });
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(page.locator(".save-dot")).not.toHaveClass(/dirty/);
  assert.deepEqual(JSON.parse(await readFile(saved, "utf8")), preservedProject,
    "Failed authentication must not replace the current timeline, media or edits");
  await app.evaluate((_, file) => { (globalThis as any).capcutPath = file; }, opaqueFile);
  await openMenuImport("导入剪映草稿文件");
  await expect(page.locator(".toast")).toContainText("不透明", { timeout: 30_000 });
  await expect(page.locator(".project-title input")).toHaveValue("保留当前编辑");
  await expect(page.locator(".media-item")).toHaveCount(1);
  const unsavedName = "保留当前编辑（未保存）";
  await page.locator(".project-title input").fill(unsavedName);
  await page.locator(".project-title input").blur();
  await expect(page.locator(".save-dot")).toHaveClass(/dirty/);
  const dialogsBeforeCancel = await app.evaluate(() => (globalThis as any).capcutDialogs as number);
  await page.evaluate(() => { window.confirm = () => false; });
  await openMenuImport("导入剪映草稿文件");
  assert.equal(await app.evaluate(() => (globalThis as any).capcutDialogs), dialogsBeforeCancel);
  await expect(page.locator(".project-title input")).toHaveValue(unsavedName);
  await page.evaluate(() => { window.confirm = () => true; });
  await app.evaluate(() => { (globalThis as any).capcutCanceled = true; });
  await openMenuImport("导入剪映草稿文件");
  await expect.poll(() => app.evaluate(() => (globalThis as any).capcutDialogs)).toBe(dialogsBeforeCancel + 1);
  await expect(page.locator(".project-title input")).toHaveValue(unsavedName);
  assert.deepEqual(await fingerprint(), before, "Selected source files must remain unchanged");
  assert.deepEqual(errors, []);
  const evidence = {
    passedAt: new Date().toISOString(),
    packaged: await app.evaluate(({ app }) => app.isPackaged),
    checks: [
      "Main-owned plans are excluded from renderer selection metadata",
      "Ambiguous timeline import rejects implicit or invalid choices",
      "Consumed and canceled selection tokens cannot be reused",
      "Simultaneous reads cannot reuse the same selection token",
      "Chooser preselects active timeline and permits explicit empty-main selection",
      "Escape cancellation preserves the current project",
      "Active timeline import hydrates media and infers original canvas",
      "Explicit timeline file bypasses the chooser",
      "Opaque failure and native picker cancellation preserve current edits",
      "Declining unsaved replacement does not open a source picker",
      "Source JSON and carrier files are unchanged",
      "Main IPC authenticates the embedded carrier and returns decoded JSON",
      "Sparse encrypted empty-main timeline imports without inventing media",
      "Authenticated opaque active timeline converts, probes media and saves real editor state",
      "Tampered authenticated carrier preserves the complete saved project and current edits",
      "Native canvas paints decoded carrier media through the real media scheme",
    ], errors,
  };
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("Desktop CapCut import checks passed:", evidence);
} catch (error) {
  console.error("Desktop CapCut import failure:", error);
  await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(({ dialog }) => { (dialog as any).showMessageBox = async () => ({ response: 2 }); }).catch(() => {});
  await app.close().catch(() => {});
}
