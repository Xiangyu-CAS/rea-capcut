import { create } from "zustand";

export type Language = "zh-CN" | "en" | "tr";
export type LanguagePreference = "system" | Language;

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

/** Choose the first supported OS/browser language. */
export function detectLanguage(languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]): Language {
  for (const locale of languages) {
    const code = locale.toLowerCase().split(/[-_]/)[0];
    if (code === "zh") return "zh-CN";
    if (code === "tr") return "tr";
    if (code === "en") return "en";
  }
  return DEFAULT_LANGUAGE;
}

export function readPreference(): LanguagePreference {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return isLanguage(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function remember(preference: LanguagePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    /* UI still switches languages if preferences are unavailable. */
  }
}

export interface LanguageState {
  preference: LanguagePreference;
  language: Language;
  setLanguage: (preference: LanguagePreference) => void;
  refreshSystemLanguage: () => void;
}

function resolveLanguage(preference: LanguagePreference): Language {
  return preference === "system" ? detectLanguage() : preference;
}

export const useLanguageStore = create<LanguageState>((set, get) => {
  const preference = readPreference();
  return {
    preference,
    language: resolveLanguage(preference),
    setLanguage: (next) => {
      if (next !== "system" && !isLanguage(next)) return;
      remember(next);
      set({ preference: next, language: resolveLanguage(next) });
    },
    refreshSystemLanguage: () => {
      if (get().preference === "system") set({ language: detectLanguage() });
    },
  };
});
