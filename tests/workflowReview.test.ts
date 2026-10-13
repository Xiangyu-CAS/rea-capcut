/** Independent review regressions: synthetic portable media and frame-exact range export. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectPortableProject, resolvePortableDocument, savePortableDocument } from "../electron/portableProject";
import { createClip, createProject } from "../src/core/model";
import { importAssets, runMediaTool } from "../electron/media";
import { startExport } from "../electron/export";
import type { ExportOptions, Project } from "../src/core/types";
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "reacut-workflow-review-")); folders.push(root);
  const source = path.join(root, "source.png"); await writeFile(source, "synthetic image bytes");
  const parent = path.join(root, "packages"); await mkdir(parent);
  const project = createProject("搬移回归");
  project.assets = [{ id: "asset", name: "自造图片", kind: "image", path: source, url: "file://" + source, duration: 0, width: 160, height: 90, fps: 0, hasAudio: false }];
  project.clips = [createClip(project.assets[0], project.tracks[1].id, 0, 30)];
  const folder = await collectPortableProject(project, parent, new AbortController().signal, () => {}), file = path.join(folder, "项目.reacut");
  const opened = await resolvePortableDocument(JSON.parse(await readFile(file, "utf8")), file);
  return { root, folder, file, opened };
}
describe("independent workflow review", () => {
  it("can save text edits while a packaged asset remains missing and relinkable", async () => {
    const { file, opened } = await fixture();
    await rm(opened.assets[0].path); opened.assets[0].missing = true; opened.name = "继续编辑未丢失的内容";
    await expect(savePortableDocument(opened, file)).resolves.toBeUndefined();
    const restored = await resolvePortableDocument(JSON.parse(await readFile(file, "utf8")), file);
    expect(restored.name).toBe(opened.name); expect(restored.assets[0].path).toBe(opened.assets[0].path);
  });
  it("resaves after an external newly-imported source disappears once a good copy has been saved", async () => {
    const { root, file, opened } = await fixture();
    const source = path.join(root, "external.png"); await writeFile(source, "new synthetic image");
    opened.assets.push({ ...opened.assets[0], id: "new", path: source, url: "file://" + source });
    await savePortableDocument(opened, file); await rm(source); opened.name = "第二次编辑";
    await expect(savePortableDocument(opened, file)).resolves.toBeUndefined();
    const restored = await resolvePortableDocument(JSON.parse(await readFile(file, "utf8")), file);
    expect((await readFile(restored.assets[1].path)).toString()).toBe("new synthetic image");
  });
  it("starts a 30fps range on its exact requested frame even when seconds round upward", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "reacut-review-range-")); folders.push(root);
    const source = path.join(root, "frames.mkv");
    await runMediaTool("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "nullsrc=s=160x90:r=30:d=1,format=gbrp,geq=r='mod(N*70,240)':g='20':b='20'", "-c:v", "ffv1", source]);
    const [asset] = await importAssets([source], path.join(root, "cache"));
    const project = createProject("逐帧范围"); project.width = 160; project.height = 90; project.assets = [asset]; project.clips = [createClip(asset, project.tracks[1].id, 0, 30)];
    const render = async (name: string, range?: ExportOptions["range"]) => {
      const file = path.join(root, name + ".mp4");
      await new Promise<void>((resolve, reject) => { void startExport(project, { path: file, width: 160, height: 90, fps: 30, quality: "high", format: "mp4", range }, event => { if (event.status === "complete") resolve(); if (event.status === "error") reject(new Error(event.message)); }).catch(reject); });
      return runMediaTool("ffmpeg", ["-v", "error", "-i", file, "-an", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
    };
    const full = await render("full"), part = await render("part", { start: 2 / 30, end: 8 / 30 }), bytes = 160 * 90 * 3;
    expect(part.length / bytes).toBe(6);
    for (let frame = 0; frame < 6; frame++) {
      let sum = 0;
      for (let p = 0; p < bytes; p++) sum += Math.abs(part[frame * bytes + p] - full[(frame + 2) * bytes + p]);
      expect(sum / bytes).toBeLessThan(4);
    }
  }, 30000);
});
