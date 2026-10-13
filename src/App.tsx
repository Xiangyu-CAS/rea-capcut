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
  createProject,
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
import Player from "./components/Player";
import Inspector from "./components/Inspector";
import "./styles.css";
type Modal = "package" | "export" | "settings" | "shortcuts" | "about" | "capcut" | null;
type PendingCapcutImport = {
  selection: CapcutImportSelection;
  capturedProject: Project;
};
const shortcuts = [
  ["播放 / 暂停", "Space"],
  ["分割片段", "⌘ / Ctrl + B"],
  ["删除片段", "Delete / Backspace"],
  ["撤销 / 重做", "⌘ + Z / ⇧ + ⌘ + Z"],
  ["复制 / 粘贴", "⌘ + C / ⌘ + V"],
  ["复制片段", "⌘ / Ctrl + D"],
  ["全选片段", "⌘ / Ctrl + A"],
  ["上一帧 / 下一帧", "← / →"],
  ["新建 / 打开 / 保存", "⌘ + N / O / S"],
  ["导入 / 导出", "⌘ + I / E"],
  ["时间线放大 / 缩小", "+ / −"],
  ["跳至开始 / 结束", "Home / End"],
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
          <button aria-label="关闭对话框" onClick={onClose}>
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
            if (event.status === "error") setError(event.message ?? "导出失败");
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
      setError("视频导出需要桌面版和本地 FFmpeg。");
      return;
    }
    try {
      setError("");
      if (scope === "selected" && !selectedRange) throw new Error("请先选择时间线片段");
      if (scope === "custom" && (!rangeStart.trim() || !rangeEnd.trim())) throw new Error("请填写区间起止时间");
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
      title="导出视频"
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
            {project.clips.length} 个片段
          </span>
        </div>
        <span className="export-badge">本地渲染</span>
      </div>
      <div className="modal-body">
        <label className="stacked-label">
          保存位置
          <div className="file-picker">
            <input
              aria-label="导出位置"
              readOnly
              value={options.path}
              placeholder="选择视频保存位置"
            />
            <button disabled={exporting} onClick={choose}>
              <FolderOpen size={16} />
            </button>
          </div>
        </label>
        <label className="stacked-label">导出范围
          <select aria-label="导出范围" value={scope} disabled={exporting} onChange={e => setScope(e.target.value)}>
            <option value="all">整个时间线</option><option value="selected" disabled={!selectedRange}>选中片段所在区间</option><option value="custom">自定义区间</option>
          </select>
        </label>
        {scope === "custom" && <div className="export-fields"><label>起点（秒）<input aria-label="区间起点" type="number" min="0" step={1 / project.fps} disabled={exporting} value={rangeStart} onChange={e => setRangeStart(e.target.value)} /></label><label>终点（秒）<input aria-label="区间终点" type="number" min="0" step={1 / project.fps} disabled={exporting} value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} /></label></div>}
        {scope === "selected" && selectedRange && <p className="field-hint">{selectedRange.start.toFixed(3)}–{selectedRange.end.toFixed(3)} 秒，包含该区间内所有可见画面和声音。</p>}
        <div className="export-fields">
          <label>
            分辨率
            <select
              aria-label="导出分辨率"
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
                原始 · {project.width}×{project.height}
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
            帧率
            <select
              aria-label="导出帧率"
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
            画质
            <select
              aria-label="导出画质"
              disabled={exporting}
              value={options.quality}
              onChange={(e) =>
                setOptions((p) => ({
                  ...p,
                  quality: e.target.value as ExportOptions["quality"],
                }))
              }
            >
              <option value="draft">草稿 · 更快</option>
              <option value="standard">标准 · 推荐</option>
              <option value="high">高画质</option>
            </select>
          </label>
          <label>
            格式
            <select
              aria-label="导出格式"
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
          导出原始素材和所有可见画面轨道，按音频设置混音。无需登录或上传。
        </p>
        {progress && (
          <div
            className={`export-progress ${status === "complete" ? "is-complete" : ""}`}
          >
            <div>
              <span>
                {status === "complete"
                  ? "导出完成"
                  : status === "cancelled"
                    ? "导出已取消"
                    : status === "preparing"
                      ? "正在准备素材"
                      : status === "error"
                        ? "导出失败"
                        : "正在渲染视频"}
              </span>
              <strong>{Math.round(progress.progress * 100)}%</strong>
            </div>
            <progress value={progress.progress} max={1} />
          </div>
        )}
        {error && (
          <div role="alert" className="inline-warning">
            {error}
          </div>
        )}
      </div>
      <footer>
        {exporting ? (
          <>
            <span className="muted">
              <LoaderCircle size={14} className="spin" />
              编辑会在本地渲染完成后继续
            </span>
            <button
              onClick={() => {
                if (job.current)
                  void window.editorAPI
                    ?.cancelExport(job.current)
                    .catch((error) => setError(String(error)));
              }}
            >
              取消导出
            </button>
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
              在访达中查看
            </button>
            <button className="primary" onClick={onClose}>
              <Check size={15} />
              完成
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose}>取消</button>
            <button
              className="primary"
              onClick={exportVideo}
              disabled={!project.clips.length}
            >
              <Download size={16} />
              开始导出
            </button>
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
        image.onerror = () => reject(new Error(`无法读取 ${file.name}`));
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
        element.onerror = () => reject(new Error(`无法读取 ${file.name}`));
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
  const s = useEditorStore();
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
    if (!window.editorAPI) throw new Error("添加内置素材需要桌面版");
    if (addingBuiltin) return;
    const projectId = useEditorStore.getState().project.id;
    setAddingBuiltin(definition.id);
    try {
      const imported = await window.editorAPI.importBuiltinAsset(definition.id);
      const state = useEditorStore.getState();
      if (state.project.id !== projectId) throw new Error("项目已切换，请重新添加素材");
      state.beginTransaction();
      try {
        state.addAssets([imported]);
        const latest = useEditorStore.getState();
        const asset = latest.project.assets.find(a => a.path === imported.path)!;
        const name = definition.category === "backgrounds" ? "内置背景" : definition.kind === "audio" ? "内置音效" : "内置装饰";
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
    setToast(message);
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
            `启动项目无法打开：${error instanceof Error ? error.message : String(error)}`,
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
        .catch((error) => notify(`自动保存失败：${String(error)}`));
    }, 1000);
    return () => clearTimeout(timer);
  }, [s.project, initialized, recover]);
  const confirmReplace = () =>
    !useEditorStore.getState().dirty ||
    window.confirm("当前项目有未保存修改，继续会关闭当前项目。建议先保存。");
  const importMedia = async (paths?: string[]) => {
    if (!window.editorAPI) {
      notify("浏览器预览可用拖拽文件导入。完整文件操作请运行桌面版。");
      return;
    }
    const projectId = useEditorStore.getState().project.id;
    setImporting(true);
    try {
      const assets = await window.editorAPI.importMedia(paths);
      if (useEditorStore.getState().project.id !== projectId) {
        notify("项目已切换，导入素材未加入新项目");
        return;
      }
      s.addAssets(assets);
      if (assets.length) notify(`已导入 ${assets.length} 个素材`);
    } finally {
      setImporting(false);
    }
  };
  const save = async (as = false) => {
    if (saving.current) {
      notify("项目正在保存，请稍候");
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
      notify("已下载项目 JSON。浏览器素材链接不支持跨会话恢复。");
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
        notify("原项目快照已保存");
        return false;
      }
      const unchanged = latest.project === captured;
      if (unchanged) latest.markSaved(file);
      else useEditorStore.setState({ path: file, dirty: true });
      notify(unchanged ? "项目已保存" : "当前快照已保存，后续编辑尚未保存");
      return unchanged;
    } finally {
      saving.current = false;
    }
  };
  const open = async () => {
    if (!confirmReplace()) return;
    if (!window.editorAPI) {
      notify("打开本地项目需要桌面版。");
      return;
    }
    const result = await window.editorAPI.openProject();
    if (result) s.setProject(result.project, result.path);
  };
  const newProject = () => {
    if (confirmReplace()) s.setProject(createProject());
  };
  const handleAction = async (action: string) => {
    // Native menu accelerators bypass DOM key handlers; keep modal workflows intact.
    if ((modal || recover) && action !== "save-and-close") return;
    setFileMenu(false);
    switch (action) {
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
      if (modal || recover) {
        if (e.key === "Escape" && modal !== "export" && modal !== "package") {
          setModal(null);
        }
        return;
      }
      const state = useEditorStore.getState(),
        modifier = e.metaKey || e.ctrlKey;
      let handled = true;
      if (modifier) {
        switch (e.key.toLowerCase()) {
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
            state.deleteSelected();
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
  }, [modal, recover, safe]);
  const addStyledText = (preset: number) => {
    s.addText();
    const state = useEditorStore.getState(),
      c = state.project.clips.find((c) => c.id === state.selectedIds[0])!;
    const styles = [
      {
        text: "让灵感，成为画面",
        fontSize: 80,
        bold: true,
        color: "#ffffff",
        background: "transparent",
        stroke: "#000000",
        strokeWidth: 2,
      },
      {
        text: "每一帧，都值得记录",
        fontSize: 52,
        bold: false,
        color: "#ffffff",
        background: "#11151c",
        stroke: "#000000",
        strokeWidth: 0,
      },
      {
        text: "REACUT",
        fontSize: 104,
        bold: true,
        color: "#47e6d5",
        background: "transparent",
        stroke: "#ffffff",
        strokeWidth: 0,
      },
      {
        text: "CHAPTER 01\n我的故事",
        fontSize: 66,
        bold: true,
        color: "#ffd69a",
        background: "transparent",
        stroke: "#17191f",
        strokeWidth: 1,
      },
    ];
    s.updateClip(c.id, {
      text: { ...c.text!, ...styles[preset] },
      name: styles[preset].text,
    });
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
    if (!cues.length) throw new Error("没有读取到有效的 SRT / VTT 字幕");
    s.addSubtitles(cues);
    notify(`已导入 ${cues.length} 条字幕`);
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
    if (!cues.length) throw new Error("项目没有文字或字幕");
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
          if (!probed) throw new Error("素材无法读取");
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
        notify("项目已切换，请在当前项目中重新导入剪映草稿。");
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
      notify("请先完成当前剪映项目的导入。");
      return;
    }
    if (!window.editorAPI && mode === "directory") {
      notify("导入剪映项目文件夹需要桌面版。");
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
    if (!active || !active.assetId) return;
    const asset = s.project.assets.find((a) => a.id === active.assetId);
    if (!asset?.hasAudio || asset.kind === "audio")
      throw new Error("请选择带声音的视频片段");
    if (activeTrack?.locked) throw new Error("请先解锁轨道");
    const audio = {
      ...asset,
      id: id(),
      kind: "audio" as const,
      name: asset.name + " · 音频",
      width: 0,
      height: 0,
      thumbnail: undefined,
      previewUrl: asset.previewUrl,
    };
    const track =
      s.project.tracks.find((t) => t.kind === "audio" && !t.locked) ??
      createTrack("audio", "分离音频");
    const clip = {
      ...clone(active),
      id: id(),
      assetId: audio.id,
      trackId: track.id,
      name: audio.name,
      keyframes: active.keyframes
        .filter((k) => k.property === "volume")
        .map((k) => ({ ...k, id: id() })),
    };
    s.commit({
      ...s.project,
      assets: [...s.project.assets, audio],
      tracks: s.project.tracks.includes(track)
        ? s.project.tracks
        : [...s.project.tracks, track],
      clips: [
        ...s.project.clips.map((c) =>
          c.id === active.id ? { ...c, muted: true } : c,
        ),
        clip,
      ],
    });
    s.select([clip.id]);
    notify("音频已分离到独立轨道");
  };
  const crossfade = () => {
    if (!active || active.text || activeTrack?.kind === "audio")
      throw new Error("请选择一个画面片段");
    if (activeTrack?.locked) throw new Error("请先解锁轨道");
    const next = s.project.clips
      .filter(
        (c) =>
          c.trackId === active.trackId &&
          c.start >= active.start + active.duration - 0.01,
      )
      .sort((a, b) => a.start - b.start)[0];
    if (!next) throw new Error("该片段后没有相邻画面片段");
    const overlap = Math.min(0.5, active.duration / 2, next.duration / 2);
    const newStart = active.start + active.duration - overlap;
    s.commit({
      ...s.project,
      clips: s.project.clips.map((c) =>
        c.id === next.id
          ? {
              ...c,
              start: newStart,
              fadeIn: overlap,
              audioFadeIn: overlap,
              videoFadeWindow: undefined,
              audioFadeWindow: undefined,
            }
          : c.id === active.id
            ? {
                ...c,
                fadeOut: 0,
                videoFadeWindow: c.videoFadeWindow
                  ? { ...c.videoFadeWindow, fadeOut: 0 }
                  : undefined,
                audioFadeOut: overlap,
                audioFadeWindow: undefined,
              }
            : c,
      ),
    });
    notify(`已添加 ${overlap.toFixed(2)} 秒叠化（后片段提前重叠）`);
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
              aria-label="文件菜单"
              onClick={() => setFileMenu(!fileMenu)}
            >
              文件
              <ChevronDown size={12} />
            </button>
            {fileMenu && (
              <div className="file-menu">
                {[
                  ["new", "新建项目", "⌘N"],
                  ["open", "打开项目", "⌘O"],
                  ["save", "保存项目", "⌘S"],
                  ["save-as", "另存为", "⇧⌘S"],
                  ["import", "导入素材", "⌘I"],
                  ["export", "导出视频", "⌘E"],
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
                <button onClick={() => { setFileMenu(false); setModal("package"); }}>收集项目素材…</button>
                <button onClick={() => void safe(() => importDraft("file"))}>
                  导入剪映草稿文件<span>实验性</span>
                </button>
                <button
                  onClick={() => void safe(() => importDraft("directory"))}
                >
                  导入剪映项目文件夹<span>实验性</span>
                </button>
              </div>
            )}
          </div>
          <button onClick={() => setModal("shortcuts")}>快捷键</button>
        </div>
        <div className="project-title">
          <input
            aria-label="项目名称"
            value={s.project.name}
            onFocus={() => s.beginTransaction()}
            onBlur={() => s.endTransaction()}
            onChange={(e) => s.updateProject({ name: e.target.value })}
          />
          <span
            title={s.dirty ? "有未保存修改" : "已保存"}
            className={`save-dot ${s.dirty ? "dirty" : ""}`}
          />
        </div>
        <div className="titlebar-actions">
          <button aria-label="剪辑助手" className={assistantOpen ? "active" : ""} onClick={() => setAssistantOpen(!assistantOpen)}><MessageSquare size={15} />助手</button>
          <span className="offline-pill">
            <CloudOff size={12} />
            离线创作
          </span>
          <button
            title="保存项目 ⌘S"
            aria-label="保存项目"
            onClick={() => void safe(() => save())}
          >
            <Save size={16} />
          </button>
          <button
            title="设置"
            aria-label="设置"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={16} />
          </button>
          <button
            className="primary export-button"
            onClick={() => {
              s.setPlaying(false);
              setModal("export");
            }}
          >
            <Upload size={15} />
            导出
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
                <span>{label as string}</span>
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
            {tab === "文本" && (
              <div className="resource-content">
                <div className="resource-section-heading">
                  <h3>本地文字</h3>
                  <button className="small-button" onClick={s.addText}>
                    <Type size={13} />
                    添加文本
                  </button>
                </div>
                <p className="muted small">
                  添加文字图层，在属性面板编辑内容与样式。
                </p>
                <div className="text-templates">
                  {["经典标题", "字幕底条", "霓虹标记", "章节标题"].map(
                    (name, i) => (
                      <button key={name} onClick={() => addStyledText(i)}>
                        <div className={`text-template text-template-${i}`}>
                          {["Aa", "故事由此开始", "REACUT", "CHAPTER 01"][i]}
                        </div>
                        <span>{name}</span>
                      </button>
                    ),
                  )}
                </div>
              </div>
            )}
            {tab === "字幕" && <SubtitlePanel onImport={() => safe(readSubtitles)} onExport={() => safe(exportSubtitles)} />}
            {tab === "特效" && (
              <EffectsPanel
                clip={active}
                kind={activeTrack?.kind}
                locked={activeTrack?.locked}
                onApply={(patch) => {
                  if (active) s.updateClip(active.id, patch);
                  else notify("先选择一个时间线片段");
                }}
              />
            )}
            {tab === "转场" && (
              <div className="resource-content">
                <h3>画面衔接</h3>
                <p className="muted small">
                  选择前一个视频片段，转场会作用于同轨的下一段画面。
                </p>
                <button
                  className="transition-card"
                  onClick={() => void safe(crossfade)}
                >
                  <div className="dissolve-visual">
                    <span />
                    <span />
                  </div>
                  <strong>叠化</strong>
                  <span>通过重叠片段与透明度淡入衔接</span>
                </button>
                <button
                  className="transition-card"
                  onClick={() => {
                    if (active)
                      s.updateClip(active.id, {
                        fadeIn: Math.min(0.5, active.duration / 2),
                        fadeOut: Math.min(0.5, active.duration / 2),
                      });
                    else notify("先选择一个画面片段");
                  }}
                >
                  <div className="fade-visual" />
                  <strong>淡入淡出</strong>
                  <span>从画布背景进入与退出</span>
                </button>
              </div>
            )}
          </div>
        </section>
        {sourceAsset ? <SourcePreview
          asset={sourceAsset}
          fps={s.project.fps}
          onClose={() => setSourceAssetId(null)}
          onAddRange={(sourceIn, duration) => void safe(() => {
            s.addAssetClip(sourceAsset.id, s.playhead, undefined, { sourceIn, duration });
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
          aria-label="调整时间线高度"
          aria-orientation="horizontal"
          aria-valuenow={Math.round(timelineHeight)}
          aria-valuemin={190}
          aria-valuemax={Math.max(190, window.innerHeight - 290)}
          title="拖动调整时间线高度"
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
          onDelete={s.deleteSelected}
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
          {window.editorAPI ? "桌面版" : "浏览器预览"} ·{" "}
          {s.project.assets.length} 个素材 · {s.project.clips.length} 个片段
        </span>
        <div>
          {active?.assetId &&
            s.project.assets.find((a) => a.id === active.assetId)?.hasAudio && (
              <button onClick={() => void safe(detachAudio)}>分离音频</button>
            )}
          {s.project.assets.some((a) => a.missing) && (
            <button
              onClick={() =>
                void safe(() =>
                  relink(s.project.assets.find((a) => a.missing)!),
                )
              }
            >
              重新链接丢失素材
            </button>
          )}
          <span>{s.dirty ? "未保存 · 自动恢复已开启" : "项目就绪"}</span>
          <button title="最近项目" onClick={() => setModal("settings")}>
            <FolderOpen size={12} />
          </button>
        </div>
      </footer>
      {toast && (
        <div role="status" className="toast">
          <Info size={16} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={13} />
          </button>
        </div>
      )}
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
        <ModalShell title="选择剪映时间线" onClose={cancelCapcutImport}>
          <div className="modal-body">
            <p>
              <strong>{capcutImport.selection.name}</strong>{" "}
              包含多条时间线，请选择要导入的内容。
            </p>
            <label>
              时间线
              <select
                aria-label="剪映时间线"
                value={capcutTimelineId}
                disabled={capcutBusy}
                onChange={(event) => setCapcutTimelineId(event.target.value)}
              >
                {capcutImport.selection.timelines.map((timeline) => (
                  <option key={timeline.id} value={timeline.id}>
                    {timeline.name}
                    {timeline.isActive ? " · 当前编辑" : ""}
                    {timeline.isMain ? " · 主时间线" : ""}
                  </option>
                ))}
              </select>
            </label>
            {capcutImport.selection.warnings.map((warning) => (
              <p className="muted" key={warning}>
                {warning}
              </p>
            ))}
            <p className="muted">导入后请核对画面、文字和效果。</p>
          </div>
          <footer>
            <button disabled={capcutBusy} onClick={cancelCapcutImport}>
              取消
            </button>
            <button
              className="primary"
              disabled={capcutBusy || !capcutTimelineId}
              onClick={() =>
                void safe(() =>
                  finishCapcutImport(capcutImport, capcutTimelineId),
                )
              }
            >
              {capcutBusy ? "正在导入…" : "导入所选时间线"}
            </button>
          </footer>
        </ModalShell>
      )}
      {modal === "shortcuts" && (
        <ModalShell title="键盘快捷键" onClose={() => setModal(null)}>
          <div className="shortcut-list">
            {shortcuts.map(([action, keys]) => (
              <div key={action}>
                <span>{action}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
          <footer>
            <span className="muted small">
              Windows / Linux 使用 Ctrl 替代 ⌘
            </span>
            <button className="primary" onClick={() => setModal(null)}>
              知道了
            </button>
          </footer>
        </ModalShell>
      )}
      {modal === "about" && (
        <ModalShell title="关于 ReaCut" onClose={() => setModal(null)}>
          <div className="about-body">
            <div className="about-logo">
              <img src="./icons/reacut.png" width="58" height="58" alt="ReaCut 图标" />
            </div>
            <h2>ReaCut · 映刻</h2>
            <span>{appVersion} · 独立开源桌面视频编辑器</span>
            <p>
              利用 REA
              研究可观察的剪辑流程，以独立代码实现离线编辑。核心源码采用 MIT
              许可证。macOS 安装包内置 FFmpeg / FFprobe 与 x264（GPL-2.0-or-later），对应源码、构建脚本及许可文件位于应用资源的 media-tools 目录。
            </p>
            <p className="muted">
              非剪映官方产品。不包含剪映的专有代码、库或素材。
            </p>
          </div>
          <footer>
            <button className="primary" onClick={() => setModal(null)}>
              关闭
            </button>
          </footer>
        </ModalShell>
      )}
      {modal === "settings" && (
        <ModalShell title="设置与最近项目" onClose={() => setModal(null)}>
          <div className="modal-body">
            <h3>本地渲染引擎</h3>
            <div className={`engine-status ${system.ffmpeg ? "ready" : ""}`}>
              {system.ffmpeg ? <CheckCircle2 size={18} /> : <Info size={18} />}
              <div>
                <strong>
                  {system.ffmpeg ? "FFmpeg 已就绪" : "未找到 FFmpeg / FFprobe"}
                </strong>
                <span>
                  {system.ffmpegVersion ??
                    "请检查应用是否完整，或在此选择自定义 FFmpeg / FFprobe。"}
                </span>
              </div>
            </div>
            <p className="muted small">
              {system.ffmpegPath ?? "macOS 安装包默认使用内置引擎，无需另外安装。"}
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
                选择 FFmpeg
              </button>
              <button
                onClick={() =>
                  void safe(async () => {
                    await window.editorAPI?.chooseMediaTool("ffprobe");
                    await refreshSystem();
                  })
                }
              >
                选择 FFprobe
              </button>
            </div>
            <h3>最近项目</h3>
            {recent.length === 0 ? (
              <p className="muted small">保存或打开项目后会出现在这里。</p>
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
                <strong>云端与 API AI</strong>
                <p>尚未接入；此版本仅执行本地编辑。</p>
              </div>
            </div>
          </div>
          <footer>
            <button onClick={() => setModal("about")}>关于</button>
            <button className="primary" onClick={() => setModal(null)}>
              完成
            </button>
          </footer>
        </ModalShell>
      )}
      {recover && (
        <ModalShell
          title="恢复上次编辑"
          onClose={() => {
            setRecover(null);
          }}
        >
          <div className="modal-body">
            <p>
              发现本机自动保存的项目 <strong>{recover.name}</strong>，包含{" "}
              {recover.clips.length} 个片段。
            </p>
            <p className="muted">恢复后可继续编辑，并另存为项目文件。</p>
          </div>
          <footer>
            <button onClick={() => setRecover(null)}>新建空项目</button>
            <button
              className="primary"
              onClick={() => {
                s.setProject(recover);
                setRecover(null);
                notify("已恢复上次编辑");
              }}
            >
              恢复项目
            </button>
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
                if (!cues.length) throw new Error("字幕文件没有有效字幕");
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
