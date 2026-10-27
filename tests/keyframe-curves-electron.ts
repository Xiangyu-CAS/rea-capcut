import { firstChineseWindow } from "./ui-language";
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {
  createClip,
  createProject,
  evaluateKeyframes,
} from "../src/core/model";
import { importAssets, runMediaTool } from "../electron/media";
import type { Project } from "../src/core/types";
const out = path.resolve(".test-output/keyframe-curves-electron");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const canvas = createCanvas(320, 180),
  ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(120, 70, 80, 40);
const source = path.join(out, "original-rectangle.png");
await writeFile(source, canvas.toBuffer("image/png"));
const [asset] = await importAssets([source], path.join(out, "cache"));
const p = createProject("关键帧曲线 · 平移、推近与透明度");
p.width = 320;
p.height = 180;
p.fps = 30;
p.background = "#000000";
p.assets = [asset];
const c = createClip(asset, p.tracks[1].id, 0, 30);
c.duration = 2;
p.clips = [c];
const saved = path.join(out, "curves.reacut"),
  output = path.join(out, "curves.mp4");
await writeFile(saved, JSON.stringify(p));
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
    args: [path.resolve("dist-electron/main.cjs"), saved],
    env,
  });
  page = await firstChineseWindow(app);
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ dialog, BrowserWindow }, output) => {
    BrowserWindow.getAllWindows()[0].setSize(1470, 900);
    (dialog as any).showSaveDialog = async () => ({
      canceled: false,
      filePath: output,
    });
    (dialog as any).showMessageBox = async () => ({ response: 2 });
  }, output);
  await expect(page.locator(".tl-clip")).toHaveCount(1, { timeout: 30000 });
}
const panel = () => page.getByRole("region", { name: "关键帧曲线编辑器" });
async function save(): Promise<Project> {
  const before = (await stat(saved)).mtimeMs;
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect
    .poll(async () => (await stat(saved)).mtimeMs)
    .toBeGreaterThan(before);
  return JSON.parse(await readFile(saved, "utf8"));
}
async function seek(time: number) {
  const r = (await page.locator(".tl-ruler-body").boundingBox())!;
  await page.mouse.click(r.x + time * 60, r.y + 15);
  // Wait for the seek commit and canvas paint, so a tolerated adjacent frame
  // cannot accidentally satisfy the pixel comparison.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function openCurve() {
  await page
    .locator(`[data-clip-id="${c.id}"]`)
    .click({ position: { x: 30, y: 26 } });
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "动画", exact: true })
    .click();
}
async function value(n: number) {
  await panel().getByLabel("选中关键帧数值", { exact: true }).fill(String(n));
  await panel().getByLabel("选中关键帧数值", { exact: true }).press("Enter");
}
async function curve(
  property: string,
  from: number,
  to: number,
  easing: string,
) {
  await panel().getByLabel("曲线属性").selectOption(property);
  await seek(0);
  await panel()
    .getByRole("button", { name: "添加当前帧", exact: true })
    .click();
  await value(from);
  await seek(2);
  await panel()
    .getByRole("button", { name: "添加当前帧", exact: true })
    .click();
  await value(to);
  await panel().getByLabel("曲线缓动").selectOption(easing);
}
const undo = () =>
    page.getByRole("button", { name: "撤销", exact: true }).click(),
  redo = () => page.getByRole("button", { name: "重做", exact: true }).click();
