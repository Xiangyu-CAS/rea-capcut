/** Isolated macOS Dock lifecycle test with stdin held open like a real MCP host. */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'darwin') throw new Error('This check requires macOS');
const root = process.cwd();
const output = await mkdtemp(path.join(os.tmpdir(), 'reacut-dock-test-'));
const entry = path.join(output, 'check.cjs');
await writeFile(entry, `
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
process.argv.push('--reacut-plugin');
require(${JSON.stringify(path.join(root, 'dist-electron/main.cjs'))});
const delay = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    for (let i = 0; !BrowserWindow.getAllWindows().length && i < 200; i++) await delay(50);
    const win = BrowserWindow.getAllWindows()[0];
    assert(win);
    const check = async (visible) => {
      for (let i = 0; app.dock.isVisible() !== visible && i < 100; i++) await delay(50);
      assert.equal(app.dock.isVisible(), visible);
      assert.equal(win.isVisible(), visible);
    };
    await check(false);
    if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
    let unexpectedShows = 0;
    const countShow = () => unexpectedShows++;
    win.on('show', countShow);
    for (let i = 0; i < 20; i++) {
      await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await check(false);
      await delay(150);
    }
    win.removeListener('show', countShow);
    assert.equal(unexpectedShows, 0, 'Frame polling must never show the desktop window');
    win.show(); await check(true);
    win.close(); await check(false);
    assert.equal(win.isDestroyed(), false);
    fs.writeFileSync(${JSON.stringify(path.join(output, 'evidence.json'))}, JSON.stringify({
      checks: ['Background plugin absent from Dock', '20 consecutive live frames preserve hidden Dock and window', 'Desktop window present in Dock', 'Close hides Dock and preserves editor']
    }, null, 2));
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
`);
const env = { ...process.env, REACUT_USER_DATA: path.join(output, 'user-data'), VITE_DEV_SERVER_URL: '' } as NodeJS.ProcessEnv;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [entry], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let errors = '';
child.stdout.resume();
child.stderr.on('data', data => { errors += data; });
const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
clearTimeout(timeout);
assert.equal(code, 0, errors);
console.log('Dock lifecycle passed:', path.join(output, 'evidence.json'));
