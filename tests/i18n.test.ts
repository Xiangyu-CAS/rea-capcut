// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { zhCN } from "../src/i18n/locales/zh-CN";
import { en } from "../src/i18n/locales/en";
import { tr } from "../src/i18n/locales/tr";
import { readPreference, remember, isLanguage, detectLanguage, useLanguageStore, STORAGE_KEY } from "../src/i18n/languageStore";

describe("i18n Dictionaries Parity", () => {
  it("should have exactly the same keys in all languages", () => {
    const zhKeys = Object.keys(zhCN).sort();
    const enKeys = Object.keys(en).sort();
    const trKeys = Object.keys(tr).sort();

    expect(enKeys).toEqual(zhKeys);
    expect(trKeys).toEqual(zhKeys);
  });

  it("should have matching interpolation placeholders across languages", () => {
    const extractPlaceholders = (str: string) => (str.match(/\{\w+\}/g) || []).sort();

    Object.keys(zhCN).forEach((key) => {
      const zhPlaceholders = extractPlaceholders(zhCN[key as keyof typeof zhCN]);
      if (zhPlaceholders.length > 0) {
        expect(extractPlaceholders(en[key as keyof typeof en])).toEqual(zhPlaceholders);
        expect(extractPlaceholders(tr[key as keyof typeof tr])).toEqual(zhPlaceholders);
      }
    });
  });
});

describe("languageStore Preferences & Fallbacks", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should validate supported languages correctly", () => {
    expect(isLanguage("zh-CN")).toBe(true);
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("tr")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage(123)).toBe(false);
  });

  it("follows the system when storage is empty", () => {
    expect(readPreference()).toBe("system");
  });

  it("should fallback to default language on invalid saved preference", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("fr"));
    expect(readPreference()).toBe("system");
  });

  it("should fallback to default language on malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{invalid_json:");
    expect(readPreference()).toBe("system");
  });

  it("should read valid saved preference", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("tr"));
    expect(readPreference()).toBe("tr");
  });

  it("should handle storage unavailable gracefully during read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(readPreference()).toBe("system");
  });

  it("should handle storage unavailable gracefully during write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(() => remember("en")).not.toThrow();
  });
});

describe("system language selection", () => {
  it("uses supported OS languages with English as the safe fallback", () => {
    expect(detectLanguage(["en-GB"])).toBe("en");
    expect(detectLanguage(["zh-Hans-CN"])).toBe("zh-CN");
    expect(detectLanguage(["tr-TR"])).toBe("tr");
    expect(detectLanguage(["fr-FR", "zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(detectLanguage(["fr-FR"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });
  it("resumes following the system after a manual choice", () => {
    const systemLanguages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    const store = useLanguageStore.getState();
    store.setLanguage("en");
    store.refreshSystemLanguage();
    expect(useLanguageStore.getState().language).toBe("en");
    expect(readPreference()).toBe("en");
    store.setLanguage("system");
    expect(useLanguageStore.getState()).toMatchObject({ preference: "system", language: "zh-CN" });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('"system"');
    systemLanguages.mockReturnValue(["fr-FR"]);
    store.refreshSystemLanguage();
    expect(useLanguageStore.getState()).toMatchObject({ preference: "system", language: "en" });
    vi.restoreAllMocks();
  });
  it("switches even when storage is unavailable and ignores invalid values", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    useLanguageStore.getState().setLanguage("en");
    expect(useLanguageStore.getState().language).toBe("en");
    useLanguageStore.getState().setLanguage("invalid" as never);
    expect(useLanguageStore.getState().language).toBe("en");
    vi.restoreAllMocks();
  });
});
