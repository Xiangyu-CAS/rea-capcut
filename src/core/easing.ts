import type { Keyframe } from "./types";
export const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut"] as const;
/** Normalized polynomial for a sliced easing interval. Cancel the common span
 * before evaluation to avoid catastrophic cancellation near a flat endpoint. */
export function easingCoefficients(
  key: Pick<Keyframe, "easing" | "easingWindow">,
): [number, number, number] {
  const { start: s, end: e } = key.easingWindow ?? { start: 0, end: 1 },
    d = e - s;
  switch (key.easing) {
    case "easeIn":
      return [2 * s, d, 0];
    case "easeOut":
      return [2 * (1 - s), -d, 0];
    case "easeInOut":
      return [6 * s * (1 - s), 3 * d * (1 - 2 * s), -2 * d * d];
    default:
      return [1, 0, 0];
  }
}
export function easingProgress(
  key: Pick<Keyframe, "easing" | "easingWindow">,
  fraction: number,
): number {
  const t = Math.max(0, Math.min(1, fraction)),
    [a, b, c] = easingCoefficients(key);
  return (t * (a + b * t + c * t * t)) / (a + b + c);
}
/** The same coefficients are used in FFmpeg expressions and the canvas preview. */
export function easingExpression(key: Keyframe, t: string): string {
  if (key.easing === "linear") return t;
  const [a, b, c] = easingCoefficients(key),
    n = (v: number) => Number(v.toPrecision(15)).toString();
  return `(${t}*(${n(a)}+${n(b)}*${t}+${n(c)}*${t}*${t})/${n(a + b + c)})`;
}
