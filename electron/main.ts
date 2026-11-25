import { createUpdateService } from "./updateCheck";
import { listTemplates, libraryTemplate, readTemplate, writeTemplate } from "./projectTemplates";
import { validateTemplate } from "../src/core/projectTemplates";
import { TEMPLATE_EXAMPLES, buildTemplateExample } from "../src/core/templateExamples";
import { speechInfo, cachedSpeechModels, generateSpeech, cancelSpeech, cancelAllSpeech, cleanSpeechTemporaries } from "./speech";
import { speechSource, type SpeechProgress, type SpeechSettings, type SpeechRequest } from "../src/core/speech";
import { assistantMediaSelection, assistantTranscriptionRequest } from "../src/core/assistantEdits";
import { audioAnalysisSources, type AudioAnalysisRequest, type AudioAnalysisResult } from "../src/core/audioMix";
import { analyzeAudio } from "./audioAnalysis";
import { beatSource } from "../src/core/beats";
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
import { pluginOutputFolder, type PluginOutputFolder } from "./pluginOutputs";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { BUILTIN_ASSETS } from "../src/core/builtinAssets";
import { discoverAssistantProviders, startAssistantSession } from "./assistantBackend";
import { listCodexAgentModels, readCodexAgentAccount, signInCodexAgent, signOutCodexAgent, startCodexAgentSession } from "./codexAppServer";
import { ASSISTANT_ACTIVITY_KINDS, MAX_ASSISTANT_COMMENTARY, MAX_ASSISTANT_COMMENTARY_LENGTH, MAX_ASSISTANT_WORK_ENTRIES, type AssistantCLI, type AssistantEvent, type AssistantLocalProject, type AssistantMessage, type AssistantRequest, type AssistantWorkEntry, type CodexAgentAccount, type CodexAgentModel } from "../src/core/assistantTypes";
import {
  importAssets,
  performancePreviewProxy,
  mediaURL,
  systemMediaInfo,
  systemFontFamilies,
  shutdownMediaTasks,
  registerBundledFont,
} from "./media";
import { startExport, cancelExport, cancelAllExports, videoToolboxAvailable } from "./export";
import { resolvePortableDocument, startPortablePackage, cancelPortablePackage, cancelPortablePackages, savePortableDocument } from "./portableProject";
import { setBundledMediaToolsDirectory } from "./mediaTools";
import { validateProject } from "../src/core/model";
import { decodeCapcutDraft } from "./capcutCodec";
import { MAX_PROJECT_TIMELINES } from "../src/core/projectTimelines";
import {
  discoverSelectedCapcutProject,
  readSelectedCapcutTimeline,
  type CapcutProjectIOPlan,
} from "./capcutProjectIO";
import type {
  CapcutImportSelection,
  CapcutTimelineDraft,
  MediaAsset,
  Project,
  RecentProject,
  ExportOptions,
  ExportProgress,
} from "../src/core/types";

const pluginMode = process.argv.includes("--reacut-plugin");
const settingsRoot = process.env.REACUT_USER_DATA ? path.resolve(process.env.REACUT_USER_DATA) : app.getPath("userData");
const templateRoot = path.join(settingsRoot, "project-templates");
const speechSettingsPath = path.join(settingsRoot, "speech-settings.json");
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
let assistantOverrides: Partial<Record<AssistantCLI, string>> = {};
let assistantRunning: { requestId: string; cancel: () => void; done: Promise<void> } | null = null;
let assistantStarting = false;
let assistantPendingId: string | null = null;
let assistantCancelPending = false;
let assistantStartDone: Promise<void> = Promise.resolve();
let assistantHistoryWrites = Promise.resolve();
let codexAccountTask: { kind: "read" | "sign-in" | "sign-out"; controller: AbortController; done: Promise<CodexAgentAccount> } | undefined;
let codexNeedsSignIn = false;
let codexModelsTask: { controller: AbortController; done: Promise<CodexAgentModel[]> } | undefined;
const assistantSessionRoot = () => userFile("assistant-runs");
const codexAgentOptions = () => ({ executablePath: assistantOverrides.codex, sessionRoot: assistantSessionRoot(), profileDirectory: userFile("codex-agent") });

