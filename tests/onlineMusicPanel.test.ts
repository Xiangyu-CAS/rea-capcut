// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import AssistantPanel from "../src/components/AssistantPanel";
import { createProject } from "../src/core/model";
import { useEditorStore } from "../src/editor/store";
import type { MusicResult } from "../src/core/onlineMusic";
import type { EditorAPI, MediaAsset } from "../src/core/types";

it("recommends music in the Agent before sign-in and clicks a result into the timeline", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const track: MusicResult = { id: "incompetech-fixture", title: "Fixture Track", creator: "Composer", duration: 10,
    sourceUrl: "https://incompetech.com/music/royalty-free/licenses/", license: "CC BY",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/", downloadable: true, provider: "Incompetech" };
  const asset: MediaAsset = { id: "fixture-audio", name: track.title, kind: "audio", duration: 10, hasAudio: true,
    width: 0, height: 0, fps: 0, path: "/music.mp3", url: "reacut-media://asset?path=%2Fmusic.mp3",
    musicCredit: { sourceId: track.id, title: track.title, creator: track.creator, sourceUrl: track.sourceUrl, license: track.license, licenseUrl: track.licenseUrl } };
  const searchOnlineMusic = vi.fn(async () => ({ tracks: [track], incompetech: true, openverse: "unavailable" as const }));
  const downloadOnlineMusic = vi.fn(async () => asset);
  window.editorAPI = {
    getAssistantProviders: async () => [],
    getAssistantHistory: async () => [],
    onAssistantEvent: () => () => {},
    searchOnlineMusic, downloadOnlineMusic,
  } as unknown as EditorAPI;
  useEditorStore.getState().setProject(createProject());
  const parent = document.createElement("div");
  document.body.append(parent);
  const root = createRoot(parent);
  const noop = () => {};
  try {
    await act(async () => root.render(createElement(AssistantPanel, {
      inspectorVisible: false, importing: false, onToggleInspector: noop, onImportMedia: noop,
      onPreviewMedia: noop, onSpeechSetup: noop, onClose: noop,
    })));
    const byText = (pattern: RegExp) => [...parent.querySelectorAll("button")].find(button => pattern.test(button.textContent ?? ""));
    const starter = byText(/Find background music|推荐配乐/);
    expect(starter).toBeTruthy();
    await act(async () => starter!.click());
    const form = parent.querySelector(".assistant-music form");
    expect(form).toBeTruthy();
    await act(async () => form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(searchOnlineMusic).toHaveBeenCalledWith("");
    expect(parent.textContent).toContain(track.title);
    const add = byText(/Download & add|下载并添加/);
    expect(add).toBeTruthy();
    await act(async () => add!.click());
    expect(downloadOnlineMusic).toHaveBeenCalledWith(track.id);
    const state = useEditorStore.getState();
    expect(state.project.clips[0]).toMatchObject({ assetId: asset.id, volume: .2 });
    expect(state.project.assets[0].musicCredit).toEqual(asset.musicCredit);
    await act(async () => state.undo());
    expect(useEditorStore.getState().project.clips).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    parent.remove();
    delete window.editorAPI;
  }
});
