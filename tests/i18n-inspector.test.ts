// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLanguageStore } from "../src/i18n";
import { createClip, createProject } from "../src/core/model";
import type { MediaAsset } from "../src/core/types";
import Inspector from "../src/components/Inspector";
import Timeline from "../src/components/Timeline";
import VisualTools from "../src/components/VisualTools";
import KeyframeCurveEditor from "../src/components/KeyframeCurveEditor";

const noop = () => {};
function fixture() {
  const project = createProject("User project");
  project.tracks.forEach((track) => { track.name = `${track.kind} track`; });
  const asset: MediaAsset = { id: "video", name: "User media", kind: "video", path: "/synthetic.mp4", url: "", duration: 5, width: 1920, height: 1080, fps: 30, hasAudio: true };
  project.assets = [asset];
  const clip = createClip(asset, project.tracks[1].id, 0, 30);
  project.clips = [clip];
  return { project, clip, asset };
}

describe("Inspector, timeline and visual-tool localization", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    useLanguageStore.getState().setLanguage("en");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useLanguageStore.getState().setLanguage("zh-CN");
    vi.unstubAllGlobals();
  });
  function englishUI() {
    expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    for (const el of host.querySelectorAll("[aria-label], [title], [placeholder]")) {
      for (const attr of ["aria-label", "title", "placeholder"]) {
        expect(el.getAttribute(attr) ?? "").not.toMatch(/[\u3400-\u9fff]/);
      }
    }
  }
  async function click(label: string) {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button, label).not.toBeNull();
    await act(async () => button!.click());
  }
  it("translates project properties and preserves user project names", async () => {
    const { project } = fixture();
    await act(async () => root.render(createElement(Inspector, { project, playhead: 0, onUpdate: noop, onProjectUpdate: noop })));
    englishUI();
    expect(host.textContent).toContain("Canvas settings");
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("画布设置");
    expect(host.querySelector<HTMLInputElement>('input')!.value).toBe("User project");
  });
  it("translates every video inspector tab and retains the active tab on language changes", async () => {
    const { project, clip } = fixture();
    await act(async () => root.render(createElement(Inspector, { project, clip, playhead: 0, onUpdate: noop, onProjectUpdate: noop })));
    for (const label of ["Picture", "Crop", "Chroma key", "Mask", "Audio", "Speed", "Adjust", "Animation"]) {
      if (["Crop", "Chroma key", "Mask"].includes(label)) await click("Picture");
      await click(label);
      englishUI();
    }
    expect(host.textContent).toContain("Keyframe curves");
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("关键帧曲线");
    expect(host.querySelector('button[aria-label="动画"]')?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => useLanguageStore.getState().setLanguage("en"));
    englishUI();
    expect(host.querySelector('button[aria-label="Animation"]')?.getAttribute("aria-pressed")).toBe("true");
  });
  it("translates text properties without translating authored text", async () => {
    const { project } = fixture();
    const clip = createClip(undefined, project.tracks[0].id, 0, 30);
    clip.name = "User title";
    clip.text!.text = "Authored text";
    project.clips = [clip];
    await act(async () => root.render(createElement(Inspector, { project, clip, playhead: 0, onUpdate: noop, onProjectUpdate: noop })));
    englishUI();
    expect(host.textContent).toContain("Text content");
    clip.text!.text = "用户原文";
    await act(async () => root.render(createElement(Inspector, { project, clip: { ...clip }, playhead: 0, onUpdate: noop, onProjectUpdate: noop })));
    expect(host.querySelector("textarea")?.value).toBe("用户原文");
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("文字内容");
    expect(host.querySelector("textarea")?.value).toBe("用户原文");
  });
  it.each(["crop", "chroma", "mask"] as const)("translates enabled %s controls and retains Chinese", async (mode) => {
    const { clip, asset } = fixture();
    clip.crop = { x: 0, y: 0, width: 1, height: 1 };
    clip.chromaKey = { enabled: true, color: "#00ff00", similarity: 0.1, blend: 0.1 };
    clip.mask = { shape: "rectangle", width: 1, height: 1, feather: 0, invert: false };
    await act(async () => root.render(createElement(VisualTools, { mode, clip, asset, onUpdate: noop })));
    englishUI();
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toMatch(/[\u3400-\u9fff]/);
  });
  it("translates core property/easing labels and selected-keyframe controls", async () => {
    const { project, clip } = fixture();
    clip.keyframes = [{ id: "key", time: 0, property: "x", value: 0, easing: "linear" }];
    await act(async () => root.render(createElement(KeyframeCurveEditor, { project, clip, playhead: 0, visual: true, onUpdate: noop })));
    const copy = Array.from(host.querySelectorAll("button")).find(el => el.textContent === "Copy keyframes");
    expect(copy!.disabled).toBe(true);
    englishUI();
    const selectAll = Array.from(host.querySelectorAll("button")).find(el => el.textContent === "Select all points on this curve");
    await act(async () => selectAll!.click());
    englishUI();
    expect(host.textContent).toContain("Ease in/out");
    expect(host.textContent).toContain("Position X");
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("缓入缓出");
  });
  it("translates timeline controls, track actions and deletion confirmation without changing media names", async () => {
    const { project } = fixture();
    await act(async () => root.render(createElement(Timeline, {
      project, selectedIds: [], playhead: 0, playing: false, zoom: 40,
      onSeek: noop, onSelect: noop, onClipUpdate: noop, onMoveClips: noop,
      onTrim: noop, onSplit: noop, onDelete: noop, onZoom: noop,
      onTrackUpdate: noop, onAddTrack: noop, onTrackDelete: noop,
    })));
    englishUI();
    await click("video track track actions");
    englishUI();
    const remove = Array.from(host.querySelectorAll("button")).find(el => el.textContent?.trim() === "Delete track");
    await act(async () => remove!.click());
    englishUI();
    expect(host.textContent).toContain("This also deletes 1 clips");
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("删除轨道和片段");
    expect(project.assets[0].name).toBe("User media");
  });
});
