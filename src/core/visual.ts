import type { ChromaKey, CropRect, MediaAsset, ShapeMask } from "./types";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const byte = (value: number) => Math.round(Math.max(0, Math.min(255, value)));
const decimal = (value: number) => Number(value.toFixed(12)).toString();
export interface CropPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop is normalized to oriented display pixels, including non-square sample aspect ratios. */
export function getCropPixels(
  asset: Pick<MediaAsset, "width" | "height">,
  crop?: CropRect,
): CropPixels {
  const width = Math.max(1, Math.round(asset.width));
  const height = Math.max(1, Math.round(asset.height));
  if (!crop) return { x: 0, y: 0, width, height };
  const x = Math.min(width - 1, Math.max(0, Math.floor(crop.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(crop.y * height)));
  return {
    x,
    y,
    width: Math.min(width - x, Math.max(1, Math.floor(crop.width * width))),
    height: Math.min(height - y, Math.max(1, Math.floor(crop.height * height))),
  };
}

function keyRGB(key: ChromaKey): [number, number, number] {
  if (!/^#[\da-f]{6}$/i.test(key.color))
    throw new Error("抠像颜色必须为 #RRGGBB。");
  return [1, 3, 5].map((index) =>
    Number.parseInt(key.color.slice(index, index + 2), 16),
  ) as [number, number, number];
}

/** Straight RGB Euclidean key distance; a soft band grows linearly beyond similarity. */
export function applyChromaKey(data: Uint8ClampedArray, key?: ChromaKey): void {
  if (!key?.enabled) return;
  const [red, green, blue] = keyRGB(key);
  for (let index = 0; index + 3 < data.length; index += 4) {
    const distance =
      Math.hypot(
        data[index] - red,
        data[index + 1] - green,
        data[index + 2] - blue,
      ) /
      (255 * Math.sqrt(3));
    const alpha =
      distance <= key.similarity
        ? 0
        : key.blend > 0
          ? clamp((distance - key.similarity) / key.blend)
          : 1;
    const keyed = Math.floor(255 * alpha);
    data[index + 3] = Math.floor((data[index + 3] * keyed) / 255);
  }
}

function maskOpacity(
  x: number,
  y: number,
  width: number,
  height: number,
  mask: ShapeMask,
): number {
  const rx = Math.max(Number.EPSILON, (width * mask.width) / 2);
  const ry = Math.max(Number.EPSILON, (height * mask.height) / 2);
  const dx = Math.abs(x + 0.5 - width / 2);
  const dy = Math.abs(y + 0.5 - height / 2);
  let distance: number;
  if (mask.shape === "ellipse")
    distance = (Math.hypot(dx / rx, dy / ry) - 1) * Math.min(rx, ry);
  else {
    const qx = dx - rx;
    const qy = dy - ry;
    distance =
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
      Math.min(Math.max(qx, qy), 0);
  }
  const feather = mask.feather * Math.min(width, height);
  const inside =
    feather > 0 ? clamp(0.5 - distance / feather) : distance <= 0 ? 1 : 0;
  return mask.invert ? 1 - inside : inside;
}

/** Centered rectangle SDF / elliptical radial distance; feather spans both sides of the edge. */
export function applyShapeMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mask?: ShapeMask,
): void {
  if (!mask) return;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const alpha = (y * width + x) * 4 + 3;
      const maskByte = byte(255 * maskOpacity(x, y, width, height, mask));
      data[alpha] = Math.floor((data[alpha] * maskByte) / 255);
    }
}

/** A single alpha expression preserves the previous alpha and quantizes each individual effect. */
export function visualEffectFilters(
  width: number,
  height: number,
  key?: ChromaKey,
  mask?: ShapeMask,
): string[] {
  let alpha = "alpha(X,Y)";
  if (key?.enabled) {
    const [red, green, blue] = keyRGB(key);
    const distance = `(sqrt((r(X,Y)-${red})^2+(g(X,Y)-${green})^2+(b(X,Y)-${blue})^2)/${decimal(255 * Math.sqrt(3))})`;
    const factor =
      key.blend > 0
        ? `clip((${distance}-${decimal(key.similarity)})/${decimal(key.blend)},0,1)`
        : `if(lte(${distance},${decimal(key.similarity)}),0,1)`;
    alpha = `floor(${alpha}*floor(255*(${factor}))/255)`;
  }
  if (mask) {
    const rx = Math.max(Number.EPSILON, (width * mask.width) / 2);
    const ry = Math.max(Number.EPSILON, (height * mask.height) / 2);
    const dx = `abs(X+0.5-${decimal(width / 2)})`;
    const dy = `abs(Y+0.5-${decimal(height / 2)})`;
    let distance: string;
    if (mask.shape === "ellipse")
      distance = `((sqrt((${dx}/${decimal(rx)})^2+(${dy}/${decimal(ry)})^2)-1)*${decimal(Math.min(rx, ry))})`;
    else {
      const qx = `(${dx}-${decimal(rx)})`;
      const qy = `(${dy}-${decimal(ry)})`;
      distance = `(sqrt(max(${qx},0)^2+max(${qy},0)^2)+min(max(${qx},${qy}),0))`;
    }
    const feather = mask.feather * Math.min(width, height);
    let factor =
      feather > 0
        ? `clip(0.5-${distance}/${decimal(feather)},0,1)`
        : `if(lte(${distance},0),1,0)`;
    if (mask.invert) factor = `(1-${factor})`;
    alpha = `floor((${alpha})*floor(255*(${factor})+0.5)/255)`;
  }
  return alpha === "alpha(X,Y)"
    ? []
    : [`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'`];
}
