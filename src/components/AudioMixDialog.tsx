import { useEffect, useRef, useState } from "react";
import { audioAnalysisSources, DEFAULT_DUCKING, normalizableClips, validateAudioDucking, type AudioAnalysisRequest, type AudioAnalysisResult } from "../core/audioMix";
import type { Project } from "../core/types";
import { useEditorStore } from "../editor/store";
import { useUITranslation } from "../i18n";
import { localizeMessage } from "../i18n/messages";

type Mode = "normalize" | "duck";

export default function AudioMixDialog({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const ui = useUITranslation();
  const project = useEditorStore(state => state.project);
  const selectedIds = useEditorStore(state => state.selectedIds);
  const selected = project.clips.find(clip => clip.id === selectedIds[0]);
  const audioClips = normalizableClips(project, selectedIds);
  const sounds = new Set(project.assets.filter(asset => asset.hasAudio && !asset.missing).map(asset => asset.id));
  const voiceTracks = project.tracks.filter(track => !track.muted && project.clips.some(clip =>
    clip.trackId === track.id && !clip.muted && sounds.has(clip.assetId ?? "")));
  const musicTracks = project.tracks.filter(track => track.kind === "audio" && !track.locked &&
    (track.audioDucking || project.clips.some(clip => clip.trackId === track.id && sounds.has(clip.assetId ?? ""))));
  const [musicId, setMusicId] = useState(() =>
    musicTracks.find(track => track.audioDucking)?.id ??
    musicTracks.find(track => track.id !== selected?.trackId)?.id ?? musicTracks[0]?.id ?? "");
  const [voiceId, setVoiceId] = useState(() =>
    voiceTracks.find(track => track.id === selected?.trackId && track.id !== musicId)?.id ??
    voiceTracks.find(track => track.id !== musicId)?.id ?? "");
  const existing = musicTracks.find(track => track.id === musicId)?.audioDucking;
  const [options, setOptions] = useState(() => existing ?? DEFAULT_DUCKING);
  const [reuseRegions, setReuseRegions] = useState(true);
  const [targetLufs, setTarget] = useState(-23);
  const [measured, setMeasured] = useState<{ project: Project; request: Exclude<AudioAnalysisRequest, { mode: "beats" }>; result: AudioAnalysisResult }>();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const job = useRef<string | null>(null);
  const cancelled = useRef(false);
  const alive = useRef(false);
  const request: Exclude<AudioAnalysisRequest, { mode: "beats" }> = mode === "normalize"
    ? { mode, clipIds: audioClips.map(clip => clip.id), targetLufs }
    : { mode, voiceTrackId: voiceId, musicTrackId: musicId, options };
  const sameClips = (ids: readonly string[]) =>
    ids.length === audioClips.length && ids.every((id, i) => audioClips[i].id === id);
  const result = measured?.project === project &&
    (measured.request.mode === "duck" || sameClips(measured.request.clipIds)) ? measured.result : undefined;
  const regions = result?.mode === "duck" ? result.regions :
    reuseRegions && existing?.thresholdDb === options.thresholdDb ? existing.regions : undefined;
  const hasGain = audioClips.some(clip => clip.audioGainDb !== undefined);
  let analysisIssue = "", validDucking = true;
  try { audioAnalysisSources(project, request); } catch (e) { analysisIssue = (e as Error).message; }
  if (mode === "duck" && regions) {
    try { validateAudioDucking({ ...options, regions }); } catch { validDucking = false; }
  }

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

  const analyze = async () => {
    if (!window.editorAPI || job.current) return;
    const id = crypto.randomUUID();
    job.current = id;
    cancelled.current = false;
    setProgress(0);
    setError("");
    setMeasured(undefined);
    try {
      const next = await window.editorAPI.analyzeAudio(id, project, request);
      if (cancelled.current || !alive.current) return;
      if (useEditorStore.getState().project !== project) throw new Error("The project changed during audio analysis. Analyze again.");
      setMeasured({ project, request, result: next });
    } catch (e) {
      if (alive.current) setError(cancelled.current ? ui("已取消分析", "Analysis cancelled") :
        localizeMessage((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")));
    } finally {
      job.current = null;
      if (alive.current) setProgress(null);
    }
  };
  const apply = (reset = false) => {
    const state = useEditorStore.getState();
    if (state.project !== project || state.transactionOpen) return;
    if (mode === "normalize" && request.mode === "normalize") {
      if (!reset && (analysisIssue || result?.mode !== "normalize")) return;
      if (state.selectedIds !== selectedIds) return;
      const gains = new Map<string, number | undefined>(reset
        ? request.clipIds.map(id => [id, undefined])
        : result?.mode === "normalize" ? result.measurements.map(item => [item.clipId, item.gainDb]) : []);
      state.commit({ ...project, clips: project.clips.map(clip => gains.has(clip.id)
        ? { ...clip, audioGainDb: gains.get(clip.id) } : clip) });
    } else if (mode === "duck" && musicTracks.some(track => track.id === musicId) && (reset || regions)) {
      const audioDucking = reset ? undefined : validateAudioDucking({ ...options, regions });
      state.commit({ ...project, tracks: project.tracks.map(track => track.id === musicId ? { ...track, audioDucking } : track) });
    } else return;
    onClose();
  };
  const title = mode === "normalize" ? ui("响度统一", "Loudness normalization") : ui("自动压低背景音乐", "Auto-duck background music");
  const busy = progress !== null;
  const canApply = mode === "normalize" ? !analysisIssue && result?.mode === "normalize" : validDucking && !!regions;
  return <div className="modal-backdrop">
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2></header>
      <div className="modal-body">
        {mode === "normalize" ? <>
          <p className="muted">{audioClips.length === 1 ? audioClips[0].name :
            ui(`已选 ${audioClips.length} 个可处理片段`, `${audioClips.length} eligible clips selected`)}</p>
          <label>{ui("目标响度（LUFS）", "Target loudness (LUFS)")}
            <select aria-label={ui("目标响度（LUFS）", "Target loudness (LUFS)")} value={targetLufs} disabled={busy}
              onChange={event => { setTarget(Number(event.target.value)); setMeasured(undefined); }}>
              {[-24, -23, -18, -16, -14, -12].map(level => <option key={level} value={level}>{level} LUFS</option>)}
            </select>
          </label>
          <p className="field-hint">{ui("测量当前源选段。应用的固定增益上限为 +24 dB，并以源真峰值 −1.5 dBTP 为限。", "Measures the current source range. The fixed gain is capped at +24 dB and limited by a −1.5 dBTP source true-peak ceiling.")}</p>
          {audioClips.length === 1 && hasGain && <p>{ui("当前增益", "Current gain")} {audioClips[0].audioGainDb!.toFixed(1)} dB</p>}
          {result?.mode === "normalize" && <ul className="audio-measurements" aria-label={ui("响度测量结果", "Loudness measurements")}>
            {result.measurements.map(({ clipId, lufs, truePeakDb, gainDb }, i) => <li key={clipId}>
              {audioClips.length > 1 && <strong>{i + 1}. {project.clips.find(clip => clip.id === clipId)?.name}</strong>}
              <span>{ui("实测响度", "Measured loudness")} {lufs.toFixed(1)} LUFS · {ui("真峰值", "True peak")} {truePeakDb.toFixed(1)} dBTP · {ui("拟应用增益", "Suggested gain")} {gainDb.toFixed(1)} dB</span>
            </li>)}
          </ul>}
          {analysisIssue && <p className="field-hint">{audioClips.length
            ? ui("每次最多分析 200 个片段，合计 60 分钟源声。", "Analyze up to 200 clips and 60 minutes of source audio at once.")
            : ui("请选择含有声音的未锁定片段。", "Select unlocked clips with available audio.")}</p>}
        </> : <>
          <div className="form-grid">
            <label>{ui("人声轨道", "Voice track")}
              <select aria-label={ui("人声轨道", "Voice track")} value={voiceId} disabled={busy}
                onChange={event => { setVoiceId(event.target.value); setMeasured(undefined); setReuseRegions(false); }}>
                <option value="">{ui("选择轨道", "Select a track")}</option>
                {voiceTracks.filter(track => track.id !== musicId).map(track => <option key={track.id} value={track.id}>{track.name}</option>)}
              </select>
            </label>
            <label>{ui("背景音乐轨道", "Music track")}
              <select aria-label={ui("背景音乐轨道", "Music track")} value={musicId} disabled={busy}
                onChange={event => {
                  const id = event.target.value;
                  setMusicId(id);
                  if (id === voiceId) setVoiceId(voiceTracks.find(track => track.id !== id)?.id ?? "");
                  setOptions(musicTracks.find(track => track.id === id)?.audioDucking ?? DEFAULT_DUCKING);
                  setMeasured(undefined);
                  setReuseRegions(true);
                }}>
                <option value="">{ui("选择轨道", "Select a track")}</option>
                {musicTracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}
              </select>
            </label>
            {([
              ["reductionDb", ui("压低量（dB）", "Reduction (dB)"), 1, 36, 1],
              ["attack", ui("进入时长（秒）", "Attack (s)"), 0.02, 3, 0.01],
              ["release", ui("恢复时长（秒）", "Release (s)"), 0.02, 5, 0.01],
              ["thresholdDb", ui("人声阈值（dBFS）", "Voice threshold (dBFS)"), -65, -15, 1],
            ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}
              <input aria-label={label} type="number" min={min} max={max} step={step} value={Number.isFinite(options[key]) ? options[key] : ""}
                disabled={busy} onChange={event => {
                  const value = event.target.valueAsNumber;
                  setOptions(current => ({ ...current, [key]: value }));
                  if (key === "thresholdDb") setMeasured(undefined);
                }} />
            </label>)}
          </div>
          <p className="field-hint">{ui("按人声轨道的音量检测活动区间。结果保存在时间线上；移动或裁剪人声后请重新分析。", "Detects activity from the voice track's audio level. The result stays at its timeline positions. Analyze again after moving or trimming the voice.")}</p>
          {regions && <p role="status">{ui(`已检测到 ${regions.length} 段活动音频`, `Detected ${regions.length} active audio regions`)}</p>}
        </>}
        {busy && <div role="status"><progress max={1} value={progress} /> {Math.round(progress * 100)}%</div>}
        {error && <p role="alert" className="inline-warning">{error}</p>}
      </div>
      <footer>
        {busy ? <button onClick={() => {
          cancelled.current = true;
          if (job.current) void window.editorAPI?.cancelAudioAnalysis(job.current).catch(() => {});
        }}>{ui("取消分析", "Cancel analysis")}</button> : <>
          <button onClick={onClose}>{ui("关闭", "Close")}</button>
          {(mode === "normalize" ? hasGain : existing) && <button onClick={() => apply(true)}>{ui("移除处理", "Remove processing")}</button>}
          <button disabled={!!analysisIssue} onClick={() => void analyze()}>{ui("分析", "Analyze")}</button>
          <button className="primary" disabled={!canApply} onClick={() => apply()}>{ui("应用", "Apply")}</button>
        </>}
      </footer>
    </section>
  </div>;
}
