import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { MediaAsset } from "../src/core/types";
import type { PanelMediaChunk } from "../src/core/pluginPanel";
import { pluginPreviewProxy } from "./media";

const CHUNK_BYTES = 256 * 1024;
const MAX_PREVIEW = 96 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp",
};

function mediaPath(url?: string) {
  if (!url?.startsWith("reacut-media://asset?")) return;
  return new URL(url).searchParams.get("path") ?? undefined;
}

export function createPanelMediaReader(authorized: ReadonlyMap<string, string>, cacheDir: () => string) {
  const preparations = new Map<string, Promise<string>>();
  async function authorizedFile(file: string) {
    const original = authorized.get(path.resolve(file));
    if (!original || original !== await realpath(file)) throw new Error("Preview source is unavailable.");
    return original;
  }

  async function previewFile(asset: MediaAsset, version?: string, offset = 0) {
    const file = await authorizedFile(mediaPath(asset.previewUrl) ?? asset.path);
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new Error("Preview source is unavailable.");
    if (mimeTypes[path.extname(file).toLowerCase()]?.startsWith(asset.kind + "/") &&
        metadata.size <= (asset.kind === "video" ? 8 * 1024 * 1024 : 16 * 1024 * 1024)) return file;
    const key = JSON.stringify([file, asset.kind, metadata.size, metadata.mtimeMs]);
    let preparing = preparations.get(key);
    if (!preparing) {
      // A nonzero offset is only valid for a representation already generated.
      if (offset && !version) throw new Error("Start the preview at byte zero.");
      preparing = pluginPreviewProxy(file, asset.kind, cacheDir(), AbortSignal.timeout(45_000)).then(url => mediaPath(url)!);
      preparations.set(key, preparing);
      void preparing.catch(() => preparations.delete(key));
      if (preparations.size > 64) preparations.delete(preparations.keys().next().value!);
    }
    const proxy = await preparing;
    const canonical = await realpath(proxy);
    if (path.dirname(canonical) !== await realpath(cacheDir()) || path.basename(canonical) !== path.basename(proxy))
      throw new Error("Preview cache is unavailable.");
    return canonical;
  }

  return async function read(asset: MediaAsset, kind: "preview" | "thumbnail", offset: number, expectedVersion?: string): Promise<PanelMediaChunk | null> {
    const thumbnail = kind === "thumbnail" ? mediaPath(asset.thumbnail) : undefined;
    if (kind === "thumbnail" && !thumbnail) return null;
    const file = thumbnail ? await authorizedFile(thumbnail) : await previewFile(asset, expectedVersion, offset);
    const type = mimeTypes[path.extname(file).toLowerCase()];
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const metadata = await handle.stat();
      if (!type || !metadata.isFile() || !metadata.size || metadata.size > MAX_PREVIEW)
        throw new Error("Preview is unavailable at this size. Open the desktop window to play the source.");
      const version = createHash("sha256").update(JSON.stringify([file, metadata.ino, metadata.mtimeMs, metadata.size])).digest("hex");
      if ((offset && expectedVersion !== version) || offset >= metadata.size) throw new Error("Preview changed. Reload this media.");
      const bytes = Buffer.alloc(Math.min(CHUNK_BYTES, metadata.size - offset));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      if (bytesRead !== bytes.length) throw new Error("Preview changed. Reload this media.");
      return { size: metadata.size, type, version, data: bytes.toString("base64") };
    } finally {
      await handle.close();
    }
  };
}
