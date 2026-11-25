import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listCodexAgentModels, readCodexAgentAccount, signInCodexAgent, signOutCodexAgent, startCodexAgentSession } from "../electron/codexAppServer";
import { validateAssistantRequest } from "../electron/assistantBackend";
import type { AssistantEvent, AssistantRequest } from "../src/core/assistantTypes";
import { LocalSpeechSetupRequired } from "../src/core/speech";
import { englishAgentCommentary, englishAgentReply, writeCodexAppServerFixture } from "./codexAppServerFixture";

const jpeg = "data:image/jpeg;base64,/9j/2Q==";
const request: AssistantRequest = {
  provider: "codex-agent", requestId: "request-1", prompt: "剪一版中文片头", history: [],
  context: JSON.stringify({ assets: [], referenceAssetIds: ["asset-a"] }),
  references: [{ assetId: "asset-a", dataUrl: jpeg }],
};

describe.skipIf(process.platform === "win32")("Codex App Server standalone subprocess", () => {
  let root: string;
  let options: { executablePath: string; sessionRoot: string; profileDirectory: string };
  const flag = (name: string) => writeFile(path.join(options.profileDirectory, name), "fixture");
  const trace = async () => (await readFile(path.join(options.profileDirectory, "fixture-requests.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "reacut-codex-tests-"));
    options = { executablePath: path.join(root, "test codex"), sessionRoot: path.join(root, "runs"), profileDirectory: path.join(root, "profile") };
    await mkdir(options.profileDirectory);
    await writeCodexAppServerFixture(options.executablePath);
  });
  afterEach(() => rm(root, { force: true, recursive: true }));

  async function run(prompt: string) {
    const events: AssistantEvent[] = [];
    const session = startCodexAgentSession({ ...request, prompt }, event => events.push(event), options);
    await session.done;
    expect(await readdir(options.sessionRoot)).toEqual([]);
    return events;
  }

  it("delegates browser sign-in and sign-out to Codex and exposes only status", async () => {
    const signal = new AbortController().signal;
    await expect(readCodexAgentAccount(options, signal)).resolves.toBe("signed-out");
    const openBrowser = async (url: string) => {
      expect(new URL(url).origin).toBe("https://auth.openai.com");
      await flag("browser-completed");
    };
    await expect(signInCodexAgent(options, openBrowser, signal)).resolves.toBe("connected");
    await expect(readCodexAgentAccount(options, signal)).resolves.toBe("connected");
    await expect(signOutCodexAgent(options, signal)).resolves.toBe("signed-out");
    expect(await readdir(options.sessionRoot)).toEqual([]);
  });

  it("reauthorizes through the browser after an expired turn despite a cached account", async () => {
    await flag("fixture-signed-in");
    await flag("expired-session");
    const signal = new AbortController().signal;
    expect((await run(request.prompt)).at(-1)).toMatchObject({ type: "error", account: "signed-out" });
    await expect(readCodexAgentAccount(options, signal)).resolves.toBe("connected");
    const browser: string[] = [];
    await expect(signInCodexAgent(options, async url => {
      browser.push(new URL(url).origin);
      await flag("browser-completed");
    }, signal)).resolves.toBe("connected");
    expect(browser).toEqual(["https://auth.openai.com"]);
    expect((await run(request.prompt)).at(-1)).toMatchObject({ type: "complete" });
  });

  it("rejects an unexpected browser origin and cancels a pending browser login", async () => {
    const controller = new AbortController();
    let opened = false;
    await flag("foreign-origin");
    await expect(signInCodexAgent(options, async () => { opened = true; }, controller.signal)).rejects.toThrow("有效的 OpenAI 登录地址");
    expect(opened).toBe(false);
    await rm(path.join(options.profileDirectory, "foreign-origin"));
    await expect(signInCodexAgent(options, async () => controller.abort(), controller.signal)).resolves.toBe("signed-out");
    expect(await readdir(options.sessionRoot)).toEqual([]);
  });

  it("streams only scoped reply text and completes one structured plan", async () => {
    await flag("fixture-signed-in");
    const events = await run(request.prompt);
    expect(events.filter(event => event.type === "text").map(event => event.text).join("")).toBe("按素材顺序编排粗剪。");
    expect(events.at(-1)).toMatchObject({ type: "complete", response: { mode: "edit", actions: [{ type: "addText", text: "粗剪片头", start: 0, duration: 1 }] } });
    const calls = await trace();
    expect(calls).toContainEqual(expect.objectContaining({ method: "spawn", apiKeyInherited: false, args: expect.arrayContaining(["app-server", "stdio://", 'web_search="disabled"', "features.shell_tool=false", "mcp_servers={}"]) }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "thread/start", params: expect.objectContaining({ ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [] }) }));
    expect(calls).toContainEqual(expect.objectContaining({ method: "turn/start", outputSchema: true, images: [{ type: "image", jpeg: true, bytes: 4 }] }));
  });

  it("forwards public commentary from the active turn separately from the answer", async () => {
    await flag("fixture-signed-in");
    const events = await run("CASE_COMMENTARY");
    expect(events.filter(event => event.type === "commentary").map(event => event.text)).toEqual([englishAgentCommentary]);
    expect(events.filter(event => event.type === "text").map(event => event.text).join("")).toBe(englishAgentReply);
    expect(events.at(-1)).toMatchObject({ type: "complete", response: { mode: "answer", actions: [] } });
    expect(JSON.stringify(events)).not.toContain("Private fixture reasoning");
  });

  it("passes a scoped local transcript to Codex and returns the referenced cues alongside the edit", async () => {
    await flag("fixture-signed-in");
    const events: AssistantEvent[] = [];
    const recognition = { mode: "asr", source: "clip:fixture-video", language: "auto" } as const;
    const cues = [{ start: 1, end: 2, text: "你好" }];
    const session = startCodexAgentSession({ ...request, references: undefined, prompt: "Add English subtitles to this video",
      context: JSON.stringify({
        assets: [{ id: "fixture-asset", hasAudio: true }],
        clips: [{ id: "fixture-video", assetId: "fixture-asset" }],
      }),
    },
      event => events.push(event), options, async args => {
        expect(args).toEqual({ source: recognition.source });
        return { request: recognition, time: 3, cues };
      });
    await session.done;
    expect(events.at(-1)).toMatchObject({
      type: "complete", response: { mode: "edit", actions: [{ type: "addCaptions", translations: ["Hello"] }] },
      transcriptions: [{ request: recognition, time: 3, cues }],
    });
    const calls = await trace();
    expect(calls).toContainEqual(expect.objectContaining({ method: "mcpServerStatus/list", params: expect.objectContaining({ serverName: "reacut" }) }));
    expect(calls.findIndex(call => call.method === "mcpServer/tool/call")).toBeLessThan(calls.findIndex(call => call.method === "turn/start"));
    expect(events.filter(event => event.type === "activity").map(event => event.message)).toEqual([
      "已选择语音来源", "正在本机识别字幕…", "已完成本机语音识别", "正在通过 Codex 翻译字幕…",
    ]);
    const returned = JSON.parse(calls.find(call => call.method === "transcription-result").result.content[0].text);
    expect(returned).toEqual({ transcriptionId: expect.any(String), source: recognition.source, cues });
  });

  it("offers caption setup after local transcription reports missing prerequisites", async () => {
    await flag("fixture-signed-in");
    const events: AssistantEvent[] = [];
    const session = startCodexAgentSession({
      ...request,
      references: undefined,
      prompt: "Add English subtitles to this video",
      context: JSON.stringify({ assets: [{ id: "fixture-asset", hasAudio: true }], clips: [] }),
    }, event => events.push(event), options, async () => {
      throw new LocalSpeechSetupRequired();
    });
    await session.done;
    expect(events).toContainEqual({ type: "speech-setup-required", requestId: request.requestId });
    expect(events.at(-1)).toMatchObject({ type: "error", message: "Configure local MLX Whisper and Python first." });
    expect(await trace()).not.toContainEqual(expect.objectContaining({ method: "turn/start" }));
  });

  it("rejects an unexpected MCP tool and cancels a running local job", async () => {
    await flag("fixture-signed-in");
    const events: AssistantEvent[] = [];
    const requestWithSpeech = (prompt: string) => startCodexAgentSession({ ...request, prompt }, event => events.push(event), options,
      async (_args, signal) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));
    await requestWithSpeech("CASE_TRANSCRIPTION_FOREIGN").done;
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("未授权") });
    const running = requestWithSpeech("CASE_TRANSCRIPTION");
    await expect.poll(() => events.some(event => event.type === "activity" && event.message.includes("本机识别"))).toBe(true);
    running.cancel();
    await running.done;
    expect(events.at(-1)).toMatchObject({ type: "cancelled" });
    expect(await readdir(options.sessionRoot)).toEqual([]);
  });

  it.each([["CASE_DELEGATE", "edit"], ["CASE_DELEGATE_PREVIEW", "preview"]])("lets Codex delegate %s and honors its edit mode", async (scenario, mode) => {
    await flag("fixture-signed-in");
    const events: AssistantEvent[] = [];
    const cues = [{ start: 1, end: 2, text: "你好" }];
    const session = startCodexAgentSession({ ...request, prompt: scenario + " caption the segment with the greeting" },
      event => events.push(event), options, async args => {
        expect(args.source).toBe("clip:fixture-video");
        return { request: { mode: "asr", source: "clip:fixture-video", language: "auto" }, time: 3, cues };
      });
    await session.done;
    expect(events.at(-1)).toMatchObject({ type: "complete", response: { mode, actions: [{ type: "addCaptions" }] }, transcriptions: [{ cues }] });
    const stages = (await trace()).map(call => call.method).filter(method => method === "turn/start" || method === "mcpServer/tool/call");
    expect(stages).toEqual(["turn/start", "mcpServer/tool/call", "turn/start"]);
  });

  it("withholds project data without a managed account or validated ephemeral thread", async () => {
    expect((await run(request.prompt)).at(-1)).toMatchObject({ type: "error", account: "signed-out" });
    await flag("fixture-signed-in");
    await flag("persistent-thread");
    expect((await run(request.prompt)).at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("请更新 Codex") });
    expect(await trace()).not.toContainEqual(expect.objectContaining({ method: "turn/start" }));
  });

  it("reads the model catalog and checks reasoning and reference compatibility before sending context", async () => {
    const signal = new AbortController().signal;
    await expect(listCodexAgentModels(options, signal)).resolves.toEqual([]);
    await flag("fixture-signed-in");
    const models = await listCodexAgentModels(options, signal);
    expect(models.map(model => model.id)).toEqual(["fixture-sol", "fixture-astra", "fixture-text"]);
    expect(models[0]).toMatchObject({ isDefault: true, defaultEffort: "medium", efforts: ["medium", "high"] });
    const events: AssistantEvent[] = [];
    const session = startCodexAgentSession({ ...request, codexSelection: { model: "fixture-text", effort: "high" } }, event => events.push(event), options);
    await session.done;
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("不支持参考帧") });
    expect(await trace()).not.toContainEqual(expect.objectContaining({ method: "turn/start" }));
  });

  it.each([["CASE_POLICY", "拒绝"], ["CASE_TOOL", "工具"], ["CASE_NO_FINAL", "完整回复"]])("stops %s without exposing raw provider details", async (prompt, error) => {
    await flag("fixture-signed-in");
    const events = await run(prompt);
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining(error) });
    expect(events.some(event => event.type === "complete")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("sample-private-provider-details");
  });

  it("cancels an active turn, releases its directory, and allows another turn", async () => {
    await flag("fixture-signed-in");
    const events: AssistantEvent[] = [];
    const session = startCodexAgentSession({ ...request, prompt: "CASE_HANG" }, event => events.push(event), { ...options, timeoutMs: 5000 });
    await expect.poll(async () => (await trace().catch(() => [])).some((call: { method: string }) => call.method === "turn/start")).toBe(true);
    session.cancel();
    await session.done;
    expect(events.at(-1)).toMatchObject({ type: "cancelled" });
    expect(await readdir(options.sessionRoot)).toEqual([]);
    expect((await run(request.prompt)).at(-1)).toMatchObject({ type: "complete" });
  });
});

it("accepts only explicitly declared, bounded JPEG attachments for the App Server", () => {
  expect(() => validateAssistantRequest(request)).not.toThrow();
  const original = request.references![0];
  for (const invalid of [
    { ...request, provider: "codex" as const },
    { ...request, references: [original, original] },
    { ...request, references: [{ ...original, assetId: "unknown" }] },
    { ...request, references: [{ ...original, dataUrl: "https://example.invalid/image.jpg" }] },
    { ...request, references: [{ ...original, dataUrl: `data:image/jpeg;base64,${"a".repeat(360_000)}` }] },
  ]) expect(() => validateAssistantRequest(invalid)).toThrow("参考帧无效");
});
