import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { EditorAPI, ExportProgress } from "../src/core/types";
const api: EditorAPI = {
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
