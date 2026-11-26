import { App } from "@modelcontextprotocol/ext-apps";
import { Download, FolderOpen, Layers3, MoreHorizontal, Plus, Save, SlidersHorizontal, Type, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Inspector from "../../src/components/Inspector";
import MediaLibrary from "../../src/components/MediaLibrary";
import Player from "../../src/components/Player";
import SourcePreview from "../../src/components/SourcePreview";
import Timeline from "../../src/components/Timeline";
import TimelineTabs from "../../src/components/TimelineTabs";
import type { PanelCommandOptions, PanelFileAction, PanelSnapshot } from "../../src/core/pluginPanel";
import { projectDuration } from "../../src/core/model";
import { useEditorStore } from "../../src/editor/store";
import { useLanguageStore, useUITranslation } from "../../src/i18n";
import { connectEditor } from "./session";
import { usePanelMedia } from "./media";
import "../../src/styles.css";
import "./editor.css";

const host = new App({ name: "ReaCut", version: "0.9.1" }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: false });
type EditorSession = ReturnType<typeof connectEditor>;

function EditorPanel() {
  const ui = useUITranslation();
  const language = useLanguageStore(state => state.language);
  const [snapshot, setSnapshot] = useState<PanelSnapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<PanelFileAction>();
  const [workspaceVersion, resetWorkspace] = useState(0);
  const session = useRef<EditorSession>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const running = useRef(false);
  const name = useEditorStore(state => state.project.name);
  const duration = useEditorStore(state => projectDuration(state.project));
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    const report = (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure));
    host.ontoolresult = () => {};
    host.onteardown = async () => {
      await session.current?.close();
      return {};
    };
    void host.connect().then(() => {
      session.current = connectEditor(host, setSnapshot, report);
      const context = host.getHostContext();
      if (context?.displayMode !== "fullscreen" && (!context?.availableDisplayModes || context.availableDisplayModes.includes("fullscreen")))
        void host.requestDisplayMode({ mode: "fullscreen" }).catch(() => {});
    }).catch(report);
  }, []);

  async function run(action: PanelFileAction, options?: PanelCommandOptions) {
    if (!session.current || running.current) return;
    running.current = true;
    setError("");
    if (menu.current) menu.current.open = false;
    setBusy(action);
    try {
      await session.current.command(action, options);
      if (action === "open" || action === "new") resetWorkspace(version => version + 1);
    } catch {
      // Session reports the error and reloads authoritative state when needed.
    } finally {
      running.current = false;
      setBusy(undefined);
    }
  }

  const exporting = snapshot?.export?.status === "preparing" || snapshot?.export?.status === "rendering";
  return <div className="reacut-panel"
    onCompositionStartCapture={() => session.current?.setComposing(true)}
    onCompositionEndCapture={() => session.current?.setComposing(false)}>
    <header className="reacut-toolbar">
      <div className="reacut-title">
        <strong>ReaCut</strong>
        {snapshot?.ready && <span title={name}>{name}{snapshot.dirty ? " •" : ""}</span>}
      </div>
      <div className="reacut-actions">
        <button disabled={!snapshot?.ready || !!busy} onClick={() => void run("import")} title={ui("导入素材", "Import media")} aria-label={ui("导入素材", "Import media")}><Plus size={15} /><span>{ui("导入", "Import")}</span></button>
        <button disabled={!snapshot?.ready || !!busy} onClick={() => void run("open")} title={ui("打开项目", "Open project")} aria-label={ui("打开项目", "Open project")}><FolderOpen size={15} /><span>{ui("打开", "Open")}</span></button>
        <button disabled={!snapshot?.ready || !!busy} onClick={() => void run("save")} title={ui("保存项目", "Save project")} aria-label={ui("保存项目", "Save project")}><Save size={15} /><span>{ui("保存", "Save")}</span></button>
        <button className="primary" disabled={!snapshot?.ready || !!busy || !duration || exporting} onClick={() => void run("export")} title={ui("导出 MP4", "Export MP4")} aria-label={ui("导出 MP4", "Export MP4")}><Download size={15} />{ui("导出", "Export")}</button>
        <details ref={menu} className="reacut-overflow">
          <summary title={ui("项目菜单", "Project menu")} aria-label={ui("项目菜单", "Project menu")}><MoreHorizontal size={17} /></summary>
          <div>
            <button disabled={!snapshot?.ready || !!busy} onClick={() => void run("new")}>{ui("新建项目", "New project")}</button>
            <button disabled={!snapshot?.ready || !!busy || !duration || exporting} onClick={() => void run("export", { format: "mov" })}>{ui("导出 MOV", "Export MOV")}</button>
            <button disabled={!snapshot || !!busy} onClick={() => void run("desktop")}>{ui("显示桌面窗口", "Show desktop window")}</button>
          </div>
        </details>
      </div>
    </header>
    {error && <div className="reacut-message" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label={ui("关闭消息", "Dismiss message")}><X size={14} /></button></div>}
    {busy && ["import", "open", "save", "export"].includes(busy) && <div className="reacut-message" role="status">
      {ui("正在处理。请留意系统文件对话框。", "Working. Check for a system file dialog.")}</div>}
    {snapshot?.export && <div className="reacut-message" role="status">
      {exporting ? <>
        <span>{ui("正在导出", "Exporting")} {Math.round(snapshot.export.progress * 100)}%</span>
        <progress max={1} value={snapshot.export.progress} />
        <button disabled={!!busy} onClick={() => void run("cancelExport")}>{ui("取消", "Cancel")}</button>
      </> : <span>{snapshot.export.status === "complete" ? ui("导出完成", "Export complete")
        : snapshot.export.status === "cancelled" ? ui("已取消导出", "Export cancelled")
        : snapshot.export.message || ui("导出失败", "Export failed")}</span>}
    </div>}
    {snapshot?.ready ? <Workspace key={workspaceVersion} snapshot={snapshot} busy={!!busy}
      run={run} report={setError} onFrame={(time, playing) => session.current?.playbackFrame(time, playing)} />
      : <div className="reacut-loading" role="status">{snapshot
        ? <><span>{ui("请在桌面窗口完成项目恢复。", "Finish recovering the project in the desktop window.")}</span>
          <button onClick={() => void run("desktop")}>{ui("显示桌面窗口", "Show desktop window")}</button></>
        : ui("正在连接 ReaCut…", "Connecting to ReaCut…")}</div>}
  </div>;
}

