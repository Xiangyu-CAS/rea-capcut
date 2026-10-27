# v0.7.0 preview: release scope and verification

This release packages the English-interface fix for [issue #6](https://github.com/Xiangyu-CAS/rea-capcut/issues/6), plus keyframe curves, subtitle editing/animation and reusable project templates previously available only in source. It preserves Chinese and user-authored content. There is no in-app updater in this release.

## Status and provenance

This document describes the **publication gates**, not a claim that a pending run has passed. Check the [Publish 0.7.0 preview workflow](https://github.com/Xiangyu-CAS/rea-capcut/actions/workflows/release-0.7.0.yml) for the exact merged commit, completed steps and downloadable validation evidence. A successful run publishes a new [v0.7.0 prerelease](https://github.com/Xiangyu-CAS/rea-capcut/releases/tag/v0.7.0); it never replaces v0.6.0 assets or changes a user installation.

The one-version workflow runs only for release-preparation changes pushed to main, verifies exact 0.7.0 metadata and refuses an existing release/tag. It uses GitHub-hosted macOS arm64, with ordinary repository-scoped release permission. No user computer or signing credential is required. If a run leaves a draft or tag behind, it stops instead of overwriting it; inspect that state before any separately authorized recovery.

## Publication gates

1. Native arm64 host, consistent application/plugin versions, typecheck, complete unit suite, production build and plugin launcher tests.
2. Dependency license inventory, native macOS DMG/ZIP and optional plugin ZIP. The media tools are built from pinned, checksum-verified FFmpeg/x264/pkgconf sources, with corresponding sources and licenses included.
3. `hdiutil verify`, read-only mounting, copying the application to an isolated test directory, strict signature verification, arm64 executable and native version 0.7.0 checks.
4. The **application extracted from the DMG** runs `tests/package-electron.ts`: synthetic project loading, bundled media tools under empty PATH, fonts/canvas, renderer security isolation, preview and video export. `tests/i18n-electron.ts` checks English/Chinese native menus, a canceled native picker, invalid locale rejection and English preference across an actual process restart.
5. Source/license artifacts and SHA-256 sums are assembled before the draft prerelease is published. After publication, the public DMG and checksum URLs are downloaded without authentication; downloaded DMG bytes must match the published sum, and the sum file must match the built release's copy.

Validation artifacts include the packaged test evidence and English desktop screenshot. A failed or skipped gate is not a pass. A failure after publication is a public-download verification failure, not an unpublished release; inspect the actual release before retrying.

## Reproduce on a native Apple Silicon Mac

```sh
npm ci
node node_modules/electron/install.js
npm run check
python3 tests/plugin-launcher.py
npm run licenses
npm run dist:mac:installer
npm run plugin:pack
npm run demo
# Verify/mount the DMG read-only and copy ReaCut.app to an isolated directory.
export REACUT_TEST_APP="/absolute/path/to/extracted/ReaCut.app"
npm run test:package
npx tsx tests/i18n-electron.ts
```

## Boundaries and known limitations

- Apple Silicon only. Ad-hoc signed, **not Apple-notarized**, without Developer ID. Signature/integrity checks are not proof of Gatekeeper acceptance on a fresh downloaded install. No security setting or quarantine attribute is changed.
- This workflow does not run real MLX Whisper/voice-model validation or Codex-host integration. Python, MLX, model weights and extra voices are not bundled or downloaded automatically. See [local speech setup](LOCAL_SPEECH.md).
- Windows retains 15 known pre-existing test failures. The prior main macOS template workflow also had a save-file polling `ENOENT` failure; report current runs separately rather than declaring all-platform green. Packaging gates do not silently repair or hide these baseline issues.
- Turkish keeps existing translations and falls back to English for newly covered panels. Unknown backend details and user text are preserved. OS-owned picker controls follow the operating system.
- No automatic installation, update download or in-app updater is introduced. Users choose whether to download and install the new preview.
