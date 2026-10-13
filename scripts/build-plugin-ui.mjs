import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const result = await build({ entryPoints: ['plugin/ui/app.ts'], bundle: true, platform: 'browser', target: 'es2022', format: 'esm', minify: true, pure: ['console.debug'], write: false, legalComments: 'inline' });
const html = (await readFile('plugin/ui/index.html', 'utf8')).replace('/*__SCRIPT__*/', () => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
await mkdir('dist', { recursive: true });
await writeFile('dist/plugin.html', html);
console.log('Built self-contained ReaCut MCP App.');
