/** Native-menu/dialog and persistent-language regression, run after build.
 * Uses an isolated profile and canceled dialog stubs; never writes user media. */
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { version } from '../package.json';
const output = path.resolve('.test-output/i18n-electron');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
env.REACUT_USER_DATA = path.join(output, 'user-data');
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const bundle = process.env.REACUT_TEST_APP ? path.resolve(process.env.REACUT_TEST_APP) : undefined;
const mac = process.platform === 'darwin';
const launch = (languages = '(fr-FR, zh-Hans-CN)') => {
  // Runtime preferences for this process only. The host settings stay untouched.
  const localeArgs = mac ? ['-AppleLanguages', languages] : [];
  return electron.launch({
    ...(bundle ? { executablePath: path.join(bundle, 'Contents/MacOS/ReaCut'), args: localeArgs, cwd: output }
      : { args: [path.resolve('dist-electron/main.cjs'), ...localeArgs] }),
    env,
  });
};
let app = await launch();
try {
  let page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await page.waitForSelector('.app-shell');
  const systemLanguage = await page.locator('html').getAttribute('lang');
  if (mac) expect(systemLanguage).toBe('zh-CN');
  const menuLabels = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => item.label));
  await expect.poll(menuLabels).toContain(systemLanguage === 'zh-CN' ? '文件' : 'File');
  const settingsLanguage = async () => {
    await page.locator('.titlebar-actions button:has(svg.lucide-settings2)').click();
    return page.getByRole('dialog').getByRole('combobox');
  };
  await expect(await settingsLanguage()).toHaveValue('system');
  // Explicit starting preference makes the test independent of host OS locale.
  await page.evaluate(() => localStorage.setItem('reacut-ui-language-v1', JSON.stringify('en')));
  await page.reload();
  await expect.poll(menuLabels).toContain('File');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN');
  await expect.poll(menuLabels).toContain('文件');
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption('en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(menuLabels).toContain('File');
  // Native picker options are localized without giving the renderer arbitrary
  // labels or additional permissions. The test always cancels the picker.
  await app.evaluate(({ dialog }) => {
    (dialog as any).showOpenDialog = async (...args: any[]) => {
      (globalThis as any).__i18nDialogTitle = args.at(-1).title;
      return { canceled: true, filePaths: [] };
    };
  });
  await page.evaluate(() => window.editorAPI!.importMedia());
  expect(await app.evaluate(() => (globalThis as any).__i18nDialogTitle)).toBe('Import media');
  expect(await page.evaluate(async () => {
    try { await window.editorAPI!.setUILanguage!('invalid' as never); return false; }
    catch { return true; }
  })).toBe(true);
  await expect.poll(menuLabels).toContain('File');
  await page.screenshot({ path: path.join(output, 'english-desktop.png') });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(menuLabels).toContain('File');
  expect(await page.evaluate(() => localStorage.getItem('reacut-ui-language-v1'))).toBe('"en"');
  const language = await settingsLanguage();
  await expect(language).toHaveValue('en');
  await language.selectOption({ label: 'Follow System' });
  await expect(language).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('lang', systemLanguage!);
  await expect.poll(menuLabels).toContain(systemLanguage === 'zh-CN' ? '文件' : 'File');
  await app.close();
  app = await launch('(de-DE, fr-FR)');
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await expect(await settingsLanguage()).toHaveValue('system');
  if (mac) {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect.poll(menuLabels).toContain('File');
  }
  const native = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() }));
  expect(native.packaged).toBe(Boolean(bundle));
  // Script launches may report Electron's version; only packaged metadata is authoritative.
  if (bundle) expect(native.version).toBe(version);
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({
    sourceBuild: !bundle, native, checks: ['English/Chinese native menu switching', 'canceled native import picker language',
      'invalid locale rejection', 'English preference after process restart', 'default system selection',
      'return to system language and restart with a different language list'],
  }, null, 2));
  console.log('Native menus, canceled picker, manual and system choices, fallback language and process-restart persistence passed.');
} finally { await app.close(); }
