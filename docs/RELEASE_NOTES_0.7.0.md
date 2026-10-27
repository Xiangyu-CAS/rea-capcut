ReaCut v0.7.0 preview expands English editing support and packages the creative workflows previously available only in source.

## What changed

- English coverage across libraries, player, timeline, Inspector, visual/keyframe controls, subtitles, templates, export/recovery dialogs, native application menus and common diagnostics.
- A visible **Settings** button (**设置 / Settings** in Chinese), bilingual language entry and **Cmd/Ctrl+,** shortcut. New profiles follow a supported system language, falling back to English; explicit choices are saved.
- Chinese remains supported. Existing project names, filenames, captions and other user content are not rewritten. Newly created built-in examples and defaults use the selected language. Newly covered Turkish panels currently use English fallback.
- Visual keyframe curves with editable easing; subtitle split/merge, batch styling and entrance/hold/exit animation; reusable local project templates with named replacement slots and three original examples.

## Downloads

- **ReaCut-0.7.0-arm64.dmg** — macOS Apple Silicon (M-series). Open and drag ReaCut into Applications when you choose to install it.
- **ReaCut-0.7.0-arm64-mac.zip** — desktop application ZIP.
- **ReaCut-plugin-0.7.0.zip** — optional Codex plugin; requires the desktop application. Extract and run `sh scripts/install-plugin.sh`.
- **ReaCut-0.7.0-media-tool-sources.tar.gz**, **LICENSE.txt**, **THIRD_PARTY_NOTICES.md** — corresponding FFmpeg/x264/pkgconf sources, recipe and attribution.
- **SHA256SUMS.txt** — download assets into one directory and run `shasum -a 256 -c SHA256SUMS.txt`.

**Preview: ad-hoc signed, not Apple-notarized.** Apple Silicon only; no Intel, Windows or Linux binary is provided. No security settings are disabled. Existing v0.6.0 attachments are retained.

## Verification and limitations

The publication workflow gates publication on the full unit/typecheck/build suite, plugin launcher checks, native arm64 packaging, strict signature/DMG integrity checks, and tests against the application extracted from the DMG: bundled media tools under empty PATH, fonts/canvas, security isolation, preview/export, language switching, native menus/picker labels and restart persistence. Its post-publication step downloads the public DMG and compares its SHA-256. Consult the exact workflow result before treating that final download check as passed.

[Release workflow and evidence](https://github.com/Xiangyu-CAS/rea-capcut/actions/workflows/release-0.7.0.yml) · [Validation scope](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.7.0/docs/RELEASE_0.7.0.md) · [Language behavior](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.7.0/docs/LOCALIZATION.md).

Windows has 15 known baseline test failures. A previous main macOS template workflow also encountered a save-file polling `ENOENT`; this release does not claim every historical/cross-platform workflow is green. New CI results must be reviewed separately.

The installer does **not** bundle Python, MLX, Whisper weights or additional system voices. ASR needs separately configured Apple Silicon MLX Whisper/model dependencies; TTS uses installed macOS voices. No model is downloaded automatically. This publication does not claim new live-model speech testing or Codex-host integration. [Speech setup](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.7.0/docs/LOCAL_SPEECH.md).

This release does **not** add an in-app updater and does not change your installed application automatically.
