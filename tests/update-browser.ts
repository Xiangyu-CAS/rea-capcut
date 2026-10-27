/** Synthetic UI regression; no GitHub requests or external navigation. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const harness = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import UpdateDialog from '/src/components/UpdateDialog.tsx';
import {useLanguageStore} from '/src/i18n/languageStore.ts';
import '/src/styles.css';
window.setTestLanguage = language => useLanguageStore.getState().setLanguage(language);
function Harness() { const [open,setOpen] = useState(false); return React.createElement(React.Fragment,null,
React.createElement('button',{onClick:()=>setOpen(true)},'Open updates'),
open && React.createElement(UpdateDialog,{autoCheck:true,onClose:()=>setOpen(false)})); }
createRoot(document.getElementById('root')).render(React.createElement(Harness));`;
const server = await createServer({ configFile: false, plugins: [react(), {
  name: 'update-test-harness',
  resolveId(id) { if (id === '/update-harness.js') return '\0update-test-harness'; },
  load(id) { if (id === '\0update-test-harness') return harness; },
  configureServer(s) { s.middlewares.use((req, res, next) => {
    if (req.url === '/update-harness') { res.setHeader('Content-Type', 'text/html'); void s.transformIndexHtml('/update-harness', '<html><head></head><body><div id="root"></div><script type="module" src="/update-harness.js"></script></body></html>').then(html => res.end(html)); }
    else next();
  }); },
}], server: { host: '127.0.0.1', port: 0 } });
await server.listen();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1060, height: 760 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const w = window as any;
    w.calls = 0; w.opens = []; w.delay = false; w.openOK = true;
    w.result = { currentVersion: '0.7.0', channel: 'preview', status: 'available', release: { version: '0.8.0', notes: '<script>window.evil = true</script>\nhttps://evil.invalid\n# Plain text notes', hasDownload: true } };
    w.editorAPI = {
      checkForUpdates: async () => { w.calls++; if (w.delay) await new Promise(resolve => { w.resolveCheck = resolve; }); return w.result; },
      openUpdateTarget: async (target: string) => { w.opens.push(target); return w.openOK; },
    };
  });
  await page.goto(`${server.resolvedUrls!.local[0]}update-harness`);
  const open = () => page.getByRole('button', { name: 'Open updates', exact: true }).click();
  const close = () => page.getByRole('button', { name: 'Close update dialog', exact: true }).click();
  expect(await page.evaluate(() => (window as any).calls)).toBe(0);
  await open();
  await expect(page.getByText('New version available: 0.8.0')).toBeVisible();
  await expect(page.locator('.update-notes pre')).toContainText('<script>');
  expect(await page.evaluate(() => (window as any).evil)).toBeUndefined();
  await expect(page.getByRole('link')).toHaveCount(0);
  await page.getByRole('button', { name: 'Download compatible DMG' }).click();
  await page.getByRole('button', { name: 'GitHub release page' }).click();
  expect(await page.evaluate(() => (window as any).opens)).toEqual(['download', 'release']);
  const output = path.resolve('.test-output/update-browser'); mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'available-en.png') });
  // Close and reopen during pending request; each dialog owns its own result.
  await close();
  await page.evaluate(() => { (window as any).delay = true; });
  await open();
  await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
  const count = await page.evaluate(() => (window as any).calls);
  await page.getByRole('button', { name: 'Checking…', exact: true }).dispatchEvent('click');
  expect(await page.evaluate(() => (window as any).calls)).toBe(count);
  await close();
  await page.evaluate(() => { (window as any).resolveCheck(); (window as any).delay = false; });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { (window as any).result = { currentVersion: '0.7.0', channel: 'preview', status: 'error', error: 'offline' }; });
  await open();
  await expect(page.getByRole('alert')).toContainText('Could not reach GitHub');
  await expect(page.getByRole('button', { name: 'Download compatible DMG' })).toHaveCount(0);
  await close();
  await page.evaluate(() => { (window as any).result = { currentVersion: '0.7.0', channel: 'preview', status: 'up-to-date' }; });
  await open();
  await expect(page.getByText('No newer version was found in the Preview channel.')).toBeVisible();
  await close();
  await page.evaluate(() => { (window as any).result = { currentVersion: '0.7.0', channel: 'preview', status: 'available', release: { version: '0.8.0', notes: '', hasDownload: false } }; });
  await open();
  await expect(page.getByText(/No compatible DMG is available/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download compatible DMG' })).toHaveCount(0);
  await page.evaluate(() => { (window as any).openOK = false; });
  await page.getByRole('button', { name: 'GitHub release page' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not open the verified release link');
  await page.evaluate(() => (window as any).setTestLanguage('zh-CN'));
  await expect(page.getByRole('dialog', { name: '检查更新' })).toBeVisible();
  await expect(page.getByText('更新频道：预览版（Preview）')).toBeVisible();
  await page.setViewportSize({ width: 480, height: 720 });
  await page.screenshot({ path: path.join(output, 'no-asset-zh-narrow.png') });
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(480);
  await page.getByRole('button', { name: '关闭更新窗口' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open updates' })).toBeFocused();
  expect(errors).toEqual([]);
  console.log('Update UI: explicit-only checks, escaped notes, safe target enums, pending/repeated clicks, dismissal/reopen, offline, current, no DMG, failed browser open, Chinese and narrow layout passed.');
} finally { await browser?.close(); await server.close(); }
