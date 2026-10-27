// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import UpdateDialog from '../src/components/UpdateDialog';
import { useLanguageStore } from '../src/i18n/languageStore';
import type { UpdateCheckResult } from '../src/core/updateTypes';

const available: UpdateCheckResult = { currentVersion: '0.7.0', channel: 'preview', status: 'available', release: { version: '0.8.0', notes: '<script>window.evil = true</script>\n[bad](https://evil.invalid)', hasDownload: true } };
let host: HTMLDivElement, root: Root;
const check = vi.fn(), open = vi.fn(), close = vi.fn();
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(node => node.textContent === label)!;
const click = async (node: HTMLElement) => { await act(async () => { node.click(); }); };
async function render(autoCheck = true) { await act(async () => { root.render(React.createElement(UpdateDialog, { autoCheck, onClose: close })); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useLanguageStore.getState().setLanguage('en');
  check.mockReset().mockResolvedValue(available); open.mockReset().mockResolvedValue(true); close.mockReset();
  window.editorAPI = { checkForUpdates: check, openUpdateTarget: open } as any;
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); delete window.editorAPI; vi.restoreAllMocks(); });

describe('manual update dialog', () => {
  it('does not check without an opening gesture; escapes release notes and only passes enum targets', async () => {
    await render(false); expect(check).not.toHaveBeenCalled();
    await click(button('Check again'));
    expect(check).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('New version available: 0.8.0');
    expect(host.querySelector('pre')?.textContent).toContain('<script>');
    expect(host.querySelectorAll('script,a')).toHaveLength(0);
    await click(button('Download compatible DMG'));
    await click(button('GitHub release page'));
    expect(open.mock.calls).toEqual([['download'], ['release']]);
  });
  it('does not offer desktop actions when the bridge is missing', async () => {
    delete window.editorAPI; await render();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('unavailable in the browser preview');
    expect(button('Check again').disabled).toBe(true); expect(check).not.toHaveBeenCalled();
  });
  it.each(['offline', 'timeout', 'rate-limit', 'invalid-response', 'invalid-version', 'server'] as const)('shows a safe %s error without download links', async error => {
    check.mockResolvedValue({ currentVersion: '0.7.0', channel: 'preview', status: 'error', error });
    await render(); expect(host.querySelector('[role=alert]')?.textContent?.length).toBeGreaterThan(10);
    expect(button('Download compatible DMG')).toBeUndefined(); expect(button('GitHub release page')).toBeUndefined();
  });
  it('shows current version without a downgrade offer', async () => {
    check.mockResolvedValue({ currentVersion: '0.7.0', channel: 'preview', status: 'up-to-date' });
    await render(); expect(host.textContent).toContain('No newer version was found');
    expect(button('Download compatible DMG')).toBeUndefined();
  });
  it('explains missing architecture assets and catches browser-open failure', async () => {
    check.mockResolvedValue({ ...available, release: { ...available.release!, hasDownload: false } });
    open.mockResolvedValue(false); await render();
    expect(host.textContent).toContain('No compatible DMG'); expect(button('Download compatible DMG')).toBeUndefined();
    await click(button('GitHub release page'));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not open the verified release link');
  });
  it('prevents repeated pending checks, allows closing, and ignores resolution after unmount', async () => {
    let resolve!: (value: UpdateCheckResult) => void;
    check.mockReturnValue(new Promise<UpdateCheckResult>(done => { resolve = done; }));
    await render(); expect(button('Checking…').disabled).toBe(true);
    await click(button('Checking…')); expect(check).toHaveBeenCalledTimes(1);
    await click(button('Close')); expect(close).toHaveBeenCalledOnce();
    await act(async () => { root.render(null); });
    await act(async () => { resolve(available); });
    expect(host.childElementCount).toBe(0);
    check.mockResolvedValue(available); await render(); expect(host.textContent).toContain('New version available: 0.8.0');
  });
  it('supports Chinese, Escape, focus wrap, and returning focus on dismissal', async () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    useLanguageStore.getState().setLanguage('zh-CN'); await render();
    expect(host.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('检查更新');
    expect(host.textContent).toContain('更新频道：预览版（Preview）');
    const buttons = host.querySelectorAll('button'); expect(document.activeElement).toBe(buttons[0]);
    await act(async () => { buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    await act(async () => { buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(close).toHaveBeenCalledOnce();
    await act(async () => { root.render(null); }); expect(document.activeElement).toBe(opener); opener.remove();
  });
});
