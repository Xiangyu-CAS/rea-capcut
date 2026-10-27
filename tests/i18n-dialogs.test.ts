// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLanguageStore } from "../src/i18n";
import { useEditorStore } from "../src/editor/store";
import { createProject } from "../src/core/model";
import { DEFAULT_TEXT } from "../src/core/defaults";
import { SubtitleAnimationForm, SubtitleStyleForm } from "../src/components/SubtitleBatchOptions";
import PackageDialog from "../src/components/PackageDialog";
import DerivativeDialog from "../src/components/DerivativeDialog";
import SpeechDialog from "../src/components/SpeechDialog";
import TemplateDialog from "../src/components/TemplateDialog";
import SubtitlePanel from "../src/components/SubtitlePanel";

describe("English dialog and subtitle coverage", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLanguageStore.getState().setLanguage("en");
    const project = createProject("User project");
    project.tracks.forEach(track => { track.name = track.kind; });
    useEditorStore.getState().setProject(project);
    vi.stubGlobal("editorAPI", undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    useLanguageStore.getState().setLanguage("zh-CN");
  });
  const noop = () => {};
  function expectEnglishUI() {
    expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    for (const element of host.querySelectorAll("[aria-label], [title], [placeholder]")) {
      for (const attr of ["aria-label", "title", "placeholder"]) {
        expect(element.getAttribute(attr) ?? "").not.toMatch(/[\u3400-\u9fff]/);
      }
    }
  }
  it("translates animation options and hints reactively in both directions", async () => {
    await act(async () => root.render(createElement(SubtitleAnimationForm, {
      value: { entrance: "fade", exit: "fade", inDuration: 0.4, outDuration: 0.4, distance: 48 }, onChange: noop,
    })));
    expectEnglishUI();
    expect(host.textContent).toContain("Entrance animation");
    expect(host.textContent).toContain("Single pulse zoom");
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("入场动画");
    expect(host.textContent).toContain("一次呼吸缩放");
    await act(async () => useLanguageStore.getState().setLanguage("en"));
    expectEnglishUI();
  });
  it("translates style controls and accessibility labels", async () => {
    await act(async () => root.render(createElement(SubtitleStyleForm, { value: DEFAULT_TEXT, onChange: noop })));
    expectEnglishUI();
    expect(host.querySelector('[aria-label="Batch subtitle font size"]')).not.toBeNull();
  });
  it("keeps user project names intact while switching packaging copy", async () => {
    const project = createProject("我的项目 · My project");
    await act(async () => root.render(createElement(PackageDialog, { project, onClose: noop })));
    expect(host.querySelector("h3")?.textContent).toBe(project.name);
    expect(host.textContent).toContain("Collect project assets");
    expect(host.textContent).toContain("0 original assets");
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("收集项目素材");
    expect(host.querySelector("h3")?.textContent).toBe(project.name);
  });
  it.each(["reverse", "freeze"] as const)("localizes %s controls and preflight errors", async (mode) => {
    await act(async () => root.render(createElement(DerivativeDialog, { mode, onClose: noop })));
    expectEnglishUI();
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
  it("translates built-in template catalogue and save controls without renaming user data", async () => {
    vi.stubGlobal("editorAPI", {
      listTemplates: async () => [],
      onTemplateProgress: () => noop,
    });
    await act(async () => root.render(createElement(TemplateDialog, { onClose: noop, onCreate: () => true })));
    expectEnglishUI();
    expect(host.textContent).toContain("Product promo · Three scenes");
    expect(host.textContent).toContain("Photo story · Travel journal");
    const saveTab = [...host.querySelectorAll("button")].find(button => button.textContent === "Save current project as template")!;
    await act(async () => saveTab.click());
    expectEnglishUI();
    expect(host.querySelector<HTMLInputElement>('[aria-label="Template name"]')?.value).toBe("User project");
    await act(async () => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("保存模板及媒体副本");
    expect(host.querySelector<HTMLInputElement>('[aria-label="模板名称"]')?.value).toBe("User project");
  });
  it("starts English text-to-speech with an English voice language", async () => {
    vi.stubGlobal("editorAPI", {
      getSpeechInfo: async () => ({ ready: false, voices: [], error: "Speech unavailable on this platform" }),
      onSpeechProgress: () => noop,
    });
    await act(async () => root.render(createElement(SpeechDialog, { mode: "tts", onClose: noop })));
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Speech language"]')?.value).toBe("en");
    expect(host.textContent).toContain("Text to speech");
  });
  it("localizes the empty subtitle editor and all batch controls", async () => {
    await act(async () => root.render(createElement(SubtitlePanel, { onImport: noop, onExport: noop, onSpeech: noop })));
    expectEnglishUI();
    expect(host.textContent).toContain("Batch edit");
    expect(host.textContent).toContain("Import subtitle file");
  });
});
