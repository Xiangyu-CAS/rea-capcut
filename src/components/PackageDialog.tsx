import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { ExportProgress, Project } from "../core/types";
import { FolderOpen, Package, X } from "lucide-react";
export default function PackageDialog({ project, onClose }: { project: Project; onClose(): void }) {
  const ui = useUITranslation();
  const [progress, setProgress] = useState<ExportProgress | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const job = useRef<string | null>(null);
  const alive = useRef(true), requested = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.editorAPI?.onPackageProgress(event => {
    if (!requested.current) return;
    if (job.current && job.current !== event.jobId) return;
    setProgress(event);
    if (["complete", "error", "cancelled"].includes(event.status)) { requested.current = false; setBusy(false); if (event.status === "error") setError(event.message ?? ui("打包失败", "Packaging failed")); }
    });
    return () => { alive.current = false; unsubscribe?.(); if (requested.current && job.current) void window.editorAPI?.cancelPackage(job.current); };
  }, []);
  const start = async () => {
    if (!window.editorAPI) { setError(ui("收集项目素材需要桌面版", "Collecting project assets requires the desktop app")); return; }
    if (requested.current) return;
    requested.current = true;
    setBusy(true); setError(""); setProgress(null); job.current = null;
    try {
      const result = await window.editorAPI.packageProject(project);
      if (!alive.current) { if (result) void window.editorAPI.cancelPackage(result.jobId); return; }
      if (result) { job.current = result.jobId; setProgress(current => current ?? { jobId: result.jobId, status: "preparing", progress: 0, message: ui("正在检查素材", "Checking assets") }); }
      else { requested.current = false; setBusy(false); }
    }
    catch (e) { requested.current = false; if (alive.current) { setBusy(false); setError(String(e)); } }
  };
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={ui("收集项目素材", "Collect project assets")}><header><h2><Package size={18} /> {ui("收集项目素材", "Collect project assets")}</h2><button aria-label={ui("关闭素材打包", "Close asset packaging")} disabled={busy} onClick={onClose}><X size={18} /></button></header><div className="modal-body"><h3>{project.name}</h3><p>{ui(`将项目和 ${project.assets.length} 项原始素材复制到一个新文件夹，移动整个文件夹后仍可打开编辑。`, `Copy the project and ${project.assets.length} original assets to a new folder. Move the whole folder to continue editing elsewhere.`)}</p><p className="muted small">{ui("包含媒体库中的全部素材，共用文件只复制一份。原项目和素材保持原位；预览缓存不打包。自定义系统字体需在目标电脑安装。", "Includes all library assets, copying shared files only once. The original project and assets stay in place; preview caches are excluded. Install custom system fonts on the destination computer.")}</p>{progress && <div className="export-progress"><p>{progress.status === "complete" ? ui("素材包已完成", "Asset package complete") : progress.status === "cancelled" ? ui("已取消打包", "Packaging cancelled") : localizeMessage(progress.message ?? "")}</p><progress max={1} value={progress.progress} /><p>{Math.round(progress.progress * 100)}%</p></div>}{error && <p role="alert" className="inline-warning">{localizeMessage(error) }</p>}</div><footer>{busy ? <button disabled={!job.current} onClick={() => { if (job.current) void window.editorAPI?.cancelPackage(job.current); }}>{ui("取消打包", "Cancel packaging")}</button> : progress?.status === "complete" ? <><button onClick={() => void window.editorAPI?.revealPath(progress.path!)}><FolderOpen size={15}/>{ui("显示素材包", "Show asset package")}</button><button className="primary" onClick={onClose}>{ui("完成", "Done")}</button></> : <><button onClick={onClose}>{ui("取消", "Cancel")}</button><button className="primary" onClick={() => void start()}>{ui("选择文件夹并打包", "Choose folder and collect")}</button></>}</footer></section></div>;
}
