import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, LoaderCircle, Pause, Play, Plus, Search, X } from "lucide-react";
import { BUILTIN_ASSETS, BUILTIN_CATEGORIES, builtinAssetUrl, filterBuiltinAssets, type BuiltinAsset, type BuiltinAssetCategory } from "../core/builtinAssets";
import "./AssetLibrary.css";
export interface AssetLibraryProps {
  onAdd: (asset: BuiltinAsset) => void | Promise<void>;
  addingId?: string | null;
}
export default function AssetLibrary({ onAdd, addingId }: AssetLibraryProps) {
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
  const filtered = filterBuiltinAssets(category, query);
  const busy = addingId || pending;
  const previewSound = async (asset: BuiltinAsset) => {
    audio.current?.pause();
    if (playing === asset.id) { audio.current = null; setPlaying(null); return; }
    const element = new Audio(builtinAssetUrl(asset));
    element.volume = 0.55;
    audio.current = element;
    element.onended = () => { if (audio.current === element) setPlaying(null); };
    element.onerror = () => { if (audio.current === element) { setPlaying(null); setError("音效暂时无法播放，请重试。"); } };
    try { await element.play(); if (audio.current === element) setPlaying(asset.id); } catch { if (audio.current === element) setError("音效暂时无法播放，请重试。"); }
  };
  const add = async (asset: BuiltinAsset) => {
    if (busy) return;
    setPending(asset.id); setError("");
    try {
      await onAdd(asset); setRecent(asset.id);
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setRecent(null), 1800);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "素材添加失败，请重试。"); }
    finally { setPending(null); }
  };
  return <section className="builtin-library" aria-label="原创素材库">
    <header className="builtin-header"><div><strong>灵感素材</strong><span>{BUILTIN_ASSETS.length} 款原创 · 离线可用</span></div><span className="builtin-offline">已内置</span></header>
    <label className="builtin-search"><Search size={14} /><input aria-label="搜索原创素材" placeholder="搜索贴纸、背景、音效…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清空素材搜索" onClick={() => setQuery("")}><X size={13}/></button>}</label>
    <div className="builtin-categories" role="tablist" aria-label="原创素材分类">
      {[{id: "all" as const, name: "全部"}, ...BUILTIN_CATEGORIES].map(item => <button key={item.id} role="tab" aria-selected={category === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}
    </div>
    {error && <p className="builtin-error" role="alert">{error}</p>}
    <div className="builtin-results">
      {category === "titles" && <p className="builtin-hint">透明底板可以叠加在视频上，再添加可编辑文字。</p>}
      {filtered.length === 0 ? <div className="builtin-empty"><Search size={25}/><strong>没有找到素材</strong><span>试试「星光」「旅行」或「转场」</span><button onClick={() => {setQuery("");setCategory("all");}}>查看全部</button></div> : <div className="builtin-grid">{filtered.map(asset => <article className={`builtin-card builtin-${asset.category}`} key={asset.id} data-builtin-id={asset.id}>
        {asset.kind === "audio" ? <button className="builtin-preview builtin-audio" aria-label={`${playing === asset.id ? "停止" : "试听"} ${asset.name}`} onClick={() => void previewSound(asset)}><AudioLines size={32}/><span className="builtin-play">{playing === asset.id ? <Pause size={13}/> : <Play size={13}/>}</span><small>{asset.duration.toFixed(2)}s</small></button> : <div className={`builtin-preview ${asset.transparent ? "builtin-alpha" : ""}`}><img src={builtinAssetUrl(asset)} alt={asset.name} loading="lazy" draggable={false}/>{asset.transparent && <small>透明</small>}</div>}
        <div className="builtin-card-footer"><div><strong title={asset.name}>{asset.name}</strong><span>{asset.kind === "audio" ? "合成音效" : asset.category === "titles" ? "透明底板" : asset.category === "backgrounds" ? "1920 × 1080" : "透明贴纸"}</span></div><button aria-label={`添加 ${asset.name}`} title="添加到播放位置" disabled={!!busy} onClick={() => void add(asset)}>{busy === asset.id ? <LoaderCircle size={15} className="builtin-spin"/> : recent === asset.id ? <Check size={15}/> : <Plus size={15}/>}</button></div>
      </article>)}</div>}
    </div>
    <footer className="builtin-footer"><span>{filtered.length} 个素材</span><span>原创 · MIT 许可 · 可用于视频</span></footer>
  </section>;
}
