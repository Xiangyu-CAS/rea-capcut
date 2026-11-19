/** Measures ReaCut on three generated 4K sources. Timing results depend on the host. */
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { importAssets, probeFile, runMediaTool } from "../electron/media";
import { createExportArguments, startExport } from "../electron/export";
import { createClip, createProject, createTrack } from "../src/core/model";
import type { ExportOptions } from "../src/core/types";

const root = path.resolve(".test-output/benchmark-4k-electron", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(root, { recursive: true });
const files = [];
const existing = process.env.REACUT_BENCHMARK_FIXTURES;
for (const [index, color] of ["red", "blue", "green"].entries()) {
  const file = path.resolve(existing ?? root, `source-${index}.mp4`);
  if (!existing) await runMediaTool("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=3840x2160:r=30:d=8",
    "-vf", `drawbox=x=50:y=50:w=500:h=300:c=${color}:t=fill`,
    "-c:v", "libx264", "-threads", "4", "-preset", "ultrafast", "-g", "60", "-pix_fmt", "yuv420p", file,
  ], 120000);
  files.push(file);
}
const project = createProject("4K synthetic preview benchmark");
project.width = 3840;
project.height = 2160;
project.assets = await importAssets(files, path.join(root, "fixture-cache"));
assert(project.assets.every(asset => !asset.previewUrl), "The original comparison requires directly playable 4K media.");
project.tracks = project.assets.map((_, i) => createTrack("video", `Layer ${i + 1}`));
project.clips = project.assets.map((asset, i) => {
  const clip = createClip(asset, project.tracks[i].id, 0, project.fps);
  clip.transform = { ...clip.transform, x: i === 2 ? 0 : i === 0 ? -920 : 920, y: i === 2 ? 0 : -420, scale: i === 2 ? 1 : .44 };
  clip.adjustments.brightness = .05;
  return clip;
});
const file = path.join(root, "4k.reacut");
await writeFile(file, JSON.stringify(project));
const data = path.join(root, "user-data");
const app = await electron.launch({ args: [path.resolve("dist-electron/main.cjs")], env: {
  ...process.env, REACUT_USER_DATA: data, VITE_DEV_SERVER_URL: "",
} });
const errors: string[] = [];
const measurements = [];
let proxyBuildMs = 0;
try {
  const page = await app.firstWindow();
  await app.evaluate(({ dialog, BrowserWindow }, fixture) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
    BrowserWindow.getAllWindows()[0].setSize(1440, 900);
  }, file);
  page.on("pageerror", error => errors.push(error.message));
  await page.waitForSelector(".app-shell");
  await page.evaluate(`(() => {
    const videoFrames = [];
    Reflect.set(window, "benchmarkVideoFrames", videoFrames);
    const create = document.createElement.bind(document);
    document.createElement = (tag, options) => {
      const element = create(tag, options);
      if (element instanceof HTMLVideoElement) {
        const record = { video: element, mediaTime: -1 };
        videoFrames.push(record);
        const observe = (_, frame) => {
          if (!element.hasAttribute("src")) return;
          record.mediaTime = frame.mediaTime;
          element.requestVideoFrameCallback(observe);
        };
        element.requestVideoFrameCallback(observe);
      }
      return element;
    };
    document.addEventListener("pointermove", event => {
      if (event.buttons === 1) Reflect.set(window, "benchmarkScrubStart", performance.now());
    }, true);
  })()`);
  await page.getByRole("button", { name: /^(File menu|文件菜单)$/ }).click();
  await page.getByRole("button", { name: /^(Open project|打开项目)/ }).click();
  try { await expect(page.locator(".tl-clip")).toHaveCount(3, { timeout: 10000 }); }
  catch (error) {
    console.error("Benchmark fixture open failed:", await page.locator(".toast").allTextContents(), errors);
    throw error;
  }
  const ruler = (await page.locator(".tl-ruler-body").boundingBox())!;
  const y = ruler.y + 20;
  const widths = () => page.evaluate(() => {
    const frames = Reflect.get(window, "benchmarkVideoFrames") as { video: HTMLVideoElement }[];
    return frames.filter(entry => entry.video.hasAttribute("src")).map(entry => entry.video.videoWidth);
  });
  const checkWidth = async (expected: number) => expect.poll(widths, { timeout: 30000 }).toEqual([expected, expected, expected]);
  const seek = (time: number) => page.mouse.click(ruler.x + time * 60, y);
  const sample = async (expectedWidth: number) => {
    await checkWidth(expectedWidth);
    await seek(.4);
    await page.mouse.move(ruler.x + 24, y);
    await page.mouse.down();
    const scrubMs: number[] = [];
    for (const time of [1.4, 5.2, 2.4, 6.7, .7, 4.2, 3.5, 1.8]) {
      await page.mouse.move(ruler.x + time * 60, y);
      const handle = await page.waitForFunction(target => {
        const frames = Reflect.get(window, "benchmarkVideoFrames") as { video: HTMLVideoElement; mediaTime: number }[];
        const active = frames.filter(entry => entry.video.hasAttribute("src"));
        if (active.length !== 3 || active.some(entry => entry.video.seeking ||
          Math.abs(entry.mediaTime - target) > 1 / 30 + .003)) return false;
        return performance.now() - Number(Reflect.get(window, "benchmarkScrubStart"));
      }, time, { polling: "raf", timeout: 15000 });
      scrubMs.push(Math.round(await handle.jsonValue() as number));
      await handle.dispose();
    }
    await page.mouse.up();
    await seek(.6);
    await page.getByRole("button", { name: /^(Play|播放)$/ }).click();
    const playback = await page.evaluate(`(async () => {
      const frames = Reflect.get(window, "benchmarkVideoFrames");
      const active = frames.filter(entry => entry.video.hasAttribute("src"));
      const before = active.map(entry => entry.video.getVideoPlaybackQuality());
      const playhead = () => Number(document.querySelector(".tl-playhead-handle")?.getAttribute("aria-valuenow"));
      const initialTime = playhead();
      const observations = active.map(() => new Set());
      let last = performance.now(), rafGapsOver50Ms = 0;
      const start = last;
      await new Promise(resolve => {
        const tick = (now) => {
          if (now - last > 50) rafGapsOver50Ms++;
          last = now;
          active.forEach((entry, index) => observations[index].add(Math.round(entry.mediaTime * 30)));
          if (now - start < 4500) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return {
        wallMs: Math.round(last - start), timelineSeconds: Number((playhead() - initialTime).toFixed(3)),
        rafGapsOver50Ms, renderedMediaTimes: observations.map(set => set.size),
        videos: active.map(({ video }, index) => {
          const quality = video.getVideoPlaybackQuality();
          return { total: quality.totalVideoFrames - before[index].totalVideoFrames,
            dropped: quality.droppedVideoFrames - before[index].droppedVideoFrames };
        }),
      };
    })()`);
    await page.getByRole("button", { name: /^(Pause|暂停)$/ }).click();
    return { sourceWidth: expectedWidth, scrubMs, playback };
  };
  measurements.push(await sample(3840));
  const toggle = page.getByRole("button", { name: /^(Proxy mode|代理模式)$/ });
  const enabledAt = performance.now();
  await toggle.click();
  await expect(page.getByText(/^(Proxies ready|代理就绪) 3\/3$/)).toBeVisible({ timeout: 120000 });
  await checkWidth(960);
  proxyBuildMs = Math.round(performance.now() - enabledAt);
  measurements.push(await sample(960));
  measurements.push(await sample(960));
  await toggle.click();
  measurements.push(await sample(3840));
  assert.deepEqual(errors, []);
} finally { await app.close(); }

