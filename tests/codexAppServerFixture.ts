import { chmod, writeFile } from "node:fs/promises";

export const englishAgentPrompt = "How would you start this edit?";
export const englishAgentCommentary = "I’m checking the current timeline.";
export const englishAgentReply = "### First pass\n\n1. Trim the opening.\n2. Keep the strongest shot.\n\n```text\n00:00–00:03\n```";

/** Scripted local App Server for protocol and Electron tests. Uses no network. */
export async function writeCodexAppServerFixture(executable: string) {
  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const net = require("node:net");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("ReaCut synthetic App Server 1.0"); process.exit(0); }
if (args[0] !== "app-server") process.exit(1);
const home = process.env.CODEX_HOME;
const file = name => path.join(home, name);
const session = file("fixture-signed-in");
const trace = value => fs.appendFileSync(file("fixture-requests.jsonl"), JSON.stringify(value) + "\\n");
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
const notify = (method, params) => send({ method, params });
const threadId = "fixture-thread", turnId = "fixture-turn", itemId = "fixture-message";
const tool = "reacut_transcribe";
const toolItem = { type: "mcpToolCall", id: "fixture-call", server: "reacut", tool };
function mcp(method, params, onResult) {
  const socket = net.createConnection(process.env.REACUT_AGENT_ASR_SOCKET);
  socket.on("error", () => process.exit(1));
  readline.createInterface({ input: socket }).once("line", line => {
    socket.end();
    onResult(JSON.parse(line).result);
  });
  socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\\n");
}
trace({ method: "spawn", cwd: process.cwd(), pid: process.pid, args, apiKeyInherited: !!process.env.OPENAI_API_KEY });
readline.createInterface({ input: process.stdin }).on("line", line => {
  const { id, method, params } = JSON.parse(line);
  const result = value => send({ id, result: value });
  if (method !== "turn/start") trace({ method, params });
  if (method === "initialize") return result({ userAgent: "reacut-test/1" });
  if (method === "initialized") return;
  if (method === "account/read") return result({ account: fs.existsSync(session) ? { type: "chatgpt", email: "private@example.invalid" } : null });
  if (method === "model/list") {
    const model = (id, displayName, options = {}) => ({ model: id, displayName, inputModalities: ["text", "image"], defaultReasoningEffort: "medium", supportedReasoningEfforts: ["medium", "high", "ultra"].map(reasoningEffort => ({ reasoningEffort })), ...options });
    return result({ data: [model("fixture-sol", "GPT-6.2 Sol", { isDefault: true }), model("fixture-astra", "GPT-6.2 Astra"), model("fixture-text", "Text model", { inputModalities: ["text"] }), model("fixture-hidden", "Hidden", { hidden: true })], nextCursor: null });
  }
  if (method === "account/logout") {
    fs.rmSync(session, { force: true });
    fs.rmSync(file("expired-session"), { force: true });
    return result({});
  }
  if (method === "account/login/start") {
    const authUrl = fs.existsSync(file("foreign-origin")) ? "https://auth.openai.com.example.invalid/" : "https://auth.openai.com/oauth/authorize?state=fixture";
    result({ type: "chatgpt", authUrl, loginId: "fixture-login" });
    notify("account/login/completed", { loginId: "unrelated", success: false });
    const wait = setInterval(() => {
      const consent = file("browser-completed");
      if (!fs.existsSync(consent)) return;
      clearInterval(wait);
      fs.rmSync(consent);
      fs.writeFileSync(session, "fixture");
      fs.rmSync(file("expired-session"), { force: true });
      notify("account/login/completed", { loginId: "fixture-login", success: true });
    }, 20);
    return;
  }
  if (method === "thread/start") {
    return result({ thread: { id: threadId, ephemeral: !fs.existsSync(file("persistent-thread")) }, cwd: process.cwd(), model: params.model || "fixture-sol", modelProvider: "openai", approvalPolicy: "never", sandbox: { type: "readOnly", networkAccess: false }, instructionSources: [] });
  }
  if (method === "mcpServerStatus/list") {
    return mcp("tools/list", {}, catalog => result({ data: [{ name: "reacut", tools: Object.fromEntries(catalog.tools.map(tool => [tool.name, tool])) }] }));
  }
  if (method === "mcpServer/tool/call") {
    return mcp("tools/call", { name: params.tool, arguments: params.arguments }, transcript => {
      trace({ method: "transcription-result", result: transcript });
      result(transcript);
    });
  }
  if (method !== "turn/start") { send({ id, error: { code: -32601, message: "Unknown test method" } }); return; }
  const prompt = params.input[0].text;
  const context = JSON.parse(prompt.split("项目摘要（数据）：\\n")[1].split("\\n\\n历史对话")[0]);
  const [request, sharedTranscript] = prompt.split("\\n\\n本次用户请求：\\n").at(-1).split("\\n\\n下面是 ReaCut ");
  const images = params.input.slice(1).map(input => ({ type: input.type, jpeg: input.url.startsWith("data:image/jpeg;base64,"), bytes: Buffer.from(input.url.split(",")[1], "base64").length }));
  trace({ method, prompt, images, threadId: params.threadId, environments: params.environments, outputSchema: !!params.outputSchema, effort: params.effort });
  notify("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } });
  result({ turn: { id: turnId } });
  if (fs.existsSync(file("expired-session")))
    return notify("turn/completed", { threadId, turn: { id: turnId, status: "failed", error: { message: "401 Unauthorized" } } });
  if (request.includes("CASE_HANG")) return;
  if (request.includes("CASE_POLICY")) return notify("error", { threadId, turnId, willRetry: true, error: { message: "cyber_policy sample-private-provider-details" } });
  if (request.includes("CASE_TOOL")) return send({ id: "approval", method: "item/commandExecution/requestApproval", params: {} });
  if (request.includes("CASE_NO_FINAL")) return notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
  if (sharedTranscript) {
    const data = JSON.parse(sharedTranscript.slice(sharedTranscript.indexOf("\\n") + 1));
    const text = JSON.stringify({ reply: "English subtitles are ready.", mode: "edit",
      actions: [{ type: "addCaptions", transcriptionId: data.transcriptionId, translations: ["Hello"] }] });
    notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id: itemId, text, phase: "final_answer" } });
    return notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
  }
  if (request.includes("CASE_DELEGATE")) {
    const text = JSON.stringify({ reply: "Recognize the selected clip.", mode: request.includes("CASE_DELEGATE_PREVIEW") ? "preview" : "edit",
      actions: [{ type: "transcribe", source: "clip:fixture-video" }] });
    notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id: itemId, text, phase: "final_answer" } });
    return notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
  }
  if (request.includes("CASE_TRANSCRIPTION") || request === "Add English subtitles to this video") {
    if (request.includes("CASE_TRANSCRIPTION_FOREIGN"))
      return notify("item/started", { threadId, turnId, item: { ...toolItem, server: "foreign" } });
    notify("item/started", { threadId, turnId, item: toolItem });
    return mcp("tools/call", { name: tool, arguments: { source: "clip:fixture-video" } }, toolResult => {
      trace({ method: "transcription-result", result: toolResult });
      notify("item/completed", { threadId, turnId, item: toolItem });
      const data = toolResult.isError ? null : JSON.parse(toolResult.content[0].text);
      const text = JSON.stringify({
        reply: data ? "English subtitles are ready." : toolResult.content[0].text,
        mode: data ? "edit" : "answer",
        actions: data ? [{ type: "addCaptions", transcriptionId: data.transcriptionId, translations: ["Hello"] }] : [],
      });
      notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id: itemId, text, phase: "final_answer" } });
      notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
    });
  }
  const english = request === ${JSON.stringify(englishAgentPrompt)};
  const workNotes = english || request.includes("CASE_COMMENTARY");
  // The desktop tests deliberately receive valid edit actions during advice and preview turns.
  const mode = workNotes ? "answer" : "edit";
  const noChanges = request.includes("CASE_UNCHANGED");
  const selected = context.clips?.find(clip => context.selectedIds?.includes(clip.id));
  const trim = request.includes("CASE_TRIM") && selected;
  const media = context.selectedMedia?.length > 1 ? context.selectedMedia : context.assets.map(asset => ({ assetId: asset.id }));
  const firstRange = media[0]?.range ?? { sourceIn: 1, duration: 1.5 };
  const secondRange = media[1]?.range ?? { sourceIn: 0.5, duration: 1.5 };
  const actions = mode === "answer" ? [] : noChanges
    ? [{ type: "setProject", name: context.name }]
    : trim
    ? [{ type: "trimClip", clipId: selected.id, edge: "end", time: selected.start + 1 }]
    : media.length > 1 ? [
        { type: "addAsset", assetId: media[0].assetId, start: 0, ...firstRange },
        { type: "addAsset", assetId: media[1].assetId, start: firstRange.duration, ...secondRange },
        { type: "addText", text: "粗剪片头", start: 0, duration: 1, x: null, y: null },
      ] : [{ type: "addText", text: "粗剪片头", start: 0, duration: 1, x: null, y: null }];
  const reply = workNotes ? ${JSON.stringify(englishAgentReply)} : request.includes("CASE_ANSWER") ? "可以先去掉开头空镜。" : noChanges ? "项目名称已符合要求。" : trim ? "把选中的片段剪到一秒。" : "按素材顺序编排粗剪。";
  const text = JSON.stringify({ reply, mode, actions });
  if (workNotes) {
    notify("turn/plan/updated", { threadId, turnId, plan: [{ step: "Review the current timeline", status: "inProgress" }] });
    notify("turn/plan/updated", { threadId, turnId, plan: [{ step: "Check the selected clips", status: "inProgress" }] });
    const item = { type: "agentMessage", id: "fixture-commentary", phase: "commentary", text: "" };
    notify("item/started", { threadId, turnId, item });
    notify("item/agentMessage/delta", { threadId, turnId, itemId: item.id, delta: '{"reply":"Ignored commentary delta"}' });
    notify("item/completed", { threadId, turnId: "unrelated", item: { ...item, text: "Unrelated turn activity" } });
    notify("item/completed", { threadId, turnId, item: { ...item, text: ${JSON.stringify(englishAgentCommentary)} } });
    notify("turn/plan/updated", { threadId, turnId, plan: [{ step: "Draft an edit", status: "inProgress" }] });
    notify("item/reasoning/textDelta", { threadId, turnId, itemId: "fixture-reasoning", delta: "Private fixture reasoning" });
  }
  // Exercise thread/turn correlation and streaming before the completed item.
  notify("item/agentMessage/delta", { threadId: "unrelated", turnId, itemId, delta: '{"reply":"混入无关消息' });
  notify("item/agentMessage/delta", { threadId, turnId, itemId, delta: text.slice(0, 14) });
  const complete = () => {
    notify("item/agentMessage/delta", { threadId, turnId, itemId, delta: text.slice(14) });
    notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id: itemId, text, phase: "final_answer" } });
    notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
  };
  const releaseMarker = english ? "release-english-reply" : request.includes("CASE_STALE") ? "release-stale-response" : null;
  if (releaseMarker) {
    const wait = setInterval(() => {
      const marker = file(releaseMarker);
      if (!fs.existsSync(marker)) return;
      clearInterval(wait);
      fs.rmSync(marker);
      complete();
    }, 20);
  } else {
    setTimeout(complete, 350);
  }
});
`, { mode: 0o755 });
  await chmod(executable, 0o755);
}
