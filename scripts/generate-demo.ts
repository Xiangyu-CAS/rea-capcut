import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  createClip,
  createProject,
  createTrack,
  validateProject,
} from "../src/core/model";
import { DEFAULT_TEXT } from "../src/core/defaults";
import type { Clip, MediaAsset } from "../src/core/types";
import { importAssets, probeFile, runMediaTool } from "../electron/media";
import { startExport } from "../electron/export";

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const SEED = 0x524541;
function random(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
interface Palette {
  sky: string;
  horizon: string;
  water: string;
  ink: string;
  sun: string;
  ridges: string[];
  night?: boolean;
}
const palettes: Palette[] = [
  {
    sky: "#283847",
    horizon: "#f2ba91",
    water: "#355c68",
    ink: "#102b36",
    sun: "#ffddaa",
    ridges: ["#afa1a1", "#817f8e", "#606c80", "#3f566c", "#294351"],
  },
  {
    sky: "#224b69",
    horizon: "#bedee2",
    water: "#2e7c89",
    ink: "#0c3342",
    sun: "#eff4d7",
    ridges: ["#93b7c5", "#7ba7b9", "#568ca0", "#376d85", "#1b4d64"],
  },
  {
    sky: "#152139",
    horizon: "#a0788d",
    water: "#24475d",
    ink: "#0e2133",
    sun: "#fff0ce",
    ridges: ["#716785", "#575670", "#41455f", "#293c52", "#192f45"],
    night: true,
  },
];

function ridge(
  context: SKRSContext2D,
  rng: () => number,
  base: number,
  amplitude: number,
  color: string,
) {
  context.beginPath();
  context.moveTo(-80, HEIGHT);
  for (let x = -80; x <= WIDTH + 80; x += 40) {
    const y =
      base -
      Math.abs(Math.sin(x / 240 + base * 0.012)) * amplitude -
      rng() * amplitude * 0.24;
    context.lineTo(x, y);
  }
  context.lineTo(WIDTH + 80, HEIGHT);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

/** These landscapes are original geometry and seeded noise; there are no downloaded assets. */
async function landscape(file: string, index: number) {
  const rng = random(SEED + index * 1000);
  const colors = palettes[index];
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  const sky = context.createLinearGradient(0, 0, 0, HEIGHT * 0.65);
  sky.addColorStop(0, colors.sky);
  sky.addColorStop(1, colors.horizon);
  context.fillStyle = sky;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const sunX = WIDTH * (index === 1 ? 0.28 : 0.76);
  const sunY = HEIGHT * 0.235;
  const glow = context.createRadialGradient(sunX, sunY, 10, sunX, sunY, 220);
  glow.addColorStop(0, `${colors.sun}60`);
  glow.addColorStop(1, `${colors.sun}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  if (colors.night)
    for (let i = 0; i < 130; i++) {
      context.fillStyle = `rgba(235,240,255,${0.12 + rng() * 0.65})`;
      context.beginPath();
      context.arc(
        rng() * WIDTH,
        rng() * HEIGHT * 0.4,
        0.5 + rng(),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  context.fillStyle = colors.sun;
  context.beginPath();
  context.arc(sunX, sunY, colors.night ? 23 : 36, 0, Math.PI * 2);
  context.fill();
  colors.ridges.forEach((color, layer) =>
    ridge(context, rng, 350 + layer * 30, 100 - layer * 9, color),
  );
  const horizon = HEIGHT * 0.6;
  const water = context.createLinearGradient(0, horizon, 0, HEIGHT);
  water.addColorStop(0, colors.horizon);
  water.addColorStop(0.18, colors.water);
  water.addColorStop(1, colors.ink);
  context.fillStyle = water;
  context.fillRect(0, horizon, WIDTH, HEIGHT - horizon);
  for (let i = 0; i < 260; i++) {
    const y = horizon + rng() * (HEIGHT - horizon);
    const spread = 10 + (y - horizon) * 0.58;
    const x = sunX + (rng() - 0.5) * spread;
    context.strokeStyle = `${colors.sun}${Math.floor(15 + rng() * 30)
      .toString(16)
      .padStart(2, "0")}`;
    context.lineWidth = 0.6 + rng();
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 12 + rng() * 42, y);
    context.stroke();
  }
  for (let i = 0; i < 110; i++) {
    const y = horizon + 10 + rng() * (HEIGHT - horizon);
    context.strokeStyle = "rgba(188,220,222,0.12)";
    context.lineWidth = 0.5;
    context.beginPath();
    context.moveTo(rng() * WIDTH, y);
    context.lineTo(rng() * WIDTH, y);
    context.stroke();
  }
  context.fillStyle = colors.ink;
  context.beginPath();
  context.moveTo(0, HEIGHT * 0.86);
  context.bezierCurveTo(
    WIDTH * 0.12,
    HEIGHT * 0.78,
    WIDTH * 0.22,
    HEIGHT * 0.93,
    WIDTH * 0.4,
    HEIGHT,
  );
  context.lineTo(0, HEIGHT);
  context.fill();
  context.strokeStyle = colors.ink;
  context.lineWidth = 2;
  for (let i = 0; i < 55; i++) {
    const x = rng() * WIDTH * 0.23;
    const y = HEIGHT * (0.88 + rng() * 0.12);
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(
      x + rng() * 16,
      y - 20,
      x - 12 + rng() * 24,
      y - 22 - rng() * 60,
    );
    context.stroke();
  }
  await writeFile(file, canvas.toBuffer("image/png"));
}

function title(
  trackId: string,
  start: number,
  content: string,
  y: number,
  size: number,
  bold = false,
): Clip {
  const clip = createClip(undefined, trackId, start, FPS);
  return {
    ...clip,
    duration: 3,
    name: content,
    text: {
      ...DEFAULT_TEXT,
      text: content,
      fontSize: size,
      fontFamily: "Noto Sans SC",
      bold,
      strokeWidth: bold ? 1 : 0,
      stroke: "#20313d",
      color: "#f1f4ef",
    },
    transform: { ...clip.transform, y },
    fadeIn: 0.4,
    fadeOut: 0.35,
  };
}

export async function generateDemo(directory = path.resolve(".demo")) {
  await mkdir(directory, { recursive: true });
  const names = ["晨光山谷", "青蓝湖泊", "暮色微光"];
  const images: string[] = [];
  const videos: string[] = [];
  for (let index = 0; index < 3; index++) {
    const image = path.join(directory, `${index + 1}-${names[index]}.png`);
    const video = path.join(directory, `${index + 1}-${names[index]}.mp4`);
    await landscape(image, index);
    images.push(image);
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      image,
      "-vf",
      `zoompan=z='1+0.035*on/89':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=90:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
      "-t",
      "3",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "17",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    videos.push(video);
  }
  const audio = path.join(directory, "环境和弦.wav");
  await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.1*(0.55*sin(2*PI*220*t)+0.3*sin(2*PI*329.6276*t)+0.15*sin(2*PI*440*t))*(0.75+0.25*sin(2*PI*0.11*t)):s=48000:d=9",
    "-c:a",
    "pcm_s16le",
    audio,
  ]);
  const assets = await importAssets(
    [...videos, ...images, audio],
    path.join(directory, "cache"),
  );
  assets.slice(0, 3).forEach((asset, index) => {
    asset.thumbnail = assets[index + 3].url;
  });
  assets.slice(3, 6).forEach((asset) => {
    asset.thumbnail = asset.url;
  });
  const project = createProject("山海之间 · 原创演示");
  project.width = WIDTH;
  project.height = HEIGHT;
  project.fps = FPS;
  project.background = "#0c1d2b";
  project.assets = assets;
  const captions = createTrack("text", "字幕 · 情绪与节奏");
  project.tracks.splice(1, 0, captions);
  const titleTrack = project.tracks[0].id;
  const videoTrack = project.tracks[2].id;
  const audioTrack = project.tracks[3].id;
  const headers = ["山海之间", "循光而行", "把时间留给自己"];
  const subtitles = [
    "每一帧，都从本地开始",
    "自由剪辑，自由表达",
    "慢一点，看见更多",
  ];
  const labels = [
    "01  /  MORNING LIGHT",
    "02  /  OPEN WATER",
    "03  /  AFTER THE SUN",
  ];
  for (let index = 0; index < 3; index++) {
    const base = createClip(
      assets[index] as MediaAsset,
      videoTrack,
      index * 3,
      FPS,
    );
    const visual: Clip = {
      ...base,
      duration: 3,
      fadeIn: index === 0 ? 0.6 : 0.25,
      fadeOut: 0.25,
      adjustments: {
        ...base.adjustments,
        brightness: 0.01,
        contrast: 1.05,
        saturation: 0.93,
        temperature: [0.08, -0.04, -0.06][index],
      },
      keyframes: [
        {
          id: `zoom-start-${index}`,
          time: 0,
          property: "scale",
          value: 1,
          easing: "linear",
        },
        {
          id: `zoom-end-${index}`,
          time: 3,
          property: "scale",
          value: 1.035,
          easing: "easeInOut",
        },
      ],
    };
    const heading = title(
      titleTrack,
      index * 3,
      headers[index],
      10,
      index === 2 ? 58 : 70,
      true,
    );
    heading.keyframes = [
      {
        id: `title-x-start-${index}`,
        time: 0,
        property: "x",
        value: -14,
        easing: "linear",
      },
      {
        id: `title-x-end-${index}`,
        time: 1,
        property: "x",
        value: 0,
        easing: "easeInOut",
      },
    ];
    project.clips.push(
      visual,
      heading,
      title(captions.id, index * 3, subtitles[index], 205, 21),
      title(captions.id, index * 3, labels[index], -225, 15),
    );
  }
  const music = createClip(assets[6], audioTrack, 0, FPS);
  music.duration = 9;
  music.volume = 0.5;
  music.audioFadeIn = 0.8;
  music.audioFadeOut = 1.2;
  project.clips.push(music);
  validateProject(project);
  const projectPath = path.join(directory, "demo.reacut");
  await writeFile(projectPath, JSON.stringify(project, null, 2));
  const output = path.join(directory, "demo.mp4");
  await new Promise<void>((resolve, reject) => {
    void startExport(
      project,
      {
        path: output,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        quality: "high",
        format: "mp4",
      },
      (event) => {
        if (event.status === "complete") resolve();
        if (event.status === "error" || event.status === "cancelled")
          reject(new Error(event.message ?? event.status));
      },
    ).catch(reject);
  });
  const probe = await probeFile(output);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  if (
    !video ||
    video.width !== WIDTH ||
    video.height !== HEIGHT ||
    Math.abs(Number(probe.format.duration) - 9) > 0.1 ||
    !probe.streams.some((stream) => stream.codec_type === "audio")
  )
    throw new Error("示例视频验证失败");
  for (const [index, second] of [1.5, 4.5, 7.5].entries())
    await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-ss",
      String(second),
      "-i",
      output,
      "-frames:v",
      "1",
      path.join(directory, `preview-${index + 1}.png`),
    ]);
  await writeFile(
    path.join(directory, "OWNERSHIP.txt"),
    `Generated by scripts/generate-demo.ts. Seed: ${SEED}. Original seeded geometry, gradients, waves and synthesized sine chords. No downloaded or proprietary assets. Generator source and these generated assets: MIT. Project IDs/timestamps differ between runs; the landscape seed remains fixed.\n`,
  );
  return {
    projectPath,
    output,
    seed: SEED,
    duration: probe.format.duration,
    width: video.width,
    height: video.height,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(await generateDemo(path.resolve(process.argv[2] ?? ".demo")));
