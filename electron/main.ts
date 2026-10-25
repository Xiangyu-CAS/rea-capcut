import { listTemplates, libraryTemplate, readTemplate, writeTemplate } from "./projectTemplates";
import { validateTemplate } from "../src/core/projectTemplates";
import { TEMPLATE_EXAMPLES, buildTemplateExample } from "../src/core/templateExamples";
import { speechInfo, generateSpeech, cancelSpeech, cancelAllSpeech, cleanSpeechTemporaries } from "./speech";
import { speechSource, type SpeechSettings, type SpeechRequest } from "../src/core/speech";
import { deriveMedia, cancelDerivative, cancelDerivatives } from "./derivatives";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
} from "electron";
import { startPluginHost } from "./pluginHost";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { BUILTIN_ASSETS } from "../src/core/builtinAssets";
import { discoverAssistantProviders, startAssistantSession } from "./assistantBackend";
import type { AssistantMessage, AssistantProvider, AssistantRequest } from "../src/core/assistantTypes";
import {
  importAssets,
  mediaURL,
  systemMediaInfo,
  systemFontFamilies,
  shutdownMediaTasks,
  registerBundledFont,
} from "./media";
import { startExport, cancelExport, cancelAllExports } from "./export";
import { resolvePortableDocument, startPortablePackage, cancelPortablePackage, cancelPortablePackages, savePortableDocument } from "./portableProject";
import { setBundledMediaToolsDirectory } from "./mediaTools";
import { validateProject } from "../src/core/model";
import { decodeCapcutDraft } from "./capcutCodec";
import {
  discoverSelectedCapcutProject,
  readSelectedCapcutTimeline,
  type CapcutProjectIOPlan,
} from "./capcutProjectIO";
import type {
  CapcutImportSelection,
  MediaAsset,
  Project,
  RecentProject,
  ExportOptions,
} from "../src/core/types";

const pluginMode = process.argv.includes("--reacut-plugin");
// A connected MCP server is a background app until its desktop window is shown.
if (process.platform === "darwin") app.setActivationPolicy(pluginMode ? "accessory" : "regular");
if (pluginMode && !process.env.REACUT_USER_DATA)
  app.setPath("userData", path.join(app.getPath("appData"), "ReaCut-Plugin", "sessions", randomUUID()));
if (app.isPackaged && process.platform === "darwin")
  setBundledMediaToolsDirectory(path.join(process.resourcesPath, "media-tools"));
if (process.env.REACUT_USER_DATA)
  app.setPath("userData", path.resolve(process.env.REACUT_USER_DATA));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "reacut-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let window: BrowserWindow | null = null;
let assistantOverrides: Partial<Record<AssistantProvider, string>> = {};
let assistantRunning: { requestId: string; cancel: () => void; done: Promise<void> } | null = null;
let assistantStarting = false;
let assistantPendingId: string | null = null;
let assistantCancelPending = false;
let assistantStartDone: Promise<void> = Promise.resolve();
let assistantHistoryWrites = Promise.resolve();
function assistantHistoryFile(projectId: unknown): string {
  if (typeof projectId !== "string" || !projectId || projectId.length > 256) throw new Error("无效项目 ID");
  return userFile(`assistant/${createHash("sha256").update(projectId).digest("hex")}.json`);
}
function cleanAssistantMessages(value: unknown): AssistantMessage[] {
  if (!Array.isArray(value) || value.length > 60) throw new Error("对话记录过大");
  const messages = value.map(item => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || item.content.length > 12000)
      throw new Error("对话记录格式无效");
    return { role: item.role, content: item.content } as AssistantMessage;
  });
  if (JSON.stringify(messages).length > 250000) throw new Error("对话记录过大");
  return messages;
}
let pendingProject = process.argv.find(
  (argument) => path.isAbsolute(argument) && /\.reacut$/i.test(argument),
);
app.on("open-file", (event, file) => {
  event.preventDefault();
  pendingProject = file;
  if (window && !window.webContents.isLoading()) menuAction("open-external");
});
let dirty = false,
  closeAllowed = false,
  askingClose = false,
  quitRequested = false;
const allowedMedia = new Set<string>();
const recentPaths = new Set<string>();
const outputPaths = new Set<string>();
const savePaths = new Set<string>();
const portablePaths = new Set<string>();
const capcutSelections = new Map<
  string,
  { plan: CapcutProjectIOPlan; ownerId: number; expiresAt: number; reading: boolean }
