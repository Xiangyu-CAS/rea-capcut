import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useUITranslation } from "../i18n";
import { MAX_SPEED_POINTS, type SpeedPoint } from "../core/speedCurve";
import type { Clip } from "../core/types";

const height = 112;
const minRate = 0.1;
const rateScale = Math.log(8 / minRate);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const y = (rate: number) => 1 - Math.log(rate / minRate) / rateScale;
const rateAtY = (fraction: number) => Math.round(minRate * Math.exp((1 - clamp(fraction, 0, 1)) * rateScale) * 100) / 100;

export default function SpeedCurveEditor({ clip, onUpdate }: { clip: Clip; onUpdate: (patch: Partial<Clip>) => void }) {
  const ui = useUITranslation();
  const [open, setOpen] = useState(Boolean(clip.speedCurve));
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState<SpeedPoint[]>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; points: SpeedPoint[]; changed: boolean } | undefined>(undefined);
  const points = draft ?? clip.speedCurve ?? [{ position: 0, rate: clip.speed }, { position: 1, rate: clip.speed }];
  const current = Math.min(points.length - 1, selected);
  const point = points[current];

  useEffect(() => {
    const surface = canvas.current, ctx = surface?.getContext("2d");
    if (!surface || !ctx || !open) return;
    const { width } = surface;
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = "#52616a";
    ctx.moveTo(0, y(1) * height); ctx.lineTo(width, y(1) * height);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "#5de2c6";
    ctx.lineWidth = 2;
    for (const item of points) ctx.lineTo(item.position * width, y(item.rate) * height);
    ctx.stroke();
  }, [points, open]);

  const updatePoint = (items: SpeedPoint[], index: number, position: number, rate: number) => {
    if (!Number.isFinite(position) || !Number.isFinite(rate)) return items;
    const previous = items[index - 1]?.position, next = items[index + 1]?.position;
    const spacing = previous !== undefined && next !== undefined ? Math.min(0.005, (next - previous) / 4) : 0;
    const value = previous === undefined ? 0 : next === undefined ? 1 : clamp(position, previous + spacing, next - spacing);
    return items.map((item, i) => i === index ? { position: value, rate: clamp(rate, 0.1, 8) } : item);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || !plot.current) return;
    const bounds = plot.current.getBoundingClientRect();
    const next = updatePoint(drag.current.points, drag.current.index,
      (event.clientX - bounds.left) / bounds.width, rateAtY((event.clientY - bounds.top) / bounds.height));
    drag.current.points = next;
    drag.current.changed = true;
    setDraft(next);
  };
  const finish = (apply: boolean) => {
    if (apply && drag.current?.changed) onUpdate({ speedCurve: drag.current.points });
    drag.current = undefined;
    setDraft(undefined);
  };
  const applyPreset = (rates: number[]) => {
    setSelected(0);
    onUpdate({ speedCurve: rates.map((rate, index) => ({ position: index / (rates.length - 1), rate })) });
  };
  const insert = () => {
    let right = 1;
    for (let i = 2; i < points.length; i++)
      if (points[i].position - points[i - 1].position > points[right].position - points[right - 1].position) right = i;
    const a = points[right - 1], b = points[right];
    onUpdate({ speedCurve: [...points.slice(0, right),
      { position: (a.position + b.position) / 2, rate: (a.rate + b.rate) / 2 }, ...points.slice(right)] });
    setSelected(right);
  };

  return <div className="speed-curve">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{ui("曲线变速", "Speed curve")}</button>
    {open && <div className="speed-curve-body">
      <div className="speed-presets">
        <button type="button" onClick={() => applyPreset([0.5, 2])}>{ui("逐渐加速", "Speed up")}</button>
        <button type="button" onClick={() => applyPreset([2, 0.5])}>{ui("逐渐减速", "Slow down")}</button>
        <button type="button" onClick={() => applyPreset([0.75, 2, 0.75])}>{ui("中段加速", "Speed up in middle")}</button>
      </div>
      <div className="speed-curve-plot" ref={plot}>
        <canvas ref={canvas} width={280} height={height} aria-hidden="true" />
        {points.map((item, index) => <button key={index} type="button" className="speed-curve-point"
          aria-pressed={current === index} aria-label={ui(`速度点 ${index + 1}`, `Speed point ${index + 1}`)}
          title={`${Math.round(item.position * 100)}% · ${item.rate.toFixed(2)}×`}
          style={{ left: `${item.position * 100}%`, top: `${y(item.rate) * 100}%` }}
          onClick={() => setSelected(index)}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setSelected(index);
            drag.current = { index, points, changed: false };
          }}
          onPointerMove={move} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} />)}
      </div>
      <div className="speed-curve-inputs" key={`${current}:${point.position}:${point.rate}`}>
        <label>{ui("位置 %", "Position %")}
          <input type="number" aria-label={ui("速度点位置", "Speed point position")} min={0} max={100} step={1}
            disabled={current === 0 || current === points.length - 1}
            defaultValue={Math.round(point.position * 100)} onBlur={event => {
              if (event.target.valueAsNumber !== Math.round(point.position * 100))
                onUpdate({ speedCurve: updatePoint(points, current, event.target.valueAsNumber / 100, point.rate) });
            }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </label>
        <label>{ui("倍速", "Rate")}
          <input type="number" aria-label={ui("速度点倍速", "Speed point rate")} min={0.1} max={8} step={0.05}
            defaultValue={Number(point.rate.toFixed(2))} onBlur={event => {
              if (event.target.valueAsNumber !== Number(point.rate.toFixed(2)))
                onUpdate({ speedCurve: updatePoint(points, current, point.position, event.target.valueAsNumber) });
            }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </label>
      </div>
      <div className="speed-presets">
        <button type="button" onClick={insert} disabled={points.length >= MAX_SPEED_POINTS - 2}>{ui("添加速度点", "Add point")}</button>
        <button type="button" disabled={current === 0 || current === points.length - 1} onClick={() => {
          onUpdate({ speedCurve: points.filter((_, index) => index !== current) });
          setSelected(current - 1);
        }}>{ui("移除速度点", "Remove point")}</button>
        {clip.speedCurve && <button type="button" onClick={() => onUpdate({ speed: clip.speed })}>{ui("改用固定倍速", "Use constant speed")}</button>}
      </div>
    </div>}
  </div>;
}
