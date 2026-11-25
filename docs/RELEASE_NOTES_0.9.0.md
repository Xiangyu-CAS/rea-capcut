## ReaCut 0.9.0 Preview

ReaCut is an open-source video editor for Mac. Cut, caption, mix, and export from the standalone app. The optional editing Agent works on the same files and timeline.

### What’s new

- **Editing Agent in the desktop app.** Connect your own ChatGPT account through Codex. Select a clip or media range, then ask for an edit. The conversation shows each stage, and applied edits can be undone together.
- **Editable English subtitles.** Select a clip with speech and try **Add English subtitles to this video**. ReaCut transcribes locally, Codex translates the timed text, and the editor places each cue on the timeline. [Agent guide](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.9.0/docs/ASSISTANT.md)
- **Shared editing tools.** The optional Codex plugin can also transcribe and edit the ReaCut timeline from the Codex sidebar. [Plugin setup](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.9.0/docs/CODEX_PLUGIN.md)

### Download

- **ReaCut-0.9.0-arm64.dmg** or **ReaCut-0.9.0-arm64-mac.zip** for Apple Silicon Macs. FFmpeg and FFprobe are included. The preview uses ad-hoc signing and lacks Apple notarization.
- **ReaCut-plugin-0.9.0.zip** for the optional Codex sidebar integration.
- **SHA256SUMS.txt** lists checksums for the desktop packages, plugin, and accompanying media-tool sources and licenses.

Manual editing and export work without an account. The Agent needs Codex access, and automatic transcription needs a separate Python/MLX environment and model. Your original video and audio stay on your Mac during the subtitle workflow. [Local speech setup](https://github.com/Xiangyu-CAS/rea-capcut/blob/v0.9.0/docs/LOCAL_SPEECH.md)

### 中文

独立桌面版加入剪辑 Agent。选中一段有声音的视频后，试试「给这个视频加英文字幕」。ReaCut 在本机识别语音，Codex 翻译带时间戳的文字，字幕会直接写入可编辑的时间线。安装包支持 Apple Silicon Mac。 [产品网站](https://reacut.app/zh-cn/)
