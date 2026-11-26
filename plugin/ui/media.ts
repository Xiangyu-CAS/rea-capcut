import type { App } from "@modelcontextprotocol/ext-apps";
import { useEffect, useMemo, useReducer, useRef } from "react";
import type { PanelMediaChunk } from "../../src/core/pluginPanel";
import type { Project } from "../../src/core/types";
import { callPanel } from "./session";

type Preview = { url?: string; failed?: boolean };

async function loadMedia(app: App, id: string, kind: "preview" | "thumbnail", signal: AbortSignal) {
  const request = (offset: number, version?: string) =>
    callPanel<PanelMediaChunk | null>(app, "reacut_panel_media", { id, kind, offset, version });
  const first = await request(0);
  if (!first) return;
  const buffers: ArrayBuffer[] = [];
  let part = first;
  let offset = 0;
  while (!signal.aborted) {
    const binary = atob(part.data);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (!bytes.length || part.version !== first.version || part.size !== first.size || offset + bytes.length > first.size)
      throw new Error("Incomplete media preview.");
    buffers.push(bytes.buffer);
    offset += bytes.length;
    if (offset === first.size) return URL.createObjectURL(new Blob(buffers, { type: first.type }));
    const next = await request(offset, first.version);
    if (!next) throw new Error("Incomplete media preview.");
    part = next;
  }
}

function useMediaDownloads(app: App, key: string, kind: "preview" | "thumbnail", cache: Map<string, Preview>, refresh: () => void) {
  useEffect(() => {
    const controller = new AbortController();
    const [, ...ids] = JSON.parse(key) as string[];
    for (const [id, entry] of cache) {
      if (!ids.includes(id)) {
        if (entry.url) URL.revokeObjectURL(entry.url);
        cache.delete(id);
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < ids.length && !controller.signal.aborted) {
        const id = ids[next++];
        if (cache.has(id)) continue;
        try {
          const url = await loadMedia(app, id, kind, controller.signal);
          if (controller.signal.aborted) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          cache.set(id, { url });
        } catch {
          if (controller.signal.aborted) return;
          cache.set(id, { failed: true });
        }
        refresh();
      }
    };
    void worker();
    void worker();
    return () => controller.abort();
  }, [key, app, kind, cache, refresh]);
}

export function usePanelMedia(app: App, project: Project, playhead: number, sourceId?: string) {
  const [version, refresh] = useReducer((previous: number) => previous + 1, 0);
  const previews = useRef(new Map<string, Preview>()).current;
  const thumbs = useRef(new Map<string, Preview>()).current;
  const active = project.clips.filter(clip => clip.assetId && clip.start <= playhead + 2 && clip.start + clip.duration >= playhead - 0.5);
  const assetIds = [...new Set([sourceId, ...active.map(clip => clip.assetId)])].filter((id): id is string => !!id);
  const previewKey = JSON.stringify([project.id, ...assetIds.slice(0, 6)]);
  const thumbKey = JSON.stringify([project.id, ...project.assets.filter(asset => asset.kind !== "audio" && !asset.missing).slice(0, 40).map(asset => asset.id)]);

  useEffect(() => {
    return () => {
      for (const item of [...previews.values(), ...thumbs.values()]) if (item.url) URL.revokeObjectURL(item.url);
      previews.clear();
      thumbs.clear();
    };
  }, [project.id, previews, thumbs]);

  useMediaDownloads(app, previewKey, "preview", previews, refresh);
  useMediaDownloads(app, thumbKey, "thumbnail", thumbs, refresh);

  const assets = useMemo(() => project.assets.map(asset => ({
    ...asset, thumbnail: thumbs.get(asset.id)?.url, url: previews.get(asset.id)?.url ?? asset.url,
  })), [project.assets, version, thumbs, previews]);
  const playable = useMemo(() => assets.map(asset => ({ ...asset, missing: asset.missing || !previews.get(asset.id)?.url })), [assets, previews]);
  return {
    assets,
    playable,
    failed: assetIds.length > 6 || assetIds.some(id => previews.get(id)?.failed),
    loading: assetIds.slice(0, 6).some(id => !previews.has(id) && !project.assets.find(asset => asset.id === id)?.missing),
  };
}
