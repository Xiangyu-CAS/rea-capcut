import { useLibraryLabel } from "./libraryLabels";
import { useUITranslation } from "../i18n";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  Film,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Waves,
} from "lucide-react";
import type { Adjustments, Clip, TrackKind, Project } from "../core/types";
import { DEFAULT_ADJUSTMENTS } from "../core/defaults";
import "./EffectsPanel.css";
import { MotionLibrary } from "./CreativeLibrary";
import { motionPatch } from "../core/creativePresets";
import PresetPreview from "./PresetPreview";

export interface EffectsPanelProps {
  clip?: Clip;
  project?: Pick<Project, "width" | "height">;
  kind?: TrackKind;
  locked?: boolean;
  onApply: (patch: Partial<Clip>) => void;
}
export interface ColorPreset {
  id: string;
  name: string;
  description: string;
  colors: string;
  adjustments: Partial<Adjustments>;
}
export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: "original",
    name: "原色",
    description: "还原素材的自然色彩",
    colors: "#526658,#baac84,#65828d",
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  },
  {
    id: "cinema",
    name: "电影",
    description: "深邃对比，低饱和氛围",
    colors: "#243744,#b49868,#406d7a",
    adjustments: {
      brightness: -0.04,
      contrast: 1.22,
      saturation: 0.78,
      temperature: -0.08,
      blur: 0,
    },
  },
  {
    id: "warm",
    name: "暖阳",
    description: "温暖明亮，适合日常记录",
    colors: "#927b51,#ead092,#c4a570",
    adjustments: {
      brightness: 0.05,
      contrast: 1.05,
      saturation: 1.1,
      temperature: 0.3,
      blur: 0,
    },
  },
  {
    id: "cool",
    name: "冷蓝",
    description: "清透冷调，凸显画面层次",
    colors: "#2c5367,#86acbc,#55788e",
    adjustments: {
      brightness: 0.015,
      contrast: 1.12,
      saturation: 0.9,
      temperature: -0.35,
      blur: 0,
    },
  },
  {
    id: "mono",
    name: "黑白",
    description: "纯粹黑白，保留光影细节",
    colors: "#343839,#bebdb4,#6d7270",
    adjustments: {
      brightness: 0,
      contrast: 1.15,
      saturation: 0,
      temperature: 0,
      blur: 0,
    },
  },
  {
    id: "vintage",
    name: "复古",
    description: "褪色暖调的胶片印象",
    colors: "#686a4c,#c5b680,#8c987d",
    adjustments: {
      brightness: 0.045,
      contrast: 0.86,
      saturation: 0.72,
      temperature: 0.22,
      blur: 0,
    },
  },
  {
    id: "vivid",
    name: "鲜明",
    description: "鲜亮饱和，呈现丰富色彩",
    colors: "#45836b,#f6cf72,#679baa",
    adjustments: {
      brightness: 0.02,
      contrast: 1.1,
      saturation: 1.45,
      temperature: 0,
      blur: 0,
    },
  },
  {
    id: "soft",
    name: "柔焦",
    description: "柔和细节，营造朦胧质感",
    colors: "#8d9d9b,#d6c9af,#a4aeb9",
    adjustments: {
      brightness: 0.03,
      contrast: 0.95,
      saturation: 0.9,
      temperature: 0.05,
      blur: 2,
    },
  },
];
export function presetPatch(preset: ColorPreset, clip?: Clip): Partial<Clip> {
  return {
    adjustments: {
      ...DEFAULT_ADJUSTMENTS,
      ...clip?.adjustments,
      ...preset.adjustments,
    },
  };
}
export function fadePatch(
  kind: "visual" | "audio",
  direction: "in" | "out" | "both" | "none",
  seconds: number,
  duration = Infinity,
): Partial<Clip> {
  const value = Math.max(
    0,
    Math.min(seconds, duration / (direction === "both" ? 2 : 1)),
  );
  const incoming = direction === "in" || direction === "both" ? value : 0;
  const outgoing = direction === "out" || direction === "both" ? value : 0;
  return kind === "visual"
    ? { fadeIn: incoming, fadeOut: outgoing }
    : { audioFadeIn: incoming, audioFadeOut: outgoing };
}
export default function EffectsPanel({
  clip,
  project = { width: 1920, height: 1080 },
  kind,
  locked = false,
  onApply,
}: EffectsPanelProps) {
  const ui = useUITranslation();
  const label = useLibraryLabel();
  const [tab, setTab] = useState<"color" | "fade" | "motion">("color");
  const [seconds, setSeconds] = useState(0.5);
  const [query, setQuery] = useState("");
  const active = COLOR_PRESETS.find((p) =>
    Object.entries(p.adjustments).every(
      ([key, value]) =>
        Math.abs(clip?.adjustments[key as keyof Adjustments]! - Number(value)) <
        0.001,
    ),
  );
  const disabled = !clip || locked;
  const colorDisabled = disabled || kind === "audio" || kind === "text";
  return (
    <section className="effects-panel" aria-label={ui("本地效果库", "Local effects library")}>
      <div className="effects-title">
        <Sparkles size={15} />
        <strong> {ui("效果预设 · 16", "Effect presets · 16")} </strong>
        <span> {ui("本地处理", "Local processing")} </span>
      </div>
      <div className="effects-tabs" role="tablist" aria-label={ui("效果类型", "Effect types")}>
        <button
          role="tab"
          aria-selected={tab === "color"}
          className={tab === "color" ? "is-active" : ""}
          onClick={() => setTab("color")}
        >
          <SlidersHorizontal size={13} />  {ui("调色预设", "Color presets")} </button>
        <button
          role="tab"
          aria-selected={tab === "motion"}
          className={tab === "motion" ? "is-active" : ""}
          onClick={() => setTab("motion")}
        >
          <Sparkles size={13} />  {ui("动态特效", "Motion effects")} </button>
        <button
          role="tab"
          aria-selected={tab === "fade"}
          className={tab === "fade" ? "is-active" : ""}
          onClick={() => setTab("fade")}
        >
          <Waves size={13} />  {ui("淡入淡出", "Fades")} </button>
      </div>
      <div className="effects-content">
        <div className={`effects-selection ${disabled ? "is-empty" : ""}`}>
          <Film size={14} />
          <span>
            {clip
              ? `${clip.name}${locked ? ui(" · 轨道已锁定", " · Track locked") : ""}`
              : ui("先在时间线选择一个片段", "Select a clip on the timeline first")}
          </span>
          {clip && <ChevronRight size={12} />}
        </div>
        {tab === "motion" ? (
          <MotionLibrary
            disabled={disabled || kind === "audio"}
            onApply={(motion) => {
              if (clip) onApply(motionPatch(clip, motion, project));
            }}
          />
        ) : tab === "color" ? (
          <>
            <p className="effects-help">
              {kind === "audio"
                ? ui("音频片段可在「淡入淡出」中调整声音变化。", "Use Fades to adjust audio transitions.")
                : kind === "text"
                  ? ui("文字样式在右侧属性中编辑；「淡入淡出」可设置文字的显示变化。", "Edit text style in the properties panel. Use Fades to adjust how text appears and disappears.")
                  : ui("选择预设即应用到片段。可在右侧属性中继续微调。", "Select a preset to apply it. Fine-tune in the properties panel.")}
            </p>
            <label className="creative-search">
              <input
                aria-label={ui("搜索调色预设", "Search color presets")}
                placeholder={ui("搜索调色预设", "Search color presets")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="effects-grid">
              {COLOR_PRESETS.map(p => ({ ...p, name: label(p.name), description: label(p.description) })).filter((p) =>
                (p.name + p.description).toLowerCase().includes(query.trim().toLowerCase()),
              ).map((preset) => (
                <article
                  className="creative-card"
                  key={preset.id}
                  data-preset-id={preset.id}
                >
                  <PresetPreview
                    adjustments={preset.adjustments}
                    label={preset.name}
                  />
                  <div>
                    <span>
                      {preset.name}
                      <small>{preset.description}</small>
                    </span>
                    <button
                      disabled={colorDisabled}
                      onClick={() => onApply(presetPatch(preset, clip))}
                      aria-label={ui(`应用${preset.name}调色`, `Apply ${preset.name} color preset`)}
                      aria-pressed={!!clip && active?.id === preset.id}
                    >
                      <Check size={12} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <button
              className="effects-reset"
              disabled={colorDisabled}
              onClick={() =>
                onApply({ adjustments: { ...DEFAULT_ADJUSTMENTS } })
              }
            >
              <RotateCcw size={12} />  {ui("重置调色", "Reset color")} </button>
          </>
        ) : (
          <>
            <p className="effects-help">
               {ui("为片段边缘添加平滑变化。画面和声音可以分别设置。", "Add smooth transitions at clip edges. Set picture and sound independently.")} </p>
            <label className="effects-duration">
              <span> {ui("变化时长", "Fade duration")} </span>
              <input
                aria-label={ui("淡入淡出时长", "Fade duration")}
                type="number"
                min="0.05"
                max="10"
                step="0.05"
                value={seconds}
                onChange={(event) => {
                  const n = Number(event.target.value);
                  if (Number.isFinite(n))
                    setSeconds(Math.max(0.05, Math.min(10, n)));
                }}
              />
              <span> {ui("秒", "s")} </span>
            </label>
            {(["visual", "audio"] as const)
              .filter((channel) =>
                channel === "visual" ? kind !== "audio" : kind !== "text",
              )
              .map((kind) => (
                <div className="effects-fade-group" key={kind}>
                  <h3>
                    {kind === "visual" ? ui("画面", "Picture") : ui("声音", "Sound")}
                    <span>
                      {clip
                        ? `${kind === "visual" ? clip.fadeIn.toFixed(2) : clip.audioFadeIn.toFixed(2)}s / ${kind === "visual" ? clip.fadeOut.toFixed(2) : clip.audioFadeOut.toFixed(2)}s`
                        : ui("入 / 出", "In / Out")}
                    </span>
                  </h3>
                  <div className="effects-fade-grid">
                    {(["in", "out", "both"] as const).map((direction) => (
                      <button
                        key={direction}
                        disabled={disabled}
                        onClick={() =>
                          onApply(
                            fadePatch(kind, direction, seconds, clip?.duration),
                          )
                        }
                      >
                        <span
                          className={`effects-fade-shape shape-${direction}`}
                        />
                        <span>
                          {direction === "in"
                            ? ui("淡入", "Fade in")
                            : direction === "out"
                              ? ui("淡出", "Fade out")
                              : ui("淡入淡出", "Fades")}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="effects-reset"
                    disabled={disabled}
                    onClick={() => onApply(fadePatch(kind, "none", 0))}
                  >
                    <RotateCcw size={11} />  {ui("移除", "Remove")} {kind === "visual" ? ui("画面", "Picture") : ui("声音", "Sound")} {ui("淡入淡出", "Fades")} </button>
                </div>
              ))}
            <p className="effects-note">
               {ui("变化时长会按片段长度限制；同时淡入淡出各不超过片段的一半。", "Fade duration is limited by clip length. Combined fades each use at most half the clip.")} </p>
          </>
        )}
      </div>
      <div className="effects-footer">
        <Check size={11} />  {ui("预览与导出使用相同参数", "Preview and export use the same settings")} </div>
    </section>
  );
}
