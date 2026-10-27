import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AudioLines, Brackets, ChevronLeft, ChevronRight, CircleAlert, Pause, Play, Plus, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import type { PlacementMode } from "../core/timelineEdits";
import type { MediaAsset, Track } from "../core/types";
import { formatTime } from "../core/model";
import "./SourcePreview.css";

export interface SourcePreviewProps {
  asset: MediaAsset;
  fps: number;
  onClose: () => void;
  tracks?: Track[];
  onAddRange: (sourceIn: number, duration: number, mode?: PlacementMode, trackId?: string) => void;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A new asset owns a fresh media element and range, so delayed media events cannot affect another source. */
export default function SourcePreview(props: SourcePreviewProps) {
  const ui = useUITranslation();
  return <SourcePreviewSession key={`${props.asset.id}:${props.asset.url}:${props.asset.previewUrl ?? ""}`} {...props} />;
}
function SourcePreviewSession({ asset, fps, onClose, onAddRange, tracks }: SourcePreviewProps) {
  const ui = useUITranslation();
  const media = useRef<HTMLMediaElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const image = asset.kind === "image";
  const frameRate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const frame = 1 / frameRate;
  const knownDuration = Number.isFinite(asset.duration) && asset.duration > 0 ? asset.duration : 0;
  const [duration, setDuration] = useState(image ? knownDuration || 5 : knownDuration);
  const [sourceIn, setSourceIn] = useState(0);
  const [sourceOut, setSourceOut] = useState(image ? knownDuration || 5 : knownDuration);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<PlacementMode>("insert");
  const [trackId, setTrackId] = useState(tracks?.find(t => !t.locked)?.id ?? "");
  const outRef = useRef(sourceOut);
  outRef.current = sourceOut;
  const sourceUrl = asset.previewUrl || asset.url;
  const minLength = Math.min(frame, duration);
  const unavailable = !!asset.missing || !!error || !ready || (!image && duration < frame - 1e-8);
  const quantize = (value: number) => Math.round(value * frameRate) / frameRate;

  useEffect(() => {
    alive.current = true;
    const element = media.current;
    // React development StrictMode may replay effects while retaining the element.
    if (element && !element.getAttribute("src")) { element.setAttribute("src", sourceUrl);element.load(); }
    return () => {
      alive.current = false;
      if (element) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
    };
  }, []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const element = media.current;
      if (!element || !alive.current) return;
      if (element.currentTime >= outRef.current) {
        element.pause();
        element.currentTime = outRef.current;
        setTime(outRef.current);
        setPlaying(false);
        return;
      }
      setTime(element.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const pause = () => { media.current?.pause(); setPlaying(false); };
  const seek = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = clamp(quantize(value), 0, duration);
    pause();
    if (media.current && ready) media.current.currentTime = next;
    setTime(next);
  };
  const setIn = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = clamp(quantize(value), 0, Math.max(0, sourceOut - minLength));
    setSourceIn(next);seek(next);
  };
  const setOut = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = clamp(quantize(value), sourceIn + minLength, duration);
    setSourceOut(next);seek(next);
  };
  const playPause = async () => {
    const element = media.current;
    if (!element || unavailable) return;
    if (!element.paused) { pause(); return; }
    if (element.currentTime < sourceIn || element.currentTime >= sourceOut - 1e-6) {
      element.currentTime = sourceIn;setTime(sourceIn);
    }
    try { await element.play(); }
    catch (reason) {
      if (alive.current && !(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(ui("无法播放此素材，请检查格式或重新导入以生成预览代理。", "Cannot play this asset. Check its format or reimport to generate a preview proxy."));
      }
    }
  };
  const metadata = () => {
    const value = media.current?.duration ?? 0;
    if (!Number.isFinite(value) || value <= 0) { setError(ui("无法读取素材时长。", "Cannot read media duration.")); return; }
    const end = knownDuration > 0 ? Math.min(knownDuration, value) : value;
    setDuration(end);setSourceOut(end);setReady(true);
  };
  const mediaError = () => {
    if (!alive.current) return;
    setPlaying(false);setReady(false);
    setError(ui("无法解码素材预览。请重新导入以生成代理，或检查源文件是否可用。", "Cannot decode this preview. Reimport to generate a proxy, or check the source file is available."));
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable=true]") || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === " " && target.closest("button")) { event.stopPropagation();return; }
    if (key === "escape") { event.preventDefault();event.stopPropagation();pause();onClose();return; }
    if (image || unavailable || !["i", "o", " ", "arrowleft", "arrowright"].includes(key)) return;
    event.preventDefault();event.stopPropagation();
    if (key === "i") setIn(media.current?.currentTime ?? time);
    else if (key === "o") setOut(media.current?.currentTime ?? time);
    else if (key === " ") { if (!event.repeat) void playPause(); }
    else seek(time + (key === "arrowleft" ? -frame : frame));
  };
  const add = () => {
    if (unavailable) return;
    pause();
    onAddRange(image ? 0 : sourceIn, image ? duration : sourceOut - sourceIn, mode, trackId || undefined);
  };
  return (
    <section ref={panel} className="source-preview player-panel panel" aria-label={ui("素材源预览", "Source preview")} tabIndex={0} onKeyDown={keyDown}
      onPointerDown={event => { if (!(event.target as HTMLElement).closest("button, input, select")) panel.current?.focus({ preventScroll: true }); }}>
      <header className="panel-heading source-heading">
        <div><span> {ui("素材预览", "Media preview")} </span><strong title={asset.name}>{asset.name}</strong></div>
        <button aria-label={ui("返回时间线播放器", "Back to timeline player")} title={ui("返回时间线播放器 · Esc", "Back to timeline player · Esc")} onClick={() => { pause();onClose(); }}><X size={16} /></button>
      </header>
      <div className="source-stage">
        {asset.missing || error ? <div className="source-message source-error" role="alert"><CircleAlert size={26} /><strong>{asset.missing ? ui("素材文件丢失", "Media file missing") : ui("预览不可用", "Preview unavailable")}</strong><p>{asset.missing ? ui("请在素材操作菜单中重新链接文件。", "Relink the file from the asset actions menu.") : localizeMessage(error)}</p></div> : image ?
          <img src={sourceUrl} alt={asset.name} onLoad={() => setReady(true)} onError={mediaError} /> : asset.kind === "video" ?
          <video ref={element => { media.current = element; }} src={sourceUrl} preload="auto" playsInline muted={muted} onLoadedMetadata={metadata} onError={mediaError} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false);setTime(duration); }} /> :
          <><audio ref={element => { media.current = element; }} src={sourceUrl} preload="auto" muted={muted} onLoadedMetadata={metadata} onError={mediaError} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false);setTime(duration); }} />
            <div className="source-audio"><AudioLines size={38} /><strong>{asset.name}</strong><div className="source-waveform" aria-hidden="true">{Array.from({length: 80}, (_, i) => <i key={i} style={{height: `${10 + clamp(asset.waveform?.[Math.floor(i / 80 * asset.waveform.length)] ?? .25, 0, 1) * 85}%`}} />)}</div></div></>}
        {!asset.missing && !error && !ready && <div className="source-loading"> {ui("正在读取素材…", "Loading media…")} </div>}
      </div>
      {!image && <>
        <div className="source-seek">
          <div className="source-range-highlight" aria-hidden="true" style={{left: `${duration > 0 ? sourceIn / duration * 100 : 0}%`,width: `${duration > 0 ? (sourceOut-sourceIn)/duration*100 : 100}%`}} />
          <input aria-label={ui("素材预览进度", "Source preview position")} type="range" min={0} max={duration || 1} step={frame} value={time} disabled={unavailable} onChange={event => seek(Number(event.target.value))} />
        </div>
        <div className="source-controls">
          <span className="timecode"><strong>{formatTime(time,frameRate)}</strong><span> / {formatTime(duration,frameRate)}</span></span>
          <div className="source-transport"><button aria-label={ui("源素材上一帧", "Previous source frame")} disabled={unavailable} onClick={() => seek(time-frame)}><ChevronLeft size={16} /></button><button aria-label={playing ? ui("暂停素材", "Pause source") : ui("播放素材", "Play source")} disabled={unavailable} onClick={() => void playPause()}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button aria-label={ui("源素材下一帧", "Next source frame")} disabled={unavailable} onClick={() => seek(time+frame)}><ChevronRight size={16} /></button></div>
          <button aria-label={muted ? ui("开启源素材声音", "Unmute source") : ui("静音源素材", "Mute source")} onClick={() => setMuted(!muted)} disabled={unavailable}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        </div>
      </>}
      <footer className="source-range">
        {!image && <div className="source-marks">
          <label><button title={ui("将当前位置设为入点 · I", "Set in point at current position · I")} aria-label={ui("标记源素材入点", "Mark source in point")} disabled={unavailable} onClick={() => setIn(time)}> {ui("入点", "In")} <kbd>I</kbd></button><input aria-label={ui("源素材入点", "Source in point")} type="number" min={0} max={Math.max(0,sourceOut-minLength)} step={frame} value={Number(sourceIn.toFixed(6))} disabled={unavailable} onChange={event => {if(event.target.value !== "") setIn(Number(event.target.value));}} /><span> {ui("秒", "s")} </span></label>
          <label><button title={ui("将当前位置设为出点 · O", "Set out point at current position · O")} aria-label={ui("标记源素材出点", "Mark source out point")} disabled={unavailable} onClick={() => setOut(time)}> {ui("出点", "Out")} <kbd>O</kbd></button><input aria-label={ui("源素材出点", "Source out point")} type="number" min={sourceIn+minLength} max={duration} step={frame} value={Number(sourceOut.toFixed(6))} disabled={unavailable} onChange={event => {if(event.target.value !== "") setOut(Number(event.target.value));}} /><span> {ui("秒", "s")} </span></label>
          <button title={ui("重置为完整素材", "Reset to entire source")} aria-label={ui("重置源素材范围", "Reset source range")} disabled={unavailable} onClick={() => {setSourceIn(0);setSourceOut(duration);seek(0);}}><RotateCcw size={14} /></button>
        </div>}
        {tracks && <div className="source-placement">
          <label> {ui("入轨方式", "Placement mode")} <select aria-label={ui("入轨方式", "Placement mode")} value={mode} onChange={e => setMode(e.target.value as PlacementMode)}><option value="insert"> {ui("插入（整体后移）", "Insert (ripple all tracks)")} </option><option value="overwrite"> {ui("覆盖（保留两侧）", "Overwrite (keep surrounding clips)")} </option><option value="overlay"> {ui("叠加（不移动）", "Overlay (keep positions)")} </option></select></label>
          <label> {ui("目标轨道", "Target track")} <select aria-label={ui("目标轨道", "Target track")} value={trackId} onChange={e => setTrackId(e.target.value)}><option value=""> {ui("自动选择 / 新建", "Auto select / Create")} </option>{tracks.map(t => <option key={t.id} value={t.id} disabled={t.locked}>{t.name}{t.locked ? ui(" · 已锁定", " · Locked") : ""}</option>)}</select></label>
        </div>}
        <div className="source-add-row"><span>{image ? ui(`${asset.width} × ${asset.height} · 图片`, `${asset.width} × ${asset.height} · Image`) : <><Brackets size={12} />  {ui("已选", "Selected")} {formatTime(Math.max(0, sourceOut-sourceIn),frameRate)}</>}</span><button className="primary" disabled={unavailable} onClick={add}><Plus size={14} />{image ? ui("添加图片", "Add image") : ui("添加选中片段", "Add selected range")}</button></div>
        {!image && <p className="source-tip">{tracks ? (mode === "insert" ? ui("在播放头插入，所有轨道后续内容一起后移；受影响锁轨会阻止操作。", "Insert at the playhead and shift later content on all tracks. Locked affected tracks block the operation.") : mode === "overwrite" ? ui("覆盖目标轨及关联画声区间，其他轨道保留。", "Overwrite the target track and linked audio/video range; preserve other tracks.") : ui("叠加到播放头，不移动或裁掉已有内容。", "Overlay at the playhead without moving or trimming existing clips.")) : ui("聚焦预览后按 I / O 标记，空格播放选段，← / → 逐帧定位", "Focus the preview: I / O to mark, Space to play the range, ← / → to step frames")}</p>}
        {!image && ready && duration < frame - 1e-8 && <p className="source-error"> {ui("素材不足项目的一帧，暂时无法添加。", "This asset is shorter than one project frame and cannot be added.")} </p>}
      </footer>
    </section>
  );
}
