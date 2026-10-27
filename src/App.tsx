import UpdateDialog from "./components/UpdateDialog";
import TemplateDialog from "./components/TemplateDialog";
import SpeechDialog from "./components/SpeechDialog";
import DerivativeDialog from "./components/DerivativeDialog";
import { version as appVersion } from "../package.json";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudOff,
  Download,
  FilePlus2,
  FolderOpen,
  Info,
  Keyboard,
  LoaderCircle,
  Monitor,
  Music2,
  MessageSquare,
  Shapes,
  Play,
  Save,
  Settings2,
  Sparkles,
  Subtitles,
  Type,
  Upload,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { useEditorStore } from "./editor/store";
import {
  clone,
  createTrack,
  formatTime,
  id,
  projectDuration,
} from "./core/model";
import type {
  CapcutImportSelection,
  Clip,
  ExportOptions,
  ExportProgress,
  MediaAsset,
  Project,
  RecentProject,
} from "./core/types";
import { detachLinkedAudio } from "./core/timelineEdits";
import { parseSubtitles, stringifySubtitles } from "./core/subtitles";
import { importCapcutDraft } from "./core/capcutImport";
import SubtitlePanel from "./components/SubtitlePanel";
import PackageDialog from "./components/PackageDialog";
import { resolveExportRange, selectedClipRange } from "./core/exportRange";
import AssistantPanel from "./components/AssistantPanel";
import AssetLibrary from "./components/AssetLibrary";
import type { BuiltinAsset } from "./core/builtinAssets";
import MediaLibrary from "./components/MediaLibrary";
import SourcePreview from "./components/SourcePreview";
import EditorWorkspace from "./components/EditorWorkspace";
import Timeline from "./components/Timeline";
import EffectsPanel from "./components/EffectsPanel";
import { TextLibrary, TransitionLibrary } from "./components/CreativeLibrary";
import { addTextPreset, applyTransition, type TextPreset, type TransitionId } from "./core/creativePresets";
import Player from "./components/Player";
import Inspector from "./components/Inspector";
import { useUITranslation, translateUI, useTranslation, useLanguageStore, type Language, type TranslationKey } from "./i18n";
import { createEditorProject } from "./editor/localizedDefaults";
import { localizeMessage } from "./i18n/messages";
import "./styles.css";
type Modal = "updates" | "templates" | "reverse" | "freeze" | "package" | "export" | "settings" | "shortcuts" | "about" | "capcut" | null;
type PendingCapcutImport = {
  selection: CapcutImportSelection;
  capturedProject: Project;
};
const shortcuts: Array<[TranslationKey, string]> = [
  ["shortcuts.playPause", "Space"],
  ["shortcuts.split", "⌘ / Ctrl + B"],
  ["shortcuts.deleteClip", "Delete / Backspace"],
  ["shortcuts.undoRedo", "⌘ + Z / ⇧ + ⌘ + Z"],
  ["shortcuts.copyPaste", "⌘ + C / ⌘ + V"],
  ["shortcuts.duplicate", "⌘ / Ctrl + D"],
  ["shortcuts.selectAll", "⌘ / Ctrl + A"],
  ["shortcuts.prevNextFrame", "← / →"],
  ["shortcuts.newOpenSave", "⌘ + N / O / S"],
  ["shortcuts.importExport", "⌘ + I / E"],
  ["shortcuts.zoomInOut", "+ / −"],
  ["shortcuts.jumpStartEnd", "Home / End"],
];
function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "modal-wide" : ""}`}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label={t("dialog.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function ExportDialog({
  project,
  selectedIds,
  onClose,
  notify,
}: {
  project: Project;
  selectedIds: string[];
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const ui = useUITranslation();
  const [options, setOptions] = useState<ExportOptions>({
      path: "",
      width: project.width + (project.width % 2),
      height: project.height + (project.height % 2),
      fps: project.fps,
      quality: "standard",
      format: "mp4",
    }),
    [progress, setProgress] = useState<ExportProgress | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [scope, setScope] = useState("all");
  const [rangeStart, setRangeStart] = useState("0"), [rangeEnd, setRangeEnd] = useState(String(projectDuration(project)));
  const selectedRange = selectedClipRange(project, selectedIds);
  const rangeOptions = scope === "all" ? undefined : scope === "selected" ? selectedRange : { start: Number(rangeStart), end: Number(rangeEnd) };
  const exportDuration = rangeOptions ? Math.max(0, rangeOptions.end - rangeOptions.start) : projectDuration(project);
  const job = useRef<string | null>(null);
  const exporting =
    busy &&
    !["complete", "error", "cancelled"].includes(progress?.status ?? "");
  useEffect(
    () =>
      window.editorAPI?.onExportProgress((event) => {
        if (!job.current || event.jobId === job.current) {
          setProgress(event);
          if (["complete", "error", "cancelled"].includes(event.status)) {
            setBusy(false);
            if (event.status === "error") setError(event.message ?? translateUI("导出失败", "Export failed"));
          }
        }
      }),
    [],
  );
  const choose = async () => {
    try {
      const path = await window.editorAPI?.chooseExportPath(
        project.name,
        options.format,
      );
      if (path) setOptions((p) => ({ ...p, path }));
    } catch (error) {
      setError(String(error));
    }
  };
  const exportVideo = async () => {
    if (!window.editorAPI) {
      setError(ui("视频导出需要桌面版和本地 FFmpeg。", "Video export requires the desktop app and local FFmpeg."));
      return;
    }
    try {
      setError("");
      if (scope === "selected" && !selectedRange) throw new Error(ui("请先选择时间线片段", "Select timeline clips first"));
      if (scope === "custom" && (!rangeStart.trim() || !rangeEnd.trim())) throw new Error(ui("请填写区间起止时间", "Enter the range start and end times"));
      resolveExportRange(project, { ...options, range: rangeOptions });
      let path = options.path;
      if (!path) {
        path =
          (await window.editorAPI.chooseExportPath(
            project.name,
            options.format,
          )) ?? "";
        if (!path) return;
        setOptions((p) => ({ ...p, path }));
      }
      job.current = null;
      setBusy(true);
      setProgress({ jobId: "", progress: 0, status: "preparing" });
      const result = await window.editorAPI.exportProject(clone(project), {
        ...options,
        range: rangeOptions,
        path,
      });
      job.current = result.jobId;
    } catch (error) {
      setBusy(false);
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const status = progress?.status;
  return (
    <ModalShell
      title={ui("导出视频", "Export video")}
      onClose={() => {
        if (!exporting) onClose();
      }}
    >
      <div className="export-preview">
        <div>
          <Video size={28} />
          <strong>{project.name}</strong>
          <span>
            {formatTime(exportDuration, project.fps)} ·{" "}
            {project.clips.length} {ui("个片段", " clips")}</span>
        </div>
        <span className="export-badge">{ui("本地渲染", "Local rendering")}</span>
      </div>
      <div className="modal-body">
        <label className="stacked-label">
          {ui("保存位置", "Save location")}<div className="file-picker">
            <input
              aria-label={ui("导出位置", "Export location")}
              readOnly
              value={options.path}
              placeholder={ui("选择视频保存位置", "Choose where to save the video")}
            />
            <button disabled={exporting} onClick={choose}>
              <FolderOpen size={16} />
            </button>
          </div>
        </label>
        <label className="stacked-label">{ui("导出范围", "Export range")}<select aria-label={ui("导出范围", "Export range")} value={scope} disabled={exporting} onChange={e => setScope(e.target.value)}>
            <option value="all">{ui("整个时间线", "Entire timeline")}</option><option value="selected" disabled={!selectedRange}>{ui("选中片段所在区间", "Selected clip range")}</option><option value="custom">{ui("自定义区间", "Custom range")}</option>
          </select>
        </label>
        {scope === "custom" && <div className="export-fields"><label>{ui("起点（秒）", "Start (seconds)")}<input aria-label={ui("区间起点", "Range start")} type="number" min="0" step={1 / project.fps} disabled={exporting} value={rangeStart} onChange={e => setRangeStart(e.target.value)} /></label><label>{ui("终点（秒）", "End (seconds)")}<input aria-label={ui("区间终点", "Range end")} type="number" min="0" step={1 / project.fps} disabled={exporting} value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} /></label></div>}
        {scope === "selected" && selectedRange && <p className="field-hint">{selectedRange.start.toFixed(3)}–{selectedRange.end.toFixed(3)} {ui("秒，包含该区间内所有可见画面和声音。", " seconds, including all visible video and sound in this range.")}</p>}
        <div className="export-fields">
          <label>
            {ui("分辨率", "Resolution")}<select
              aria-label={ui("导出分辨率", "Export resolution")}
              disabled={exporting}
              value={`${options.width}:${options.height}`}
              onChange={(e) => {
                const [width, height] = e.target.value.split(":").map(Number);
                setOptions((p) => ({ ...p, width, height }));
              }}
            >
              <option
                value={`${project.width + (project.width % 2)}:${project.height + (project.height % 2)}`}
              >
                {ui("原始 ·", "Original · ")}{project.width}×{project.height}
              </option>
              {[720, 1080, 1440, 2160].map((height) => {
                const width =
                  Math.round((height * project.width) / project.height / 2) * 2;
                return (
                  <option key={height} value={`${width}:${height}`}>
                    {height}p · {width}×{height}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            {ui("帧率", "Frame rate")}<select
              aria-label={ui("导出帧率", "Export frame rate")}
              value={options.fps}
              disabled={exporting}
              onChange={(e) =>
                setOptions((p) => ({ ...p, fps: Number(e.target.value) }))
              }
            >
              {[24, 25, 30, 50, 60].map((fps) => (
                <option key={fps}>{fps}</option>
              ))}
            </select>
          </label>
          <label>
            {ui("画质", "Quality")}<select
              aria-label={ui("导出画质", "Export quality")}
              disabled={exporting}
              value={options.quality}
              onChange={(e) =>
                setOptions((p) => ({
                  ...p,
                  quality: e.target.value as ExportOptions["quality"],
                }))
              }
            >
              <option value="draft">{ui("草稿 · 更快", "Draft · Faster")}</option>
              <option value="standard">{ui("标准 · 推荐", "Standard · Recommended")}</option>
              <option value="high">{ui("高画质", "High quality")}</option>
            </select>
          </label>
          <label>
            {ui("格式", "Format")}<select
              aria-label={ui("导出格式", "Export format")}
              disabled={exporting}
              value={options.format}
              onChange={(e) => {
                job.current = null;
                setOptions((p) => ({
                  ...p,
                  format: e.target.value as "mp4" | "mov",
                  path: "",
                }));
              }}
            >
              <option value="mp4">MP4 · H.264 / AAC</option>
              <option value="mov">MOV · H.264 / AAC</option>
            </select>
          </label>
        </div>
        <p className="field-hint">
          {ui("导出原始素材和所有可见画面轨道，按音频设置混音。无需登录或上传。", "Renders original media and all visible video tracks, with audio mixed using your settings. No sign-in or upload required.")}</p>
        {progress && (
          <div
            className={`export-progress ${status === "complete" ? "is-complete" : ""}`}
          >
            <div>
              <span>
                {status === "complete"
                  ? ui("导出完成", "Export complete")
                  : status === "cancelled"
                    ? ui("导出已取消", "Export cancelled")
                    : status === "preparing"
                      ? ui("正在准备素材", "Preparing media")
                      : status === "error"
                        ? ui("导出失败", "Export failed")
                        : ui("正在渲染视频", "Rendering video")}
              </span>
              <strong>{Math.round(progress.progress * 100)}%</strong>
            </div>
            <progress value={progress.progress} max={1} />
          </div>
        )}
        {error && (
          <div role="alert" className="inline-warning">
            {localizeMessage(error)}
          </div>
        )}
      </div>
      <footer>
        {exporting ? (
          <>
            <span className="muted">
              <LoaderCircle size={14} className="spin" />
              {ui("编辑会在本地渲染完成后继续", "Editing resumes after local rendering finishes")}</span>
            <button
              onClick={() => {
                if (job.current)
                  void window.editorAPI
                    ?.cancelExport(job.current)
                    .catch((error) => setError(String(error)));
              }}
            >
              {ui("取消导出", "Cancel export")}</button>
          </>
        ) : status === "complete" ? (
          <>
            <button
              onClick={() =>
                void window.editorAPI
                  ?.revealPath(progress?.path ?? options.path)
                  .catch((error) => notify(String(error)))
              }
            >
              <FolderOpen size={15} />
              {ui("在访达中查看", "Show in folder")}</button>
            <button className="primary" onClick={onClose}>
              <Check size={15} />
              {ui("完成", "Done")}</button>
          </>
        ) : (
          <>
            <button onClick={onClose}>{ui("取消", "Cancel")}</button>
            <button
              className="primary"
              onClick={exportVideo}
              disabled={!project.clips.length}
            >
              <Download size={16} />
              {ui("开始导出", "Start export")}</button>
          </>
        )}
      </footer>
    </ModalShell>
  );
}
async function browserAssets(files: File[]): Promise<MediaAsset[]> {
  const results: MediaAsset[] = [];
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const kind = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("audio/")
        ? "audio"
        : "video";
    if (kind === "image") {
      const image = new Image();
      image.src = url;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(translateUI(`无法读取 ${file.name}`, `Cannot read ${file.name}`)));
      });
      results.push({
        id: id(),
        name: file.name,
        path: file.name,
        url,
        kind,
        duration: 0,
        width: image.width,
        height: image.height,
        fps: 0,
        hasAudio: false,
        thumbnail: url,
      });
    } else {
      const element = document.createElement(kind);
      element.preload = "metadata";
      element.src = url;
      await new Promise<void>((resolve, reject) => {
        element.onloadedmetadata = () => resolve();
        element.onerror = () => reject(new Error(translateUI(`无法读取 ${file.name}`, `Cannot read ${file.name}`)));
      });
      const video = element instanceof HTMLVideoElement ? element : null;
      results.push({
        id: id(),
        name: file.name,
        path: file.name,
        url,
        kind,
        duration: element.duration,
        width: video?.videoWidth ?? 0,
        height: video?.videoHeight ?? 0,
        fps: 30,
        hasAudio: true,
      });
      element.removeAttribute("src");
      element.load();
    }
  }
  return results;
}
export default function App() {
  const ui = useUITranslation();
  const s = useEditorStore();
  const [speechMode, setSpeechMode] = useState<"asr" | "tts" | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(null);
  const sourceAsset = s.project.assets.find(asset => asset.id === sourceAssetId);
  const [addingBuiltin, setAddingBuiltin] = useState<string | null>(null);
  const [tab, setTab] = useState("素材"),
    [modal, setModal] = useState<Modal>(null),
    [fileMenu, setFileMenu] = useState(false),
    [toast, setToast] = useState(""),
    [importing, setImporting] = useState(false),
    [system, setSystem] = useState<{
      ffmpeg: boolean;
      version?: string;
      ffmpegVersion?: string;
      ffmpegPath?: string;
    }>({ ffmpeg: false }),
    [recent, setRecent] = useState<RecentProject[]>([]),
    [recover, setRecover] = useState<Project | null>(null),
    [initialized, setInitialized] = useState(false);
  useEffect(() => { setSourceAssetId(null); }, [s.project.id, modal, s.selectedIds]);
  useEffect(() => { if (s.playing) setSourceAssetId(null); }, [s.playing]);
  const [timelineHeight, setTimelineHeight] = useState(() =>
    Math.max(220, Math.min(420, window.innerHeight * 0.34)),
  );
  const timelineResize = useRef<{ y: number; height: number } | null>(null);
  const resizeTimeline = (height: number) =>
    setTimelineHeight(
      Math.max(190, Math.min(window.innerHeight - 290, height)),
    );
  useEffect(() => {
    const clamp = () =>
      setTimelineHeight((height) =>
        Math.max(190, Math.min(window.innerHeight - 290, height)),
      );
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);
  const addBuiltin = async (definition: BuiltinAsset) => {
    if (!window.editorAPI) throw new Error(ui("添加内置素材需要桌面版", "Adding built-in assets requires the desktop app"));
    if (addingBuiltin) return;
    const projectId = useEditorStore.getState().project.id;
    setAddingBuiltin(definition.id);
    try {
      const imported = await window.editorAPI.importBuiltinAsset(definition.id);
      const state = useEditorStore.getState();
      if (state.project.id !== projectId) throw new Error(ui("项目已切换，请重新添加素材", "The project changed. Add the asset again."));
      state.beginTransaction();
      try {
        state.addAssets([{ ...imported, name: definition.name }]);
        const latest = useEditorStore.getState();
        const asset = latest.project.assets.find(a => a.path === imported.path)!;
        const name = definition.category === "backgrounds" ? ui("内置背景", "Built-in backgrounds") : definition.kind === "audio" ? ui("内置音效", "Built-in sounds") : ui("内置装饰", "Built-in decorations");
        let track = latest.project.tracks.find(t => t.name === name && t.kind === definition.kind && !t.locked);
        if (!track) {
          track = createTrack(definition.kind, name);
          const tracks = [...latest.project.tracks];
          if (definition.category === "backgrounds" || definition.kind === "audio") tracks.push(track);
          else { const at = tracks.findIndex(t => t.kind !== "text"); tracks.splice(at < 0 ? tracks.length : at, 0, track); }
          latest.updateProject({ tracks });
        }
        latest.addAssetClip(asset.id, latest.playhead, track.id);
        const after = useEditorStore.getState();
        if (definition.category === "stickers" && after.selectedIds[0]) after.updateClip(after.selectedIds[0], { transform: { ...after.project.clips.find(c => c.id === after.selectedIds[0])!.transform, scale: .35 } });
      } finally { useEditorStore.getState().endTransaction(); }
    } finally { setAddingBuiltin(null); }
  };
  const saving = useRef(false);
  const [capcutImport, setCapcutImport] =
    useState<PendingCapcutImport | null>(null);
  const [capcutTimelineId, setCapcutTimelineId] = useState("");
  const [capcutBusy, setCapcutBusy] = useState(false);
  const capcutImportRef = useRef<PendingCapcutImport | null>(null);
  const capcutBusyRef = useRef(false);
  useEffect(
    () => () => {
      const token = capcutImportRef.current?.selection.token;
      if (token)
        void window.editorAPI?.discardCapcutProject(token).catch(() => {});
    },
    [],
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subtitleInput = useRef<HTMLInputElement>(null);
  const [subtitleAction, setSubtitleAction] = useState<"import" | "draft">(
    "import",
  );
  const notify = useCallback((message: string) => {
    setToast(localizeMessage(message));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  const safe = useCallback(
    async (action: () => unknown) => {
      try {
        await action();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
      }
    },
    [notify],
  );
  const active = s.project.clips.find((c) => c.id === s.selectedIds[0]);
  const activeTrack = s.project.tracks.find((t) => t.id === active?.trackId);
  const { t, language } = useTranslation();
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const refreshSystem = async () => {
    if (window.editorAPI) setSystem(await window.editorAPI.getSystemInfo());
  };
  useEffect(() => {
    void safe(async () => {
      await refreshSystem();
      if (window.editorAPI) {
        setRecent(await window.editorAPI.getRecentProjects());
        let startup;
        try {
          startup = await window.editorAPI.getStartupProject();
        } catch (error) {
          notify(
            translateUI(`启动项目无法打开：${error instanceof Error ? error.message : String(error)}`, `Cannot open startup project: ${error instanceof Error ? error.message : String(error)}`),
          );
        }
        if (startup) {
          s.setProject(startup.project, startup.path);
          setInitialized(true);
          return;
        }
        const autosave = await window.editorAPI.getAutosave();
        if (autosave && (autosave.clips.length || autosave.assets.length))
          setRecover(autosave);
      }
      setInitialized(true);
    }).finally(() => setInitialized(true));
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    window.editorAPI?.setDirty(s.dirty);
  }, [s.dirty]);
  useEffect(() => {
    if (!initialized || recover || !window.editorAPI) return;
    const timer = setTimeout(() => {
      void window
        .editorAPI!.autosaveProject(s.project)
        .catch((error) => notify(translateUI(`自动保存失败：${String(error)}`, `Autosave failed: ${String(error)}`)));
    }, 1000);
    return () => clearTimeout(timer);
  }, [s.project, initialized, recover]);
  const confirmReplace = () =>
    !useEditorStore.getState().dirty ||
    window.confirm(ui("当前项目有未保存修改，继续会关闭当前项目。建议先保存。", "This project has unsaved changes. Continuing will close it. Save your changes first."));
  const importMedia = async (paths?: string[]) => {
    if (!window.editorAPI) {
      notify(ui("浏览器预览可用拖拽文件导入。完整文件操作请运行桌面版。", "Drag local files into the browser preview to import them. Use the desktop app for full file operations."));
      return;
    }
    const projectId = useEditorStore.getState().project.id;
    setImporting(true);
    try {
      const assets = await window.editorAPI.importMedia(paths);
      if (useEditorStore.getState().project.id !== projectId) {
        notify(ui("项目已切换，导入素材未加入新项目", "The project changed. Imported assets were not added to the new project."));
        return;
      }
      s.addAssets(assets);
      if (assets.length) notify(ui(`已导入 ${assets.length} 个素材`, `Imported ${assets.length} assets`));
    } finally {
      setImporting(false);
    }
  };
  const save = async (as = false) => {
    if (saving.current) {
      notify(ui("项目正在保存，请稍候", "Saving the project. Please wait."));
      return false;
    }
    if (!window.editorAPI) {
      const blob = new Blob([JSON.stringify(s.project, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = s.project.name + ".reacut";
      a.click();
      URL.revokeObjectURL(url);
      notify(ui("已下载项目 JSON。浏览器素材链接不支持跨会话恢复。", "Project JSON downloaded. Browser media links cannot be restored across sessions."));
      return false;
    }
    saving.current = true;
    try {
      const state = useEditorStore.getState(),
        captured = state.project,
        file = await window.editorAPI.saveProject(
          captured,
          as ? undefined : state.path,
        );
      if (!file) return false;
      setRecent(await window.editorAPI.getRecentProjects());
      const latest = useEditorStore.getState();
      if (latest.project.id !== captured.id) {
        notify(ui("原项目快照已保存", "Original project snapshot saved"));
        return false;
      }
      const unchanged = latest.project === captured;
      if (unchanged) latest.markSaved(file);
      else useEditorStore.setState({ path: file, dirty: true });
      notify(unchanged ? ui("项目已保存", "Project saved") : ui("当前快照已保存，后续编辑尚未保存", "Snapshot saved. Newer edits are not saved yet."));
      return unchanged;
    } finally {
      saving.current = false;
    }
  };
  const open = async () => {
    if (!confirmReplace()) return;
    if (!window.editorAPI) {
      notify(ui("打开本地项目需要桌面版。", "Opening local projects requires the desktop app."));
      return;
    }
    const result = await window.editorAPI.openProject();
    if (result) s.setProject(result.project, result.path);
  };
  const newProject = () => {
    if (confirmReplace()) s.setProject(createEditorProject());
  };
  const handleAction = async (action: string) => {
    // Native menu accelerators bypass DOM key handlers; keep modal workflows intact.
    if ((modal || speechMode || recover) && action !== "save-and-close") return;
    setFileMenu(false);
    switch (action) {
      case "check-for-updates":
        setModal("updates");
        break;
      case "settings":
        setModal("settings");
        break;
      case "templates":
        s.setPlaying(false); setModal("templates");
        break;
      case "new":
        newProject();
        break;
      case "open":
        await open();
        break;
      case "open-external":
        if (confirmReplace()) {
          const result = await window.editorAPI?.getStartupProject();
          if (result) s.setProject(result.project, result.path);
        }
        break;
      case "save":
        await save();
        break;
      case "save-as":
        await save(true);
        break;
      case "save-and-close":
        try {
          if (await save()) {
            window.editorAPI?.setDirty(false);
            window.editorAPI?.closeWindow();
          } else window.editorAPI?.cancelCloseRequest();
        } catch (error) {
          window.editorAPI?.cancelCloseRequest();
          throw error;
        }
        break;
      case "import":
        await importMedia();
        break;
      case "import-capcut-file":
        await importDraft("file");
        break;
      case "import-capcut-directory":
        await importDraft("directory");
        break;
      case "export":
        s.setPlaying(false);
        setModal("export");
        break;
      case "undo":
        s.undo();
        break;
      case "redo":
        s.redo();
        break;
      case "shortcuts":
        setModal("shortcuts");
        break;
      case "about":
        setModal("about");
        break;
    }
  };
  const actionRef = useRef(handleAction);
  actionRef.current = handleAction;
  useEffect(
    () =>
      window.editorAPI?.onMenuAction(
        (action) => void safe(() => actionRef.current(action)),
      ),
    [safe],
  );
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (modal === "capcut") {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelCapcutImport();
        }
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      if (modal || speechMode || recover) {
        if (e.key === "Escape" && modal !== "templates" && modal !== "export" && modal !== "package" && modal !== "reverse" && modal !== "freeze") {
          setModal(null);
        }
        return;
      }
      const state = useEditorStore.getState(),
        modifier = e.metaKey || e.ctrlKey;
      let handled = true;
      if (modifier) {
        switch (e.key.toLowerCase()) {
          case ",":
            void safe(() => actionRef.current("settings"));
            break;
          case "n":
            void safe(() => actionRef.current("new"));
            break;
          case "o":
            void safe(() => actionRef.current("open"));
            break;
          case "s":
            void safe(() => actionRef.current(e.shiftKey ? "save-as" : "save"));
            break;
          case "i":
            void safe(() => actionRef.current("import"));
            break;
          case "e":
            void safe(() => actionRef.current("export"));
            break;
          case "b":
            state.split();
            break;
          case "d":
            state.duplicate();
            break;
          case "z":
            e.shiftKey ? state.redo() : state.undo();
            break;
          case "y":
            state.redo();
            break;
          case "c":
            state.copy();
            break;
          case "v":
            state.paste();
            break;
          case "a":
            state.select(state.project.clips.map((c) => c.id));
            break;
          default:
            handled = false;
        }
      } else
        switch (e.key) {
          case " ":
            if (state.playhead >= projectDuration(state.project)) state.seek(0);
            state.setPlaying(!state.playing && !!state.project.clips.length);
            break;
          case "Backspace":
          case "Delete":
            void safe(() => state.deleteSelected());
            break;
          case "ArrowLeft":
            state.seek(
              Math.max(
                0,
                state.playhead - (e.shiftKey ? 1 : 1 / state.project.fps),
              ),
            );
            break;
          case "ArrowRight":
            state.seek(
              Math.min(
                projectDuration(state.project),
                state.playhead + (e.shiftKey ? 1 : 1 / state.project.fps),
              ),
            );
            break;
          case "Home":
            state.seek(0);
            break;
          case "End":
            state.seek(projectDuration(state.project));
            break;
          case "+":
          case "=":
            state.setZoom(state.zoom * 1.25);
            break;
          case "-":
            state.setZoom(state.zoom / 1.25);
            break;
          case "Escape":
            state.select([]);
            setFileMenu(false);
            break;
          default:
            handled = false;
        }
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [modal, speechMode, recover, safe]);
  const addStyledText = (preset: TextPreset) => {
    const result = addTextPreset(s.project, preset, s.playhead);
    s.commit(result.project);
    s.select([result.clip.id]);
    setTab("文本");
  };
  const readSubtitles = async () => {
    if (!window.editorAPI) {
      setSubtitleAction("import");
      subtitleInput.current?.click();
      return;
    }
    const result = await window.editorAPI.readTextFile(["srt", "vtt"]);
    if (!result) return;
    const cues = parseSubtitles(result.text);
    if (!cues.length) throw new Error(ui("没有读取到有效的 SRT / VTT 字幕", "No valid SRT / VTT captions found"));
    s.addSubtitles(cues);
    notify(ui(`已导入 ${cues.length} 条字幕`, `Imported ${cues.length} captions`));
  };
  const exportSubtitles = async () => {
    const cues = s.project.clips
      .filter((c) => c.text)
      .sort((a, b) => a.start - b.start)
      .map((c) => ({
        start: c.start,
        end: c.start + c.duration,
        text: c.text!.text,
      }));
    if (!cues.length) throw new Error(ui("项目没有文字或字幕", "The project has no text or captions"));
    const text = stringifySubtitles(cues);
    if (window.editorAPI)
      await window.editorAPI.writeTextFile(text, s.project.name + ".srt");
    else {
      const url = URL.createObjectURL(
          new Blob([text], { type: "text/plain;charset=utf-8" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = s.project.name + ".srt";
      a.click();
      URL.revokeObjectURL(url);
    }
  };
  const cancelCapcutImport = () => {
    if (capcutBusyRef.current) return;
    const token = capcutImportRef.current?.selection.token;
    capcutImportRef.current = null;
    setCapcutImport(null);
    setModal(null);
    if (token)
      void window.editorAPI?.discardCapcutProject(token).catch(() => {});
  };
  const finishCapcutImport = async (
    pending: PendingCapcutImport,
    timelineId?: string,
  ) => {
    if (!window.editorAPI) return;
    capcutBusyRef.current = true;
    setCapcutBusy(true);
    try {
      const result = await window.editorAPI.readCapcutDraft(
        pending.selection.token,
        timelineId,
      );
      const imported = importCapcutDraft(result.text, { name: result.name });
      const loaded: MediaAsset[] = [];
      for (const asset of imported.project.assets) {
        try {
          const probed = (await window.editorAPI.importMedia([asset.path]))[0];
          if (!probed) throw new Error(ui("素材无法读取", "Cannot read the media"));
          loaded.push({ ...asset, ...probed, id: asset.id, kind: asset.kind });
        } catch {
          loaded.push({
            ...asset,
            missing: true,
            url: `reacut-media://asset?path=${encodeURIComponent(asset.path)}`,
          });
        }
      }
      const latest = useEditorStore.getState();
      if (latest.project.id !== pending.capturedProject.id) {
        notify(ui("项目已切换，请在当前项目中重新导入剪映草稿。", "The project changed. Import the CapCut draft again into the current project."));
        return;
      }
      if (latest.project !== pending.capturedProject && !confirmReplace())
        return;
      imported.project.assets = loaded;
      s.setProject(imported.project);
      notify([...new Set([...result.warnings, ...imported.warnings])].join(" "));
    } finally {
      await window.editorAPI
        .discardCapcutProject(pending.selection.token)
        .catch(() => {});
      capcutImportRef.current = null;
      setCapcutImport(null);
      setModal((value) => (value === "capcut" ? null : value));
      capcutBusyRef.current = false;
      setCapcutBusy(false);
    }
  };
  const importDraft = async (mode: "file" | "directory" = "file") => {
    setFileMenu(false);
    if (capcutBusyRef.current || capcutImportRef.current) {
      notify(ui("请先完成当前剪映项目的导入。", "Finish importing the current CapCut project first."));
      return;
    }
    if (!window.editorAPI && mode === "directory") {
      notify(ui("导入剪映项目文件夹需要桌面版。", "Importing a CapCut project folder requires the desktop app."));
      return;
    }
    if (!confirmReplace()) return;
    if (!window.editorAPI) {
      setSubtitleAction("draft");
      subtitleInput.current?.click();
      return;
    }
    const capturedProject = useEditorStore.getState().project;
    capcutBusyRef.current = true;
    setCapcutBusy(true);
    try {
      const selection = await window.editorAPI.chooseCapcutProject(mode);
      if (!selection) return;
      const pending = { selection, capturedProject };
      capcutImportRef.current = pending;
      if (selection.requiresTimelineChoice) {
        setCapcutImport(pending);
        setCapcutTimelineId(
          selection.recommendedTimelineId ?? selection.timelines[0]?.id ?? "",
        );
        setModal("capcut");
      } else {
        await finishCapcutImport(pending, selection.recommendedTimelineId);
      }
    } finally {
      capcutBusyRef.current = false;
      setCapcutBusy(false);
    }
  };
  const detachAudio = () => {
    if (!active) return;
    const result = detachLinkedAudio(s.project, active.id);
    s.commit(result.project);
    s.select([active.id]);
    notify(ui("音频已分离，画声保持关联；可在底部解除关联", "Audio detached. Video and audio remain linked; use Unlink video and audio to separate them."));
  };
  const applySceneTransition = (transition: TransitionId, seconds: number) => {
    if (!active) throw new Error(ui("请选择一个画面片段", "Select a video or image clip"));
    const result = applyTransition(s.project, active.id, transition, seconds);
    s.commit(result.project);
    notify(transition === "dissolve"
      ? ui(`已添加 ${result.duration.toFixed(2)} 秒叠化（后片段提前重叠）`, `Added a ${result.duration.toFixed(2)} second crossfade (the following clip overlaps earlier)`)
      : ui(`已添加 ${result.duration.toFixed(2)} 秒转场，可撤销`, `Added a ${result.duration.toFixed(2)} second transition; you can undo this`));
  };
  return (
    <div
      className="app-shell"
      style={{
        gridTemplateRows: `44px minmax(180px,1fr) ${timelineHeight}px 26px`,
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        void safe(async () => {
          if (window.editorAPI)
            await importMedia(
              files
                .map((file) => window.editorAPI!.getPathForFile(file))
                .filter(Boolean),
            );
          else s.addAssets(await browserAssets(files));
        });
      }}
    >
      <header className="titlebar">
        <div className="brand">
          <span className="brand-icon">
            <img src="./icons/reacut.png" alt="" />
          </span>
          <strong>ReaCut</strong>
          <span className="brand-cn">映刻</span>
        </div>
        <div className="titlebar-menus">
          <div className="file-menu-container">
            <button
              aria-label={t("toolbar.fileMenu.aria")}
              onClick={() => setFileMenu(!fileMenu)}
            >
              {t("toolbar.file")}
              <ChevronDown size={12} />
            </button>
            {fileMenu && (
              <div className="file-menu">
                {[
                  ["new", t("toolbar.newProject"), "⌘N"],
                  ["open", t("toolbar.openProject"), "⌘O"],
                  ["save", t("toolbar.saveProject"), "⌘S"],
                  ["save-as", t("toolbar.saveAs"), "⇧⌘S"],
                  ["import", t("toolbar.importMedia"), "⌘I"],
                  ["export", t("toolbar.exportVideo"), "⌘E"],
                ].map(([action, label, shortcut]) => (
                  <button
                    key={action}
                    onClick={() => void safe(() => handleAction(action))}
                  >
                    {label}
                    <kbd>{shortcut}</kbd>
                  </button>
                ))}
                <hr />
                <button onClick={() => void safe(() => handleAction("templates"))} disabled={!window.editorAPI}>{ui("工程模板…", "Project templates…")}</button>
                <button onClick={() => { setFileMenu(false); setModal("package"); }}>{t("toolbar.collectAssets")}</button>
                <button onClick={() => void safe(() => importDraft("file"))}>
                  {t("toolbar.importCapcutFile")}<span>{t("toolbar.experimental")}</span>
                </button>
                <button onClick={() => void safe(() => importDraft("directory"))}>
                  {t("toolbar.importCapcutFolder")}<span>{t("toolbar.experimental")}</span>
                </button>
              </div>
            )}
          </div>
          <button onClick={() => setModal("shortcuts")}>{t("toolbar.shortcuts")}</button>
        </div>
        <div className="project-title">
          <input
            aria-label={t("toolbar.projectName.aria")}
            value={s.project.name}
            onFocus={() => s.beginTransaction()}
            onBlur={() => s.endTransaction()}
            onChange={(e) => s.updateProject({ name: e.target.value })}
          />
          <span
            title={s.dirty ? t("toolbar.dirty") : t("toolbar.saved")}
            className={`save-dot ${s.dirty ? "dirty" : ""}`}
          />
        </div>
        <div className="titlebar-actions">
          <button aria-label={t("toolbar.assistant.aria")} className={assistantOpen ? "active" : ""} onClick={() => setAssistantOpen(!assistantOpen)}><MessageSquare size={15} />{t("toolbar.assistant")}</button>
          <span className="offline-pill">
            <CloudOff size={12} />
            {t("toolbar.offline")}
          </span>
          <button
            title={t("toolbar.saveProject.title")}
            aria-label={t("toolbar.saveProject.aria")}
            onClick={() => void safe(() => save())}
          >
            <Save size={16} />
          </button>
          <button
            title={ui("设置 / Settings · 语言 / Language", "Settings · Language")}
            aria-label={ui("设置 / Settings", "Settings")}
            onClick={() => setModal("settings")}
          >
            <Settings2 size={16} /><span>{ui("设置 / Settings", "Settings")}</span>
          </button>
          <button
            className="primary export-button"
            onClick={() => {
              s.setPlaying(false);
              setModal("export");
            }}
          >
            <Upload size={15} />
            {t("toolbar.export")}
          </button>
        </div>
      </header>
      <EditorWorkspace assistantOpen={assistantOpen}>
        <section className="resource-panel panel">
          <nav className="resource-tabs">
            {[
              ["素材", Video],
              ["音频", Music2],
              ["文本", Type],
              ["贴纸", Shapes],
              ["特效", WandSparkles],
              ["转场", Sparkles],
              ["字幕", Subtitles],
            ].map(([label, Icon]) => (
              <button
                key={label as string}
                className={tab === label ? "active" : ""}
                onClick={() => setTab(label as string)}
              >
                {typeof Icon !== "string" && <Icon size={19} />}
                <span>{ui(label as string, ({ 素材: "Media", 音频: "Audio", 文本: "Text", 贴纸: "Stickers", 特效: "Effects", 转场: "Transitions", 字幕: "Captions" } as Record<string, string>)[label as string])}</span>
              </button>
            ))}
          </nav>
          <div className="resource-body">
            {tab === "贴纸" && <AssetLibrary onAdd={addBuiltin} addingId={addingBuiltin} />}
            {(tab === "素材" || tab === "音频") && (
              <MediaLibrary
                project={
                  tab === "音频"
                    ? {
                        ...s.project,
                        assets: s.project.assets.filter(
                          (a) => a.kind === "audio",
                        ),
                      }
                    : s.project
                }
                onImport={(paths) => void safe(() => importMedia(paths))}
                onPreviewAsset={(assetId) => { s.setPlaying(false); setSourceAssetId(assetId); }}
                onAddAsset={(assetId) => { setSourceAssetId(null); s.addAssetClip(assetId); }}
                onRemoveAsset={(assetId) =>
                  void safe(() => s.removeAsset(assetId))
                }
                importing={importing}
                onImportFiles={(files) =>
                  void safe(async () => s.addAssets(await browserAssets(files)))
                }
                onRevealAsset={(assetId) =>
                  void safe(() => {
                    const asset = s.project.assets.find(
                      (a) => a.id === assetId,
                    );
                    if (asset?.missing) return relink(asset);
                    if (asset && window.editorAPI)
                      return window.editorAPI.revealPath(asset.path);
                  })
                }
              />
            )}
            {tab === "文本" && <TextLibrary onAdd={addStyledText} onBlank={s.addText} />}
            {tab === "字幕" && <SubtitlePanel onSpeech={setSpeechMode} onImport={() => safe(readSubtitles)} onExport={() => safe(exportSubtitles)} />}
            {tab === "特效" && (
              <EffectsPanel
                clip={active}
                project={s.project}
                kind={activeTrack?.kind}
                locked={activeTrack?.locked}
                onApply={(patch) => {
                  if (active) s.updateClip(active.id, patch);
                  else notify(ui("先选择一个时间线片段", "Select a timeline clip first"));
                }}
              />
            )}
            {tab === "转场" && <TransitionLibrary
              disabled={!active || !!active.text || activeTrack?.kind === "audio" || !!activeTrack?.locked}
              onApply={(transition,seconds)=>void safe(()=>applySceneTransition(transition,seconds))}
            />}
          </div>
        </section>
        {sourceAsset ? <SourcePreview
          asset={sourceAsset}
          fps={s.project.fps}
          tracks={s.project.tracks.filter(t => t.kind === sourceAsset.kind || (sourceAsset.kind === "image" && t.kind === "video"))}
          onClose={() => setSourceAssetId(null)}
          onAddRange={(sourceIn, duration, mode, trackId) => void safe(() => {
            s.placeAsset(sourceAsset.id, trackId, { sourceIn, duration }, mode ?? "insert");
            setSourceAssetId(null);
          })}
        /> : <Player
          project={s.project}
          selectedIds={s.selectedIds}
          playhead={s.playhead}
          playing={s.playing}
          onSelect={s.select}
          onUpdateClip={s.updateClip}
          onSeek={s.seek}
          onPlayingChange={s.setPlaying}
        />}
        {assistantOpen ? <AssistantPanel onClose={() => setAssistantOpen(false)} /> : <Inspector
          project={s.project}
          clip={active}
          playhead={s.playhead}
          onUpdate={(patch) => active && s.updateClip(active.id, patch)}
          onProjectUpdate={s.updateProject}
        />}
      </EditorWorkspace>
      <div className="timeline-pane">
        <div
          className="timeline-resize"
          role="separator"
          tabIndex={0}
          aria-label={ui("调整时间线高度", "Resize timeline height")}
          aria-orientation="horizontal"
          aria-valuenow={Math.round(timelineHeight)}
          aria-valuemin={190}
          aria-valuemax={Math.max(190, window.innerHeight - 290)}
          title={ui("拖动调整时间线高度", "Drag to resize the timeline")}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              resizeTimeline(
                timelineHeight + (event.key === "ArrowUp" ? 20 : -20),
              );
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            timelineResize.current = {
              y: event.clientY,
              height: timelineHeight,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = timelineResize.current;
            if (drag) resizeTimeline(drag.height + drag.y - event.clientY);
          }}
          onPointerUp={(event) => {
            timelineResize.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            timelineResize.current = null;
          }}
        />
        <Timeline
          project={s.project}
          selectedIds={s.selectedIds}
          playhead={s.playhead}
          playing={s.playing}
          zoom={s.zoom}
          onSeek={(time) => { setSourceAssetId(null); s.seek(time); }}
          onSelect={(ids) => { setSourceAssetId(null); s.select(ids); }}
          onClipUpdate={s.updateClip}
          onMoveClips={s.moveClips}
          onTrim={s.trim}
          onSplit={s.split}
          onDelete={() => void safe(s.deleteSelected)}
          onZoom={s.setZoom}
          onTrackUpdate={s.updateTrack}
          onTrackDelete={s.deleteTrack}
          onTrackMove={s.reorderTrack}
          onAddTrack={s.addTrack}
          onDropAsset={(assetId, time, trackId) => {
            setSourceAssetId(null); s.addAssetClip(assetId, time, trackId);
          }}
          snapping={s.snapping}
          onSnappingChange={s.setSnapping}
          magnetic={s.magnetic}
          onMagneticChange={s.setMagnetic}
          onDuplicate={s.duplicate}
          onAddText={s.addText}
          onUndo={s.undo}
          onRedo={s.redo}
          canUndo={s.past.length > 0}
          canRedo={s.future.length > 0}
        />
      </div>
      <footer className="app-status">
        <span>
          <span className="status-dot" />{" "}
              {t("toolbar.statusBar.summary", {
                platform: window.editorAPI ? t("toolbar.statusBar.desktop") : t("toolbar.statusBar.browser"),
                assets: s.project.assets.length,
                clips: s.project.clips.length,
              })}
        </span>
        <div>
          {active && s.project.assets.find(a => a.id === active.assetId)?.kind === "video" && <>
            <button disabled={activeTrack?.locked} onClick={() => { s.setPlaying(false); setModal("reverse"); }}>{ui("倒放", "Reverse")}</button>
            <button disabled={activeTrack?.locked} onClick={() => { s.setPlaying(false); setModal("freeze"); }}>{ui("定格", "Freeze frame")}</button>
          </>}
          {active?.linkId && <button onClick={() => { s.unlinkSelected(); }} disabled={s.project.clips.some(c => c.linkId === active.linkId && s.project.tracks.find(t => t.id === c.trackId)?.locked)}>{ui("解除画声关联", "Unlink video and audio")}</button>}
          {active?.assetId &&
            s.project.assets.find((a) => a.id === active.assetId)?.kind === "video" &&
            s.project.assets.find((a) => a.id === active.assetId)?.hasAudio && !active.linkId && (
              <button onClick={() => void safe(detachAudio)}>{ui("分离音频", "Detach audio")}</button>
            )}
          {s.project.assets.some((a) => a.missing) && (
            <button
              onClick={() =>
                void safe(() =>
                  relink(s.project.assets.find((a) => a.missing)!),
                )
              }
            >
              {ui("重新链接丢失素材", "Relink missing media")}</button>
          )}
          <span>{s.dirty ? t("toolbar.status.dirty") : t("toolbar.status.ready")}</span>
          <button title={t("toolbar.recentProjects")} onClick={() => setModal("settings")}>
            <FolderOpen size={12} />
          </button>
        </div>
      </footer>
      {toast && (
        <div role="status" className="toast">
          <Info size={16} />
          <span>{localizeMessage(toast, language)}</span>
          <button aria-label={ui("关闭提示", "Dismiss notification")} onClick={() => setToast("")}>
            <X size={13} />
          </button>
        </div>
      )}
      {speechMode && <SpeechDialog mode={speechMode} onClose={() => setSpeechMode(null)} />}
      {(modal === "reverse" || modal === "freeze") && <DerivativeDialog mode={modal} onClose={() => setModal(null)} />}
      {modal === "templates" && <TemplateDialog onClose={() => setModal(null)} onCreate={(base, replaced) => {
        if (!confirmReplace()) return false;
        const store=useEditorStore.getState(); store.setProject(base); store.commit(replaced);
        useEditorStore.setState({dirty:true}); return true;
      }} />}
      {modal === "package" && <PackageDialog project={clone(s.project)} onClose={() => setModal(null)} />}
      {modal === "export" && (
        <ExportDialog
          project={s.project}
          selectedIds={s.selectedIds}
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}
      {modal === "capcut" && capcutImport && (
        <ModalShell title={ui("选择剪映时间线", "Choose a CapCut timeline")} onClose={cancelCapcutImport}>
          <div className="modal-body">
            <p>
              <strong>{capcutImport.selection.name}</strong>{" "}
              {ui("包含多条时间线，请选择要导入的内容。", "contains multiple timelines. Choose one to import.")}</p>
            <label>
              {ui("时间线", "Timeline")}<select
                aria-label={ui("剪映时间线", "CapCut timeline")}
                value={capcutTimelineId}
                disabled={capcutBusy}
                onChange={(event) => setCapcutTimelineId(event.target.value)}
              >
                {capcutImport.selection.timelines.map((timeline) => (
                  <option key={timeline.id} value={timeline.id}>
                    {timeline.name}
                    {timeline.isActive ? ui(" · 当前编辑", " · Currently editing") : ""}
                    {timeline.isMain ? ui(" · 主时间线", " · Main timeline") : ""}
                  </option>
                ))}
              </select>
            </label>
            {capcutImport.selection.warnings.map((warning) => (
              <p className="muted" key={warning}>
                {localizeMessage(warning, language)}
              </p>
            ))}
            <p className="muted">{ui("导入后请核对画面、文字和效果。", "Review video, text and effects after importing.")}</p>
          </div>
          <footer>
            <button disabled={capcutBusy} onClick={cancelCapcutImport}>
              {ui("取消", "Cancel")}</button>
            <button
              className="primary"
              disabled={capcutBusy || !capcutTimelineId}
              onClick={() =>
                void safe(() =>
                  finishCapcutImport(capcutImport, capcutTimelineId),
                )
              }
            >
              {capcutBusy ? ui("正在导入…", "Importing…") : ui("导入所选时间线", "Import selected timeline")}
            </button>
          </footer>
        </ModalShell>
      )}
      {modal === "shortcuts" && (
        <ModalShell title={t("shortcuts.title")} onClose={() => setModal(null)}>
          <div className="shortcut-list">
            {shortcuts.map(([action, keys]) => (
              <div key={action}>
                <span>{t(action)}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
          <footer>
            <span className="muted small">
              {t("shortcuts.windowsHint")}
            </span>
            <button className="primary" onClick={() => setModal(null)}>
              {t("dialog.ok")}
            </button>
          </footer>
        </ModalShell>
      )}
      {modal === "about" && (
        <ModalShell title={ui("关于 ReaCut", "About ReaCut")} onClose={() => setModal(null)}>
          <div className="about-body">
            <div className="about-logo">
              <img src="./icons/reacut.png" width="58" height="58" alt={ui("ReaCut 图标", "ReaCut icon")} />
            </div>
            <h2>ReaCut · 映刻</h2>
            <span>{appVersion} {ui("· 独立开源桌面视频编辑器", " · Independent open-source desktop video editor")}</span>
            <p>
              {ui("利用 REA 研究可观察的剪辑流程，以独立代码实现离线编辑。核心源码采用 MIT 许可证。macOS 安装包内置 FFmpeg / FFprobe 与 x264（GPL-2.0-or-later），对应源码、构建脚本及许可文件位于应用资源的 media-tools 目录。", "ReaCut uses REA to study observable editing workflows and independently implements offline editing. Core source code is MIT licensed. The macOS app bundles FFmpeg / FFprobe and x264 (GPL-2.0-or-later); corresponding source, build scripts and licenses are in the application resources' media-tools directory.")}</p>
            <p className="muted">
              {ui("非剪映官方产品。不包含剪映的专有代码、库或素材。", "Not an official CapCut product. Contains no proprietary CapCut code, libraries or assets.")}</p>
          </div>
          <footer>
            <button className="primary" onClick={() => setModal(null)}>
              {ui("关闭", "Close")}</button>
          </footer>
        </ModalShell>
      )}
      {modal === "updates" && <UpdateDialog autoCheck onClose={() => setModal(null)} />}
      {modal === "settings" && (
        <ModalShell title={t("settings.title")} onClose={() => setModal(null)}>
          <div className="modal-body">
          <h3>{ui("应用更新", "Application updates")}</h3>
          <p className="muted small">{ui("预览通道 · 仅点击后连接 GitHub，不自动安装。", "Preview channel · Connects to GitHub only on request. No automatic installation.")}</p>
          <button onClick={() => setModal("updates")}>{ui("检查更新", "Check for Updates")}</button>
          <h3>{ui("语言 / Language", t("settings.language"))}</h3>
              <p className="muted small">{t("settings.language.description")}</p>
              <select
                aria-label={ui("语言 / Language", t("settings.language"))}
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                style={{ marginTop: "0.5rem", marginBottom: "1rem" }}
              >
                <option value="zh-CN">{t("settings.language.zh-CN")}</option>
                <option value="en">{t("settings.language.en")}</option>
                <option value="tr">{t("settings.language.tr")}</option>
              </select>
            <div className={`engine-status ${system.ffmpeg ? "ready" : ""}`}>
              {system.ffmpeg ? <CheckCircle2 size={18} /> : <Info size={18} />}
              <div>
                <strong>
                  {system.ffmpeg ? t("settings.engine.ready") : t("settings.engine.missing")}
                </strong>
                <span>
                  {system.ffmpegVersion ?? t("settings.engine.hint")}
                </span>
              </div>
            </div>
            <p className="muted small">
              {system.ffmpegPath ?? t("settings.engine.bundledHint")}
            </p>
            <div className="button-row">
              <button
                onClick={() =>
                  void safe(async () => {
                    await window.editorAPI?.chooseMediaTool("ffmpeg");
                    await refreshSystem();
                  })
                }
              >
                {t("settings.engine.chooseFfmpeg")}
              </button>
              <button
                onClick={() =>
                  void safe(async () => {
                    await window.editorAPI?.chooseMediaTool("ffprobe");
                    await refreshSystem();
                  })
                }
              >
                {t("settings.engine.chooseFfprobe")}
              </button>
            </div>
            <h3>{t("settings.recentProjects")}</h3>
            {recent.length === 0 ? (
              <p className="muted small">{t("settings.recentProjects.empty")}</p>
            ) : (
              <div className="recent-list">
                {recent.map((p) => (
                  <button
                    key={p.path}
                    onClick={() =>
                      void safe(async () => {
                        if (!confirmReplace()) return;
                        const result =
                          await window.editorAPI?.openRecentProject(p.path);
                        if (result) {
                          s.setProject(result.project, result.path);
                          setModal(null);
                        }
                      })
                    }
                  >
                    <FolderOpen size={16} />
                    <div>
                      <strong>{p.name}</strong>
                      <span>{p.path}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="future-feature">
              <CloudOff size={16} />
              <div>
                <strong>{t("settings.futureFeatures.title")}</strong>
                <p>{t("settings.futureFeatures.description")}</p>
              </div>
            </div>
          </div>
          <footer>
            <button onClick={() => setModal("about")}>{t("settings.about")}</button>
            <button className="primary" onClick={() => setModal(null)}>
              {t("settings.done")}
            </button>
          </footer>
        </ModalShell>
      )}
      {recover && (
        <ModalShell
          title={ui("恢复上次编辑", "Recover previous edits")}
          onClose={() => {
            setRecover(null);
          }}
        >
          <div className="modal-body">
            <p>
              {ui("发现本机自动保存的项目", "Found a locally autosaved project: ")}<strong>{recover.name}</strong>{ui("，包含", " with ")}{" "}
              {recover.clips.length} {ui("个片段。", " clips.")}</p>
            <p className="muted">{ui("恢复后可继续编辑，并另存为项目文件。", "Recover to continue editing, then save as a project file.")}</p>
          </div>
          <footer>
            <button onClick={() => setRecover(null)}>{ui("新建空项目", "Start a blank project")}</button>
            <button
              className="primary"
              onClick={() => {
                s.setProject(recover);
                setRecover(null);
                notify(ui("已恢复上次编辑", "Previous edits recovered"));
              }}
            >
              {ui("恢复项目", "Recover project")}</button>
          </footer>
        </ModalShell>
      )}
      <input
        ref={subtitleInput}
        type="file"
        style={{ display: "none" }}
        accept={subtitleAction === "draft" ? ".json" : ".srt,.vtt"}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            void safe(async () => {
              const text = await file.text();
              if (subtitleAction === "draft") {
                const imported = importCapcutDraft(text);
                s.setProject(imported.project);
                notify(imported.warnings.join(" "));
              } else {
                const cues = parseSubtitles(text);
                if (!cues.length) throw new Error(ui("字幕文件没有有效字幕", "The subtitle file contains no valid captions"));
                s.addSubtitles(cues);
              }
            });
          e.target.value = "";
        }}
      />
    </div>
  );
  async function relink(asset: MediaAsset) {
    if (!window.editorAPI) return;
    const projectId = useEditorStore.getState().project.id;
    const result = await window.editorAPI.relinkAsset(asset);
    if (!result) return;
    // A separated audio layer still references the same video source. Relink every
    // reference together, preserving its role and identity within the project.
    let source = result;
    if (
      result.kind === "audio" &&
      useEditorStore
        .getState()
        .project.assets.some((a) => a.path === asset.path && a.kind === "video")
    )
      source = (await window.editorAPI.importMedia([result.path]))[0] ?? result;
    const current = useEditorStore.getState();
    if (current.project.id !== projectId) return;
    if (current.project.assets.some((a) => a.id === asset.id))
      current.commit({
        ...current.project,
        assets: current.project.assets.map((a) =>
          a.path === asset.path
            ? {
                ...source,
                id: a.id,
                name: a.name,
                kind: a.kind,
                ...(a.kind === "audio"
                  ? { width: 0, height: 0, thumbnail: undefined }
                  : {}),
              }
            : a,
        ),
      });
  }
}
