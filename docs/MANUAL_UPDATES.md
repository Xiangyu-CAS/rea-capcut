# Manual update checks (v0.7.1)

The desktop app offers **Settings → Check for Updates** and native **Help → Check for Updates…**. Opening either entry explicitly checks the **Preview** channel: published stable and prerelease GitHub releases, excluding drafts. Existing ReaCut releases are previews; GitHub's `latest` endpoint would omit them.

The dialog shows the installed version, newer version and release notes as plain, untrusted text. A newer release can open its verified page in the fixed `Xiangyu-CAS/rea-capcut` repository. **Download DMG** is offered only for a matching macOS desktop asset and CPU architecture. A plugin ZIP, an Apple Silicon DMG on Intel, or a release older than the running app is never offered as a download. If no compatible DMG exists, the release page remains available for inspection; do not install an incompatible asset manually.

Save your project, download the appropriate DMG in your browser, quit ReaCut and replace the app yourself. Nothing is installed, overwritten or restarted automatically. Current preview packages are ad-hoc signed and not Apple-notarized. This feature does not add signing, notarization or an automatic updater; those require a separate release design.

## Network and privacy

Editing remains local. There are no update checks at startup, background polling, update telemetry, accounts or tokens. Only a user-requested check contacts the fixed public GitHub Releases API. As with an ordinary HTTPS request, GitHub receives the connecting IP address and ordinary request headers; no project, media, path or document content is sent. Clicking a release or download button opens your browser, whose normal GitHub privacy/session behavior applies.

The main process validates IPC callers, bounds requests and response data, rejects redirects and non-repository destinations, compares semantic versions and retains verified targets. The renderer passes only `release` or `download`, not a URL. Release notes cannot execute HTML, scripts or links. Concurrent checks share one request and recent results are reused briefly; network/rate-limit/timeout errors are displayed without disrupting editing. There is no persistent update cache or new dependency.

## Limits and verification

This is a manual discovery and browser-download entry, not package authenticity verification or installation validation. GitHub release metadata remains remote, untrusted input. See the implementation and tests for response bounds and supported asset-name patterns. Only the bounded release-list window is inspected; an older release outside that window is not searched. Windows/Linux packaging and existing platform failures are outside this change.

Source checks: `npm run check`. Focused service and DOM-unit checks: `npx vitest run tests/update-check.test.ts tests/update-dialog.test.ts`. Synthetic browser flows: `npx tsx tests/update-browser.ts` (or set `CHROMIUM_PATH`). Browser fixtures do not contact GitHub or download/install an application. Native Electron, macOS installer and live network verification must be distinguished from these mocked checks.

## 中文

桌面端提供 **设置 → 检查更新** 和原生 **帮助 → 检查更新…**。预览通道包含正式版和预发布版，不包含草稿；仅在用户点击后访问固定仓库的公开 GitHub Releases API，不在启动时或后台检查，不上传工程/媒体，不使用令牌或遥测。GitHub 会接收普通网络连接的 IP 地址和请求头。

更新说明仅作为纯文本显示。仅为高于当前版本、匹配 macOS 与 CPU 架构的桌面 DMG 提供下载入口；不将插件 ZIP、旧版本或 Apple Silicon 安装包提供给 Intel Mac。无匹配安装包时可查看固定仓库的发布页。按钮只打开浏览器，不自动安装或覆盖应用。请先保存工程，下载后退出 ReaCut，再手动替换应用。当前预览包为临时签名、未公证；本功能不改变这一状态。
