import { createCanvas } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve("build");
await mkdir(path.join(root, "icon.iconset"), { recursive: true });
function icon(size: number): Buffer {
  const canvas = createCanvas(size, size),
    ctx = canvas.getContext("2d"),
    s = size / 1024;
  ctx.scale(s, s);
  const fill = ctx.createLinearGradient(120, 70, 850, 980);
  fill.addColorStop(0, "#6cf2d9");
  fill.addColorStop(0.6, "#36cebb");
  fill.addColorStop(1, "#18998e");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(45, 45, 934, 934, 205);
  ctx.fill();
  ctx.strokeStyle = "#153d38";
  ctx.lineWidth = 61;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.arc(323, 657, 94, 0, Math.PI * 2);
  ctx.moveTo(596, 657);
  ctx.arc(690, 657, 94, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(394, 590);
  ctx.lineTo(701, 271);
  ctx.moveTo(617, 590);
  ctx.lineTo(310, 271);
  ctx.stroke();
  ctx.fillStyle = "#a7ffe9";
  ctx.beginPath();
  ctx.arc(512, 463, 23, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer("image/png");
}
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  const bytes = icon(size);
  if (size === 512) await writeFile(path.join(root, "icon.png"), bytes);
  if (size <= 512) {
    await writeFile(
      path.join(root, "icon.iconset", `icon_${size}x${size}.png`),
      bytes,
    );
    await writeFile(
      path.join(root, "icon.iconset", `icon_${size}x${size}@2x.png`),
      icon(size * 2),
    );
  }
}
const images = [16, 32, 48, 64, 128, 256].map((size) => ({
    size,
    bytes: icon(size),
  })),
  header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, bytes }, i) => {
  const at = 6 + i * 16;
  header[at] = size === 256 ? 0 : size;
  header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(bytes.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += bytes.length;
});
await writeFile(
  path.join(root, "icon.ico"),
  Buffer.concat([header, ...images.map((image) => image.bytes)]),
);
if (process.platform === "darwin") {
  const result = spawnSync(
    "iconutil",
    [
      "-c",
      "icns",
      path.join(root, "icon.iconset"),
      "-o",
      path.join(root, "icon.icns"),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("iconutil failed");
}
console.log("Generated original ReaCut icons in build/");
