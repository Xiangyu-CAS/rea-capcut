# 本地自动字幕与配音（未发布源码）

本实现基于 main `427742ee9022e68c44d9c9398331530b89678a53`。已发布的 v0.5.0 安装包不包含这些能力；验收只构建和验证源码，没有覆盖已安装应用或发布安装包。

## 操作

1. 从源码运行 `npm start`（首次先 `npm run build`），打开左侧 **字幕**。
2. **自动识别字幕**：选择已有时间线音视频片段，或用 **选择本地音视频…** 导入文件。
3. 展开 **本地识别依赖与模型**，选择已安装 `mlx-whisper` 的 Python 可执行文件。若未发现已缓存的 small 模型，选择包含 `config.json` 和 `weights.npz` 或 `weights.safetensors` 的本地模型目录。这里没有安装或下载按钮，不接受远程模型 ID。
4. 选择中文、English 或自动检测，再点 **生成并添加**。时间线片段使用实际入点/长度进行识别，按速度和位置映射字幕；完整源素材则和字幕一起加入播放头位置。字幕是普通可编辑文字轨道，可逐句修改、撤销、导出 SRT 或烧录到视频。
5. **文字转语音**：输入文字，选择中文/英文、系统声音和语速，生成本地 WAV 并加入播放头位置的新音轨。每次上限 10,000 字符，80–400 词/分钟；中文实际速率以系统声音为准。

任务显示准备、识别/合成、载入等阶段。识别按模型处理窗口报告进度；加载权重和合成阶段可能没有连续百分比。可取消；失败或取消不修改项目，清理中间文本和音频。处理期间若项目被其他操作修改，旧结果不覆盖新编辑。

## 运行条件与离线边界

