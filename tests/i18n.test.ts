// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { zhCN } from "../src/i18n/locales/zh-CN";
import { en } from "../src/i18n/locales/en";
import { tr } from "../src/i18n/locales/tr";
import { read, remember, isLanguage, DEFAULT_LANGUAGE, STORAGE_KEY } from "../src/i18n/languageStore";

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

  it("should fallback to default language when storage is empty", () => {
    expect(read()).toBe(DEFAULT_LANGUAGE);
  });

  it("should fallback to default language on invalid saved preference", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("fr"));
    expect(read()).toBe(DEFAULT_LANGUAGE);
  });

  it("should fallback to default language on malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{invalid_json:");
    expect(read()).toBe(DEFAULT_LANGUAGE);
  });

  it("should read valid saved preference", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("tr"));
    expect(read()).toBe("tr");
  });

  it("should handle storage unavailable gracefully during read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(() => read()).not.toThrow();
    expect(read()).toBe(DEFAULT_LANGUAGE);
  });

  it("should handle storage unavailable gracefully during write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(() => remember("en")).not.toThrow();
  });
});