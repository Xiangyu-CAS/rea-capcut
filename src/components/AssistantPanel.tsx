import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw, Send, Square, X } from "lucide-react";
import { useEditorStore } from "../editor/store";
import { assistantProjectContext, previewAssistantEdits, type AssistantEditPreview } from "../core/assistantEdits";
import type { AssistantMessage, AssistantProvider, AssistantProviderInfo } from "../core/assistantTypes";
import type { Project } from "../core/types";
import "./AssistantPanel.css";

type Proposal = { preview: AssistantEditPreview; base: string; applied: boolean };
export default function AssistantPanel({ onClose }: { onClose(): void }) {
  const ui = useUITranslation();
  const project = useEditorStore(s => s.project);
  const [provider, setProvider] = useState<AssistantProvider>("codex");
  const [providers, setProviders] = useState<AssistantProviderInfo[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState(""), [error, setError] = useState("");
  const [stream, setStream] = useState(""), [proposal, setProposal] = useState<Proposal | null>(null);
  const active = useRef<{ id: string; project: Project; base: string; history: AssistantMessage[] } | null>(null);
  const generation = useRef(0), lastPrompt = useRef("");
  const history = useRef<AssistantMessage[]>([]), chatEnd = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    try { setProviders(await window.editorAPI!.getAssistantProviders()); }
    catch (e) { setError(String(e)); }
  };
  useEffect(() => { if (window.editorAPI) void refresh(); }, []);
  useEffect(() => {
    const current = ++generation.current;
    const old = active.current; active.current = null;
    if (old) void window.editorAPI?.cancelAssistant(old.id).catch(() => {});
    history.current = []; setMessages([]); setProposal(null); setBusy(false); setStream(""); setError(""); setStatus(""); setLoaded(false);
    void window.editorAPI?.getAssistantHistory(project.id).then(items => {
      if (generation.current === current) { history.current = items; setMessages(items); setLoaded(true); }
    }).catch(e => { if (generation.current === current) { setError(String(e)); setLoaded(true); } });
    return () => { ++generation.current; const request = active.current; active.current = null; if (request) void window.editorAPI?.cancelAssistant(request.id).catch(() => {}); };
  }, [project.id]);
  const persist = (items: AssistantMessage[], projectId: string) => {
    const limited = items.slice(-40).map(m => ({ ...m, content: m.content.slice(0, 6000) }));
    history.current = limited; setMessages(limited);
    void window.editorAPI?.saveAssistantHistory(projectId, limited).catch(e => setError(ui(`对话保存失败：${String(e)}`, `Could not save conversation: ${String(e)}`)));
  };
  useEffect(() => window.editorAPI?.onAssistantEvent(event => {
    const request = active.current;
    if (!request || event.requestId !== request.id) return;
    if (event.type === "status") setStatus(event.message);
    if (event.type === "text") setStream(text => text + event.text);
    if (event.type === "complete") {
      persist([...request.history, { role: "assistant", content: event.response.reply }], request.project.id);
      if (event.response.actions.length) {
        try { setProposal({ preview: previewAssistantEdits(request.project, event.response.actions), base: request.base, applied: false }); }
        catch (e) { setError(ui(`建议未通过检查，项目未修改：${String(e)}`, `Suggestion validation failed; project unchanged: ${String(e)}`)); }
      }
      active.current = null; setBusy(false); setStream(""); setStatus(ui("回复完成", "Response complete"));
    }
    if (event.type === "error" || event.type === "cancelled") {
      active.current = null; setBusy(false); setStream(""); setStatus(event.type === "cancelled" ? ui("已取消", "Cancelled") : "");
      if (event.type === "error") setError(event.message);
    }
  }), []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages, stream, status]);
  const send = async (value = prompt) => {
    if (!value.trim() || active.current || !window.editorAPI) return;
    const s = useEditorStore.getState();
    const base = JSON.stringify(s.project), captured: Project = JSON.parse(base);
    const items: AssistantMessage[] = [...history.current, { role: "user", content: value.trim() }];
    const request = { id: crypto.randomUUID(), project: captured, base, history: items };
    active.current = request; lastPrompt.current = value; setBusy(true); setError(""); setProposal(null); setStream(""); setStatus(ui("正在连接 CLI…", "Connecting to CLI…")); setPrompt("");
    const previous = history.current.slice(-20).map(m => ({ ...m, content: m.content.slice(0, 4000) }));
    persist(items, captured.id);
    try { await window.editorAPI.startAssistant({ requestId: request.id, provider, prompt: value.trim(), history: previous, context: assistantProjectContext(captured, s.selectedIds, s.playhead) }); }
    catch (e) { if (active.current?.id === request.id) { active.current = null; setBusy(false); setError(String(e)); setStatus(""); } }
  };
  const currentProvider = providers.find(p => p.id === provider);
  const stale = proposal && JSON.stringify(project) !== proposal.base;
  return <aside className="assistant-panel panel" aria-label={ui("剪辑助手", "Editing assistant")}>
    <header><strong><MessageSquare size={16} /> {ui("剪辑助手", "Editing assistant")} </strong><button aria-label={ui("关闭剪辑助手", "Close editing assistant")} onClick={onClose}><X size={16} /></button></header>
    <div className="assistant-config">
      <select aria-label={ui("助手后端", "Assistant backend")} value={provider} disabled={busy} onChange={e => setProvider(e.target.value as AssistantProvider)}><option value="codex">Codex CLI</option><option value="claude">Claude Code</option></select>
      <button aria-label={ui("刷新助手状态", "Refresh assistant status")} disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /></button>
      <button disabled={busy || !window.editorAPI} onClick={() => void window.editorAPI!.chooseAssistantCLI(provider).then(setProviders).catch(e => setError(String(e)))}> {ui("选择 CLI", "Choose CLI")} </button>
    </div>
    <p className="assistant-provider-status">{currentProvider?.available ? ui(`已检测到 ${currentProvider.label} ${currentProvider.version ?? ""}`, `Detected ${currentProvider.label} ${currentProvider.version ?? ""}`) : (currentProvider?.error ? localizeMessage(currentProvider.error) : undefined) ?? ui("正在检测本机 CLI…", "Checking local CLI…")}</p>
    <div className="assistant-chat" aria-live="polite">
      {!messages.length && <div className="assistant-welcome"><MessageSquare size={28} /><h3> {ui("把剪辑想法说出来", "Describe your edit")} </h3><p> {ui("根据当前时间线提出修改，检查后由你应用。支持文字、裁剪、分割、变速、音量和画面调整。", "Get suggestions for the current timeline and review before applying. Supports text, trimming, splitting, speed, volume and picture adjustments.")} </p><button onClick={() => setPrompt(ui("在播放头添加持续3秒的标题：故事由此开始", "Add a 3-second title at the playhead: The story starts here"))}> {ui("添加片头标题", "Add an opening title")} </button><button onClick={() => setPrompt(ui("分析当前时间线，给我3条剪辑建议，暂时不要修改", "Analyze the timeline and suggest 3 improvements without making changes"))}> {ui("看看可以怎样改进", "Suggest improvements")} </button></div>}
      {messages.map((message, i) => <div key={i} className={`assistant-message ${message.role}`}><small>{message.role === "user" ? ui("你", "You") : ui("助手", "Assistant")}</small><p>{message.content}</p></div>)}
      {stream && <div className="assistant-message assistant"><small> {ui("助手", "Assistant")} </small><p>{stream}</p></div>}
      {status && <p className="assistant-status">{localizeMessage(status)}</p>}
      {error && <p className="assistant-error" role="alert">{localizeMessage(error)}</p>}
      {proposal && <div className="assistant-proposal"><strong> {ui("待检查的修改 ·", "Changes to review ·")} {proposal.preview.descriptions.length}  {ui("项", "changes")} </strong><ol>{proposal.preview.descriptions.map((item, i) => <li key={i}>{localizeMessage(item)}</li>)}</ol><p>{proposal.preview.before.clips} → {proposal.preview.after.clips}  {ui("个片段 ·", "clips ·")} {proposal.preview.after.duration.toFixed(2)}  {ui("秒", "s")} </p><button className="primary" disabled={proposal.applied || !!stale} onClick={() => {
        if (JSON.stringify(useEditorStore.getState().project) !== proposal.base) { setError(ui("项目已变化，请重新生成建议", "The project changed. Generate suggestions again.")); return; }
        useEditorStore.getState().commit(proposal.preview.project); setProposal({ ...proposal, applied: true });
      }}>{proposal.applied ? ui("已应用 · 可撤销", "Applied · Can be undone") : stale ? ui("项目已变化，请重新生成", "Project changed. Generate again.") : ui(`应用 ${proposal.preview.descriptions.length} 项修改`, `Apply ${proposal.preview.descriptions.length} changes`)}</button></div>}
      <div ref={chatEnd} />
    </div>
    <div className="assistant-compose"><p> {ui("发送会将问题、对话与时间线摘要交给所选 CLI 服务；不发送媒体文件。请先在终端登录 CLI。", "Sending shares your prompt, conversation and timeline summary with the selected CLI service, but not media files. Sign in to the CLI in your terminal first.")} </p><textarea aria-label={ui("助手消息", "Assistant message")} placeholder={ui("例如：把选中片段音量降低一半", "For example: halve the volume of the selected clip")} maxLength={8000} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (!busy && loaded && currentProvider?.available) void send(); } }} /><div><button disabled={busy || !messages.length} onClick={() => { persist([], project.id); setProposal(null); setError(""); }}> {ui("清空对话", "Clear conversation")} </button>{!busy && lastPrompt.current && <button onClick={() => void send(lastPrompt.current)} disabled={!currentProvider?.available}> {ui("重试", "Retry")} </button>}{busy ? <button onClick={() => { const req = active.current; if (req) void window.editorAPI?.cancelAssistant(req.id).catch(e => setError(String(e))); }}><Square size={13} /> {ui("取消", "Cancel")} </button> : <button className="primary" disabled={!loaded || !prompt.trim() || !currentProvider?.available} onClick={() => void send()}><Send size={13} /> {ui("发送", "Send")} </button>}</div></div>
  </aside>;
}
