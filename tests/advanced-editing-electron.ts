/** Exercise group import, beat editing, curve controls, and per-timeline export in a real editor. */
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { probeFile, runMediaTool } from "../electron/media";
import { firstChineseWindow } from "./ui-language";
import type { ExportProgress, Project } from "../src/core/types";
import { sourceOffsetAt } from "../src/core/speedCurve";

const root = path.resolve(".test-output/advanced-editing", new Date().toISOString().replace(/[:.]/g, "-"));
const draftFolder = path.join(root, "合成草稿");
await mkdir(draftFolder, { recursive: true });
const video = path.join(root, "frames.mp4"), music = path.join(root, "beats.wav");
await runMediaTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=8:r=30",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
await runMediaTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
  "aevalsrc=if(gte(t\\,0.25)*lt(mod(t-0.25\\,0.5)\\,0.045)\\,0.7*sin(2*PI*95*t)\\,0):s=48000:d=8",
  "-c:a", "pcm_s16le", music]);
const saved = path.join(root, "group.reacut");
const wideFile = path.join(root, "wide.mp4"), verticalFile = path.join(root, "vertical.mp4");

const wide = "横版时间线", vertical = "竖版时间线";
await mkdir(path.join(draftFolder, "Timelines", "wide"), { recursive: true });
await mkdir(path.join(draftFolder, "Timelines", "vertical"), { recursive: true });
await writeFile(path.join(draftFolder, "Timelines", "project.json"), JSON.stringify({
  version: 0, main_timeline_id: "wide", timelines: [
    { id: "wide", name: wide, is_marked_delete: false },
    { id: "vertical", name: vertical, is_marked_delete: false },
  ],
}));
await writeFile(path.join(draftFolder, "timeline_layout.json"), JSON.stringify({ activeTimeline: "wide" }));
for (const [id, width, height, length] of [["wide", 320, 180, 6], ["vertical", 180, 320, 4]] as const) {
  await writeFile(path.join(draftFolder, "Timelines", id, "draft_info.json"), JSON.stringify({
    fps: 30, canvas_config: { width, height },
    materials: {
      videos: [{ id: "v", path: video, width: 320, height: 180, duration: 8000000 }],
      audios: [{ id: "a", path: music, duration: 8000000 }],
    },
    tracks: [
      { type: "video", segments: [{ material_id: "v", target_timerange: { duration: length * 1e6 },
        source_timerange: { start: 217000, duration: length * 1e6 } }] },
      { type: "audio", segments: [{ material_id: "a", target_timerange: { duration: length * 1e6 } }] },
    ],
  }));
}

const bundle = process.env.REACUT_TEST_APP;
const env = Object.fromEntries(Object.entries(process.env).filter(
  (entry): entry is [string, string] => entry[1] !== undefined,
));
env.REACUT_USER_DATA = path.join(root, "user-data");
env.VITE_DEV_SERVER_URL = "";
if (bundle) {
  env.PATH = "";
  delete env.REACUT_FFMPEG;
  delete env.REACUT_FFPROBE;
}
let app: ElectronApplication | undefined;
let page!: Page;
const errors: string[] = [];
const checks: string[] = [];
async function launch(reopen: boolean) {
  const files = reopen ? [saved] : [];
  app = await electron.launch({
    ...(bundle ? { executablePath: path.join(bundle, "Contents/MacOS/ReaCut"), args: files } :
      { args: [path.resolve("dist-electron/main.cjs"), ...files] }),
    env,
  });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(bundle));
  page = await firstChineseWindow(app);
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await app.evaluate(({ dialog, BrowserWindow }, paths) => {
    BrowserWindow.getAllWindows()[0].setSize(1380, 840);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.draftFolder] });
    dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    dialog.showSaveDialog = async (...args: any[]) => {
      const name = args.at(-1)?.defaultPath ?? "";
      return { canceled: false, filePath: name.endsWith(".mp4") ?
        (name.includes(paths.vertical) ? paths.verticalFile : paths.wideFile) : paths.saved };
    };
  }, { draftFolder, saved, wideFile, verticalFile, vertical });
}

async function closeTestApp() {
  if (!app) return;
  const instance = app;
  app = undefined;
  let forced = false;
  const deadline = setTimeout(() => {
    forced = true;
    instance.process().kill("SIGKILL");
  }, 8000);
  deadline.unref();
  try { await instance.close(); }
  finally { clearTimeout(deadline); }
  assert(!forced, "The isolated editor did not close within the test deadline.");
}

