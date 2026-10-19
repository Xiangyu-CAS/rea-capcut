import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const result = await build({ entryPoints: ['plugin/ui/app.ts'], bundle: true, platform: 'browser', target: 'es2022', format: 'esm', minify: true, pure: ['console.debug'], write: false, legalComments: 'inline' });
const html = (await readFile('plugin/ui/index.html', 'utf8')).replace('/*__SCRIPT__*/', () => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
await mkdir('dist', { recursive: true });
await writeFile('dist/plugin.html', html);
// Keep discovery available without launching a GUI process.
const protocolBuild = await build({ entryPoints: ['electron/pluginProtocol.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const protocol = await import(`data:text/javascript;base64,${Buffer.from(protocolBuild.outputFiles[0].text).toString('base64')}`);
const { version } = JSON.parse(await readFile('plugin/plugin.json', 'utf8'));
await writeFile('plugin/protocol.json', JSON.stringify({ version, tools: protocol.pluginTools,
  resource: { uri: protocol.PLUGIN_URI, name: 'ReaCut', mimeType: 'text/html;profile=mcp-app', _meta: protocol.uiMeta } }, null, 2) + '\n');
console.log('Built self-contained ReaCut MCP App.');