>();
const pruneCapcutSelections = () => {
  for (const [token, selection] of capcutSelections)
    if (selection.expiresAt <= Date.now()) capcutSelections.delete(token);
};
function validateCapcutToken(token: unknown): asserts token is string {
  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token)
  )
    throw new Error("剪映项目选择无效，请重新选择项目");
}
const menuAction = (action: string) =>
  window?.webContents.send("menu-action", action);
let speechSettings: SpeechSettings = {};
const userFile = (name: string) => path.join(app.getPath("userData"), name);
const cacheDir = () => userFile("thumbnails");
let writeQueue = Promise.resolve();
async function atomicWrite(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
}
async function recent(): Promise<RecentProject[]> {
  try {
    const data = JSON.parse(await readFile(userFile("recent.json"), "utf8"));
    return Array.isArray(data)
      ? data
          .filter(
            (x: RecentProject) =>
              typeof x.path === "string" && typeof x.name === "string",
          )
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
async function remember(project: Project, file: string) {
  const entries = (await recent()).filter((p) => p.path !== file);
  await atomicWrite(
    userFile("recent.json"),
    JSON.stringify(
      [
        { path: file, name: project.name, updatedAt: new Date().toISOString() },
        ...entries,
      ].slice(0, 20),
    ),
  );
  recentPaths.add(file);
  savePaths.add(file);
}
function authorizeAsset(asset: MediaAsset) {
  allowedMedia.add(path.resolve(asset.path));
  for (const cachedURL of [asset.thumbnail, asset.previewUrl])
    if (cachedURL?.startsWith("reacut-media:")) {
      try {
        const thumbnail = new URL(cachedURL).searchParams.get("path");
        if (thumbnail && path.dirname(path.resolve(thumbnail)) === cacheDir())
          allowedMedia.add(path.resolve(thumbnail));
      } catch {
        /* optional */
      }
    }
}
async function hydrateProject(input: unknown): Promise<Project> {
  const p = validateProject(input);
  const refreshed = new Map<string, Promise<MediaAsset | undefined>>();
  p.assets = await Promise.all(
    p.assets.map(async (asset) => {
      const resolved = path.resolve(asset.path);
      let missing = false;
      try {
        await access(resolved);
      } catch {
        missing = true;
      }
      if (!missing && !refreshed.has(resolved))
        refreshed.set(
          resolved,
          importAssets([resolved], cacheDir())
            .then((assets) => assets[0])
            .catch(() => undefined),
        );
      const metadata = await refreshed.get(resolved);
      const hydrated: MediaAsset = {
        ...asset,
        ...(metadata ?? {}),
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        path: resolved,
        url: mediaURL(resolved),
        missing,
        previewUrl: metadata?.previewUrl,
        previewError: metadata?.previewError,
        thumbnail: metadata?.thumbnail,
      };
      if (asset.kind === "audio") {
        hydrated.width = 0;
        hydrated.height = 0;
        hydrated.thumbnail = undefined;
      }
      authorizeAsset(hydrated);
      return hydrated;
    }),
  );
  return p;
}
async function readProject(file: string) {
  const metadata = await stat(file);
  if (metadata.size > 30 * 1024 * 1024)
    throw new Error("项目文件过大（最大 30MB）");
  const input = JSON.parse(await readFile(file, "utf8"));
  const project = await hydrateProject(await resolvePortableDocument(input, file));
  if (input?.format === "reacut-portable") portablePaths.add(path.resolve(file));
  return project;
}
function handle(name: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(name, (event, ...args) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("无效调用来源");
    return callback(...args);
  });
}
async function importBuiltinAsset(id: unknown) {
    const definition = BUILTIN_ASSETS.find(asset => asset.id === id);
    if (!definition) throw new Error("未找到内置素材");
    const source = app.isPackaged
      ? path.join(app.getAppPath().replace(/\.asar$/, ".asar.unpacked"), "dist/builtin-assets", definition.fileName)
      : path.join(__dirname, "../public/builtin-assets", definition.fileName);
    const bytes = await readFile(source);
    const directory = userFile("builtin-assets");
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${definition.id}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${path.extname(definition.fileName)}`);
    try { await access(target); } catch { await copyFile(source, target); }
    const [asset] = await importAssets([target], cacheDir());
    asset.name = definition.name; authorizeAsset(asset); return asset;
}

const templateTasks = new Map<string, { controller: AbortController; done: Promise<unknown> }>();
async function cancelTemplates(jobId?: string) {
  const tasks = jobId ? [templateTasks.get(jobId)].filter((t): t is NonNullable<typeof t> => !!t) : [...templateTasks.values()];
  tasks.forEach(t => t.controller.abort()); await Promise.allSettled(tasks.map(t => t.done));
}
async function templateTask<T>(jobId: string, work: (signal: AbortSignal, progress: (p:number,message:string)=>void)=>Promise<T>):Promise<T> {
  if (typeof jobId !== "string" || !/^[a-f\d-]{36}$/i.test(jobId) || templateTasks.size) throw new Error("已有模板任务正在处理");
  const controller = new AbortController(), owner = window!.webContents;
  const done = Promise.resolve().then(()=>work(controller.signal,(progress,message)=>{ if(!owner.isDestroyed()) owner.send("template-progress",{jobId,progress,message}); }));
  templateTasks.set(jobId,{controller,done});
  try { return await done; } finally { templateTasks.delete(jobId); }
}
function registerIPC() {
  handle("template-list", () => listTemplates(userFile("project-templates")));
  handle("template-load", async (id: string, builtin: boolean) => {
    if (builtin) {
      const def=TEMPLATE_EXAMPLES.find(d=>d.id===id); if(!def) throw new Error("未知原创模板");
      const assets=[]; for(const mediaId of def.media) assets.push(await importBuiltinAsset(mediaId));
      return buildTemplateExample(id,assets);
    }
    const t=await libraryTemplate(userFile("project-templates"),id);
    t.project=await hydrateProject(t.project);return t;
  });
  handle("template-save", (jobId: string, input: unknown) => templateTask(jobId, async (signal,progress) => {
    const t=validateTemplate(input);
    for(const a of t.project.assets) if(!allowedMedia.has(path.resolve(a.path))) throw new Error("模板引用了未经导入的素材");
    const root=userFile("project-templates");await mkdir(root,{recursive:true});
    await writeTemplate(t,root,signal,progress);
  }));
  handle("template-import", (jobId: string) => templateTask(jobId, async (signal,progress) => {
    const selected=await dialog.showOpenDialog(window!,{title:"导入模板包",properties:["openFile"],filters:[{name:"ReaCut 模板",extensions:["reacut-template"]}]});
    if(selected.canceled || !selected.filePaths[0]) return false;
    if(signal.aborted) throw new Error("已取消模板导入");
    const t=await readTemplate(selected.filePaths[0]);
    const root=userFile("project-templates");await mkdir(root,{recursive:true});
    await writeTemplate(t,root,signal,progress);return true;
  }));
  handle("template-export", (jobId: string, id: string) => templateTask(jobId, async (signal,progress) => {
    const t=await libraryTemplate(userFile("project-templates"),id);
    const selected=await dialog.showOpenDialog(window!,{title:"选择模板包保存位置",properties:["openDirectory","createDirectory"]});
    if(selected.canceled || !selected.filePaths[0]) return null;
    const result=await writeTemplate(t,selected.filePaths[0],signal,progress);outputPaths.add(result);return result;
  }));
  handle("template-cancel", (jobId: string) => cancelTemplates(jobId));
  handle("speech-info", () => speechInfo(speechSettings));
  handle("speech-choose-dependency", async (kind: unknown) => {
    if (kind !== "python" && kind !== "model") throw new Error("Invalid dependency kind");
    const result = await dialog.showOpenDialog(window!, {
      title: kind === "python" ? "Select local Python with mlx-whisper" : "Select local MLX Whisper model folder",
      properties: kind === "python" ? ["openFile"] : ["openDirectory"],
    });
    if (!result.canceled && result.filePaths[0]) {
      speechSettings = { ...speechSettings, [kind]: result.filePaths[0] };
      await atomicWrite(userFile("speech-settings.json"), JSON.stringify(speechSettings));
    }
    return speechInfo(speechSettings);
  });
  handle("speech-generate", async (jobId: string, input: unknown, request: SpeechRequest) => {
    const project = validateProject(input), owner = window!.webContents;
    if (request?.mode === "asr") {
      if (typeof request.source !== "string") throw new Error("Invalid speech source");
      const { asset } = speechSource(project, request.source);
      if (!allowedMedia.has(path.resolve(asset.path))) throw new Error("Source is not authorized for import");
    }
    const result = await generateSpeech(jobId, project, request, speechSettings, userFile("speech-media"), event => {
      if (!owner.isDestroyed()) owner.send("speech-progress", event);
    });
    if (result.mode === "tts") authorizeAsset(result.asset);
    return result;
  });
  handle("speech-cancel", (jobId: string) => cancelSpeech(jobId));
  handle("import-builtin-asset", importBuiltinAsset);
  handle("assistant-providers", () => discoverAssistantProviders(assistantOverrides));
  handle("assistant-choose-cli", async (provider: AssistantProvider) => {
    if (provider !== "codex" && provider !== "claude") throw new Error("无效助手类型");
    const result = await dialog.showOpenDialog(window!, { title: `选择 ${provider === "codex" ? "Codex" : "Claude Code"} CLI`, properties: ["openFile"] });
    if (!result.canceled) {
      assistantOverrides[provider] = result.filePaths[0];
      await mkdir(path.dirname(userFile("assistant-clis.json")), { recursive: true });
      await writeFile(userFile("assistant-clis.json"), JSON.stringify(assistantOverrides), { mode: 0o600 });
    }
    return discoverAssistantProviders(assistantOverrides);
  });
  handle("assistant-start", async (request: AssistantRequest) => {
    if (assistantStarting || assistantRunning) throw new Error("助手正在处理上一条消息");
    if (!request || typeof request.requestId !== "string" || !["codex", "claude"].includes(request.provider)) throw new Error("助手请求无效");
    assistantStarting = true;
    assistantPendingId = request.requestId; assistantCancelPending = false;
    let resolveStart!: () => void;
    assistantStartDone = new Promise<void>(resolve => { resolveStart = resolve; });
    const owner = window!.webContents;
    try {
      const running = await startAssistantSession(request, event => {
        if (!owner.isDestroyed()) owner.send("assistant-event", event);
      }, { executablePath: assistantOverrides[request.provider], sessionRoot: userFile("assistant-runs") });
      assistantRunning = { requestId: request.requestId, ...running };
      void running.done.finally(() => { if (assistantRunning?.requestId === request.requestId) assistantRunning = null; }).catch(() => {});
      if (owner.isDestroyed() || assistantCancelPending) running.cancel();
    } finally { assistantStarting = false; assistantPendingId = null; resolveStart(); }
  });
  handle("assistant-cancel", async (requestId: unknown) => {
    if (assistantPendingId === requestId) { assistantCancelPending = true; await assistantStartDone; }
    const running = assistantRunning;
    if (running && running.requestId === requestId) { running.cancel(); await running.done; }
  });
  handle("assistant-history", async (projectId: unknown) => {
    const file = assistantHistoryFile(projectId);
    await assistantHistoryWrites.catch(() => {});
    try {
      if ((await stat(file)).size > 1024 * 1024) throw new Error("对话记录过大");
      return cleanAssistantMessages(JSON.parse(await readFile(file, "utf8")));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  });
  handle("assistant-save-history", async (projectId: unknown, input: unknown) => {
    const file = assistantHistoryFile(projectId), messages = cleanAssistantMessages(input);
    assistantHistoryWrites = assistantHistoryWrites.catch(() => {}).then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(messages), { mode: 0o600 });
      await rename(temporary, file);
    });
    await assistantHistoryWrites;
  });
  handle("import-media", async (paths?: string[]) => {
    let selected = paths;
    if (!selected) {
      const result = await dialog.showOpenDialog(window!, {
        title: "导入素材",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "媒体文件",
            extensions: [
              "mp4",
              "mov",
              "mkv",
              "webm",
              "m4v",
              "avi",
              "mp3",
              "wav",
              "m4a",
              "aac",
              "ogg",
              "flac",
              "png",
              "jpg",
              "jpeg",
              "webp",
              "bmp",
              "avif",
              "heic",
            ],
          },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (result.canceled) return [];
      selected = result.filePaths;
    }
    if (
      !Array.isArray(selected) ||
      selected.length > 100 ||
      selected.some((p) => typeof p !== "string" || !path.isAbsolute(p))
    )
      throw new Error("请提供最多 100 个本地素材的绝对路径");
    const assets = await importAssets(selected, cacheDir());
    assets.forEach(authorizeAsset);
    return assets;
  });
  handle("derive-media", async (jobId: string, input: unknown, clipId: string, request: import("../src/core/types").DerivativeRequest) => {
    const project = validateProject(input), owner = window!.webContents;
    const source = project.assets.find(a => a.id === project.clips.find(c => c.id === clipId)?.assetId);
    if (!source || !allowedMedia.has(path.resolve(source.path))) throw new Error("素材未经导入授权");
    const asset = await deriveMedia(jobId, project, clipId, request, userFile("derived-media"), event => {
      if (!owner.isDestroyed()) owner.send("derivative-progress", event);
    });
    authorizeAsset(asset);
    return asset;
  });
  handle("cancel-derivative", (jobId: string) => cancelDerivative(jobId));
  handle("relink-asset", async (asset: MediaAsset) => {
    const result = await dialog.showOpenDialog(window!, {
      title: `重新链接 ${asset.name}`,
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const imported = (await importAssets(result.filePaths, cacheDir()))[0];
    if (
      !imported ||
      (imported.kind !== asset.kind &&
        !(asset.kind === "audio" && imported.hasAudio))
    )
      throw new Error("新素材类型与原素材不一致");
    authorizeAsset(imported);
    return {
      ...imported,
      id: asset.id,
      ...(asset.kind === "audio"
        ? { kind: "audio", width: 0, height: 0, thumbnail: undefined }
        : {}),
    };
  });
  handle("get-startup-project", async () => {
    if (!pendingProject) return null;
    const file = pendingProject;
    pendingProject = undefined;
    const project = await readProject(file);
    await remember(project, file);
    return { project, path: file };
  });
  handle("open-project", async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: "打开 ReaCut 项目",
      properties: ["openFile"],
      filters: [{ name: "ReaCut 项目", extensions: ["reacut", "json"] }],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0],
      project = await readProject(file);
    await remember(project, file);
    return { project, path: file };
  });
  handle("open-recent-project", async (file: string) => {
    if (!recentPaths.has(file)) throw new Error("项目不在最近打开列表");
    const project = await readProject(file);
    await remember(project, file);
    return { project, path: file };
  });
  handle("get-recent-projects", async () => {
    const entries = await recent();
    entries.forEach((e) => recentPaths.add(e.path));
    return entries;
  });
  handle("save-project", async (input: unknown, file?: string) => {
    const project = validateProject(input);
    if (file && !savePaths.has(file)) throw new Error("未经选择的项目保存位置");
    if (!file) {
      const result = await dialog.showSaveDialog(window!, {
        title: "保存项目",
        defaultPath: project.name + ".reacut",
        filters: [{ name: "ReaCut 项目", extensions: ["reacut"] }],
      });
      if (result.canceled || !result.filePath) return null;
      file = result.filePath;
      savePaths.add(file);
    }
    if (portablePaths.has(path.resolve(file))) {
      for (const asset of project.assets) if (!allowedMedia.has(path.resolve(asset.path))) throw new Error("项目引用了未经导入的素材");
      await savePortableDocument(project, file);
    } else await atomicWrite(file, JSON.stringify(project, null, 2));
    await remember(project, file);
    return file;
  });
  handle("package-project", async (input: unknown) => {
    const project = validateProject(input), owner = window!.webContents;
    for (const asset of project.assets) if (!allowedMedia.has(path.resolve(asset.path))) throw new Error("项目引用了未经导入的素材");
    const selected = await dialog.showOpenDialog(window!, { title: "选择素材包保存位置", properties: ["openDirectory", "createDirectory"] });
    if (selected.canceled || !selected.filePaths[0] || owner.isDestroyed()) return null;
    return startPortablePackage(project, selected.filePaths[0], event => {
      if (event.status === "complete" && event.path) outputPaths.add(event.path);
      if (!owner.isDestroyed()) owner.send("package-progress", event);
    });
  });
  handle("cancel-package", (jobId: string) => cancelPortablePackage(jobId));
  handle("autosave-project", (input: unknown) => {
    const project = validateProject(input);
    const serialized = JSON.stringify(project);
    writeQueue = writeQueue
      .catch(() => {})
      .then(() => atomicWrite(userFile("autosave.reacut"), serialized));
    return writeQueue;
  });
  handle("get-autosave", async () => {
    try {
      return await readProject(userFile("autosave.reacut"));
    } catch {
      return null;
    }
  });
  handle("choose-export-path", async (name: string, format: string) => {
    if (!["mp4", "mov"].includes(format)) throw new Error("无效导出格式");
    const result = await dialog.showSaveDialog(window!, {
      title: "导出视频",
      defaultPath: name + "." + format,
      filters: [{ name: format.toUpperCase() + " 视频", extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return null;
    outputPaths.add(result.filePath);
    return result.filePath;
  });
  handle("export-project", async (input: unknown, options: ExportOptions) => {
    const project = validateProject(input);
    if (!outputPaths.has(options.path)) throw new Error("请先选择导出位置");
    for (const asset of project.assets)
      if (!allowedMedia.has(path.resolve(asset.path)))
        throw new Error("导出引用了未经导入的素材");
    return startExport(project, options, (event) =>
      window?.webContents.send("export-progress", event),
    );
  });
  handle("cancel-export", (jobId: string) => cancelExport(jobId));
  handle("font-families", () => systemFontFamilies());
  handle("system-info", async () => ({
    version: app.getVersion(),
    platform: process.platform,
    ...(await systemMediaInfo()),
  }));
  handle("read-text-file", async (extensions: string[]) => {
    if (
      !Array.isArray(extensions) ||
      extensions.some((e) => !/^[a-z0-9]+$/i.test(e))
    )
      throw new Error("无效文件类型");
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openFile"],
      filters: [{ name: "文本文件", extensions }],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await stat(file)).size > 20 * 1024 * 1024)
      throw new Error("文件超过 20MB");
    return { text: await readFile(file, "utf8"), name: path.basename(file) };
  });
  handle("choose-capcut-project", async (mode: "file" | "directory") => {
    if (mode !== "file" && mode !== "directory")
      throw new Error("请选择草稿文件或项目文件夹");
    const owner = window!;
    const result = await dialog.showOpenDialog(owner, {
      title: mode === "file" ? "选择剪映草稿文件" : "选择剪映项目文件夹",
      properties: [mode === "file" ? "openFile" : "openDirectory"],
      ...(mode === "file"
        ? { filters: [{ name: "剪映草稿", extensions: ["json"] }] }
        : {}),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if (owner !== window || owner.isDestroyed()) return null;
    const plan = await discoverSelectedCapcutProject(result.filePaths[0], mode);
    if (owner !== window || owner.isDestroyed()) return null;
    pruneCapcutSelections();
    while (capcutSelections.size >= 8)
      capcutSelections.delete(capcutSelections.keys().next().value!);
    const token = randomUUID();
    capcutSelections.set(token, {
      plan,
      ownerId: owner.webContents.id,
      expiresAt: Date.now() + 10 * 60 * 1000,
      reading: false,
    });
    const selection: CapcutImportSelection = {
      token,
      name: path.basename(plan.selection.projectDirectory),
      timelines: plan.timelines.map(({ id, name, isMain, isActive }) => ({
        id,
        name,
        isMain,
        isActive,
      })),
      recommendedTimelineId: plan.recommendedTimelineId,
      requiresTimelineChoice: plan.requiresTimelineChoice,
      warnings: plan.warnings,
    };
    return selection;
  });
  handle("read-capcut-draft", async (token: unknown, timelineId?: unknown) => {
    validateCapcutToken(token);
    pruneCapcutSelections();
    const selection = capcutSelections.get(token);
    if (!selection || selection.ownerId !== window!.webContents.id)
      throw new Error("剪映项目选择已失效，请重新选择项目");
    if (selection.reading) throw new Error("所选时间线正在读取，请稍候");
    if (
      timelineId !== undefined &&
      (typeof timelineId !== "string" ||
        !selection.plan.timelines.some((choice) => choice.id === timelineId))
    )
      throw new Error("请选择项目中已有的时间线");
    selection.reading = true;
    try {
      const result = await readSelectedCapcutTimeline(
        selection.plan,
        timelineId as string | undefined,
      );
      const decoded = decodeCapcutDraft(result.text);
      capcutSelections.delete(token);
      return {
        text: decoded.text,
        name: result.name,
        warnings: selection.plan.warnings,
      };
    } finally {
      selection.reading = false;
    }
  });
  handle("discard-capcut-project", (token: unknown) => {
    validateCapcutToken(token);
    const selection = capcutSelections.get(token);
    if (selection?.ownerId === window!.webContents.id)
      capcutSelections.delete(token);
  });
  handle("write-text-file", async (text: string, name: string) => {
    if (typeof text !== "string" || text.length > 20 * 1024 * 1024)
      throw new Error("文本内容无效或过大");
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: path.basename(name),
    });
    if (result.canceled || !result.filePath) return null;
    await atomicWrite(result.filePath, text);
    return result.filePath;
  });
  handle("reveal-path", (file: string) => {
    if (
      !allowedMedia.has(file) &&
      !savePaths.has(file) &&
      !outputPaths.has(file)
    )
      throw new Error("未授权的文件位置");
    shell.showItemInFolder(file);
  });
  handle("choose-media-tool", async (name: string) => {
    if (!["ffmpeg", "ffprobe"].includes(name)) throw new Error("无效工具名");
    const result = await dialog.showOpenDialog(window!, {
      title: `选择 ${name} 可执行文件`,
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    process.env[name === "ffmpeg" ? "REACUT_FFMPEG" : "REACUT_FFPROBE"] = file;
    const settings = {
      ffmpeg: process.env.REACUT_FFMPEG,
      ffprobe: process.env.REACUT_FFPROBE,
    };
    await atomicWrite(userFile("media-tools.json"), JSON.stringify(settings));
    return file;
  });
  ipcMain.on("set-dirty", (event, value) => {
    if (event.sender === window?.webContents) dirty = Boolean(value);
  });
  ipcMain.on("cancel-close-request", (event) => {
    if (event.sender === window?.webContents) quitRequested = false;
  });
  ipcMain.on("close-window", (event) => {
    if (event.sender === window?.webContents && !dirty) {
      closeAllowed = true;
      if (quitRequested) app.quit();
      else window?.close();
    }
  });
}
async function serveMedia(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url),
      supplied = url.searchParams.get("path");
    if (url.hostname !== "asset" || !supplied)
      return new Response("Invalid media URL", { status: 400 });
    const file = path.resolve(supplied);
    if (!allowedMedia.has(file))
      return new Response("Media was not imported", { status: 403 });
    const metadata = await stat(file);
    if (!metadata.isFile()) return new Response("Not a file", { status: 404 });
    const range = request.headers.get("range");
    let start = 0,
      end = metadata.size - 1,
      status = 200;
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) return new Response(null, { status: 416 });
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      } else if (match[2])
        start = Math.max(0, metadata.size - Number(match[2]));
      if (start > end || start >= metadata.size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${metadata.size}` },
        });
      status = 206;
    }
    const mime: Record<string, string> = {
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const headers: Record<string, string> = {
      "Content-Type":
        mime[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Length": String(Math.max(0, end - start + 1)),
      "Access-Control-Allow-Origin": "*",
    };
    if (status === 206)
      headers["Content-Range"] = `bytes ${start}-${end}/${metadata.size}`;
    const body =
      request.method === "HEAD" || metadata.size === 0
        ? null
        : Readable.toWeb(createReadStream(file, { start, end }));
    return new Response(body as ReadableStream<Uint8Array> | null, {
      status,
      headers,
    });
  } catch {
    return new Response("Media missing", { status: 404 });
  }
}
function createWindow() {
  const directory = __dirname;
  window = new BrowserWindow({
    width: pluginMode ? 1440 : 1500,
    height: pluginMode ? 900 : 950,
    show: !pluginMode,
    minWidth: 1060,
    minHeight: 680,
    title: "ReaCut · 映刻",
    backgroundColor: "#141518",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !pluginMode,
      additionalArguments: pluginMode ? ["--reacut-plugin"] : [],
    },
  });
  if (pluginMode) {
    if (process.platform === "darwin") {
      window.on("show", () => app.setActivationPolicy("regular"));
      window.on("hide", () => app.setActivationPolicy("accessory"));
    }
    startPluginHost(window, () => { closeAllowed = true; app.quit(); });
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault();
  });
  window.on("close", (event) => {
    if (pluginMode && !closeAllowed && !quitRequested) { event.preventDefault(); window?.hide(); return; }
    if (!dirty || closeAllowed) return;
    event.preventDefault();
    if (askingClose) return;
    askingClose = true;
    void dialog
      .showMessageBox(window!, {
        type: "question",
        message: "项目有未保存的修改",
        detail: "保存项目后再关闭？最近编辑也会自动恢复。",
        buttons: ["保存并关闭", "取消", "不保存"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        askingClose = false;
        if (result.response === 0) menuAction("save-and-close");
        if (result.response === 1) quitRequested = false;
        if (result.response === 2) {
          closeAllowed = true;
          if (quitRequested) app.quit();
          else window?.close();
        }
      });
  });
  window.on("closed", () => {
    void cancelPortablePackages();
    void cancelTemplates();
    void cancelDerivatives();
    void cancelAllSpeech();
    assistantCancelPending = true;
    assistantRunning?.cancel();
    capcutSelections.clear();
    window = null;
    dirty = false;
    closeAllowed = false;
  });
  if (process.env.VITE_DEV_SERVER_URL)
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(directory, "../dist/index.html"));
}
void app.whenReady().then(async () => {
  try {
    const settings = JSON.parse(await readFile(userFile("assistant-clis.json"), "utf8"));
    for (const key of ["codex", "claude"] as const)
      if (typeof settings[key] === "string" && path.isAbsolute(settings[key])) assistantOverrides[key] = settings[key];
  } catch { /* default CLI discovery */ }
  registerBundledFont(
    path.join(
      app.getAppPath().replace(/\.asar$/, ".asar.unpacked"),
      "dist/fonts/NotoSansSC.ttf",
    ),
  );
  registerBundledFont(
    path.join(app.getAppPath(), "public/fonts/NotoSansSC.ttf"),
  );

  try {
    const settings = JSON.parse(
      await readFile(userFile("media-tools.json"), "utf8"),
    );
    if (settings.ffmpeg && !process.env.REACUT_FFMPEG)
      process.env.REACUT_FFMPEG = settings.ffmpeg;
    if (settings.ffprobe && !process.env.REACUT_FFPROBE)
      process.env.REACUT_FFPROBE = settings.ffprobe;
  } catch {
    /* system defaults */
  }
  try {
    const input = JSON.parse(await readFile(userFile("speech-settings.json"), "utf8"));
    for (const key of ["python", "model"] as const) if (typeof input[key] === "string" && path.isAbsolute(input[key])) speechSettings[key] = input[key];
  } catch { /* Optional local dependencies are never installed automatically. */ }
  await cleanSpeechTemporaries(userFile("speech-media"));
  protocol.handle("reacut-media", serveMedia);
  registerIPC();
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: "ReaCut",
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "文件",
      submenu: [
        {
          label: "新建项目",
          accelerator: "CmdOrCtrl+N",
          click: () => menuAction("new"),
        },
        {
          label: "打开项目",
          accelerator: "CmdOrCtrl+O",
          click: () => menuAction("open"),
        },
        {
          label: "保存",
          accelerator: "CmdOrCtrl+S",
          click: () => menuAction("save"),
        },
        {
          label: "另存为",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => menuAction("save-as"),
        },
        { label: "工程模板…", click: () => menuAction("templates") },
        { type: "separator" },
        {
          label: "导入素材",
          accelerator: "CmdOrCtrl+I",
          click: () => menuAction("import"),
        },
        {
          label: "导入剪映草稿文件…",
          click: () => menuAction("import-capcut-file"),
        },
        {
          label: "导入剪映项目文件夹…",
          click: () => menuAction("import-capcut-directory"),
        },
        {
          label: "导出视频",
          accelerator: "CmdOrCtrl+E",
          click: () => menuAction("export"),
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        {
          label: "撤销",
          accelerator: "CmdOrCtrl+Z",
          click: () => menuAction("undo"),
        },
        {
          label: "重做",
          accelerator: "CmdOrCtrl+Shift+Z",
          click: () => menuAction("redo"),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "togglefullscreen" },
        ...(process.env.VITE_DEV_SERVER_URL
          ? [{ role: "toggleDevTools" as const }]
          : []),
      ],
    },
    {
      label: "帮助",
      submenu: [
        { label: "快捷键", click: () => menuAction("shortcuts") },
        { label: "关于 ReaCut", click: () => menuAction("about") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  if (dirty && !closeAllowed) {
    quitRequested = true;
    window?.close();
    return;
  }
  void Promise.all([
    (async () => { assistantCancelPending = true; await assistantStartDone; const running = assistantRunning; running?.cancel(); await running?.done; await assistantHistoryWrites.catch(() => {}); })(),
    cancelAllExports(),
    cancelDerivatives(),
    cancelAllSpeech(),
    cancelPortablePackages(),
    cancelTemplates(),
    shutdownMediaTasks(),
    writeQueue.catch(() => {}),
  ]).finally(() => {
    quitting = true;
    app.quit();
  });
});
