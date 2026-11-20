import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { analyzeBeats } from "../electron/beatAnalysis";
import { runMediaTool } from "../electron/media";
import { createProject } from "../src/core/model";

it.each([75, 105, 146, 190])("tracks %s BPM with quieter offbeat hits", async bpm => {
  const folder = await mkdtemp(path.join(tmpdir(), "reacut-beats-"));
  const file = path.join(folder, "tempo.wav");
  const duration = 12, period = 60 / bpm;
  const beat = `mod(max(0,t-0.25),${period})`;
  const offbeat = `mod(max(0,t-${0.25 + period / 2}),${period})`;
  try {
    await runMediaTool("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i",
      `aevalsrc='0.58*exp(-32*${beat})*sin(2*PI*82*${beat})+0.065*gte(t,${0.25 + period / 2})*exp(-95*${offbeat})*sin(2*PI*1470*t)+0.043*sin(2*PI*131*t)':s=8000:d=${duration}`,
      "-c:a", "pcm_s16le", file,
    ]);
    const project = createProject("Synthetic beat analysis");
    project.assets = [{
      id: "score", name: "Tempo test", path: file, url: file, kind: "audio",
      duration, hasAudio: true, width: 0, height: 0, fps: 0,
    }];
    const result = await analyzeBeats(project, "score", new AbortController().signal, () => {});
    expect(Math.abs(result.bpm - bpm)).toBeLessThan(5);
    expect(result.times.length).toBeGreaterThan(Math.floor((duration - 0.25) / period) - 2);
    expect(result.times.every(time => Math.abs(time - 0.25 - Math.round((time - 0.25) / period) * period) < 0.03))
      .toBe(true);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
