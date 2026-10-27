import { useUITranslation } from "../i18n";
import KeyframeCurveEditor from "./KeyframeCurveEditor";
import { useEffect, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Diamond,
  FlipHorizontal2,
  FlipVertical2,
  Image,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Type,
  Volume2,
  WandSparkles,
} from "lucide-react";
import type { Clip, Keyframe, Project } from "../core/types";
import { DEFAULT_TRANSFORM, DEFAULT_ADJUSTMENTS } from "../core/defaults";
import { evaluateKeyframes, formatTime, id } from "../core/model";
import VisualTools from "./VisualTools";
import "./Inspector.css";
import { useEditorStore } from "../editor/store";
interface Props {
  project: Project;
  clip?: Clip;
  playhead: number;
  onUpdate: (patch: Partial<Clip>) => void;
  onProjectUpdate: (patch: Partial<Project>) => void;
}
function NumberField({
  label,
  value,
  min = -100000,
  max = 100000,
  step = 1,
  onChange,
  suffix,
  diamond,
  range = false,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
  diamond?: () => void;
  range?: boolean;
}) {
  const ui = useUITranslation();
  return (
    <label className="property-row">
      <span>{label}</span>
      {range && (
        <input
          className="property-range"
          aria-label={ui(`${label}滑块`, `${label} slider`)}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={() => useEditorStore.getState().beginTransaction()}
          onPointerUp={() => useEditorStore.getState().endTransaction()}
          onPointerCancel={() => useEditorStore.getState().endTransaction()}
          onKeyDown={() => useEditorStore.getState().beginTransaction()}
          onKeyUp={() => useEditorStore.getState().endTransaction()}
          onBlur={() => useEditorStore.getState().endTransaction()}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      )}
      <div className="numeric-field">
        <input
          aria-label={label}
          type="number"
          value={Number(value.toFixed(3))}
          min={min}
          max={max}
          step={step}
          onFocus={() => useEditorStore.getState().beginTransaction()}
          onBlur={() => useEditorStore.getState().endTransaction()}
          onChange={(e) => {
            if (e.target.value === "") return;
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      {diamond && (
        <button
          className="diamond-btn"
          title={ui(`添加 ${label} 关键帧`, `Add ${label} keyframe`)}
          onClick={(e) => {
            e.preventDefault();
            diamond();
          }}
        >
          <Diamond size={12} />
        </button>
      )}
    </label>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="slider-property">
      <div>
        <label>{label}</label>
        <span>{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => useEditorStore.getState().beginTransaction()}
        onPointerUp={() => useEditorStore.getState().endTransaction()}
        onPointerCancel={() => useEditorStore.getState().endTransaction()}
        onKeyDown={() => useEditorStore.getState().beginTransaction()}
        onKeyUp={() => useEditorStore.getState().endTransaction()}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
export default function Inspector({
  project,
  clip,
  playhead,
  onUpdate,
  onProjectUpdate,
}: Props) {
  const ui = useUITranslation();
  const [tab, setTab] = useState("画面"),
    [fonts, setFonts] = useState<string[]>([
      "Noto Sans SC",
      "sans-serif",
      "PingFang SC",
      "Arial",
      "Georgia",
    ]);
  useEffect(() => {
    void window.editorAPI
      ?.getFontFamilies()
      .then((fonts) => setFonts(fonts))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setTab(
      clip?.text
        ? "文本"
        : project.assets.find((a) => a.id === clip?.assetId)?.kind === "audio"
          ? "音频"
          : "画面",
    );
  }, [clip?.id, !!clip?.text]);
  if (!clip)
    return (
      <aside className="inspector panel">
        <div className="panel-heading">
          <span>{ui("项目参数", "Project properties")}</span>
          <SlidersHorizontal size={16} />
        </div>
        <div className="inspector-content">
          <h3>{ui("画布设置", "Canvas settings")}</h3>
          <label className="stacked-label">
            {ui("项目名称", "Project name")}<input
              value={project.name}
              onFocus={() => useEditorStore.getState().beginTransaction()}
              onBlur={() => useEditorStore.getState().endTransaction()}
              onChange={(e) => onProjectUpdate({ name: e.target.value })}
            />
          </label>
          <label className="property-row">
            <span>{ui("画面比例", "Aspect ratio")}</span>
            <select
              aria-label={ui("画面比例", "Aspect ratio")}
              value={`${project.width}:${project.height}`}
              onChange={(e) => {
                const [width, height] = e.target.value.split(":").map(Number);
                onProjectUpdate({ width, height });
              }}
            >
              {![
                "1920:1080",
                "1080:1920",
                "1080:1080",
                "1440:1080",
                "2560:1440",
                "3840:2160",
              ].includes(`${project.width}:${project.height}`) && (
                <option value={`${project.width}:${project.height}`}>
                  {ui("自定义", "Custom")}</option>
              )}
              <option value="1920:1080">{ui("16:9 · 横屏", "16:9 · Landscape")}</option>
              <option value="1080:1920">{ui("9:16 · 竖屏", "9:16 · Portrait")}</option>
              <option value="1080:1080">{ui("1:1 · 方形", "1:1 · Square")}</option>
              <option value="1440:1080">{ui("4:3 · 经典", "4:3 · Classic")}</option>
              <option value="2560:1440">16:9 · 2K</option>
              <option value="3840:2160">16:9 · 4K</option>
            </select>
          </label>
          <NumberField
            label={ui("宽度", "Width")}
            value={project.width}
            min={16}
            max={7680}
            step={2}
            suffix="px"
            onChange={(width) => onProjectUpdate({ width })}
          />
          <NumberField
            label={ui("高度", "Height")}
            value={project.height}
            min={16}
            max={7680}
            step={2}
            suffix="px"
            onChange={(height) => onProjectUpdate({ height })}
          />
          <label className="property-row">
            <span>{ui("帧率", "Frame rate")}</span>
            <select
              aria-label={ui("帧率", "Frame rate")}
              value={project.fps}
              onChange={(e) => onProjectUpdate({ fps: Number(e.target.value) })}
            >
              {[24, 25, 30, 50, 60].map((fps) => (
                <option key={fps} value={fps}>
                  {fps} fps
                </option>
              ))}
            </select>
          </label>
          <label className="property-row">
            <span>{ui("背景颜色", "Background color")}</span>
            <input
              aria-label={ui("背景颜色", "Background color")}
              type="color"
              value={project.background}
              onChange={(e) => onProjectUpdate({ background: e.target.value })}
            />
            <code>{project.background}</code>
          </label>
          <div className="inspector-guide">
            <Image size={30} />
            <p>{ui("选择时间线片段", "Select a timeline clip")}</p>
            <span>{ui("在这里调整画面、音频、文字和动画", "Adjust picture, audio, text and animation here")}</span>
          </div>
          <div className="offline-note">
            <span className="status-dot" />
            {ui("素材留在本机，项目完全离线", "Media stays on your device. Projects are entirely offline.")}</div>
        </div>
      </aside>
    );
  const track = project.tracks.find((t) => t.id === clip.trackId)!,
    asset = project.assets.find((a) => a.id === clip.assetId);
  const local = Math.max(0, Math.min(clip.duration, playhead - clip.start)),
    evaluated = evaluateKeyframes(clip, local),
    locked = track.locked;
  const key = (property: Keyframe["property"], value: number) => {
    const at = Math.min(
      clip.duration,
      Math.round(local * project.fps) / project.fps,
    );
    const existing = clip.keyframes.find(
      (k) =>
        k.property === property && Math.abs(k.time - at) < 0.5 / project.fps,
    );
    onUpdate({
      keyframes: existing
        ? clip.keyframes.filter((k) => k.id !== existing.id)
        : [
            ...clip.keyframes,
            { id: id(), property, time: at, value, easing: "linear" },
          ],
    });
  };
  const animate = (property: Keyframe["property"], value: number) => {
    if (clip.keyframes.some((k) => k.property === property)) {
      const at = Math.min(
          clip.duration,
          Math.round(local * project.fps) / project.fps,
        ),
        existing = clip.keyframes.find(
          (k) =>
            k.property === property &&
            Math.abs(k.time - at) < 0.5 / project.fps,
        );
      onUpdate({
        keyframes: existing
          ? clip.keyframes.map((k) =>
              k.id === existing.id ? { ...k, value } : k,
            )
          : [
              ...clip.keyframes,
              { id: id(), property, time: at, value, easing: "linear" },
            ],
      });
    } else if (property === "volume") onUpdate({ volume: value });
    else onUpdate({ transform: { ...clip.transform, [property]: value } });
  };
  const visual = asset?.kind !== "audio";
  const pictureTabs = ["画面", "裁剪", "抠像", "蒙版"];
  const pictureActive = pictureTabs.includes(tab);
  const tabs = clip.text
    ? ["文本", "画面", "动画", "速度"]
    : visual
      ? ["画面", "音频", "速度", "动画", "调色"]
      : ["音频", "速度", "动画"];
  const tabLabel = (value: string) =>
    ui(value === "速度" ? "变速" : value === "调色" ? "调整" : value,
      ({ "画面": "Picture", "裁剪": "Crop", "抠像": "Chroma key", "蒙版": "Mask", "文本": "Text", "动画": "Animation", "速度": "Speed", "音频": "Audio", "调色": "Adjust" } as Record<string, string>)[value] ?? value);
  return (
    <aside className="inspector panel">
      <div className="inspector-tabs">
        <nav className="inspector-main-tabs" aria-label={ui("片段属性", "Clip properties")}>
          {tabs.map((t) => (
            <button
              key={t}
              aria-label={ui(t, tabLabel(t))}
              aria-pressed={tab === t || (t === "画面" && pictureActive)}
              className={tab === t || (t === "画面" && pictureActive) ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {tabLabel(t)}
            </button>
          ))}
        </nav>
        {visual && !clip.text && (
          <nav className="inspector-picture-tabs" aria-label={ui("画面工具", "Picture tools")} hidden={!pictureActive}>
            {pictureTabs.map((t) => (
              <button
                key={t}
                aria-label={t === "画面" ? ui("基础画面", "Basic picture") : tabLabel(t)}
                aria-pressed={tab === t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t === "画面" ? ui("基础", "Basic") : tabLabel(t)}
              </button>
            ))}
          </nav>
        )}
      </div>
      <div className="inspector-content">
        <div className="clip-info">
          <strong>{clip.name}</strong>
          <span>
            {track.name} · {formatTime(clip.duration, project.fps)}
          </span>
        </div>
        {locked && (
          <div className="inline-warning">{ui("轨道已锁定，解锁后可编辑", "Track locked. Unlock it to edit.")}</div>
        )}
        <fieldset disabled={locked}>
          {["裁剪", "抠像", "蒙版"].includes(tab) && (
            <VisualTools
              mode={
                tab === "裁剪" ? "crop" : tab === "抠像" ? "chroma" : "mask"
              }
              clip={clip}
              asset={asset}
              onUpdate={onUpdate}
              locked={locked}
            />
          )}
          {tab === "画面" && (
            <>
              <div className="section-title">
                <h3>{ui("位置大小", "Position and size")}</h3>
                <button
                  title={ui("重置变换", "Reset transform")}
                  onClick={() =>
                    onUpdate({
                      transform: { ...DEFAULT_TRANSFORM },
                      keyframes: clip.keyframes.filter(
                        (k) => k.property === "volume",
                      ),
                    })
                  }
                >
                  <RotateCcw size={13} />
                </button>
              </div>
              <NumberField
                label={ui("缩放", "Scale")}
                range
                value={evaluated.transform.scale * 100}
                min={1}
                max={1000}
                suffix="%"
                onChange={(v) => animate("scale", v / 100)}
                diamond={() => key("scale", evaluated.transform.scale)}
              />
              <div className="position-fields">
              <NumberField
                label={ui("位置 X", "Position X")}
                value={evaluated.transform.x}
                onChange={(v) => animate("x", v)}
                diamond={() => key("x", evaluated.transform.x)}
              />
              <NumberField
                label={ui("位置 Y", "Position Y")}
                value={evaluated.transform.y}
                onChange={(v) => animate("y", v)}
                diamond={() => key("y", evaluated.transform.y)}
              />
              </div>
              <NumberField
                label={ui("旋转", "Rotation")}
                value={evaluated.transform.rotation}
                min={-3600}
                max={3600}
                suffix="°"
                onChange={(v) => animate("rotation", v)}
                diamond={() => key("rotation", evaluated.transform.rotation)}
              />
              <NumberField
                label={ui("不透明度", "Opacity")}
                value={evaluated.transform.opacity * 100}
                min={0}
                max={100}
                suffix="%"
                onChange={(v) => animate("opacity", v / 100)}
                diamond={() => key("opacity", evaluated.transform.opacity)}
              />
              <div className="property-row">
                <span>{ui("翻转", "Flip")}</span>
                <div className="segmented">
                  <button
                    className={clip.transform.flipX ? "active" : ""}
                    title={ui("水平翻转", "Flip horizontal")}
                    onClick={() =>
                      onUpdate({
                        transform: {
                          ...clip.transform,
                          flipX: !clip.transform.flipX,
                        },
                      })
                    }
                  >
                    <FlipHorizontal2 size={17} />
                  </button>
                  <button
                    className={clip.transform.flipY ? "active" : ""}
                    title={ui("垂直翻转", "Flip vertical")}
                    onClick={() =>
                      onUpdate({
                        transform: {
                          ...clip.transform,
                          flipY: !clip.transform.flipY,
                        },
                      })
                    }
                  >
                    <FlipVertical2 size={17} />
                  </button>
                </div>
              </div>
              <h3>{ui("画面淡入淡出", "Video fades")}</h3>
              <NumberField
                label={ui("画面淡入", "Video fade in")}
                value={clip.fadeIn}
                min={0}
                max={clip.duration}
                step={0.1}
                suffix="s"
                onChange={(fadeIn) => onUpdate({ fadeIn })}
              />
              <NumberField
                label={ui("画面淡出", "Video fade out")}
                value={clip.fadeOut}
                min={0}
                max={clip.duration}
                step={0.1}
                suffix="s"
                onChange={(fadeOut) => onUpdate({ fadeOut })}
              />
            </>
          )}
          {tab === "音频" && (
            <>
              <h3>{ui("音量", "Volume")}</h3>
              <NumberField
                label={ui("音量", "Volume")}
                value={evaluated.volume * 100}
                min={0}
                max={400}
                suffix="%"
                onChange={(v) => animate("volume", v / 100)}
                diamond={() => key("volume", evaluated.volume)}
              />
              <label className="toggle-property">
                <span>{ui("片段静音", "Mute clip")}</span>
                <input
                  aria-label={ui("片段静音", "Mute clip")}
                  type="checkbox"
                  checked={clip.muted}
                  onChange={(e) => onUpdate({ muted: e.target.checked })}
                />
              </label>
              <h3>{ui("声音淡入淡出", "Audio fades")}</h3>
              <NumberField
                label={ui("声音淡入", "Audio fade in")}
                value={clip.audioFadeIn}
                min={0}
                max={clip.duration}
                step={0.1}
                suffix="s"
                onChange={(audioFadeIn) => onUpdate({ audioFadeIn })}
              />
              <NumberField
                label={ui("声音淡出", "Audio fade out")}
                value={clip.audioFadeOut}
                min={0}
                max={clip.duration}
                step={0.1}
                suffix="s"
                onChange={(audioFadeOut) => onUpdate({ audioFadeOut })}
              />
              {!asset?.hasAudio && (
                <p className="muted">{ui("这段素材没有音频流。", "This media has no audio stream.")}</p>
              )}
            </>
          )}
          {tab === "调色" && (
            <>
              <div className="section-title">
                <h3>{ui("基础调整", "Basic adjustments")}</h3>
                <button
                  title={ui("重置调色", "Reset color adjustments")}
                  onClick={() =>
                    onUpdate({ adjustments: { ...DEFAULT_ADJUSTMENTS } })
                  }
                >
                  <RotateCcw size={13} />
                </button>
              </div>
              <Slider
                label={ui("亮度", "Brightness")}
                value={clip.adjustments.brightness}
                min={-1}
                max={1}
                onChange={(v) =>
                  onUpdate({
                    adjustments: { ...clip.adjustments, brightness: v },
                  })
                }
              />
              <Slider
                label={ui("对比度", "Contrast")}
                value={clip.adjustments.contrast}
                min={0}
                max={3}
                onChange={(v) =>
                  onUpdate({
                    adjustments: { ...clip.adjustments, contrast: v },
                  })
                }
              />
              <Slider
                label={ui("饱和度", "Saturation")}
                value={clip.adjustments.saturation}
                min={0}
                max={3}
                onChange={(v) =>
                  onUpdate({
                    adjustments: { ...clip.adjustments, saturation: v },
                  })
                }
              />
              <Slider
                label={ui("色温", "Temperature")}
                value={clip.adjustments.temperature}
                min={-1}
                max={1}
                onChange={(v) =>
                  onUpdate({
                    adjustments: { ...clip.adjustments, temperature: v },
                  })
                }
              />
              <Slider
                label={ui("模糊", "Blur")}
                value={clip.adjustments.blur}
                min={0}
                max={100}
                step={1}
                onChange={(v) =>
                  onUpdate({ adjustments: { ...clip.adjustments, blur: v } })
                }
              />
              <p className="field-hint">
                {ui("预览与导出使用相同的 RGB\n                调整模型，编码与色彩转换可能产生轻微差异。", "Preview and export use the same RGB adjustment model. Encoding and color conversion may cause slight differences.")}</p>
            </>
          )}
          {tab === "文本" && clip.text && (
            <>
              <h3>{ui("文字内容", "Text content")}</h3>
              <textarea
                aria-label={ui("文字内容", "Text content")}
                value={clip.text.text}
                rows={4}
                onFocus={() => useEditorStore.getState().beginTransaction()}
                onBlur={() => useEditorStore.getState().endTransaction()}
                onChange={(e) =>
                  onUpdate({
                    name: e.target.value.slice(0, 30) || ui("文本", "Text"),
                    text: { ...clip.text!, text: e.target.value },
                  })
                }
              />
              <label className="property-row">
                <span>{ui("字体", "Font")}</span>
                <select
                  aria-label={ui("字体", "Font")}
                  value={clip.text.fontFamily}
                  onChange={(e) =>
                    onUpdate({
                      text: { ...clip.text!, fontFamily: e.target.value },
                    })
                  }
                >
                  <option value="sans-serif">{ui("系统默认", "System default")}</option>
                  {fonts
                    .filter((f) => f !== "sans-serif")
                    .map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                </select>
              </label>
              <NumberField
                label={ui("字号", "Font size")}
                value={clip.text.fontSize}
                min={1}
                max={1000}
                suffix="px"
                onChange={(fontSize) =>
                  onUpdate({ text: { ...clip.text!, fontSize } })
                }
              />
              <label className="property-row">
                <span>{ui("文字颜色", "Text color")}</span>
                <input
                  aria-label={ui("文字颜色", "Text color")}
                  type="color"
                  value={clip.text.color}
                  onChange={(e) =>
                    onUpdate({ text: { ...clip.text!, color: e.target.value } })
                  }
                />
                <button
                  className={clip.text.bold ? "active" : ""}
                  title={ui("加粗", "Bold")}
                  onClick={() =>
                    onUpdate({
                      text: { ...clip.text!, bold: !clip.text!.bold },
                    })
                  }
                >
                  <b>B</b>
                </button>
              </label>
              <div className="property-row">
                <span>{ui("对齐", "Alignment")}</span>
                <div className="segmented">
                  {(["left", "center", "right"] as const).map((align, i) => (
                    <button
                      key={align}
                      title={[ui("左对齐", "Align left"), ui("居中", "Center"), ui("右对齐", "Align right")][i]}
                      className={clip.text!.align === align ? "active" : ""}
                      onClick={() =>
                        onUpdate({ text: { ...clip.text!, align } })
                      }
                    >
                      {i === 0 ? (
                        <AlignLeft size={16} />
                      ) : i === 1 ? (
                        <AlignCenter size={16} />
                      ) : (
                        <AlignRight size={16} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <h3>{ui("描边与背景", "Outline and background")}</h3>
              <label className="property-row">
                <span>{ui("描边颜色", "Outline color")}</span>
                <input
                  aria-label={ui("描边颜色", "Outline color")}
                  type="color"
                  value={clip.text.stroke}
                  onChange={(e) =>
                    onUpdate({
                      text: { ...clip.text!, stroke: e.target.value },
                    })
                  }
                />
              </label>
              <NumberField
                label={ui("描边宽度", "Outline width")}
                value={clip.text.strokeWidth}
                min={0}
                max={100}
                onChange={(strokeWidth) =>
                  onUpdate({ text: { ...clip.text!, strokeWidth } })
                }
              />
              <label className="toggle-property">
                <span>{ui("文字背景", "Text background")}</span>
                <input
                  type="checkbox"
                  aria-label={ui("文字背景", "Text background")}
                  checked={clip.text.background !== "transparent"}
                  onChange={(e) =>
                    onUpdate({
                      text: {
                        ...clip.text!,
                        background: e.target.checked
                          ? "#15151c"
                          : "transparent",
                      },
                    })
                  }
                />
              </label>
              {clip.text.background !== "transparent" && (
                <input
                  type="color"
                  aria-label={ui("文字背景颜色", "Text background color")}
                  value={clip.text.background}
                  onChange={(e) =>
                    onUpdate({
                      text: { ...clip.text!, background: e.target.value },
                    })
                  }
                />
              )}
            </>
          )}
          {tab === "速度" && (
            <>
              <h3>{ui("常规变速", "Constant speed")}</h3>
              <NumberField
                label={ui("播放速度", "Playback speed")}
                value={clip.speed}
                min={0.1}
                max={8}
                step={0.1}
                suffix="×"
                onChange={(speed) => onUpdate({ speed })}
              />
              <div className="speed-presets">
                {[0.25, 0.5, 1, 1.5, 2, 4].map((speed) => (
                  <button
                    key={speed}
                    className={clip.speed === speed ? "active" : ""}
                    onClick={() => onUpdate({ speed })}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
              <p className="field-hint">
                {ui("更改变速会保留源素材范围并调整片段时长。音频保持音高。", "Changing speed preserves the source range and adjusts clip duration. Audio pitch is preserved.")}</p>
              <h3>{ui("时间范围", "Time range")}</h3>
              <NumberField
                label={ui("开始时间", "Start time")}
                value={clip.start}
                min={0}
                step={1 / project.fps}
                suffix="s"
                onChange={(start) => onUpdate({ start })}
              />
              <NumberField
                label={ui("源素材入点", "Source in point")}
                value={clip.sourceIn}
                min={0}
                max={Math.max(
                  0,
                  (asset?.duration ?? 0) - clip.duration * clip.speed,
                )}
                step={1 / project.fps}
                suffix="s"
                onChange={(sourceIn) => onUpdate({ sourceIn })}
              />
              <p className="muted small">
                {ui("在时间线上拖动片段两侧，可以裁剪入点和出点。", "Drag either edge of a timeline clip to trim its in and out points.")}</p>
            </>
          )}
          {tab === "动画" && (
            <>
              <KeyframeCurveEditor
                key={clip.id}
                project={project}
                clip={clip}
                playhead={playhead}
                visual={visual}
                onUpdate={onUpdate}
              />
              <h3>{ui("关键帧列表", "Keyframe list")}</h3>
              <p className="field-hint">
                {ui("把播放头移动到目标时间，点击属性旁的 ◇\n                添加关键帧；该属性后续调整会写入当前时间。", "Move the playhead to the desired time and click ◇ beside a property to add a keyframe. Subsequent edits to that property are recorded at the current time.")}</p>
              <div className="keyframe-add">
                {(["x", "y", "scale", "rotation", "opacity", "volume"] as const)
                  .filter((property) => visual || property === "volume")
                  .map((property) => (
                    <button
                      key={property}
                      onClick={() =>
                        key(
                          property,
                          property === "volume"
                            ? evaluated.volume
                            : evaluated.transform[property],
                        )
                      }
                    >
                      <Diamond size={11} />
                      {
                        {
                          x: ui("位置 X", "Position X"),
                          y: ui("位置 Y", "Position Y"),
                          scale: ui("缩放", "Scale"),
                          rotation: ui("旋转", "Rotation"),
                          opacity: ui("透明度", "Opacity"),
                          volume: ui("音量", "Volume"),
                        }[property]
                      }
                    </button>
                  ))}
              </div>
              {!clip.keyframes.length && (
                <div className="quiet-empty">{ui("还没有关键帧", "No keyframes yet")}</div>
              )}
              {[...clip.keyframes]
                .sort((a, b) => a.time - b.time)
                .map((k) => (
                  <div key={k.id} className="keyframe-row">
                    <button
                      className="keyframe-time"
                      onClick={() =>
                        useEditorStore.getState().seek(clip.start + k.time)
                      }
                    >
                      {formatTime(k.time, project.fps)}
                    </button>
                    <span>{k.property}</span>
                    <input
                      aria-label={ui(`关键帧 ${k.property} 值`, `${k.property} keyframe value`)}
                      type="number"
                      step={0.01}
                      value={k.value}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (
                          Number.isFinite(value) &&
                          !(
                            k.property === "opacity" &&
                            (value < 0 || value > 1)
                          ) &&
                          !(
                            k.property === "scale" &&
                            (value <= 0 || value > 10)
                          ) &&
                          !(k.property === "volume" && (value < 0 || value > 4))
                        )
                          onUpdate({
                            keyframes: clip.keyframes.map((key) =>
                              key.id === k.id ? { ...key, value } : key,
                            ),
                          });
                      }}
                    />
                    <select
                      aria-label={ui("关键帧插值", "Keyframe interpolation")}
                      value={k.easing}
                      onChange={(e) =>
                        onUpdate({
                          keyframes: clip.keyframes.map((key) =>
                            key.id === k.id
                              ? {
                                  ...key,
                                  easing: e.target.value as Keyframe["easing"],
                                  easingWindow: undefined,
                                }
                              : key,
                          ),
                        })
                      }
                    >
                      <option value="linear">{ui("线性", "Linear")}</option>
                      <option value="easeIn">{ui("缓入", "Ease in")}</option>
                      <option value="easeOut">{ui("缓出", "Ease out")}</option>
                      <option value="easeInOut">{ui("缓入缓出", "Ease in/out")}</option>
                    </select>
                    <button
                      aria-label={ui("删除关键帧", "Delete keyframe")}
                      onClick={() =>
                        onUpdate({
                          keyframes: clip.keyframes.filter(
                            (key) => key.id !== k.id,
                          ),
                        })
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
            </>
          )}
        </fieldset>
      </div>
    </aside>
  );
}
