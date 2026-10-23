import { it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createProject,
  createClip,
  evaluateKeyframes,
} from "../src/core/model";
import { prepareSubtitleEdit } from "../src/core/subtitleEdits";
import { TEXT_MOTIONS } from "../src/core/subtitleWorkflow";
import { startExport } from "../electron/export";
import { runMediaTool } from "../electron/media";
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reacut-caption-motion-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
it.each(
  TEXT_MOTIONS.flatMap((motion) =>
    (["still", "pulse"] as const).map((hold) => ({ motion, hold })),
  ),
)(
  "exports every frame of $motion text entrance, $hold hold and exit",
  async ({ motion, hold }) => {
    let p = createProject();
    p.width = p.height = 128;
    p.background = "#000000";
    const c = createClip(undefined, p.tracks[0].id, 0, 30);
    c.duration = 2;
    c.text = {
      ...c.text!,
      text: "TEST",
      fontSize: 24,
      background: "#ffffff",
      color: "#ffffff",
      strokeWidth: 0,
    };
    p.clips = [c];
    p = prepareSubtitleEdit(p, [c.id], {
      type: "animation",
      options: {
        entrance: motion,
        exit: motion,
        inDuration: 0.5,
        outDuration: 0.5,
        distance: 16,
        hold,
      },
    }).project;
    const output = path.join(dir, motion + hold + ".mp4");
    await new Promise<void>((resolve, reject) => {
      void startExport(
        p,
        {
          path: output,
          width: 128,
          height: 128,
          fps: 30,
          quality: "high",
          format: "mp4",
        },
        (e) => {
          if (e.status === "complete") resolve();
          if (e.status === "error" || e.status === "cancelled")
            reject(new Error(e.message));
        },
      ).catch(reject);
    });
    const raw = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]);
    expect(raw.length).toBe(60 * 128 * 128 * 3);
    const metrics = Array.from({ length: 60 }, (_, frame) => {
      const data = raw.subarray(
        frame * 128 * 128 * 3,
        (frame + 1) * 128 * 128 * 3,
      );
      let peak = 0,
        weight = 0,
        sum = 0,
        left = 128,
        right = 0;
      for (let i = 0; i < data.length; i += 3) peak = Math.max(peak, data[i]);
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 128; x++) {
          const v = data[(y * 128 + x) * 3];
          if (v > peak * 0.5) {
            sum += y * v;
            weight += v;
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
      return {
        y: weight ? sum / weight + 0.5 : 64,
        width: weight ? right - left + 1 : 0,
        brightness:
          data[
            (Math.min(127, Math.round(weight ? sum / weight : 64)) * 128 + 64) *
              3
          ],
      };
    });
    const rest = metrics[30];
    for (let frame = 0; frame < 60; frame++) {
      const expected = evaluateKeyframes(p.clips[0], frame / 30).transform;
      const actual = metrics[frame];
      expect(Math.abs(actual.brightness - expected.opacity * 255)).toBeLessThan(
        7,
      );
      if (expected.opacity > 0.05) {
        expect(Math.abs(actual.y - rest.y - expected.y)).toBeLessThan(2);
        expect(
          Math.abs(
            actual.width -
              (rest.width * expected.scale) /
                evaluateKeyframes(p.clips[0], 1).transform.scale,
          ),
        ).toBeLessThan(3);
      }
    }
  },
);
