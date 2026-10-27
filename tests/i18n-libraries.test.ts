// @vitest-environment jsdom
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createElement, act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLanguageStore } from "../src/i18n";
import { LIBRARY_ENGLISH } from "../src/components/libraryLabels";
import { BUILTIN_ASSETS, BUILTIN_CATEGORIES } from "../src/core/builtinAssets";
import { TEXT_PRESETS, MOTION_PRESETS, TRANSITION_PRESETS } from "../src/core/creativePresets";
import { COLOR_PRESETS } from "../src/components/EffectsPanel";
import AssetLibrary from "../src/components/AssetLibrary";
import { TextLibrary, MotionLibrary, TransitionLibrary } from "../src/components/CreativeLibrary";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterAll(() => vi.restoreAllMocks());
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; useLanguageStore.setState({ language: "zh-CN" }); });
function mount(component: ComponentType<any>, props: Record<string, unknown>) {
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); act(() => root!.render(createElement(component, props))); return host;
}
describe("English built-in libraries", () => {
  it("covers every built-in name, category, description and Chinese sample text", () => {
    const values = [...BUILTIN_ASSETS.map(a => a.name), ...BUILTIN_CATEGORIES.map(c => c.name), ...TEXT_PRESETS.flatMap(p => [p.name, p.category, p.style.text ?? ""]), ...MOTION_PRESETS.flatMap(p => [p.name, p.description]), ...TRANSITION_PRESETS.flatMap(p => [p.name, p.description, p.category]), ...COLOR_PRESETS.flatMap(p => [p.name, p.description])];
    for (const value of values.filter(value => /[\u3400-\u9fff]/.test(value))) {
      expect(LIBRARY_ENGLISH[value], value).toBeTruthy();
      expect(LIBRARY_ENGLISH[value], value).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
  it("switches the asset library live, searches English names and retains source data", () => {
    const originals = JSON.stringify(BUILTIN_ASSETS);
    const host = mount(AssetLibrary, { onAdd() {} });
    expect(host.textContent).toContain("灵感素材");
    act(() => useLanguageStore.getState().setLanguage("en"));
    expect(host.textContent).toContain("Creative assets");
    expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    const input = host.querySelector("input")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Four-point"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelectorAll(".builtin-card")).toHaveLength(1);
    expect(host.textContent).toContain("Four-point sparkle");
    act(() => useLanguageStore.getState().setLanguage("zh-CN"));
    expect(host.textContent).toContain("灵感素材");
    expect(JSON.stringify(BUILTIN_ASSETS)).toBe(originals);
  });
  it.each([TextLibrary, MotionLibrary, TransitionLibrary])("renders English catalog copy without Chinese UI", (component) => {
    act(() => useLanguageStore.getState().setLanguage("en"));
    const host = mount(component, { disabled: true, onApply() {}, onAdd() {}, onBlank() {} });
    expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect([...host.querySelectorAll("[aria-label], [title]")].map(e => e.getAttribute("aria-label") ?? e.getAttribute("title")).join(" ")).not.toMatch(/[\u3400-\u9fff]/);
  });
});
