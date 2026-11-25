import { memo, useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowRight, ArrowUp, AudioLines, Check, ChevronDown, ChevronRight, Clapperboard, Clock3, Images, Languages, ListChecks, LogIn, MessageSquare, PanelTop, Play, Plus, RefreshCw, Shield, Sparkles, Square, Subtitles, Trash2, Type, X } from "lucide-react";
import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import { agentPlanStatus, useEditorStore } from "../editor/store";
import { assistantProjectContext, assistantRequestMode } from "../core/assistantEdits";
import {
  MAX_ASSISTANT_REFERENCE_BYTES, MAX_ASSISTANT_REFERENCES, MAX_ASSISTANT_WORK_ENTRIES, type AssistantActivityKind, type AssistantMessage, type AssistantMode, type AssistantProvider, type AssistantWorkEntry,
  type AssistantProviderInfo, type AssistantReference, type AssistantMediaSelection, type CodexAgentAccount, type CodexAgentModel,
} from "../core/assistantTypes";
import type { MediaAsset, Project } from "../core/types";
import AssistantAttachments from "./AssistantAttachments";
import "./AssistantPanel.css";

type AccountState = CodexAgentAccount | "checking" | "signing-in" | "signing-out" | "unavailable";
type OpenMenu = "connection" | "model" | "references" | "data";
type ActiveRequest = {
  id: string; project: Project; history: AssistantMessage[]; controller: AbortController; submitted: boolean; existingPlanId?: string;
  mode: AssistantMode;
  startedAt: number;
  work: AssistantWorkEntry[];
};
const providerKey = "reacut-assistant-provider";

const effortLabels: Record<string, [string, string]> = {
  none: ["关闭", "None"], minimal: ["最少", "Minimal"], light: ["轻量", "Light"], low: ["低", "Low"],
  medium: ["中", "Medium"], high: ["高", "High"], xhigh: ["很高", "Extra High"], max: ["最高", "Max"],
};

function replyInline(value: string) {
  return value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => {
    if (index % 2 === 0) return part;
    return part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <code key={index}>{part.slice(1, -1)}</code>;
  });
}

