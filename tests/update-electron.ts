/** Native updater integration, using isolated profiles and in-process synthetic responses.
 * Run after build on a desktop runner: npx tsx tests/update-electron.ts.
 * REACUT_TEST_APP selects an app extracted from the actual DMG.
 * REACUT_TEST_LIVE_UPDATES=1 adds one explicit UI-driven public API check.
 * No test opens an external browser, downloads an installer or installs an app. */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { version } from '../package.json';

const root = process.cwd();
const output = path.resolve('.test-output/update-electron');
const apiURL = 'https://api.github.com/repos/Xiangyu-CAS/rea-capcut/releases?per_page=100';
const repo = 'https://github.com/Xiangyu-CAS/rea-capcut';
const future = '999.0.0';
const bundle = process.env.REACUT_TEST_APP ? path.resolve(process.env.REACUT_TEST_APP) : undefined;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const results: Array<Record<string, unknown>> = [];
let sequence = 0;
async function launch(): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.REACUT_USER_DATA = path.join(output, `profile-${++sequence}`);
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({
    ...(bundle ? { executablePath: path.join(bundle, 'Contents/MacOS/ReaCut'), args: [], cwd: output } : { args: [root], cwd: root }),
    env, timeout: 45000,
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.app-shell');
    await page.evaluate(() => localStorage.setItem('reacut-ui-language-v1', JSON.stringify('en')));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1060, 760));
    return { app, page, errors };
  } catch (error) { await app.close(); throw error; }
}
function release(tag: string, arch: string, withAsset = true) {
  const name = `ReaCut-${tag}-${arch}.dmg`;
  return { tag_name: `v${tag}`, draft: false, prerelease: true, html_url: `${repo}/releases/tag/v${tag}`,
    body: '<script>window.__unsafeRelease = true</script>\n[Untrusted link](https://example.invalid/)\nPreview notes',
    assets: withAsset ? [{ name, state: 'uploaded', size: 12345, browser_download_url: `${repo}/releases/download/v${tag}/${name}` }] : [],
  };
}
async function fixture(app: ElectronApplication, data: unknown, mode = 'ok') {
  await app.evaluate(({ shell }, input) => {
    const state = globalThis as any;
    state.__updateCalls = []; state.__updateOpens = []; state.__updateResolve = undefined;
    shell.openExternal = async (url: string) => { state.__updateOpens.push(url); };
    globalThis.fetch = async (url, options) => {
      state.__updateCalls.push({ url: String(url), redirect: options?.redirect, credentials: options?.credentials, headers: options?.headers });
      if (input.mode === 'offline') throw new Error('synthetic offline');
      if (input.mode === 'pending') await new Promise(resolve => { state.__updateResolve = resolve; });
      return new Response(JSON.stringify(input.data), { status: input.mode === 'rate-limit' ? 403 : 200 });
    };
  }, { data, mode });
}
const requestCount = (app: ElectronApplication) => app.evaluate(() => (globalThis as any).__updateCalls.length);
async function settingsCheck(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Check for Updates', exact: true }).click();
}
async function nativeCheck(app: ElectronApplication, label = 'Check for Updates…') {
  await expect.poll(() => app.evaluate(({ Menu }, text) => Menu.getApplicationMenu()!.items.some(item => item.submenu?.items.some(child => child.label === text)), label)).toBe(true);
  await app.evaluate(({ Menu, BrowserWindow }, text) => {
    const help = Menu.getApplicationMenu()!.items.find(item => item.label === 'Help' || item.label === '帮助');
    const item = help?.submenu?.items.find(item => item.label === text);
    if (!item) throw new Error(`Missing native update item: ${text}`);
    (item.click as any)(item, BrowserWindow.getAllWindows()[0], {});
  }, label);
}
async function close(page: Page) { await page.getByRole('button', { name: 'Close update dialog', exact: true }).click(); }
async function checkRequests(app: ElectronApplication, expected = 1) {
  const calls = await app.evaluate(() => (globalThis as any).__updateCalls);
  expect(calls).toHaveLength(expected);
  for (const call of calls) {
    expect(call.url).toBe(apiURL); expect(call.redirect).toBe('error'); expect(call.credentials).toBe('omit');
    expect(JSON.stringify(call.headers)).not.toMatch(/authorization|token/i);
  }
}

