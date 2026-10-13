/** Real UI controls + serialized project assertions, isolated synthetic captions only. */
import { _electron as electron, expect, type Page } from "@playwright/test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createClip, createProject } from "../src/core/model";
import type { Project } from "../src/core/types";
const root = process.cwd(), output = path.join(root, ".test-output/subtitle-electron");
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
const project = createProject("字幕批量编辑验收");
const title = createClip(undefined, project.tracks[0].id, 0, 30); title.text!.text = "保留片头标题"; title.duration = 2; project.clips.push(title);
const original = path.join(output, "fixture.reacut"), saved = path.join(output, "edited.reacut"), subtitles = path.join(output, "captions.srt"), exported = path.join(output, "captions-export.srt");
await writeFile(original, JSON.stringify(project));
await writeFile(subtitles, "1\n00:00:02,000 --> 00:00:05,000\n第一条 [a].*\n\n2\n00:00:06,000 --> 00:00:09,000\n第二条 [a].*\n\n3\n00:00:09,000 --> 00:00:12,000\n第三条\n");
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
env.REACUT_USER_DATA = path.join(output, "user-data"); delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
const packaged = process.env.REACUT_TEST_APP;
if (packaged) { env.PATH = ""; delete env.REACUT_FFMPEG; delete env.REACUT_FFPROBE; }
const app = await electron.launch({ ...(packaged ? { executablePath: path.join(path.resolve(packaged), "Contents/MacOS/ReaCut"), args: [], cwd: output } : { args: [path.join(root, "dist-electron/main.cjs")] }), env });
let page: Page | undefined; const errors: string[] = [], checks: string[] = [];
try {
  await app.evaluate(({ dialog }, files) => {
    (dialog as any).showOpenDialog = async (...args: any[]) => ({ canceled: false, filePaths: [args.at(-1).title === "打开 ReaCut 项目" ? files.original : files.subtitles] });
    (dialog as any).showSaveDialog = async (...args: any[]) => ({ canceled: false, filePath: args.at(-1).defaultPath?.endsWith(".srt") ? files.exported : files.saved });
    (dialog as any).showMessageBox = async () => ({ response: 2 });
  }, { original, subtitles, saved, exported });
  page = await app.firstWindow(); page.on("pageerror", e => errors.push(e.message));
  await page.waitForSelector(".app-shell");
  await page.getByRole("button", { name: "文件菜单", exact: true }).click();
  await page.getByRole("button", { name: "打开项目", exact: false }).click();
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await page.getByRole("button", { name: "导入字幕文件", exact: true }).click();
  await expect(page.locator(".subtitle-cue")).toHaveCount(3);
  checks.push("SRT import selects the new subtitle track without mixing the existing title");
  let firstSave = true;
  async function save(): Promise<Project> {
    const before = await stat(saved).then(s => s.mtimeMs).catch(() => -1);
    if (firstSave) {
      firstSave = false; await page!.getByRole("button", { name: "文件菜单", exact: true }).click(); await page!.getByRole("button", { name: "另存为", exact: false }).click();
    } else await page!.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect.poll(() => stat(saved).then(s => s.mtimeMs).catch(() => -1)).toBeGreaterThan(before);
    return JSON.parse(await readFile(saved, "utf8"));
  }
  const imported = await save(), cues = imported.clips.filter(c => c.id !== title.id);
  await page.getByRole("textbox", { name: "搜索字幕", exact: true }).fill("[a].*");
  await expect(page.locator(".subtitle-cue")).toHaveCount(2);
  await page.getByRole("checkbox", { name: "选择搜索结果", exact: true }).check();
  await page.getByRole("tab", { name: "查找替换", exact: true }).click();
  await page.getByRole("textbox", { name: "查找字幕文字", exact: true }).fill("[a].*");
  await page.getByRole("textbox", { name: "替换字幕文字", exact: true }).fill("$& 字面替换");
  await page.getByRole("button", { name: "检查修改", exact: true }).click();
  await page.getByRole("button", { name: "应用 2 条修改", exact: true }).click();
  let edited = await save();
  assert.equal(edited.clips.find(c => c.id === cues[0].id)!.text!.text, "第一条 $& 字面替换");
  assert.deepEqual(edited.clips.find(c => c.id === title.id), imported.clips.find(c => c.id === title.id));
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  edited = await save(); assert.deepEqual(edited.clips, imported.clips);
  checks.push("literal replacement is scoped to filtered selection; one undo restores both cues and title is untouched");

  await page.getByRole("textbox", { name: "搜索字幕", exact: true }).fill("");
  await page.getByRole("checkbox", { name: "选择搜索结果", exact: true }).check();
  await page.getByRole("tab", { name: "时间偏移", exact: true }).click();
  await page.getByRole("spinbutton", { name: "字幕偏移秒数", exact: true }).fill("0.049");
  await page.getByRole("button", { name: "检查修改", exact: true }).click();
  await page.getByRole("button", { name: "应用 3 条修改", exact: true }).click();
  edited = await save(); assert(Math.abs(edited.clips.find(c => c.id === cues[0].id)!.start - (2 + 1 / 30)) < 1e-9);
  checks.push("batch offsets align to project frames while preserving nonzero cue times");

  const firstCue = page.locator(`[data-cue-id="${cues[0].id}"]`);
  await firstCue.locator(".subtitle-cue-content").click();
  await page.getByRole("textbox", { name: "字幕内容", exact: true }).fill("逐条修订字幕");
  await page.getByRole("spinbutton", { name: "字幕开始时间", exact: true }).fill("3");
  await page.getByRole("spinbutton", { name: "字幕结束时间", exact: true }).fill("4.5");
  await page.getByRole("button", { name: "保存此条", exact: true }).click();
  edited = await save(); assert.equal(edited.clips.find(c => c.id === cues[0].id)!.start, 3); assert.equal(edited.clips.find(c => c.id === cues[0].id)!.duration, 1.5);
  checks.push("single cue text and absolute range persist via native project save");

  await firstCue.locator(".subtitle-cue-content").click();
  await page.getByRole("textbox", { name: "字幕内容", exact: true }).fill("不得覆盖新状态");
  await page.getByRole("button", { name: "锁定字幕", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存此条", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "检查修改", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "解锁字幕", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存此条", exact: true })).toBeDisabled();
  checks.push("locked tracks disable edits; unlocked but stale cue forms cannot overwrite newer project state");
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.getByRole("spinbutton", { name: "字幕偏移秒数", exact: true }).fill("1");
  await page.getByRole("button", { name: "检查修改", exact: true }).click();
  await page.getByRole("button", { name: "锁定字幕", exact: true }).click();
  await page.getByRole("button", { name: "解锁字幕", exact: true }).click();
  await expect(page.getByRole("button", { name: "应用 3 条修改", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重新检查", exact: true }).click();
  await page.getByRole("button", { name: "应用 3 条修改", exact: true }).click();
  checks.push("stale batch plans require fresh validation after timeline changes");

  await page.getByRole("tab", { name: "统一样式", exact: true }).click();
  await page.getByRole("combobox", { name: "字幕样式参考", exact: true }).selectOption(cues[0].id);
  // Change the reference through the existing inspector, then copy with the new batch form.
  await firstCue.locator(".subtitle-cue-content").click();
  await page.locator(".inspector").getByRole("spinbutton", { name: "字号", exact: true }).fill("90");
  await page.locator(".inspector").getByRole("spinbutton", { name: "字号", exact: true }).blur();
  await page.getByRole("button", { name: "检查修改", exact: true }).click();
  await page.getByRole("button", { name: "应用 2 条修改", exact: true }).click();
  edited = await save();
  assert(edited.clips.filter(c => c.trackId === cues[0].trackId).every(c => c.text!.fontSize === 90));
  assert.equal(edited.clips.find(c => c.id === cues[1].id)!.text!.text, "第二条 [a].*");
  checks.push("copying reference style keeps independent cue text");
  await page.getByRole("button", { name: "导出全部 SRT", exact: true }).click();
  await expect.poll(() => readFile(exported, "utf8").catch(() => "")).toContain("逐条修订字幕");
  checks.push("edited captions export through real native SRT save");
  await page.screenshot({ path: path.join(output, "subtitle-editor.png") });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "evidence.json"), JSON.stringify({ passedAt: new Date().toISOString(), packaged: !!packaged, checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    await writeFile(path.join(output, "failure.txt"), await page.locator("body").innerText()).catch(() => {});
  }
  throw error;
} finally {
  if (page) await page.evaluate(() => window.editorAPI?.setDirty(false)).catch(() => {});
  await app.close();
}
