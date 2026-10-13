import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, stat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { GlobalFonts } from "@napi-rs/canvas";
import type { MediaAsset } from "../src/core/types";
import { findMediaTool } from "./mediaTools";
export { findMediaTool } from "./mediaTools";

let mediaShuttingDown = false;
const mediaTasks = new Map<ChildProcess, Promise<void>>();
const proxyTemporaries = new Set<string>();

export function registerBundledFont(fontPath: string): boolean {
  try {
    return Boolean(GlobalFonts.registerFromPath(fontPath, "Noto Sans SC"));
  } catch {
    return false;
  }
}
const developmentFont = path.resolve(
  process.cwd(),
  "public/fonts/NotoSansSC.ttf",
);
if (existsSync(developmentFont)) registerBundledFont(developmentFont);

export function mediaURL(file: string): string {
  return `reacut-media://asset?path=${encodeURIComponent(path.resolve(file))}`;
}

/** Available native fonts are shared by the inspector and export rasterizer. */
export function systemFontFamilies(): string[] {
  return [...new Set(GlobalFonts.families.map((font) => font.family))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export async function runMediaTool(
  name: "ffmpeg" | "ffprobe",
  args: string[],
  timeout = 60_000,
  limit = 16 * 1024 * 1024,
): Promise<Buffer> {
  if (mediaShuttingDown) throw new Error("应用正在关闭。");
  const executable = await findMediaTool(name);
  if (mediaShuttingDown) throw new Error("应用正在关闭。");
  // Local playlists and containers must never expand an import into HTTP/TCP/UDP requests.
  const localArgs =
    name === "ffprobe"
      ? ["-protocol_whitelist", "file,pipe", ...args]
      : args.flatMap((argument) =>
          argument === "-i"
            ? ["-protocol_whitelist", "file,pipe", argument]
            : [argument],
        );
  return new Promise((resolve, reject) => {
    const child = spawn(executable, localArgs, {
      shell: false,
      windowsHide: true,
    });
    let finish!: () => void;
    mediaTasks.set(
      child,
      new Promise<void>((done) => {
        finish = done;
      }),
    );
    const output: Buffer[] = [];
    let bytes = 0;
    let diagnostic = "";
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error(`${name} 超时，请检查媒体是否损坏。`);
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (data: Buffer) => {
      bytes += data.length;
      if (bytes > limit) {
        failure = new Error(`${name} 输出超过安全限制。`);
        child.kill("SIGKILL");
      } else output.push(data);
    });
    child.stderr.on("data", (data) => {
      diagnostic = (diagnostic + String(data)).slice(-12_000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      mediaTasks.delete(child);
      finish();
      if (failure || code !== 0)
        reject(
          failure ??
            new Error(`${name} 执行失败：${diagnostic.trim() || code}`),
        );
      else resolve(Buffer.concat(output));
    });
  });
}

/** Stop import/probe/proxy workers, and prevent new work while the app is quitting. */
export async function shutdownMediaTasks(): Promise<void> {
  mediaShuttingDown = true;
  const pending = [...mediaTasks];
  for (const [child] of pending) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const [child] of pending)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
  }, 2000);
  timer.unref();
  try {
    await Promise.all(pending.map(([, done]) => done));
    await Promise.all(
      [...proxyTemporaries].map((file) =>
        rm(file, { force: true }).catch(() => {}),
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function systemMediaInfo(): Promise<{
  ffmpeg: boolean;
  ffmpegVersion?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
}> {
  try {
    const ffmpegPath = await findMediaTool("ffmpeg");
    const ffprobePath = await findMediaTool("ffprobe");
    const output = await runMediaTool("ffmpeg", ["-version"], 10_000);
    return {
      ffmpeg: true,
      ffmpegPath,
      ffprobePath,
      ffmpegVersion: output.toString().split("\n")[0],
    };
  } catch {
    return { ffmpeg: false };
  }
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}
export interface ProbeResult {
  streams: ProbeStream[];
  format: { duration?: string; format_name?: string };
}
export async function probeFile(file: string): Promise<ProbeResult> {
  return JSON.parse(
    (
      await runMediaTool("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        file,
      ])
    ).toString(),
  );
}
function frameRate(raw?: string): number {
  if (!raw) return 0;
  const [a, b = "1"] = raw.split("/");
  const fps = Number(a) / Number(b);
  return Number.isFinite(fps) ? fps : 0;
}

function needsPreviewProxy(
  file: string,
  asset: MediaAsset,
  probe: ProbeResult,
): boolean {
  const extension = path.extname(file).toLowerCase();
  if (asset.kind === "image")
    return [".heic", ".heif", ".tif", ".tiff"].includes(extension);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const audioSupported =
    !audio ||
    [
      "aac",
      "mp3",
      "opus",
      "vorbis",
      "flac",
      "pcm_s16le",
      "pcm_s24le",
      "pcm_f32le",
      "pcm_u8",
    ].includes(audio.codec_name ?? "");
  if (asset.kind === "audio")
    return (
      !audioSupported ||
      ![
        ".mp3",
        ".m4a",
        ".aac",
        ".wav",
        ".flac",
        ".ogg",
        ".oga",
        ".opus",
        ".webm",
      ].includes(extension)
    );
  const unsupportedH264Pixels =
    video?.codec_name === "h264" &&
    video.pix_fmt &&
    !["yuv420p", "yuvj420p"].includes(video.pix_fmt);
  return (
    Boolean(unsupportedH264Pixels) ||
    !audioSupported ||
    !["h264", "vp8", "vp9", "av1", "theora"].includes(
      video?.codec_name ?? "",
    ) ||
    ![".mp4", ".m4v", ".webm", ".ogv", ".ogg"].includes(extension)
  );
}

async function previewProxy(
  file: string,
  asset: MediaAsset,
  probe: ProbeResult,
  cacheDir: string,
  hash: string,
): Promise<string | undefined> {
  if (!needsPreviewProxy(file, asset, probe)) return;
  const extension =
    asset.kind === "image" ? "png" : asset.kind === "audio" ? "m4a" : "mp4";
  const destination = path.join(cacheDir, `${hash}-preview-v1.${extension}`);
  try {
    await access(destination);
    return mediaURL(destination);
  } catch {
    /* Generate below. */
  }
  const temporary = path.join(cacheDir, `${hash}-${randomUUID()}.${extension}`);
  proxyTemporaries.add(temporary);
  try {
    const args = ["-v", "error", "-y", "-i", file];
    if (asset.kind === "image") args.push("-frames:v", "1", temporary);
    else if (asset.kind === "audio")
      args.push(
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        temporary,
      );
    else {
      args.push(
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=w=min(1920\\,iw):h=min(1080\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        temporary,
      );
    }
    await runMediaTool("ffmpeg", args, 15 * 60_000);
    await rename(temporary, destination);
    return mediaURL(destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    proxyTemporaries.delete(temporary);
  }
}

export async function importAssets(
  paths: string[],
  cacheDir: string,
): Promise<MediaAsset[]> {
  await mkdir(cacheDir, { recursive: true });
  const assets: MediaAsset[] = [];
  for (const supplied of paths) {
    const file = path.resolve(supplied);
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new Error(`无法导入目录：${file}`);
    const probe = await probeFile(file);
    const video = probe.streams.find((s) => s.codec_type === "video");
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    if (!video && !audio)
      throw new Error(`没有可编辑的音视频流：${path.basename(file)}`);
    const image = Boolean(
      video &&
      (/\b(image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe)\b/.test(
        probe.format.format_name ?? "",
      ) ||
        /\.(png|jpe?g|webp|bmp|tiff?|heic|heif|avif)$/i.test(file)),
    );
    const duration = image
      ? 0
      : Math.max(
          Number(probe.format.duration) || 0,
          Number(video?.duration) || 0,
          Number(audio?.duration) || 0,
        );
    if (!image && duration <= 0)
      throw new Error(`无法读取媒体时长：${path.basename(file)}`);
    const rotation =
      video?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
      Number(video?.tags?.rotate ?? 0);
    const rotated = Math.abs(rotation % 180) === 90;
    const [sarNumerator, sarDenominator] = (video?.sample_aspect_ratio ?? "1:1")
      .split(":")
      .map(Number);
    const sar =
      sarNumerator > 0 && sarDenominator > 0
        ? sarNumerator / sarDenominator
        : 1;
    const displayWidth = Math.round((video?.width ?? 0) * sar);
    const displayHeight = video?.height ?? 0;
    const asset: MediaAsset = {
      id: randomUUID(),
      name: path.basename(file),
      path: file,
      url: mediaURL(file),
      kind: image ? "image" : video ? "video" : "audio",
      duration,
      width: rotated ? displayHeight : displayWidth,
      height: rotated ? displayWidth : displayHeight,
      fps: image ? 0 : frameRate(video?.avg_frame_rate ?? video?.r_frame_rate),
      hasAudio: Boolean(audio),
    };
    const hash = createHash("sha256")
      .update(`${file}:${metadata.size}:${metadata.mtimeMs}`)
      .digest("hex")
      .slice(0, 24);
    try {
      asset.previewUrl = await previewProxy(file, asset, probe, cacheDir, hash);
    } catch (error) {
      asset.previewError = `无法生成本地预览代理：${error instanceof Error ? error.message : String(error)}`;
    }
    if (video) {
      const thumbnail = path.join(cacheDir, `${hash}.jpg`);
      try {
        await access(thumbnail);
      } catch {
        try {
          await runMediaTool("ffmpeg", [
            "-v",
            "error",
            "-y",
            ...(image ? [] : ["-ss", String(Math.min(0.1, duration / 2))]),
            "-i",
            file,
            "-frames:v",
            "1",
            "-vf",
            "scale=w=ceil(iw*sar/2)*2:h=ih,setsar=1,scale=320:180:force_original_aspect_ratio=decrease",
            "-q:v",
            "3",
            thumbnail,
          ]);
        } catch {
          /* Media stays usable even if a decoder cannot produce its thumbnail. */
        }
      }
      try {
        await access(thumbnail);
        asset.thumbnail = mediaURL(thumbnail);
      } catch {
        /* optional */
      }
    }
    if (audio) {
      try {
        // Rectify before downsampling: raw 200 Hz audio discards audible tones instead of their envelope.
        const waveformRate = Math.max(
          1,
          Math.min(200, Math.floor(2_000_000 / duration)),
        );
        const pcm = await runMediaTool(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            file,
            "-t",
            String(duration),
            "-vn",
            "-af",
            "aformat=channel_layouts=stereo,aeval=(abs(val(0))+abs(val(1)))/2:c=mono",
            "-ar",
            String(waveformRate),
            "-f",
            "f32le",
            "pipe:1",
          ],
          60_000,
        );
        const samples = Math.floor(pcm.length / 4);
        const bins = Math.min(160, samples);
        asset.waveform = Array.from({ length: bins }, (_, bin) => {
          const from = Math.floor((bin * samples) / bins);
          const to = Math.floor(((bin + 1) * samples) / bins);
          let power = 0;
          for (let i = from; i < to; i++) power += pcm.readFloatLE(i * 4) ** 2;
          return Math.sqrt(power / Math.max(1, to - from));
        });
        const peak = Math.max(...asset.waveform, 0.001);
        asset.waveform = asset.waveform.map((value) =>
          Math.min(1, value / peak),
        );
      } catch {
        /* optional waveform */
      }
    }
    assets.push(asset);
  }
  return assets;
}
