import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createOnlineMusic } from "../electron/onlineMusic";
import { importAssets, probeFile } from "../electron/media";
import { collectPortableProject, resolvePortableDocument } from "../electron/portableProject";
import { startExport } from "../electron/export";
import { createClip, createProject, validateProject } from "../src/core/model";
import { useEditorStore } from "../src/editor/store";
import type { ExportProgress } from "../src/core/types";

const toolsAvailable = ["ffmpeg", "ffprobe"].every(tool => spawnSync(tool, ["-version"]).status === 0);
it.skipIf(!toolsAvailable)("imports a complete MP3, keeps the credit in a portable project, and exports playable audio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reacut-music-media-"));
  try {
    const cache = path.join(root, "cache");
    const real = process.env.REACUT_TEST_MUSIC_MP3, realCatalog = process.env.REACUT_TEST_MUSIC_CATALOG;
    // The shipped media tools decode MP3, but need not include an MP3 encoder.
    const song = real ?? new URL("./fixtures/online-music-tone.mp3", import.meta.url);
    const service = createOnlineMusic(path.join(root, "music"), async url => {
      if (String(url).endsWith("pieces.json")) return realCatalog ? new Response(await readFile(realCatalog)) : Response.json([
        { title: "Carefree", filename: "Carefree.mp3", length: "00:00:04", isrc: "USUAN1400037" },
      ]);
      if (String(url).endsWith("/Carefree.mp3")) return new Response(await readFile(song));
      return new Response(null, { status: 403 });
    });
    const { tracks } = await service.search("Carefree");
    const candidate = tracks.find(track => track.title === "Carefree")!;
    expect(candidate.downloadable).toBe(true);
    const { file } = await service.download(candidate.id);
    const [music] = await importAssets([file], cache);
    expect(music.kind).toBe("audio");
    expect(music.duration).toBeGreaterThan(3.9);
    const { title, creator, sourceUrl, license, licenseUrl } = candidate;
    music.name = title;
    music.musicCredit = { sourceId: candidate.id, title, creator, sourceUrl, license, licenseUrl };
    const vid = path.join(root, "input.mp4");
    const makeVideo = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2:r=30", "-c:v", "libx264", vid], { encoding: "utf8" });
    expect(makeVideo.status, makeVideo.stderr || makeVideo.error?.message).toBe(0);
    const [video] = await importAssets([vid], cache);
    const project = createProject();
    project.width = 320; project.height = 240;
    project.name = "Music smoke";
    project.assets = [video];
    project.clips = [createClip(video, project.tracks.find(t => t.kind === "video")!.id, 0, project.fps)];
    const state = useEditorStore.getState;
    state().setProject(project); state().addBackgroundMusic(music);
    const saved = validateProject(JSON.parse(JSON.stringify(state().project)));
    expect(saved.clips.at(-1)?.duration).toBeCloseTo(2, 2);
    const folder = await collectPortableProject(saved, root, new AbortController().signal, () => {});
    const packed = path.join(folder, "项目.reacut");
    const reopened = await resolvePortableDocument(JSON.parse(await readFile(packed, "utf8")), packed);
    expect(reopened.assets.at(-1)?.musicCredit).toEqual(music.musicCredit);
    const out = path.join(root, "out.mp4");
    const event = await new Promise<ExportProgress>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out exporting")), 20000);
      startExport(reopened, { path: out, width: 320, height: 240, fps: 30, quality: "standard", format: "mp4" }, progress => {
        if (progress.status === "complete" || progress.status === "error") { clearTimeout(timer); resolve(progress); }
      }).catch(error => { clearTimeout(timer); reject(error); });
    });
    expect(event.status, event.message).toBe("complete");
    expect((await probeFile(out)).streams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
