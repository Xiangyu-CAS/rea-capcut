import { it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { importAssets, runMediaTool } from "../electron/media";
import { startExport } from "../electron/export";
import {
  TEMPLATE_EXAMPLES,
  buildTemplateExample,
} from "../src/core/templateExamples";
import {
  instantiateTemplate,
  replaceTemplateSlots,
} from "../src/core/projectTemplates";
import {
  writeTemplate,
  readTemplate,
  TEMPLATE_FILE,
} from "../electron/projectTemplates";
let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "reacut-template-render-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
it.each(TEMPLATE_EXAMPLES)(
  "creates, replaces, packages and renders original $id example",
  async (def) => {
    const assets = await importAssets(
      def.media.map((id) => path.resolve("public/builtin-assets", id + ".png")),
      path.join(root, "cache"),
    );
    const original = buildTemplateExample(def.id, assets),
      before = JSON.stringify(original),
      t = instantiateTemplate(original);
    const image = createCanvas(90, 160),
      ctx = image.getContext("2d");
    ctx.fillStyle = "#d02020";
    ctx.fillRect(0, 0, 90, 160);
    const file = path.join(root, def.id + ".png");
    await writeFile(file, image.toBuffer("image/png"));
    const [replacement] = await importAssets([file], path.join(root, "cache"));
    const p = replaceTemplateSlots(t, {
      media: { [t.slots.find((s) => s.kind === "media")!.id]: replacement },
      text: {
        [t.slots.find((s) => s.kind === "text")!.id]: "原创替换 / REPLACED",
      },
    });
    const parent = path.join(root, def.id);
    await mkdir(parent);
    const folder = await writeTemplate(
      { ...t, project: p },
      parent,
      new AbortController().signal,
      () => {},
    );
    const reopened = await readTemplate(path.join(folder, TEMPLATE_FILE));
    expect(reopened.project.clips).toEqual(p.clips);
    expect(JSON.stringify(original)).toBe(before);
    const output = path.join(parent, "result.mp4");
    await new Promise<void>((resolve, reject) => {
      void startExport(
        reopened.project,
        {
          path: output,
          width: 320,
          height: 180,
          fps: 30,
          quality: "standard",
          format: "mp4",
        },
        (e) => {
          if (e.status === "complete") resolve();
          if (e.status === "error" || e.status === "cancelled")
            reject(new Error(e.message));
        },
      ).catch(reject);
    });
    const meta = JSON.parse(
      (
        await runMediaTool("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          output,
        ])
      ).toString(),
    );
    expect(Number(meta.format.duration)).toBeCloseTo(12, 1);
    expect(
      meta.streams.find((s: any) => s.codec_type === "video").nb_frames,
    ).toBe("360");
    const raw = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-ss",
      "1",
      "-i",
      output,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]);
    const pixel = (x: number, y: number) => [
      ...raw.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3),
    ];
    // Portrait replacement stays centered with side bars, while retained text is visibly rendered.
    expect(pixel(160, 55)[0]).toBeGreaterThan(150);
    expect(pixel(160, 55)[1]).toBeLessThan(65);
    expect(pixel(10, 70)[0]).toBeLessThan(60);
    let light = 0;
    for (let i = 0; i < raw.length; i += 3)
      if (raw[i] > 150 && raw[i + 1] > 150 && raw[i + 2] > 150) light++;
    expect(light).toBeGreaterThan(40);
  },
  60000,
);
