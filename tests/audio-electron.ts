/** Real desktop audio separation and shared-source relinking; dialogs are stubbed only in this owned process. */
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { generateFixtures } from "../scripts/generate-fixtures";
import { probeFile, runMediaTool } from "../electron/media";
import type { Project } from "../src/core/types";

const root = process.cwd();
const output = path.join(root, ".test-output", "audio-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const fixture = await generateFixtures(path.join(output, "media"));
const source = path.join(output, "original-source.mkv");
const replacement = path.join(output, "moved-source.mkv");
await runMediaTool("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-i",
  fixture.video,
  "-c",
  "copy",
  source,
]);
const saved = path.join(output, "audio-project.reacut");
const exported = path.join(output, "audio-project.mp4");
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
env.REACUT_USER_DATA = path.join(output, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app!: ElectronApplication;
let page!: Page;
const errors: string[] = [];

const saveProject = async (): Promise<Project> => {
  const before = await stat(saved)
    .then((value) => value.mtimeMs)
    .catch(() => -1);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect
    .poll(
      async () =>
        stat(saved)
          .then((value) => value.mtimeMs)
          .catch(() => -1),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(before);
  return JSON.parse(await readFile(saved, "utf8"));
};
const canvasPixel = () =>
  page.evaluate(() => {
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
const audioLevels = () =>
  page.evaluate(() => {
    const audit: {
      element: HTMLMediaElement;
      analyser: AnalyserNode;
      gain: GainNode;
    }[] = (window as any).__audioAudit ?? [];
    return audit
      .filter((entry) => entry.element.currentSrc && !entry.element.paused)
      .map((entry) => {
        const samples = new Float32Array(entry.analyser.fftSize);
        entry.analyser.getFloatTimeDomainData(samples);
        return {
          kind: entry.element.tagName,
          url: entry.element.currentSrc,
          gain: entry.gain.gain.value,
          rms: Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) /
              samples.length,
          ),
        };
      });
  });

try {
  app = await electron.launch({
    args: [path.join(root, "dist-electron", "main.cjs")],
    env,
    timeout: 30_000,
  });
  await app.evaluate(
    ({ dialog }, files) => {
      (dialog as any).showOpenDialog = async (...args: any[]) => {
        const options = args[args.length - 1];
        const file =
          options.title === "导入素材"
            ? files.source
            : options.title === "打开 ReaCut 项目"
              ? files.saved
              : files.replacement;
        return { canceled: false, filePaths: [file] };
      };
      (dialog as any).showSaveDialog = async (...args: any[]) => ({
        canceled: false,
        filePath:
          args[args.length - 1].title === "导出视频"
            ? files.exported
            : files.saved,
      });
      (dialog as any).showMessageBox = async () => ({
        response: 2,
        checkboxChecked: false,
      });
    },
    { source, replacement, saved, exported },
  );
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept());
  // Read-only analysers observe the actual product GainNodes without adding a second destination path.
  await page.addInitScript({
    content: `
    const NativeAudioContext = window.AudioContext; window.__audioAudit = [];
    class AuditAudioContext extends NativeAudioContext {
      createMediaElementSource(element) {
        const node = super.createMediaElementSource(element); const connect = node.connect.bind(node);
        node.connect = (target, ...rest) => {
          if (target instanceof GainNode) { const analyser = this.createAnalyser(); analyser.fftSize = 1024; target.connect(analyser); window.__audioAudit.push({ element, analyser, gain: target }); }
          return connect(target, ...rest);
        };
        return node;
      }
    }
    window.AudioContext = AuditAudioContext;
  `,
  });
  await page.reload();
  await page.waitForSelector(".app-shell");
  await page.locator(".media-import").click();
  await expect(page.locator(".media-item")).toHaveCount(1, { timeout: 30_000 });
  await page.locator(".media-item").dblclick();
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  await expect
    .poll(async () => {
      const rgba = await canvasPixel();
      return rgba[0] > 220 && rgba[1] < 30 && rgba[2] < 30;
    })
    .toBe(true);
  await page.getByRole("button", { name: "分离音频", exact: true }).click();
  await expect(page.locator(".tl-clip")).toHaveCount(2);
  await expect(page.locator(".media-item")).toHaveCount(2);
  let project = await saveProject();
  const videoAsset = project.assets.find((asset) => asset.kind === "video")!;
  const audioAsset = project.assets.find((asset) => asset.kind === "audio")!;
  const videoClip = project.clips.find(
    (clip) => clip.assetId === videoAsset.id,
  )!;
  const audioClip = project.clips.find(
    (clip) => clip.assetId === audioAsset.id,
  )!;
  assert(
    videoClip.muted,
    "original video audio must be muted after separation",
  );
  assert(!audioClip.muted, "the independent audio must remain audible");
  assert.equal(videoAsset.path, audioAsset.path);
  assert(videoAsset.previewUrl, "MKV should use a local preview proxy");
  assert.equal(audioAsset.previewUrl, videoAsset.previewUrl);
  const playAndMeasure = async () => {
    await page
      .locator(`[data-clip-id="${audioClip.id}"]`)
      .click({ position: { x: 25, y: 26 } });
    await page.keyboard.press("Home");
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect
      .poll(
        async () =>
          Math.max(
            0,
            ...(await audioLevels())
              .filter((level) => level.kind === "AUDIO")
              .map((level) => level.rms),
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0.03);
    const levels = await audioLevels();
    const original = levels.find((level) => level.kind === "VIDEO");
    const separated = levels.find((level) => level.kind === "AUDIO");
    assert(
      original && separated,
      "both actual media GainNodes must be observed",
    );
    assert.equal(original.gain, 0);
    assert(original.rms < 0.001);
    assert(separated.gain > 0.99);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    return levels;
  };
  const levelsBeforeMove = await playAndMeasure();

  await rename(source, replacement);
  await page.getByRole("button", { name: "文件菜单", exact: true }).click();
  await page.getByRole("button", { name: "打开项目", exact: false }).click();
  await expect(page.locator(".media-item.is-missing")).toHaveCount(2, {
    timeout: 30_000,
  });
  // Choose the derived audio asset itself, rather than hiding its failure behind video-first relinking.
  await page
    .locator(`[data-asset-id="${audioAsset.id}"]`)
    .click({ button: "right" });
  await page.getByRole("button", { name: "重新链接素材", exact: true }).click();
  await expect(page.locator(".media-item.is-missing")).toHaveCount(0, {
    timeout: 30_000,
  });
  project = await saveProject();
  assert.equal(project.assets.length, 2);
  assert.equal(project.clips.length, 2);
  assert.deepEqual(
    project.assets.map((asset) => asset.id).sort(),
    [videoAsset.id, audioAsset.id].sort(),
  );
  assert(
    project.assets.every(
      (asset) => asset.path === replacement && !asset.missing,
    ),
  );
  const relinkedVideo = project.assets.find(
    (asset) => asset.id === videoAsset.id,
  )!;
  const relinkedAudio = project.assets.find(
    (asset) => asset.id === audioAsset.id,
  )!;
  assert.equal(relinkedVideo.kind, "video");
  assert.equal(relinkedAudio.kind, "audio");
  assert.equal(relinkedAudio.width, 0);
  assert.equal(relinkedAudio.height, 0);
  assert.equal(relinkedVideo.name, videoAsset.name);
  assert.equal(relinkedAudio.name, audioAsset.name);
  assert.equal(relinkedAudio.previewUrl, relinkedVideo.previewUrl);
  await expect
    .poll(
      async () => {
        const rgba = await canvasPixel();
        return rgba[0] > 220 && rgba[1] < 30 && rgba[2] < 30;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const levelsAfterMove = await playAndMeasure();

  await page.keyboard.press("Escape");
  await page.getByRole("spinbutton", { name: "宽度", exact: true }).fill("320");
  await page.getByRole("spinbutton", { name: "高度", exact: true }).fill("180");
  await page.getByRole("spinbutton", { name: "高度", exact: true }).blur();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(page.getByText("导出完成", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const probe = await probeFile(exported);
  assert(probe.streams.some((stream) => stream.codec_type === "audio"));
  const expectedDuration =
    Math.ceil(
      Math.max(...project.clips.map((clip) => clip.start + clip.duration)) *
        project.fps,
    ) / project.fps;
  assert(
    Math.abs(Number(probe.format.duration) - expectedDuration) < 0.04,
    "export duration must cover the imported source timeline",
  );
  const pcm = await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "0.5",
    "-i",
    exported,
    "-t",
    "0.2",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  let power = 0;
  for (let i = 0; i < pcm.length; i += 4) power += pcm.readFloatLE(i) ** 2;
  const exportRms = Math.sqrt(power / (pcm.length / 4));
  assert(
    exportRms > 0.04 && exportRms < 0.13,
    "export must contain separated audio once, without duplication or silence",
  );
  assert.deepEqual(errors, []);
  const evidence = {
    passedAt: new Date().toISOString(),
    checks: [
      "MKV local preview",
      "UI separates into 2 assets / 2 clips",
      "original muted / independent audio audible",
      "actual GainNode waveform before move",
      "missing original + derived refs after source move",
      "relink from derived audio to shared video source",
      "group preserves IDs/names/kinds/proxies",
      "actual GainNode waveform after relink",
      "UI export has nonduplicated audio",
    ],
    levelsBeforeMove,
    levelsAfterMove,
    exportRms,
    exported,
    project: saved,
    errors,
  };
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "Desktop audio separation/relink verified:",
    JSON.stringify(evidence),
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    console.error("Renderer errors:", errors);
    console.error((await page.locator("body").innerText()).slice(-5000));
  }
  throw error;
} finally {
  if (app) await app.close();
}
