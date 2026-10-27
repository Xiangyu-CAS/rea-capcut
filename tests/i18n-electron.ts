/** Native-menu/dialog and persistent-language regression, run after build.
 * Uses an isolated profile and canceled dialog stubs; never writes user media. */
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('.test-output/i18n-electron');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
env.REACUT_USER_DATA = path.join(output, 'user-data');
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const launch = () => electron.launch({ args: [path.resolve('dist-electron/main.cjs')], env });
let app = await launch();
try {
  let page = await app.firstWindow();
  await page.waitForSelector('.app-shell');
  // Explicit starting preference makes the test independent of host OS locale.
  await page.evaluate(() => localStorage.setItem('reacut-ui-language-v1', JSON.stringify('en')));
  await page.reload();
  const menuLabels = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => item.label));
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
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(menuLabels).toContain('File');
  expect(await page.evaluate(() => localStorage.getItem('reacut-ui-language-v1'))).toBe('"en"');
  console.log('Native menus, canceled picker, invalid locale rejection, language switches and process-restart persistence passed.');
} finally { await app.close(); }
