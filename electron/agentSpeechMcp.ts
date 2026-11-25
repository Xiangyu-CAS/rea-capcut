import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { createInterface } from "node:readline";
import path from "node:path";
import { transcriptionTool } from "./pluginProtocol";

export const speechMcpName = "reacut";
export const speechSocketVariable = "REACUT_AGENT_ASR_SOCKET";
const relay = `
const socket = require("node:net").createConnection(process.env.${speechSocketVariable});
socket.on("error", () => process.exit(1));
process.stdin.pipe(socket);
socket.pipe(process.stdout);
`;

export const speechMcpConfig = () => `mcp_servers={${speechMcpName}={command=${JSON.stringify(process.execPath)},args=["-e",${JSON.stringify(relay)}],env={ELECTRON_RUN_AS_NODE="1"},env_vars=["${speechSocketVariable}"],required=true,startup_timeout_sec=15,tool_timeout_sec=180}}`;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** The per-turn directory is private. The relay forwards MCP stdio to a local socket only. */
export async function startSpeechMcp(transcribe: (args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>) {
  const directory = process.platform === "win32" ? undefined : await mkdtemp("/tmp/reacut-asr-");
  const address = directory ? path.join(directory, "mcp.sock") : `\\\\.\\pipe\\reacut-asr-${randomUUID()}`;
  const controller = new AbortController();
  const sockets = new Set<Socket>();
  let active = false;
  let job: Promise<ToolResult> | undefined;
  const failure = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
    createInterface({ input: socket, crlfDelay: Infinity }).on("line", async line => {
      if (Buffer.byteLength(line) > 16_384) { socket.destroy(); return; }
      let input;
      try { input = JSON.parse(line); } catch { socket.destroy(); return; }
      if (input?.jsonrpc !== "2.0" || (typeof input.id !== "string" && typeof input.id !== "number")) return;
      const send = (data: Record<string, unknown>) => {
        if (!socket.destroyed) socket.write(JSON.stringify({ jsonrpc: "2.0", id: input.id, ...data }) + "\n");
      };
      try {
        let result: unknown;
        switch (input.method) {
          case "initialize": {
            const version = input.params?.protocolVersion;
            result = {
              protocolVersion: ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"].includes(version) ? version : "2025-11-25",
              capabilities: { tools: {} }, serverInfo: { name: speechMcpName, version: "1.0.0" },
            };
            break;
          }
          case "ping": result = {}; break;
          case "tools/list":
            result = { tools: [{ ...transcriptionTool, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] };
            break;
          case "resources/list": result = { resources: [] }; break;
          case "resources/templates/list": result = { resourceTemplates: [] }; break;
          case "tools/call": {
            const args = input.params?.arguments;
            if (!active || input.params?.name !== transcriptionTool.name || !args || typeof args !== "object" ||
                Array.isArray(args) || Object.keys(args).some(key => key !== "source" && key !== "language")) {
              result = failure("Select a speech source from the active ReaCut project.");
              break;
            }
            if (job) { result = failure("A speech task is already running."); break; }
            job = transcribe(args, controller.signal).finally(() => { job = undefined; });
            result = await job;
            break;
          }
          default: send({ error: { code: -32601, message: "Method not found" } }); return;
        }
        send({ result });
      } catch { send({ result: failure("Local transcription was interrupted.") }); }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(address, resolve);
    });
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    address,
    activate() { active = true; },
    async close() {
      active = false;
      controller.abort();
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([job, new Promise<void>(resolve => server.close(() => resolve()))]);
      if (directory) await rm(directory, { recursive: true, force: true });
    },
  };
}
