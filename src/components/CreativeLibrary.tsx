import { useLibraryLabel } from "./libraryLabels";
import { useUITranslation } from "../i18n";
import { useState } from "react";
import { Plus, Search, Type } from "lucide-react";
import {
  MOTION_PRESETS,
  TEXT_PRESETS,
  TRANSITION_PRESETS,
  type MotionId,
  type TextPreset,
  type TransitionId,
} from "../core/creativePresets";
import PresetPreview from "./PresetPreview";
import "./CreativeLibrary.css";
function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  const ui = useUITranslation();
  const label = useLibraryLabel();
  return (
    <label className="creative-search">
      <Search size={14} />
      <input
        aria-label={ui("搜索预设", "Search presets")}
        placeholder={ui("搜索名称或用途", "Search names or uses")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Footer() {
  const ui = useUITranslation();
  const label = useLibraryLabel();
  return (
    <footer className="creative-footer"> {ui("自主编写 · MIT 许可 · 离线可用", "Original · MIT licensed · Available offline")} </footer>
  );
}
export function TextLibrary({
  onAdd,
  onBlank,
}: {
  onAdd: (preset: TextPreset) => void;
  onBlank: () => void;
}) {
  const ui = useUITranslation();
  const label = useLibraryLabel();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部");
  const presets = TEXT_PRESETS.map(p => ({ ...p, name: label(p.name), style: { ...p.style, text: label(p.style.text ?? "") } })).filter(
    (p) =>
      (category === "全部" || category === p.category) &&
      (p.name + p.style.text)
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  return (
    <section className="creative-library" aria-label={ui("文字模板库", "Text template library")}>
      <header>
        <strong>
           {ui("文字模板", "Text templates")} <small>{TEXT_PRESETS.length}</small>
        </strong>
        <button onClick={onBlank}>
          <Type size={12} />  {ui("添加文本", "Add text")} </button>
      </header>
      <SearchBox value={query} onChange={setQuery} />
      <div className="creative-tabs" role="tablist" aria-label={ui("文字模板分类", "Text template categories")}>
        {["全部", "标题", "字幕", "标记", "动态"].map((c) => (
          <button
            key={label(c)}
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
          >
            {label(c)}
          </button>
        ))}
      </div>
      <div className="creative-scroll">
        <p className="creative-help">
           {ui("添加到播放头位置；内容、字体、描边和动画均可编辑。", "Add at the playhead. Text, font, outline and animation are editable.")} </p>
        <div className="creative-grid">
          {presets.map((p) => (
            <article className="creative-card" key={p.id} data-preset-id={p.id}>
              <PresetPreview text={p} label={p.name} />
              <div>
                <span>
                  {p.name}
                  <small>{label(p.category)}  {ui("· 可编辑文字", "· Editable text")} </small>
                </span>
                <button
                  aria-label={ui(`添加${p.name}模板`, `Add ${p.name} template`)}
                  onClick={() => onAdd(p)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {!presets.length && (
          <p className="creative-empty"> {ui("没有匹配的文字模板", "No matching text templates")} </p>
        )}
      </div>
      <Footer />
    </section>
  );
}
export function MotionLibrary({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (motion: MotionId) => void;
}) {
  const ui = useUITranslation();
  const label = useLibraryLabel();
  const [query, setQuery] = useState("");
  const presets = MOTION_PRESETS.map(p => ({ ...p, name: label(p.name), description: label(p.description) })).filter((p) =>
    (p.name + p.description).toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <SearchBox value={query} onChange={setQuery} />
      <p className="creative-help">
         {ui("应用到所选画面或文字。覆盖对应属性的关键帧；其他属性保留，可撤销。", "Apply to selected video or text. Replaces keyframes for affected properties only. Can be undone.")} </p>
      <div className="creative-grid">
        {presets.map((p) => (
          <article className="creative-card" key={p.id} data-preset-id={p.id}>
            <PresetPreview motion={p.id} label={p.name} />
            <div>
              <span title={p.description}>
                {p.name}
                <small> {ui("关键帧动效", "Keyframe animation")} </small>
              </span>
              <button
                disabled={disabled}
                aria-label={ui(`应用${p.name}特效`, `Apply ${p.name} effect`)}
                onClick={() => onApply(p.id)}
              >
                <Plus size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!presets.length && <p className="creative-empty"> {ui("没有匹配的动效", "No matching animations")} </p>}
    </>
  );
}
export function TransitionLibrary({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (transition: TransitionId, seconds: number) => void;
}) {
  const ui = useUITranslation();
  const label = useLibraryLabel();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部"),
    [seconds, setSeconds] = useState(0.5);
  const presets = TRANSITION_PRESETS.map(p => ({ ...p, name: label(p.name), description: label(p.description) })).filter(
    (p) =>
      (category === "全部" || category === p.category) &&
      (p.name + p.description).toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="creative-library" aria-label={ui("转场素材库", "Transition library")}>
      <header>
        <strong>
           {ui("画面转场", "Transitions")} <small>{TRANSITION_PRESETS.length}</small>
        </strong>
        <span> {ui("本地生成", "Generated locally")} </span>
      </header>
      <SearchBox value={query} onChange={setQuery} />
      <div className="creative-tabs" role="tablist" aria-label={ui("转场分类", "Transition categories")}>
        {["全部", "基础", "运镜", "动感"].map((c) => (
          <button
            key={label(c)}
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
          >
            {label(c)}
          </button>
        ))}
      </div>
      <label className="creative-duration">
         {ui("转场时长", "Transition duration")} <input
          type="number"
          aria-label={ui("转场时长", "Transition duration")}
          min={0.05}
          max={5}
          step={0.05}
          value={seconds}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value))
              setSeconds(Math.max(0.05, Math.min(5, value)));
          }}
        />
         {ui("秒", "s")} </label>
      <div className="creative-scroll">
        <p className="creative-help">
           {ui("选择同轨相邻画面的前一段。时长按帧与片段长度限制；除「经过背景」外，后段会提前重叠。运镜会替换后段开头对应的关键帧。", "Select the first of two adjacent clips on the same track. Duration is limited by frames and clip length. Except for Fade through background, the next clip overlaps earlier. Camera motion replaces the next clip’s initial keyframes.")} </p>
        <div className="creative-grid">
          {presets.map((p) => (
            <article className="creative-card" key={p.id} data-preset-id={p.id}>
              <PresetPreview transition={p.id} label={p.name} />
              <div>
                <span title={p.description}>
                  {p.name}
                  <small>
                    {label(p.category)} · {p.description}
                  </small>
                </span>
                <button
                  disabled={disabled}
                  className="transition-apply"
                  aria-label={ui(`应用${p.name}转场`, `Apply ${p.name} transition`)}
                  onClick={() => onApply(p.id, seconds)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {!presets.length && <p className="creative-empty"> {ui("没有匹配的转场", "No matching transitions")} </p>}
      </div>
      <Footer />
    </section>
  );
}
