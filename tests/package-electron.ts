/** Launch the actual packaged app from a different cwd, not the developer entry. */
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { probeFile } from "../electron/media";
const root = process.cwd(),
  output = path.join(root, ".test-output", "package-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const bundle = path.resolve(
  process.env.REACUT_TEST_APP ??
    path.join(root, "release", "mac-arm64", "ReaCut.app"),
);
const executable = path.join(bundle, "Contents", "MacOS", "ReaCut"),
  demo = path.join(root, ".demo", "demo.reacut"),
  exported = path.join(output, "packaged-demo.mp4");
await stat(executable);
await stat(demo);
const font = path.join(
  bundle,
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "dist",
  "fonts",
  "NotoSansSC.ttf",
);
assert(
  (await stat(font)).size > 17000000,
  "The font must exist within the packaged application",
);
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
env.REACUT_USER_DATA = path.join(output, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
delete env.REACUT_FFMPEG;
delete env.REACUT_FFPROBE;
const emptyPath = path.join(output, "empty-path");
await mkdir(emptyPath);
env.PATH = emptyPath;
const bundledTools = path.join(bundle, "Contents", "Resources", "media-tools");
// The verification probe also uses the shipped executable, not Homebrew.
process.env.REACUT_FFPROBE = path.join(bundledTools, "ffprobe");
const app = await electron.launch({
  executablePath: executable,
  args: [demo],
  cwd: output,
  env,
  timeout: 45000,
});
const page = await app.firstWindow(),
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await app.evaluate(({ dialog }, file) => {
    (dialog as any).showSaveDialog = async () => ({
      canceled: false,
      filePath: file,
    });
    (dialog as any).showMessageBox = async () => ({ response: 2 });
  }, exported);
  const native = await app.evaluate(({ app, BrowserWindow }) => ({
    path: app.getAppPath(),
    packaged: app.isPackaged,
    security: (
      BrowserWindow.getAllWindows()[0].webContents as any
    ).getLastWebPreferences(),
  }));
  assert(native.packaged);
  assert(native.path.startsWith(bundle));
  assert.equal(native.security.sandbox, true);
  assert.equal(native.security.nodeIntegration, false);
  assert.equal(native.security.contextIsolation, true);
  await expect(page.locator(".tl-clip")).toHaveCount(13, { timeout: 30000 });
  assert(
    await page.evaluate(() => {
      const inspector = document
        .querySelector(".inspector")!
        .getBoundingClientRect();
      return inspector.left >= 0 && inspector.right <= innerWidth + 1;
    }),
    "Inspector must fit inside the window, including the resizable timeline layout",
  );
  const fonts = await page.evaluate(async () => {
    const faces = await document.fonts.load('16px "Noto Sans SC"');
    return {
      faces: faces.length,
      loaded: faces.every((f) => f.status === "loaded"),
      native: await window.editorAPI!.getFontFamilies(),
    };
  });
  assert(
    fonts.faces > 0 && fonts.loaded && fonts.native.includes("Noto Sans SC"),
  );
  const system = await page.evaluate(() => window.editorAPI!.getSystemInfo());
  assert(
    system.ffmpeg,
    "Packaged application must discover bundled FFmpeg/FFprobe with an empty PATH",
  );
  assert.equal(system.ffmpegPath, path.join(bundledTools, "ffmpeg"));
  assert.equal(system.ffprobePath, path.join(bundledTools, "ffprobe"));
  // Seek to an opaque middle frame and verify that the actual preview has color variation.
  const ruler = (await page.locator(".tl-ruler-body").boundingBox())!;
  await page.mouse.click(ruler.x + 90, ruler.y + 15);
  const colorful = () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(".player-panel canvas")!,
        ctx = c.getContext("2d")!;
      const a = ctx.getImageData(
          Math.floor(c.width * 0.25),
          Math.floor(c.height * 0.25),
          1,
          1,
        ).data,
        b = ctx.getImageData(
          Math.floor(c.width * 0.25),
          Math.floor(c.height * 0.75),
          1,
          1,
        ).data;
      return (
        Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) >
        30
      );
    });
  await expect.poll(colorful, { timeout: 15000 }).toBe(true);
  await expect
    .poll(
      () =>
        page
          .locator(".media-preview > img")
          .evaluateAll(
            (images) =>
              images.length === 6 &&
              images.every(
                (i) =>
                  (i as HTMLImageElement).complete &&
                  (i as HTMLImageElement).naturalWidth > 0,
              ),
          ),
      { timeout: 15000 },
    )
    .toBe(true);
  const divider = page.getByRole("separator", {
    name: "调整时间线高度",
    exact: true,
  });
  await expect(divider).toHaveCount(1);
  const initialHeight = Number(await divider.getAttribute("aria-valuenow"));
  await divider.focus();
  for (let i = 0; i < 8; i++) await divider.press("ArrowUp");
  assert(
    Number(await divider.getAttribute("aria-valuenow")) >= initialHeight + 140,
    "Timeline resize keyboard interaction must increase its height",
  );
  assert(
    await page.evaluate(
      () =>
        document.querySelector(".inspector")!.getBoundingClientRect().right <=
        innerWidth + 1,
    ),
    "Resized timeline must keep Inspector in viewport",
  );
  await mkdir(path.join(root, "docs", "screenshots"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "docs", "screenshots", "demo-editor.png"),
  });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByText("导出完成", { exact: true })).toBeVisible({
    timeout: 120000,
  });
  const rendered = await probeFile(exported);
  const video = rendered.streams.find((s) => s.codec_type === "video");
  assert.equal(video?.width, 1280);
  assert.equal(video?.height, 720);
  assert(Math.abs(Number(rendered.format.duration) - 9) < 0.05);
  assert(rendered.streams.some((s) => s.codec_type === "audio"));
  assert.deepEqual(errors, []);
  const evidence = {
    passedAt: new Date().toISOString(),
    app: bundle,
    appPath: native.path,
    packaged: native.packaged,
    bundledMedia: { ffmpeg: system.ffmpegPath, ffprobe: system.ffprobePath, version: system.ffmpegVersion, emptyPath: true },
    cwd: output,
    fonts: {
      browserFaces: fonts.faces,
      browserLoaded: fonts.loaded,
      nativeIncludesNoto: true,
      bundledBytes: (await stat(font)).size,
    },
    video: exported,
    width: video?.width,
    height: video?.height,
    duration: rendered.format.duration,
    checks: [
      "packaged .app launched outside repository cwd",
      "bundled FFmpeg and FFprobe selected with empty PATH and no overrides",
      "native canvas and bundled font",
      "isolated sandbox bridge",
      "startup .reacut argument",
      "real landscape preview and thumbnails",
      "UI export with Chinese titles and mixed audio",
    ],
    errors,
  };
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Packaged desktop checks passed:", evidence);
} catch (error) {
  await page
    .screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
