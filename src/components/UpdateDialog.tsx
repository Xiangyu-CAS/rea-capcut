import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { version as appVersion } from '../../package.json';
import type { UpdateCheckResult } from '../core/updateTypes';
import { useUITranslation } from '../i18n';
import './UpdateDialog.css';

/** Opened only by an explicit Settings / native menu action. Release notes are text, never HTML. */
export default function UpdateDialog({ onClose, autoCheck = false }: { onClose(): void; autoCheck?: boolean }) {
  const ui = useUITranslation();
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const running = useRef(false), openingRef = useRef(false), alive = useRef(true);
  const dialog = useRef<HTMLElement>(null);
  const available = typeof window.editorAPI?.checkForUpdates === 'function';
  const check = async () => {
    if (!available || running.current) return;
    running.current = true; setBusy(true); setOpenFailed(false);
    try {
      const next = await window.editorAPI!.checkForUpdates();
      if (alive.current) setResult(next);
    } catch {
      if (alive.current) setResult({ currentVersion: appVersion, channel: 'preview', status: 'error', error: 'server' });
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    if (autoCheck) void check();
    return () => { alive.current = false; if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
    // autoCheck is an opening gesture, not a polling dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const open = async (target: 'release' | 'download') => {
    if (openingRef.current || busy) return;
    openingRef.current = true; setOpening(true); setOpenFailed(false);
    try {
      const opened = await window.editorAPI?.openUpdateTarget(target);
      if (alive.current) setOpenFailed(!opened);
    } catch { if (alive.current) setOpenFailed(true); }
    finally { openingRef.current = false; if (alive.current) setOpening(false); }
  };
  const errors: Record<string, string> = {
    offline: ui('无法连接 GitHub。请检查网络后重试。', 'Could not reach GitHub. Check your connection and try again.'),
    timeout: ui('检查更新超时。请稍后重试。', 'The update check timed out. Try again later.'),
    'rate-limit': ui('GitHub 暂时限制了请求。请稍后再试。', 'GitHub has temporarily limited requests. Please try again later.'),
    'invalid-response': ui('GitHub 返回的更新信息无法验证。未打开任何下载。', 'The release information could not be verified. No download was opened.'),
    'invalid-version': ui('无法识别当前版本，已停止更新检查。', 'The current version is not recognized. The update check was stopped.'),
    server: ui('无法完成更新检查。请稍后重试。', 'Could not complete the update check. Please try again later.'),
  };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="modal update-dialog" role="dialog" aria-modal="true" aria-label={ui('检查更新', 'Check for Updates')} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><h2>{ui('检查更新', 'Check for Updates')}</h2><button aria-label={ui('关闭更新窗口', 'Close update dialog')} onClick={onClose}><X size={18}/></button></header>
      <div className="modal-body">
        <p><strong>{ui('当前版本：', 'Current version: ')}{result?.currentVersion ?? appVersion}</strong></p>
        <p>{ui('更新频道：预览版（Preview）', 'Update channel: Preview')}</p>
        <p className="muted small">{ui('包含 GitHub 上的预发布版本；仅提供比当前版本更新的版本，不降级。', 'Includes prereleases on GitHub. Only newer versions are offered; never a downgrade.')}</p>
        <div role="status" aria-live="polite">
          {busy ? <p>{ui('正在检查 GitHub…', 'Checking GitHub…')}</p> : result?.status === 'available' ? <p className="update-success">{ui('有新版本：', 'New version available: ')}{result.release?.version}</p> : result?.status === 'up-to-date' ? <p>{ui('当前预览频道没有比此版本更新的版本。', 'No newer version was found in the Preview channel.')}</p> : null}
        </div>
        {!available && <p role="alert" className="inline-warning">{ui('请在 ReaCut 桌面应用中检查更新。浏览器预览不支持此功能。', 'Check for updates in the ReaCut desktop app. This feature is unavailable in the browser preview.')}</p>}
        {!busy && result?.status === 'error' && <p role="alert" className="inline-warning">{errors[result.error ?? 'server'] ?? errors.server}</p>}
        {!busy && result?.status === 'available' && !result.release?.hasDownload && <p className="inline-warning">{ui('此版本没有适用于本机系统和架构的 DMG。可查看发布页；请勿安装不匹配的安装包。', 'No compatible DMG is available for this system and architecture. You can view the release page; do not install an incompatible package.')}</p>}
        {!busy && result?.release && <div className="update-notes"><h3>{ui('发布说明（原文）', 'Release notes (original text)')}</h3><pre>{result.release.notes || ui('此版本未提供发布说明。', 'No release notes were provided.')}</pre></div>}
        {openFailed && <p role="alert" className="inline-warning">{ui('无法打开已验证的发布链接。请重新检查更新后再试。', 'Could not open the verified release link. Check for updates and try again.')}</p>}
        <p className="muted small">{ui('仅在你点击检查更新时请求 GitHub；GitHub 会收到普通网络请求（包括 IP 地址）。不会上传项目、媒体或令牌，也没有后台轮询或遥测。短时间内重复检查会复用 30 秒内的结果。', 'GitHub is contacted only when you request a check and receives an ordinary network request, including your IP address. No projects, media or tokens are uploaded; there is no background polling or telemetry. Repeated checks reuse results for 30 seconds.')}</p>
        <p className="muted small">{ui('链接将在浏览器中打开。此预览版为临时签名，未经 Apple 公证。下载后先保存项目并退出 ReaCut，再手动替换应用；不会自动安装。', 'Links open in your browser. This preview is ad-hoc signed and not Apple-notarized. After downloading, save your project and quit ReaCut before manually replacing the app. Nothing is installed automatically.')}</p>
      </div>
      <footer>
        <button onClick={onClose}>{ui('关闭', 'Close')}</button>
        <button disabled={!available || busy || opening} onClick={() => void check()}>{busy ? ui('检查中…', 'Checking…') : ui('重新检查', 'Check again')}</button>
        {!busy && result?.release && result.status !== 'error' && <button disabled={opening} onClick={() => void open('release')}>{ui('GitHub 发布页', 'GitHub release page')}</button>}
        {!busy && result?.status === 'available' && result.release?.hasDownload && <button className="primary" disabled={opening} onClick={() => void open('download')}>{ui('下载匹配的 DMG', 'Download compatible DMG')}</button>}
      </footer>
    </section>
  </div>;
}