- ASR：Apple Silicon macOS、可访问 Metal GPU 的本地桌面会话、Python + `mlx-whisper`、FFmpeg/FFprobe，以及已经存在的 MLX Whisper 权重。当前集成不支持 Windows/Linux 的 ASR 引擎。
- TTS：macOS `/usr/bin/say`、已可用的系统声音及 FFmpeg。不是 AI 声音克隆；Windows/Linux 显示缺失声音/不支持提示。
- 识别最长源时长 60 分钟。输入统一在本地转为 16 kHz 单声道 PCM。先去掉开头近静音并保留 80 ms 余量，识别后补回原偏移；词级对齐结果分为短字幕并按项目帧率量化。识别与时间戳仍需人工校对；噪声、音乐和静音可能影响结果。中文可能输出繁体，不强制转换字形。
- Python worker 固定 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`、关闭 Hub telemetry，并拒绝 socket 连接。模型必须是本地路径；音频数组直接传给模型，不调用云识别。媒体解码沿用 `file,pipe` 协议白名单。
- 本轮验收机器复用了已有 `mlx-whisper 0.4.3` 和 `mlx-community/whisper-small-mlx` 缓存：权重 **481,307,592 bytes / 459.01 MiB**，snapshot `45f3915923c7a79a5a5b5a7d909d39aeb0e5630e`。没有下载或安装任何模型/引擎。
- 首次部署若没有依赖，需要另外安装引擎和下载权重；这一步需要网络、磁盘空间及用户自行批准。不要把“应用不下载”误解为模型不占空间。此实现只自动发现标准 Hugging Face 缓存中的 small 模型，不扫描其他项目里的 Python；运行时通过文件选择器配置。
- 可用 `REACUT_SPEECH_PYTHON`、`REACUT_SPEECH_MODEL` 指定绝对路径，环境变量优先于保存设置。测试使用已有环境，不自动安装。

## 首次配置（其他机器不会自带测试机的缓存）

普通 `npm ci` / 应用安装包**不包含 Python、MLX、Whisper 权重或额外系统声音**。先安装项目要求的 Node.js 和 FFmpeg/FFprobe，再按需配置下列可选能力。以下安装/下载命令由用户明确选择后执行；ReaCut 不会运行它们。

### Apple Silicon ASR

需要原生 arm64 Python（本轮使用 Python 3.12）和可访问 Metal 的 macOS 会话。不要复用其他人的绝对路径，创建自己管理的环境，例如：

```sh
python3.12 -m venv "$HOME/.venvs/reacut-speech"
"$HOME/.venvs/reacut-speech/bin/python" -m pip install "mlx-whisper==0.4.3"
```

这一步需要网络并会安装 Python 依赖，除模型外还需要额外磁盘空间。`mlx-whisper` 来自 [Apple MLX whisper 实现](https://github.com/ml-explore/mlx-examples/tree/main/whisper)；测试环境的主要版本为 mlx-whisper 0.4.3、mlx 0.32.2、numpy 2.5.3、huggingface-hub 1.30.0。只固定直接依赖的示例不是完整锁文件，新解析的传递依赖需自行验收。

若没有已有模型，以下**显式联网下载**命令仅取已验收 snapshot 的配置和约 459 MiB 权重，不会读取或上传媒体：

```sh
"$HOME/.venvs/reacut-speech/bin/python" - <<'PYMODEL'
from pathlib import Path
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="mlx-community/whisper-small-mlx",
    revision="45f3915923c7a79a5a5b5a7d909d39aeb0e5630e",
    allow_patterns=["config.json", "weights.npz"],
    local_dir=str(Path.home() / "Models" / "reacut-whisper-small"),
)
PYMODEL
shasum -a 256 "$HOME/Models/reacut-whisper-small/weights.npz"
```

该 snapshot 权重预期 SHA-256 为 `55b6674c9b339702d486e2b1573839a66f8ec8f821ed2886993ef717a86b09f5`。应用中选择 `$HOME/.venvs/reacut-speech/bin/python` 和 `$HOME/Models/reacut-whisper-small`（文件选择器需要实际展开后的目录）。也可在启动源码或运行真实测试前显式设置：

```sh
export REACUT_SPEECH_PYTHON="$HOME/.venvs/reacut-speech/bin/python"
export REACUT_SPEECH_MODEL="$HOME/Models/reacut-whisper-small"
```

之后识别使用本地文件，不需要网络。提示 `No Metal device available` 时需在可访问 GPU 的本机桌面会话运行；不要关闭系统安全设置。Intel Mac、Windows 和 Linux 无此 MLX ASR 支持。

### macOS TTS

TTS 不需要 Python 或 ASR 模型。运行 `/usr/bin/say -v '?'` 查看系统声音，在应用里选择已有中英文声音。若缺少目标语言，可在 macOS 的声音设置中自行下载系统声音；这属于单独的系统下载步骤，ReaCut 不安装声音。真实测试固定使用 `Tingting` 和 `Samantha`，需这两个声音已可用。Intel macOS 的系统 TTS 路径存在，但本轮只实测 Apple Silicon；Windows/Linux 尚无 TTS 实现。

## 存储、恢复与来源

依赖选择写入应用用户目录 `speech-settings.json`，完成的 WAV 位于 `speech-media/UUID.wav`。保存、自动保存恢复、撤销/重做、重新链接、预览和导出沿用普通项目模型。完成文件不会随撤销删除；跨机器归档使用 **收集项目素材**。删除应用数据会使引用的 WAV 丢失，需重新链接。

退出会终止语音子进程。崩溃后下次启动清理 `speech-media/.speech-*` 中断任务目录，保留完整 WAV；中断任务本身不续跑。字幕文本和时间已包含在 `.reacut` 项目中，不需推理引擎即可预览/导出；配音文件也无需 TTS 引擎即可播放。

运行时来自 [Apple MLX 示例项目](https://github.com/ml-explore/mlx-examples/tree/main/whisper) 的 `mlx-whisper`（已安装包标明 MIT）。原始 [OpenAI Whisper 模型和代码](https://github.com/openai/whisper#license) 使用 MIT；已存在的 [MLX Community small 权重](https://huggingface.co/mlx-community/whisper-small-mlx) 是 Whisper small 的格式转换，不是 OpenAI 官方发布的 MLX 文件。模型/运行时不随项目分发。macOS 系统声音由 Apple 提供，不提取或分发其声音库。没有使用剪映私有引擎、素材或授权机制。

## 复现与证据

```sh
npm run typecheck
npm test
npm run build
# 先按上文导出 REACUT_SPEECH_PYTHON / REACUT_SPEECH_MODEL
npm run test:speech:real   # 仅真实引擎测试
npm run test:speech        # 构建、真实引擎测试、Electron 完整流程
```

真实测试需要 macOS 桌面、Metal 与已安装的中英文声音。它们不会退回 mock；缺少环境即失败。`npm test` 中的核心/子进程测试不需模型，不能代替真实测试。

`.test-output/speech-real/` 保留自造中英文 WAV、真实识别结果、时间戳和 RMS。`.test-output/speech-electron/` 保留源码 Electron 的项目、SRT、MP4、截图及 `evidence.json`。完整检查日志位于 `.test-output/speech/`。仅文件选择对话框在测试进程中替换，ASR、TTS、FFmpeg、播放、编辑和保存均实际执行。

跨平台边界：本轮没有 Windows/Linux 运行或安装包验收。仓库原有 `docs/VALIDATION.md` 记录的 Windows 合成 CLI、FFmpeg 发现和路径断言基线故障仍保留；本机测试不表示它们已修复。

本次验收摘要：[local-speech-2026-10-22.json](validation/local-speech-2026-10-22.json)。源码演示另经独立用户目录打开，模型/中英文声音 ready；收集素材后的全部媒体 SHA-256 与源文件一致。
