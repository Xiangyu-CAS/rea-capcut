/** Owned Electron UI, original captions, real restart/preview/FFmpeg export. */
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {
  createClip,
  createProject,
  evaluateKeyframes,
} from "../src/core/model";
import { parseSubtitles } from "../src/core/subtitles";
import { runMediaTool } from "../electron/media";
import type { Project } from "../src/core/types";
const root = process.cwd(),
  out = path.resolve(".test-output/subtitle-workflow-electron");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const p = createProject("字幕工作流 · 拆分、合并与文字动画");
p.width = 320;
p.height = 180;
p.fps = 30;
p.background = "#000000";
const title = createClip(undefined, p.tracks[0].id, 0, 30);
title.text!.text = "ReaCut 原创字幕演示";
title.text!.fontSize = 14;
title.transform.y = -65;
title.duration = 2;
p.clips = [title];
const saved = path.join(out, "captions.reacut"),
  srt = path.join(out, "original.srt"),
  srtOut = path.join(out, "edited.srt"),
  video = path.join(out, "captions.mp4");
await writeFile(saved, JSON.stringify(p));
await writeFile(
  srt,
  "1\n00:00:00,000 --> 00:00:03,000\n你好 Hello\n\n2\n00:00:02,500 --> 00:00:04,500\n重叠字幕 Overlap\n\n3\n00:00:05,000 --> 00:00:08,000\n长句本地创作自由表达\nA longer caption for testing\n",
);
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (e): e is [string, string] => e[1] !== undefined,
  ),
);
env.REACUT_USER_DATA = path.join(out, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app!: ElectronApplication, page!: Page;
const errors: string[] = [],
  checks: string[] = [];
async function launch() {
  app = await electron.launch({
    args: [path.join(root, "dist-electron/main.cjs"), saved],
    env,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(
    ({ dialog, BrowserWindow }, files) => {
      BrowserWindow.getAllWindows()[0].setSize(1470, 1000);
      (dialog as any).showOpenDialog = async () => ({
        canceled: false,
        filePaths: [files.srt],
      });
      (dialog as any).showSaveDialog = async (...args: any[]) => ({
        canceled: false,
        filePath: args.at(-1).defaultPath?.endsWith(".srt")
          ? files.srtOut
          : files.video,
      });
      (dialog as any).showMessageBox = async () => ({ response: 2 });
    },
    { srt, srtOut, video },
  );
  await expect(page.locator(".tl-clip").first()).toBeVisible({
    timeout: 30000,
  });
}
async function save(): Promise<Project> {
  const before = (await stat(saved)).mtimeMs;
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect
    .poll(async () => (await stat(saved)).mtimeMs)
    .toBeGreaterThan(before);
  return JSON.parse(await readFile(saved, "utf8"));
}
async function seek(t: number) {
  const r = (await page.locator(".tl-ruler-body").boundingBox())!;
  await page.mouse.click(r.x + t * 60, r.y + 15);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
const panel = () => page.getByRole("region", { name: "字幕编辑器" });
const undo = () =>
    page.getByRole("button", { name: "撤销", exact: true }).click(),
  redo = () => page.getByRole("button", { name: "重做", exact: true }).click();
async function apply(n: number) {
  await panel().getByRole("button", { name: "检查修改", exact: true }).click();
  await panel()
    .getByRole("button", { name: `应用 ${n} 条修改`, exact: true })
    .click();
}
try {
  await launch();
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await panel().getByRole("button", { name: "导入字幕文件" }).click();
  await expect(page.locator(".subtitle-cue")).toHaveCount(3);
  let q = await save();
  const imported = q.clips.filter((c) => c.id !== title.id),
    first = imported[0];
  const row = (id: string) => page.locator(`[data-cue-id="${id}"]`);
  await row(first.id).locator(".subtitle-cue-content").click();
  await seek(1.5);
  const area = panel().getByRole("textbox", { name: "字幕内容", exact: true });
  await area.focus();
  await area.press("Home");
  await area.press("ArrowRight");
  await area.press("ArrowRight");
  await panel().getByRole("button", { name: "在播放头与文本光标拆分" }).click();
  await expect(page.locator(".subtitle-cue")).toHaveCount(4);
  const split = await save();
  const halves = split.clips.filter(
    (c) => c.trackId === first.trackId && c.start < 2.5,
  );
  assert.deepEqual(
    halves.map((c) => c.text!.text),
    ["你好", " Hello"],
  );
  assert.equal(halves[1].start, 1.5);
  await undo();
  await expect(page.locator(".subtitle-cue")).toHaveCount(3);
  await redo();
  await expect(page.locator(".subtitle-cue")).toHaveCount(4);
  await panel()
    .getByRole("button", { name: "合并所选字幕", exact: true })
    .click();
  await page.getByRole("button", { name: "锁定字幕", exact: true }).click();
  await expect(
    panel().getByRole("button", { name: "应用 2 条修改" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "解锁字幕", exact: true }).click();
  await expect(
    panel().getByRole("button", { name: "应用 2 条修改" }),
  ).toBeDisabled();
  await panel().getByRole("button", { name: "重新检查", exact: true }).click();
  await panel().getByRole("button", { name: "应用 2 条修改" }).click();
  q = await save();
  assert.equal(
    q.clips.find((c) => c.id === first.id)!.text!.text,
    "你好\n Hello",
  );
  assert.equal(q.clips.find((c) => c.id === first.id)!.duration, 3);
  await undo();
  await expect(page.locator(".subtitle-cue")).toHaveCount(4);
  await redo();
  await expect(page.locator(".subtitle-cue")).toHaveCount(3);
  checks.push(
    "SRT imports Chinese/English, long and overlapping cues; caret/playhead split and adjacent merge persist; undo/redo and stale locked merge recheck are atomic",
  );
  await panel().getByRole("checkbox", { name: "选择搜索结果" }).check();
  await panel().getByRole("tab", { name: "自定义样式" }).click();
  await panel().getByLabel("批量字幕字号", { exact: true }).fill("18");
  await panel().getByLabel("批量字幕颜色", { exact: true }).fill("#00ff88");
  await panel().getByLabel("批量字幕描边宽度", { exact: true }).fill("0");
  await apply(3);
  q = await save();
  assert(
    q.clips
      .filter((c) => c.trackId === first.trackId)
      .every((c) => c.text!.fontSize === 18 && c.text!.color === "#00ff88"),
  );
  assert.deepEqual(
    q.clips.find((c) => c.id === title.id),
    JSON.parse(JSON.stringify(p.clips[0])),
  );
  await undo();
  q = await save();
  assert(
    q.clips
      .filter((c) => c.trackId === first.trackId)
      .every((c) => c.text!.color === "#ffffff"),
  );
  await redo();
  const last = imported[2];
  await row(last.id).locator(".subtitle-cue-content").click();
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "画面", exact: true })
    .click();
  await page
    .locator(".inspector")
    .getByRole("spinbutton", { name: "位置 Y", exact: true })
    .fill("0");
  await page
    .locator(".inspector")
    .getByRole("spinbutton", { name: "位置 Y", exact: true })
    .blur();
  await panel().getByRole("tab", { name: "入场与出场" }).click();
  await panel().getByLabel("字幕入场动画").selectOption("slide-up");
  await panel().getByLabel("字幕出场动画").selectOption("zoom");
  await panel().getByLabel("字幕入场秒数").fill(".5");
  await panel().getByLabel("字幕出场秒数").fill(".5");
  await panel().getByLabel("字幕滑动距离").fill("16");
  await panel().getByLabel("字幕停留动画").selectOption("pulse");
  await panel().getByLabel("字幕呼吸幅度").fill("8");
  await apply(3);
  q = await save();
  assert(
    q.clips
      .filter((c) => c.trackId === first.trackId)
      .every((c) => c.keyframes.length === 13),
  );
  await undo();
  let beforeMotion = await save();
  assert(
    beforeMotion.clips
      .filter((c) => c.trackId === first.trackId)
      .every((c) => c.keyframes.length === 0),
  );
  await redo();
  q = await save();
  checks.push(
    "direct editable batch style and entrance/hold/exit settings preserve text/title and commit one undo; animations become ordinary saved keyframes",
  );
  await panel().getByRole("button", { name: "导出全部 SRT" }).click();
  await expect
    .poll(async () => readFile(srtOut, "utf8").catch(() => ""))
    .toContain("你好\n Hello");
  const plain = parseSubtitles(await readFile(srtOut, "utf8"));
  assert.equal(plain.length, 4);
  assert(plain.some((c) => c.start === 2.5 && c.end === 4.5));
  assert(!(await readFile(srtOut, "utf8")).includes("ease"));
  await app.close();
  await launch();
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await expect(page.locator(".subtitle-cue")).toHaveCount(3);
  const reopened = await save();
  assert.deepEqual(reopened.clips, q.clips);
  q = reopened;
  await row(last.id).locator(".subtitle-cue-content").click();
  await panel().getByRole("checkbox", { name: "选择搜索结果" }).check();
  await panel().getByRole("tab", { name: "入场与出场" }).click();
  await panel().getByLabel("字幕入场动画").selectOption("slide-up");
  await panel().getByLabel("字幕出场动画").selectOption("zoom");
  await panel().getByLabel("字幕入场秒数").fill(".5");
  await panel().getByLabel("字幕出场秒数").fill(".5");
  await panel().getByLabel("字幕滑动距离").fill("16");
  await panel().getByLabel("字幕停留动画").selectOption("pulse");
  await panel().getByLabel("字幕呼吸幅度").fill("8");
  await seek(6);
  await panel().getByLabel("字幕呼吸幅度").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "editor.png") });
  const frames = [0, 1, 4, 8, 14, 15, 30, 60, 75, 80, 85, 89],
    preview: any[] = [];
  for (const frame of frames) {
    await seek(5 + frame / 30);
    preview.push(
      await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>(
            ".player-panel canvas",
          )!,
          raw = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let energy = 0,
          peak = 0,
          sum = 0,
          weight = 0,
          left = c.width,
          right = 0;
        for (let i = 0; i < raw.length; i += 4) {
          energy += Math.max(0, raw[i + 1] - raw[i]);
          if (raw[i + 1] > raw[i] * 2 + 4) peak = Math.max(peak, raw[i + 1]);
        }
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++) {
            const i = (y * c.width + x) * 4,
              v = raw[i + 1];
            if (v > peak * 0.5 && v > raw[i] * 2 + 4) {
              sum += y * v;
              weight += v;
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
        return {
          peak,
          energy,
          y: weight ? ((sum / weight + 0.5) * 180) / c.height : null,
          width: weight ? ((right - left + 1) * 320) / c.width : 0,
        };
      }),
    );
  }
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const d = page.getByRole("dialog", { name: "导出视频" });
  await d.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(d.getByText("导出完成", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  const raw = await runMediaTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      video,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    60000,
    64 * 1024 * 1024,
  );
  assert.equal(raw.length, 240 * 320 * 180 * 3);
  const exported = frames.map((frame) => {
    const data = raw.subarray(
      (150 + frame) * 320 * 180 * 3,
      (151 + frame) * 320 * 180 * 3,
    );
    let energy = 0,
      peak = 0,
      sum = 0,
      weight = 0,
      left = 320,
      right = 0;
    for (let i = 0; i < data.length; i += 3) {
      energy += Math.max(0, data[i + 1] - data[i]);
      if (data[i + 1] > data[i] * 2 + 4) peak = Math.max(peak, data[i + 1]);
    }
    for (let y = 0; y < 180; y++)
      for (let x = 0; x < 320; x++) {
        const i = (y * 320 + x) * 3,
          v = data[i + 1];
        if (v > peak * 0.5 && v > data[i] * 2 + 4) {
          sum += y * v;
          weight += v;
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    return {
      peak,
      energy,
      y: weight ? sum / weight + 0.5 : null,
      width: weight ? right - left + 1 : 0,
    };
  });
  assert.equal(preview[0].peak, 0);
  assert.equal(exported[0].peak, 0);
  for (let i = 1; i < frames.length; i++) {
    assert(
      Math.abs(preview[i].y - (exported[i].y ?? NaN)) < 3,
      `centroid frame ${frames[i]}`,
    );
    assert(
      Math.abs(preview[i].width - exported[i].width) < 6,
      `width frame ${frames[i]}`,
    );
  }
  const moving = q.clips.find((c) => c.id === last.id)!;
  const expected = frames.map(
    (frame) => evaluateKeyframes(moving, frame / 30).transform,
  );
  // Integrated glyph color, normalized by the same renderer's hold frame and
  // scale area, measures opacity without treating edge ringing as fill color.
  const measuredOpacity = [preview, exported].map((samples) =>
    samples.map(
      (m, i) =>
        (m.energy / samples[6].energy) *
        (expected[6].scale / expected[i].scale) ** 2,
    ),
  );
  await writeFile(
    path.join(out, "measurements.json"),
    JSON.stringify(
      { frames, preview, exported, expected, measuredOpacity },
      null,
      2,
    ),
  );
  for (const values of measuredOpacity)
    for (let i = 0; i < frames.length; i++)
      assert(
        Math.abs(values[i] - expected[i].opacity) < 0.06,
        `opacity frame ${frames[i]} ${values[i]}/${expected[i].opacity}`,
      );
  assert(preview[1].y > preview[6].y + 10);
  assert(preview.at(-1).width < preview[6].width * 0.9);
  assert(preview[6].peak > 245);
  assert(preview.at(-1).peak < 80);
  checks.push(
    "SRT retains cue text/timing and overlaps without animation; actual process restart restores styles/curves",
  );
  checks.push(
    "real eight-second 240-frame export; twelve preview/export samples verify entry motion, breathing hold and exit scale/opacity",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        frames,
        expected,
        preview,
        exported,
        measuredOpacity,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`Subtitle workflow desktop: ${checks.length} groups passed`);
} catch (error) {
  await page
    ?.screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  await writeFile(
    path.join(out, "failure.txt"),
    await page.locator("body").innerText(),
  ).catch(() => {});
  throw error;
} finally {
  await app?.close().catch(() => {});
}