async function codexAccountOperation(kind: NonNullable<typeof codexAccountTask>["kind"], work: (signal: AbortSignal) => Promise<CodexAgentAccount>): Promise<CodexAgentAccount> {
  if (kind !== "read" && (assistantRunning || assistantStarting)) throw new Error("助手正在处理上一条消息");
  if (codexAccountTask) {
    if (kind === "read" || kind === codexAccountTask.kind) return codexAccountTask.done;
    throw new Error("请等待当前 Codex 登录操作完成。");
  }
  const controller = new AbortController();
  if (kind === "sign-out") codexModelsTask?.controller.abort();
  const done = work(controller.signal);
  codexAccountTask = { kind, controller, done };
  try { return await done; } finally { codexAccountTask = undefined; }
}
function assistantHistoryFile(projectId: unknown): string {
  if (typeof projectId !== "string" || !projectId || projectId.length > 256) throw new Error("无效项目 ID");
  return userFile(`assistant/${createHash("sha256").update(projectId).digest("hex")}.json`);
}
function cleanAssistantMessages(value: unknown): AssistantMessage[] {
  if (!Array.isArray(value) || value.length > 60) throw new Error("对话记录过大");
  const messages = value.map(item => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || item.content.length > 12000)
      throw new Error("对话记录格式无效");
    const message: AssistantMessage = { role: item.role, content: item.content };
    const work = item.work;
    if (message.role === "assistant" && Number.isFinite(work?.elapsedMs) && work.elapsedMs >= 0 && Array.isArray(work.commentary)) {
      message.work = {
        elapsedMs: work.elapsedMs,
        commentary: work.commentary
          .slice(0, MAX_ASSISTANT_COMMENTARY)
          .filter((text: unknown): text is string => typeof text === "string" && !!text.trim())
          .map((text: string) => text.slice(0, MAX_ASSISTANT_COMMENTARY_LENGTH)),
      };
      if (Array.isArray(work.entries)) {
        message.work.entries = work.entries.slice(0, MAX_ASSISTANT_WORK_ENTRIES).flatMap((entry: AssistantWorkEntry) => {
          if (!entry || typeof entry.text !== "string" || !entry.text.trim()) return [];
          const text = entry.text.slice(0, MAX_ASSISTANT_COMMENTARY_LENGTH);
          if (entry.type === "note") return [{ type: "note", text }];
          if (entry.type === "activity" && ASSISTANT_ACTIVITY_KINDS.includes(entry.kind) && (entry.state === "done" || entry.state === "stopped"))
            return [{ type: "activity", kind: entry.kind, text, state: entry.state }];
          return [];
        });
      }
    }
    return message;
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
async function readCapcutSelection<T>(token: unknown, read: (plan: CapcutProjectIOPlan) => Promise<T>): Promise<T> {
  validateCapcutToken(token);
  pruneCapcutSelections();
  const selection = capcutSelections.get(token);
  if (!selection || selection.ownerId !== window!.webContents.id)
    throw new Error("剪映项目选择已失效，请重新选择项目");
  if (selection.reading) throw new Error("所选时间线正在读取，请稍候");
  selection.reading = true;
  try {
    const result = await read(selection.plan);
    capcutSelections.delete(token);
    return result;
  } finally {
    selection.reading = false;
  }
}
const menuAction = (action: string) =>
  window?.webContents.send("menu-action", action);
let speechSettings: SpeechSettings = {};
let speechSettingsWrites = Promise.resolve();

function generateProjectSpeech(jobId: string, project: Project, request: SpeechRequest, report: (event: SpeechProgress) => void, signal?: AbortSignal) {
  if (request?.mode === "asr") {
    if (typeof request.source !== "string") throw new Error("Invalid speech source");
    const { asset } = speechSource(project, request.source, request.range);
    if (!allowedMedia.has(path.resolve(asset.path))) throw new Error("Source is not authorized for import");
  }
  return generateSpeech(jobId, project, request, speechSettings, userFile("speech-media"), report, signal);
}

function localAgentTranscription(local: AssistantLocalProject) {
  const project = validateProject(local.project);
  if (!Number.isFinite(local.playhead) || local.playhead < 0 || !Array.isArray(local.media))
    throw new Error("Invalid local speech context.");
  const media = assistantMediaSelection(project, local.media);
  return async (args: Record<string, unknown>, signal: AbortSignal) => {
    const request = assistantTranscriptionRequest(args.source, args.language, media);
    const result = await generateProjectSpeech(randomUUID(), project, request, () => {}, signal);
    if (result.mode !== "asr") throw new Error("Invalid speech result.");
    return { request, time: local.playhead, cues: result.cues };
  };
}
let audioAnalysisJob: { id: string; controller: AbortController; done: Promise<AudioAnalysisResult> } | undefined;
let previewProxyJob: { id: string; controller: AbortController; done: Promise<void> } | undefined;
const userFile = (name: string) => path.join(app.getPath("userData"), name);
const cacheDir = () => userFile("thumbnails");
let writeQueue = Promise.resolve();
async function atomicWrite(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
}

async function updateSpeechSettings(patch: (settings: SpeechSettings) => SpeechSettings) {
  const write = speechSettingsWrites.catch(() => {}).then(async () => {
    const updated = patch(speechSettings);
    await atomicWrite(speechSettingsPath, JSON.stringify(updated));
    speechSettings = updated;
  });
  speechSettingsWrites = write;
  await write;
  return speechInfo(speechSettings);
}

function registerPluginOutputs() {
  let folder: PluginOutputFolder | undefined;
  let choosing = false;
  const progress = new Map<string, ExportProgress>();
  const destination = (name: unknown, extension: "reacut" | "mp4" | "mov") => {
    if (!folder) throw new Error("Choose a batch output folder first.");
    return folder.destination(name, extension);
  };
  const status = (id: string) => {
    const event = progress.get(id);
    if (!event) throw new Error("Unknown batch export job in this session.");
    return event;
  };
  const checkAssets = (project: Project) => {
    for (const asset of project.assets)
      if (!allowedMedia.has(path.resolve(asset.path))) throw new Error("Project references an unauthorized asset.");
  };
  handle("plugin-output-folder", async () => {
    if (choosing) throw new Error("The output folder dialog is already open.");
    choosing = true;
    try {
      const result = await dialog.showOpenDialog(window!, {
        title: nativeUI("选择批量出片文件夹", "Choose batch output folder"),
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      folder = await pluginOutputFolder(result.filePaths[0]);
      return folder.directory;
    } finally { choosing = false; }
  });
  handle("plugin-save-output", async (input: unknown, name: unknown) => {
    const project = validateProject(input);
    checkAssets(project);
    const output = await destination(name, "reacut");
    const temporary = path.join(path.dirname(output.path), `.reacut-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(project, null, 2), { flag: "wx" });
      await output.publish(temporary);
    }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
    savePaths.add(output.path);
    await remember(project, output.path).catch(() => {});
    return output.path;
  });
  handle("plugin-export-start", async (input: unknown, name: unknown, options: Omit<ExportOptions, "path">) => {
    const project = validateProject(input);
    checkAssets(project);
    if (options?.format !== "mp4" && options?.format !== "mov") throw new Error("Choose MP4 or MOV.");
    const output = await destination(name, options.format);
    return startExport(project, { ...options, path: output.path }, event => {
      progress.set(event.jobId, event);
      if (event.status === "complete" && event.path) outputPaths.add(event.path);
      if (progress.size > 100) {
        const oldest = [...progress].find(([id, value]) => id !== event.jobId && ["complete", "cancelled", "error"].includes(value.status));
        if (oldest) progress.delete(oldest[0]);
      }
    }, output);
  });
  handle("plugin-export-status", status);
  handle("plugin-export-cancel", async (id: string) => {
    status(id);
    await cancelExport(id);
    return status(id);
  });
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
  for (const url of [asset.thumbnail, asset.previewUrl]) authorizeCachedMedia(url);
}
function authorizeCachedMedia(url?: string) {
  if (!url?.startsWith("reacut-media:")) return;
  try {
    const file = new URL(url).searchParams.get("path");
    if (file && path.dirname(path.resolve(file)) === cacheDir()) allowedMedia.add(path.resolve(file));
  } catch { /* An optional cache file is unavailable. */ }
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
      if (metadata && (!hydrated.hasAudio || Math.abs(asset.duration - hydrated.duration) > 0.05))
        delete hydrated.beats;
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
// Renderer preference is validated and synchronised before user interaction.
// Native dialogs do not receive arbitrary translated strings over IPC.
let uiLanguage: "zh-CN" | "en" | "tr" = "en";
const nativeUI = (chinese: string, english: string) => uiLanguage === "zh-CN" ? chinese : english;

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
const updates = createUpdateService({
  version: app.getVersion(), platform: process.platform, arch: process.arch,
  fetch: (...args) => globalThis.fetch(...args), openExternal: url => shell.openExternal(url),
});

function registerIPC() {
  // Only the verified main frame may request fixed public release metadata.
  handle("check-for-updates", () => updates.check());
  handle("open-update-target", (target: unknown) => {
    if (target !== "release" && target !== "download") throw new Error("Invalid update target");
    return updates.open(target);
  });
  handle("set-ui-language", (language: unknown) => {
    if (language !== "zh-CN" && language !== "en" && language !== "tr") throw new Error("Invalid UI language");
    uiLanguage = language;
    updateApplicationMenu();
  });
  handle("template-list", () => listTemplates(templateRoot));
  handle("template-load", async (id: string, builtin: boolean) => {
    if (builtin) {
      const def=TEMPLATE_EXAMPLES.find(d=>d.id===id); if(!def) throw new Error("未知原创模板");
      const assets=[]; for(const mediaId of def.media) assets.push(await importBuiltinAsset(mediaId));
      return buildTemplateExample(id,assets);
    }
    const t=await libraryTemplate(templateRoot,id);
    t.project=await hydrateProject(t.project);return t;
  });
  handle("template-save", (jobId: string, input: unknown) => templateTask(jobId, async (signal,progress) => {
    const t=validateTemplate(input);
    for(const a of t.project.assets) if(!allowedMedia.has(path.resolve(a.path))) throw new Error("模板引用了未经导入的素材");
    await mkdir(templateRoot,{recursive:true});
    await writeTemplate(t,templateRoot,signal,progress);
  }));
  handle("template-import", (jobId: string) => templateTask(jobId, async (signal,progress) => {
    const selected=await dialog.showOpenDialog(window!,{title:nativeUI("导入模板包", "Import template bundle"),properties:["openFile"],filters:[{name:nativeUI("ReaCut 模板", "ReaCut template"),extensions:["reacut-template"]}]});
    if(selected.canceled || !selected.filePaths[0]) return false;
    if(signal.aborted) throw new Error("已取消模板导入");
    const t=await readTemplate(selected.filePaths[0]);
    await mkdir(templateRoot,{recursive:true});
    await writeTemplate(t,templateRoot,signal,progress);return true;
  }));
  handle("template-export", (jobId: string, id: string) => templateTask(jobId, async (signal,progress) => {
    const t=await libraryTemplate(templateRoot,id);
    const selected=await dialog.showOpenDialog(window!,{title:nativeUI("选择模板包保存位置", "Choose template bundle location"),properties:["openDirectory","createDirectory"]});
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
      return updateSpeechSettings(settings => ({ ...settings, [kind]: result.filePaths[0] }));
    }
    return speechInfo(speechSettings);
  });
  handle("speech-select-cached-model", async (id: unknown) => {
    if (typeof id !== "string" || id.length > 80 || process.platform !== "darwin" || process.arch !== "arm64")
      throw new Error("Invalid local speech model.");
    const model = (await cachedSpeechModels()).find(entry => entry.id === id);
    if (!model) throw new Error("Cached model is unavailable. Refresh the list.");
    return updateSpeechSettings(settings => ({ ...settings, model: model.folder }));
  });
  handle("speech-reset-dependencies", () => updateSpeechSettings(() => ({})));
  handle("speech-generate", async (jobId: string, input: unknown, request: SpeechRequest) => {
    const project = validateProject(input), owner = window!.webContents;
    const result = await generateProjectSpeech(jobId, project, request, event => {
      if (!owner.isDestroyed()) owner.send("speech-progress", event);
    });
    if (result.mode === "tts") authorizeAsset(result.asset);
    return result;
  });
  handle("speech-cancel", (jobId: string) => cancelSpeech(jobId));
  handle("analyze-audio", async (jobId: string, input: unknown, request: AudioAnalysisRequest) => {
    if (typeof jobId !== "string" || !/^[a-f\d-]{36}$/i.test(jobId) || audioAnalysisJob)
      throw new Error("An audio analysis task is already running or its ID is invalid.");
    const project = validateProject(input);
    const sources = request?.mode === "beats" ? [beatSource(project, request.assetId)] :
      audioAnalysisSources(project, request).map(({ asset }) => asset);
    for (const asset of sources)
      if (!allowedMedia.has(path.resolve(asset.path))) throw new Error("Audio source is not authorized.");
    const controller = new AbortController(), owner = window!.webContents;
    const done = analyzeAudio(project, request, controller.signal, progress => {
      if (!owner.isDestroyed()) owner.send("audio-analysis-progress", { jobId, progress });
    });
    audioAnalysisJob = { id: jobId, controller, done };
    try { return await done; } finally { audioAnalysisJob = undefined; }
  });
  handle("cancel-audio-analysis", (id: string) => {
    if (audioAnalysisJob?.id === id) audioAnalysisJob.controller.abort();
  });
  handle("prepare-preview-proxies", async (id: string, paths: string[]) => {
    if (typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id) ||
        !Array.isArray(paths) || paths.length > 10_000 ||
        paths.some(file => typeof file !== "string" || !path.isAbsolute(file) || !allowedMedia.has(path.resolve(file))))
      throw new Error("Preview proxies require imported local video files.");
    const previous = previewProxyJob, owner = window!.webContents;
    previous?.controller.abort();
    const controller = new AbortController(), { signal } = controller;
    const done = (async () => {
      await previous?.done.catch(() => {});
      for (const file of new Set(paths)) {
        if (signal.aborted) return;
        let url: string | undefined, failed = false;
        try { url = await performancePreviewProxy(file, cacheDir(), signal); }
        catch { failed = true; }
        if (signal.aborted) return;
        authorizeCachedMedia(url);
        if (!owner.isDestroyed()) owner.send("preview-proxy-progress", { jobId: id, path: file, url, failed });
      }
    })();
    previewProxyJob = { id, controller, done };
    try { await done; } finally { if (previewProxyJob?.id === id) previewProxyJob = undefined; }
  });
  handle("cancel-preview-proxies", (id: string) => {
    if (previewProxyJob?.id === id) previewProxyJob.controller.abort();
  });
  handle("import-builtin-asset", importBuiltinAsset);
  handle("assistant-providers", () => discoverAssistantProviders(assistantOverrides));
  handle("assistant-choose-cli", async (provider: AssistantCLI) => {
    if (provider !== "codex" && provider !== "claude") throw new Error("无效助手类型");
    const result = await dialog.showOpenDialog(window!, { title: nativeUI(`选择 ${provider === "codex" ? "Codex" : "Claude Code"} CLI`, `Choose ${provider === "codex" ? "Codex" : "Claude Code"} CLI`), properties: ["openFile"] });
    if (!result.canceled) {
      if (provider === "codex" && codexAccountTask?.kind === "read") {
        const task = codexAccountTask;
        task.controller.abort();
        await task.done.catch(() => {});
      }
      if (provider === "codex") codexModelsTask?.controller.abort();
      assistantOverrides[provider] = result.filePaths[0];
      await mkdir(path.dirname(userFile("assistant-clis.json")), { recursive: true });
      await writeFile(userFile("assistant-clis.json"), JSON.stringify(assistantOverrides), { mode: 0o600 });
    }
    return discoverAssistantProviders(assistantOverrides);
  });
  handle("assistant-codex-account", () => codexAccountOperation("read", async signal => {
    if (codexNeedsSignIn) return "signed-out";
    const account = await readCodexAgentAccount(codexAgentOptions(), signal);
    return codexNeedsSignIn ? "signed-out" : account;
  }));
  handle("assistant-codex-models", async () => {
    if (codexModelsTask) return codexModelsTask.done;
    const controller = new AbortController();
    const done = listCodexAgentModels(codexAgentOptions(), controller.signal);
    codexModelsTask = { controller, done };
    try { return await done; } finally { codexModelsTask = undefined; }
  });
  handle("assistant-codex-sign-in", () => codexAccountOperation("sign-in", async signal => {
    const account = await signInCodexAgent(codexAgentOptions(), url => shell.openExternal(url), signal);
    if (account === "connected") codexNeedsSignIn = false;
    return account;
  }));
  handle("assistant-codex-cancel-sign-in", async () => {
    if (codexAccountTask?.kind !== "sign-in") return;
    const task = codexAccountTask;
    task.controller.abort();
    await task.done.catch(() => {});
  });
  handle("assistant-codex-sign-out", () => codexAccountOperation("sign-out", signal => signOutCodexAgent(codexAgentOptions(), signal)));
  handle("assistant-start", async (request: AssistantRequest, local?: AssistantLocalProject) => {
    if (assistantStarting || assistantRunning) throw new Error("助手正在处理上一条消息");
    if (!request || typeof request.requestId !== "string" || !["codex", "claude", "codex-agent"].includes(request.provider)) throw new Error("助手请求无效");
    if (request.provider === "codex-agent" && codexAccountTask && codexAccountTask.kind !== "read") throw new Error("请等待当前 Codex 登录操作完成。");
    assistantStarting = true;
    assistantPendingId = request.requestId; assistantCancelPending = false;
    let resolveStart!: () => void;
    assistantStartDone = new Promise<void>(resolve => { resolveStart = resolve; });
    const owner = window!.webContents;
    try {
      const sendEvent = (event: AssistantEvent) => {
        if (request.provider === "codex-agent" && event.type === "error" && event.account === "signed-out") codexNeedsSignIn = true;
        if (!owner.isDestroyed()) owner.send("assistant-event", event);
      };
      const running = request.provider === "codex-agent"
        ? startCodexAgentSession(request, sendEvent, codexAgentOptions(), local ? localAgentTranscription(local) : undefined)
        : await startAssistantSession(request, sendEvent, { executablePath: assistantOverrides[request.provider], sessionRoot: assistantSessionRoot() });
      assistantRunning = { requestId: request.requestId, ...running };
      void running.done.finally(() => { if (assistantRunning?.requestId === request.requestId) assistantRunning = null; }).catch(() => {});
      if (owner.isDestroyed() || assistantCancelPending) running.cancel();
    } finally { assistantStarting = false; assistantPendingId = null; resolveStart(); }
  });
  handle("assistant-cancel", async (requestId: unknown) => {
    if (typeof requestId !== "string") return;
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
        title: nativeUI("导入素材", "Import media"),
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: nativeUI("媒体文件", "Media files"),
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
          { name: nativeUI("所有文件", "All files"), extensions: ["*"] },
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
      title: nativeUI(`重新链接 ${asset.name}`, `Relink ${asset.name}`),
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
      title: nativeUI("打开 ReaCut 项目", "Open ReaCut project"),
      properties: ["openFile"],
      filters: [{ name: nativeUI("ReaCut 项目", "ReaCut project"), extensions: ["reacut", "json"] }],
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
        title: nativeUI("保存项目", "Save project"),
        defaultPath: project.name + ".reacut",
        filters: [{ name: nativeUI("ReaCut 项目", "ReaCut project"), extensions: ["reacut"] }],
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
    const selected = await dialog.showOpenDialog(window!, { title: nativeUI("选择素材包保存位置", "Choose collected media location"), properties: ["openDirectory", "createDirectory"] });
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
      title: nativeUI("导出视频", "Export video"),
      defaultPath: name + "." + format,
      filters: [{ name: format.toUpperCase() + nativeUI(" 视频", " video"), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return null;
    outputPaths.add(result.filePath);
    return result.filePath;
  });
  handle("export-encoders", async () => ({ videoToolbox: await videoToolboxAvailable() }));
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
  if (pluginMode) registerPluginOutputs();
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
      filters: [{ name: nativeUI("文本文件", "Text files"), extensions }],
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
      title: mode === "file" ? nativeUI("选择剪映草稿文件", "Choose CapCut draft file") : nativeUI("选择剪映项目文件夹", "Choose CapCut project folder"),
      properties: [mode === "file" ? "openFile" : "openDirectory"],
      ...(mode === "file"
        ? { filters: [{ name: nativeUI("剪映草稿", "CapCut draft"), extensions: ["json"] }] }
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
  handle("read-capcut-draft", (token: unknown, timelineId?: unknown) => readCapcutSelection(token, async plan => {
    if (
      timelineId !== undefined &&
      (typeof timelineId !== "string" ||
        !plan.timelines.some((choice) => choice.id === timelineId))
    )
      throw new Error("请选择项目中已有的时间线");
    const result = await readSelectedCapcutTimeline(plan, timelineId as string | undefined);
    return { text: decodeCapcutDraft(result.text).text, name: result.name, warnings: plan.warnings };
  }));
  handle("read-capcut-timelines", (token: unknown) => readCapcutSelection(token, async plan => {
    if (plan.sourceSelection.kind !== "directory" || !plan.requiresTimelineChoice ||
        plan.timelines.length > MAX_PROJECT_TIMELINES)
      throw new Error("Choose a CapCut project folder with 2–32 timelines.");
    const drafts: CapcutTimelineDraft[] = [];
    let bytes = 0;
    for (const timeline of plan.timelines) {
      const draft = await readSelectedCapcutTimeline(plan, timeline.id);
      const { text } = decodeCapcutDraft(draft.text);
      bytes += Buffer.byteLength(text);
      if (bytes > 40 * 1024 * 1024) throw new Error("The combined CapCut timelines exceed 40 MiB.");
      drafts.push({ id: timeline.id, name: draft.name, text });
    }
    return { drafts, warnings: plan.warnings };
  }));
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
      title: nativeUI(`选择 ${name} 可执行文件`, `Choose ${name} executable`),
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
        message: nativeUI("项目有未保存的修改", "This project has unsaved changes"),
        detail: nativeUI("保存项目后再关闭？最近编辑也会自动恢复。", "Save the project before closing? Recent edits are also available through automatic recovery."),
        buttons: [nativeUI("保存并关闭", "Save and close"), nativeUI("取消", "Cancel"), nativeUI("不保存", "Don't save")],
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
    codexAccountTask?.controller.abort();
    codexModelsTask?.controller.abort();
    capcutSelections.clear();
    window = null;
    dirty = false;
    closeAllowed = false;
  });
  if (process.env.VITE_DEV_SERVER_URL)
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(directory, "../dist/index.html"));
}
function updateApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: "ReaCut",
            submenu: [
              { label: nativeUI("关于 ReaCut", "About ReaCut"), role: "about" as const },
              { type: "separator" as const },
              { label: nativeUI("服务", "Services"), role: "services" as const },
              { type: "separator" as const },
              { label: nativeUI("隐藏 ReaCut", "Hide ReaCut"), role: "hide" as const },
              { label: nativeUI("退出 ReaCut", "Quit ReaCut"), role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: nativeUI("文件", "File"),
      submenu: [
        {
          label: nativeUI("新建项目", "New project"),
          accelerator: "CmdOrCtrl+N",
          click: () => menuAction("new"),
        },
        {
          label: nativeUI("打开项目", "Open project"),
          accelerator: "CmdOrCtrl+O",
          click: () => menuAction("open"),
        },
        {
          label: nativeUI("保存", "Save"),
          accelerator: "CmdOrCtrl+S",
          click: () => menuAction("save"),
        },
        {
          label: nativeUI("另存为", "Save as"),
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => menuAction("save-as"),
        },
        { label: nativeUI("工程模板…", "Project templates\u2026"), click: () => menuAction("templates") },
        { type: "separator" },
        {
          label: nativeUI("导入素材", "Import media"),
          accelerator: "CmdOrCtrl+I",
          click: () => menuAction("import"),
        },
        {
          label: nativeUI("导入剪映草稿文件…", "Import CapCut draft file\u2026"),
          click: () => menuAction("import-capcut-file"),
        },
        {
          label: nativeUI("导入剪映项目文件夹…", "Import CapCut project folder\u2026"),
          click: () => menuAction("import-capcut-directory"),
        },
        {
          label: nativeUI("导出视频", "Export video"),
          accelerator: "CmdOrCtrl+E",
          click: () => menuAction("export"),
        },
      ],
    },
    {
      label: nativeUI("编辑", "Edit"),
      submenu: [
        {
          label: nativeUI("撤销", "Undo"),
          accelerator: "CmdOrCtrl+Z",
          click: () => menuAction("undo"),
        },
        {
          label: nativeUI("重做", "Redo"),
          accelerator: "CmdOrCtrl+Shift+Z",
          click: () => menuAction("redo"),
        },
        { type: "separator" },
        { label: nativeUI("剪切", "Cut"), role: "cut" },
        { label: nativeUI("复制", "Copy"), role: "copy" },
        { label: nativeUI("粘贴", "Paste"), role: "paste" },
        { label: nativeUI("全选", "Select all"), role: "selectAll" },
      ],
    },
    {
      label: nativeUI("窗口", "Window"),
      submenu: [
        { label: nativeUI("最小化", "Minimize"), role: "minimize" },
        { label: nativeUI("切换全屏", "Toggle full screen"), role: "togglefullscreen" },
        ...(process.env.VITE_DEV_SERVER_URL
          ? [{ label: nativeUI("开发者工具", "Developer tools"), role: "toggleDevTools" as const }]
          : []),
      ],
    },
    {
      label: nativeUI("帮助", "Help"),
      submenu: [
        { label: nativeUI("设置 / Settings…", "Settings…"), accelerator: "CmdOrCtrl+,", click: () => menuAction("settings") },
        { label: nativeUI("检查更新…", "Check for Updates…"), click: () => menuAction("check-for-updates") },
        { label: nativeUI("快捷键", "Shortcuts"), click: () => menuAction("shortcuts") },
        { label: nativeUI("关于 ReaCut", "About ReaCut"), click: () => menuAction("about") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    const input = JSON.parse(await readFile(speechSettingsPath, "utf8"));
    for (const key of ["python", "model"] as const) if (typeof input[key] === "string" && path.isAbsolute(input[key])) speechSettings[key] = input[key];
  } catch { /* Optional local dependencies are never installed automatically. */ }
  await cleanSpeechTemporaries(userFile("speech-media"));
  protocol.handle("reacut-media", serveMedia);
  registerIPC();
  uiLanguage = app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  updateApplicationMenu();
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
    (async () => { const task = codexAccountTask; task?.controller.abort(); await task?.done.catch(() => {}); })(),
    (async () => { const task = codexModelsTask; task?.controller.abort(); await task?.done.catch(() => {}); })(),
    cancelAllExports(),
    cancelDerivatives(),
    cancelAllSpeech(),
    speechSettingsWrites.catch(() => {}),
    (async () => {
      const job = previewProxyJob;
      job?.controller.abort();
      await job?.done.catch(() => {});
    })(),
    (async () => {
      const job = audioAnalysisJob;
      job?.controller.abort();
      await job?.done.catch(() => {});
    })(),
    cancelPortablePackages(),
    cancelTemplates(),
    shutdownMediaTasks(),
    writeQueue.catch(() => {}),
  ]).finally(() => {
    quitting = true;
    app.quit();
  });
});
