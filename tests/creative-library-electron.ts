/** Full desktop recipe library workflow, isolated project and original bundled art only. */
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createProject, createClip } from "../src/core/model";
import { importAssets, probeFile, runMediaTool } from "../electron/media";
import type { Project } from "../src/core/types";
const root = process.cwd(),
  output = path.join(root, ".test-output/creative-library-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const project = createProject("原创文字 · 动效 · 转场");
project.width = 640;
project.height = 360;
project.fps = 24;
project.assets = await importAssets(
  ["bg-sand.png", "bg-ocean.png"].map((f) =>
    path.join(root, "public/builtin-assets", f),
  ),
  path.join(output, "cache"),
);
project.clips = project.assets.map((a, i) => ({
  ...createClip(a, project.tracks[1].id, i * 2, 24),
  duration: 2,
}));
const source = path.join(output, "before.reacut"),
  saved = path.join(output, "saved.reacut"),
  exported = path.join(output, "creative.mp4");
await writeFile(source, JSON.stringify(project));
const packaged = process.env.REACUT_TEST_APP,
  env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  );
env.REACUT_USER_DATA = path.join(output, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
if (packaged) {
  env.PATH = "";
  delete env.REACUT_FFMPEG;
  delete env.REACUT_FFPROBE;
}
const app = await electron.launch({
  ...(packaged
    ? {
        executablePath: path.join(
          path.resolve(packaged),
          "Contents/MacOS/ReaCut",
        ),
        args: [source],
        cwd: output,
      }
    : { args: [path.join(root, "dist-electron/main.cjs"), source] }),
  env,
});
const page = await app.firstWindow(),
  errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await app.evaluate(
    ({ dialog, BrowserWindow }, paths) => {
      BrowserWindow.getAllWindows()[0].setSize(1470, 900);
      (dialog as any).showSaveDialog = async (...args: any[]) => ({
        canceled: false,
        filePath: args.at(-1).title.includes("导出")
          ? paths.exported
          : paths.saved,
      });
      (dialog as any).showMessageBox = async () => ({ response: 2 });
    },
    { saved, exported },
  );
  await expect(page.locator(".tl-clip")).toHaveCount(2);
  const save = async (): Promise<Project> => {
    const old = await stat(source).then((s) => s.mtimeMs);
    await page.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect
      .poll(() => stat(source).then((s) => s.mtimeMs))
      .toBeGreaterThan(old);
    return JSON.parse(await readFile(source, "utf8"));
  };
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await expect(page.locator(".creative-card")).toHaveCount(16);
  const preview = page.getByRole("button", {
    name: "预览弹跳登场",
    exact: true,
  });
  await preview.scrollIntoViewIfNeeded();
  await preview.hover();
  const snapshot = () =>
    preview
      .locator("canvas")
      .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const first = await snapshot();
  await expect.poll(snapshot).not.toBe(first);
  checks.push("16 text recipes and animated canvas preview");
  await page
    .getByRole("textbox", { name: "搜索预设", exact: true })
    .fill("不存在的模板");
  await expect(
    page.getByText("没有匹配的文字模板", { exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索预设", exact: true }).fill("");
  await page.getByRole("tab", { name: "动态", exact: true }).click();
  await expect(page.locator(".creative-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "添加弹跳登场模板", exact: true })
    .click();
  let p = await save();
  assert.equal(p.clips.length, 3);
  assert(p.clips.at(-1)?.text?.text === "HELLO！");
  assert.equal(p.clips.at(-1)?.keyframes.length, 3);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal((await save()).clips.length, 2);
  await page
    .getByRole("button", { name: "添加轻盈升起模板", exact: true })
    .click();
  p = await save();
  assert(p.clips.at(-1)?.text?.text.includes("新的故事"));
  checks.push("text category/search, editable animated text and one-step undo");
  await page.getByRole("tab", { name: "全部", exact: true }).click();
  await page.locator(".player-panel .panel-heading").click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 24; i++) await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: path.join(output, "text-library.png") });
  const front = page.locator(`[data-clip-id="${project.clips[0].id}"]`);
  await front.click({ position: { x: 25, y: 20 } });
  await page.getByRole("button", { name: "特效", exact: true }).click();
  await expect(page.locator(".creative-card")).toHaveCount(8);
  await page.getByRole("button", { name: "应用暖阳调色", exact: true }).click();
  p = await save();
  assert.equal(p.clips[0].adjustments.temperature, 0.3);
  await page.getByRole("tab", { name: "动态特效", exact: true }).click();
  await expect(page.locator(".creative-card")).toHaveCount(8);
  await page
    .getByRole("button", { name: "应用呼吸缩放特效", exact: true })
    .click();
  p = await save();
  assert.equal(
    p.clips[0].keyframes.filter((k) => k.property === "scale").length,
    5,
  );
  checks.push("8 color and 8 motion effects apply real adjustments/keyframes");
  await page.locator(".effects-content").evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: path.join(output, "effect-library.png") });
  await page.getByRole("button", { name: "转场", exact: true }).click();
  await expect(page.locator(".creative-card")).toHaveCount(8);
  await page
    .getByRole("spinbutton", { name: "转场时长", exact: true })
    .fill("0.6");
  await page
    .getByRole("button", { name: "应用向左滑入转场", exact: true })
    .click();
  p = await save();
  const next = p.clips.find((c) => c.id === project.clips[1].id)!;
  assert(Math.abs(next.start - (2 - 14 / 24)) < 1e-8);
  assert.equal(next.keyframes.filter((k) => k.property === "x").length, 2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal((await save()).clips[1].start, 2);
  await front.click({ position: { x: 25, y: 20 } });
  await page
    .getByRole("button", { name: "应用缩放交接转场", exact: true })
    .click();
  p = await save();
  assert.equal(
    p.clips[1].keyframes.filter((k) => k.property === "scale").length,
    2,
  );
  checks.push(
    "8 transitions, frame-aligned duration, adjacent clip movement and atomic undo",
  );
  await page.locator(".creative-scroll").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: path.join(output, "transition-library.png") });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByText("导出完成", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  const info = await page.evaluate(() => window.editorAPI!.getSystemInfo());
  if (packaged) {
    process.env.REACUT_FFMPEG = info.ffmpegPath;
    process.env.REACUT_FFPROBE = info.ffprobePath;
  }
  const probe = await probeFile(exported);
  assert.equal(Number(probe.format.duration), 5);
  assert(probe.streams.some((s) => s.width === 640 && s.height === 360));
  const frame = await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "1",
    "-i",
    exported,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ]);
  let white = 0;
  for (let i = 0; i < frame.length; i += 3)
    if (frame[i] > 235 && frame[i + 1] > 235 && frame[i + 2] > 235) white++;
  assert(white > 50, "Export contains white Chinese template text");
  checks.push(
    "actual five-second MP4 exports Chinese animated title, motion/color and zoom transition",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        packaged: !!packaged,
        checks,
        whitePixels: white,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `Creative library: ${checks.length} checks passed (packaged=${!!packaged}).`,
  );
} catch (e) {
  await page
    .screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  throw e;
} finally {
  await app.close();
}
