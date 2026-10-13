import { verifyEditorViewport } from './uiGeometry';
/** Native UI, project persistence and decoded pixels for crop/key/mask tools.
 * Run against the current compiled app: npx tsx tests/visual-ui-electron.ts
 */
import { _electron as electron, expect, type Page } from "@playwright/test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { generateFixtures } from "../scripts/generate-fixtures";
import { probeFile, runMediaTool } from "../electron/media";
import type { Project } from "../src/core/types";
const root = process.cwd(),
  directory = path.join(root, ".test-output", "visual-ui-electron");
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const media = await generateFixtures(path.join(directory, "media"));
const keyFile = path.join(directory, "media", "green-background.png");
const image = createCanvas(160, 90),
  context = image.getContext("2d");
context.fillStyle = "#00ff00";
context.fillRect(0, 0, 160, 90);
context.fillStyle = "#ff0000";
context.fillRect(60, 20, 40, 50);
await writeFile(keyFile, image.toBuffer("image/png"));
const projectPath = path.join(directory, "visual-tools.reacut");
let renderIndex = 0;
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
env.REACUT_USER_DATA = path.join(directory, "user-data");
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
        filePaths: files.inputs,
      });
      (dialog as any).showSaveDialog = async (...args: any[]) => {
        const options = args[args.length - 1];
        const g = globalThis as any;
        return {
          canceled: false,
          filePath:
            options.title === "导出视频"
              ? files.directory +
                "/render-" +
                (g.__visualRenderIndex = (g.__visualRenderIndex ?? 0) + 1) +
                ".mp4"
              : files.project,
        };
      };
      (dialog as any).showMessageBox = async () => ({
        response: 2,
        checkboxChecked: false,
      });
    },
    { inputs: [media.quadrants, keyFile], directory, project: projectPath },
  );
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
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
  const save = async (): Promise<Project> => {
    const previous = await stat(projectPath)
      .then((s) => s.mtimeMs)
      .catch(() => -1);
    await page!.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect
      .poll(() =>
        stat(projectPath)
          .then((s) => s.mtimeMs)
          .catch(() => -1),
      )
      .toBeGreaterThan(previous);
    return JSON.parse(await readFile(projectPath, "utf8"));
  };
  const pixel = (x = 0.5, y = 0.5) =>
    page!.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector<HTMLCanvasElement>(".player-panel canvas")!;
        return Array.from(
          canvas
            .getContext("2d")!
            .getImageData(
              Math.floor(canvas.width * x),
              Math.floor(canvas.height * y),
              1,
              1,
            ).data,
        );
      },
      { x, y },
    );
  const black = (rgba: number[]) =>
    rgba[0] < 35 && rgba[1] < 35 && rgba[2] < 40;
  const red = (rgba: number[]) => rgba[0] > 180 && rgba[1] < 70 && rgba[2] < 70;
  const green = (rgba: number[]) =>
    rgba[1] > 180 && rgba[0] < 70 && rgba[2] < 70;
  const exportedPixel = async (file: string, x: number, y: number) => {
    const buffer = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-ss",
      "0.5",
      "-i",
      file,
      "-vf",
      `crop=2:2:${x}:${y}`,
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    return Array.from(buffer.subarray(0, 3));
  };
  const render = async () => {
    await page!.getByRole("button", { name: "导出", exact: true }).click();
    await page!.getByRole("button", { name: "开始导出", exact: true }).click();
    await expect(page!.getByText("导出完成", { exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await page!.getByRole("button", { name: "完成", exact: true }).click();
    const file = path.join(directory, `render-${++renderIndex}.mp4`);
    const metadata = await probeFile(file);
    assert.equal(
      metadata.streams.find((s) => s.codec_type === "video")?.width,
      320,
    );
    return file;
  };
  // Keep preview and export comparisons deterministic at a small native canvas size.
  await page.getByRole("spinbutton", { name: "宽度", exact: true }).fill("320");
  await page.getByRole("spinbutton", { name: "高度", exact: true }).fill("180");
  await page.getByRole("spinbutton", { name: "高度", exact: true }).blur();
  await page.locator(".media-import").click();
  await expect(page.locator(".media-item")).toHaveCount(2);
  let project = await save();
  await page.locator(`[data-asset-id="${project.assets[0].id}"]`).dblclick();
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "裁剪", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "裁剪宽度", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "启用画面裁剪", exact: true })
    .check();
  await expect(
    page.getByRole("spinbutton", { name: "裁剪宽度", exact: true }),
  ).toHaveAttribute("min", "1");
  await page
    .getByRole("spinbutton", { name: "裁剪宽度", exact: true })
    .fill("0");
  await page.getByRole("spinbutton", { name: "裁剪宽度", exact: true }).blur();
  project = await save();
  assert.equal(
    project.clips[0].crop?.width,
    0.01,
    "Crop input minimum must remain valid for project saving",
  );
  await page
    .getByRole("spinbutton", { name: "裁剪宽度", exact: true })
    .fill("50");
  await page
    .getByRole("spinbutton", { name: "裁剪高度", exact: true })
    .fill("50");
  await page.getByRole("spinbutton", { name: "裁剪高度", exact: true }).blur();
  project = await save();
  assert.deepEqual(project.clips[0].crop, {
    x: 0,
    y: 0,
    width: 0.5,
    height: 0.5,
  });
  await expect.poll(async () => red(await pixel())).toBe(true);
  const cropRender = await render();
  assert(
    red(await exportedPixel(cropRender, 160, 90)),
    "UI crop must survive actual video export",
  );
  await page
    .getByRole("button", { name: "重置为完整画面", exact: true })
    .click();
  project = await save();
  assert.equal(project.clips[0].crop, undefined);
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "蒙版", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "启用形状蒙版", exact: true })
    .check();
  await page.getByRole("button", { name: "椭圆", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "蒙版宽度", exact: true }),
  ).toHaveAttribute("min", "1");
  await page
    .getByRole("spinbutton", { name: "蒙版宽度", exact: true })
    .fill("0");
  await page.getByRole("spinbutton", { name: "蒙版宽度", exact: true }).blur();
  project = await save();
  assert.equal(
    project.clips[0].mask?.width,
    0.01,
    "Mask minimum must remain valid for saving",
  );
  await page
    .getByRole("spinbutton", { name: "蒙版宽度", exact: true })
    .fill("50");
  await page
    .getByRole("spinbutton", { name: "蒙版高度", exact: true })
    .fill("50");
  await page.getByRole("spinbutton", { name: "蒙版高度", exact: true }).blur();
  project = await save();
  assert.deepEqual(project.clips[0].mask, {
    shape: "ellipse",
    width: 0.5,
    height: 0.5,
    feather: 0,
    invert: false,
  });
  await expect.poll(async () => black(await pixel(0.2, 0.5))).toBe(true);
  await page.getByRole("checkbox", { name: "反选蒙版", exact: true }).check();
  await expect.poll(async () => black(await pixel())).toBe(true);
  project = await save();
  assert.equal(project.clips[0].mask?.invert, true);
  const maskRender = await render();
  assert(
    black(await exportedPixel(maskRender, 160, 90)),
    "Inverted mask must preserve center transparency in export",
  );
  await page.getByRole("button", { name: "清除蒙版", exact: true }).click();
  project = await save();
  assert.equal(project.clips[0].mask, undefined);
  await page.getByRole("button", { name: "删除选中片段", exact: true }).click();
  await page.locator(`[data-asset-id="${project.assets[1].id}"]`).dblclick();
  await expect.poll(async () => green(await pixel(0.2, 0.5))).toBe(true);
  await page
    .locator(".inspector-tabs")
    .getByRole("button", { name: "抠像", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "启用色度抠像", exact: true })
    .check();
  project = await save();
  assert.equal(project.clips[0].chromaKey?.color, "#00ff00");
  await expect.poll(async () => black(await pixel(0.2, 0.5))).toBe(true);
  await expect.poll(async () => red(await pixel())).toBe(true);
  const keyRender = await render();
  assert(
    black(await exportedPixel(keyRender, 64, 90)),
    "Chroma export must remove the green background",
  );
  assert(
    red(await exportedPixel(keyRender, 160, 90)),
    "Chroma export must retain the red foreground",
  );
  // A disabled track must also disable all feature controls.
  const track = project.tracks.find((t) => t.id === project.clips[0].trackId)!;
  await page
    .getByRole("button", { name: `锁定${track.name}`, exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "启用色度抠像", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: `解锁${track.name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "清除色度抠像", exact: true }).click();
  project = await save();
  assert.equal(project.clips[0].chromaKey, undefined);
  await expect.poll(async () => green(await pixel(0.2, 0.5))).toBe(true);
  assert.deepEqual(errors, []);
  await mkdir(path.join(root, "docs", "screenshots"), { recursive: true });
  const finalGeometry = await verifyEditorViewport(page);
  await page.screenshot({
    path: path.join(root, "docs", "screenshots", "electron-visual-tools.png"),
  });
  const evidence = {
    passedAt: new Date().toISOString(),
    initialGeometry, finalGeometry,
    renders: [cropRender, maskRender, keyRender],
    fonts: {
      browserFaces: bundledFonts.count,
      browserLoaded: bundledFonts.loaded,
      browserCheck: bundledFonts.check,
      nativeIncludesNoto: bundledFonts.native?.includes("Noto Sans SC"),
    },
    checks: [
      "bundled Noto Sans SC browser/native availability",
      "optional controls disabled by default",
      "crop percent persistence+preview red pixel+export red pixel",
      "crop reset removes effect",
      "ellipse mask+invert persistence+preview transparency+export transparency",
      "mask clear removes effect",
      "chroma enable persistence+green removal+red preservation in preview and export",
      "locked feature controls disabled",
      "chroma clear restores background",
    ],
    errors,
  };
  await writeFile(
    path.join(directory, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Visual UI Electron checks passed", JSON.stringify(evidence));
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(directory, "failure.png") })
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
