import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { runMediaTool } from "../electron/media";

export async function generateFixtures(
  directory: string,
): Promise<{
  video: string;
  audio: string;
  image: string;
  temporal: string;
  quadrants: string;
}> {
  await mkdir(directory, { recursive: true });
  const video = path.join(directory, "红色 video '素材'.mp4");
  const audio = path.join(directory, "tone 音频.wav");
  const image = path.join(directory, "蓝色 image.png");
  const temporal = path.join(directory, "时间变化.mp4");
  const quadrants = path.join(directory, "四象限.png");
  await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=10:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    video,
  ]);
  await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=600:sample_rate=48000:duration=4",
    "-c:a",
    "pcm_s16le",
    audio,
  ]);
  const canvas = createCanvas(80, 40);
  const context = canvas.getContext("2d");
  context.fillStyle = "#0000ff";
  context.fillRect(0, 0, 80, 40);
  await writeFile(image, canvas.toBuffer("image/png"));
  const graph =
    ["red", "green", "blue", "yellow"]
      .map(
        (color, index) =>
          `color=c=${color}:s=160x90:r=10:d=1[v${index}];sine=frequency=${[440, 880, 1760, 220][index]}:sample_rate=48000:duration=1[a${index}]`,
      )
      .join(";") + ";[v0][a0][v1][a1][v2][a2][v3][a3]concat=n=4:v=1:a=1[v][a]";
  await runMediaTool("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    temporal,
  ]);
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 40, 20);
  context.fillStyle = "#00ff00";
  context.fillRect(40, 0, 40, 20);
  context.fillStyle = "#0000ff";
  context.fillRect(0, 20, 40, 20);
  context.fillStyle = "#ffff00";
  context.fillRect(40, 20, 40, 20);
  await writeFile(quadrants, canvas.toBuffer("image/png"));
  return { video, audio, image, temporal, quadrants };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = path.resolve(process.argv[2] ?? "fixtures");
  console.log(await generateFixtures(directory));
}
