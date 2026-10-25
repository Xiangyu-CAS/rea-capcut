/** Reproducible original template covers rendered through the actual export engine. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importAssets, runMediaTool } from "../electron/media";
import { startExport } from "../electron/export";
import {
  TEMPLATE_EXAMPLES,
  buildTemplateExample,
} from "../src/core/templateExamples";
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "reacut-template-covers-"),
);
try {
  await mkdir("public/template-previews", { recursive: true });
  for (const def of TEMPLATE_EXAMPLES) {
    const assets = await importAssets(
      def.media.map((id) => path.resolve("public/builtin-assets", id + ".png")),
      path.join(temporary, "cache"),
    );
    const { project } = buildTemplateExample(def.id, assets),
      output = path.join(temporary, def.id + ".mp4");
    await new Promise<void>((resolve, reject) => {
      void startExport(
        project,
        {
          path: output,
          width: 480,
          height: 270,
          fps: 30,
          quality: "high",
          format: "mp4",
          range: { start: 1, end: 1 + 1 / 30 },
        },
        (e) => {
          if (e.status === "complete") resolve();
          if (e.status === "error" || e.status === "cancelled")
            reject(new Error(e.message));
        },
      ).catch(reject);
    });
    const png = await runMediaTool("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-frames:v",
      "1",
      "-c:v",
      "png",
      "-f",
      "image2pipe",
      "pipe:1",
    ]);
    await writeFile(
      path.resolve("public/template-previews", def.id + ".png"),
      png,
    );
  }
  console.log("Rendered three original template previews.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
