import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Music2, Pause, Play, Search, X } from "lucide-react";
import { useUITranslation } from "../i18n";
import { useEditorStore } from "../editor/store";
import { musicCreditLine, type MusicResult, type MusicSearchResult } from "../core/onlineMusic";

export function AssistantMusic({ query: initial, onClose, auto }: { query: string; onClose(): void; auto: boolean }) {
  const ui = useUITranslation(), api = window.editorAPI;
  const [query, setQuery] = useState(initial);
  const [result, setResult] = useState<MusicSearchResult>();
  const [loading, setLoading] = useState(false);
  const [doing, setDoing] = useState("");
  const [playing, setPlaying] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const searchLock = useRef(false), actionLock = useRef(false), request = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  function stop() {
    audio.current?.pause();
    audio.current = null;
    setPlaying("");
  }
  useEffect(() => () => {
    ++request.current;
    audio.current?.pause();
    audio.current = null;
  }, []);
  async function search(value: string) {
    if (!api?.searchOnlineMusic || searchLock.current) return;
    searchLock.current = true;
    setLoading(true); setError(""); setStatus("");
    try { setResult(await api.searchOnlineMusic(value)); }
    catch { setError(ui("暂时无法搜索配乐，请稍后重试。", "Could not search for music. Try again shortly.")); }
    finally { searchLock.current = false; setLoading(false); }
  }
  const autoRan = useRef(false);
  useEffect(() => {
    if (auto && !autoRan.current) {
      autoRan.current = true;
      void search(initial);
    }
  }, [auto, initial]);
  async function useTrack(track: MusicResult, action: "preview" | "add" | "source") {
    if (!api || actionLock.current) return;
    if (action === "preview" && playing === track.id) { stop(); return; }
    actionLock.current = true;
    setDoing(track.id); setError(""); setStatus("");
    const version = ++request.current;
    const original = useEditorStore.getState().project;
    const existing = original.assets.find(asset => asset.musicCredit?.sourceId === track.id && !asset.missing);
    try {
      if (action === "source") { await api.openOnlineMusicSource(track.id); return; }
      stop();
      if (action === "preview") {
        const url = existing?.url ?? await api.previewOnlineMusic(track.id);
        if (request.current !== version) return;
        const player = new Audio(url);
        audio.current = player;
        player.addEventListener("ended", () => { if (audio.current === player) stop(); }, { once: true });
        await player.play();
        if (request.current !== version) { player.pause(); return; }
        setPlaying(track.id);
      } else {
        const asset = existing ?? await api.downloadOnlineMusic(track.id);
        if (request.current !== version) return;
        const state = useEditorStore.getState();
        if (state.project.id !== original.id || state.project.activeTimeline?.id !== original.activeTimeline?.id || state.transactionOpen) {
          setError(ui("已切换工程或正在编辑。音乐未放入时间线，请重试。", "Project or timeline changed, or an edit is in progress. Nothing was added. Try again."));
          return;
        }
        state.addBackgroundMusic(asset);
        setStatus(ui(`已添加「${track.title}」。可以撤销。`, `Added “${track.title}”. You can undo this.`));
      }
    } catch {
      if (request.current === version) setError(ui("无法打开或获取这首音乐，请重试或查看来源。", "Could not open or load this track. Try again or visit its source."));
    } finally {
      actionLock.current = false;
      if (request.current === version) setDoing("");
    }
  }
  const time = (seconds: number) => seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "";
  return <section className="assistant-music" aria-label={ui("在线配乐", "Online music")}>
    <header><Music2 size={15} /><strong>{ui("在线配乐", "Online music")}</strong><button type="button" aria-label={ui("关闭配乐", "Close music")} onClick={onClose}><X size={15} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void search(query); }}>
      <input aria-label={ui("配乐关键词", "Music keywords")} placeholder={ui("例如：轻快、钢琴、旅行", "Try upbeat, piano, or travel")} maxLength={120} value={query} onChange={event => setQuery(event.currentTarget.value)} />
      <button type="submit" disabled={loading || !api?.searchOnlineMusic}><Search size={14} />{loading ? ui("搜索中", "Searching") : ui("搜索", "Search")}</button>
    </form>
    <p className="assistant-music-note">{ui("在线搜索只发送关键词。可下载的音乐会加入独立音轨，原声不变。", "Only keywords are sent. Downloadable music is added on a separate track without changing original audio.")}</p>
    {result?.openverse === "limited" && <p className="assistant-music-note">{ui("Openverse 已限流，当前显示其他来源。", "Openverse is rate-limited. Showing other sources.")}</p>}
    {result?.openverse === "unavailable" && <p className="assistant-music-note">{ui("Openverse 暂不可用。", "Openverse is temporarily unavailable.")}</p>}
    {result && !result.incompetech && <p className="assistant-music-note">{ui("可直下的 Incompetech 曲库暂不可用。", "The downloadable Incompetech catalog is temporarily unavailable.")}</p>}
    {result && !result.tracks.length && <p className="assistant-music-note">{ui("没有匹配曲目。试试更短的关键词。", "No matches. Try shorter keywords.")}</p>}
    {result?.tracks.map(track => <div className="assistant-music-track" key={track.id}>
      <div className="assistant-music-meta"><strong title={track.title}>{track.title}</strong><small>{[time(track.duration), track.creator, track.license, track.provider].filter(Boolean).join(" · ")}</small></div>
      <div className="assistant-music-actions">
        {track.downloadable && <>
          <button type="button" aria-label={playing === track.id ? ui("暂停试听", "Stop preview") : ui("试听", "Preview")} disabled={!!doing} onClick={() => void useTrack(track, "preview")}>{playing === track.id ? <Pause size={14} /> : <Play size={14} />}</button>
          <button type="button" disabled={!!doing} onClick={() => void useTrack(track, "add")}><Download size={14} />{doing === track.id ? ui("处理中…", "Working…") : ui("下载并添加", "Download & add")}</button>
          <button type="button" title={musicCreditLine(track)} onClick={() => void navigator.clipboard.writeText(musicCreditLine(track)).then(() => setStatus(ui("已复制署名。", "Credit copied."))).catch(() => setError(ui("无法复制署名。", "Could not copy the credit.")))}>{ui("复制署名", "Copy credit")}</button>
        </>}
        <button type="button" disabled={!!doing} onClick={() => void useTrack(track, "source")}><ExternalLink size={13} />{ui("查看来源", "View source")}</button>
      </div>
    </div>)}
    {error && <p role="alert" className="assistant-error">{error}</p>}
    {status && <p role="status" className="assistant-music-note">{status}</p>}
    <p className="assistant-music-note">{ui("部分结果由 Openverse 提供，ReaCut 不受 Openverse 背书。使用前请核对来源授权。", "Search powered in part by Openverse. ReaCut is not endorsed by Openverse. Verify the original license before use.")}</p>
  </section>;
}
