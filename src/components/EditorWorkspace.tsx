import { useUITranslation } from "../i18n";
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
const key = 'reacut-panel-widths-v1';
type Widths = [number, number];
function read(): Widths | null {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null'); return Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) ? value as Widths : null; } catch { return null; }
}
/** UI-only layout preferences never modify project history or media coordinates. */
export default function EditorWorkspace({ assistantOpen, children }: { assistantOpen: boolean; children: ReactNode }) {
  const ui = useUITranslation();
  const main = useRef<HTMLElement>(null), drag = useRef<{ side: 0 | 1; x: number; widths: Widths } | null>(null);
  const [preferred, setPreferred] = useState<Widths | null>(read), [available, setAvailable] = useState(0), [measured, setMeasured] = useState<Widths>([0,0]);
  const rightMin = assistantOpen ? 310 : 280;
  const fit = (widths: Widths): Widths => {
    const space = Math.max(0, available - 320), left = Math.max(280, widths[0]), right = Math.max(rightMin, widths[1]);
    const excess = Math.max(0, left + right - space), flexible = Math.max(1, left - 280 + right - rightMin);
    return [Math.max(280, left - excess * (left - 280) / flexible), Math.max(rightMin, right - excess * (right - rightMin) / flexible)];
  };
  const widths: Widths = preferred && available ? fit([preferred[0] * available, preferred[1] * available]) : measured;
  useLayoutEffect(() => {
    const element = main.current!;
    const update = () => { setAvailable(Math.max(0, element.clientWidth - 14)); const panels = Array.from(element.children).filter(child => !child.classList.contains('workspace-divider')); setMeasured([panels[0]?.getBoundingClientRect().width ?? 0, panels[2]?.getBoundingClientRect().width ?? 0]); };
    const observer = new ResizeObserver(update); observer.observe(element); update(); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (preferred) return;
    const element = main.current!; const panels = Array.from(element.children).filter(child => !child.classList.contains('workspace-divider'));
    setMeasured([panels[0]?.getBoundingClientRect().width ?? 0, panels[2]?.getBoundingClientRect().width ?? 0]);
  }, [assistantOpen, available, preferred]);
  const remember = (ratios: Widths | null) => { try { if (ratios) localStorage.setItem(key, JSON.stringify(ratios)); else localStorage.removeItem(key); } catch { /* Layout still works if preferences are unavailable. */ } };
  const change = (side: 0 | 1, value: number, basis = widths) => {
    const next: Widths = [...basis]; next[side] = Math.max(side === 0 ? 280 : rightMin, Math.min(available - 320 - basis[side === 0 ? 1 : 0], value));
    const ratios: Widths = [next[0] / available, next[1] / available]; setPreferred(ratios); return ratios;
  };
  const reset = () => { drag.current = null; setPreferred(null); remember(null); };
  return <main ref={main} className={`editor-workspace ${assistantOpen ? 'assistant-open' : ''}`} style={preferred && available ? { gridTemplateColumns: `${widths[0]}px minmax(320px,1fr) ${widths[1]}px` } : undefined}>
    {children}
    {([0,1] as const).map(side => <div key={side} className="workspace-divider" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={side === 0 ? ui("调整素材区宽度", "Resize media panel") : ui("调整属性区宽度", "Resize properties panel")} aria-valuenow={Math.round(widths[side])} aria-valuemin={side === 0 ? 280 : rightMin} aria-valuemax={Math.floor(available - 320 - widths[side === 0 ? 1 : 0])} title={ui("拖动调整宽度 · 双击恢复默认 · ← / → 微调", "Drag to resize · Double-click to reset · ← / → to fine-tune")} style={side === 0 ? {left: widths[0]} : {right: widths[1]}}
      onDoubleClick={reset}
      onKeyDown={event => { if (event.key === 'Home') { event.preventDefault();event.stopPropagation();reset(); } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault();event.stopPropagation();const delta=(event.key==='ArrowRight'?1:-1)*(side===0?1:-1)*(event.shiftKey?40:10);remember(change(side,widths[side]+delta)); } }}
      onPointerDown={event => { if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();drag.current={side,x:event.clientX,widths:[...widths]};event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const current=drag.current;if(current?.side===side) change(side,current.widths[side]+(event.clientX-current.x)*(side===0?1:-1),current.widths); }}
      onPointerUp={event => { const current=drag.current;if(current?.side===side) remember(change(side,current.widths[side]+(event.clientX-current.x)*(side===0?1:-1),current.widths));drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => {drag.current=null;remember(preferred);}}
    />)}
  </main>;
}
