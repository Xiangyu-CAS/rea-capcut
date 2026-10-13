import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assistantCommand, assistantReplyPrefix, discoverAssistantProviders, parseAssistantResponse, resolveAssistantExecutable, startAssistantSession, validateAssistantRequest } from "../electron/assistantBackend";
import type { AssistantEvent, AssistantProvider, AssistantRequest } from "../src/core/assistantTypes";

let folder: string, fixture: string;
beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), "reacut-assistant-tests-"));
  fixture = path.join(folder, "cli fixture");
  await writeFile(fixture, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if(args.includes('--version')) { console.log('fixture 1.0'); process.exit(0); }
if(args.includes('--help')) { console.log('--ignore-user-config --ephemeral --output-schema --sandbox --tools --strict-mcp-config --setting-sources --no-session-persistence --json-schema'); process.exit(0); }
let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',()=>{
  fs.writeFileSync(${JSON.stringify(path.join(folder, "last-invocation.json"))},JSON.stringify({args,cwd:process.cwd(),prompt}));
  const event = value=>process.stdout.write(JSON.stringify(value)+'\\n');
  if(prompt.includes('CASE_HANG')) { setInterval(()=>{},1000);return; }
  if(prompt.includes('CASE_LOGIN')) { process.stderr.write('401 auth token secret-not-for-ui');process.exit(1); }
  if(prompt.includes('CASE_FLOOD')) { process.stdout.write('x'.repeat(2200000));return; }
  if(prompt.includes('CASE_BADJSON')) { console.log('broken protocol');return; }
  if(prompt.includes('CASE_NULL')) { console.log('null');return; }
  if(prompt.includes('CASE_TOOL')) { event({type:'item.started',item:{type:'command_execution',command:'do not execute'}});setInterval(()=>{},1000);return; }
  if(prompt.includes('CASE_NOFINISH')) { event({type:'thread.started'});return; }
  if(prompt.includes('CASE_POLICY')) { event({type:'error',message:'cyber_policy'});return; }
  const response = {reply:'建议添加中文标题，等待确认。',actions:[{type:'addText',text:'你好映刻',start:0,duration:2,fontSize:null,color:null,x:null,y:null}]};
  if(args[0]==='exec') {
    const bytes=Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(response)}})+'\\n');
    const index=bytes.indexOf(Buffer.from('中文'))+1;
    process.stdout.write(bytes.subarray(0,index));setTimeout(()=>{process.stdout.write(bytes.subarray(index));event({type:'turn.completed'});},5);
  } else {
    event({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'正在准备标题提案'}}});
    event({type:'result',subtype:'success',is_error:false,structured_output:response});
  }
});
`);
  await chmod(fixture, 0o755);
});
afterAll(() => rm(folder, { recursive: true, force: true }));
const request = (provider: AssistantProvider = "codex", prompt = "加标题 $(touch nope); `echo no`中文"): AssistantRequest => ({
  requestId: "request-1", provider, prompt, history: [{ role: "user", content: "先建议标题" }],
  context: JSON.stringify({ projectId: "project-1", name: "合成项目", clips: [{ id: "clip-1", sourceIn: 2 }], assets: [], selectedIds: [] }),
});
async function run(provider: AssistantProvider, prompt: string, timeoutMs = 5000) {
  const events: AssistantEvent[] = [];
  const session = await startAssistantSession(request(provider, prompt), event => events.push(event), { executablePath: fixture, sessionRoot: folder, timeoutMs });
  await session.done;
  return events;
}

describe("assistant CLI isolation and protocol", () => {
  it("discovers explicitly selected executables, including spaces", async () => {
    const providers = await discoverAssistantProviders({ codex: fixture, claude: fixture });
    expect(providers.map(p => p.available)).toEqual([true, true]);
    expect(providers[0].version).toBe("fixture 1.0");
    await expect(resolveAssistantExecutable("codex", folder)).rejects.toThrow("不是可执行文件");
    await expect(resolveAssistantExecutable("codex", "codex")).rejects.toThrow("不是可执行文件");
  });
  it.each(["codex", "claude"] as const)("streams %s, uses stdin, and removes its private working folder", async provider => {
    const input = request(provider);
    const events = await run(provider, input.prompt);
    const complete = events.find(e => e.type === "complete");
    expect(complete).toMatchObject({ requestId: input.requestId, type: "complete", response: { reply: "建议添加中文标题，等待确认。", actions: [{ type: "addText", text: "你好映刻", start: 0, duration: 2 }] } });
    expect(events.some(e => e.type === "text")).toBe(true);
    const invocation = JSON.parse(await readFile(path.join(folder, "last-invocation.json"), "utf8"));
    expect(invocation.prompt).toContain(input.prompt);
    expect(invocation.args).not.toContain(input.prompt);
    expect(invocation.cwd).not.toBe(process.cwd());
    expect(path.dirname(invocation.cwd)).toBe(await realpath(folder));
    expect((await readdir(folder)).filter(name => name.startsWith("reacut-assistant-"))).toEqual([]);
  });
  it("uses provider tool restrictions without permission bypass", () => {
    const codex = assistantCommand("codex", "/tmp/session");
    expect(codex).toEqual(expect.arrayContaining(["--ignore-user-config", "read-only", "approval_policy=\"never\"", "features.shell_tool=false", "features.apps=false", "mcp_servers={}"]));
    const claude = assistantCommand("claude", "/tmp/session");
    expect(claude[claude.indexOf("--tools") + 1]).toBe("");
    expect(claude[claude.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
    expect([...codex, ...claude].some(value => /dangerously|bypassPermissions|full-auto/.test(value))).toBe(false);
  });
  it.each([
    ["CASE_LOGIN", "登录"], ["CASE_BADJSON", "无效"], ["CASE_NULL", "无效"], ["CASE_NOFINISH", "完整回复"],
    ["CASE_FLOOD", "超出限制"], ["CASE_TOOL", "工具"], ["CASE_POLICY", "拒绝"],
  ])("fails closed for %s", async (testCase, expected) => {
    const events = await run("codex", testCase);
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining(expected) });
    expect(events.some(event => event.type === "complete")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("secret-not-for-ui");
  });
  it("times out and cleans up", async () => {
    const events = await run("codex", "CASE_HANG", 100);
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("超时") });
  });
  it("cancels a running child and does not return a proposal", async () => {
    const events: AssistantEvent[] = [];
    const session = await startAssistantSession(request("claude", "CASE_HANG"), event => events.push(event), { executablePath: fixture, sessionRoot: folder });
    session.cancel(); await session.done;
    expect(events.at(-1)).toMatchObject({ type: "cancelled" });
    expect(events.some(event => event.type === "complete")).toBe(false);
  });
});

describe("assistant input and response boundaries", () => {
  it("allows source timing, and rejects private paths or media fields", () => {
    expect(() => validateAssistantRequest(request())).not.toThrow();
    for (const context of [{ path: "/fake" }, { clips: [{ name: "/Users/private/video.mp4" }] }, { url: "reacut-media://secret" }, []])
      expect(() => validateAssistantRequest({ ...request(), context: JSON.stringify(context) })).toThrow();
  });
  it("bounds requests and roles", () => {
    expect(() => validateAssistantRequest({ ...request(), prompt: "x".repeat(8001) })).toThrow("过长");
    expect(() => validateAssistantRequest({ ...request(), history: Array(21).fill({ role: "user", content: "hi" }) })).toThrow("历史");
    expect(() => validateAssistantRequest({ ...request(), requestId: "bad\nrequest" })).toThrow();
    expect(() => validateAssistantRequest({ ...request(), context: "null" })).toThrow();
  });
  it("accepts fenced JSON and removes optional nulls only", () => {
    expect(parseAssistantResponse('```json\n{"reply":"建议","actions":[{"type":"setVolume","clipId":null,"volume":1,"muted":null}]}\n```')).toEqual({ reply: "建议", actions: [{ type: "setVolume", clipId: null, volume: 1 }] });
  });
  it("streams only the reply string and buffers incomplete escapes", () => {
    expect(assistantReplyPrefix('{"reply":"建议添加')).toBe("建议添加");
    expect(assistantReplyPrefix('{"reply":"a\\n\\u4f')).toBe("a\n");
    expect(assistantReplyPrefix('{"reply":"a\\n\\u4f60","actions":[{"type":"deleteClip"}]}')).toBe("a\n你");
    expect(assistantReplyPrefix('{"reply":"\\ud83c')).toBe("");
    expect(assistantReplyPrefix('{"reply":"\\ud83c\\udf1f"}')).toBe("🌟");
    expect(assistantReplyPrefix('{"actions":[]}')).toBe("");
  });
  it("rejects incomplete, non-object, extra-field, oversized or excessive responses", () => {
    for (const input of ["hello", "[]", '{"reply":"好"}', { reply: "好", actions: [], code: "x" }, { reply: "好", actions: Array(41).fill({ type: "deleteClip", clipId: "x" }) }])
      expect(() => parseAssistantResponse(input)).toThrow();
  });
});
