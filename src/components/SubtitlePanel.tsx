import { useTranslation } from "../i18n/useTranslation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderOpen, LockKeyhole, Search, Subtitles } from "lucide-react";
import { useEditorStore } from "../editor/store";
import { clone } from "../core/model";
import { applySubtitleEdit, prepareSubtitleEdit, type SubtitleEdit, type SubtitleEditPlan } from "../core/subtitleEdits";
import type { Clip, Project } from "../core/types";
import "./SubtitlePanel.css";

interface Props { onSpeech: (mode: "asr" | "tts") => void; onImport: () => void | Promise<void>; onExport: () => void | Promise<void> }
interface CueDraft { project: Project; id: string; text: string; start: string; end: string }
const seconds = (value: number) => Number(value.toFixed(6)).toString();
const timeLabel = (value: number) => `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toFixed(2).padStart(5, "0")}`;

export default function SubtitlePanel({ onImport, onExport, onSpeech }: Props) {
  const { t } = useTranslation();
  const project = useEditorStore(s => s.project);
  const [trackId, setTrackId] = useState("");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [draft, setDraft] = useState<CueDraft | null>(null);
  const [mode, setMode] = useState<"offset" | "replace" | "style">("offset");
  const [offset, setOffset] = useState("0");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [plan, setPlan] = useState<SubtitleEditPlan | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  const knownTracks = useRef(new Set(project.tracks.map(t => t.id)));
  const tracks = project.tracks.filter(t => t.kind === "text");
  const activeTrack = tracks.find(t => t.id === trackId);
  const clips = useMemo(() => project.clips.filter(c => c.trackId === trackId && c.text).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)), [project, trackId]);
  const visible = clips.filter(c => c.text!.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = checked.filter(id => clips.some(c => c.id === id));
  const locked = !!activeTrack?.locked;
  const stale = !!plan && plan.base !== JSON.stringify(project);

  useEffect(() => {
    const textTracks = project.tracks.filter(t => t.kind === "text");
    const preferred = textTracks.find(t => t.name.includes("字幕")) ?? textTracks[0];
    setTrackId(preferred?.id ?? ""); setQuery(""); setChecked([]); setDraft(null); setPlan(null); setError(""); setNotice("");
  }, [project.id]);
  useEffect(() => {
    if (!project.tracks.some(t => t.id === trackId && t.kind === "text")) {
      const preferred = project.tracks.find(t => t.kind === "text" && t.name.includes("字幕")) ?? project.tracks.find(t => t.kind === "text");
      setTrackId(preferred?.id ?? "");
    }
    // Newly imported cues become selected in the editor; follow their new track.
    const first = project.clips.find(c => c.id === useEditorStore.getState().selectedIds[0] && c.text);
    if (first && first.trackId !== trackId && (!knownTracks.current.has(first.trackId) || !project.clips.some(c => c.trackId === trackId))) setTrackId(first.trackId);
    knownTracks.current = new Set(project.tracks.map(t => t.id));
  }, [project, trackId]);
  useEffect(() => { setChecked([]); setDraft(null); setPlan(null); setError(""); setNotice(""); setReferenceId(""); }, [trackId]);
  useEffect(() => { if (error) feedback.current?.scrollIntoView({ block: "nearest" }); }, [error]);

  function attempt(action: () => void) {
    setError(""); setNotice("");
    try { action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function fileAction(action: Props["onImport"]) {
    setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function editCue(clip: Clip) {
    useEditorStore.getState().select([clip.id]);
    useEditorStore.getState().seek(clip.start);
    setDraft({ project: clone(project), id: clip.id, text: clip.text!.text, start: seconds(clip.start), end: seconds(clip.start + clip.duration) });
    setReferenceId(clip.id); setPlan(null); setError(""); setNotice("");
  }
  function saveCue() {
    attempt(() => {
      if (!draft) return;
      if (!draft.start.trim() || !draft.end.trim()) throw new Error("请填写开始和结束时间");
      const next = prepareSubtitleEdit(draft.project, [draft.id], { type: "cue", text: draft.text, start: Number(draft.start), end: Number(draft.end) });
      const store = useEditorStore.getState();
      store.commit(applySubtitleEdit(store.project, next));
      setDraft(null); setNotice(next.changedIds.length ? "字幕已保存，可一次撤销" : "字幕未变化");
    });
  }
  function prepare() {
    attempt(() => {
      let edit: SubtitleEdit;
      if (mode === "offset") {
        if (!offset.trim()) throw new Error("请填写时间偏移量");
        edit = { type: "offset", seconds: Number(offset) };
      } else if (mode === "replace") edit = { type: "replace", find, replacement };
      else edit = { type: "style", referenceId };
      const next = prepareSubtitleEdit(useEditorStore.getState().project, selected, edit);
      if (!next.changedIds.length) { setPlan(null); setNotice("没有需要修改的字幕"); return; }
      setPlan(next);
    });
  }
  function apply() {
    attempt(() => {
      if (!plan) return;
      const store = useEditorStore.getState();
      store.commit(applySubtitleEdit(store.project, plan));
      setNotice(`已修改 ${plan.changedIds.length} 条字幕，可一次撤销`); setPlan(null); setDraft(null);
    });
  }
  function setSelection(ids: string[]) { setChecked(ids); setPlan(null); }
  const draftStale = draft && JSON.stringify(draft.project) !== JSON.stringify(project);

  return <section className="subtitle-panel" aria-label="字幕编辑器">
    <div className="subtitle-heading"><h3>字幕编辑</h3><span>{clips.length} 条</span></div>
    <div className="subtitle-file-actions">
      <button className="small-button" disabled={!window.editorAPI} onClick={() => onSpeech("asr")}>{t("speech.asr")}</button>
      <button className="small-button" disabled={!window.editorAPI} onClick={() => onSpeech("tts")}>{t("speech.tts")}</button>
      <button className="small-button" onClick={() => void fileAction(onImport)}><FolderOpen size={14} />导入字幕文件</button>
      <button className="small-button" onClick={() => void fileAction(onExport)} disabled={!project.clips.some(c => c.text)} title="导出项目中全部文字片段为 SRT"><Download size={14} />导出全部 SRT</button>
    </div>
    <label className="subtitle-track-label">文字轨道
      <select aria-label="字幕轨道" value={trackId} onChange={e => setTrackId(e.target.value)}>
        {!tracks.length && <option value="">暂无文字轨道</option>}
        {tracks.map(t => <option key={t.id} value={t.id}>{t.name}{t.locked ? " · 已锁定" : ""}</option>)}
      </select>
    </label>
    <label className="subtitle-search"><Search size={14} /><input aria-label="搜索字幕" placeholder="搜索当前轨道字幕" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="subtitle-selection">
      <label><input type="checkbox" aria-label="选择搜索结果" disabled={locked || !visible.length} checked={visible.length > 0 && visible.every(c => selected.includes(c.id))} onChange={e => setSelection(e.target.checked ? [...new Set([...selected, ...visible.map(c => c.id)])] : selected.filter(id => !visible.some(c => c.id === id)))} />选择搜索结果</label>
      <button className="subtitle-clear" disabled={!selected.length} onClick={() => setSelection([])}>清空 ({selected.length})</button>
    </div>
    {locked && <p className="subtitle-hint"><LockKeyhole size={13} />此轨道已锁定，仍可定位和查看字幕。</p>}
    <div className="subtitle-cues">
      {!visible.length && <div className="subtitle-empty"><Subtitles size={27} /><p>{clips.length ? "没有匹配的字幕" : "导入 SRT / WebVTT，或选择含字幕的文字轨道"}</p></div>}
      {visible.map((clip) => <div key={clip.id} className={`subtitle-cue ${draft?.id === clip.id ? "active" : ""}`} data-cue-id={clip.id}>
        <div className="subtitle-cue-line">
          <input type="checkbox" aria-label={`选择字幕：${clip.text!.text.slice(0, 40)}`} checked={selected.includes(clip.id)} disabled={locked} onChange={e => setSelection(e.target.checked ? [...selected, clip.id] : selected.filter(id => id !== clip.id))} />
          <button className="subtitle-cue-content" onClick={() => editCue(clip)} title="定位到此字幕并编辑"><span className="subtitle-time">{timeLabel(clip.start)} — {timeLabel(clip.start + clip.duration)}</span><span>{clip.text!.text || "（空字幕）"}</span></button>
        </div>
        {draft?.id === clip.id && <div className="subtitle-cue-form">
          <textarea aria-label="字幕内容" value={draft.text} maxLength={20000} disabled={locked} onChange={e => setDraft({ ...draft, text: e.target.value })} />
          <div className="subtitle-times">
            <label>开始 (秒)<input aria-label="字幕开始时间" type="number" min="0" max="86400" step={1 / project.fps} value={draft.start} disabled={locked} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
            <label>结束 (秒)<input aria-label="字幕结束时间" type="number" min="0" max="86400" step={1 / project.fps} value={draft.end} disabled={locked} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
          </div>
          {draftStale && <p className="subtitle-warning">项目已变化，重新点击此条字幕后再编辑。</p>}
          <div className="subtitle-draft-actions"><button className="small-button" onClick={() => setDraft(null)}>取消</button><button className="primary small-button" disabled={locked || !!draftStale} onClick={saveCue}>保存此条</button></div>
        </div>}
      </div>)}
    </div>
    <div className="subtitle-batch">
      <div className="subtitle-heading"><h4>批量修改</h4><span>已选 {selected.length} 条</span></div>
      <div className="subtitle-batch-tabs" role="tablist" aria-label="字幕批量操作">
        {([['offset', '时间偏移'], ['replace', '查找替换'], ['style', '统一样式']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? "active" : ""} onClick={() => { setMode(key); setPlan(null); }}>{label}</button>)}
      </div>
      {mode === "offset" && <label className="subtitle-batch-field">偏移秒数（负数提前）<input aria-label="字幕偏移秒数" type="number" step={1 / project.fps} value={offset} onChange={e => { setOffset(e.target.value); setPlan(null); }} /></label>}
      {mode === "replace" && <div className="subtitle-replace"><input aria-label="查找字幕文字" placeholder="查找文字（区分大小写）" value={find} onChange={e => { setFind(e.target.value); setPlan(null); }} /><input aria-label="替换字幕文字" placeholder="替换为（可留空）" value={replacement} onChange={e => { setReplacement(e.target.value); setPlan(null); }} /></div>}
      {mode === "style" && <><label className="subtitle-batch-field">样式参考字幕<select aria-label="字幕样式参考" value={referenceId} onChange={e => { setReferenceId(e.target.value); setPlan(null); }}><option value="">选择参考字幕</option>{clips.map(c => <option key={c.id} value={c.id}>{timeLabel(c.start)} · {c.text!.text.slice(0, 30) || "空字幕"}</option>)}</select></label><p className="subtitle-hint">复制字体、字号、颜色、描边与对齐；保留每条文案、位置和动画。</p></>}
      {plan ? <div className="subtitle-plan"><p>{stale ? "项目已变化，请重新检查修改。" : `将修改 ${plan.changedIds.length} 条字幕，可一次撤销。`}</p><div><button className="small-button" onClick={prepare}>重新检查</button><button className="primary small-button" disabled={stale || locked} onClick={apply}>应用 {plan.changedIds.length} 条修改</button></div></div> : <button className="small-button subtitle-check" disabled={!selected.length || locked} onClick={prepare}>检查修改</button>}
    </div>
    {error && <p ref={feedback} className="subtitle-error" role="alert">{error}</p>}
    {notice && <p className="subtitle-notice" role="status">{notice}</p>}
  </section>;
}
