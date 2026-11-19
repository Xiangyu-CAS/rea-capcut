import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { pluginOutputFolder } from "../electron/pluginOutputs";

it("restricts batch output to new names in the chosen directory, including late collisions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reacut-output-test-"));
  try {
    const folder = await pluginOutputFolder(root);
    for (const name of ["../escape", "directory/file", "absolute\\name", "movie.mp4", "cOn", "aux.data"])
      await expect(folder.destination(name, "mp4")).rejects.toThrow(/filename/);
    const destination = await folder.destination("样片", "mp4");
    const temporary = path.join(root, "job.tmp");
    await writeFile(temporary, "new video");
    await writeFile(destination.path, "existing");
    await expect(destination.publish(temporary)).rejects.toThrow(/exists/);
    expect(await readFile(destination.path, "utf8")).toBe("existing");
    const next = await folder.destination("样片 2", "mp4");
    await next.publish(temporary);
    expect(await readFile(next.path, "utf8")).toBe("new video");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("invalidates the grant when the folder is replaced", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reacut-output-test-"));
  try {
    const target = path.join(root, "chosen");
    await mkdir(target);
    const folder = await pluginOutputFolder(target);
    const destination = await folder.destination("clip", "mov");
    await rename(target, path.join(root, "moved"));
    await mkdir(target);
    await expect(destination.verify()).rejects.toThrow(/changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
