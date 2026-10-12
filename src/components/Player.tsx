import { useEffect, useRef, useState } from "react";
import {
  Maximize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ZoomIn,
} from "lucide-react";
import type { Clip, MediaAsset, Project } from "../core/types";
import {
  evaluateKeyframes,
  evaluateFade,
  formatTime,
  projectDuration,
} from "../core/model";
import {
  imagePreviewLayer,
  textPreviewLayer,
  clearPreviewLayers,
} from "../editor/previewLayers";
import { useEditorStore } from "../editor/store";
interface PlayerProps {
  project: Project;
  selectedIds: string[];
  playhead: number;
  playing: boolean;
  onSelect: (ids: string[]) => void;
  onUpdateClip: (id: string, patch: Partial<Clip>) => void;
  onSeek: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
}
interface Source {
  element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
  url: string;
  gain?: GainNode;
  decodedTime?: number;
  frameCallback?: number;
}
export default function Player({
  project,
  selectedIds,
  playhead,
  playing,
  onSeek,
  onPlayingChange,
  onSelect,
  onUpdateClip,
}: PlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    hostRef = useRef<HTMLDivElement>(null);
  const sources = useRef(new Map<string, Source>()),
    audioContext = useRef<AudioContext | null>(null);
  const current = useRef({ project, playhead, playing });
  current.current = { project, playhead, playing };
  const [muted, setMuted] = useState(false),
    [errors, setErrors] = useState<string[]>([]),
    [viewScale, setViewScale] = useState(1),
    [size, setSize] = useState({ w: 720, h: 405 });
  const localMuted = useRef(muted);
  localMuted.current = muted;
  const duration = projectDuration(project);
  const drag = useRef<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    clip: Clip;
  } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({
        w: Math.max(1, rect.width - 48),
        h: Math.max(1, rect.height - 48),
      });
    });
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const desired = new Set<string>();
    clearPreviewLayers(new Set(project.clips.map((c) => c.id)));
    for (const clip of project.clips) {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.missing) continue;
      desired.add(clip.id);
      const url = asset.previewUrl ?? asset.url,
        existing = sources.current.get(clip.id);
      if (existing?.url === url) continue;
      if (existing && existing.element instanceof HTMLMediaElement) {
        if (
          existing.element instanceof HTMLVideoElement &&
          existing.frameCallback !== undefined
        )
          existing.element.cancelVideoFrameCallback(existing.frameCallback);
        existing.element.pause();
        existing.element.removeAttribute("src");
        existing.element.load();
        existing.gain?.disconnect();
      }
      const element =
        asset.kind === "image"
          ? new Image()
          : document.createElement(asset.kind === "audio" ? "audio" : "video");
      if (element instanceof HTMLMediaElement) {
        element.preload = "auto";
        element.crossOrigin = "anonymous";
        if (element instanceof HTMLVideoElement) element.playsInline = true;
      } else element.crossOrigin = "anonymous";
      element.src = url;
      const source: Source = { element, url };
      element.addEventListener(
        "error",
        () =>
          setErrors((previous) =>
            previous.includes(asset.name)
              ? previous
              : [...previous, asset.name],
          ),
        { once: true },
      );
      if (element instanceof HTMLVideoElement) {
        const video = element;
        const decoded: VideoFrameRequestCallback = (_, metadata) => {
          source.decodedTime = metadata.mediaTime;
          source.frameCallback = video.requestVideoFrameCallback(decoded);
        };
        source.frameCallback = video.requestVideoFrameCallback(decoded);
      }
      sources.current.set(clip.id, source);
    }
    for (const [clipId, source] of sources.current)
      if (!desired.has(clipId)) {
        if (source.element instanceof HTMLMediaElement) {
          if (
            source.element instanceof HTMLVideoElement &&
            source.frameCallback !== undefined
          )
            source.element.cancelVideoFrameCallback(source.frameCallback);
          source.element.pause();
          source.element.removeAttribute("src");
          source.element.load();
        }
        source.gain?.disconnect();
        sources.current.delete(clipId);
      }
  }, [project.assets, project.clips]);
  useEffect(
    () => () => {
      for (const source of sources.current.values()) {
        if (source.element instanceof HTMLMediaElement) {
          if (
            source.element instanceof HTMLVideoElement &&
            source.frameCallback !== undefined
          )
            source.element.cancelVideoFrameCallback(source.frameCallback);
          source.element.pause();
        }
        source.gain?.disconnect();
      }
      sources.current.clear();
      void audioContext.current?.close();
    },
    [],
  );
  const initializeAudio = () => {
    try {
      const context =
        audioContext.current ?? (audioContext.current = new AudioContext());
      void context.resume();
      for (const source of sources.current.values())
        if (source.element instanceof HTMLMediaElement && !source.gain) {
          const media = context.createMediaElementSource(source.element);
          source.gain = context.createGain();
          media.connect(source.gain);
          source.gain.connect(context.destination);
        }
    } catch {
      /* Media elements still provide ordinary volume. */
    }
  };
  useEffect(() => {
    let frame = 0,
      previous = performance.now();
    const paint = (now: number) => {
      const state = current.current;
      let time = state.playhead;
      if (state.playing) {
        const elapsed = Math.min((now - previous) / 1000, 0.12);
        time += elapsed;
        const end = projectDuration(state.project);
        if (time >= end) {
          time = end;
          useEditorStore.setState({ playing: false });
        }
        useEditorStore.setState({ playhead: time });
        current.current = { ...state, playhead: time, playing: time < end };
      }
      previous = now;
      const p = state.project,
        end = projectDuration(p);
      // Keep the final decoded frame visible when playback reaches the project end.
      const paintTime =
        end > 0 ? Math.min(time, Math.max(0, end - 1 / p.fps)) : time;
      const canvas = canvasRef.current,
        ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        frame = requestAnimationFrame(paint);
        return;
      }
      const factor = canvas.width / p.width;
      ctx.setTransform(factor, 0, 0, factor, 0, 0);
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      ctx.fillStyle = p.background;
      ctx.fillRect(0, 0, p.width, p.height);
      const clips = [...p.tracks]
        .reverse()
        .flatMap((track) =>
          p.clips
            .filter((c) => c.trackId === track.id)
            .sort((a, b) => a.start - b.start),
        );
      for (const clip of clips) {
        const track = p.tracks.find((t) => t.id === clip.trackId)!;
        const active =
          paintTime >= clip.start && paintTime < clip.start + clip.duration;
        const source = sources.current.get(clip.id);
        const media = source?.element;
        const evaluated = evaluateKeyframes(
          clip,
          Math.max(0, paintTime - clip.start),
        );
        const local = Math.max(0, paintTime - clip.start);
        if (media instanceof HTMLMediaElement) {
          if (!active) {
            media.pause();
            if (source?.gain) source.gain.gain.value = 0;
            continue;
          }
          if (state.playing && !source?.gain) initializeAudio();
          const target = clip.sourceIn + local * clip.speed;
          if (
            Number.isFinite(media.duration) &&
            Math.abs(media.currentTime - target) >
              (state.playing ? 0.15 : 1 / p.fps + 0.001)
          ) {
            try {
              media.currentTime = Math.min(target, media.duration);
            } catch {
              /* Source metadata loading. */
            }
          }
          media.playbackRate = clip.speed;
          let gain =
            track.muted || clip.muted || localMuted.current
              ? 0
              : evaluated.volume;
          gain *= evaluateFade(clip, local, "audio");
          if (source?.gain) {
            source.gain.gain.value = gain;
            media.volume = 1;
          } else media.volume = Math.min(1, gain);
          if (state.playing && media.paused) void media.play().catch(() => {});
          if (!state.playing && !media.paused) media.pause();
        }
        if (!active || track.hidden || track.kind === "audio") continue;
        const alpha =
          evaluated.transform.opacity * evaluateFade(clip, local, "video");
        const movement =
          drag.current?.clip.id === clip.id ? drag.current : null;
        const tr = movement
          ? {
              ...evaluated.transform,
              x: evaluated.transform.x + movement.dx,
              y: evaluated.transform.y + movement.dy,
            }
          : evaluated.transform;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.translate(p.width / 2 + tr.x, p.height / 2 + tr.y);
        ctx.rotate((tr.rotation * Math.PI) / 180);
        ctx.scale(
          tr.scale * (tr.flipX ? -1 : 1),
          tr.scale * (tr.flipY ? -1 : 1),
        );
        const a = clip.adjustments;
        ctx.filter = a.blur > 0 ? `blur(${a.blur * factor}px)` : "none";
        if (clip.text) {
          const layer = textPreviewLayer(clip);
          ctx.drawImage(
            layer.canvas,
            -layer.width / 2,
            -layer.height / 2,
            layer.width,
            layer.height,
          );
        } else if (media) {
          const asset = p.assets.find((a) => a.id === clip.assetId)!;
          try {
            if (!(
              (media instanceof HTMLVideoElement && media.readyState < 2) ||
              (media instanceof HTMLImageElement && !media.complete)
            )) {
              const previewScale = Math.min(
                1,
                1920 / asset.width,
                1920 / asset.height,
              );
              const layer = imagePreviewLayer(
                clip,
                media as HTMLImageElement | HTMLVideoElement,
                Math.max(1, Math.round(asset.width * previewScale)),
                Math.max(1, Math.round(asset.height * previewScale)),
                source?.decodedTime,
              );
              const contain = Math.min(
                p.width / layer.width,
                p.height / layer.height,
              );
              const w = layer.width * contain,
                h = layer.height * contain;
              ctx.drawImage(layer, -w / 2, -h / 2, w, h);
            }
          } catch {
            /* Decoded source is not ready yet. */
          }
        }
        ctx.restore();
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);
  const aspect = project.width / project.height,
    displayW = Math.min(size.w, size.h * aspect) * viewScale,
    displayH = displayW / aspect;
  return (
    <section className="player-panel panel" aria-label="播放器">
      <div className="panel-heading">
        <span>播放器</span>
        <span className="muted small">
          {project.width} × {project.height} · {project.fps} fps
        </span>
      </div>
      <div className="player-stage" ref={hostRef}>
        <canvas
          ref={canvasRef}
          aria-label="视频预览"
          width={Math.max(
            2,
            Math.round(Math.min(1920, displayW * devicePixelRatio)),
          )}
          height={Math.max(
            2,
            Math.round(Math.min(1920, displayW * devicePixelRatio) / aspect),
          )}
          style={{ width: displayW, height: displayH }}
          onPointerDown={(event) => {
            if (selectedIds.length !== 1 || event.button !== 0) return;
            const clip = project.clips.find((c) => c.id === selectedIds[0]);
            if (
              !clip ||
              clip.start > playhead ||
              playhead >= clip.start + clip.duration ||
              project.tracks.find((t) => t.id === clip.trackId)?.locked
            )
              return;
            onPlayingChange(false);
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              dx: 0,
              dy: 0,
              clip,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const d = drag.current;
            if (!d) return;
            const ratio = project.width / displayW;
            d.dx = (event.clientX - d.x) * ratio;
            d.dy = (event.clientY - d.y) * ratio;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onPointerUp={(event) => {
            const d = drag.current;
            if (!d) return;
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            const latest = current.current.project.clips.find(
              (c) => c.id === d.clip.id,
            );
            if (
              !latest ||
              current.current.project.tracks.find(
                (t) => t.id === latest.trackId,
              )?.locked
            )
              return;
            if (
              Math.abs(event.clientX - d.x) + Math.abs(event.clientY - d.y) >
              2
            )
              onUpdateClip(latest.id, {
                transform: {
                  ...latest.transform,
                  x: latest.transform.x + d.dx,
                  y: latest.transform.y + d.dy,
                },
                keyframes: latest.keyframes.map((key) =>
                  key.property === "x"
                    ? { ...key, value: key.value + d.dx }
                    : key.property === "y"
                      ? { ...key, value: key.value + d.dy }
                      : key,
                ),
              });
          }}
        />
        {!project.clips.length && (
          <div className="player-empty">
            <div className="preview-mark">
              R<span>✦</span>
            </div>
            <p>让灵感，成为画面</p>
            <span>导入素材并加入时间线开始创作</span>
          </div>
        )}
        {selectedIds.length === 1 &&
          project.clips.some(
            (c) =>
              c.id === selectedIds[0] &&
              playhead >= c.start &&
              playhead < c.start + c.duration,
          ) && (
            <div className="player-selection-hint">
              拖动画面调整所选片段位置
            </div>
          )}
        {errors.length > 0 && (
          <button
            className="preview-error"
            onClick={() => setErrors([])}
            title={errors.join("、")}
          >
            素材无法预览，导出仍使用原文件 · 点击收起
          </button>
        )}
      </div>
      <div className="player-controls">
        <div className="timecode">
          <strong>{formatTime(playhead, project.fps)}</strong>
          <span> / {formatTime(duration, project.fps)}</span>
        </div>
        <div className="transport">
          <button
            title="上一帧 ←"
            onClick={() => onSeek(Math.max(0, playhead - 1 / project.fps))}
          >
            <SkipBack size={15} />
          </button>
          <button
            className="play-button"
            aria-label={playing ? "暂停" : "播放"}
            onClick={() => {
              initializeAudio();
              if (!playing && playhead >= duration) onSeek(0);
              onPlayingChange(!playing);
            }}
            disabled={!duration}
          >
            {playing ? (
              <Pause size={19} fill="currentColor" />
            ) : (
              <Play size={19} fill="currentColor" />
            )}
          </button>
          <button
            title="下一帧 →"
            onClick={() =>
              onSeek(Math.min(duration, playhead + 1 / project.fps))
            }
          >
            <SkipForward size={15} />
          </button>
        </div>
        <div className="player-tools">
          <button
            title={muted ? "开启预览声音" : "静音预览"}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            title="预览缩放"
            onClick={() => setViewScale(viewScale === 1 ? 1.5 : 1)}
          >
            <ZoomIn size={16} />
          </button>
          <button
            title="全屏预览"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void hostRef.current?.requestFullscreen();
            }}
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