const options: ExportOptions = {
  width: project.width, height: project.height, fps: project.fps, quality: "standard", format: "mp4",
  path: path.join(root, "standard.mp4"), range: { start: 0, end: 4 },
};
const start = performance.now();
await new Promise<void>((resolve, reject) => {
  void startExport(project, options, event => {
    if (event.status === "complete") resolve();
    if (event.status === "error" || event.status === "cancelled") reject(new Error(event.message ?? event.status));
  }).catch(reject);
});
const exportMs = Math.round(performance.now() - start);
const output = await probeFile(options.path);
const video = output.streams.find(stream => stream.codec_type === "video");
assert.equal(video?.width, 3840);
assert.equal(video?.height, 2160);
assert.equal(Number(output.format.duration), 4);

let hardware: { ms?: number; error?: string } = {};
if (process.platform === "darwin") {
  const hardwarePath = path.join(root, "videotoolbox.mp4");
  const arguments_ = await createExportArguments(project, options, root, hardwarePath);
  arguments_[arguments_.indexOf("libx264")] = "h264_videotoolbox";
  arguments_.splice(arguments_.indexOf("-preset"), 2);
  arguments_.splice(arguments_.indexOf("-crf"), 2, "-b:v", "28M", "-allow_sw", "0");
  try {
    const startHardware = performance.now();
    await runMediaTool("ffmpeg", arguments_, 180000);
    hardware = { ms: Math.round(performance.now() - startHardware) };
    const result = await probeFile(hardwarePath);
    assert.equal(result.streams.find(stream => stream.codec_type === "video")?.width, 3840);
    assert.equal(Number(result.format.duration), 4);
  } catch (error) { hardware = { error: String(error).split("\n").at(-1) }; }
}
const proxies = (await readdir(path.join(data, "thumbnails"))).filter(file => file.endsWith("-proxy-960-v1.mp4"));
assert.equal(proxies.length, 3);
const evidence = {
  hardwareModel: os.cpus()[0].model, os: os.release(), arch: process.arch, proxyBuildMs,
  measurements, exportMs, hardware, sources: "3 × 3840×2160 30 fps H.264, three visible tracks with brightness adjustment",
};
await writeFile(path.join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
