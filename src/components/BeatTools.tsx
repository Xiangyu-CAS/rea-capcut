import { Activity, Magnet, Scissors, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { beatSource, clipBeatTimes } from "../core/beats";
import { splitAtBeats } from "../core/timelineEdits";
import { validateProject } from "../core/model";
import { useEditorStore } from "../editor/store";
import { useUITranslation } from "../i18n";
import { localizeMessage } from "../i18n/messages";

export default function BeatTools({ snapping, setSnapping, notify }: {
  snapping: boolean;
  setSnapping: (value: boolean) => void;
  notify: (message: string) => void;
}) {
  const ui = useUITranslation();
  const project = useEditorStore(state => state.project);
  const selected = useEditorStore(state => state.selectedIds);
  const clip = project.clips.find(item => item.id === selected[0]);
  const asset = project.assets.find(item => item.id === clip?.assetId);
  const [progress, setProgress] = useState<number | null>(null);
  const job = useRef<string | null>(null);
  const cancelled = useRef(false);
  const alive = useRef(false);
  const markers = project.clips.some(clip =>
    project.assets.some(source => clip.assetId === source.id && source.beats && clipBeatTimes(clip, source).length),
  );

  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.editorAPI?.onAudioAnalysisProgress(event => {
      if (event.jobId === job.current) setProgress(event.progress);
    });
    return () => {
      alive.current = false;
      unsubscribe?.();
      if (job.current) void window.editorAPI?.cancelAudioAnalysis(job.current).catch(() => {});
    };
  }, []);

  const report = (reason: unknown) => {
    const message = String(reason instanceof Error ? reason.message : reason)
      .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
    notify(localizeMessage(message));
  };
  const analyze = async () => {
    if (!window.editorAPI || !asset || job.current) return;
    try { beatSource(project, asset.id); } catch (error) { report(error); return; }
    const id = crypto.randomUUID();
    job.current = id;
    cancelled.current = false;
    setProgress(0);
    try {
      const result = await window.editorAPI.analyzeAudio(id, project, { mode: "beats", assetId: asset.id });
      if (!alive.current || cancelled.current || result.mode !== "beats") return;
      const state = useEditorStore.getState();
      if (state.project !== project || state.transactionOpen) {
        notify(ui("工程已更改，请重新检测节拍。", "The project changed. Detect beats again."));
        return;
      }
      state.commit(validateProject({
        ...project,
        assets: project.assets.map(item => item.id === asset.id ? { ...item, beats: result.analysis } : item),
      }));
      notify(ui(`已检测到 ${result.analysis.times.length} 个拍点 · ${result.analysis.bpm} BPM`,
        `${result.analysis.times.length} beat markers · ${result.analysis.bpm} BPM`));
    } catch (error) {
      if (alive.current && !cancelled.current) report(error);
    } finally {
      job.current = null;
      if (alive.current) setProgress(null);
    }
  };

  const cut = () => {
    const state = useEditorStore.getState();
    try {
      const next = splitAtBeats(state.project, state.selectedIds);
      if (next === state.project) {
        notify(ui("所选片段内没有可分割的拍点。", "The selection contains no beats to cut on."));
        return;
      }
      state.commit(next);
      state.setPlaying(false);
    } catch (error) { report(error); }
  };
  const canAnalyze = Boolean(window.editorAPI && asset?.hasAudio && !asset.missing && asset.kind !== "image");
  if (!canAnalyze && !markers && progress === null) return null;
  return <>
    <span className="tl-divider" />
    {progress === null ? canAnalyze && <button type="button"
      title={ui("检测素材节拍", "Detect beats")} aria-label={ui("检测素材节拍", "Detect beats")} onClick={() => void analyze()}>
      <Activity size={16} />
    </button> : <button type="button"
      title={ui("取消节拍检测", "Cancel beat detection")} aria-label={ui("取消节拍检测", "Cancel beat detection")}
      onClick={() => {
        cancelled.current = true;
        if (job.current) void window.editorAPI?.cancelAudioAnalysis(job.current).catch(report);
      }}>
      <Square size={14} />{Math.round(progress * 100)}%
    </button>}
    {markers && <>
      <button type="button" className={snapping ? "is-active" : undefined}
        aria-pressed={snapping} title={ui("节拍吸附", "Snap to beats")} aria-label={ui("节拍吸附", "Snap to beats")}
        onClick={() => setSnapping(!snapping)}><Magnet size={15} /></button>
      <button type="button" disabled={!selected.length} title={ui("按拍切开所选片段", "Cut selection on beats")}
        aria-label={ui("按拍切开所选片段", "Cut selection on beats")} onClick={cut}><Scissors size={15} /></button>
    </>}
    {asset?.beats && progress === null && <button type="button"
      title={ui("清除素材拍点", "Clear beat markers")} aria-label={ui("清除素材拍点", "Clear beat markers")}
      onClick={() => useEditorStore.getState().commit({
        ...project, assets: project.assets.map(item => item.id === asset.id ? { ...item, beats: undefined } : item),
      })}><X size={14} /></button>}
  </>;
}
