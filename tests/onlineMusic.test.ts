import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOnlineMusic } from "../electron/onlineMusic";
import { createClip, createProject, validateProject } from "../src/core/model";
import { musicPromptQuery, musicCreditLine } from "../src/core/onlineMusic";
import type { MediaAsset } from "../src/core/types";
import { useEditorStore } from "../src/editor/store";

const catalog = [{ title: "Carefree", filename: "Carefree.mp3", isrc: "USUAN1400037", length: "00:01:43", feel: "Bright, Upbeat", instruments: "Piano" }];
const uuid = "12345678-1234-1234-1234-123456789abc";
const mp3 = Buffer.alloc(256); mp3.write("ID3");
const roots: string[] = [];
async function root() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reacut-music-test-"));
  roots.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, { force: true, recursive: true }))); });

describe("online music", () => {
  it("finds downloadable music with no login and keeps Openverse links source-only", async () => {
    const stub = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      const uri = String(url);
      if (uri.endsWith("/pieces.json")) return Response.json([
        ...catalog, { ...catalog[0], filename: "../other.mp3", isrc: "USUAN1400077" },
      ]);
      if (uri.endsWith("/Carefree.mp3")) return new Response(mp3);
      expect(new URL(uri).searchParams.get("license")).toBe("cc0,by");
      expect(new URL(uri).searchParams.get("q")).toBe("upbeat piano");
      return Response.json({ results: [
        { id: uuid, title: "Open Piano", creator: "Creator", duration: 45000, license: "by", license_version: "4.0", url: "http://localhost/music.mp3" },
        { id: uuid, title: "No derivatives", license: "by-nd", license_version: "4.0" },
      ] });
    });
    const service = createOnlineMusic(await root(), stub);
    const result = await service.search("轻快钢琴");
    expect(result.tracks.map(track => [track.title, track.downloadable, track.duration])).toEqual([["Carefree", true, 103], ["Open Piano", false, 45]]);
    const hit = result.tracks[0];
    expect(musicCreditLine(hit)).toContain("Kevin MacLeod");
    expect(result.tracks[1].sourceUrl).toBe(`https://openverse.org/audio/${uuid}`);
    await expect(service.download(result.tracks[1].id)).rejects.toThrow("original source");
    await expect(service.download("https://incompetech.com/unknown.mp3")).rejects.toThrow("Search again");
    const { file } = await service.download(hit.id);
    expect(await readFile(file)).toEqual(mp3);
    expect((await service.download(hit.id)).file).toBe(file);
    expect(stub).toHaveBeenCalledTimes(3);
  });

  it("keeps Incompetech usable during Openverse throttling and refuses non-MP3", async () => {
    let now = 0;
    const stub = vi.fn<typeof fetch>(async url => {
      const uri = String(url);
      if (uri.endsWith("/pieces.json")) return Response.json(catalog);
      if (uri.endsWith(".mp3")) return new Response("<!doctype html>" + "a".repeat(256));
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    });
    const service = createOnlineMusic(await root(), stub, () => now);
    const first = await service.search("carefree");
    expect(first.openverse).toBe("limited");
    expect(first.tracks).toHaveLength(1);
    now += 5000;
    const second = await service.search("piano");
    expect(second.openverse).toBe("limited");
    expect(second.tracks).toHaveLength(1);
    expect(stub).toHaveBeenCalledTimes(2);
    await expect(service.download(second.tracks[0].id)).rejects.toThrow("not MP3");
  });

  it("handles a simple music request without routing multi-step edits or other requests", () => {
    expect(musicPromptQuery("增加合适的背景音乐")).toBe("");
    expect(musicPromptQuery("帮我给这个视频加上轻快配乐")).toBe("轻快");
    expect(musicPromptQuery("Add upbeat background music to this video")).toBe("upbeat");
    expect(musicPromptQuery("Add upbeat background music and trim the intro")).toBeUndefined();
    expect(musicPromptQuery("添加配乐，然后删掉前面两秒")).toBeUndefined();
    expect(musicPromptQuery("移除背景音乐")).toBeUndefined();
  });

  it("puts the downloaded file on a separate faded track with one-step undo", () => {
    const project = createProject();
    const clipAsset: MediaAsset = { id: "video", name: "Video", path: "/video.mp4", url: "file:///video.mp4", duration: 5, width: 1920, height: 1080, fps: 30, kind: "video", hasAudio: true };
    project.assets = [clipAsset];
    const video = createClip(clipAsset, project.tracks.find(track => track.kind === "video")!.id, 2, project.fps);
    project.clips = [video];
    const state = useEditorStore.getState;
    state().setProject(project);
    const musicCredit: NonNullable<MediaAsset["musicCredit"]> = {
      sourceId: "test", title: "Music", creator: "Composer", license: "CC BY",
      sourceUrl: "https://example.com/music", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    };
    state().addBackgroundMusic({ ...clipAsset, id: "music", kind: "audio", path: "/music.mp3", duration: 40, musicCredit });
    const result = validateProject(state().project);
    expect(result.clips[0]).toEqual(video);
    expect(result.clips[1]).toMatchObject({ start: 2, duration: 5, volume: 0.2, audioFadeIn: 0.4, audioFadeOut: 0.8 });
    expect(result.tracks.at(-1)?.kind).toBe("audio");
    expect(result.assets[1].musicCredit).toEqual(musicCredit);
    state().undo();
    expect(state().project.assets).toHaveLength(1);
    expect(state().project.clips).toHaveLength(1);
  });
});
