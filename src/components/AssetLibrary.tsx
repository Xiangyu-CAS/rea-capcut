import { localizeMessage } from "../i18n/messages";
import { useLibraryLabel } from "./libraryLabels";
import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, LoaderCircle, Pause, Play, Plus, Search, X } from "lucide-react";
import { BUILTIN_ASSETS, BUILTIN_CATEGORIES, builtinAssetUrl, type BuiltinAsset, type BuiltinAssetCategory } from "../core/builtinAssets";
import "./AssetLibrary.css";
export interface AssetLibraryProps {
  onAdd: (asset: BuiltinAsset) => void | Promise<void>;
  addingId?: string | null;
}
export default function AssetLibrary({ onAdd, addingId }: AssetLibraryProps) {
  const ui = useUITranslation();
  const label = useLibraryLabel();
  const [category, setCategory] = useState<BuiltinAssetCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { audio.current?.pause(); if (addedTimer.current) clearTimeout(addedTimer.current); }, []);
  useEffect(() => { audio.current?.pause(); audio.current = null; setPlaying(null); }, [category, query]);
  const filtered = BUILTIN_ASSETS.filter(asset => (category === "all" || asset.category === category) && `${asset.name} ${label(asset.name)} ${asset.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())).map(asset => ({ ...asset, name: label(asset.name) }));
  const busy = addingId || pending;
  const previewSound = async (asset: BuiltinAsset) => {
    audio.current?.pause();
    if (playing === asset.id) { audio.current = null; setPlaying(null); return; }
    const element = new Audio(builtinAssetUrl(asset));
    element.volume = 0.55;
    audio.current = element;
    element.onended = () => { if (audio.current === element) setPlaying(null); };
    element.onerror = () => { if (audio.current === element) { setPlaying(null); setError(ui("音效暂时无法播放，请重试。", "Cannot play this sound. Please try again.")); } };
    try { await element.play(); if (audio.current === element) setPlaying(asset.id); } catch { if (audio.current === element) setError(ui("音效暂时无法播放，请重试。", "Cannot play this sound. Please try again.")); }
  };
  const add = async (asset: BuiltinAsset) => {
    if (busy) return;
    setPending(asset.id); setError("");
    try {
      await onAdd(asset); setRecent(asset.id);
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setRecent(null), 1800);
    } catch (reason) { setError(reason instanceof Error ? reason.message : ui("素材添加失败，请重试。", "Could not add the asset. Please try again.")); }
    finally { setPending(null); }
  };
  return <section className="builtin-library" aria-label={ui("原创素材库", "Original asset library")}>
    <header className="builtin-header"><div><strong> {ui("灵感素材", "Creative assets")} </strong><span>{BUILTIN_ASSETS.length}  {ui("款原创 · 离线可用", "original assets · Available offline")} </span></div><span className="builtin-offline"> {ui("已内置", "Included")} </span></header>
    <label className="builtin-search"><Search size={14} /><input aria-label={ui("搜索原创素材", "Search original assets")} placeholder={ui("搜索贴纸、背景、音效…", "Search stickers, backgrounds, sounds…")} value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label={ui("清空素材搜索", "Clear asset search")} onClick={() => setQuery("")}><X size={13}/></button>}</label>
    <div className="builtin-categories" role="tablist" aria-label={ui("原创素材分类", "Original asset categories")}>
      {[{id: "all" as const, name: ui("全部", "All")}, ...BUILTIN_CATEGORIES].map(item => <button key={item.id} role="tab" aria-selected={category === item.id} onClick={() => setCategory(item.id)}>{label(item.name)}</button>)}
    </div>
    {error && <p className="builtin-error" role="alert">{localizeMessage(error)}</p>}
    <div className="builtin-results">
      {category === "titles" && <p className="builtin-hint"> {ui("透明底板可以叠加在视频上，再添加可编辑文字。", "Overlay a transparent title plate on video, then add editable text.")} </p>}
      {filtered.length === 0 ? <div className="builtin-empty"><Search size={25}/><strong> {ui("没有找到素材", "No assets found")} </strong><span> {ui("试试「星光」「旅行」或「转场」", "Try “sparkle”, “travel” or “transition”")} </span><button onClick={() => {setQuery("");setCategory("all");}}> {ui("查看全部", "View all")} </button></div> : <div className="builtin-grid">{filtered.map(asset => <article className={`builtin-card builtin-${asset.category}`} key={asset.id} data-builtin-id={asset.id}>
        {asset.kind === "audio" ? <button className="builtin-preview builtin-audio" aria-label={`${playing === asset.id ? ui("停止", "Stop") : ui("试听", "Preview")} ${asset.name}`} onClick={() => void previewSound(asset)}><AudioLines size={32}/><span className="builtin-play">{playing === asset.id ? <Pause size={13}/> : <Play size={13}/>}</span><small>{asset.duration.toFixed(2)}s</small></button> : <div className={`builtin-preview ${asset.transparent ? "builtin-alpha" : ""}`}><img src={builtinAssetUrl(asset)} alt={asset.name} loading="lazy" draggable={false}/>{asset.transparent && <small> {ui("透明", "Transparent")} </small>}</div>}
        <div className="builtin-card-footer"><div><strong title={asset.name}>{asset.name}</strong><span>{asset.kind === "audio" ? ui("合成音效", "Synthesized sound") : asset.category === "titles" ? ui("透明底板", "Transparent title plate") : asset.category === "backgrounds" ? "1920 × 1080" : ui("透明贴纸", "Transparent sticker")}</span></div><button aria-label={ui(`添加 ${asset.name}`, `Add ${asset.name}`)} title={ui("添加到播放位置", "Add at playhead")} disabled={!!busy} onClick={() => void add(asset)}>{busy === asset.id ? <LoaderCircle size={15} className="builtin-spin"/> : recent === asset.id ? <Check size={15}/> : <Plus size={15}/>}</button></div>
      </article>)}</div>}
    </div>
    <footer className="builtin-footer"><span>{filtered.length}  {ui("个素材", "assets")} </span><span> {ui("原创 · MIT 许可 · 可用于视频", "Original · MIT licensed · Use in your videos")} </span></footer>
  </section>;
}
