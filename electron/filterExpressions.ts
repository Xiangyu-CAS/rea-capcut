import { easingExpression } from "../src/core/easing";
import type { Clip, Keyframe } from "../src/core/types";

export const number = (value: number): string => Number(value.toFixed(6)).toString();

/** Keyframe time is in clip-local timeline seconds, including after a speed change. */
export function keyframeExpression(
  clip: Clip,
  property: Keyframe["property"],
  fallback: number,
  clock = "t",
): string {
  const points = clip.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.time - b.time);
  if (!points.length) return number(fallback);
  const unique = points.filter(
    (p, i) => i === points.length - 1 || points[i + 1].time !== p.time,
  );
  let expression = number(unique[unique.length - 1].value);
  for (let i = unique.length - 2; i >= 0; i--) {
    const left = unique[i];
    const right = unique[i + 1];
    let progress = `((${clock}-${number(left.time)})/${number(right.time - left.time)})`;
    progress = easingExpression(right, progress);
    const interpolation = `(${number(left.value)}+(${number(right.value - left.value)})*${progress})`;
    expression = `if(lt(${clock},${number(right.time)}),${interpolation},${expression})`;
  }
  return `if(lt(${clock},${number(unique[0].time)}),${number(unique[0].value)},${expression})`;
}
