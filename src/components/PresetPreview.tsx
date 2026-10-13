import { useEffect, useMemo, useRef, useState } from "react";
import type { Adjustments, Clip } from "../core/types";
import { DEFAULT_ADJUSTMENTS } from "../core/defaults";
import { applyColorAdjustments } from "../core/color";
import {
  createClip,
  createProject,
  createTrack,
  evaluateFade,
  evaluateKeyframes,
} from "../core/model";
import {
  applyTransition,
  makeTextPreset,
  motionPatch,
  type MotionId,
  type TextPreset,
  type TransitionId,
} from "../core/creativePresets";
import { textPreviewLayer } from "../editor/previewLayers";

/** Hover/focus plays the same parameter recipes as the timeline, on bundled original art. */
export default function PresetPreview({
  text,
  motion,
  transition,
  adjustments,
  label,
}: {
  text?: TextPreset;
  motion?: MotionId;
  transition?: TransitionId;
  adjustments?: Partial<Adjustments>;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [playing, setPlaying] = useState(false);
  const scene = useMemo(() => {
    const p = createProject("素材预览");
    p.width = 640;
    p.height = 360;
    p.background = "#18212b";
    const track = createTrack("video");
    p.tracks = [track];
    const a = createClip(undefined, track.id, 0, 30);
    a.text = undefined;
    a.duration = 1.8;
    if (text) {
      const title = makeTextPreset(text, track.id, 0, p);
      // Enlarge type in the thumbnail so style differences remain legible.
      title.text = {
        ...title.text!,
        fontSize: title.text!.fontSize * 1.65,
        strokeWidth: title.text!.strokeWidth * 1.65,
      };
      p.clips = [title];
    } else if (transition) {
      const b = {
        ...createClip(undefined, track.id, 1.8, 30),
        text: undefined,
        duration: 1.8,
      };
      p.clips = [a, b];
      return applyTransition(p, a.id, transition, 0.6).project;
    } else p.clips = [motion ? { ...a, ...motionPatch(a, motion, p) } : a];
    return p;
  }, [text, motion, transition]);
  useEffect(() => {
    let cancelled = false,
      frame = 0;
    const images = [new Image(), new Image()];
    images[0].src = "./builtin-assets/bg-sand.png";
    images[1].src = "./builtin-assets/bg-ocean.png";
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const render = (time: number) => {
      ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = scene.background;
      ctx.fillRect(0, 0, 640, 360);
      const draw = (clip: Clip, index: number) => {
        if (time < clip.start || time >= clip.start + clip.duration) return;
        const local = time - clip.start,
          tr = evaluateKeyframes(clip, local).transform;
        ctx.save();
        ctx.globalAlpha = tr.opacity * evaluateFade(clip, local, "video");
        ctx.translate(320 + tr.x, 180 + tr.y);
        ctx.rotate((tr.rotation * Math.PI) / 180);
        ctx.scale(tr.scale, tr.scale);
        if (clip.text) {
          const layer = textPreviewLayer(clip);
          ctx.drawImage(layer.canvas, -layer.width / 2, -layer.height / 2);
        } else if (images[index].complete && images[index].naturalWidth)
          ctx.drawImage(images[index], -320, -180, 640, 360);
        ctx.restore();
      };
      scene.clips.forEach(draw);
      if (adjustments) {
        const pixels = ctx.getImageData(0, 0, 320, 180);
        applyColorAdjustments(pixels.data, {
          ...DEFAULT_ADJUSTMENTS,
          ...adjustments,
        });
        ctx.putImageData(pixels, 0, 0);
        if (adjustments.blur) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.filter = `blur(${adjustments.blur * 0.5}px)`;
          ctx.drawImage(canvas.current!, 0, 0);
          ctx.restore();
        }
      }
    };
    const start = performance.now();
    const tick = () => {
      if (cancelled) return;
      const elapsed = (performance.now() - start) / 1000;
      const time = playing
        ? transition
          ? 1.1 + (elapsed % 1.6)
          : elapsed % 1.8
        : transition
          ? 1.5
          : 0.9;
      render(time);
      if (playing) frame = requestAnimationFrame(tick);
    };
    void Promise.all([
      ...images.map((img) => img.decode().catch(() => {})),
      document.fonts.ready,
    ]).then(() => {
      if (!cancelled) tick();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [scene, playing, adjustments, transition]);
  return (
    <button
      className="preset-preview"
      aria-label={`预览${label}`}
      aria-pressed={playing}
      onMouseEnter={() => setPlaying(true)}
      onMouseLeave={() => setPlaying(false)}
      onFocus={() => setPlaying(true)}
      onBlur={() => setPlaying(false)}
      onClick={() => setPlaying((p) => !p)}
    >
      <canvas ref={canvas} width={320} height={180} />
      <small>{playing ? "播放中" : "悬停预览"}</small>
    </button>
  );
}
