import { useUITranslation } from "../i18n";
import type {
  SubtitleAnimation,
  SubtitleStyleValues,
} from "../core/subtitleWorkflow";
const motions = [
  ["none", "无", "None"],
  ["fade", "淡入 / 淡出", "Fade in / out"],
  ["slide-up", "向上滑动 + 渐显隐", "Slide up + fade"],
  ["zoom", "缩放 + 渐显隐", "Zoom + fade"],
] as const;
export function SubtitleAnimationForm({
  value,
  onChange,
}: {
  value: SubtitleAnimation;
  onChange(v: SubtitleAnimation): void;
}) {
  const ui = useUITranslation();
  return (
    <div className="subtitle-options">
      {(["entrance", "exit"] as const).map((phase, i) => (
        <label key={phase}>
          {i ? ui("出场动画", "Exit animation") : ui("入场动画", "Entrance animation")}
          <select
            aria-label={i ? ui("字幕出场动画", "Subtitle exit animation") : ui("字幕入场动画", "Subtitle entrance animation")}
            value={value[phase]}
            onChange={(e) => onChange({ ...value, [phase]: e.target.value })}
          >
            {motions.map(([key, label, english]) => (
              <option key={key} value={key}>
                {ui(label, english)}
              </option>
            ))}
          </select>
        </label>
      ))}
      {(["inDuration", "outDuration"] as const).map((field, i) => (
        <label key={field}>
          {i ? ui("出场秒数", "Exit duration (seconds)") : ui("入场秒数", "Entrance duration (seconds)")}
          <input
            aria-label={i ? ui("字幕出场秒数", "Subtitle exit duration") : ui("字幕入场秒数", "Subtitle entrance duration")}
            type="number"
            min="0"
            max="60"
            step="0.05"
            value={value[field]}
            onChange={(e) =>
              onChange({ ...value, [field]: Number(e.target.value) })
            }
          />
        </label>
      ))}
      <label>
        {ui("滑动距离（项目像素）", "Slide distance (project pixels)")}
        <input
          aria-label={ui("字幕滑动距离", "Subtitle slide distance")}
          type="number"
          min="0"
          max="10000"
          value={value.distance}
          onChange={(e) =>
            onChange({ ...value, distance: Number(e.target.value) })
          }
        />
      </label>
      <label>
        {ui("停留动画", "Hold animation")}
        <select
          aria-label={ui("字幕停留动画", "Subtitle hold animation")}
          value={value.hold ?? "still"}
          onChange={(e) =>
            onChange({ ...value, hold: e.target.value as "still" | "pulse" })
          }
        >
          <option value="still">{ui("静止", "Still")}</option>
          <option value="pulse">{ui("一次呼吸缩放", "Single pulse zoom")}</option>
        </select>
      </label>
      <label>
        {ui("呼吸放大幅度（%）", "Pulse zoom amount (%)")}
        <input
          aria-label={ui("字幕呼吸幅度", "Subtitle pulse amount")}
          type="number"
          min="0"
          max="50"
          step="1"
          disabled={value.hold !== "pulse"}
          value={(value.pulseAmount ?? 0.08) * 100}
          onChange={(e) =>
            onChange({ ...value, pulseAmount: Number(e.target.value) / 100 })
          }
        />
      </label>
      <p className="subtitle-hint">
        {ui("停留 = 每条字幕时长 − 入场 − 出场，静止至少留一帧、呼吸至少两帧。应用会替换 Y / 缩放 / 透明度关键帧及画面淡化；位置 X、旋转保留。结果可在“动画”曲线中继续编辑。本表参数用于下一次应用，不从已有曲线反推预设。", "Hold = subtitle duration − entrance − exit. Still requires at least one frame; pulse requires two. Applying replaces Y, scale and opacity keyframes and visual fades, preserving X and rotation. Continue editing under Animation curves. These settings apply to the next operation; existing curves are not converted back to presets.")}
      </p>
    </div>
  );
}
export function SubtitleStyleForm({
  value,
  onChange,
}: {
  value: SubtitleStyleValues;
  onChange(v: SubtitleStyleValues): void;
}) {
  const ui = useUITranslation();
  return (
    <div className="subtitle-options">
      <label>
        {ui("字号", "Font size")}
        <input
          aria-label={ui("批量字幕字号", "Batch subtitle font size")}
          type="number"
          min="1"
          max="1000"
          value={value.fontSize}
          onChange={(e) =>
            onChange({ ...value, fontSize: Number(e.target.value) })
          }
        />
      </label>
      <label>
        {ui("文字颜色", "Text color")}
        <input
          aria-label={ui("批量字幕颜色", "Batch subtitle color")}
          type="color"
          value={value.color}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
        />
      </label>
      <label>
        {ui("描边颜色", "Outline color")}
        <input
          aria-label={ui("批量字幕描边颜色", "Batch subtitle outline color")}
          type="color"
          value={value.stroke}
          onChange={(e) => onChange({ ...value, stroke: e.target.value })}
        />
      </label>
      <label>
        {ui("描边宽度", "Outline width")}
        <input
          aria-label={ui("批量字幕描边宽度", "Batch subtitle outline width")}
          type="number"
          min="0"
          max="100"
          value={value.strokeWidth}
          onChange={(e) =>
            onChange({ ...value, strokeWidth: Number(e.target.value) })
          }
        />
      </label>
      <label>
        {ui("背景（transparent 或十六进制色）", "Background (transparent or hex color)")}
        <input
          aria-label={ui("批量字幕背景", "Batch subtitle background")}
          value={value.background}
          onChange={(e) => onChange({ ...value, background: e.target.value })}
        />
      </label>
      <label>
        {ui("对齐", "Alignment")}
        <select
          aria-label={ui("批量字幕对齐", "Batch subtitle alignment")}
          value={value.align}
          onChange={(e) =>
            onChange({
              ...value,
              align: e.target.value as SubtitleStyleValues["align"],
            })
          }
        >
          <option value="left">{ui("左对齐", "Left")}</option>
          <option value="center">{ui("居中", "Center")}</option>
          <option value="right">{ui("右对齐", "Right")}</option>
        </select>
      </label>
      <label>
        <input
          aria-label={ui("批量字幕粗体", "Batch subtitle bold")}
          type="checkbox"
          checked={value.bold}
          onChange={(e) => onChange({ ...value, bold: e.target.checked })}
        />
        {ui("粗体", "Bold")}
      </label>
      <p className="subtitle-hint">
        {ui("应用以上字段，保留各条字幕的字体、文案、位置、时间和动画。需要统一字体时，可使用“统一样式”参考字幕。", "Apply these fields while keeping each subtitle’s font family, text, position, timing and animation. To copy a font family, choose a reference subtitle under Match style.")}
      </p>
    </div>
  );
}
