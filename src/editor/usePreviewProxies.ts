import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project } from "../core/types";

const emptyURLs: ReadonlyMap<string, string> = new Map();

export function usePreviewProxies(project: Project) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("reacut-preview-proxies") === "on");
  const key = useMemo(() => {
    if (!enabled || !window.editorAPI) return "[]";
    const used = new Set(project.clips.map(clip => clip.assetId));
    return JSON.stringify([...new Set(project.assets.filter(asset =>
      used.has(asset.id) && !asset.missing && asset.kind === "video" &&
      (Math.max(asset.width, asset.height) > 1920 || Math.min(asset.width, asset.height) > 1080),
    ).map(asset => asset.path))].sort());
  }, [enabled, project.assets, project.clips]);
  const [state, setState] = useState({ key: "", total: 0, processed: 0, failed: 0, urls: new Map<string, string>() });
  useEffect(() => {
    const api = window.editorAPI, paths: string[] = JSON.parse(key);
    if (!api || !paths.length) return;
    const id = crypto.randomUUID();
    let active = true;
    setState(previous => ({ key, total: paths.length, processed: 0, failed: 0,
      urls: new Map(paths.flatMap(path => previous.urls.has(path) ? [[path, previous.urls.get(path)!]] : [])),
    }));
    const unsubscribe = api.onPreviewProxyProgress(event => {
      if (!active || event.jobId !== id) return;
      setState(previous => {
        const urls = new Map(previous.urls);
        if (event.url) urls.set(event.path, event.url);
        else urls.delete(event.path);
        return { ...previous, urls, processed: previous.processed + 1, failed: previous.failed + Number(event.failed ?? false) };
      });
    });
    void api.preparePreviewProxies(id, paths).catch(() => {
      if (active) setState(previous => ({ ...previous, processed: paths.length, failed: paths.length, urls: new Map() }));
    });
    return () => {
      active = false;
      unsubscribe();
      void api.cancelPreviewProxies(id).catch(() => {});
    };
  }, [key]);
  const discard = useCallback((path: string) => {
    setState(previous => {
      if (!previous.urls.has(path)) return previous;
      const urls = new Map(previous.urls);
      urls.delete(path);
      return { ...previous, urls, failed: previous.failed + 1 };
    });
  }, []);
  const active = enabled && state.key === key && state.total > 0;
  return {
    enabled, toggle: () => {
      localStorage.setItem("reacut-preview-proxies", enabled ? "off" : "on");
      setEnabled(!enabled);
    },
    active, processed: state.processed, total: state.total, failed: state.failed, discard,
    urls: active ? state.urls : emptyURLs,
  };
}
