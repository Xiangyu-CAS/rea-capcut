# ReaCut

[中文](README.md)

An independently implemented offline desktop video editor, developed first on macOS with Windows and Linux build configurations. REA research informs observable editing layouts and local format hypotheses; the implementation uses original code and open-source dependencies. It does not redistribute Jianying / CapCut proprietary code, libraries, artwork or templates, or claim complete parity with the commercial product.

![ReaCut desktop editor](docs/screenshots/demo-editor.png)

## Features

Local video, audio and image import with thumbnails, waveforms, search, relinking and preview proxies. Multitrack editing includes dragging, trimming, splitting, selection, copy/paste, track rename/reorder/delete, locks, mute/hide, snapping, ripple deletion and undo/redo. Transform, source-space cropping, RGB chroma key, rectangle/ellipse masks, basic RGB adjustments, blur, audio gain, fades and constant speed changes with pitch-preserving audio are implemented locally.

Text defaults to the bundled, unmodified Noto Sans SC font, with optional installed fonts, alignment, backgrounds and strokes. SRT / basic WebVTT can become editable text clips; text tracks can export SRT. Position, scale, rotation, opacity and volume have linear / smoothstep keyframes. Splits and trims preserve animation curves and fade envelopes. Live preview dragging moves the keyframed path with the clip and commits one undo step; the final frame remains visible at the project end. Timeline height is adjustable by dragging or keyboard. Projects save as `.reacut`, with recent projects and local recovery. MP4 / MOV export uses a separate FFmpeg process with progress, cancellation and temporary output protection.

See the [feature matrix](docs/FEATURE_MATRIX.md) for precise limitations. Accounts, SaaS, cloud synchronization and API AI are unimplemented. Classic plaintext draft import is experimental and lossy. The installed Jianying 11.0 opaque `draft_info.json` is unsupported; see [draft interoperability](docs/CAPCUT_INTEROP.md).

The local macOS run passed 104 automated tests across nine test files, plus Electron import/edit/save/reopen/export workflows and separate crop/mask/chroma UI checks with decoded export pixels. macOS DMG/ZIP artifacts have been produced and checked. The application copied from the final DMG passed bundled-font, preview and nine-second mixed-audio export checks. See [validation evidence](docs/VALIDATION.md) for coverage and limits.

## Run

Use Node.js 26, or Node.js 24.x at least 24.11, and npm. Install `ffmpeg` and `ffprobe` separately; FFmpeg must include `libx264` and AAC encoding.

```sh
npm ci
npm run dev
```

This starts the Electron editor and Vite on `127.0.0.1:5173`. Browser preview supports a subset of workflows; desktop mode provides full file operations and video export. Select both media executables in Settings, or provide absolute paths with `REACUT_FFMPEG` and `REACUT_FFPROBE`. FFmpeg is not bundled. REA and Jianying are not runtime dependencies.

```sh
npm run typecheck
npm test
npm run build
npm run dist:mac
npm run dist:mac:installer
```

The macOS command builds a local application directory under `release/`; `npm run dist` follows electron-builder platform targets. Windows / Linux configuration is not evidence of testing on those systems. macOS builds use local ad-hoc signing and pass strict signature checks. They do not use Apple Developer ID signing, are not notarized, and have no update service.

Additional verification and attribution collection:

```sh
npm run fixtures
npm run test:timeline
npm run test:desktop
npm run test:visual
npm run test:storage
npm run test:player
npm run test:audio
npm run test:tracks
npm run licenses
npm run demo
# After building the .app; REACUT_TEST_APP can select a different bundle
npm run test:package
```

`npm run check:desktop` runs the compiled desktop regressions sequentially. UI checks use generated media and isolated user data; native dialogs are replaced only inside the test's own Electron process. Browser checks require Chrome or Playwright Chromium (`npx playwright install chromium`). See [validation evidence](docs/VALIDATION.md) for executed coverage and remaining platform limits.

[Original demo project](docs/DEMO.md) · [User guide](docs/USER_GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) · [REA findings](docs/research/REA_FINDINGS.md)

## Licensing and local data

Original source code is [MIT licensed](LICENSE). Third-party licenses are retained separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`, including Electron / Chromium and Skia native components. The bundled Noto Sans SC font retains SIL OFL 1.1, its original copyright and provenance fingerprints. Optional system fonts are not redistributed. These dependencies cannot collectively be described as MIT-only.

Projects reference absolute local media paths and do not embed source media. Relink media after moving a project to another machine. Local caches, proxies, recent projects and recovery data use Electron's user-data directory. Editor workflows do not upload media or call cloud services; dependency installation and build-tool downloads may use the network. Private media, projects and raw `.research/` evidence stay outside the public repository.
