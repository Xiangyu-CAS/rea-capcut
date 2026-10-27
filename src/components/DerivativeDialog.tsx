import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DerivativeProgress, DerivativeRequest } from '../core/types';
import { applyDerivative, derivativePlan } from '../core/derivativeEdits';
import { useEditorStore } from '../editor/store';

export default function DerivativeDialog({ mode, onClose }: { mode: 'reverse' | 'freeze'; onClose(): void }) {
  const ui = useUITranslation();
  const [captured] = useState(() => {
    const s = useEditorStore.getState();
    return { project: s.project, clipId: s.selectedIds[0], time: s.playhead };
  });
  const [audio, setAudio] = useState<'reverse' | 'mute'>('reverse');
  const [duration, setDuration] = useState('2');
  const [progress, setProgress] = useState<DerivativeProgress | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const running = useRef<string | null>(null), alive = useRef(true), cancelled = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.editorAPI?.onDerivativeProgress(e => { if (e.jobId === running.current) setProgress(e); });
    return () => { alive.current = false; unsubscribe?.(); if (running.current) void window.editorAPI?.cancelDerivative(running.current); };
  }, []);
  const request: DerivativeRequest = { mode, audio, duration: Number(duration), time: captured.time };
  let preflight = '';
  try { derivativePlan(captured.project, captured.clipId, request); } catch (e) { preflight = (e as Error).message; }
  const start = async () => {
    if (!window.editorAPI || running.current) return;
    const jobId = crypto.randomUUID(); running.current = jobId; cancelled.current = false; setBusy(true); setError('');
    try {
      const asset = await window.editorAPI.deriveMedia(jobId, captured.project, captured.clipId, request);
      if (!alive.current || cancelled.current) return;
      const store = useEditorStore.getState();
      if (store.project !== captured.project) throw new Error(ui("处理期间项目已改变。未覆盖新编辑，请重新选择片段后处理。", "The project changed during processing. New edits were preserved. Select the clip again to retry."));
      const result = applyDerivative(store.project, captured.clipId, request, asset);
      store.commit(result.project); store.select([result.clipId]); store.seek(mode === 'freeze' ? captured.time : result.project.clips.find(c => c.id === result.clipId)!.start);
      onClose();
    } catch (e) { if (alive.current) setError(String(e).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, '')); }
    finally { running.current = null; if (alive.current) setBusy(false); }
  };
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={mode === 'reverse' ? ui("视频倒放", "Reverse video") : ui("插入定格", "Insert freeze frame")}>
    <header><h2>{mode === 'reverse' ? ui("视频倒放", "Reverse video") : ui("插入定格", "Insert freeze frame")}</h2><button disabled={busy} aria-label={ui("关闭媒体处理", "Close media processing")} onClick={onClose}><X size={18}/></button></header>
    <div className="modal-body">
      <p>{captured.project.clips.find(c => c.id === captured.clipId)?.name}</p>
      {mode === 'reverse' ? <><p>{ui("倒放所选片段的源选段，保持时间线长度和效果；关联音频同步处理。当前速度会烘焙到新素材，可继续变速。", "Reverse the selected source range while preserving timeline duration and effects. Linked audio is processed together. Current speed is baked into the new asset and can be adjusted again.")}</p><label>{ui("倒放声音", "Reverse audio")} <select aria-label={ui("倒放声音", "Reverse audio")} disabled={busy} value={audio} onChange={e => setAudio(e.target.value as typeof audio)}><option value="reverse">{ui("原声一起倒放", "Reverse original audio")}</option><option value="mute">{ui("移除原声", "Remove original audio")}</option></select></label></>
        : <><p>{ui("在播放头插入无声静帧，后续片段整体后移。保留当前变换、调色与裁剪；其他图层及淡入淡出不烘焙到静帧。", "Insert a silent freeze frame at the playhead and move later clips together. Current transforms, color adjustments and crop are preserved; other layers and fades are not baked into the frame.")}</p><label>{ui("定格时长（秒）", "Freeze duration (seconds)")} <input aria-label={ui("定格时长（秒）", "Freeze duration (seconds)")} type="number" min={1 / captured.project.fps} max="3600" step={1 / captured.project.fps} disabled={busy} value={duration} onChange={e => setDuration(e.target.value)}/></label></>}
      <p className="muted small">{ui("生成素材保存在本机，原文件保持原样。撤销保留生成文件供重做；跨机器使用请“收集项目素材”。", "Generated assets stay on this computer; originals are unchanged. Undo retains generated files for redo. Use Collect project assets before moving to another computer.")}</p>
      {progress && <div className="export-progress"><p>{localizeMessage(progress.message) }</p><progress max={1} value={progress.progress}/><p>{Math.round(progress.progress * 100)}%</p></div>}
      {(error || preflight) && <p role="alert" className="inline-warning">{localizeMessage(error || preflight) }</p>}
    </div><footer>{busy ? <button onClick={() => { cancelled.current = true; if (running.current) void window.editorAPI?.cancelDerivative(running.current); }}>{ui("取消处理", "Cancel processing")}</button> : <><button onClick={onClose}>{ui("关闭", "Close")}</button><button className="primary" disabled={!!preflight || !window.editorAPI} onClick={() => void start()}>{mode === 'reverse' ? ui("生成倒放", "Generate reversed clip") : ui("生成定格", "Generate freeze frame")}</button></>}</footer>
  </section></div>;
}
