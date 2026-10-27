import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DerivativeProgress, EditorAPI, ExportProgress } from "../src/core/types";
import type { AssistantEvent } from "../src/core/assistantTypes";
const api: EditorAPI = {
  setUILanguage: language => ipcRenderer.invoke("set-ui-language", language),
  listTemplates: () => ipcRenderer.invoke("template-list"),
  loadTemplate: (id, builtin) => ipcRenderer.invoke("template-load", id, builtin),
  saveTemplate: (jobId, template) => ipcRenderer.invoke("template-save", jobId, template),
  importTemplate: jobId => ipcRenderer.invoke("template-import", jobId),
  exportTemplate: (jobId, id) => ipcRenderer.invoke("template-export", jobId, id),
  cancelTemplate: jobId => ipcRenderer.invoke("template-cancel", jobId),
  onTemplateProgress: callback => {
    const listener = (_: unknown, event: DerivativeProgress) => callback(event);
    ipcRenderer.on("template-progress", listener);
    return () => ipcRenderer.removeListener("template-progress", listener);
  },
  getSpeechInfo: () => ipcRenderer.invoke("speech-info"),
  chooseSpeechDependency: kind => ipcRenderer.invoke("speech-choose-dependency", kind),
  generateSpeech: (jobId, project, request) => ipcRenderer.invoke("speech-generate", jobId, project, request),
  cancelSpeech: jobId => ipcRenderer.invoke("speech-cancel", jobId),
  onSpeechProgress: callback => {
    const listener = (_: unknown, event: import("../src/core/speech").SpeechProgress) => callback(event);
    ipcRenderer.on("speech-progress", listener);
    return () => ipcRenderer.removeListener("speech-progress", listener);
  },
  deriveMedia: (jobId, project, clipId, request) => ipcRenderer.invoke("derive-media", jobId, project, clipId, request),
  cancelDerivative: jobId => ipcRenderer.invoke("cancel-derivative", jobId),
  onDerivativeProgress: callback => {
    const listener = (_: unknown, event: DerivativeProgress) => callback(event);
    ipcRenderer.on("derivative-progress", listener);
    return () => ipcRenderer.removeListener("derivative-progress", listener);
  },
  packageProject: project => ipcRenderer.invoke("package-project", project),
  cancelPackage: jobId => ipcRenderer.invoke("cancel-package", jobId),
  onPackageProgress: callback => {
    const listener = (_: unknown, event: ExportProgress) => callback(event);
    ipcRenderer.on("package-progress", listener);
    return () => ipcRenderer.removeListener("package-progress", listener);
  },
  importBuiltinAsset: (id) => ipcRenderer.invoke("import-builtin-asset", id),
  getAssistantProviders: () => ipcRenderer.invoke("assistant-providers"),
  chooseAssistantCLI: (provider) => ipcRenderer.invoke("assistant-choose-cli", provider),
  startAssistant: (request) => ipcRenderer.invoke("assistant-start", request),
  cancelAssistant: (requestId) => ipcRenderer.invoke("assistant-cancel", requestId),
  getAssistantHistory: (projectId) => ipcRenderer.invoke("assistant-history", projectId),
  saveAssistantHistory: (projectId, messages) => ipcRenderer.invoke("assistant-save-history", projectId, messages),
  onAssistantEvent: (callback) => {
    const listener = (_: unknown, event: AssistantEvent) => callback(event);
    ipcRenderer.on("assistant-event", listener);
    return () => ipcRenderer.removeListener("assistant-event", listener);
  },
  importMedia: (paths) => ipcRenderer.invoke("import-media", paths),
  relinkAsset: (asset) => ipcRenderer.invoke("relink-asset", asset),
  getStartupProject: () => ipcRenderer.invoke("get-startup-project"),
  openProject: () => ipcRenderer.invoke("open-project"),
  saveProject: (project, path) =>
    ipcRenderer.invoke("save-project", project, path),
  autosaveProject: (project) => ipcRenderer.invoke("autosave-project", project),
  getAutosave: () => ipcRenderer.invoke("get-autosave"),
  getRecentProjects: () => ipcRenderer.invoke("get-recent-projects"),
  openRecentProject: (path) => ipcRenderer.invoke("open-recent-project", path),
  chooseExportPath: (name, format) =>
    ipcRenderer.invoke("choose-export-path", name, format),
  exportProject: (project, options) =>
    ipcRenderer.invoke("export-project", project, options),
  cancelExport: (jobId) => ipcRenderer.invoke("cancel-export", jobId),
  onExportProgress: (callback) => {
    const listener = (_: unknown, event: ExportProgress) => callback(event);
    ipcRenderer.on("export-progress", listener);
    return () => ipcRenderer.removeListener("export-progress", listener);
  },
  getFontFamilies: () => ipcRenderer.invoke("font-families"),
  getSystemInfo: () => ipcRenderer.invoke("system-info"),
  readTextFile: (extensions) =>
    ipcRenderer.invoke("read-text-file", extensions),
  chooseCapcutProject: (mode) =>
    ipcRenderer.invoke("choose-capcut-project", mode),
  readCapcutDraft: (token, timelineId) =>
    ipcRenderer.invoke("read-capcut-draft", token, timelineId),
  discardCapcutProject: (token) =>
    ipcRenderer.invoke("discard-capcut-project", token),
  writeTextFile: (text, name) =>
    ipcRenderer.invoke("write-text-file", text, name),
  revealPath: (path) => ipcRenderer.invoke("reveal-path", path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onMenuAction: (callback) => {
    const listener = (_: unknown, action: string) => callback(action);
    ipcRenderer.on("menu-action", listener);
    return () => ipcRenderer.removeListener("menu-action", listener);
  },
  setDirty: (dirty) => ipcRenderer.send("set-dirty", dirty),
  cancelCloseRequest: () => ipcRenderer.send("cancel-close-request"),
  closeWindow: () => ipcRenderer.send("close-window"),
  chooseMediaTool: (name) => ipcRenderer.invoke("choose-media-tool", name),
};
contextBridge.exposeInMainWorld("editorAPI", api);

// Present only in the dedicated plugin process, never in a normal desktop window.
if (process.argv.includes("--reacut-plugin")) {
  contextBridge.exposeInMainWorld("reacutPlugin", {
    onCommand: (callback: (request: { action: string; args: unknown }) => Promise<unknown>) => {
      ipcRenderer.on("plugin-command", async (_, request) => {
        try { ipcRenderer.send("plugin-result", { id: request.id, result: await callback(request) }); }
        catch (error) { ipcRenderer.send("plugin-result", { id: request.id, error: error instanceof Error ? error.message : "操作失败" }); }
      });
      ipcRenderer.send("plugin-ready");
    },
  });
}
