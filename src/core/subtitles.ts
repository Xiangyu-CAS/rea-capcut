export interface Subtitle {
  start: number;
  end: number;
  text: string;
}
function seconds(stamp: string): number {
  const parts = stamp.trim().replace(",", ".").split(":").map(Number);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}
export function parseSubtitles(text: string): Subtitle[] {
  const source = text.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const cues: Subtitle[] = [];
  for (const block of source.split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    const index = lines.findIndex((line) => line.includes("-->"));
    if (index < 0) continue;
    const match = lines[index].match(
      /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})/,
    );
    if (!match) continue;
    const start = seconds(match[1]),
      end = seconds(match[2]),
      body = lines
        .slice(index + 1)
        .join("\n")
        .replace(/<[^>]*>/g, "");
    if (Number.isFinite(start) && end > start && body)
      cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}
const stamp = (time: number) => {
  const ms = Math.round(time * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
export function stringifySubtitles(cues: Subtitle[]): string {
  return (
    cues
      .map(
        (c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`,
      )
      .join("\n\n") + "\n"
  );
}