async function save(): Promise<Project> {
  const previous = await stat(saved).then(file => file.mtimeMs).catch(() => 0);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect.poll(() => stat(saved).then(file => file.mtimeMs).catch(() => 0)).toBeGreaterThan(previous);
  return JSON.parse(await readFile(saved, "utf8"));
}

const tab = (name: string) => page.getByRole("group", { name: "工程时间线" }).getByRole("button", { name, exact: true });
const clip = (id: string) => page.locator(`[data-clip-id="${id}"]`);
const undo = () => page.getByRole("button", { name: "撤销", exact: true }).click();

async function exportTimeline(file: string, width: number, height: number, hardware: boolean) {
  await page.evaluate(() => {
    const events: ExportProgress[] = [];
    Reflect.set(window, "testEncoderEvents", events);
    window.editorAPI?.onExportProgress(event => { events.push(event); });
  });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出视频" });
  if (hardware) await dialog.getByLabel("H.264 编码器").selectOption("videotoolbox");
  await dialog.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(dialog.getByText("导出完成", { exact: true })).toBeVisible({ timeout: 45000 });
  const result = await probeFile(file);
  const image = result.streams.find(stream => stream.codec_type === "video");
  assert.deepEqual([image?.width, image?.height, image?.codec_name], [width, height, "h264"]);
  assert(result.streams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac"));
  const events = await page.evaluate(() => Reflect.get(window, "testEncoderEvents") as ExportProgress[]);
  assert.equal(events.at(-1)?.encoder, hardware ? "videotoolbox" : "software");
  assert.equal(events.at(-1)?.encoderFallback, false);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
}

try {
  await launch(false);
  await page.evaluate(() => {
    const videos: HTMLVideoElement[] = [];
    Reflect.set(window, "testPreviewVideos", videos);
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (element instanceof HTMLVideoElement) videos.push(element);
      return element;
    }) as typeof document.createElement;
  });
  await page.getByRole("button", { name: "文件菜单", exact: true }).click();
  await page.getByRole("button", { name: /导入剪映项目文件夹/ }).click();
  await page.getByRole("button", { name: "导入全部时间线", exact: true }).click();
  await expect(tab(wide)).toHaveAttribute("aria-pressed", "true");
  const original = await save();
  assert.deepEqual([original.width, original.height, original.assets.length], [320, 180, 2]);
  assert.deepEqual([original.otherTimelines?.[0].width, original.otherTimelines?.[0].height], [180, 320]);
  assert.deepEqual(original.clips.map(clip => clip.assetId), original.otherTimelines?.[0].clips.map(clip => clip.assetId));
  checks.push("One draft folder becomes two independent canvases sharing both media files.");

  await page.getByRole("button", { name: "新建时间线", exact: true }).click();
  await expect(tab("时间线 3")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".tl-clip")).toHaveCount(0);
  await undo();
  await expect(tab(wide)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "复制时间线", exact: true }).click();
  await expect(tab(wide + " 副本")).toHaveAttribute("aria-pressed", "true");
  const duplicate = await save();
  assert.notEqual(duplicate.clips[0].id, original.clips[0].id);
  await undo();
  await expect(tab(wide)).toHaveAttribute("aria-pressed", "true");
  checks.push("New and duplicate timelines are undoable and get independent clip identities.");

  const videoId = original.clips.find(clip => clip.assetId === original.assets.find(asset => asset.path === video)!.id)!.id;
  const musicId = original.clips.find(clip => clip.assetId === original.assets.find(asset => asset.path === music)!.id)!.id;
  await clip(musicId).click({ position: { x: 25, y: 24 } });
  await page.getByRole("button", { name: "检测素材节拍", exact: true }).click();
  const beatSnap = page.getByRole("button", { name: "节拍吸附", exact: true });
  await expect(beatSnap).toBeVisible({ timeout: 20000 });
  const marked = await save();
  const beat = marked.assets.find(asset => asset.path === music)!.beats!;
  assert(Math.abs(beat.bpm - 120) <= 2);
  assert(beat.times.length >= 14 && Math.abs(beat.times[0] - 0.25) < 0.025);
  await expect(page.locator(".tl-beat-marker").first()).toBeVisible();
  await beatSnap.click();
  await expect(beatSnap).toHaveAttribute("aria-pressed", "true");
  const ordinarySnap = page.getByRole("button", { name: "时间线吸附", exact: true });
  await ordinarySnap.click();
  await expect(ordinarySnap).toHaveAttribute("aria-pressed", "false");
  const target = clip(videoId);
  await target.click({ position: { x: 36, y: 26 } });
  await expect(target).toHaveAttribute("aria-pressed", "true");
  const notice = page.getByRole("button", { name: "关闭提示", exact: true });
  if (await notice.isVisible()) await notice.click();
  const videoBounds = (await target.boundingBox())!;
  const dragX = videoBounds.x + 38, dragY = videoBounds.y + 26;
  const dragBy = videoBounds.width * 0.2 / original.clips.find(clip => clip.id === videoId)!.duration;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  try {
    await page.mouse.move(dragX + dragBy, dragY, { steps: 4 });
    await expect(target).toHaveClass(/is-dragging/);
    await expect(page.locator(".tl-snap-line")).toBeVisible();
  } finally { await page.mouse.up(); }
  assert.equal((await save()).clips.find(clip => clip.id === videoId)?.start, Math.round(beat.times[0] * 30) / 30);
  await undo();
  await clip(videoId).click({ position: { x: 24, y: 25 } });
  await page.getByRole("button", { name: "按拍切开所选片段", exact: true }).click();
  await expect(page.locator(".tl-clip")).toHaveCount(14);
  const cut = await save();
  assert.equal(cut.clips.filter(clip => clip.assetId === marked.assets.find(asset => asset.path === music)!.id).length, 1);
  await undo();
  await expect(page.locator(".tl-clip")).toHaveCount(2);
  checks.push("Actual local audio detection marks 120 BPM and cuts only the selected track in one undo.");

  await clip(videoId).click({ position: { x: 24, y: 25 } });
  await page.getByRole("button", { name: "速度", exact: true }).click();
  await page.getByRole("button", { name: "曲线变速", exact: true }).click();
  await page.getByRole("button", { name: "逐渐加速", exact: true }).click();
  await expect(page.getByRole("button", { name: "速度点 2", exact: true })).toBeVisible();
  const curved = await save();
  const ramp = curved.clips.find(clip => clip.id === videoId)!;
  assert.equal(ramp.speed, 1.25);
  assert(Math.abs(ramp.duration - 4.8) < 1e-6 && ramp.speedCurve?.length === 2);
  const point = page.getByRole("button", { name: "速度点 2", exact: true });
  await point.scrollIntoViewIfNeeded();
  const pointBounds = (await point.boundingBox())!;
  const x = pointBounds.x + pointBounds.width / 2, y = pointBounds.y + pointBounds.height / 2;
  const oldPointTitle = await point.getAttribute("title");
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x, y + 8, { steps: 3 });
    await expect(point).not.toHaveAttribute("title", oldPointTitle!);
  } finally { await page.mouse.up(); }
  const dragged = (await save()).clips.find(clip => clip.id === videoId)!;
  assert(dragged.speedCurve![1].rate < 2);
  await undo();
  const ruler = (await page.locator(".tl-ruler-body").boundingBox())!;
  await page.mouse.click(ruler.x + 90, ruler.y + 18);
  await expect.poll(async () => page.evaluate(() => {
    const videos = Reflect.get(window, "testPreviewVideos") as HTMLVideoElement[];
    return videos.find(video => video.hasAttribute("src"))?.currentTime ?? 0;
  })).toBeCloseTo(ramp.sourceIn + sourceOffsetAt(ramp, 1.5), 3);
  const encoders = await page.evaluate(() => window.editorAPI!.getExportEncoders());
  if (process.env.REACUT_EXPECT_VIDEOTOOLBOX === "1") assert(encoders.videoToolbox);
  await exportTimeline(wideFile, 320, 180, encoders.videoToolbox);
  checks.push("Dragging a speed point is undoable; a real preview seek and the chosen encoder use the restored curve.");

  await tab(vertical).click();
  await expect(tab(vertical)).toHaveAttribute("aria-pressed", "true");
  await save();
  await exportTimeline(verticalFile, 180, 320, false);
  await closeTestApp();
  await launch(true);
  await expect(tab(vertical)).toHaveAttribute("aria-pressed", "true");
  await tab(wide).click();
  const reopened = await save();
  assert.deepEqual(reopened.clips.find(clip => clip.id === videoId)?.speedCurve, ramp.speedCurve);
  assert.deepEqual(reopened.assets.find(asset => asset.path === music)?.beats, beat);
  await tab(vertical).click();
  await expect(page.locator(".app-status").getByText("项目就绪", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  checks.push("Both timelines export separately and reopen with canvas, curve and beat data. Tab switching stays clean.");
  const evidence = { packaged: Boolean(bundle), videoToolbox: encoders.videoToolbox, bpm: beat.bpm, marks: beat.times.length, checks };
  await writeFile(path.join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(evidence);
} finally {
  await closeTestApp();
}
