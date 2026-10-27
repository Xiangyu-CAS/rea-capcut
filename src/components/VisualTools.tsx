import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState } from "react";
import {
  Circle,
  Crop,
  Droplets,
  LockKeyhole,
  RotateCcw,
  Scan,
  Square,
} from "lucide-react";
import type {
  ChromaKey,
  Clip,
  CropRect,
  MediaAsset,
  ShapeMask,
} from "../core/types";
import { useEditorStore } from "../editor/store";
import { getCropPixels } from "../core/visual";
import "./VisualTools.css";

export interface VisualToolsProps {
  mode: "crop" | "chroma" | "mask";
  clip: Clip;
  asset?: MediaAsset;
  onUpdate: (patch: Partial<Clip>) => void;
  locked?: boolean;
}
export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };
export const DEFAULT_CHROMA: ChromaKey = {
  enabled: true,
  color: "#00ff00",
  similarity: 0.1,
  blend: 0.05,
};
export const DEFAULT_MASK: ShapeMask = {
  shape: "rectangle",
  width: 1,
  height: 1,
  feather: 0,
  invert: false,
};
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
/** Largest centered source crop matching a pixel aspect ratio. */
export function centeredCrop(
  sourceWidth: number,
  sourceHeight: number,
  ratio: number,
): CropRect {
  if (
    ![sourceWidth, sourceHeight, ratio].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return { ...FULL_CROP };
  const aspect = sourceWidth / sourceHeight;
  const width = aspect > ratio ? ratio / aspect : 1;
  const height = aspect < ratio ? aspect / ratio : 1;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
export function updateCropField(
  crop: CropRect,
  field: keyof CropRect,
  value: number,
): CropRect {
  if (!Number.isFinite(value)) return crop;
  const next = { ...crop };
  if (field === "x") next.x = clamp(value, 0, 1 - next.width);
  if (field === "y") next.y = clamp(value, 0, 1 - next.height);
  if (field === "width") next.width = clamp(value, 0.01, 1 - next.x);
  if (field === "height") next.height = clamp(value, 0.01, 1 - next.y);
  return next;
}
function useTransaction() {
  const open = useRef(false);
  const begin = () => {
    if (!open.current) {
      useEditorStore.getState().beginTransaction();
      open.current = true;
    }
  };
  const end = () => {
    if (open.current) {
      useEditorStore.getState().endTransaction();
      open.current = false;
    }
  };
  useEffect(
    () => () => {
      if (open.current) useEditorStore.getState().endTransaction();
    },
    [],
  );
  return { begin, end };
}
function NumberControl({
  label,
  value,
  min = 0,
  max = 100,
  step = 0.1,
  suffix = "%",
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const transaction = useTransaction();
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  const focused = useRef(false);
  const draftRef = useRef(draft);
  useEffect(() => {
    if (!focused.current) {
      const next = String(Number(value.toFixed(3)));
      draftRef.current = next;
      setDraft(next);
    }
  }, [value]);
  return (
    <label className="visual-number">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onFocus={() => {
            focused.current = true;
            const next = String(Number(value.toFixed(3)));
            draftRef.current = next;
            setDraft(next);
            transaction.begin();
          }}
          onChange={(event) => {
            const raw = event.target.value;
            draftRef.current = raw;
            setDraft(raw);
            if (raw.trim() !== "" && Number.isFinite(Number(raw)))
              onChange(clamp(Number(raw), min, max));
          }}
          onBlur={() => {
            focused.current = false;
            const parsed =
              draftRef.current.trim() === "" ? value : Number(draftRef.current);
            const next = Number.isFinite(parsed)
              ? clamp(parsed, min, max)
              : value;
            draftRef.current = String(Number(next.toFixed(3)));
            setDraft(draftRef.current);
            onChange(next);
            transaction.end();
          }}
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </label>
  );
}
function RangeControl({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  percent = true,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  percent?: boolean;
}) {
  const transaction = useTransaction();
  return (
    <label className="visual-range">
      <div>
        <span>{label}</span>
        <output>
          {percent ? `${Math.round(value * 100)}%` : value.toFixed(2)}
        </output>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onFocus={transaction.begin}
        onBlur={transaction.end}
        onPointerDown={transaction.begin}
        onPointerUp={transaction.end}
        onPointerCancel={transaction.end}
        onKeyDown={transaction.begin}
        onKeyUp={transaction.end}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
function ColorControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const ui = useUITranslation();
  const transaction = useTransaction();
  return (
    <label className="visual-color">
      <span>{ui("目标颜色", "Target color")}</span>
      <input
        aria-label={ui("目标颜色", "Target color")}
        type="color"
        value={value}
        onFocus={transaction.begin}
        onBlur={transaction.end}
        onChange={(event) => onChange(event.target.value)}
      />
      <code>{value.toUpperCase()}</code>
    </label>
  );
}
export default function VisualTools({
  mode,
  clip,
  asset,
  onUpdate,
  locked = false,
}: VisualToolsProps) {
  const ui = useUITranslation();
  const [preset, setPreset] = useState("custom");
  useEffect(() => setPreset("custom"), [clip.id, mode]);
  const crop = clip.crop ?? FULL_CROP,
    chroma = clip.chromaKey ?? DEFAULT_CHROMA,
    mask = clip.mask ?? DEFAULT_MASK;
  const cropEnabled = !!clip.crop,
    chromaEnabled = !!clip.chromaKey?.enabled,
    maskEnabled = !!clip.mask;
  const updateChroma = (patch: Partial<ChromaKey>) =>
    onUpdate({ chromaKey: { ...chroma, ...patch } });
  const updateMask = (patch: Partial<ShapeMask>) =>
    onUpdate({ mask: { ...mask, ...patch } });
  const cropPixels = asset ? getCropPixels(asset, crop) : undefined;
  const cropHint =
    asset && asset.width > 0 && asset.height > 0
      ? `${cropPixels!.width} × ${cropPixels!.height} px`
      : ui("源素材范围", "Source media range");
  const sourceAspect =
    asset && asset.width > 0 && asset.height > 0
      ? asset.width / asset.height
      : 16 / 9;
  const diagramWidth = Math.min(240, 110 * sourceAspect);
  const title =
    mode === "crop"
      ? ui("源画面裁剪", "Source crop")
      : mode === "chroma"
        ? ui("色度抠像", "Chroma key")
        : ui("形状蒙版", "Shape mask");
  return (
    <section className="visual-tools" aria-label={title}>
      <div className="visual-tools-heading">
        {mode === "crop" ? (
          <Crop size={14} />
        ) : mode === "chroma" ? (
          <Droplets size={14} />
        ) : (
          <Scan size={14} />
        )}
        <h3>{title}</h3>
        {locked && <LockKeyhole size={12} />}
      </div>
      {locked && <p className="visual-locked">{ui("轨道已锁定，解锁后可编辑。", "Track locked. Unlock it to edit.")}</p>}
      <fieldset disabled={locked}>
        {mode === "crop" && (
          <>
            <label className="visual-toggle">
              <span>{ui("启用画面裁剪", "Enable crop")}</span>
              <input
                aria-label={ui("启用画面裁剪", "Enable crop")}
                type="checkbox"
                checked={cropEnabled}
                onChange={(event) =>
                  onUpdate({
                    crop: event.target.checked ? { ...FULL_CROP } : undefined,
                  })
                }
              />
            </label>
            <p className="visual-description">
              {ui("保留源画面的选中范围，并按画布比例适配。百分比以源素材为基准。", "Keep the selected source region and fit it to the canvas. Percentages are relative to the source media.")}</p>
            <fieldset disabled={!cropEnabled} className="visual-controls">
              <label className="visual-ratio">
                <span>{ui("居中比例", "Centered aspect ratio")}</span>
                <select
                  aria-label={ui("裁剪比例", "Crop aspect ratio")}
                  value={preset}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPreset(value);
                    if (value !== "custom") {
                      const [w, h] = value.split(":").map(Number);
                      onUpdate({
                        crop: centeredCrop(
                          asset?.width ?? 1,
                          asset?.height ?? 1,
                          w / h,
                        ),
                      });
                    }
                  }}
                >
                  <option value="custom">{ui("自定义范围", "Custom region")}</option>
                  <option value="1:1">{ui("1:1 · 方形", "1:1 · Square")}</option>
                  <option value="16:9">{ui("16:9 · 横屏", "16:9 · Landscape")}</option>
                  <option value="4:3">{ui("4:3 · 经典", "4:3 · Classic")}</option>
                  <option value="9:16">{ui("9:16 · 竖屏", "9:16 · Portrait")}</option>
                </select>
              </label>
              <div
                className="visual-crop-diagram"
                aria-hidden="true"
                style={{
                  width: diagramWidth,
                  height: diagramWidth / sourceAspect,
                  aspectRatio: sourceAspect,
                }}
              >
                <div
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`,
                    height: `${crop.height * 100}%`,
                  }}
                >
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="visual-numbers-grid">
                {(["width", "height", "x", "y"] as const).map((field) => (
                  <NumberControl
                    key={field}
                    label={
                      {
                        width: ui("裁剪宽度", "Crop width"),
                        height: ui("裁剪高度", "Crop height"),
                        x: ui("左侧位置", "Left position"),
                        y: ui("顶部位置", "Top position"),
                      }[field]
                    }
                    value={crop[field] * 100}
                    min={field === "width" || field === "height" ? 1 : 0}
                    max={
                      (field === "x"
                        ? 1 - crop.width
                        : field === "y"
                          ? 1 - crop.height
                          : field === "width"
                            ? 1 - crop.x
                            : 1 - crop.y) * 100
                    }
                    onChange={(value) => {
                      setPreset("custom");
                      onUpdate({
                        crop: updateCropField(crop, field, value / 100),
                      });
                    }}
                  />
                ))}
              </div>
              <div className="visual-summary">
                <Crop size={11} />
                <span>{cropHint}</span>
                <span>
                  {(
                    (crop.width * (asset?.width ?? 1)) /
                    (crop.height * (asset?.height ?? 1))
                  ).toFixed(2)}
                  :1
                </span>
              </div>
            </fieldset>
            <button
              className="visual-reset"
              disabled={!cropEnabled}
              onClick={() => {
                setPreset("custom");
                onUpdate({ crop: undefined });
              }}
            >
              <RotateCcw size={12} />
              {ui("重置为完整画面", "Reset to full frame")}</button>
          </>
        )}
        {mode === "chroma" && (
          <>
            <label className="visual-toggle">
              <span>{ui("启用色度抠像", "Enable chroma key")}</span>
              <input
                aria-label={ui("启用色度抠像", "Enable chroma key")}
                type="checkbox"
                checked={chromaEnabled}
                onChange={(event) =>
                  onUpdate({
                    chromaKey: event.target.checked
                      ? { ...chroma, enabled: true }
                      : undefined,
                  })
                }
              />
            </label>
            <p className="visual-description">
              {ui("将所选背景色变为透明，露出下方画面或画布背景。", "Make the selected background color transparent to reveal the video or canvas below.")}</p>
            <fieldset disabled={!chromaEnabled} className="visual-controls">
              <div className="visual-color-presets">
                <button
                  className={
                    chroma.color.toLowerCase() === "#00ff00" ? "active" : ""
                  }
                  onClick={() => updateChroma({ color: "#00ff00" })}
                >
                  <i style={{ background: "#00ff00" }} />
                  {ui("绿幕", "Green screen")}</button>
                <button
                  className={
                    chroma.color.toLowerCase() === "#0000ff" ? "active" : ""
                  }
                  onClick={() => updateChroma({ color: "#0000ff" })}
                >
                  <i style={{ background: "#0000ff" }} />
                  {ui("蓝幕", "Blue screen")}</button>
              </div>
              <ColorControl
                value={chroma.color}
                onChange={(color) => updateChroma({ color })}
              />
              <RangeControl
                label={ui("颜色容差", "Color tolerance")}
                value={chroma.similarity}
                min={0.01}
                max={1}
                onChange={(similarity) => updateChroma({ similarity })}
              />
              <RangeControl
                label={ui("边缘混合", "Edge blend")}
                value={chroma.blend}
                min={0}
                max={1}
                onChange={(blend) => updateChroma({ blend })}
              />
              <p className="visual-tip">
                {ui("从较低容差开始增加，直到背景消失；边缘混合可柔化透明区域的边界。", "Start with low tolerance and increase it until the background disappears. Edge blend softens the transparent region's boundary.")}</p>
            </fieldset>
            <button
              className="visual-reset"
              disabled={!clip.chromaKey}
              onClick={() => onUpdate({ chromaKey: undefined })}
            >
              <RotateCcw size={12} />
              {ui("清除色度抠像", "Clear chroma key")}</button>
          </>
        )}
        {mode === "mask" && (
          <>
            <label className="visual-toggle">
              <span>{ui("启用形状蒙版", "Enable shape mask")}</span>
              <input
                aria-label={ui("启用形状蒙版", "Enable shape mask")}
                type="checkbox"
                checked={maskEnabled}
                onChange={(event) =>
                  onUpdate({
                    mask: event.target.checked
                      ? { ...DEFAULT_MASK }
                      : undefined,
                  })
                }
              />
            </label>
            <p className="visual-description">
              {ui("以画面中心为基准保留指定形状，也可以反选隐藏中心区域。", "Keep the selected shape around the frame center, or invert it to hide the center region.")}</p>
            <fieldset disabled={!maskEnabled} className="visual-controls">
              <div className="visual-shapes">
                <button
                  className={mask.shape === "rectangle" ? "active" : ""}
                  aria-pressed={mask.shape === "rectangle"}
                  onClick={() => updateMask({ shape: "rectangle" })}
                >
                  <Square size={18} />
                  <span>{ui("矩形", "Rectangle")}</span>
                </button>
                <button
                  className={mask.shape === "ellipse" ? "active" : ""}
                  aria-pressed={mask.shape === "ellipse"}
                  onClick={() => updateMask({ shape: "ellipse" })}
                >
                  <Circle size={18} />
                  <span>{ui("椭圆", "Ellipse")}</span>
                </button>
              </div>
              <div className="visual-numbers-grid">
                <NumberControl
                  label={ui("蒙版宽度", "Mask width")}
                  value={mask.width * 100}
                  min={1}
                  onChange={(width) => updateMask({ width: width / 100 })}
                />
                <NumberControl
                  label={ui("蒙版高度", "Mask height")}
                  value={mask.height * 100}
                  min={1}
                  onChange={(height) => updateMask({ height: height / 100 })}
                />
              </div>
              <RangeControl
                label={ui("蒙版羽化", "Mask feather")}
                value={mask.feather}
                min={0}
                max={0.5}
                step={0.005}
                onChange={(feather) => updateMask({ feather })}
              />
              <label className="visual-toggle visual-invert">
                <span>{ui("反选蒙版", "Invert mask")}</span>
                <input
                  aria-label={ui("反选蒙版", "Invert mask")}
                  type="checkbox"
                  checked={mask.invert}
                  onChange={(event) =>
                    updateMask({ invert: event.target.checked })
                  }
                />
              </label>
              <div
                className={`visual-mask-diagram ${mask.invert ? "is-inverted" : ""}`}
                aria-hidden="true"
              >
                <div
                  style={{
                    width: `${mask.width * 100}%`,
                    height: `${mask.height * 100}%`,
                    borderRadius: mask.shape === "ellipse" ? "50%" : "0",
                    filter: `blur(${mask.feather * 12}px)`,
                  }}
                />
              </div>
              <p className="visual-tip">
                {ui("蒙版尺寸相对于源画面，羽化值控制边缘过渡宽度。", "Mask size is relative to the source frame. Feather controls the edge transition width.")}</p>
            </fieldset>
            <button
              className="visual-reset"
              disabled={!maskEnabled}
              onClick={() => onUpdate({ mask: undefined })}
            >
              <RotateCcw size={12} />
              {ui("清除蒙版", "Clear mask")}</button>
          </>
        )}
      </fieldset>
    </section>
  );
}