function Workspace({ snapshot, busy, run, report, onFrame }: {
  snapshot: PanelSnapshot;
  busy: boolean;
  run: (action: PanelFileAction, options?: PanelCommandOptions) => Promise<void>;
  report: (message: string) => void;
  onFrame: (time: number, playing: boolean) => void;
}) {
  const ui = useUITranslation();
  const editor = useEditorStore();
  const [dock, setDock] = useState<"media" | "properties">("media");
  const [sourceId, setSourceId] = useState<string>();
  const activeClip = editor.project.clips.find(clip => clip.id === editor.selectedIds[0]);
  const plan = snapshot.plan;
  const [preview, setPreview] = useState({ playhead: 0, playing: false });
  const planProject = plan?.project;
  const viewProject = planProject ?? editor.project;
  const media = usePanelMedia(host, viewProject, planProject ? preview.playhead : editor.playhead, sourceId);
  const source = media.playable.find(asset => asset.id === sourceId);
  const agentAssetIds = new Set(editor.agentMedia.map(selection => selection.assetId));
  const safe = (action: () => void) => {
    try { action(); }
    catch (failure) { report(failure instanceof Error ? failure.message : String(failure)); }
  };

  useEffect(() => {
    if (activeClip?.text) setDock("properties");
  }, [activeClip?.id]);
  useEffect(() => {
    if (planProject) setPreview({ playhead: plan?.focus ?? 0, playing: false });
  }, [planProject?.id, plan?.id, !!planProject]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, summary, [contenteditable=true]"))) return;
      const current = useEditorStore.getState();
      const modifier = event.metaKey || event.ctrlKey;
      switch (modifier ? event.key.toLowerCase() : event.key) {
        case "s": if (!modifier) return; void run("save"); break;
        case "z": if (!modifier) return; void run(event.shiftKey ? "redo" : "undo"); break;
        case "y": if (!modifier) return; void run("redo"); break;
        case "b": if (!modifier) return; safe(current.split); break;
        case "c": if (!modifier) return; current.copy(); break;
        case "v": if (!modifier) return; safe(current.paste); break;
        case " ": if (sourceId || planProject) return; current.setPlaying(!current.playing); break;
        case "Delete":
        case "Backspace": safe(current.deleteSelected); break;
        default: return;
      }
      event.preventDefault();
    };
    if (!busy) window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [busy, run, sourceId, planProject, report]);

  const showTimeline = () => setSourceId(undefined);
  return <div className="reacut-workspace" inert={busy}>
    <div className="reacut-workbench" data-dock={dock}>
      <nav className="reacut-dock-tabs" aria-label={ui("编辑器面板", "Editor panels")}>
        <button aria-pressed={dock === "media"} onClick={() => setDock("media")}><Layers3 size={14} />{ui("素材", "Media")}</button>
        <button aria-pressed={dock === "properties"} onClick={() => setDock("properties")}><SlidersHorizontal size={14} />{ui("属性", "Properties")}</button>
      </nav>
      <div className="reacut-media-dock">
        <MediaLibrary project={{ ...editor.project, assets: media.assets }} importing={false}
          onImport={() => void run("import")}
          onAddAsset={id => { showTimeline(); editor.addAssetClip(id); }}
          onRemoveAsset={id => safe(() => editor.removeAsset(id))}
          agentAssetIds={agentAssetIds}
          onToggleAgentAsset={id => safe(() => agentAssetIds.has(id) ? editor.removeAgentMedia(id) : editor.attachAgentMedia({ assetId: id }))}
          onPreviewAsset={id => { editor.setPlaying(false); setSourceId(id); }} />
      </div>
      <div className="reacut-monitor">
        {planProject ? <Player key={plan?.id} project={{ ...planProject, assets: media.playable }} selectedIds={[]} {...preview}
          onSeek={playhead => setPreview({ playhead, playing: false })}
          onPlayingChange={playing => setPreview(current => ({ ...current, playing }))}
          onPlaybackFrame={(playhead, playing) => setPreview({ playhead, playing })}
          onClosePreview={() => void run("previewPlan")} />
          : source && !source.missing ? <SourcePreview asset={source} fps={editor.project.fps} tracks={editor.project.tracks}
            onUseInAgent={range => safe(() => editor.attachAgentMedia({ assetId: source.id, range }))}
            onClose={showTimeline} onAddRange={(sourceIn, duration, mode, trackId) => {
              safe(() => mode ? editor.placeAsset(source.id, trackId, { sourceIn, duration }, mode)
                : editor.addAssetClip(source.id, undefined, trackId, { sourceIn, duration }));
              showTimeline();
            }} />
          : <Player project={{ ...editor.project, assets: media.playable }}
              selectedIds={editor.selectedIds} playhead={editor.playhead} playing={editor.playing}
              onSeek={editor.seek} onUpdateClip={editor.updateClip} onPlayingChange={editor.setPlaying} onPlaybackFrame={onFrame} />}
        {(media.loading || media.failed) && <div className="reacut-media-status" role="status">
          {media.loading ? ui("正在加载预览…", "Loading preview…") : ui("此素材可在桌面窗口预览", "Preview this media in the desktop window")}
        </div>}
      </div>
      <div className="reacut-property-dock">
        <Inspector project={editor.project} clip={activeClip} playhead={editor.playhead}
          onUpdate={patch => { if (activeClip) editor.updateClip(activeClip.id, patch); }} onProjectUpdate={editor.updateProject} />
      </div>
    </div>
    {plan && (["pending", "applied", "undone"].includes(plan.status)) && <div className="reacut-plan">
      <span title={plan.descriptions.join("\n")}>{plan.status === "applied" ? ui("已应用助手编辑", "Assistant edits applied")
        : plan.status === "undone" ? ui("已撤销助手编辑", "Assistant edits undone")
        : plan.descriptions[0] || ui("待审阅的助手编辑", "Assistant edit to review")}</span>
      {plan.status === "pending" && <>
        <button onClick={() => { showTimeline(); void run("previewPlan", { planId: planProject ? undefined : plan.id }); }}>{planProject ? ui("返回", "Back") : ui("预览", "Preview")}</button>
        <button className="primary" onClick={() => { showTimeline(); void run("applyPlan", { planId: plan.id }); }}>{ui("应用", "Apply")}</button>
      </>}
    </div>}
    <section className="reacut-timeline" aria-label={ui("时间线", "Timeline")}>
      <div className="reacut-timeline-bar">
        <TimelineTabs key={editor.project.id} project={editor.project} onOpen={timelineId => { showTimeline(); void run("switchTimeline", { timelineId }); }}
          onCreate={(name, defaultName, duplicate) => safe(() => editor.createTimeline(name, defaultName, duplicate))} onRename={editor.renameTimeline} />
        <button onClick={() => { showTimeline(); editor.addText(); setDock("properties"); }}><Type size={15} />{ui("添加文字", "Add text")}</button>
      </div>
      <Timeline project={{ ...editor.project, assets: media.assets }} selectedIds={editor.selectedIds} playhead={editor.playhead}
        playing={editor.playing} zoom={editor.zoom} onSeek={time => { showTimeline(); editor.seek(time); }}
        onSelect={ids => { showTimeline(); editor.select(ids); }} onClipUpdate={editor.updateClip}
        onMoveClips={editor.moveClips} onTrim={editor.trim} onSplit={editor.split} onDelete={() => safe(editor.deleteSelected)}
        onZoom={editor.setZoom} onTrackUpdate={editor.updateTrack} onAddTrack={editor.addTrack}
        onTrackDelete={editor.deleteTrack} onTrackMove={editor.reorderTrack}
        onDropAsset={(id, time, trackId) => { showTimeline(); editor.addAssetClip(id, time, trackId); }}
        snapping={editor.snapping} onSnappingChange={editor.setSnapping} magnetic={editor.magnetic} onMagneticChange={editor.setMagnetic}
        onDuplicate={editor.duplicate}
        onUndo={() => void run("undo")} onRedo={() => void run("redo")} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} />
    </section>
  </div>;
}

createRoot(document.getElementById("root")!).render(<EditorPanel />);
