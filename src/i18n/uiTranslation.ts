import { useLanguageStore, type Language } from "./languageStore";

/** Co-located UI copy. Turkish retains its existing dictionary translations and
 * uses English, rather than Chinese, for the newly translated editor panels.
 * Never apply this to user-authored project, media or subtitle content. */
export function translateUI(chinese: string, english: string, language: Language = useLanguageStore.getState().language): string {
  return language === "zh-CN" ? chinese : english;
}

export function useUITranslation() {
  useLanguageStore((state) => state.language);
  // Stable identity also keeps long-lived event callbacks on the latest locale.
  return translateUI;
}
