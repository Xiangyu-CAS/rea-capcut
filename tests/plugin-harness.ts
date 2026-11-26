/** Local MCP Apps host for development and regression tests. Never shipped. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function startPluginHarness(assets?: string[]) {
  const output = path.resolve('.test-output/plugin-harness');
  await mkdir(output, { recursive: true });
  const userData = await mkdtemp(path.join(output, 'session-'));
  const electron = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron';
  const packagedApp = process.env.REACUT_TEST_APP;
  const launcher = process.env.REACUT_TEST_LAUNCHER;
  const executable = launcher ? 'python3' : packagedApp ?? path.resolve('node_modules/electron/dist', electron);
  const args = launcher ? [launcher] : packagedApp ? ['--reacut-plugin'] : [process.cwd(), '--reacut-plugin'];
  const child = spawn(executable, args, {
    env: { ...process.env, REACUT_USER_DATA: userData, ...(launcher && packagedApp ? { REACUT_APP: packagedApp } : {}) },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const closed = once(child, 'close');
  let seq = 0;
  const pending = new Map<number, { finish: (result: unknown) => void; fail: (error: Error) => void }>();
  createInterface({ input: child.stdout }).on('line', line => {
    const response = JSON.parse(line);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.fail(new Error(response.error.message));
    else request.finish(response.result);
  });
  void closed.then(() => {
    for (const request of pending.values()) request.fail(new Error('Test editor exited.'));
    pending.clear();
  });

  function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((finish, fail) => {
      const id = ++seq;
      pending.set(id, { finish, fail });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  const calls = new Set<string>();
  const tool = (name: string, args: Record<string, unknown> = {}) => {
    calls.add(name);
    return rpc('tools/call', { name, arguments: args });
  };
  const checkedTool = async (name: string, args?: Record<string, unknown>) => {
    const result = await tool(name, args);
    if (result.isError) throw new Error(result.content[0].text);
    return result.structuredContent;
  };

  let origin: string;
  const token = randomBytes(16).toString('hex');
  const base = `/${token}/`;
  let ui: string;
  let js: string;
  const server = createServer(async (request, response) => {
    if (request.headers.host !== new URL(origin).host || request.headers.origin && request.headers.origin !== origin || !request.url?.startsWith(base)) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'POST' && request.url === base + 'rpc') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024 * 1024) { response.writeHead(413).end(); return; }
      }
      try {
        const params = JSON.parse(body);
        if (!['reacut_panel_state', 'reacut_panel_sync', 'reacut_panel_command', 'reacut_panel_media'].includes(params.name))
          throw new Error('App-only test bridge');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(await tool(params.name, params.arguments)));
      } catch { response.writeHead(400).end(); }
      return;
    }
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    response.setHeader('Content-Type', request.url === base + 'host.js' ? 'text/javascript' : 'text/html');
    if (request.url === base + 'widget') {
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none';");
      response.end(ui);
    } else if (request.url === base + 'host.js') response.end(js);
    else if (request.url === base) response.end('<!doctype html><meta charset="utf-8"><title>ReaCut MCP App local test host</title><style>body{margin:0}iframe{display:block;border:0;width:100%;height:100vh}</style><iframe title="ReaCut MCP App" sandbox="allow-scripts allow-same-origin" allow="clipboard-read; clipboard-write"></iframe><script type="module" src="host.js"></script>');
    else response.writeHead(404).end();
  });

  async function close() {
    server.close();
    child.stdin.end();
    const kill = setTimeout(() => child.kill(), 8000);
    try { await closed; } finally { clearTimeout(kill); }
  }

  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'validation', version: '1' } });
    let state = await checkedTool('reacut_open');
    for (let attempt = 0; !state.projectReady && attempt < 80; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      state = await checkedTool('reacut_state');
    }
    if (!state.projectReady) throw new Error('Test editor did not start.');
    state = await checkedTool('reacut_import', assets ? { paths: assets } : { builtinId: 'bg-ocean' });
    await checkedTool('reacut_edit', { revision: state.revision, actions: [
      { type: 'setProject', name: '蓝调时刻', width: 640, height: 360 },
      { type: 'addAsset', assetId: state.assets[0].id, start: 0, duration: 5 },
      { type: 'addText', text: '蓝调时刻', start: 0, duration: 5, fontSize: 48 },
    ] });
    ui = (await rpc('resources/read', { uri: 'ui://reacut/editor-v1.html' })).contents[0].text;
    js = (await build({ entryPoints: ['tests/plugin-harness-client.ts'], bundle: true, platform: 'browser', format: 'esm', write: false })).outputFiles[0].text;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test host did not start.');
    origin = `http://127.0.0.1:${address.port}`;
    return { url: origin + base, tool: checkedTool, call: tool, calls, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const harness = await startPluginHarness();
  await writeFile('.test-output/plugin-harness/url.txt', harness.url);
  console.log(harness.url);
  process.on('SIGTERM', () => void harness.close());
  process.on('SIGINT', () => void harness.close());
}
