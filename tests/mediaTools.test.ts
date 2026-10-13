import { afterAll, beforeAll, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveMediaTool } from "../electron/mediaTools";

let directory: string, bundledDirectory: string, system: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "reacut-tools-"));
  bundledDirectory = path.join(directory, "App with spaces.app", "media-tools");
  system = path.join(directory, "system");
  for (const folder of [bundledDirectory, system]) {
    await mkdir(folder, { recursive: true });
    for (const tool of ["ffmpeg", "ffprobe"]) {
      await writeFile(path.join(folder, tool), "#!/bin/sh\nexit 0\n");
      await chmod(path.join(folder, tool), 0o755);
    }
  }
});
afterAll(() => rm(directory, { recursive: true, force: true }));
it("uses both bundled tools even with a competing PATH", async () => {
  for (const name of ["ffmpeg", "ffprobe"] as const)
    expect(await resolveMediaTool(name, { platform: "darwin", bundledDirectory, env: { PATH: system } }))
      .toBe(path.join(bundledDirectory, name));
});
it("keeps an explicit user override ahead of the bundled tool", async () => {
  const override = path.join(system, "ffmpeg");
  expect(await resolveMediaTool("ffmpeg", { platform: "darwin", bundledDirectory, env: { REACUT_FFMPEG: override } })).toBe(override);
});
it("reports a damaged bundle instead of silently using system tools", async () => {
  await expect(resolveMediaTool("ffprobe", { platform: "darwin", bundledDirectory: path.join(directory, "missing"), env: { PATH: system } }))
    .rejects.toThrow("内置 ffprobe");
});
it("does not hide a stale explicit override with the bundled tool", async () => {
  await expect(resolveMediaTool("ffmpeg", { platform: "darwin", bundledDirectory, env: { REACUT_FFMPEG: directory } }))
    .rejects.toThrow("所选 ffmpeg");
});
it("retains PATH discovery for source development", async () => {
  expect(await resolveMediaTool("ffmpeg", { platform: "darwin", env: { PATH: system } })).toBe(path.join(system, "ffmpeg"));
});
