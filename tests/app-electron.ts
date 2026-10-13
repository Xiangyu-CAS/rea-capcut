import { verifyEditorViewport } from './uiGeometry';
/** Exercise the compiled desktop app with isolated, generated local media.
 * Run after npm run build: npx tsx tests/app-electron.ts
 * Native dialogs are stubbed ONLY inside this test's Electron process.
 */
import { _electron as electron, expect, type Page } from "@playwright/test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { generateFixtures } from "../scripts/generate-fixtures";
import { probeFile } from "../electron/media";
import type { Project } from "../src/core/types";

const root = process.cwd(),
  output = path.join(root, ".test-output", "app-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const fixture = await generateFixtures(path.join(output, "media"));
const saved = path.join(output, "desktop-project.reacut"),
  exported = path.join(output, "desktop-render.mp4");
const subtitles = path.join(output, "captions.srt");
await writeFile(subtitles, "1\n00:00:00,500 --> 00:00:01,800\n本地字幕验收\n");
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
const mediaFailures: string[] = [];
try {
  await app.evaluate(
    ({ dialog }, p) => {
      (dialog as any).showOpenDialog = async (...args: any[]) => {
        const options = args[args.length - 1];
        return {
          canceled: false,
          filePaths:
            options.title === "导入素材"
              ? [p.video, p.audio, p.image]
              : options.title === "打开 ReaCut 项目"
                ? [p.saved]
                : [p.subtitles],
        };
      };
      (dialog as any).showSaveDialog = async (...args: any[]) => {
        const options = args[args.length - 1];
        return {
          canceled: false,
          filePath: options.title === "导出视频" ? p.exported : p.saved,
        };
      };
      (dialog as any).showMessageBox = async () => ({
        response: 2,
        checkboxChecked: false,
      });
    },
    { ...fixture, saved, exported, subtitles },
  );
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().startsWith("reacut-media:") && response.status() >= 400)
      mediaFailures.push(`${response.status()} ${response.url()}`);
  });
  await page.waitForSelector(".app-shell");
  const initialGeometry = await verifyEditorViewport(page);
  const bundledFonts = await page.evaluate(async () => {
    const faces = await document.fonts.load('16px \"Noto Sans SC\"');
    return {
      count: faces.length,
      loaded: faces.every((face) => face.status === "loaded"),
      check: document.fonts.check('16px \"Noto Sans SC\"'),
      native: await window.editorAPI?.getFontFamilies(),
    };
  });
  assert(
    bundledFonts.count > 0 && bundledFonts.loaded && bundledFonts.check,
    "Bundled Noto Sans SC must actually load in Chromium",
  );
  assert(
    bundledFonts.native?.includes("Noto Sans SC"),
    "Native renderer must expose the bundled Noto font family",
  );
  const system = await page.evaluate(() => window.editorAPI?.getSystemInfo());
  assert(
    system?.ffmpeg,
    "Desktop bridge and local FFmpeg/FFprobe must be ready",
  );
  await expect(page.locator(".media-import")).toBeVisible();
  const verifyThumbnails = async () => {
    await expect(page!.locator(".media-preview > img")).toHaveCount(2);
    await expect
      .poll(
        () =>
          page!
            .locator(".media-preview > img")
            .evaluateAll((images) =>
              images.every(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        { timeout: 10_000 },
      )
      .toBe(true);
    const pixels = await page!
      .locator(".media-preview > img")
      .evaluateAll(async (images) =>
        Promise.all(
          images.map(async (rendered) => {
            // Decode the exact visible image URL with CORS to inspect its actual color.
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.src = (rendered as HTMLImageElement).currentSrc;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const context = canvas.getContext("2d")!;
            context.drawImage(
              image,
              Math.floor(image.naturalWidth / 2),
              Math.floor(image.naturalHeight / 2),
              1,
              1,
              0,
              0,
              1,
              1,
            );
            return Array.from(context.getImageData(0, 0, 1, 1).data);
          }),
        ),
      );
    assert(
      pixels[0][0] > 180 && pixels[0][1] < 70 && pixels[0][2] < 70,
      "video thumbnail must actually be red",
    );
    assert(
      pixels[1][2] > 180 && pixels[1][0] < 70 && pixels[1][1] < 70,
      "image thumbnail must actually be blue",
    );
    assert.deepEqual(
      mediaFailures,
      [],
      "media responses must not fail authorization/decoding",
    );
  };
  const saveProject = async (): Promise<Project> => {
    const before = await stat(saved)
      .then((s) => s.mtimeMs)
      .catch(() => -1);
    await page!.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect
      .poll(
        async () =>
          stat(saved)
            .then((s) => s.mtimeMs)
            .catch(() => -1),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(before);
    return JSON.parse(await readFile(saved, "utf8"));
  };
  await page.locator(".media-import").click();
  await expect(page.locator(".media-item")).toHaveCount(3, { timeout: 30_000 });
  await verifyThumbnails();
  let project = await saveProject();
  assert.equal(project.assets.length, 3);
  assert(project.assets.every((a) => a.thumbnail || a.waveform));
  const video = project.assets.find((a) => a.kind === "video")!;
  await page.locator(`[data-asset-id="${video.id}"]`).dblclick();
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  // Real media scheme decoding must paint the imported red video, not a placeholder.
  const pixel = () =>
    page!.evaluate(() => {
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
  await expect
    .poll(pixel, { timeout: 15_000 })
    .toEqual(expect.arrayContaining([255]));
  await expect
    .poll(
      async () => {
        const p = await pixel();
        return p[0] > 180 && p[1] < 70 && p[2] < 70;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => page!.locator(".timecode strong").textContent(), {
      timeout: 5000,
    })
    .not.toBe("00:00:00:00");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  // Seek precisely through a real timeline ruler click to split at one second.
  const ruler = (await page.locator(".tl-ruler-body").boundingBox())!;
  await page.mouse.click(ruler.x + 60, ruler.y + 15);
  await page.getByRole("button", { name: "分割片段", exact: true }).click();
  await expect(page.locator(".tl-clip")).toHaveCount(2);
  project = await saveProject();
  assert.equal(project.clips[0].duration, 1);
  assert.equal(project.clips[1].sourceIn, 1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  // Native accelerators must reach clip copy/paste when the timeline has focus.
  await page.locator(".tl-clip").click({ position: { x: 30, y: 26 } });
  const command = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(command + "+C");
  await page.keyboard.press(command + "+V");
  await expect(page.locator(".tl-clip")).toHaveCount(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  // Audio selection must expose audio properties immediately (without a hidden visual tab).
  const audio = project.assets.find((a) => a.kind === "audio")!;
  await page.locator(`[data-asset-id="${audio.id}"]`).dblclick();
  await expect(
    page
      .locator(".inspector-tabs")
      .getByRole("button", { name: "音频", exact: true }),
  ).toHaveClass(/active/);
  await expect(
    page.getByRole("spinbutton", { name: "音量", exact: true }),
  ).toBeVisible();
  project = await saveProject();
  assert(project.clips.some((c) => c.assetId === audio.id));
  // Text is created and edited through normal controls and persists in the project.
  await page
    .locator(".resource-tabs")
    .getByRole("button", { name: "文本", exact: true })
    .click();
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await page
    .getByRole("textbox", { name: "文字内容", exact: true })
    .fill("离线创作\n每一刻都值得记录");
  await page.getByRole("textbox", { name: "文字内容", exact: true }).blur();
  await page.getByRole("spinbutton", { name: "字号", exact: true }).fill("24");
  await page.getByRole("spinbutton", { name: "字号", exact: true }).blur();
  project = await saveProject();
  const text = project.clips.find((c) => !!c.text)!;
  assert.equal(text.text?.text, "离线创作\n每一刻都值得记录");
  await page
    .locator(
      `[data-clip-id="${project.clips.find((c) => c.assetId === video.id)!.id}"]`,
    )
    .click({ position: { x: 30, y: 26 } });
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "调色", exact: true })
    .click();
  const saturation = page.getByRole("slider", { name: "饱和度", exact: true });
  await saturation.focus();
  await saturation.press("Home");
  for (let i = 0; i < 50; i++) await saturation.press("ArrowRight");
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "速度", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "播放速度", exact: true })
    .fill("2");
  await page.getByRole("spinbutton", { name: "播放速度", exact: true }).blur();
  project = await saveProject();
  let clip = project.clips.find((c) => c.assetId === video.id)!;
  assert.equal(clip.speed, 2);
  assert.equal(clip.duration, 2);
  assert.equal(clip.adjustments.saturation, 0.5);
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "动画", exact: true })
    .click();
  await page
    .locator(".keyframe-add")
    .getByRole("button", { name: "位置 X", exact: true })
    .click();
  project = await saveProject();
  clip = project.clips.find((c) => c.assetId === video.id)!;
  assert.equal(clip.keyframes.length, 1);
  await page
    .locator(".resource-tabs")
    .getByRole("button", { name: "字幕", exact: true })
    .click();
  await page.getByRole("button", { name: "导入字幕文件", exact: true }).click();
  project = await saveProject();
  assert(project.clips.some((c) => c.text?.text === "本地字幕验收"));
  // Change a local test project externally so re-opening proves the actual file is read.
  await writeFile(
    saved,
    JSON.stringify({ ...project, name: "桌面验收 · 重新打开" }, null, 2),
  );
  // Re-open the actual saved file through the native dialog path and check hydrated media.
  await page.getByRole("button", { name: "文件菜单", exact: true }).click();
  await page.getByRole("button", { name: "打开项目", exact: false }).click();
  await expect(page.locator(".tl-clip")).toHaveCount(project.clips.length);
  await expect(page.locator(".project-title input")).toHaveValue(
    "桌面验收 · 重新打开",
  );
  await expect
    .poll(pixel, { timeout: 15_000 })
    .toEqual(expect.arrayContaining([255]));
  // Reduce render dimensions through project parameters after clearing selection.
  await page.keyboard.press("Escape");
  await page.getByRole("spinbutton", { name: "宽度", exact: true }).fill("320");
  await page.getByRole("spinbutton", { name: "高度", exact: true }).fill("180");
  await page.getByRole("spinbutton", { name: "高度", exact: true }).blur();
  project = await saveProject();
  assert.equal(project.width, 320);
  assert.equal(project.height, 180);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByText("导出完成", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const rendered = await probeFile(exported);
  assert.equal(
    rendered.streams.find((s) => s.codec_type === "video")?.width,
    320,
  );
  assert(Number(rendered.format.duration) > 0);
  assert.deepEqual(errors, []);
  await mkdir(path.join(root, "docs", "screenshots"), { recursive: true });
  await verifyEditorViewport(page);
  await page.screenshot({
    path: path.join(root, "docs", "screenshots", "electron-export.png"),
    // Public evidence must not expose the workstation username or local output path.
    mask: [page.getByLabel("导出位置", { exact: true })],
    maskColor: "#262626",
  });
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page
    .locator(".resource-tabs")
    .getByRole("button", { name: "素材", exact: true })
    .click();
  await expect(
    page
      .locator(".resource-tabs")
      .getByRole("button", { name: "素材", exact: true }),
  ).toHaveClass(/active/);
  await verifyThumbnails();
  const finalGeometry = await verifyEditorViewport(page);
  await page.screenshot({
    path: path.join(root, "docs", "screenshots", "electron-editor.png"),
  });
  const evidence = {
    passedAt: new Date().toISOString(),
    initialGeometry, finalGeometry,
    project: saved,
    video: exported,
    duration: rendered.format.duration,
    fonts: {
      browserFaces: bundledFonts.count,
      browserLoaded: bundledFonts.loaded,
      browserCheck: bundledFonts.check,
      nativeIncludesNoto: bundledFonts.native?.includes("Noto Sans SC"),
    },
    checks: [
      "bundled Noto Sans SC browser/native availability",
      "native import+metadata+actual red/blue thumbnail pixels",
      "actual canvas red-video decode",
      "play/pause progresses time",
      "timeline split source range",
      "undo",
      "native clip clipboard accelerators",
      "audio property selection",
      "text edit persistence",
      "inspector color+speed+keyframe",
      "SRT import",
      "project reopen+media hydration",
      "project dimensions",
      "UI local export+ffprobe",
    ],
    errors,
    mediaFailures,
  };
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "Electron editing and export checks passed:",
    JSON.stringify(evidence),
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    console.error("Renderer errors:", errors);
    console.error(
      "Visible UI:",
      (await page.locator("body").innerText()).slice(-5000),
    );
  }
  throw error;
} finally {
  await app.close();
}
