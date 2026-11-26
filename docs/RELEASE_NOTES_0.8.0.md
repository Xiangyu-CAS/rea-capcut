## What's new

- **Follow System** is the default in **Settings → Language**. ReaCut uses English when it finds no supported system language. Upgrades keep saved manual choices, and you can switch back to **Follow System** at any time.
- **Multiple timelines per project** share a media library and keep separate canvases, tracks, and exports. Import all timelines from a supported local Jianying draft or choose a single timeline. [Draft formats and conversion limits](https://github.com/Xiangyu-CAS/ReaCut/blob/v0.8.0/docs/CAPCUT_INTEROP.md)
- **Beat editing and speed curves** add local beat detection, snapping, one-step splitting at beat markers, and editable speed ramps.
- **Audio and preview controls** add clip loudness normalization, background-music ducking, guided local caption setup, and a proxy mode for high-resolution timelines.
- **Exports** can use macOS VideoToolbox H.264 when available, with software fallback if the encoder fails to initialize. The Codex plugin can fill template slots and export a batch with progress and cancellation.

语言设置新增「跟随系统」，匹配不到时用英文，升级保留手动选择。本版也包含多时间线、剪映草稿整组导入、节拍剪辑、曲线变速、响度统一、背景音乐压低与代理预览。

## Downloads

- `ReaCut-0.8.0-arm64.dmg` or `ReaCut-0.8.0-arm64-mac.zip` for macOS Apple Silicon (M-series).
- `ReaCut-plugin-0.8.0.zip` for the optional Codex plugin. Use it with the 0.8.0 desktop app. [Plugin setup](https://github.com/Xiangyu-CAS/ReaCut/blob/v0.8.0/docs/CODEX_PLUGIN.md)
- `SHA256SUMS.txt` lists checksums for the installers, plugin, and media-tool source and license files.

The preview uses ad-hoc signing and lacks Apple notarization. Update through **Settings → Check for Updates** or download the installer here. Quit ReaCut before replacing it. Local speech requires a separate Python/MLX setup and model. [Local speech guide](https://github.com/Xiangyu-CAS/ReaCut/blob/v0.8.0/docs/LOCAL_SPEECH.md)

The release workflow runs pinned-media tests, verifies the DMG and the signature of its extracted app, and tests language settings, editing, export and the Codex plugin against that app. It checks the public DMG against the published checksum. [Release workflow](https://github.com/Xiangyu-CAS/ReaCut/actions/workflows/release-0.8.0.yml)
