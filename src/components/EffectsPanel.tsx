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
import type { Adjustments, Clip, TrackKind } from "../core/types";
import { DEFAULT_ADJUSTMENTS } from "../core/defaults";
import "./EffectsPanel.css";

export interface EffectsPanelProps {
  clip?: Clip;
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
  kind,
  locked = false,
  onApply,
}: EffectsPanelProps) {
  const [tab, setTab] = useState<"color" | "fade">("color");
  const [seconds, setSeconds] = useState(0.5);
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
    <section className="effects-panel" aria-label="本地效果库">
      <div className="effects-title">
        <Sparkles size={15} />
        <strong>效果</strong>
        <span>本地处理</span>
      </div>
      <div className="effects-tabs" role="tablist" aria-label="效果类型">
        <button
          role="tab"
          aria-selected={tab === "color"}
          className={tab === "color" ? "is-active" : ""}
          onClick={() => setTab("color")}
        >
          <SlidersHorizontal size={13} /> 调色预设
        </button>
        <button
          role="tab"
          aria-selected={tab === "fade"}
          className={tab === "fade" ? "is-active" : ""}
          onClick={() => setTab("fade")}
        >
          <Waves size={13} /> 淡入淡出
        </button>
      </div>
      <div className="effects-content">
        <div className={`effects-selection ${disabled ? "is-empty" : ""}`}>
          <Film size={14} />
          <span>
            {clip
              ? `${clip.name}${locked ? " · 轨道已锁定" : ""}`
              : "先在时间线选择一个片段"}
          </span>
          {clip && <ChevronRight size={12} />}
        </div>
        {tab === "color" ? (
          <>
            <p className="effects-help">
              {kind === "audio"
                ? "音频片段可在「淡入淡出」中调整声音变化。"
                : kind === "text"
                  ? "文字样式在右侧属性中编辑；「淡入淡出」可设置文字的显示变化。"
                  : "选择预设即应用到片段。可在右侧属性中继续微调。"}
            </p>
            <div className="effects-grid">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  disabled={colorDisabled}
                  className={`effects-preset ${clip && active?.id === preset.id ? "is-active" : ""}`}
                  onClick={() => onApply(presetPatch(preset, clip))}
                  title={preset.description}
                  aria-label={`应用${preset.name}调色`}
                  aria-pressed={!!clip && active?.id === preset.id}
                >
                  <span
                    className="effects-swatch"
                    style={{
                      background: `linear-gradient(145deg, ${preset.colors})`,
                    }}
                  >
                    <span className="effects-landscape" />
                    {clip && active?.id === preset.id && (
                      <i>
                        <Check size={12} />
                      </i>
                    )}
                  </span>
                  <span className="effects-preset-name">{preset.name}</span>
                </button>
              ))}
            </div>
            <button
              className="effects-reset"
              disabled={colorDisabled}
              onClick={() =>
                onApply({ adjustments: { ...DEFAULT_ADJUSTMENTS } })
              }
            >
              <RotateCcw size={12} /> 重置调色
            </button>
          </>
        ) : (
          <>
            <p className="effects-help">
              为片段边缘添加平滑变化。画面和声音可以分别设置。
            </p>
            <label className="effects-duration">
              <span>变化时长</span>
              <input
                aria-label="淡入淡出时长"
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
              <span>秒</span>
            </label>
            {(["visual", "audio"] as const)
              .filter((channel) =>
                channel === "visual" ? kind !== "audio" : kind !== "text",
              )
              .map((kind) => (
                <div className="effects-fade-group" key={kind}>
                  <h3>
                    {kind === "visual" ? "画面" : "声音"}
                    <span>
                      {clip
                        ? `${kind === "visual" ? clip.fadeIn.toFixed(2) : clip.audioFadeIn.toFixed(2)}s / ${kind === "visual" ? clip.fadeOut.toFixed(2) : clip.audioFadeOut.toFixed(2)}s`
                        : "入 / 出"}
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
                            ? "淡入"
                            : direction === "out"
                              ? "淡出"
                              : "淡入淡出"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="effects-reset"
                    disabled={disabled}
                    onClick={() => onApply(fadePatch(kind, "none", 0))}
                  >
                    <RotateCcw size={11} /> 移除
                    {kind === "visual" ? "画面" : "声音"}淡入淡出
                  </button>
                </div>
              ))}
            <p className="effects-note">
              变化时长会按片段长度限制；同时淡入淡出各不超过片段的一半。
            </p>
          </>
        )}
      </div>
      <div className="effects-footer">
        <Check size={11} /> 预览与导出使用相同参数
      </div>
    </section>
  );
}
