import { create } from "zustand";

export type Language = "zh-CN" | "en" | "tr";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["zh-CN", "en", "tr"];
export const DEFAULT_LANGUAGE: Language = "en";

// Match the namespaced, versioned pattern used in EditorWorkspace.tsx
export const STORAGE_KEY = "reacut-ui-language-v1";

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/** Use the OS/browser preference on first launch, not a Chinese-only default.
 * An explicit saved choice always wins, including on subsequent launches. */
export function detectLanguage(languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]): Language {
  for (const locale of languages) {
    const code = locale.toLowerCase().split(/[-_]/)[0];
    if (code === "zh") return "zh-CN";
    if (code === "tr") return "tr";
    if (code === "en") return "en";
  }
  return DEFAULT_LANGUAGE;
}

export function read(): Language {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return isLanguage(value) ? value : detectLanguage();
  } catch {
    return detectLanguage();
  }
}

export function remember(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(language));
  } catch {
    /* UI still switches languages if preferences are unavailable. */
  }
}

export interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: read(),
  setLanguage: (language) => {
    if (!isLanguage(language)) return;
    remember(language);
    set({ language });
  },
}));
