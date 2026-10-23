import type {
  SubtitleAnimation,
  SubtitleStyleValues,
} from "../core/subtitleWorkflow";
const motions = [
  ["none", "无"],
  ["fade", "淡入 / 淡出"],
  ["slide-up", "向上滑动 + 渐显隐"],
  ["zoom", "缩放 + 渐显隐"],
] as const;
export function SubtitleAnimationForm({
  value,
  onChange,
}: {
  value: SubtitleAnimation;
  onChange(v: SubtitleAnimation): void;
}) {
  return (
    <div className="subtitle-options">
      {(["entrance", "exit"] as const).map((phase, i) => (
        <label key={phase}>
          {i ? "出场" : "入场"}动画
          <select
            aria-label={i ? "字幕出场动画" : "字幕入场动画"}
            value={value[phase]}
            onChange={(e) => onChange({ ...value, [phase]: e.target.value })}
          >
            {motions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {(["inDuration", "outDuration"] as const).map((field, i) => (
        <label key={field}>
          {i ? "出场" : "入场"}秒数
          <input
            aria-label={i ? "字幕出场秒数" : "字幕入场秒数"}
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
        滑动距离（项目像素）
        <input
          aria-label="字幕滑动距离"
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
        停留动画
        <select
          aria-label="字幕停留动画"
          value={value.hold ?? "still"}
          onChange={(e) =>
            onChange({ ...value, hold: e.target.value as "still" | "pulse" })
          }
        >
          <option value="still">静止</option>
          <option value="pulse">一次呼吸缩放</option>
        </select>
      </label>
      <label>
        呼吸放大幅度（%）
        <input
          aria-label="字幕呼吸幅度"
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
        停留 = 每条字幕时长 − 入场 −
        出场，静止至少留一帧、呼吸至少两帧。应用会替换 Y / 缩放 /
        透明度关键帧及画面淡化；位置
        X、旋转保留。结果可在“动画”曲线中继续编辑。本表参数用于下一次应用，不从已有曲线反推预设。
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
  return (
    <div className="subtitle-options">
      <label>
        字号
        <input
          aria-label="批量字幕字号"
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
        文字颜色
        <input
          aria-label="批量字幕颜色"
          type="color"
          value={value.color}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
        />
      </label>
      <label>
        描边颜色
        <input
          aria-label="批量字幕描边颜色"
          type="color"
          value={value.stroke}
          onChange={(e) => onChange({ ...value, stroke: e.target.value })}
        />
      </label>
      <label>
        描边宽度
        <input
          aria-label="批量字幕描边宽度"
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
        背景（transparent 或十六进制色）
        <input
          aria-label="批量字幕背景"
          value={value.background}
          onChange={(e) => onChange({ ...value, background: e.target.value })}
        />
      </label>
      <label>
        对齐
        <select
          aria-label="批量字幕对齐"
          value={value.align}
          onChange={(e) =>
            onChange({
              ...value,
              align: e.target.value as SubtitleStyleValues["align"],
            })
          }
        >
          <option value="left">左对齐</option>
          <option value="center">居中</option>
          <option value="right">右对齐</option>
        </select>
      </label>
      <label>
        <input
          aria-label="批量字幕粗体"
          type="checkbox"
          checked={value.bold}
          onChange={(e) => onChange({ ...value, bold: e.target.checked })}
        />
        粗体
      </label>
      <p className="subtitle-hint">
        应用以上字段，保留各条字幕的字体、文案、位置、时间和动画。需要统一字体时，可使用“统一样式”参考字幕。
      </p>
    </div>
  );
}
