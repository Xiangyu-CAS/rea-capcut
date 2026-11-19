/** Actual editor UI, Web Audio gains, restart, and FFmpeg export using synthetic tones. */
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { firstChineseWindow } from "./ui-language";
import { importAssets, probeFile, runMediaTool } from "../electron/media";
import { analyzeAudio } from "../electron/audioAnalysis";
import { createClip, createProject, createTrack, validateProject } from "../src/core/model";
import { dbGain, DEFAULT_DUCKING, duckingEnvelope, duckingGain } from "../src/core/audioMix";
import type { Project } from "../src/core/types";

const root = path.resolve(".test-output/audio-mix-electron", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(root, { recursive: true });
const voice = path.join(root, "synthetic-voice.wav");
const music = path.join(root, "synthetic-music.wav");
const silence = path.join(root, "silence.wav");
for (const [file, generator] of [
  [voice, "aevalsrc='if(between(t,1,2)+between(t,4,4.5),0.07*sin(2*PI*660*t),0)':s=48000:d=6"],
  [music, "aevalsrc=0.12*sin(2*PI*220*t):s=48000:d=6"],
  [silence, "anullsrc=r=48000:cl=mono:d=6"],
]) await runMediaTool("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", generator, "-c:a", "pcm_s16le", file]);
const [voiceAsset, musicAsset, silenceAsset] = await importAssets([voice, music, silence], path.join(root, "fixture-cache"));
const project = createProject("音频处理验收");
project.width = 320;
project.height = 180;
project.assets = [voiceAsset, musicAsset, silenceAsset];
const voiceTrack = createTrack("audio", "人声验收轨");
const musicTrack = createTrack("audio", "音乐验收轨");
project.tracks = [voiceTrack, musicTrack];
const voiceClip = createClip(voiceAsset, voiceTrack.id, 0, project.fps);
const overlap = { ...createClip(voiceAsset, voiceTrack.id, 1.6, project.fps), duration: 1.2, sourceIn: 1, volume: .6 };
const musicClip = createClip(musicAsset, musicTrack.id, 0, project.fps);
project.clips = [voiceClip, overlap, musicClip];
const saved = path.join(root, "mix.reacut"), exported = path.join(root, "mix.mp4");
await writeFile(saved, JSON.stringify(project));
const before = createHash("sha256").update(await readFile(voice)).digest("hex");

const normal = { mode: "normalize", clipIds: [voiceClip.id, overlap.id], targetLufs: -16 } as const;
const silent = { ...project, clips: [{ ...voiceClip, assetId: silenceAsset.id }] };
await assert.rejects(analyzeAudio(silent, { ...normal, clipIds: [voiceClip.id] }, new AbortController().signal, () => {}), /too short or quiet/);
await assert.rejects(analyzeAudio({
  ...project, clips: [voiceClip, { ...overlap, assetId: silenceAsset.id }],
}, normal, new AbortController().signal, () => {}), /too short or quiet/);
await assert.rejects(analyzeAudio(project, { ...normal, clipIds: [voiceClip.id, voiceClip.id] },
  new AbortController().signal, () => {}), /distinct/);
const controller = new AbortController();
await assert.rejects(analyzeAudio(project, normal, controller.signal, () => controller.abort()));
const bad = structuredClone(project);
bad.clips[0].audioGainDb = Infinity;
assert.throws(() => validateProject(bad));
const measurements = await analyzeAudio(project, normal, new AbortController().signal, () => {});
assert(measurements.mode === "normalize" && measurements.measurements.length === 2);
const [analysis, overlapAnalysis] = measurements.measurements;
assert(analysis.gainDb > 3);
assert(analysis.truePeakDb + analysis.gainDb <= -1.5 && Math.abs(analysis.lufs + analysis.gainDb + 16) < .01);
const peakFile = path.join(root, "transient.wav");
await runMediaTool("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
  "aevalsrc='if(between(t,0.5,0.501),0.995,0.035*sin(2*PI*660*t))':s=48000:d=3", peakFile]);
