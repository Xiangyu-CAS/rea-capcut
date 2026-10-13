import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const { version } = JSON.parse(await readFile('plugin/plugin.json', 'utf8'));
const stage = `release/plugin-package/reacut-plugin-${version}`;
await rm(stage, { recursive: true, force: true });
await mkdir(`${stage}/scripts`, { recursive: true });
await mkdir(`${stage}/.agents/plugins`, { recursive: true });
for (const name of ['plugin.json','mcp.json','.mcp.json','.codex-plugin','skills','assets','scripts','LICENSE'])
  await cp(`plugin/${name}`, `${stage}/plugin/${name}`, { recursive: true, filter: source => !source.includes('__pycache__') && !source.endsWith('.pyc') });
await cp('scripts/install-plugin.sh', `${stage}/scripts/install-plugin.sh`);
await cp('.agents/plugins/marketplace.json', `${stage}/.agents/plugins/marketplace.json`);
await cp('docs/CODEX_PLUGIN.md', `${stage}/README.md`);
await mkdir(`${stage}/screenshots`, { recursive: true });
await cp('docs/screenshots/codex-plugin-local-host.jpg', `${stage}/screenshots/codex-plugin-local-host.jpg`);
const zip = `release/ReaCut-plugin-${version}.zip`;
await rm(zip, { force: true });
const result = spawnSync('/usr/bin/ditto', ['-c','-k','--sequesterRsrc','--keepParent',stage,zip], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Plugin ZIP failed');
console.log(zip);
