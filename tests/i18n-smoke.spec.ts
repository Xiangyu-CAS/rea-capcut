import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

import { zhCN } from '../src/i18n/locales/zh-CN';
import { en } from '../src/i18n/locales/en';
import { tr } from '../src/i18n/locales/tr';

test('Electron i18n smoke test', async () => {
  const mainPath = path.resolve('dist-electron', 'main.cjs');

  const userDataPath = path.resolve('test-user-data');
  if (fs.existsSync(userDataPath)) {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }

  const electronApp = await electron.launch({
    args: [mainPath, `--user-data-dir=${userDataPath}`]
  });
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Chinese
  await expect(window.locator(`button[title="${zhCN['toolbar.settings']}"]`)).toBeVisible({ timeout: 10000 });

  await window.locator(`button:has-text("${zhCN['toolbar.shortcuts']}")`).click();
  await expect(window.locator(`h2:has-text("${zhCN['shortcuts.title']}")`)).toBeVisible();
  await expect(window.locator(`span:has-text("${zhCN['shortcuts.playPause']}")`)).toBeVisible();
  await window.locator(`button[aria-label="${zhCN['dialog.close']}"]`).click();

  // English
  await window.locator(`button[title="${zhCN['toolbar.settings']}"]`).click();
  await expect(window.locator(`h2:has-text("${zhCN['settings.title']}")`)).toBeVisible();

  const languageSelect = window.locator(`select[aria-label="${zhCN['settings.language']}"]`);
  await languageSelect.waitFor({ state: 'visible' });
  await languageSelect.selectOption('en');

  await expect(window.locator(`h3:has-text("${en['settings.language']}")`)).toBeVisible();
  await window.locator(`button.primary:has-text("${en['settings.done']}")`).click();

  await window.locator(`button:has-text("${en['toolbar.shortcuts']}")`).click();
  await expect(window.locator(`h2:has-text("${en['shortcuts.title']}")`)).toBeVisible();
  await expect(window.locator(`span:has-text("${en['shortcuts.playPause']}")`)).toBeVisible();
  await window.locator(`button[aria-label="${en['dialog.close']}"]`).click();

  // Turkish
  await window.locator(`button[title="${en['toolbar.settings']}"]`).click();
  await expect(window.locator(`h2:has-text("${en['settings.title']}")`)).toBeVisible();

  const turkishSelect = window.locator(`select[aria-label="${en['settings.language']}"]`);
  await turkishSelect.waitFor({ state: 'visible' });
  await turkishSelect.selectOption('tr');

  await expect(window.locator(`h3:has-text("${tr['settings.language']}")`)).toBeVisible();
  await window.locator(`button.primary:has-text("${tr['settings.done']}")`).click();

  await window.locator(`button:has-text("${tr['toolbar.shortcuts']}")`).click();
  await expect(window.locator(`h2:has-text("${tr['shortcuts.title']}")`)).toBeVisible();
  await expect(window.locator(`span:has-text("${tr['shortcuts.playPause']}")`)).toBeVisible();
  await expect(window.locator(`span:has-text("${tr['shortcuts.split']}")`)).toBeVisible();
  await expect(window.locator(`span:has-text("${tr['shortcuts.windowsHint']}")`)).toBeVisible();
  await window.locator(`button.primary:has-text("${tr['dialog.ok']}")`).click();

  // Restart & persistence
  await electronApp.close();

  const electronApp2 = await electron.launch({
    args: [mainPath, `--user-data-dir=${userDataPath}`]
  });
  const window2 = await electronApp2.firstWindow();
  await window2.waitForLoadState('domcontentloaded');

  await expect(window2.locator(`button[title="${tr['toolbar.settings']}"]`)).toBeVisible({ timeout: 10000 });

  await electronApp2.close();
});