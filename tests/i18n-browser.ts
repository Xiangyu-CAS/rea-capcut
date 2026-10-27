/** Source-browser localization regression. Uses only synthetic local content.
 * Run: npm run test:i18n (CHROMIUM_PATH may select a system Chromium). */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const output = path.resolve('.test-output/i18n-browser');
mkdirSync(output, { recursive: true });
try {
  await page.goto(server.resolvedUrls!.local[0]);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('textbox', { name: 'Project name' })).toHaveValue('Untitled project');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.screenshot({ path: path.join(output, 'english-editor.png') });
  // Every major library is translated on first launch; no Chinese UI remains.
  for (const label of ['Media', 'Audio', 'Text', 'Stickers', 'Effects', 'Transitions', 'Captions']) {
    await page.locator('.resource-tabs').getByRole('button', { name: label, exact: true }).click();
    const text = await page.locator('.resource-panel').innerText();
    expect(text, `${label} library`).not.toMatch(/[\u3400-\u9fff]/);
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN');
  await expect(page.getByRole('combobox', { name: '语言 / Language' })).toHaveValue('zh-CN');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置 / Settings', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '设置 / Settings', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('button', { name: '设置 / Settings', exact: true }).click();
  await page.getByRole('combobox', { name: '语言 / Language' }).selectOption('en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  // Keyboard discoverability and repeated open/close must not trap navigation.
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('English libraries, first-launch detection, Chinese switch, saved reload, Settings shortcut and dismissal passed.');
} finally {
  await browser.close();
  await server.close();
}
