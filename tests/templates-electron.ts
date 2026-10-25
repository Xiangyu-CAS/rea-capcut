/** Own Electron app, generated media, native-dialog stubs limited to test fixtures. */
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { runMediaTool } from "../electron/media";
import { createProject } from "../src/core/model";
import { defaultTemplate } from "../src/core/projectTemplates";
import { TEMPLATE_EXAMPLES } from "../src/core/templateExamples";
import { TEMPLATE_FILE } from "../electron/projectTemplates";
import type { Project } from "../src/core/types";
const root = process.cwd(),
  out = path.resolve(".test-output/templates-electron");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const parent = path.join(out, "exports");
await mkdir(parent);
const portrait = path.join(out, "portrait.png"),
  long = path.join(out, "replacement.mp4"),
  short = path.join(out, "too-short.mp4");
const canvas = createCanvas(90, 160),
  ctx = canvas.getContext("2d");
ctx.fillStyle = "#d02020";
ctx.fillRect(0, 0, 90, 160);
await writeFile(portrait, canvas.toBuffer("image/png"));
await runMediaTool("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "color=c=0x2040d0:s=320x180:r=30:d=12",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=12",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  long,
]);
await runMediaTool("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-i",
  long,
  "-t",
  "1",
  "-c",
  "copy",
  short,
]);
const initial = path.join(out, "initial.reacut");
await writeFile(initial, JSON.stringify(createProject("模板工作流验收")));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (e): e is [string, string] => e[1] !== undefined,
  ),
);
env.REACUT_USER_DATA = path.join(out, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app!: ElectronApplication,
  page!: Page,
  projectFile = initial,
  videoFile = "",
  mediaFile = portrait,
  importFile = "";
const checks: string[] = [],
  errors: string[] = [],
  renders: any[] = [];
async function configure() {
  await app.evaluate(
    ({ dialog, shell }, paths) => {
      (globalThis as any).testPaths = paths;
      (dialog as any).showSaveDialog = async (
        _w: unknown,
        o: { title: string },
      ) => ({
        canceled: false,
        filePath:
          o.title === "导出视频"
            ? (globalThis as any).testPaths.videoFile
            : (globalThis as any).testPaths.projectFile,
      });
      (dialog as any).showOpenDialog = async (
        _w: unknown,
        o: { title: string },
      ) => {
        if (
          (globalThis as any).holdTemplatePicker &&
          o.title === "选择模板包保存位置"
        )
          await new Promise<void>((r) => {
            (globalThis as any).releaseTemplatePicker = r;
          });
        return {
          canceled: false,
          filePaths: [
            o.title === "导入模板包"
              ? (globalThis as any).testPaths.importFile
              : o.title === "选择模板包保存位置"
                ? (globalThis as any).testPaths.parent
                : (globalThis as any).testPaths.mediaFile,
          ],
        };
      };
      (shell as any).showItemInFolder = () => {};
    },
    { projectFile, videoFile, mediaFile, importFile, parent },
  );
}
async function launch(file = initial) {
  app = await electron.launch({
    args: [path.join(root, "dist-electron/main.cjs"), file],
    env,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => void d.accept());
  await configure();
  await expect(page.getByRole("button", { name: "文件菜单" })).toBeVisible({
    timeout: 30000,
  });
}
async function openTemplates() {
  await page.getByRole("button", { name: "文件菜单" }).click();
  await page.getByRole("button", { name: "工程模板…", exact: true }).click();
  await expect(dialog()).toBeVisible();
}
const dialog = () =>
  page.getByRole("dialog", { name: "工程模板", exact: true });
async function save() {
  const previous = await stat(projectFile)
    .then((s) => s.mtimeMs)
    .catch(() => 0);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect
    .poll(() => stat(projectFile).then((s) => s.mtimeMs))
    .toBeGreaterThan(previous);
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readFile(projectFile, "utf8")).name;
      } catch {
        return "";
      }
    })
    .toContain("验收");
  return JSON.parse(await readFile(projectFile, "utf8")) as Project;
}
async function seek(t: number) {
  const r = (await page.locator(".tl-ruler-body").boundingBox())!;
  await page.mouse.click(r.x + t * 60, r.y + 15);
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
}
async function preview() {
  return page
    .locator(".player-panel canvas")
    .evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d")!;
      return [
        [0.5, 0.3],
        [0.03, 0.4],
      ].map(([x, y]) =>
        [
          ...ctx.getImageData(
            Math.floor(c.width * x),
            Math.floor(c.height * y),
            1,
            1,
          ).data,
        ].slice(0, 3),
      );
    });
}
try {
  await launch();
  for (const def of TEMPLATE_EXAMPLES) {
    await openTemplates();
    await dialog()
      .getByRole("button", { name: new RegExp(def.name) })
      .click();
    await expect(dialog().getByLabel("模板新工程名称")).toBeVisible();
    await dialog().getByLabel("模板新工程名称").fill(`${def.id} 模板验收`);
    if (def.id === "talk") {
      mediaFile = short;
      await configure();
      await dialog()
        .getByRole("button", { name: "选择替换素材" })
        .first()
        .click();
      await expect(dialog().getByRole("alert")).toContainText("12.000");
      await expect(
        dialog().getByRole("button", { name: "新建独立工程并应用替换" }),
      ).toBeDisabled();
      checks.push(
        "short video rejects the entire replacement batch, reports required source duration",
      );
    }
    mediaFile = def.id === "talk" ? long : portrait;
    await configure();
    await dialog()
      .getByRole("button", { name: "选择替换素材" })
      .first()
      .click();
    await expect(
      dialog().locator(".template-replacement").first(),
    ).toContainText(path.basename(mediaFile));
    const text = dialog().getByRole("textbox", { name: /^替换文案/ });
    await text.nth(0).fill("模板替换验收 / REPLACED");
    await text.nth(1).fill("第二段新文案");
    if (def.id === "promo")
      await page.screenshot({ path: path.join(out, "template-library.png") });
    await dialog()
      .getByRole("button", { name: "新建独立工程并应用替换" })
      .click();
    await expect(dialog()).toHaveCount(0);
    projectFile = path.join(out, `${def.id}.reacut`);
    videoFile = path.join(out, `${def.id}.mp4`);
    await configure();
    const changed = await save();
    assert.equal(
      changed.clips.find((c) => c.text)?.text!.text,
      "模板替换验收 / REPLACED",
    );
    assert(changed.assets.some((a) => a.path === mediaFile));
    if (def.id === "promo") {
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      const undone = await save();
      assert(!undone.assets.some((a) => a.path === portrait));
      assert.equal(undone.id, changed.id);
      await page.getByRole("button", { name: "重做", exact: true }).click();
      const redone = await save();
      assert.deepEqual(redone.clips, changed.clips);
      assert.deepEqual(redone.assets, changed.assets);
      checks.push(
        "new independent project preserves structure; one undo/redo restores all media and text replacements",
      );
    }
    await seek(1);
    await expect
      .poll(
        async () => {
          const v = await preview();
          return def.id === "talk" ? v[0][2] : v[0][0];
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(150);
    const pixels = await preview();
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const ex = page.getByRole("dialog", { name: "导出视频" });
    await ex.getByLabel("导出画质").selectOption("draft");
    await ex.getByRole("button", { name: "开始导出", exact: true }).click();
    await expect(ex.getByText("导出完成", { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await ex.getByRole("button", { name: "完成", exact: true }).click();
    const meta = JSON.parse(
      (
        await runMediaTool("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          videoFile,
        ])
      ).toString(),
    );
    const stream = meta.streams.find((s: any) => s.codec_type === "video");
    assert.equal(stream.nb_frames, "360");
    assert(Math.abs(Number(meta.format.duration) - 12) < 0.1);
    const raw = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-ss",
      "1",
      "-i",
      videoFile,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]);
    const actual = [
      [0.5, 0.3],
      [0.03, 0.4],
    ].map(([x, y]) => {
      const offset =
        (Math.floor(stream.height * y) * stream.width +
          Math.floor(stream.width * x)) *
        3;
      return [...raw.subarray(offset, offset + 3)];
    });
    for (let i = 0; i < 2; i++)
      for (let channel = 0; channel < 3; channel++)
        assert(Math.abs(pixels[i][channel] - actual[i][channel]) < 14);
    if (def.id === "talk") {
      const pcm = await runMediaTool("ffmpeg", [
        "-v",
        "error",
        "-i",
        videoFile,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1",
      ]);
      let energy = 0;
      for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
      assert(Math.sqrt(energy / (pcm.length / 4)) > 0.05);
    }
    renders.push({
      example: def.id,
      seconds: Number(meta.format.duration),
      frames: 360,
      width: stream.width,
      height: stream.height,
      preview: pixels,
      exported: actual,
    });
  }
  checks.push(
    "all three original examples instantiate, batch replace, save, preview and export 12 seconds / 360 frames each; portrait fit and video audio verified",
  );
  // Save the current gallery composition, explicitly name a slot, then export the original template.
  await openTemplates();
  await dialog()
    .getByRole("button", { name: "保存当前工程为模板", exact: true })
    .click();
  await dialog().getByLabel("模板名称", { exact: true }).fill("可搬移图文模板");
  await dialog()
    .getByRole("textbox", { name: /^占位名称/ })
    .first()
    .fill("主画面");
  await dialog().getByRole("button", { name: "保存模板及媒体副本" }).click();
  await expect(dialog().getByRole("status")).toContainText("模板已保存");
  await dialog()
    .getByRole("button", { name: /可搬移图文模板/ })
    .click();
  await expect(
    dialog().getByRole("button", { name: "导出原模板包…" }),
  ).toBeVisible();
  const library = path.join(env.REACUT_USER_DATA, "project-templates"),
    localFolder = path.join(library, (await readdir(library))[0]),
    templateBytes = await readFile(path.join(localFolder, TEMPLATE_FILE));
  const savedTemplate = JSON.parse(templateBytes.toString());
  assert(savedTemplate.cover.startsWith("data:image/png;base64,"));
  assert.equal(savedTemplate.slots[0].label, "主画面");
  assert(!templateBytes.includes(Buffer.from(out)));
  await app.evaluate(() => {
    (globalThis as any).holdTemplatePicker = true;
  });
  await dialog().getByRole("button", { name: "导出原模板包…" }).click();
  await page.keyboard.press("Escape");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send("menu-action", "new"),
  );
  await expect(dialog()).toBeVisible();
  await dialog().getByRole("button", { name: "取消操作" }).click();
  await app.evaluate(() => {
    (globalThis as any).holdTemplatePicker = false;
    (globalThis as any).releaseTemplatePicker();
  });
  await expect(dialog().getByRole("alert")).toContainText("取消");
  assert.deepEqual(await readdir(parent), []);
  await dialog().getByRole("button", { name: "导出原模板包…" }).click();
  await expect(dialog().getByRole("status")).toContainText("模板包已导出");
  const exported = path.join(parent, (await readdir(parent))[0]),
    moved = path.join(out, "moved-template");
  await rename(exported, moved);
  await rename(portrait, path.join(out, "original-unavailable.png"));
  importFile = path.join(moved, TEMPLATE_FILE);
  await configure();
  await dialog().getByRole("button", { name: "导入模板包…" }).click();
  await expect(dialog().getByRole("status")).toContainText("已复制");
  await rm(moved, { recursive: true });
  const entries = await page.evaluate(() => window.editorAPI!.listTemplates());
  assert.equal(entries.length, 2);
  assert.equal(
    createHash("sha256")
      .update(await readFile(path.join(localFolder, TEMPLATE_FILE)))
      .digest("hex"),
    createHash("sha256").update(templateBytes).digest("hex"),
  );
  checks.push(
    "UI saves name/cover/placeholders, cancels blocked export cleanly, exports and imports a moved media bundle into an independent local copy; original unchanged",
  );
  const forbidden = defaultTemplate(
    JSON.parse(await readFile(projectFile, "utf8")),
  );
  forbidden.project.assets[0].path = path.join(out, "not-imported.mp4");
  await assert.rejects(
    page.evaluate(
      (t) => window.editorAPI!.saveTemplate(crypto.randomUUID(), t),
      forbidden,
    ),
    /未经导入/,
  );
  assert.equal(
    (await page.evaluate(() => window.editorAPI!.listTemplates())).length,
    2,
  );
  checks.push(
    "template save IPC rejects a media path never authorized through import without adding a library entry",
  );
  await dialog()
    .getByRole("button", { name: /可搬移图文模板/ })
    .last()
    .click();
  await dialog().getByLabel("模板新工程名称").fill("重开模板验收");
  await dialog()
    .getByRole("textbox", { name: /^替换文案/ })
    .first()
    .fill("从本机模板库新建");
  await dialog()
    .getByRole("button", { name: "新建独立工程并应用替换" })
    .click();
  projectFile = path.join(out, "reopened.reacut");
  await configure();
  const finalProject = await save();
  assert(finalProject.assets.every((a) => a.path.startsWith(library)));
  await seek(1);
  const finalPixels = await preview();
  await page.screenshot({ path: path.join(out, "template-editor.png") });
  await app.close();
  await launch(projectFile);
  await expect(page.locator(".tl-clip")).toHaveCount(finalProject.clips.length);
  await seek(1);
  await expect
    .poll(async () => (await preview())[0][0], { timeout: 15000 })
    .toBeGreaterThan(150);
  const reopenedPixels = await preview();
  assert.deepEqual(reopenedPixels, finalPixels);
  await save();
  const reopenedProject = JSON.parse(await readFile(projectFile, "utf8"));
  assert.deepEqual(reopenedProject.clips, finalProject.clips);
  assert.equal(reopenedProject.id, finalProject.id);
  await openTemplates();
  await expect(
    dialog().getByRole("button", { name: /可搬移图文模板/ }),
  ).toHaveCount(2);
  checks.push(
    "real process restart preserves the local template library, independent project, replacement text and decoded media after original/external sources disappear",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "evidence.json"),
    JSON.stringify(
      { at: new Date().toISOString(), checks, renders, errors },
      null,
      2,
    ),
  );
  console.log(`Templates desktop: ${checks.length} groups passed`);
} catch (e) {
  await page!
    .screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  throw e;
} finally {
  await app!.close().catch(() => {});
}
