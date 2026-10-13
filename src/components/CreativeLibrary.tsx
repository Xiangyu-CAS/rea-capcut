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
  return (
    <label className="creative-search">
      <Search size={14} />
      <input
        aria-label="搜索预设"
        placeholder="搜索名称或用途"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Footer() {
  return (
    <footer className="creative-footer">自主编写 · MIT 许可 · 离线可用</footer>
  );
}
export function TextLibrary({
  onAdd,
  onBlank,
}: {
  onAdd: (preset: TextPreset) => void;
  onBlank: () => void;
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部");
  const presets = TEXT_PRESETS.filter(
    (p) =>
      (category === "全部" || category === p.category) &&
      (p.name + p.style.text)
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  return (
    <section className="creative-library" aria-label="文字模板库">
      <header>
        <strong>
          文字模板 <small>{TEXT_PRESETS.length}</small>
        </strong>
        <button onClick={onBlank}>
          <Type size={12} /> 添加文本
        </button>
      </header>
      <SearchBox value={query} onChange={setQuery} />
      <div className="creative-tabs" role="tablist" aria-label="文字模板分类">
        {["全部", "标题", "字幕", "标记", "动态"].map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="creative-scroll">
        <p className="creative-help">
          添加到播放头位置；内容、字体、描边和动画均可编辑。
        </p>
        <div className="creative-grid">
          {presets.map((p) => (
            <article className="creative-card" key={p.id} data-preset-id={p.id}>
              <PresetPreview text={p} label={p.name} />
              <div>
                <span>
                  {p.name}
                  <small>{p.category} · 可编辑文字</small>
                </span>
                <button
                  aria-label={`添加${p.name}模板`}
                  onClick={() => onAdd(p)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {!presets.length && (
          <p className="creative-empty">没有匹配的文字模板</p>
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
  const [query, setQuery] = useState("");
  const presets = MOTION_PRESETS.filter((p) =>
    (p.name + p.description).includes(query.trim()),
  );
  return (
    <>
      <SearchBox value={query} onChange={setQuery} />
      <p className="creative-help">
        应用到所选画面或文字。覆盖对应属性的关键帧；其他属性保留，可撤销。
      </p>
      <div className="creative-grid">
        {presets.map((p) => (
          <article className="creative-card" key={p.id} data-preset-id={p.id}>
            <PresetPreview motion={p.id} label={p.name} />
            <div>
              <span title={p.description}>
                {p.name}
                <small>关键帧动效</small>
              </span>
              <button
                disabled={disabled}
                aria-label={`应用${p.name}特效`}
                onClick={() => onApply(p.id)}
              >
                <Plus size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!presets.length && <p className="creative-empty">没有匹配的动效</p>}
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
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部"),
    [seconds, setSeconds] = useState(0.5);
  const presets = TRANSITION_PRESETS.filter(
    (p) =>
      (category === "全部" || category === p.category) &&
      (p.name + p.description).includes(query.trim()),
  );
  return (
    <section className="creative-library" aria-label="转场素材库">
      <header>
        <strong>
          画面转场 <small>{TRANSITION_PRESETS.length}</small>
        </strong>
        <span>本地生成</span>
      </header>
      <SearchBox value={query} onChange={setQuery} />
      <div className="creative-tabs" role="tablist" aria-label="转场分类">
        {["全部", "基础", "运镜", "动感"].map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <label className="creative-duration">
        转场时长
        <input
          type="number"
          aria-label="转场时长"
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
        秒
      </label>
      <div className="creative-scroll">
        <p className="creative-help">
          选择同轨相邻画面的前一段。时长按帧与片段长度限制；除「经过背景」外，后段会提前重叠。运镜会替换后段开头对应的关键帧。
        </p>
        <div className="creative-grid">
          {presets.map((p) => (
            <article className="creative-card" key={p.id} data-preset-id={p.id}>
              <PresetPreview transition={p.id} label={p.name} />
              <div>
                <span title={p.description}>
                  {p.name}
                  <small>
                    {p.category} · {p.description}
                  </small>
                </span>
                <button
                  disabled={disabled}
                  className="transition-apply"
                  aria-label={`应用${p.name}转场`}
                  onClick={() => onApply(p.id, seconds)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
        {!presets.length && <p className="creative-empty">没有匹配的转场</p>}
      </div>
      <Footer />
    </section>
  );
}
