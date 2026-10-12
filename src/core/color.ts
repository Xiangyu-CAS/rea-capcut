import type { Adjustments } from "./types";

type ColorAdjustments = Pick<
  Adjustments,
  "brightness" | "contrast" | "saturation" | "temperature"
>;
const byte = (value: number) => Math.round(Math.max(0, Math.min(255, value)));

/** Shared display/export model: quantize each RGB operation, and preserve straight alpha. */
export function applyColorAdjustments(
  data: Uint8ClampedArray,
  adjustments: ColorAdjustments,
): void {
  const { brightness, contrast, saturation, temperature } = adjustments;
  if (
    brightness === 0 &&
    contrast === 1 &&
    saturation === 1 &&
    temperature === 0
  )
    return;
  const offset = brightness * 255;
  const tint = temperature * 35;
  for (let index = 0; index + 3 < data.length; index += 4) {
    let r = byte((byte(data[index] + offset) - 127.5) * contrast + 127.5);
    let g = byte((byte(data[index + 1] + offset) - 127.5) * contrast + 127.5);
    let b = byte((byte(data[index + 2] + offset) - 127.5) * contrast + 127.5);
    if (saturation !== 1) {
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r = byte(luma + (r - luma) * saturation);
      g = byte(luma + (g - luma) * saturation);
      b = byte(luma + (b - luma) * saturation);
    }
    data[index] = byte(r + tint);
    data[index + 1] = g;
    data[index + 2] = byte(b - tint);
  }
}

const decimal = (value: number) => Number(value.toFixed(12)).toString();
const quantize = (expression: string) => `floor(clip(${expression},0,255)+0.5)`;

/** FFmpeg uses the same clamping stages; native fixed-point saturation differs by at most one byte level. */
export function colorAdjustmentFilters(
  adjustments: ColorAdjustments,
): string[] {
  const { brightness, contrast, saturation, temperature } = adjustments;
  const filters: string[] = [];
  if (brightness !== 0 || contrast !== 1) {
    const bright = quantize(`val+${decimal(brightness * 255)}`);
    const expression = quantize(`(${bright}-127.5)*${decimal(contrast)}+127.5`);
    filters.push(
      `lutrgb=r='${expression}':g='${expression}':b='${expression}'`,
    );
  }
  if (saturation !== 1) {
    const weights = [0.2126, 0.7152, 0.0722];
    const matrix = weights.flatMap((_, row) =>
      weights.map(
        (weight, column) =>
          weight * (1 - saturation) + (row === column ? saturation : 0),
      ),
    );
    if (matrix.every((coefficient) => coefficient >= -2 && coefficient <= 2)) {
      // Native matrix arithmetic is far faster than per-pixel expression parsing for ordinary saturation.
      const names = ["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"];
      filters.push(
        `colorchannelmixer=${matrix.map((coefficient, index) => `${names[index]}=${decimal(coefficient)}`).join(":")}`,
      );
      if (temperature !== 0)
        filters.push(
          `lutrgb=r='${quantize(`val+${decimal(temperature * 35)}`)}':b='${quantize(`val-${decimal(temperature * 35)}`)}'`,
        );
      return filters;
    }
    // Scale high-saturation coefficients into the native filter's [-2,2] range.
    // Only negative intermediate channels clamp; they would also clamp in the final model.
    const names = ["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"];
    const restore = `floor(clip(val*${decimal(saturation)},0,maxval)+0.5)`;
    // Convert promoted alpha byte*257 to byte*256 before FFmpeg's 16→8 alpha rounding.
    filters.push(
      "format=gbrap16le",
      `colorchannelmixer=${matrix.map((coefficient, index) => `${names[index]}=${decimal(coefficient / saturation)}`).join(":")}`,
      `lutrgb=r='${restore}':g='${restore}':b='${restore}':a='floor(val*256/257)'`,
      "format=rgba",
    );
    if (temperature !== 0)
      filters.push(
        `lutrgb=r='${quantize(`val+${decimal(temperature * 35)}`)}':b='${quantize(`val-${decimal(temperature * 35)}`)}'`,
      );
  } else if (temperature !== 0)
    filters.push(
      `lutrgb=r='${quantize(`val+${decimal(temperature * 35)}`)}':b='${quantize(`val-${decimal(temperature * 35)}`)}'`,
    );
  return filters;
}