// Real Settings and native menu paths share the verified service, cache and preload.
{
  const { app, page, errors } = await launch();
  try {
    const arch = await app.evaluate(() => process.arch);
    await fixture(app, [release(future, arch)]);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    expect(await requestCount(app)).toBe(0); // Merely opening Settings never checks.
    await page.getByRole('button', { name: 'Check for Updates', exact: true }).click();
    await expect(page.getByText(`New version available: ${future}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Current version: ${version}`, { exact: true })).toBeVisible();
    await expect(page.getByText('Update channel: Preview', { exact: true })).toBeVisible();
    await expect(page.locator('.update-notes pre')).toContainText('<script>');
    await expect(page.getByRole('dialog').locator('a, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__unsafeRelease)).toBeUndefined();
    await page.getByRole('button', { name: 'GitHub release page', exact: true }).click();
    await page.getByRole('button', { name: 'Download compatible DMG', exact: true }).click();
    expect(await app.evaluate(() => (globalThis as any).__updateOpens)).toEqual([
      `${repo}/releases/tag/v${future}`, `${repo}/releases/download/v${future}/ReaCut-${future}-${arch}.dmg`,
    ]);
    expect(await page.evaluate(async () => {
      try { await window.editorAPI!.openUpdateTarget('https://example.invalid/' as never); return false; }
      catch { return true; }
    })).toBe(true);
    // A separate renderer with the same preload is not an authorized IPC source.
    expect(await app.evaluate(async ({ BrowserWindow, app }) => {
      // Use the documented preload path, not Electron internal preference fields.
      const preload = `${app.getAppPath()}/dist-electron/preload.cjs`;
      const outsider = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const preloadErrors: string[] = [];
      outsider.webContents.on("preload-error", (_event, file, error) => preloadErrors.push(`${file}: ${error.message}`));
      try {
        await outsider.loadURL('data:text/html,<html><body>Foreign test renderer</body></html>');
        if (preloadErrors.length) throw new Error(preloadErrors.join('\n'));
        return await outsider.webContents.executeJavaScript(`(async () => {
          if (!window.editorAPI) throw new Error('Expected preload bridge');
          try { await window.editorAPI.checkForUpdates(); return false; } catch { return true; }
        })()`);
      } finally { outsider.destroy(); }
    })).toBe(true);
    await page.screenshot({ path: path.join(output, 'available-en.png') });
    await close(page);
    await nativeCheck(app);
    await expect(page.getByText(`New version available: ${future}`, { exact: true })).toBeVisible();
    await checkRequests(app); // Reopen reuses the verified recent result.
    await close(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await nativeCheck(app, '检查更新…');
    await expect(page.getByRole('dialog', { name: '检查更新', exact: true })).toBeVisible();
    await expect(page.getByText('更新频道：预览版（Preview）', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(output, 'available-zh.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await checkRequests(app);
    expect(errors).toEqual([]);
    results.push({ scenario: 'available', arch, checks: ['Settings explicit request', 'version and Preview channel', 'plain notes', 'verified enum links', 'invalid enum rejection', 'foreign renderer rejection', 'native Help', 'cache', 'Chinese', 'Escape'], passed: true });
  } finally { await app.close(); }
}

// Each process has a fresh cache and its own profile; no clock or production hooks.
for (const scenario of ['current', 'no-asset', 'offline', 'rate-limit', 'pending'] as const) {
  const { app, page, errors } = await launch();
  try {
    const arch = await app.evaluate(() => process.arch);
    const wrongArch = arch === 'arm64' ? 'x64' : 'arm64';
    await fixture(app, [release(scenario === 'current' ? version : future, scenario === 'no-asset' ? wrongArch : arch)], scenario);
    expect(await requestCount(app)).toBe(0);
    await settingsCheck(page);
    if (scenario === 'pending') {
      await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Checking…', exact: true }).dispatchEvent('click');
      expect(await requestCount(app)).toBe(1);
      await close(page);
      await nativeCheck(app);
      await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
      expect(await requestCount(app)).toBe(1);
      await app.evaluate(() => (globalThis as any).__updateResolve());
      await expect(page.getByText(`New version available: ${future}`, { exact: true })).toBeVisible();
    } else if (scenario === 'current') {
      await expect(page.getByText('No newer version was found in the Preview channel.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Download compatible DMG', exact: true })).toHaveCount(0);
    } else if (scenario === 'no-asset') {
      await expect(page.getByText(/No compatible DMG is available/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Download compatible DMG', exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText(scenario === 'offline' ? 'Could not reach GitHub' : 'GitHub has temporarily limited requests');
      await expect(page.getByRole('button', { name: 'GitHub release page', exact: true })).toHaveCount(0);
    }
    await checkRequests(app);
    await close(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as any).__updateOpens)).toEqual([]);
    expect(errors).toEqual([]);
    results.push({ scenario, passed: true });
  } finally { await app.close(); }
}

if (process.env.REACUT_TEST_LIVE_UPDATES === '1') {
  const { app, page, errors } = await launch();
  try {
    // Observe, but do not replace, the real public HTTPS request. Still no token.
    await app.evaluate(({ shell }) => {
      const state = globalThis as any, original = globalThis.fetch;
      state.__updateCalls = []; state.__updateOpens = [];
      shell.openExternal = async (url: string) => { state.__updateOpens.push(url); };
      globalThis.fetch = async (url, options) => {
        state.__updateCalls.push({ url: String(url), redirect: options?.redirect, credentials: options?.credentials, headers: options?.headers });
        return original(url, options);
      };
    });
    await settingsCheck(page); // Explicit UI click is the sole live request trigger.
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeEnabled({ timeout: 20000 });
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('status')).toContainText(/No newer version|New version available/);
    await checkRequests(app);
    expect(await app.evaluate(() => (globalThis as any).__updateOpens)).toEqual([]);
    const message = await page.getByRole('dialog').getByRole('status').innerText();
    await page.screenshot({ path: path.join(output, 'live-public-check.png') });
    expect(errors).toEqual([]);
    results.push({ scenario: 'live-public-api-explicit-click', message, passed: true });
  } finally { await app.close(); }
}
await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ version, packaged: Boolean(bundle), bundle, results }, null, 2));
console.log(`Native update integration passed (${results.length} scenarios, ${bundle ? 'actual packaged app' : 'compiled source app'}).`);
