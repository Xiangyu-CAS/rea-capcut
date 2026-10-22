# v0.6.0 macOS preview validation

This release packages merged local speech PR [#4](https://github.com/Xiangyu-CAS/rea-capcut/pull/4), merge `a38d3d709723e6ef4b9ae1a5435ed683d8948c0c`, plus version, download documentation and packaged-test support. It also includes the timeline and reverse/freeze changes already on main. See the [machine-readable evidence](validation/release-0.6.0.json) and [Release](https://github.com/Xiangyu-CAS/rea-capcut/releases/tag/v0.6.0).

## Actual DMG validation

On an Apple Silicon MacBook Air, the new DMG passed `hdiutil verify`, was mounted read-only, and its application was copied into an isolated test directory. The existing installed application and original source checkout were not changed. The extracted executable is arm64, reports **0.6.0**, and passes `codesign --verify --deep --strict`. Signing is **ad-hoc, without Apple notarization or a Developer ID**. No security settings or quarantine attributes were changed. This does not establish Gatekeeper acceptance on a fresh downloaded installation.

The extracted application, rather than the development Electron entry, passed:

- Empty-PATH startup, bundled FFmpeg/FFprobe discovery, native font/canvas, renderer sandbox and context isolation, project loading, preview and the existing real video export regression.
- Missing ASR dependency guidance; selection and persistence of an existing Python/model; real task cancellation.
- Chinese Tingting and English Samantha synthesis, persistent WAV tracks, measured timeline playback, actual Whisper transcription, editable source-aligned captions, undo/redo and modal guards.
- Local video import with one-second initial silence; subtitle editing and rendered pixels; SRT export; actual process restart retaining assets/settings and cleaning abandoned temporary files.
- A real 24-second H.264/AAC export, decoded with visible captions and non-silent TTS audio. No renderer errors or HTTP requests were observed.

Runtime main/preload bytes in the application match the release source build. Package contents were checked for accidentally included models, user speech media, environments and test projects. The app includes the MIT license, third-party notices, 122 resolved dependency attribution records and verified corresponding FFmpeg/x264/pkgconf sources with licenses. These media-tool sources are also provided separately on the Release.

## Reproduce

Use a macOS Apple Silicon desktop and the separately configured dependencies in [LOCAL_SPEECH.md](LOCAL_SPEECH.md). Model tests never fall back to mocks. The application does not download Python, models or additional voices.

```sh
npm ci
npm run check
npm run licenses
npm run dist:mac:installer
npm run demo
# Mount the generated DMG read-only and copy ReaCut.app to a test directory.
export REACUT_TEST_APP="/absolute/path/to/extracted/ReaCut.app"
npm run test:package
# Export REACUT_SPEECH_PYTHON and REACUT_SPEECH_MODEL as documented.
npm run test:speech:real
npx tsx tests/speech-electron.ts
```

The speech test records `sourceBuild: false` and the native application version when `REACUT_TEST_APP` is set. Only native file dialogs are replaced in this test process; engines, project edits, playback and exports run normally. Raw local evidence is written under `.test-output/speech-electron/` and `.test-output/package-electron/`. The public JSON removes local machine paths.

## Limits and CI

ASR requires Apple Silicon, Metal, separately installed Python/MLX and local weights. The tested MLX Community Whisper small weights are 481,307,592 bytes (459.01 MiB), converted from OpenAI Whisper; neither weights nor Python are bundled. TTS uses available macOS voices. Chinese can be transcribed in traditional script; recognition and timing require review. See setup instructions for pinned source, revision and checksum.

Local typecheck, all 343 tests in 30 files and the production build passed. Feature head `054085f` passed macOS, Linux and package CI in [run 39719906045](https://github.com/Xiangyu-CAS/rea-capcut/actions/runs/39719906045). Its 15 Windows failures exactly matched main's existing baseline across assistantBackend, export.shutdown, mediaTools and portableProject. This release does not repair or hide those failures. No Intel, Windows or Linux binaries are published or claimed verified; there is no live-model CI coverage. The packaged plugin archive is updated to the release version; this run does not claim a fresh Codex-host integration test.
