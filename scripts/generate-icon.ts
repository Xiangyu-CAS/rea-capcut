import { createCanvas, Path2D } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve("build");
await mkdir(path.join(root, "icon.iconset"), { recursive: true });
await mkdir(path.resolve("public/icons"), { recursive: true });
// Independently drawn vector geometry: left-facing crossed ribbon with softened folds.
// Visual direction requested by the user: mirror the familiar right-facing edit mark.
const ribbon = `
  M 230 300 L 340 362 L 340 350
  C 340 309 365 292 402 292 L 723 292
  C 767 292 790 315 790 359 L 790 426
  Q 790 441 777 448 L 664 512 L 777 576
  Q 790 583 790 598 L 790 665
  C 790 709 767 732 723 732 L 402 732
  C 365 732 340 715 340 674 L 340 662
  L 230 724 L 230 635 L 495 512 L 230 389 Z
  M 410 378 Q 401 378 409 383 L 548 464
  L 695 383 Q 704 378 695 378 Z
  M 410 646 Q 401 646 409 641 L 548 560
  L 695 641 Q 704 646 695 646 Z
`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><linearGradient id="ribbon" gradientUnits="userSpaceOnUse" x1="230" y1="292" x2="650" y2="732">
    <stop stop-color="#98f9e5"/><stop offset="1" stop-color="#45d6c0"/>
  </linearGradient></defs>
  <rect x="45" y="45" width="934" height="934" rx="205" fill="#14191d"/>
  <path d="${ribbon}" fill="url(#ribbon)" fill-rule="evenodd"/>
</svg>
`;
await writeFile(path.resolve("public/icons/reacut.svg"), svg);
function icon(size: number): Buffer {
  const canvas = createCanvas(size, size), ctx = canvas.getContext("2d");
  ctx.scale(size / 1024, size / 1024);
  ctx.fillStyle = "#14191d";
  ctx.beginPath(); ctx.roundRect(45, 45, 934, 934, 205); ctx.fill();
  const color = ctx.createLinearGradient(230, 292, 650, 732);
  color.addColorStop(0, "#98f9e5"); color.addColorStop(1, "#45d6c0");
  ctx.fillStyle = color;
  ctx.fill(new Path2D(ribbon), "evenodd");
  return canvas.toBuffer("image/png");
}
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  const bytes = icon(size);
  if (size === 512) {
    await writeFile(path.join(root, "icon.png"), bytes);
    await writeFile(path.resolve("public/icons/reacut.png"), bytes);
  }
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
console.log("Generated left-facing ReaCut icons in build/ and public/icons/");