const ReplyText = memo(function ReplyText({ content, streaming }: { content: string; streaming?: boolean }) {
  const normalized = content.replace(/\r\n/g, "\n");
  const text = streaming ? normalized.replace(/(?:^|\n)(?:#{1,6}|[-*+>]|\d+[.)]|`{1,3}[\w+-]*)[ \t]*$/, "") : normalized;
  const blocks = text.split(/(^```[^\n]*\n[\s\S]*?(?:^```[ \t]*(?:\n|$)|(?![\s\S])))/m);
  return <div className="assistant-reply">{blocks.map((value, index) => {
    if (index % 2 === 1) {
      const code = value.slice(value.indexOf("\n") + 1).replace(/(?:^|\n)```[ \t]*\n?$/, "");
      return <pre key={index}><code>{code}</code></pre>;
    }
    const prose = value.trim().replace(/(^#{1,6} [^\n]+)\n(?=\S)/gm, "$1\n\n");
    return prose.split(/\n{2,}|\n(?=#{1,6} )/).filter(Boolean).map((block, paragraph) => {
      const key = `${index}-${paragraph}`;
      const lines = block.split("\n");
      if (lines.length === 1 && /^#{1,6} /.test(block)) return <h3 key={key}>{replyInline(block.replace(/^#{1,6} /, ""))}</h3>;
      if (lines.every(line => /^[-*+] /.test(line))) return <ul key={key}>{lines.map((line, row) => <li key={row}>{replyInline(line.slice(2))}</li>)}</ul>;
      if (lines.every(line => /^\d+[.)] /.test(line))) return <ol key={key} start={parseInt(lines[0], 10)}>{lines.map((line, row) => <li key={row}>{replyInline(line.replace(/^\d+[.)] /, ""))}</li>)}</ol>;
      if (lines.every(line => /^> ?/.test(line))) return <blockquote key={key}>{replyInline(lines.map(line => line.replace(/^> ?/, "")).join("\n"))}</blockquote>;
      return <p key={key}>{replyInline(block)}</p>;
    });
  })}</div>;
});

function workTime(elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 1) return "<1s";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

type Activity = Extract<AssistantWorkEntry, { type: "activity" }>;
const activityLabels: Record<AssistantActivityKind, [string, string]> = {
  source: ["已选取音频", "Selected audio"],
  transcription: ["已识别语音", "Transcribed speech"],
  translation: ["已翻译字幕", "Translated subtitles"],
  captions: ["已准备字幕", "Prepared subtitles"],
  edit: ["已编辑时间线", "Edited timeline"],
  preview: ["已准备预览", "Prepared preview"],
  plan: ["已规划剪辑", "Planned edit"],
};

function finishActivity(entries: AssistantWorkEntry[], state: "done" | "stopped", kind?: AssistantActivityKind, text?: string) {
  return entries.map(entry => entry.type === "activity" && entry.state === "active" && (!kind || entry.kind === kind)
    ? { ...entry, state, text: text ?? entry.text } : entry);
}

function WorkEntries({ entries, elapsedMs }: { entries: AssistantWorkEntry[]; elapsedMs?: number }) {
  const ui = useUITranslation();
  const blocks: (Activity[] | Extract<AssistantWorkEntry, { type: "note" }>)[] = [];
  for (const entry of entries) {
    const last = blocks.at(-1);
    if (entry.type === "note") blocks.push(entry);
    else if (Array.isArray(last)) last.push(entry);
    else blocks.push([entry]);
  }
  return blocks.map((block, index) => {
    if (!Array.isArray(block)) return <div className="assistant-live-note" key={index}><ReplyText content={block.text} /></div>;
    const active = block.find(entry => entry.state === "active");
    const Icon = block.some(entry => entry.kind === "transcription" || entry.kind === "source") ? AudioLines
      : block.some(entry => entry.kind === "translation") ? Languages : ListChecks;
    const summary = [...new Set(block.map(entry => entry.state === "done" && entry.kind !== "plan"
      ? ui(...activityLabels[entry.kind]) : entry.text))].join(ui("、", ", "));
    return <details className="assistant-activity" key={index} data-active={!!active}>
      <summary title={active?.text || summary}>
        <Icon size={14} aria-hidden="true" />
        <span className="assistant-activity-title">{summary}</span>
        {active && elapsedMs !== undefined && elapsedMs >= 1000 && <span className="assistant-activity-time" aria-hidden="true">{workTime(elapsedMs)}</span>}
        <ChevronRight className="assistant-activity-chevron" size={12} aria-hidden="true" />
      </summary>
      <ul>{block.map((entry, row) => <li key={row}>
        {entry.state === "done" ? <Check size={12} aria-hidden="true" /> : entry.state === "stopped" ? <X size={12} aria-hidden="true" /> : <Clock3 size={12} aria-hidden="true" />}
        {entry.text}
      </li>)}</ul>
    </details>;
  });
}

function CompletedWork({ work }: { work: NonNullable<AssistantMessage["work"]> }) {
  const ui = useUITranslation();
  const entries = work.entries ?? work.commentary.map(text => ({ type: "note" as const, text }));
  return <div className="assistant-work">
    <WorkEntries entries={entries} />
    <div className="assistant-work-label"><Clock3 size={13} aria-hidden="true" />{ui(`工作用时 ${workTime(work.elapsedMs)}`, `Worked for ${workTime(work.elapsedMs)}`)}</div>
  </div>;
}

function preferredProvider(): AssistantProvider {
  try {
    const provider = localStorage.getItem(providerKey);
    if (provider === "codex" || provider === "claude") return provider;
  } catch { /* Chat remains usable without browser preferences. */ }
  return "codex-agent";
}

async function loadReference(asset: MediaAsset, signal: AbortSignal): Promise<AssistantReference> {
  const invalid = "参考帧无效或过大，请重新选择。";
  if (!asset.thumbnail?.startsWith("reacut-media://asset?path=")) throw new Error(invalid);
  const response = await fetch(asset.thumbnail, { signal });
  if (!response.ok || Number(response.headers.get("Content-Length")) > MAX_ASSISTANT_REFERENCE_BYTES) throw new Error(invalid);
  const blob = await response.blob();
  if (blob.type !== "image/jpeg" || blob.size > MAX_ASSISTANT_REFERENCE_BYTES) throw new Error(invalid);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(invalid));
    reader.readAsDataURL(blob);
  });
  signal.throwIfAborted();
  return { assetId: asset.id, dataUrl };
}

interface Props {
  inspectorVisible: boolean;
  importing: boolean;
  onToggleInspector(): void;
  onImportMedia(): void;
  onPreviewMedia(selection: AssistantMediaSelection): void;
  onClose(): void;
}

export default function AssistantPanel({ inspectorVisible, importing, onToggleInspector, onImportMedia, onPreviewMedia, onClose }: Props) {
  const ui = useUITranslation();
  const api = window.editorAPI;
  const project = useEditorStore(s => s.project);
  const proposal = useEditorStore(s => s.agentPlan);
  const agentPreviewId = useEditorStore(s => s.agentPreviewId);
  const setAgentPreview = useEditorStore(s => s.setAgentPreview);
  const transactionOpen = useEditorStore(s => s.transactionOpen);
  const [provider, setProvider] = useState<AssistantProvider>(preferredProvider);
  const [providers, setProviders] = useState<AssistantProviderInfo[]>([]);
  const [account, setAccount] = useState<AccountState>("checking");
  const [accountError, setAccountError] = useState("");
  const [models, setModels] = useState<CodexAgentModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [effort, setEffort] = useState("");
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [requestMode, setRequestMode] = useState<AssistantMode>("edit");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [stream, setStream] = useState("");
  const [workEntries, setWorkEntries] = useState<AssistantWorkEntry[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const active = useRef<ActiveRequest | null>(null);
  const generation = useRef(0);
  const providerGeneration = useRef(0);
  const accountGeneration = useRef(0);
  const signingIn = useRef(false);
  const history = useRef<AssistantMessage[]>([]);
  const chat = useRef<HTMLDivElement>(null);
  const followChat = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const header = useRef<HTMLElement>(null);
  const composeRegion = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);

  const isAgent = provider === "codex-agent";
  const cli = isAgent ? "codex" : provider;
  const currentProvider = providers.find(item => item.id === cli);
  const changingAccount = account === "signing-in" || account === "signing-out";
  const candidates = isAgent ? project.assets.filter(asset => asset.kind !== "audio" && !asset.missing && asset.thumbnail?.startsWith("reacut-media://asset?path=")) : [];
  const references = referenceIds.flatMap(id => candidates.find(asset => asset.id === id) ?? []);
  const model = models.find(item => item.id === modelId) ?? models.find(item => item.isDefault);
  const canUseReferences = isAgent && model?.acceptsImages !== false;
  const canSend = loaded && !busy && !!currentProvider?.available && (!isAgent || account === "connected") && (!references.length || canUseReferences);
  const needSignIn = isAgent && currentProvider?.available && account === "signed-out";
  const backendLabel = isAgent ? "Codex" : provider === "codex" ? "Codex CLI" : "Claude";
  const connected = !!currentProvider?.available && (!isAgent || account === "connected");
  const hostChat = !!window.reacutPlugin && !connected;
  const effortLabel = (value: string) => effortLabels[value] ? ui(...effortLabels[value]) : value;

  async function refresh(choose = false) {
    if (!api) return;
    const version = ++providerGeneration.current;
    try {
      setAccountError("");
      const result = await (choose ? api.chooseAssistantCLI(cli) : api.getAssistantProviders());
      if (providerGeneration.current === version) setProviders(result);
    } catch (e) {
      if (providerGeneration.current === version) setAccountError(String(e));
    }
  }

  async function updateAccount(action: "checking" | "signing-in" | "signing-out") {
    if (!api) return;
    const version = ++accountGeneration.current;
    setAccount(action);
    setAccountError("");
    if (action === "signing-in") signingIn.current = true;
    try {
      const read = action === "checking" ? api.getCodexAgentAccount : action === "signing-in" ? api.signInCodexAgent : api.signOutCodexAgent;
      const result = await read();
      if (accountGeneration.current === version) {
        setAccount(result);
        if (action === "signing-in" && result === "connected") setError("");
      }
    } catch (e) {
      if (accountGeneration.current === version) {
        setAccount(action === "signing-in" ? "signed-out" : action === "signing-out" ? "connected" : "unavailable");
        setAccountError(String(e));
      }
    } finally {
      if (action === "signing-in") signingIn.current = false;
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      ++providerGeneration.current;
      ++accountGeneration.current;
      if (signingIn.current) void api?.cancelCodexAgentSignIn().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (isAgent && currentProvider?.available) void updateAccount("checking");
    else { ++accountGeneration.current; setAccount("checking"); }
  }, [isAgent, currentProvider]);
  useEffect(() => {
    let active = true;
    setModels([]); setModelId(""); setEffort(""); setCatalogFailed(false);
    if (isAgent && account === "connected") void api?.listCodexAgentModels().then(items => {
      if (active) setModels(items);
    }).catch(() => { if (active) setCatalogFailed(true); });
    return () => { active = false; };
  }, [isAgent, account, currentProvider]);

  useEffect(() => {
    if (!menu) return;
    const region = menu === "connection" ? header.current : composeRegion.current;
    const closeOutside = (event: PointerEvent) => { if (!region?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenu(null);
      menuTrigger.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  useEffect(() => {
    const current = ++generation.current;
    history.current = [];
    followChat.current = true;
    setMessages([]); setBusy(false); setStream(""); setError(""); setStatus(""); setLoaded(false);
    setWorkEntries([]); setElapsedMs(0);
    setPrompt(""); setRequestMode("edit"); setReferenceIds([]); setMenu(null);
    void api?.getAssistantHistory(project.id).then(items => {
      if (generation.current === current) { history.current = items; setMessages(items); setLoaded(true); }
    }).catch(e => { if (generation.current === current) { setError(String(e)); setLoaded(true); } });
    return () => {
      ++generation.current;
      const request = active.current;
      active.current = null;
      request?.controller.abort();
      if (request?.submitted) void api?.cancelAssistant(request.id).catch(() => {});
    };
  }, [project.id]);

  function persist(items: AssistantMessage[], projectId: string) {
    const current = generation.current;
    const limited = items.slice(-40).map(message => ({ ...message, content: message.content.slice(0, 6000) }));
    while (JSON.stringify(limited).length > 250000) limited.shift();
    history.current = limited;
    setMessages(limited);
    void api?.saveAssistantHistory(projectId, limited).catch(e => {
      if (generation.current === current) setError(ui(`对话保存失败：${String(e)}`, `Could not save conversation: ${String(e)}`));
    });
  }

  useEffect(() => api?.onAssistantEvent(event => {
    const request = active.current;
    if (!request || event.requestId !== request.id || (request.controller.signal.aborted && event.type !== "cancelled")) return;
    const remember = (entry: AssistantWorkEntry) => {
      request.work = [...request.work, entry].slice(-MAX_ASSISTANT_WORK_ENTRIES);
      setWorkEntries(request.work);
    };
    if (event.type === "status") { setStatus(event.message); return; }
    if (event.type === "activity") {
      const text = localizeMessage(event.message);
      if (event.state === "done" && request.work.some(entry => entry.type === "activity" && entry.kind === event.kind && entry.state === "active")) {
        request.work = finishActivity(request.work, "done", event.kind, text);
        setWorkEntries(request.work);
      } else {
        if (event.kind === "plan") request.work = finishActivity(request.work, "done", "plan");
        remember({ type: "activity", kind: event.kind, text, state: event.state ?? "active" });
      }
      if (event.kind === "source") setStream("");
      return;
    }
    if (event.type === "text") { setStream(text => text + event.text); return; }
    if (event.type === "commentary") {
      remember({ type: "note", text: event.text });
      return;
    }
    active.current = null;
    setBusy(false); setStream("");
    if (event.type === "complete") {
      const { reply, actions, mode } = event.response;
      request.work = finishActivity(request.work, "done", "plan");
      if (actions.some(action => action.type === "addCaptions")) {
        request.work = finishActivity(request.work, "done", "translation", ui("已翻译字幕", "Translated subtitles"));
        request.work = finishActivity(request.work, "done", "captions", ui("已准备字幕", "Prepared subtitles"));
      }
      request.work = finishActivity(request.work, "stopped");
      const state = useEditorStore.getState();
      if (actions.length && mode !== "answer" && request.mode !== "answer") {
        try {
          if (state.agentPlan && state.agentPlan.id !== request.existingPlanId)
            throw new Error(ui("已有新的剪辑结果，请重新发送指令", "A newer edit has arrived. Send the request again."));
          const plan = state.submitAgentEdits(request.project, actions, {
            source: "agent", mode: mode === "edit" && request.mode === "edit" ? "edit" : "preview",
            transcriptions: event.transcriptions,
          });
          const count = event.transcriptions?.reduce((total, transcript) => total + transcript.cues.length, 0);
          if (plan.status === "applied") {
            remember({ type: "activity", kind: "edit", state: "done", text: count
              ? ui(`已将 ${count} 条字幕添加到时间线`, `Added ${count} subtitles to the timeline`)
              : ui("已应用时间线编辑", "Applied timeline edits") });
          } else if (plan.status === "pending") {
            remember({ type: "activity", kind: "preview", state: "done", text: ui("已准备时间线预览", "Prepared timeline preview") });
          }
        }
        catch (e) { setError(localizeMessage(String(e))); }
      }
      persist([...request.history, { role: "assistant", content: reply, work: {
        elapsedMs: performance.now() - request.startedAt, commentary: [], entries: request.work,
      } }], request.project.id);
      setWorkEntries([]);
      setStatus("");
    } else if (event.type === "error") {
      setWorkEntries(finishActivity(request.work, "stopped"));
      setStatus(""); setError(event.message);
      if (event.account) setAccount(event.account);
    } else {
      setWorkEntries(finishActivity(request.work, "stopped"));
      setStatus(ui("已取消", "Cancelled"));
    }
  }), []);

  useEffect(() => {
    const request = active.current;
    if (!busy || !request) return;
    const timer = window.setInterval(() => setElapsedMs(performance.now() - request.startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const pane = chat.current;
    if (pane && followChat.current) pane.scrollTop = pane.scrollHeight;
  }, [messages, stream, workEntries, status, error, proposal]);

  async function send() {
    const value = prompt.trim();
    if (!value || !canSend || active.current || !api) return;
    const state = useEditorStore.getState();
    const captured = state.project;
    const previous = history.current.slice(-20).map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
    const items: AssistantMessage[] = [...history.current, { role: "user", content: value }];
    const request: ActiveRequest = {
      id: crypto.randomUUID(), project: captured, history: items, controller: new AbortController(), submitted: false,
      mode: assistantRequestMode(requestMode, value),
      existingPlanId: state.agentPlan?.id,
      startedAt: performance.now(), work: [],
    };
    active.current = request;
    followChat.current = true;
    if (state.agentPlan?.source === "agent") state.clearAgentPlan();
    setBusy(true); setError(""); setStream(""); setMenu(null);
    setWorkEntries([]); setElapsedMs(0);
    setStatus(ui("正在准备项目上下文…", "Preparing project context…"));
    try {
      const images = await Promise.all(references.map(asset => loadReference(asset, request.controller.signal)));
      if (active.current !== request) return;
      const context = assistantProjectContext(captured, state.selectedIds, state.playhead, images.map(image => image.assetId), state.agentMedia);
      persist(items, captured.id);
      setPrompt(current => current.trim() === value ? "" : current); setReferenceIds([]);
      request.submitted = true;
      await api.startAssistant({
        requestId: request.id, provider, prompt: value, mode: request.mode, history: previous, context, references: images.length ? images : undefined,
        codexSelection: isAgent && model && (modelId || effort) ? { model: model.id, effort: effort || undefined } : undefined,
      }, isAgent ? { project: captured, playhead: state.playhead, media: state.agentMedia } : undefined);
    } catch (e) {
      if (active.current === request) { active.current = null; setBusy(false); setError(String(e)); setStatus(""); }
    }
  }

  function cancel() {
    const request = active.current;
    if (!request) return;
    request.controller.abort();
    const finish = () => {
      if (active.current !== request) return;
      active.current = null; setBusy(false); setStream(""); setStatus(ui("已取消", "Cancelled"));
      setWorkEntries(finishActivity(request.work, "stopped"));
    };
    if (request.submitted) void api?.cancelAssistant(request.id).then(finish).catch(e => { finish(); setError(String(e)); });
    else finish();
  }

  function apply() {
    if (!proposal) return;
    try {
      useEditorStore.getState().applyAgentPlan(proposal.id);
      setError("");
    } catch (e) { setError(localizeMessage(String(e))); }
  }

  function writePrompt(value: string, mode: AssistantMode) {
    setPrompt(value); setRequestMode(mode); composer.current?.focus();
  }
  function toggleMenu(target: OpenMenu, event: MouseEvent<HTMLButtonElement>) {
    menuTrigger.current = event.currentTarget;
    setMenu(current => current === target ? null : target);
  }

  const planStatus = proposal ? agentPlanStatus(proposal, project) : null;
  const stale = planStatus === "stale";
  const unchanged = planStatus === "unchanged";
  const planNeedsReview = planStatus === "pending" || stale;
  const showPlan = !!proposal && !unchanged && expandedPlanId === proposal.id;
  const previewing = !!proposal && agentPreviewId === proposal.id;
  const proposalCount = proposal?.preview.descriptions.length ?? 0;
  const subtitlePrompt = ui("帮我给这个视频加上英文字幕", "Add English subtitles to this video");
  const examples = [
    ...(isAgent ? [{ icon: Subtitles, mode: "edit", label: subtitlePrompt, prompt: subtitlePrompt } as const] : []),
    { icon: Clapperboard, mode: "edit", label: ui("编排粗剪", "Assemble a rough cut"), prompt: ui("用媒体库里的素材排一版约 15 秒的粗剪，选段按顺序放进当前时间线。", "Assemble a roughly 15-second cut from the media bin and place the chosen ranges in order on this timeline.") },
    { icon: Type, mode: "edit", label: ui("添加片头", "Add an opening title"), prompt: ui("在播放头添加一个 3 秒的标题「从这里开始」。", "Add a three-second title at the playhead with the text ‘Start here’.") },
    ...(!isAgent ? [{ icon: ListChecks, mode: "answer", label: ui("检查时间线", "Review the timeline"), prompt: ui("根据当前时间线给我三条修改建议，先不要生成修改方案。", "Review this timeline and give me three suggestions before proposing changes.") } as const] : []),
  ] as const;
  const empty = !messages.length && !busy && !proposal && !error && !status;
  const displayedEffort = effort || model?.defaultEffort;
  const modelLabel = model ? `${model.label}${displayedEffort ? ` · ${effortLabel(displayedEffort)}` : ""}` : backendLabel;
  return <aside className="assistant-panel panel" aria-label={ui("剪辑助手", "Editing assistant")}>
    <header ref={header}>
      <strong><Sparkles size={15} />{ui("剪辑 Agent", "Editing Agent")}</strong>
      <div className="assistant-header-actions">
        <button className="assistant-connection-trigger" aria-label={ui("连接设置", "Connection settings")} aria-expanded={menu === "connection"} aria-controls="assistant-connection" title={connected ? ui("已连接", "Connected") : ui("连接设置", "Connection settings")} onClick={event => toggleMenu("connection", event)}>
          <span className="assistant-connection-dot" data-connected={connected} />{backendLabel}<ChevronDown size={12} />
        </button>
        <button aria-label={ui("显示属性面板", "Show properties")} aria-pressed={inspectorVisible} className={inspectorVisible ? "active" : ""} title={ui("属性面板", "Properties")} onClick={() => { setMenu(null); onToggleInspector(); }}><PanelTop size={15} /></button>
        <button aria-label={ui("关闭剪辑助手", "Close editing assistant")} title={ui("关闭", "Close")} onClick={onClose}><X size={16} /></button>
      </div>
      {menu === "connection" && <div id="assistant-connection" className="assistant-menu assistant-connection-menu" role="group" aria-label={ui("连接设置", "Connection settings")}>
        <div className="assistant-config">
          <select aria-label={ui("助手后端", "Assistant backend")} value={provider} disabled={busy || changingAccount} onChange={e => {
            const next = e.target.value as AssistantProvider;
            setProvider(next); setReferenceIds([]); setAccountError("");
            try { localStorage.setItem(providerKey, next); } catch { /* Optional preference. */ }
          }}>
            <option value="codex-agent">Codex App Server</option><option value="codex">Codex CLI</option><option value="claude">Claude Code</option>
          </select>
          <button aria-label={ui("刷新助手状态", "Refresh assistant status")} title={ui("刷新", "Refresh")} disabled={busy || changingAccount} onClick={() => void refresh()}><RefreshCw size={14} /></button>
        </div>
        <p className="assistant-provider-status">{currentProvider?.available ? currentProvider.version || currentProvider.label : currentProvider ? ui("选择已安装的 CLI", "Select an installed CLI") : ui("正在查找 Codex…", "Finding Codex…")}</p>
        {isAgent && connected && <p className="assistant-provider-status">{ui("已连接 ChatGPT", "ChatGPT connected")}</p>}
        {hostChat && needSignIn && <button className="assistant-sign-in" onClick={() => { setMenu(null); void updateAccount("signing-in"); }}><LogIn size={14} />{ui("连接本机 Codex", "Connect local Codex")}</button>}
        <div className="assistant-connection-actions">
          <button disabled={busy || changingAccount || !api} onClick={() => void refresh(true)}>{ui("选择 CLI", "Choose CLI")}</button>
          {isAgent && connected && <button disabled={busy} onClick={() => { setMenu(null); void updateAccount("signing-out"); }}>{ui("退出登录", "Sign out")}</button>}
          <button disabled={busy || !messages.length} onClick={() => {
            persist([], project.id);
            if (proposal?.source === "agent") useEditorStore.getState().clearAgentPlan();
            setError(""); setStatus(""); setWorkEntries([]); setMenu(null);
          }}><Trash2 size={13} />{ui("清空对话", "Clear chat")}</button>
        </div>
      </div>}
    </header>
    <div ref={chat} className={`assistant-chat${empty ? " empty" : ""}`} role="log" aria-live="polite" aria-label={ui("剪辑对话", "Editing conversation")}
      onScroll={event => {
        const pane = event.currentTarget;
        followChat.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop < 56;
      }}>
      {empty && <div className="assistant-welcome">
        <span className="assistant-welcome-mark" aria-hidden="true"><Clapperboard size={23} strokeWidth={1.45} /></span>
        <h2>{ui("想怎么剪？", "What are we editing?")}</h2>
        {!hostChat && <div className="assistant-starters">{examples.map(({ icon: Icon, label, prompt, mode }) => <button key={label} onClick={() => writePrompt(prompt, mode)}><Icon size={14} />{label}<ArrowRight size={12} /></button>)}</div>}
      </div>}
      {messages.map((message, index) => <div key={index} className="assistant-turn">
        {message.work && <CompletedWork work={message.work} />}
        <div className={`assistant-message ${message.role}`}>
          <span className="assistant-visually-hidden">{message.role === "user" ? ui("你", "You") : "Agent"}</span>
          {message.role === "user" ? <p>{message.content}</p> : <ReplyText content={message.content} />}
        </div>
      </div>)}
      {proposal?.source === "chatgpt" && proposal.summary && <div className="assistant-message assistant"><span className="assistant-visually-hidden">ChatGPT</span><p>{proposal.summary}</p></div>}
      <WorkEntries entries={workEntries} elapsedMs={elapsedMs} />
      {busy && !workEntries.some(entry => entry.type === "activity" && entry.state === "active") && <p className="assistant-status running" title={localizeMessage(status)}>
        {localizeMessage(status) || ui("正在处理请求…", "Preparing the request…")}
        {elapsedMs >= 1000 && <span aria-hidden="true">{workTime(elapsedMs)}</span>}
      </p>}
      {stream && <div className="assistant-message assistant"><ReplyText content={stream} streaming /></div>}
      {!busy && status && <p className="assistant-status">{localizeMessage(status)}</p>}
      {error && <p className="assistant-error" role="alert">{localizeMessage(error)}</p>}
    </div>
    {proposal && <section className="assistant-proposal" aria-label={ui("剪辑方案", "Edit plan")}>
      <div className="assistant-plan-row">
        {unchanged ? <span className="assistant-plan-title">{ui("剪辑结果", "Timeline edits")}</span>
          : <button className="assistant-plan-toggle" aria-expanded={showPlan} aria-controls="assistant-plan-details" onClick={() => setExpandedPlanId(showPlan ? null : proposal.id)}>
            <ListChecks size={16} /><span>{planNeedsReview ? ui("剪辑方案", "Edit plan") : ui("剪辑结果", "Timeline edits")}<small>{proposal.source === "chatgpt" && "ChatGPT · "}{ui(`${proposalCount} 项`, `${proposalCount} changes`)}</small></span><ChevronDown size={13} />
          </button>}
        {!planNeedsReview
          ? <span className="assistant-apply-status">{planStatus === "applied" && <Check size={14} />}{unchanged ? ui("无改动", "No changes") : planStatus === "undone" ? ui("已撤销", "Undone") : ui("已应用", "Applied")}</span>
          : <div className="assistant-plan-actions">
            {!stale && <button className="assistant-preview" disabled={transactionOpen} aria-pressed={previewing} aria-label={ui("预览方案", "Preview edit")} title={ui("预览方案", "Preview edit")} onClick={() => setAgentPreview(previewing ? null : proposal.id)}><Play size={13} />{ui("预览", "Preview")}</button>}
            <button className="assistant-apply" disabled={stale || transactionOpen} aria-label={stale ? ui("项目已变化，请重新生成", "Project changed. Generate again.") : ui(`应用 ${proposalCount} 项修改`, `Apply ${proposalCount} changes`)} onClick={apply}>{stale ? ui("方案已过期", "Outdated") : ui("应用", "Apply")}</button>
          </div>}
      </div>
      {showPlan && <div id="assistant-plan-details" className="assistant-plan-details">
        <ol>{proposal.preview.descriptions.map((item, index) => <li key={index}>{item}</li>)}</ol>
        <small>{ui("片段", "Clips")} {proposal.preview.before.clips} → {proposal.preview.after.clips} · {ui("时长", "Duration")} {proposal.preview.before.duration.toFixed(2)} → {proposal.preview.after.duration.toFixed(2)} s</small>
      </div>}
    </section>}
    <div className="assistant-compose" ref={composeRegion}>
      {accountError && <p className="assistant-error" role="alert">{localizeMessage(accountError)}</p>}
      {!hostChat && needSignIn && <button className="assistant-sign-in" aria-label={ui("使用 ChatGPT 登录", "Sign in with ChatGPT")} onClick={() => { setMenu(null); void updateAccount("signing-in"); }}><LogIn size={14} />{ui("登录 ChatGPT", "Sign in with ChatGPT")}</button>}
      {isAgent && changingAccount && <div className="assistant-auth-progress" aria-live="polite">
        <span>{account === "signing-in" ? ui("在浏览器中登录", "Sign in in your browser") : ui("正在退出…", "Signing out…")}</span>
        {account === "signing-in" && <button aria-label={ui("取消登录", "Cancel sign-in")} title={ui("取消登录", "Cancel sign-in")} onClick={() => void api?.cancelCodexAgentSignIn().catch(e => setAccountError(String(e)))}><X size={14} /></button>}
      </div>}
      {menu === "references" && <div id="assistant-references" className="assistant-menu assistant-reference-picker" role="group" aria-label={ui("选择参考帧", "Choose reference frames")}>
        {candidates.length ? candidates.map(asset => {
          const selected = references.some(reference => reference.id === asset.id);
          return <button key={asset.id} aria-pressed={selected} disabled={!selected && references.length >= MAX_ASSISTANT_REFERENCES} onClick={() => setReferenceIds(selected ? referenceIds.filter(id => id !== asset.id) : [...references.map(reference => reference.id), asset.id])}>
            <img src={asset.thumbnail} alt="" /><span>{asset.name}</span>{selected && <Check size={14} />}
          </button>;
        }) : <p>{ui("先导入视频或图片。", "Import a video or image first.")}</p>}
      </div>}
      {menu === "model" && <div id="assistant-model" className="assistant-menu assistant-model-menu" role="group" aria-label={ui("模型与推理强度", "Model and reasoning effort")}>
        <label>{ui("模型", "Model")}<select value={modelId} aria-label={ui("模型", "Model")} onChange={event => { setModelId(event.target.value); setEffort(""); }}>
          <option value="">{ui("Codex 默认", "Codex default")}</option>{models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        {!!model?.efforts.length && <label>{ui("推理强度", "Reasoning effort")}<select value={effort} aria-label={ui("推理强度", "Reasoning effort")} onChange={event => setEffort(event.target.value)}>
          <option value="">{model.defaultEffort ? ui(`默认 · ${effortLabel(model.defaultEffort)}`, `Default · ${effortLabel(model.defaultEffort)}`) : ui("默认", "Default")}</option>
          {model.efforts.map(item => <option key={item} value={item}>{effortLabel(item)}</option>)}
        </select></label>}
        {catalogFailed && <p>{ui("暂时无法读取模型，使用 Codex 默认。", "The model list is unavailable. Codex will use its default.")}</p>}
      </div>}
      {menu === "data" && <div id="assistant-data" className="assistant-menu assistant-data-menu" role="group" aria-label={ui("发送给模型的数据", "Data sent to the model")}>
        <p>{isAgent && references.length
          ? ui(`发送近期对话、时间线和素材选段摘要，以及选中的 ${references.length} 张参考帧。`, `Sends recent chat, a summary of the timeline and selected source ranges, and ${references.length} selected reference frame(s).`)
          : ui("发送近期对话、时间线和素材选段摘要。", "Sends recent chat and a summary of the timeline and selected source ranges.")}</p>
        {isAgent && <p>{ui("生成字幕时，语音在本机识别，模型接收带时间戳的文字。", "Caption requests send timed text from local speech recognition.")}</p>}
      </div>}
      <div className="assistant-input">
        <AssistantAttachments project={project} references={hostChat ? [] : references} busy={busy}
          onPreviewMedia={onPreviewMedia} onRemoveReference={id => setReferenceIds(ids => ids.filter(current => current !== id))} />
        {hostChat ? <div className="assistant-host-prompt"><MessageSquare size={14} />{ui("在 ChatGPT 对话中描述剪辑", "Describe your edit in ChatGPT")}</div> : <>
          <textarea ref={composer} aria-label={ui("助手消息", "Assistant message")} placeholder={ui("描述你想要的剪辑…", "Describe your edit…")} maxLength={8000} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey || (canSend && !e.shiftKey))) { e.preventDefault(); void send(); }
          }} />
          {references.length > 0 && !canUseReferences && <p className="assistant-model-warning">{ui("所选模型不支持参考帧。", "This model does not support reference frames.")}</p>}
          <div className="assistant-compose-tools">
            <button aria-label={ui("导入素材", "Import media")} title={ui("导入素材", "Import media")} disabled={busy || importing || !api} onClick={onImportMedia}><Plus size={16} /></button>
            {isAgent && <button aria-label={ui("参考帧", "Reference frames")} aria-expanded={menu === "references"} aria-controls="assistant-references" title={ui("参考帧", "Reference frames")} disabled={busy || !canUseReferences} onClick={event => toggleMenu("references", event)}><Images size={15} />{references.length > 0 && <span>{references.length}</span>}</button>}
            <button aria-label={ui("发送内容", "What is sent")} aria-expanded={menu === "data"} aria-controls="assistant-data" title={ui("发送内容", "What is sent")} onClick={event => toggleMenu("data", event)}><Shield size={15} /></button>
            <select className="assistant-mode" aria-label={ui("请求模式", "Request mode")} title={ui("请求模式", "Request mode")} value={requestMode} disabled={busy} onChange={event => setRequestMode(event.currentTarget.value as AssistantMode)}>
              <option value="preview">{ui("预览", "Preview")}</option>
              <option value="edit">{ui("剪辑", "Edit")}</option>
              <option value="answer">{ui("问答", "Ask")}</option>
            </select>
            {isAgent && connected && <button className="assistant-model-trigger" aria-label={ui("模型与推理强度", "Model and reasoning effort")} aria-expanded={menu === "model"} aria-controls="assistant-model" title={modelLabel} disabled={busy} onClick={event => toggleMenu("model", event)}><span>{modelLabel}</span><ChevronDown size={12} /></button>}
            {busy ? <button className="assistant-send stop" aria-label={ui("取消", "Cancel")} title={ui("取消", "Cancel")} onClick={cancel}><Square size={12} fill="currentColor" /></button>
              : <button className="assistant-send" aria-label={ui("发送", "Send")} title={ui("发送（Enter）", "Send (Enter)")} disabled={!canSend || !prompt.trim()} onClick={() => void send()}><ArrowUp size={17} strokeWidth={2.2} /></button>}
          </div>
        </>}
      </div>
    </div>
  </aside>;
}
