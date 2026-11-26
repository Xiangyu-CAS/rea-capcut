# 在 Codex 和 ChatGPT 中使用 ReaCut

ReaCut 的桌面插件直接在侧栏显示播放器、素材库、属性面板和多轨时间线。侧栏和 MCP 工具共用本机的项目、播放位置和撤销记录。

## 安装本地插件

1. 准备同一版本构建的 **ReaCut 0.9.1 或更新版本**应用和插件 ZIP。源码构建命令见下文。macOS 可把 ReaCut 放入“应用程序”并启动一次。
2. 安装 Codex 桌面端、`codex` CLI 和 Python 3。
3. 在源码目录或解压后的插件包目录运行 `sh scripts/install-plugin.sh`。应用位于其他目录时使用 `sh scripts/install-plugin.sh --app /absolute/path/ReaCut.app`。
4. 重连或新开一个加载了 ReaCut 的 Codex 聊天，然后输入“用 ReaCut 在右侧打开视频编辑器”。

安装脚本通过 Codex CLI 注册插件，将自定义应用路径保存至 `~/.config/reacut/plugin.json`。`REACUT_APP` 可以覆盖该路径。默认寻找 `/Applications/ReaCut.app` 和 `~/Applications/ReaCut.app`。支持本地执行的 ChatGPT 桌面聊天也可以使用 stdio 插件结构。公开目录有单独的本地插件审核条件。[OpenAI 桌面插件说明](https://developers.openai.com/plugins/deploy/desktop-only)

## 用侧栏剪辑

- 导入、打开、保存和导出使用系统文件对话框。素材可以拖入时间线，也可以预览后按入点和出点插入。
- 选择片段后可剪切、拖动、裁切和调节属性。可以直接在文字框里用中文输入法和粘贴。窄面板可切换素材与属性。
- 侧栏可直接按项目设置导出 MP4，也可从项目菜单导出 MOV。通过项目菜单中的“显示桌面窗口”打开同一会话，使用桌面版的高级素材、效果和导出设置。

首次实际调用编辑工具时才启动 ReaCut，查询工具和读取界面资源仍可独立进行。插件会话使用独立的恢复目录。`reacut_state.recoveryPath` 返回这次会话的自动保存位置。可通过打开或保存 `.reacut` 文件与独立启动的桌面版交换项目。

## 让 Codex 或 ChatGPT 操作项目

1. 工具 `reacut_state` 返回当前时间线、素材、选中片段、选段和 revision。通过 `reacut_open_project` 可以请用户从本机选择现有项目。用户可以在侧栏选中片段，或者把素材或选段加入助手。
2. `reacut_edit` 原子应用最多 40 项动作，整批一次撤销。需要先审阅时用 `reacut_propose_edit`，侧栏可预览再应用。手工编辑和 MCP 编辑都会更新同一项目，旧 revision 会被拒绝。
3. `reacut_transcribe` 识别当前 revision 中的 `clip:<id>` 或 `asset:<id>`。用 `addCaptions` 和返回的 `transcriptionId` 把字幕入轨。翻译传入原顺序的 `translations`。[本地语音识别配置](https://github.com/Xiangyu-CAS/ReaCut/blob/main/docs/LOCAL_SPEECH.md)

**ChatGPT 网页端**可以通过支持自定义 MCP 的工作区使用私有 Secure MCP Tunnel。将下列命令作为隧道客户端的 stdio 上游，在装有 ReaCut 的本机运行，然后在 ChatGPT 中添加同一隧道的自定义 MCP 插件。创建和运行隧道所需的工作区关联、权限及凭据见[OpenAI Secure MCP Tunnel 文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。

```sh
python3 /absolute/path/to/plugin/scripts/launch.py --tools-only
```

`--tools-only` 提供项目读取、编辑、转录与导出工具。界面和预览文件留在本机。文件导入使用系统选择器或内置素材。网页版连接使用独立的 ReaCut 会话，可通过项目文件与桌面插件交换。

## 从同一模板生成多支视频

1. 用 `reacut_templates` 列出内置或本机模板。用 `reacut_template_slots` 核对占位 ID、素材时长和锁轨状态。
2. 调用 `reacut_output_folder`，由用户选定本机批量输出目录。
3. 用当前 revision 调用 `reacut_create_from_template`。本机插件支持 `{slotId, path}` 素材替换和 `{slotId, value}` 文案替换。无效替换保留当前项目。
4. 用 `reacut_save` 保存工程。用 `reacut_export_start` 启动 MP4 或 MOV 导出，轮询 `reacut_export_status`。用 `reacut_export_cancel` 可请求取消。文件以新文件名写入选定目录。

导出使用启动时的项目快照。输出目录和任务按会话隔离。

## 数据和预览

ReaCut 的 stdio 启动器在本机读取项目、处理预览和导出。侧栏仅从当前会话已导入的素材取预览数据，复杂或较大的素材可在桌面窗口预览。MCP 工具调用返回的项目摘要、文字和操作结果会交给调用宿主，桌面连接也可显式请求编辑器截图。

## 构建与验证

```sh
npm ci
node node_modules/electron/install.js
npm run build
npm run test:plugin:launcher
npm run test:plugin
npx playwright install chromium
npm run test:plugin:panel
npm run dist:mac:installer
npm run plugin:pack
```

macOS 构建的应用包含自包含的 MCP Apps 界面。插件 ZIP 位于 `release/ReaCut-plugin-<version>.zip`。使用 `REACUT_TEST_APP=/absolute/path/ReaCut.app/Contents/MacOS/ReaCut npm run test:plugin` 可指定验收已打包应用。浏览器测试使用本地 MCP Apps 宿主和合成素材。

![ReaCut 侧栏在本地 MCP Apps 验证宿主中运行](screenshots/codex-plugin-local-host.jpg)
