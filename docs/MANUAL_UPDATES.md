# Manual update checks (v0.7.1)

The desktop app offers **Settings → Check for Updates** and native **Help → Check for Updates…**. Opening either entry explicitly checks the **Preview** channel: published stable and prerelease GitHub releases, excluding drafts. Existing ReaCut releases are previews; GitHub's `latest` endpoint would omit them.

The dialog shows the installed version and release notes as plain text. **Download installer** opens the newest matching macOS DMG or Windows x64 EXE when its version is newer than the running app. If no compatible installer exists, you can inspect the release page in the fixed `Xiangyu-CAS/ReaCut` repository.

Save your project, download the installer in your browser and quit ReaCut. On Windows, run the EXE. On macOS, open the DMG and replace the app in Applications. Updates are installed manually.

Preview builds packaged before the repository rename use the previous update address. Update those builds by downloading the installer for your platform from [GitHub Releases](https://github.com/Xiangyu-CAS/ReaCut/releases).

## Network and privacy

Editing remains local. There are no update checks at startup, background polling, update telemetry, accounts or tokens. Only a user-requested check contacts the fixed public GitHub Releases API. As with an ordinary HTTPS request, GitHub receives the connecting IP address and ordinary request headers; no project, media, path or document content is sent. Clicking a release or download button opens your browser, whose normal GitHub privacy/session behavior applies.

The main process validates IPC callers, bounds requests and response data, rejects redirects and non-repository destinations, compares semantic versions and retains verified targets. The renderer passes only `release` or `download`, not a URL. Release notes cannot execute HTML, scripts or links. Concurrent checks share one request and recent results are reused briefly; network/rate-limit/timeout errors are displayed without disrupting editing. There is no persistent update cache or new dependency.

## Limits and verification

GitHub release metadata remains remote, untrusted input. The updater validates download URLs and inspects only the bounded release-list window. Release checksums can be used to verify the downloaded file.

Source checks: `npm run check`. Focused service and DOM-unit checks: `npx vitest run tests/update-check.test.ts tests/update-dialog.test.ts`. Synthetic browser flows: `npx tsx tests/update-browser.ts` (or set `CHROMIUM_PATH`). Browser fixtures do not contact GitHub or download/install an application. Native Electron, macOS installer and live network verification must be distinguished from these mocked checks.

## 中文

桌面端提供 **设置 → 检查更新** 和原生 **帮助 → 检查更新…**。预览通道包含正式版和预发布版，不包含草稿；仅在用户点击后访问固定仓库的公开 GitHub Releases API，不在启动时或后台检查，不上传工程/媒体，不使用令牌或遥测。GitHub 会接收普通网络连接的 IP 地址和请求头。

更新说明仅作为纯文本显示。仅为高于当前版本、匹配 macOS 与 CPU 架构的桌面 DMG 提供下载入口；不将插件 ZIP、旧版本或 Apple Silicon 安装包提供给 Intel Mac。无匹配安装包时可查看固定仓库的发布页。按钮只打开浏览器，不自动安装或覆盖应用。请先保存工程，下载后退出 ReaCut，再手动替换应用。当前预览包为临时签名、未公证；本功能不改变这一状态。

仓库改名前打包的预览版仍使用旧更新地址。请从 [GitHub 发布页](https://github.com/Xiangyu-CAS/ReaCut/releases) 下载适用于当前平台的安装包，手动更新。
