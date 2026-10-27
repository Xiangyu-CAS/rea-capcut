# v0.7.1 preview: release scope and verification

This preview adds **Settings / native Help → Check for Updates**. The explicit Preview channel includes published prereleases and stable releases; it displays current/new version and plain-text notes, and opens a verified repository release page or an architecture-matched desktop DMG in the browser. It never silently installs, replaces or restarts ReaCut. See [behavior and privacy](MANUAL_UPDATES.md).

## Status and provenance

This document describes **publication gates**, not a claim that pending checks have passed. Review the exact commit and results in [Manual update validation](https://github.com/Xiangyu-CAS/rea-capcut/actions/workflows/update-validation.yml), [Build and test](https://github.com/Xiangyu-CAS/rea-capcut/actions/workflows/ci.yml), and [Publish 0.7.1 preview](https://github.com/Xiangyu-CAS/rea-capcut/actions/workflows/release-0.7.1.yml). The release workflow creates a new [v0.7.1 prerelease](https://github.com/Xiangyu-CAS/rea-capcut/releases/tag/v0.7.1); existing v0.7.0 tags/assets are never replaced.

The retired v0.7.0 one-shot workflow is replaced by a v0.7.1-only workflow. It runs on release-preparation changes pushed to main, verifies matching application/plugin versions and refuses any existing v0.7.1 release/tag. This is not standing authorization for future automatic releases. A partly created draft/tag must be inspected before any separately approved recovery; it is not silently overwritten.

## Publication gates

1. Native macOS arm64 host, consistent 0.7.1 metadata, complete typecheck/unit/build suite against the exact pinned media tools shipped with the app. The FFmpeg recipe pins 9.0.2 rather than relying on mutable Homebrew runner packages.
2. Desktop integration regressions, plugin launcher tests, and real Chromium manual-update flows: explicit-only requests, loading/error/no-compatible-asset states, escaped notes, repeated clicks, dismissal, Chinese and narrow layout.
3. Dependency license inventory, native DMG/ZIP and optional plugin ZIP; corresponding pinned FFmpeg/x264/pkgconf sources, recipe and attribution.
4. `hdiutil verify`, read-only mounting, copying the **actual DMG application** into an isolated test directory, strict signature validation, arm64 executable, 0.7.1 native version and packaged main/preload byte equality.
5. Tests against that extracted app: bundled media tools under empty PATH, fonts/canvas, renderer isolation, project preview and video export; English/Chinese menus, canceled native picker and restart persistence; Settings/native Help update entry with injected synthetic metadata/error cases and a separate explicit user-click public API check. No remote payload or installation is executed.
6. SHA-256 assets assembled before creating and publishing the draft prerelease. After publication, download public DMG/checksum URLs without authentication; verify downloaded DMG bytes against the published checksum and compare that checksum file with the build copy.

The native tests replace fetch/openExternal only inside the isolated test process; production has no test endpoint or environment bypass. The optional live check performs the same user-click action against the fixed public API and does not download or install anything. GitHub receives ordinary IP/request headers. Synthetic tests do not contact GitHub.

A failed or skipped gate is not a pass. A post-publication checksum failure means the release is already public but download verification is incomplete; inspect that state rather than rerunning publication blindly. Workflow artifacts retain native/browser evidence, screenshots and SHA-256 sums.

## Reproduce on native Apple Silicon

```sh
npm ci
node node_modules/electron/install.js
npm run media:build
export PATH="$PWD/media-tools/darwin-arm64:$PATH"
REACUT_FFMPEG="$PWD/media-tools/darwin-arm64/ffmpeg" REACUT_FFPROBE="$PWD/media-tools/darwin-arm64/ffprobe" npm run check
npm run check:desktop
npx playwright install chromium
npx tsx tests/update-browser.ts
REACUT_TEST_LIVE_UPDATES=1 npx tsx tests/update-electron.ts
python3 tests/plugin-launcher.py
npm run licenses
npm run dist:mac:installer
npm run plugin:pack
npm run demo
# Verify/mount the actual DMG read-only and copy ReaCut.app to an isolated directory.
export REACUT_TEST_APP="/absolute/path/to/extracted/ReaCut.app"
npm run test:package
npx tsx tests/i18n-electron.ts
REACUT_TEST_LIVE_UPDATES=1 npx tsx tests/update-electron.ts
```

## Boundaries and known limitations

- Apple Silicon release only; direct updater download requires an exact architecture-labelled DMG. Intel/Windows/Linux receive a no-compatible-DMG message unless an appropriate future asset is published. A plugin ZIP is never used as a desktop update.
- Ad-hoc signed, **not Apple-notarized**, without Developer ID. Integrity/signature checks do not prove Gatekeeper acceptance of a fresh browser download. No quarantine attribute or security setting is changed.
- Only a user-requested check contacts GitHub. No startup polling, telemetry, tokens or project/media uploads. Links open in the browser; installation remains manual. Automatic installation/signing infrastructure is a separate future design.
- Windows retains 15 known baseline test failures. Historical macOS template polling also encountered `ENOENT`. Review current cross-platform runs separately; this feature does not silently skip failures or claim all-platform green.
- No new live MLX model, system-voice or Codex-host integration validation is claimed. Python/MLX/Whisper weights are not bundled or downloaded. Existing language fallback and user content handling are unchanged.
