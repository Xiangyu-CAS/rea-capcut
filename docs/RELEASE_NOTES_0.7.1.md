ReaCut v0.7.1 preview adds an explicit, manual update entry while keeping editing local.

## What changed

- **Settings → Check for Updates** and native **Help → Check for Updates…**, in English and Chinese.
- Preview channel checks published stable/prerelease versions, shows current/new version and plain-text release notes, and never offers a downgrade.
- Open the fixed repository's release page or a matching desktop DMG in your browser. Platform/CPU checks prevent using a plugin ZIP or Apple Silicon DMG as an Intel update.
- Loading, offline, timeout, rate-limit, no-compatible-asset and repeated-click handling. No startup checks, silent installation, automatic replacement or restart.

Checks contact the public GitHub API only when requested. GitHub receives ordinary connecting IP/request headers; ReaCut sends no project, media, token or telemetry. Opening links follows your browser's ordinary session/privacy behavior. Save your project and quit ReaCut before manually replacing the application.

## Downloads

- **ReaCut-0.7.1-arm64.dmg** — desktop application for macOS Apple Silicon (M-series).
- **ReaCut-0.7.1-arm64-mac.zip** — desktop ZIP.
- **ReaCut-plugin-0.7.1.zip** — optional Codex plugin; requires the desktop app. Extract and run `sh scripts/install-plugin.sh`.
- **ReaCut-0.7.1-media-tool-sources.tar.gz**, **LICENSE.txt**, **THIRD_PARTY_NOTICES.md** — corresponding media-tool sources, build recipe and attribution.
- **SHA256SUMS.txt** — place downloaded assets together and run `shasum -a 256 -c SHA256SUMS.txt`.

**Preview: ad-hoc signed, not Apple-notarized.** No Intel, Windows or Linux binary is provided. No security settings are disabled; existing v0.7.0 assets are retained. Installing this version is manual: v0.7.0 does not yet have the in-app update entry.

## Verification and limitations

Publication gates include the pinned-toolchain typecheck/unit/build suite, desktop regressions, real browser update flows, plugin checks, native packaging/signature/DMG integrity and tests against the app extracted from the actual DMG. Packaged tests cover bundled tools under empty PATH, preview/export, language/native menus/restart and manual-update UI using synthetic fixtures plus an explicit public API check. After publication, the public DMG is downloaded and SHA-256 verified; consult the actual workflow result before treating that final check as passed.

[Release workflow and evidence](https://github.com/Xiangyu-CAS/rea-capcut/actions/workflows/release-0.7.1.yml) · [Validation scope](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.7.1/docs/RELEASE_0.7.1.md) · [Update behavior/privacy](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.7.1/docs/MANUAL_UPDATES.md).

Windows has 15 known baseline test failures; historical main macOS template polling also encountered `ENOENT`. Current CI outcomes must be reported separately rather than claiming universal green. The preview does not bundle Python, MLX, Whisper weights or additional voices, and does not claim new live-model speech or Codex-host testing. [Local speech setup](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.7.1/docs/LOCAL_SPEECH.md).