const [peakAsset] = await importAssets([peakFile], path.join(root, "fixture-cache"));
const peakResult = await analyzeAudio({ ...project, assets: [peakAsset], clips: [{ ...voiceClip, assetId: peakAsset.id, duration: 3 }] },
  { ...normal, clipIds: [voiceClip.id] }, new AbortController().signal, () => {});
assert(peakResult.mode === "normalize");
const [peak] = peakResult.measurements;
assert(Math.abs(peak.truePeakDb + peak.gainDb - (-1.5)) < .01 && peak.lufs + peak.gainDb < -18);

let app!: ElectronApplication, page!: Page;
const errors: string[] = [];
async function open() {
  const bundle = process.env.REACUT_TEST_APP;
  const env = Object.fromEntries(Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ));
  env.VITE_DEV_SERVER_URL = "";
  env.REACUT_USER_DATA = path.join(root, "user-data");
  if (bundle) {
    env.PATH = "";
    delete env.REACUT_FFMPEG;
    delete env.REACUT_FFPROBE;
  }
  app = await electron.launch({
    ...(bundle ? { executablePath: path.join(bundle, "Contents/MacOS/ReaCut"), args: [saved] }
      : { args: [path.resolve("dist-electron/main.cjs"), saved] }), env,
  });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(bundle));
  page = await firstChineseWindow(app);
  page.on("pageerror", error => errors.push(error.message));
  await app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  }, exported);
  await expect(page.locator(".tl-clip")).toHaveCount(3);
}
const save = async (): Promise<Project> => {
  const mtime = (await stat(saved)).mtimeMs;
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect.poll(async () => (await stat(saved)).mtimeMs).toBeGreaterThan(mtime);
  return JSON.parse(await readFile(saved, "utf8"));
};
try {
  await open();
  await page.locator(`[data-clip-id="${voiceClip.id}"]`).click({ position: { x: 20, y: 25 } });
  await page.locator(`[data-clip-id="${overlap.id}"]`).click({ position: { x: 20, y: 25 }, modifiers: ["Shift"] });
  await page.getByRole("button", { name: "音频", exact: true }).last().click();
  await page.getByRole("button", { name: "响度统一…", exact: true }).click();
  let modal = page.getByRole("dialog", { name: "响度统一" });
  await expect(modal.getByText("已选 2 个可处理片段")).toBeVisible();
  await expect(modal.getByLabel("目标响度（LUFS）")).toHaveValue("-23");
  await modal.getByLabel("目标响度（LUFS）").selectOption("-16");
  await modal.getByRole("button", { name: "分析", exact: true }).click();
  await expect(modal.getByText(/实测响度.*LUFS/)).toHaveCount(2);
  await modal.getByRole("button", { name: "应用", exact: true }).click();
  const normalized = await save();
  assert(Math.abs(normalized.clips[0].audioGainDb! - analysis.gainDb) < .01);
  assert(Math.abs(normalized.clips[1].audioGainDb! - overlapAnalysis.gainDb) < .01);
  assert.equal(normalized.clips[2].audioGainDb, undefined);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert((await save()).clips.every(clip => clip.audioGainDb === undefined));
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.deepEqual((await save()).clips.map(clip => clip.audioGainDb), normalized.clips.map(clip => clip.audioGainDb));

  await page.getByRole("button", { name: "自动压低背景音乐", exact: true }).click();
  modal = page.getByRole("dialog", { name: "自动压低背景音乐" });
  await modal.getByLabel("背景音乐轨道").selectOption(musicTrack.id);
  await modal.getByLabel("人声轨道").selectOption(voiceTrack.id);
  await modal.getByRole("button", { name: "分析", exact: true }).click();
  await expect(modal.getByText("已检测到 2 段活动音频")).toBeVisible();
  await modal.getByRole("button", { name: "应用", exact: true }).click();
  const applied = await save();
  const automation = applied.tracks.find(track => track.id === musicTrack.id)!.audioDucking!;
  assert.equal(automation.regions.length, 2);
  assert(Math.abs(automation.regions[0].start - 1) < .02 && Math.abs(automation.regions[0].end - 2.6) < .02);
  assert(Math.abs(automation.regions[1].start - 4) < .02 && Math.abs(automation.regions[1].end - 4.5) < .02);
  const curve = duckingEnvelope(automation);
  assert.equal(duckingGain(curve, .6), 1);
  assert(Math.abs(duckingGain(curve, 2.35) - dbGain(-12)) < .0001);
  assert.equal(duckingGain(curve, 3.3), 1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert(!(await save()).tracks.find(track => track.id === musicTrack.id)!.audioDucking);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.deepEqual((await save()).tracks.find(track => track.id === musicTrack.id)!.audioDucking, automation);

  await app.close();
  await open();
  assert.deepEqual((await save()).tracks.find(track => track.id === musicTrack.id)!.audioDucking, automation);
  await page.evaluate(() => {
    const values: { media: HTMLMediaElement; gain: GainNode }[] = [];
    Reflect.set(window, "audioMixAudit", values);
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      createMediaElementSource(element: HTMLMediaElement) {
        const source = super.createMediaElementSource(element);
        const connect = source.connect.bind(source);
        source.connect = ((target: AudioNode, ...args: number[]) => {
          if (target instanceof GainNode) values.push({ media: element, gain: target });
          return Reflect.apply(connect, source, [target, ...args]);
        }) as typeof source.connect;
        return source;
      }
    };
  });
  const ruler = (await page.locator(".tl-ruler-body").boundingBox())!;
  const gains: number[] = [];
  for (const [time, expected] of [[.2, 1], [1.3, dbGain(-12)], [3.1, 1]]) {
    await page.mouse.click(ruler.x + time * 60, ruler.y + 20);
    await page.getByRole("button", { name: "播放", exact: true }).click();
    const value = await page.waitForFunction(({ file, expected }) => {
      const audit = Reflect.get(window, "audioMixAudit") as { media: HTMLMediaElement; gain: GainNode }[];
      const entry = audit?.find(({ media }) => new URL(media.src).searchParams.get("path") === file && !media.paused);
      return entry && Math.abs(entry.gain.gain.value - expected) < .05 ? entry.gain.gain.value : false;
    }, { file: music, expected });
    gains.push(await value.jsonValue() as number);
    await value.dispose();
    await page.getByRole("button", { name: "暂停", exact: true }).click();
  }
  await page.getByRole("button", { name: "导出", exact: true }).click();
  modal = page.getByRole("dialog", { name: "导出视频" });
  await modal.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(modal.getByText("导出完成", { exact: true })).toBeVisible({ timeout: 30000 });
  const probe = await probeFile(exported);
  assert.equal(Number(probe.format.duration), 6);
  assert(probe.streams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac"));
  const amplitude = async (time: number) => {
    const pcm = await runMediaTool("ffmpeg", ["-v", "error", "-ss", String(time), "-i", exported,
      "-vn", "-ac", "1", "-ar", "48000", "-t", "0.12", "-f", "f32le", "pipe:1"]);
    let cos = 0, sin = 0;
    for (let i = 0; i < pcm.length / 4; i++) {
      const sample = pcm.readFloatLE(i * 4), phase = 2 * Math.PI * 220 * i / 48000;
      cos += sample * Math.cos(phase);
      sin += sample * Math.sin(phase);
    }
    return 2 * Math.hypot(cos, sin) / (pcm.length / 4);
  };
  const [loud, down, restored, secondDown] = await Promise.all([.5, 1.3, 3.2, 4.2].map(amplitude));
  for (const value of [down, secondDown]) assert(Math.abs(20 * Math.log10(value / loud) + DEFAULT_DUCKING.reductionDb) < 1);
  assert(Math.abs(20 * Math.log10(restored / loud)) < 1);
  assert.equal(createHash("sha256").update(await readFile(voice)).digest("hex"), before);
  assert.deepEqual(errors, []);
  const evidence = { lufs: analysis.lufs, gainDb: analysis.gainDb, truePeakDb: analysis.truePeakDb,
    peakLimitedGainDb: peak.gainDb, normalizedClips: 2, automation, previewGains: gains, exportMusicDb: 20 * Math.log10(down / loud),
    rendererErrors: errors, sourceUnchanged: true };
  await writeFile(path.join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(evidence);
} finally { await app?.close(); }
