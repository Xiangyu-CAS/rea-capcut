import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useLanguageStore } from "./i18n";
import { installPluginBridge } from "./editor/pluginBridge";
installPluginBridge();
// Keep native menus/dialogs and the document language aligned on startup and
// every switch. Saved preference remains renderer-owned; no new file access.
function syncLanguage() {
  const language = useLanguageStore.getState().language;
  document.documentElement.lang = language;
  void window.editorAPI?.setUILanguage?.(language).catch(console.error);
}
syncLanguage();
useLanguageStore.subscribe(syncLanguage);
void document.fonts
  .load('16px \"Noto Sans SC\"')
  .catch(() => [])
  .finally(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
  });
