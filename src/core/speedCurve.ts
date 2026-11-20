export interface SpeedPoint {
  position: number;
  rate: number;
}

interface ClipTiming {
  duration: number;
  speed: number;
  speedCurve?: SpeedPoint[];
}

export const MAX_SPEED_POINTS = 32;
const EPSILON = 1e-9;

export function validateSpeedCurve(value: unknown): SpeedPoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_SPEED_POINTS)
    throw new Error("A speed curve needs 2–32 points.");
  let previous = -1;
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.position !== "number" ||
        !Number.isFinite(item.position) || item.position < 0 || item.position > 1 ||
        item.position - previous <= EPSILON || typeof item.rate !== "number" ||
        !Number.isFinite(item.rate) || item.rate < 0.1 || item.rate > 8)
      throw new Error("Invalid speed curve point.");
    previous = item.position;
  }
  if (value[0].position !== 0 || previous !== 1)
    throw new Error("A speed curve must cover the entire clip.");
  return value;
}

export function averageSpeed(points: SpeedPoint[]): number {
  let area = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    area += (b.position - a.position) * (a.rate + b.rate) / 2;
  }
  return Math.min(8, Math.max(0.1, area));
}

export function speedSegments(clip: ClipTiming) {
  const points = clip.speedCurve ?? [{ position: 0, rate: clip.speed }, { position: 1, rate: clip.speed }];
  let source = 0;
  return points.slice(1).map((b, i) => {
    const a = points[i], start = a.position * clip.duration, end = b.position * clip.duration;
    const sourceStart = source;
    source += (end - start) * (a.rate + b.rate) / 2;
    return { start, end, sourceStart, sourceEnd: source, rate: a.rate, slope: (b.rate - a.rate) / (end - start) };
  });
}

/** Media offset from the clip's in point. Source handles extend at the endpoint rate. */
export function sourceOffsetAt(clip: ClipTiming, local: number): number {
  if (!clip.speedCurve) return local * clip.speed;
  if (local <= 0) return local * clip.speedCurve[0].rate;
  if (local >= clip.duration)
    return clip.duration * clip.speed + (local - clip.duration) * clip.speedCurve.at(-1)!.rate;
  const piece = speedSegments(clip).find(segment => local <= segment.end)!;
  const offset = local - piece.start;
  return piece.sourceStart + offset * (piece.rate + piece.slope * offset / 2);
}

export function timelineOffsetAt(clip: ClipTiming, sourceOffset: number): number {
  if (!clip.speedCurve) return sourceOffset / clip.speed;
  if (sourceOffset <= 0) return sourceOffset / clip.speedCurve[0].rate;
  if (sourceOffset >= clip.duration * clip.speed)
    return clip.duration + (sourceOffset - clip.duration * clip.speed) / clip.speedCurve.at(-1)!.rate;
  const pieces = speedSegments(clip);
  const piece = pieces.find(segment => sourceOffset <= segment.sourceEnd) ?? pieces.at(-1)!;
  const delta = sourceOffset - piece.sourceStart;
  const finalRate = Math.sqrt(Math.max(0, piece.rate ** 2 + 2 * piece.slope * delta));
  return piece.start + 2 * delta / (piece.rate + finalRate);
}

export function speedAt(clip: ClipTiming, local: number): number {
  const points = clip.speedCurve;
  if (!points) return clip.speed;
  const position = Math.max(0, Math.min(1, local / clip.duration));
  const i = Math.max(1, points.findIndex(point => position <= point.position));
  const a = points[i - 1], b = points[i];
  return a.rate + (b.rate - a.rate) * (position - a.position) / (b.position - a.position);
}

export function sliceSpeedCurve(clip: ClipTiming, from: number, to: number): Pick<ClipTiming, "speed" | "speedCurve"> {
  if (!clip.speedCurve) return { speed: clip.speed };
  const points: SpeedPoint[] = [{ position: 0, rate: speedAt(clip, from) }];
  for (const point of clip.speedCurve) {
    const position = (point.position * clip.duration - from) / (to - from);
    if (position > EPSILON && position < 1 - EPSILON) points.push({ position, rate: point.rate });
  }
  points.push({ position: 1, rate: speedAt(clip, to) });
  // Trimming outside an endpoint adds a constant handle. Repeated extensions
  // over a constant handle do not need additional points.
  const simplified: SpeedPoint[] = [];
  for (const point of points) {
    const a = simplified.at(-2), b = simplified.at(-1);
    if (a && b && Math.abs(
      (point.position - a.position) * (b.rate - a.rate) - (b.position - a.position) * (point.rate - a.rate),
    ) < 1e-12) simplified.pop();
    simplified.push(point);
  }
  return { speed: averageSpeed(simplified), speedCurve: simplified };
}