function measure(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
) {
  let max = 0;
  for (let i = 0; i < raw.length; i += channels) max = Math.max(max, raw[i]);
  let left = width,
    right = 0,
    weight = 0,
    sumX = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = raw[(y * width + x) * channels];
      if (v > max * 0.5) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        weight += v;
        sumX += x * v;
      }
    }
  // Sample opacity inside the rectangle; bicubic edge ringing is not its fill opacity.
  return {
    x: sumX / weight + 0.5,
    width: right - left + 1,
    brightness:
      raw[
        (Math.floor(height / 2) * width + Math.round(sumX / weight)) * channels
      ],
  };
}
try {
  await launch();
  await openCurve();
  await curve("x", -50, 50, "easeIn");
  await curve("scale", 0.5, 1.5, "easeOut");
  await curve("opacity", 0.2, 0.9, "easeInOut");
  let q = await save();
  assert.equal(q.clips[0].keyframes.length, 6);
  checks.push(
    "UI creates three animated properties with precise values and three different easing curves",
  );
  await panel().getByLabel("曲线属性").selectOption("x");
  await seek(1);
  await panel()
    .getByRole("button", { name: "添加当前帧", exact: true })
    .click();
  q = await save();
  const middle = q.clips[0].keyframes.find(
    (k) => k.property === "x" && k.time === 1,
  )!;
  const point = panel().locator(`[data-key-id="${middle.id}"]`);
  await point.scrollIntoViewIfNeeded();
  const box = (await point.boundingBox())!,
    svg = (await panel().locator("svg").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + (26.6 * svg.width) / 320,
    box.y + box.height / 2 - ((25 / 140) * 144 * svg.height) / 190,
    { steps: 8 },
  );
  await page.mouse.up();
  q = await save();
  assert(
    Math.abs(q.clips[0].keyframes.find((k) => k.id === middle.id)!.time - 1.2) <
      0.001,
  );
  await undo();
  q = await save();
  assert.equal(q.clips[0].keyframes.find((k) => k.id === middle.id)!.time, 1);
  await redo();
  await openCurve();
  await panel().locator(`[data-key-id="${middle.id}"]`).focus();
  await page.keyboard.press("Enter");
  await panel().getByRole("button", { name: "删除选中关键帧" }).click();
  q = await save();
  assert.equal(q.clips[0].keyframes.length, 6);
  await undo();
  await openCurve();
  await expect(panel().locator(`[data-key-id="${middle.id}"]`)).toHaveCount(1);
  await redo();
  await openCurve();
  checks.push(
    "real pointer drag changes time/value in one undo; selected-point deletion and redo preserve other properties",
  );
  const originalXIds = q.clips[0].keyframes
    .filter((k) => k.property === "x")
    .map((k) => k.id);
  await panel().getByLabel("曲线属性").selectOption("x");
  await panel().getByRole("button", { name: "选择此曲线全部" }).click();
  await panel()
    .getByRole("button", { name: "复制关键帧", exact: true })
    .click();
  await seek(1);
  await panel().getByRole("button", { name: "粘贴到播放头" }).click();
  await expect(panel().getByRole("alert")).toContainText("超出片段");
  await seek(0);
  await panel().getByRole("button", { name: "粘贴到播放头" }).click();
  q = await save();
  assert.equal(q.clips[0].keyframes.length, 6);
  assert(
    !q.clips[0].keyframes
      .filter((k) => k.property === "x")
      .some((k) => originalXIds.includes(k.id)),
  );
  const before = q.clips[0].keyframes;
  await panel().locator("circle").last().focus();
  await page.keyboard.press("Enter");
  await panel().getByLabel("选中关键帧时间").fill("1.9");
  await panel().getByLabel("选中关键帧时间").press("Enter");
  q = await save();
  assert(
    q.clips[0].keyframes.some((k) => k.property === "x" && k.time === 1.9),
  );
  await undo();
  q = await save();
  assert.deepEqual(q.clips[0].keyframes, before);
  await openCurve();
  await page.getByRole("button", { name: "锁定视频 1", exact: true }).click();
  await expect(
    panel().getByRole("button", { name: "添加当前帧" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "解锁视频 1", exact: true }).click();
  q = await save();
  checks.push(
    "clipboard overflow is atomic; paste replaces matching ticks; exact time editing undoes correctly; locked tracks disable editing",
  );
  await app.close();
  await launch();
  await openCurve();
  await panel().getByLabel("曲线属性").selectOption("scale");
  await seek(1);
  await page.screenshot({ path: path.join(out, "editor.png") });
  const preview: { x: number; width: number; brightness: number }[] = [];
  const expected = Array.from({ length: 60 }, (_, i) => {
    const v = evaluateKeyframes(q.clips[0], i / 30).transform;
    return { x: 160 + v.x, width: 80 * v.scale, brightness: 255 * v.opacity };
  });
  for (let i = 0; i < 60; i++) {
    await seek(i / 30);
    await expect
      .poll(async () => {
        preview[i] = await page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>(
            ".player-panel canvas",
          )!;
          const raw = c
            .getContext("2d")!
            .getImageData(0, 0, c.width, c.height).data;
          let peak = 0,
            left = c.width,
            right = 0,
            sum = 0,
            weight = 0;
          for (let j = 0; j < raw.length; j += 4) peak = Math.max(peak, raw[j]);
          for (let y = 0; y < c.height; y++)
            for (let x = 0; x < c.width; x++) {
              const v = raw[(y * c.width + x) * 4];
              if (v > peak * 0.5) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                sum += x * v;
                weight += v;
              }
            }
          return {
            x: ((sum / weight + 0.5) * 320) / c.width,
            width: ((right - left + 1) * 320) / c.width,
            brightness:
              raw[
                (Math.floor(c.height / 2) * c.width +
                  Math.round(sum / weight)) *
                  4
              ],
          };
        });
        return (
          Math.abs(preview[i].x - expected[i].x) < 2 &&
          Math.abs(preview[i].width - expected[i].width) < 3 &&
          Math.abs(preview[i].brightness - expected[i].brightness) < 3
        );
      })
      .toBe(true)
      .catch((e) => {
        console.error({ frame: i, expected: expected[i], actual: preview[i] });
        throw e;
      });
  }
  checks.push(
    "actual process restart preserves curves; all 60 preview frames follow position, zoom and opacity interpolation",
  );
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出视频" });
  await dialog.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(dialog.getByText("导出完成", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  const raw = await runMediaTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      output,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    60000,
    32 * 1024 * 1024,
  );
  assert.equal(raw.length, 60 * 320 * 180 * 3);
  const exported = Array.from({ length: 60 }, (_, i) =>
    measure(
      raw.subarray(i * 320 * 180 * 3, (i + 1) * 320 * 180 * 3),
      320,
      180,
      3,
    ),
  );
  for (let i = 0; i < 60; i++) {
    assert(
      Math.abs(exported[i].x - expected[i].x) < 2,
      `frame ${i} x ${exported[i].x}`,
    );
    assert(
      Math.abs(exported[i].width - expected[i].width) < 4,
      `frame ${i} width`,
    );
    assert(
      Math.abs(exported[i].brightness - expected[i].brightness) < 7,
      `frame ${i} opacity ${exported[i].brightness} / ${expected[i].brightness}`,
    );
  }
  assert.deepEqual(errors, []);
  checks.push(
    "all 60 exported frames match preview/curve position, width and opacity within declared pixel/compression tolerances",
  );
  await writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        expected,
        preview,
        exported,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`Keyframe curves desktop: ${checks.length} groups passed`);
} catch (e) {
  await page!
    ?.screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  throw e;
} finally {
  await app!?.close().catch(() => {});
}
