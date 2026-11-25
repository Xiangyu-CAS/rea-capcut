# 国际版 CapCut Desktop 9.8.0 对照

2026-11-25 在 macOS 对照用户提供的 CapCut Appshot、本机应用包和 CapCut 官方资料。本机国际版 Bundle ID 为 `com.lemon.lvoverseas`，版本与构建均为 `9.8.0`。此后编辑工作流以国际版为参考。旧研究覆盖国内剪映 `com.lemon.lvpro` 的 `11.0.12922`／`11.1.0-beta3`，草稿验证仍以该版专用项目为依据。 [剪映首轮观察](REA_FINDINGS.md) · [草稿验证](DRAFT_FORMAT_ROUND2.md)

## 用户能看到的差别

| 工作流 | 国际版 9.8.0 的观察 | ReaCut 对齐情况 |
| --- | --- | --- |
| 视频编辑 | Appshot 显示 Preview、Canvas 和 Timeline 入口。Timeline 内保留素材、播放器、属性和多轨区域。 | 现有播放器与多轨编辑继续承担时间线工作。独立 Canvas 创作空间待实现。 |
| 在编辑器里与 Agent 对话 | Omni Agent 和属性都在右侧。Appshot 显示提示词、附件、语音与模型控件。 | 右侧剪辑 Agent 与时间线可同时使用。输入框下方集中放置素材、参考帧、模型与推理强度。流式回复和可展开的剪辑方案支持审阅后入轨。 [剪辑 Agent](../ASSISTANT.md) |
| 素材与创作 | Appshot 的媒体导航把用户素材、Spaces、Dreamina 和生成入口放在一起。 | 现有本地媒体库和模板参与粗剪。云素材、云项目与生成式视频属于待对齐能力。 |
| 口播整理 | CapCut 官方 EditPilot 资料描述用自然语言删停顿和口头语、生成字幕、处理声音，结果可继续在时间线上编辑。 | Agent 可按时间安排裁剪、分割、文字与音量，并使用本地语音识别生成可编辑字幕。需要翻译时，Codex 处理带时间戳的文字。整段视频理解和自动口播清理待对齐。 [EditPilot](https://www.capcut.com/tools/edit-pilot) |
| 从对话进入粗剪 | 官方 CapCut × ChatGPT 页面展示对话中生成或编排素材、查看可编辑时间线、缩短或重排片段，并进入编辑器细调。 | ReaCut 桌面 Agent 可根据素材和明确的源入点生成粗剪，应用后可直接手动调整。既有 ReaCut 插件也提供从 Codex 打开编辑器的路径。 [CapCut × ChatGPT](https://www.capcut.com/tools/capcut-x-codex) · [ReaCut 剪辑 Agent](../ASSISTANT.md) · [ReaCut 插件](../CODEX_PLUGIN.md) |

国内剪映的旧截图证明了三栏时间线、项目属性与本地编辑分类；旧助手研究记录了当时的宿主组件和可见入口。本次 Appshot 证明指定机器上的 Omni Agent 入口。由截图和官方说明能确定适合对齐的工作流。Omni Agent、EditPilot 与 CapCut × ChatGPT 的内部关系、服务供应方、使用的认证以及分地区的可用性待验证。 [旧助手研究](ASSISTANT_RESEARCH.md) · [EditPilot](https://www.capcut.com/tools/edit-pilot) · [CapCut × ChatGPT](https://www.capcut.com/tools/capcut-x-codex)

## REA 静态证据与草稿范围

- REA 6.4.0／Hopper 在 arm64 `libDeepAgentsService.dylib` 中找到 `Omni Agent`、`EditPilot` 和 `com.lveditor.draft`。证据 `ev_588aaa5b8cb9d27fcc69011558154f86ac532673b615a5a87582d7e4b014f0ef`。动态库 SHA-256 为 `4d16ec3d349adc53d2cdbb9e6ee8d5a25157c76cc00b21662d0a99bc5880ea86`。
- arm64 启动器链接 `libvideoeditor.dylib`。在该编辑器库做定向只读字符串检查，确认存在 `draft_meta_info.json`、`draft_info.json` 和 `draft_content.json`。文件命名与国内版线索重合。国际版 9.8.0 的草稿序列化、导入和效果保真仍需独立受控样本验证。 [当前导入范围](../CAPCUT_INTEROP.md)
- Agent 动态库单独通过签名校验，整个本机 App 包的签名校验返回封存资源缺失或无效。本次取证范围为用户提供的截图和本机包的指定文件，未读取草稿、素材或账号数据。
