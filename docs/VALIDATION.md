# 本机验证记录

## v0.5.0 GitHub 预览版安装包（2026-10-13）

发布附件由本机 Apple Silicon 重新构建，包含后台插件 Dock 修复。安装包为 ad-hoc 签名，未 Apple 公证；Windows / Intel Mac / Linux 不在此次二进制发布范围内。

- 类型检查及生产构建通过；此前同一产品代码的核心回归为 293 项通过、1 项缺少 libx265 跳过。
- 实际打包应用在仓库外工作目录、空 `PATH` 和隔离用户目录中启动，通过字体、缩略图、预览、渲染隔离及内置 FFmpeg / FFprobe 核对，导出 1280×720、9 秒、含中文字幕与混音的视频，renderer errors 为空。
- 实际打包应用通过插件协议、素材导入、原子编辑、版本冲突、撤销重做、截图、断连保存与退出测试。应用中的主进程、preload 和插件 HTML 与本次构建逐字节一致。
- `codesign --verify --deep --strict`、`hdiutil verify` 与插件 ZIP 完整性检查通过。包内含媒体工具对应源码、构建脚本和许可证；未包含私人项目或研究原始目录。
- GitHub 首轮 CI 的 Linux 核心任务通过，macOS / Windows 核心任务及云端打包任务存在失败，尚未解决；本地安装包验收不能代替 CI 全绿。详见 [首次运行](https://github.com/Xiangyu-CAS/rea-capcut/actions/runs/38387098585)。

附件与 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `ReaCut-0.5.0-arm64.dmg` | `ee23ae803a064d34e79ba68282959188fc7ff9b48649fee21b1aa0c0a8344849` |
| `ReaCut-0.5.0-arm64-mac.zip` | `2586d1e187a9af0780ee8dc7a69a8a958b793fb6a0fc9926596db64de1f1c9ff` |
| `ReaCut-plugin-0.5.0.zip` | `05abdeb012d46a44c3a2df5a0a3a59421634248b826673ea83ae2af77b324e8a` |

本机证据：`.test-output/package-electron/evidence.json`、`.test-output/plugin-electron/evidence.json`。

## macOS 插件 Dock 修复（2026-10-13）

后台插件改用 accessory 激活策略；显示桌面窗口时切回 regular，关闭窗口后隐藏 Dock 图标并保留编辑器。`tests/plugin-dock-electron.ts` 在隔离目录内验证上述三种状态及连续 20 次画面刷新均不显示窗口或 Dock 图标；类型检查与生产构建通过。修复应用位于 `release/plugin-dock-fix/mac-arm64/ReaCut.app`，打包后的插件协议、素材导入、编辑、撤销重做、截图及断连保存回归通过，严格签名检查通过。本机插件配置已指向修复应用。后续确认旧连接仍在使用原应用，核对空项目无未保存修改后正常退出；需重连插件加载修复应用，尚未取得修复版在 Codex 宿主内的最终确认。下文此前生成的 DMG 不含这次修复。

## v0.5.0 Codex 插件（2026-10-13）

新增 portable / Codex 兼容插件包、本地 stdio MCP 服务，以及 fullscreen MCP App 画面与输入桥接。插件在本机 Codex 中注册安装成功；后续通过插件工具打开侧栏，用户确认看到编辑器，并报告旧进程的 Dock 干扰问题。侧栏打开已获用户确认，完整宿主剪辑流程及 Dock 修复后的宿主表现仍待验收。以下是本地协议、真实编辑器与标准 MCP Apps 验证宿主的结果，不将它们等同于完整 Codex 宿主验收。

- 类型检查与生产构建通过。现有 24 个测试文件 **293 项通过、1 项缺少 libx265 跳过**。
- 实际 v0.5.0 macOS arm64 安装包在空 `PATH`、隔离用户目录下通过插件协议测试：initialize、9 个工具、fullscreen resource、app-only 帧权限、项目读取、原创素材导入、时间线插入、版本冲突、非法操作整批回滚、撤销/重做、无效路径和输入拒绝、真实画面与导出窗口。
- 断开 stdio 后核对最新项目已写入 autosave.reacut，编辑器正常退出。实际安装缓存中的 Python 启动器通过 MCP 通信；同时启动两个连接，恢复目录不同；EOF 与 SIGTERM 均刷新恢复数据并退出。
- 用 MCP Apps SDK 的独立本地验证宿主，通过 Computer Use 操作真实插件 UI，验证中文输入、全选替换、缩放坐标、片段拖动、快捷键撤销、系统保存对话框和真实导出。输出 H.264、640×360、5 秒 MP4，FFprobe 核对通过。发现并修复隐藏窗口的全选行为、CSS 缩放后的输入坐标以及离屏窗口无法切回桌面的问题。
- 改用可显示的隐藏窗口后，再次核对 MCP 截图与原生桌面界面；原有 renderer 隔离、CSP 和媒体授权保持启用。关闭插件的桌面窗口会收回到后台，不销毁侧栏编辑会话。
- Skill 校验、Python / shell 语法检查和 Git diff 空白检查通过。新增 MCP Apps SDK 及其实际打包依赖的原始许可声明；许可收集 122 条、无未解决项。
- 最终应用 `codesign --verify --deep --strict` 通过，DMG 的 `hdiutil verify` 为 VALID。仍为本地 ad-hoc 签名，未 Apple 公证。Windows / Linux 未实机验收。

安装包：`release/codex-plugin-final/ReaCut-0.5.0-arm64.dmg`，SHA-256：`d54b16d6c6eb6221a133d3af8d3106156fd61b966bf9250c821e57d1605fde0f`。插件包：`release/ReaCut-plugin-0.5.0.zip`。

本机证据：`.test-output/plugin-electron/evidence.json`、`.test-output/plugin-launcher.json`、`.test-output/plugin-harness/plugin-ui-export.mp4`、`.test-output/plugin-regression.log`。界面截图见 [插件说明](CODEX_PLUGIN.md#本地交互验收截图)。

## v0.4.2 文字 / 特效 / 转场库（2026-10-13）

提供 16 款可编辑文字模板、8 款关键帧动效和 8 款转场，保留并改善原有 8 款调色预设的缩略图。所有配方为自主代码，预览图来自内置原创素材；详情见 [CREATIVE_LIBRARY.md](CREATIVE_LIBRARY.md)。

- 最终类型检查与生产构建通过；使用内置 FFmpeg / FFprobe 执行全部单元与集成测试，24 个文件 **293 项通过、1 项因缺少 libx265 编码器跳过**。
- 配方专项 23 项通过：响应式可编辑文字、锁轨新建文字轨、原子撤销、关键帧保留、转场时长对齐及短片段/间隙/后续冲突保护。平滑曲线在转场边界后的数值与原始曲线一致。
- 实际执行全部 8 款转场和 8 款动效的 FFmpeg 导出图，检查转场前后和中间像素、滑入方向、叠化亮度、经过背景、缩放区域及动效帧变化。发现并修复动态缩放回到输入尺寸时 FFmpeg 9 的过滤错误，通过显式 planar / packed RGB 转换保持颜色与 alpha。
- 现有桌面叠化回归通过：中点预览 RGB `[127,0,128]`，导出 `[127,0,127]`，混音 RMS 约 0.06354；保留已有淡化包络的验证。
- 最终 macOS arm64 打包应用在空 `PATH`、隔离用户目录下运行 `tests/creative-library-electron.ts`，5 组完整流程检查通过。覆盖卡片数量、动态预览、文字分类/搜索、添加/撤销、调色/动效应用、转场时长/撤销和真实视频导出。输出 640×360、5 秒 MP4，包含中文动态文字、背景、呼吸缩放和缩放转场；白色文字像素 1,472，renderer errors 为空。
- 卡片布局随素材面板宽度自动调整列数。实际界面截图在本节所链接的素材文档中，均使用本项目生成的背景，没有用户视频。
- `codesign --verify --deep --strict` 通过，`hdiutil verify` 结果 VALID。仍为本地 ad-hoc 签名，未公证；Windows / Linux 未实机验收。

安装包：`release/creative-library/ReaCut-0.4.2-arm64.dmg`；SHA-256：`6e8861664176d5838f077cb9e453449bea90c10784248184b51ec6d3eea005e8`。

原始本机证据：`.test-output/creative-final-tests.log`、`.test-output/creative-library-electron/evidence.json`、`.test-output/transition-electron/evidence.json`。安装包验证不代表全部第三方媒体组合均已覆盖。

## v0.4.1 离线素材扩充（2026-10-13）

素材从 34 款扩至 64 款：28 个贴纸、14 张背景、12 个标题底板、10 个合成音效。原有 34 个媒体文件的 SHA-256 与扩充前一致。生成代码、SVG 源、音频合成公式、许可与文件清单一同保留；新增素材预览见 [素材说明](ORIGINAL_ASSETS.md)。

- `npm run assets` 生成 64 款素材及两张预览表；`vitest run tests/builtinAssets.test.ts` 的 4 项测试通过，覆盖全部素材的尺寸、透明度、文件指纹、SVG 外部引用约束，以及 WAV 格式、时长、RMS、峰值与首尾淡化。
- `tsx tests/builtin-assets-browser.ts` 的 7 项检查通过：64 张素材卡、图片加载、添加回调、分类、旅行关键词匹配定位与新相机、星点音效试听及分类切换；renderer errors 为空。
- `npm run build` 含 TypeScript 检查与生产构建通过。macOS arm64 新打包应用在空 `PATH`、隔离用户目录下运行 `tests/assistant-assets-electron.ts`，13 项检查通过。验证新相机 / 姓名牌的本机导入与撤销，极光背景 / 星点音效保存，透明图层预览，以及内置 FFmpeg 实际导出 640×360、5 秒有声视频。首秒音频 RMS 约 0.08951，首帧背景、贴纸与文字像素检查通过；renderer errors、failedMedia 均为空。助手环节使用合成 CLI，不调用真实账号。
- 包内 64 个媒体文件全部匹配 manifest 指纹。`codesign --verify --deep --strict` 通过，DMG 经 `hdiutil verify` 为 VALID；签名仍为本地 ad-hoc，未公证。Windows / Linux 未新增实机验证。

安装包：`release/assets-expanded/ReaCut-0.4.1-arm64.dmg`。SHA-256：`8a4dfd26a1ebbb159d3d9d1e4612f430a85ef9527420963841a063df02a12434`。原始本机记录位于被忽略的 `.test-output/builtin-assets/`、`.test-output/assistant-assets-electron/`、`.test-output/assets-expansion/`。

## 提交准备复核（2026-10-13）

使用内置 FFmpeg / FFprobe 重新运行 `npm run check`：类型检查、生产构建通过，22 个测试文件中 270 项通过、1 项 x265 造样测试跳过。桌面基础工作流重新通过，覆盖导入、播放、剪辑、撤销、文字/字幕、保存重开和实际视频导出，renderer errors 与媒体失败列表均为空。

公开导出截图现在由测试在截图时遮盖输出路径，避免把本机用户名带入文档。此改动只影响测试截图；应用导出路径和导出行为保持原样。原始测试结果保存在被忽略的 `.test-output/commit-prep/` 和 `.test-output/app-electron/`。

## 图标镜像方向更新（2026-10-13）

按用户要求重新绘制左向交叉带矢量图标，生成 PNG、SVG、ICNS 和 ICO。`npm run icons` 与 `npm run build`（含类型检查）通过。实际启动新打包应用，确认标题栏图标加载，包内 PNG / ICNS 与源产物字节一致，renderer errors 为空；应用严格深度签名校验和 DMG 校验通过。本轮为图标变更，未重复完整媒体回归。

新安装包：`release/icon-refresh/ReaCut-0.4.0-arm64.dmg`；SHA-256：`076053f5a303dba6eace0b13921c0ab49ded74f9ba3e1cbfd64a60b08ba359cd`。下方原 v0.4.0 安装包及验收记录保留。新包仍为 macOS arm64、本地 ad-hoc 签名、未公证。图标专项证据：`.test-output/icon-refresh/verification.json`。

## v0.4.0 界面与工作流安装包验收（2026-10-13）

22 个文件、270 项通过，1 项 x265 造样测试跳过；类型检查和生产构建通过。新功能及差异分析见 [本轮完善记录](IMPROVEMENTS_V040.md)，UI 对照见 [界面一致性](UI_PARITY.md)。

最终 DMG 在只读挂载后复制到全新隔离目录。七套测试均实际启动这份应用，清空应用 PATH、移除媒体工具覆盖并使用独立用户目录，共 **45 项**检查通过，renderer errors 均为空：基础安装包 7、素材/CLI 合成协议 12、字幕编辑 8、素材包/区间 6、源素材预览 4、三栏布局 5、300 句字幕项目 3。CLI 合成协议不代表 Claude 在线登录成功；真实 Codex 的既有闭环证据另见助手记录。

安装包基础套件确认内置 FFmpeg/FFprobe 9.0.2、Noto 和 native canvas，实际导出 1280×720、9 秒中文标题混音。源预览与区间分别导出一秒蓝色源画面（中心 RGB 0/0/255）及可听声音。素材包搬移并让原文件不可用后仍可预览、保存与导出；缺失包内未用素材时仍能保存其他修改。原生菜单与 Escape 不会替换打包弹窗。

三栏拖动/键盘微调、应用重启记忆、双击恢复、1024×720 小窗口和播放器控件边界通过。15 分钟 300 句合成字幕项目通过整批偏移/保存与一次撤销；单次自动化时间为启动 542ms、搜索 46ms、检查/应用/保存 230ms、撤销/保存 150ms，包含自动化开销。

DMG 的 hdiutil 校验为 VALID，ZIP 无错误，复制应用通过严格深度代码签名校验。签名为本地 ad-hoc、未公证。镜像内外 app.asar SHA-256 均为 e3bd166abe6874f815746901a6b1cca7cba8e191e60c0f02778221c44447ecca。

| 产物 | SHA-256 |
| --- | --- |
| ReaCut-0.4.0-arm64.dmg | ae577f3403d8d938ec689e50922b7dcf1c9dc0d741159ef7f34f308a6420e74c |
| ReaCut-0.4.0-arm64-mac.zip | c17d23ef3f65151dda8fba167fbe4e5f049b972e6a29c3b63136bf955001e7d9 |

本机证据目录：package-electron、assistant-assets-electron、subtitle-electron、portable-range-electron、source-preview-electron、workspace-electron、large-subtitles-electron，均位于 gitignored .test-output 中。此前八套原有桌面回归也全部通过；播放器在最终布局变更后另行回归。Windows/Linux 和商业剪映完整行为对等不在本轮证明范围。

## v0.3.0 集成安装包验收（2026-10-13）

17 个测试文件通过，209 项通过、1 项依赖额外 x265 造样的测试跳过；类型检查、构建和 Git diff 空白检查通过。27 项助手编辑测试与 18 项 CLI 后端测试覆盖操作验证、原子失败、锁轨、摘要字段/容量、历史、取消、协议与异常；分割内核新增一帧浮点边界回归。

最终 DMG 通过 `hdiutil verify`，只读挂载后复制至隔离目录的 .app 通过 `codesign --verify --deep --strict`。ZIP 完整性检查通过。包内 4,090 个 ASAR 条目未包含研究原始证据、测试或被分析的专有库。签名仍为本地 ad-hoc，未公证。

从 DMG 复制的应用以空 PATH 和独立用户目录启动：原安装包套件完成 1280×720、9 秒、13 片段中文混音导出；新增素材/助手套件 12 项通过，包括 PNG/WAV 导入、透明叠加、一次撤销、两种 CLI 合成协议、提案应用、项目变化后拒绝旧建议、历史恢复、取消与后续请求。新组合经界面导出为 640×360、5 秒视频；真实解码首帧检出背景、贴纸和文字，首秒音频 RMS 为 0.146348。两个套件均无 renderer errors，媒体请求无失败。

CLI 合成进程测试不等于在线服务验证。真实 Codex 另已通过“摘要函数 → 服务回复 → 提案验证/应用”的自造标题闭环；Claude 真调用返回未登录/认证失效，仅协议适配测试通过。用户须自行安装、正常登录 CLI；安装包不含 CLI 或订阅。见 [助手说明](ASSISTANT.md)。

[集成界面截图](screenshots/assistant-assets.png)。私有可复现记录：`.test-output/v030-check.log`、`package-electron/evidence.json`、`assistant-assets-electron/evidence.json`、`assistant-backend/real-codex-generated-context.json`。

| 安装包 | SHA-256 |
| --- | --- |
| ReaCut-0.3.0-arm64.dmg | `9abe83a5b630e3bc7952dd50f9976d1923e7a7068edb3cd2b675a79c247cb662` |
| ReaCut-0.3.0-arm64-mac.zip | `c27e36e1251a7095335cce36f2047da6afd29b7e12e4588cd18c621a739ff22a` |


日期：2026-10-13，Asia/Shanghai。本记录只描述 ReaCut 独立实现的本机证据，不证明与商业剪映完整对等，也不把剪映静态字符串、测试脚本或构建配置当成已执行的功能。

## v0.2.1：内置 FFmpeg 的安装包

2026-10-13，以独立构建的 FFmpeg/FFprobe 9.0.2 执行 `npm run check`：14 个文件、159 项通过、1 项跳过，类型检查及生产构建通过。跳过项需要 libx265 编码器生成 HEVC 测试源；本包不提供 x265 编码。另用自行生成的 HEVC/AAC 文件验证内置工具实际探测、HEVC 解码、H.264 预览代理、蓝色帧像素及保留声音，全部通过。

从最终 DMG 只读挂载并复制应用到带空格的独立目录，清空应用 PATH、移除 FFmpeg/FFprobe 环境覆盖，使用全新用户目录启动。系统信息明确返回 `.app/Contents/Resources/media-tools/` 内的两个工具；真实缩略图/预览及 1280×720、9 秒、中文标题与混音的 UI 导出通过，renderer errors 为空。导出后的探测也使用包内 FFprobe。包内草稿导入另通过 16 项检查。

镜像、ZIP、应用深度严格签名及两个媒体工具签名均通过；源包与 DMG 复制应用的 ASAR 指纹一致。媒体工具只依赖 `/usr/lib/` 和 `/System/Library/`，没有 Homebrew 动态库依赖。三份源码归档与构建脚本逐一核对 SHA-256，GPL 许可及对应源码随应用资源提供。签名仍为本地 ad-hoc、未公证；当前实测 macOS arm64。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `ReaCut-0.2.1-arm64.dmg` | 192668253 | `e47d0472da3f78cf82684226579278109ee87d432b59328499b6aff270ac9a47` |
| `ReaCut-0.2.1-arm64-mac.zip` | 192236273 | `f986bd2f3340243baa179b73a8dffeea1e3be174c20b3d5d9a66af15c03b7f41` |

[内置工具与重建说明](MEDIA_TOOLS.md) · [构建来源清单](media-tools-build.json)

## 第二轮 v0.2 验证（历史）

2026-10-13，`npm run check`：**155 项通过、13 个测试文件通过、零待办**，类型检查与生产构建成功。

新增验证包括：

- `capcutCodec`：自行生成的固定已知答案、篡改与截断、严格 Base64/UTF-8/对象校验、大小限制。
- `capcutProject` / `capcutProjectIO`：现代时间线目录、活动推荐、显式选择、只读源文件、路径和读取边界、不会误回退空根项目。
- `capcut-import-electron`：16 项真实桌面检查，涵盖不透明输入到画布/保存的完整链路、稀疏空时间线、取消/并发/token 生命周期，以及认证失败保留整个原项目。
- `export.sampling`：逐帧身份素材验证 1.5 倍、0.5 倍、24→30、30→24 fps 、帧对齐/非对齐裁剪、长 GOP/B 帧中后段 seek 及 VFR 大间隔/不规则采样，共十项；真实媒体逐帧比较，非字符串匹配测试。
- 额外的私有受控草稿验收：普通文件菜单、明确活动时间线、640×360 画布、视频/文字层级、黑色边角、实际媒体探测、0.5 秒画面及保存参数；无 page/media errors，原载荷 SHA-256 不变。
- 与剪映原生导出比较：90 帧/3 秒、2 秒视频和 3 秒文字，8 个抽样源帧全部一致；视频凸包 IoU 中位数约 98.44%，音频 RMS 差约 −0.00257 dB。它们不包含字体排版的保真承诺。

REA + Ghidra 正式反编译 Evidence、补充定点分析、认证解码和产品测试分别记录于 [第二轮研究](research/DRAFT_FORMAT_ROUND2.md)。原始受控载荷与完整解码数据只保留在本机忽略目录，公开测试使用合成数据。

最新构建另完整执行 8 套桌面回归（编辑导出、视觉工具、保存恢复、播放器、声音、轨道、转场、草稿导入），均无 renderer errors。最终 DMG 只读挂载后复制出的应用在独立 cwd/用户目录启动，完成九秒中文标题/混音导出；同一安装包再通过 16 项草稿导入检查，`packaged=true`。

v0.2 安装包的 `hdiutil verify`、ZIP 校验及严格代码签名检查通过。签名是本地 ad-hoc，未 Apple 公证。包内 4,023 个条目不含 `.research`、测试或被分析的专有库；运行编辑器不依赖逆向工具。

| 本地产物 | SHA-256 |
| --- | --- |
| `ReaCut-0.2.0-arm64.dmg` | `a3d18dfba8b2abf5bc393cdb5eb90c2e9a91cfbfc3f665f7c031c88fa9089e2b` |
| `ReaCut-0.2.0-arm64-mac.zip` | `f67ce443ebe5965587ea1f6364de0559909d211d92d2fedb59a6a411344f05c2` |
| `app.asar`（构建与 DMG 复制一致） | `551bd5cf9f6706542574c861574f4de3a044efa5ab8e24b6eb8a388590db3333` |

[时间线选择截图](screenshots/draft-timeline-choice.png) · [受控草稿导入后的 ReaCut](screenshots/draft-import-editor.png)


## 首轮 v0.1 环境与执行记录（历史）

本机为 macOS arm64；Node.js `26.11.1`、Electron `44.7.0`、Vitest `5.0.4`、electron-builder `26.15.3`。系统 FFmpeg 为 `9.0.2`，独立进程调用，不随应用分发。应用源码统一格式化后，在本机通过 TypeScript 检查与 Vite/Electron 编译；最新完整测试记录为 05:28:34。独立 `.test-output/fresh-install/` 执行 `npm ci` 安装 405 个包成功，并实际检查 native canvas、esbuild 与 Electron 可用，不能只以原有 node_modules 成功代替干净安装。

当前 Vitest 配置只收集 `tests/**/*.test.ts`，排除 `.research/` 与构建目录。首轮记录的 `npm test` 结果为 **104 项通过、9 个测试文件通过**；本机 Vitest 缓存中对应九个 `tests/` 文件也均为未失败。旧缓存可能保留更早扫描研究工具时的条目，这些条目不属于当前 ReaCut 测试范围。

## 核心及真实渲染

| 验证来源 | 证明的范围 |
| --- | --- |
| `tests/model.test.ts` | 源/目标时间数学、split/trim/变速、锁轨、动画及淡化窗口、不可信项目逐字段校验、crop/key/mask 可选参数边界 |
| `tests/store.test.ts` | 历史快照隔离、撤销/重做、transaction、轨道兼容、多选移动、素材去重、剪贴板、磁吸区间并集与 fade 重置 |
| `tests/capcutImport.test.ts` | 合成 classic 明文 JSON 的基础转换、警告、路径与数量限制；不证明当前剪映草稿兼容 |
| `tests/timeline.test.ts`、`tests/visual-ui.test.ts` | 时间线布局/吸附/波形和可视参数面板的核心语义 |
| `tests/export.integration.test.ts` | 真实 FFprobe/FFmpeg 导入、缩略图/波形/代理、源入点/速度/延迟、音高、画面合成、中文文字、关键帧、调色、alpha、淡化、音量/静音及取消目标保护 |
| `tests/export.visual.test.ts` | 源空间 crop、RGB 抠像、矩形/椭圆/羽化/反选蒙版与实际 FFmpeg 输出像素；包含源显示比例与有 alpha 的素材 |
| `tests/export.offline.test.ts` | 本地 playlist 含 HTTP 片段时，FFprobe/FFmpeg 拒绝获取，测试服务收到请求数为零 |
| `tests/export.shutdown.test.ts` | 应用退出时停止媒体/导出进程并清理临时结果 |

导出测试包含帧解码、像素比较、FFprobe 输出尺寸/时长、声音 RMS 和音高证据，并非只检查进程返回码。视频压缩、采样与量化采用测试中声明的容差，不能据此承诺所有帧逐像素相同。

## 编译后桌面工作流

`tests/app-electron.ts` 启动当前编译的 Electron 主进程，使用独立 `REACUT_USER_DATA` 和自行生成的媒体。文件对话框只在测试专用 Electron 进程内替换，编辑通过实际页面控件及快捷键完成。

本地证据 `.test-output/app-electron/evidence.json` 当前记录 **2026-10-13 05:33:12（Asia/Shanghai）通过**，`errors` 与 `mediaFailures` 均为空。覆盖实际红/蓝缩略图像素、播放器解码与播放推进、时间线分割源入点、撤销、桌面复制粘贴快捷键、音频属性选择、文字持久化、调色/速度/关键帧、SRT 导入、项目保存及重新打开、媒体载入、画布尺寸和 UI 发起的真实视频导出。输出经 FFprobe 核实为 **320×180、5 秒**的视频。

截图：

- [桌面编辑器](screenshots/electron-editor.png)
- [桌面导出完成](screenshots/electron-export.png)

`tests/visual-ui-electron.ts` 在独立 Electron 环境中操作裁剪、抠像与蒙版。`.test-output/visual-ui-electron/evidence.json` 当前记录 **2026-10-13 05:33:16 通过**，无 renderer errors；三份实际导出视频均按 320×180 验证：

- 四象限图片裁剪为左上区域，预览及导出中心保留红色。
- 椭圆蒙版反选后，预览及导出中心显示画布背景。
- 绿色背景/红色前景素材，预览及导出都移除绿色、保留红色。

测试同时验证百分比参数保存、最小有效宽度、初始禁用、清除效果、锁轨禁用控件。截图见 [可视工具桌面验收](screenshots/electron-visual-tools.png)。这些 MP4 是最终画布合成结果，不宣称带有独立透明 alpha 通道。

## 字体、许可与研究证据

内置原版 Noto Sans SC 的字体与 OFL 文件均通过 byte count、SHA-256 和 Git blob SHA-1 验证。`npm run licenses` 已收集 **118 条记录、218 个文件**，未解决项为零；归属路径和 SHA-256 清单核查通过，包含 Electron/Chromium、canvas 原生组件、Skia 和字体 OFL。

最新两份桌面 evidence JSON 均记录 `fonts.browserFaces=1`、`browserLoaded=true`、`browserCheck=true`、`nativeIncludesNoto=true`：Chromium 真正加载内置 Noto Sans SC，原生文字引擎也暴露同一字体家族。它们证明本机构建中的字体注册和实际浏览器加载，不证明每个操作系统上的字体行为相同。

首轮：REA CLI 与 MCP 对安装包和本次专用新建草稿进行有限取证；MCP 观察只绑定明确 PID/window、完成后关闭绑定。素材预览及选中三秒时间线样片的证据 ID、截图指纹、推断与未知项见 [REA_FINDINGS.md](research/REA_FINDINGS.md)。未读取既有私人草稿、未解密不透明草稿，也未调用或绕过付费/账号能力。

## 额外桌面回归

新增桌面回归证据：

| 本地证据 | 本机通过时间 | 覆盖 |
| --- | --- | --- |
| `.test-output/storage-electron/evidence.json` | 05:35:43 | 保存快照期间新编辑仍为 dirty、关闭取消、保存最新状态、重启自动恢复、源丢失、重新链接保持同时编辑、保存时切换项目不挂旧路径 |
| `.test-output/audio-electron/evidence.json` | 05:32:39 | MKV 本地代理、UI 分离音频、原视频静音与派生音频可听、源移动后共享引用重新链接、保持 ID/名称/类型/代理、真实导出非重复混音 |
| `.test-output/track-electron/evidence.json` | 05:34:28 | 冻结跨轨拖动几何、重命名/上下移动 App 回调、锁轨及邻锁约束、非空轨删除确认和快捷键阻断、保留素材、一次撤销恢复、竖向滚动后的固定播放头手柄 |
| `.test-output/player-electron/evidence.json` | 05:34:49 | 实际解码预览、松开前实时画面拖动、关键帧路径一起移动、一次撤销、项目末尾保持最终帧 |

音频 evidence 保留实际 GainNode 和 waveform RMS：分离后的原视频 gain=0/RMS=0，派生 audio gain=1/RMS 约0.0603；移动源文件并重新链接后派生音频 RMS 约0.0614，真实输出 RMS 约0.0873。它们证明这次实际播放/导出中声音存在且没有原视频重复叠加，不替代所有音频设备的验证。

`tests/transition-electron.ts` 随后通过实际桌面叠化与导出：已有淡出/裁切窗口的前片段被正确覆盖为叠化，时间线重叠 0.5 秒。中点预览 RGB `[127,0,128]`，真实导出 RGB `[127,0,127]`；混合亮度完整，声音交叉淡化 RMS 为 0.06354，renderer errors 为空。记录见本机 `.test-output/transition-electron/evidence.json`，复现入口为 `npm run test:transition`。

机器可读且去掉本机媒体绝对路径的摘要见 [validation-summary.json](validation-summary.json)。

## 首轮 v0.1 打包与未覆盖边界

最终 macOS 安装包验收已完成：

- 生成 `release/ReaCut-0.1.0-arm64.dmg` 与 `release/ReaCut-0.1.0-arm64-mac.zip`。`hdiutil verify` 为 VALID；镜像以只读方式挂载并验证 CRC；`unzip -tq` 无错误。
- 从最终 DMG 复制 `.app` 到 `.test-output/dmg-installed/ReaCut.app`，严格签名校验 exit 0。本地签名为 **ad-hoc**，不是 Apple Developer ID，也未公证。
- 源 `.app` 与 DMG 复制版本的 `app.asar` SHA-256 完全一致：`6081e40acda576b6172a9ca36ea8f62c24ac00035985c51234c4c26faa80094b`。ASAR 包清单有 4,023 项；六份预期 notices 资源存在，未含 `.research`、测试、demo 私有路径或 electron-builder 开发构建文件。
- `.test-output/package-electron/evidence.json` 最新为 **05:39:11 通过**，`errors=[]`，`packaged=true`。测试执行最终 DMG 复制的真正可执行文件，并使用独立 cwd/用户目录，验证 Noto 浏览器真实加载与原生注册、native canvas、隔离桥接、启动 `.reacut` 参数、13 个片段、景观/缩略图预览和 UI 发起的 **1280×720、九秒、含 AAC 混音与中文标题**导出。
- 根代理另验证八步键盘调整时间线高度、右侧属性仍在 viewport 内，并检查最终 [演示编辑器截图](screenshots/demo-editor.png) 的四轨与三栏完整可见。文件关联测试在此只宣称启动 `.reacut` 参数实际生效，没有扩展为所有 Finder 注册状态已覆盖。

以下边界仍保留：
- **Windows/Linux 未实测**：代码及 CI matrix 已准备，但本机 macOS 成功不等于这些系统的运行、打包或字体结果。
- **GitHub CI 尚未运行**：workflow 使用官方 checkout/setup-node/upload-artifact v7、只读权限，package job 上传 DMG/ZIP；没有发布仓库或远程执行成功证据。
- Developer ID 发行签名、公证、自动更新、云同步、SaaS、账号、API AI 未实现；浏览器单独模式不具备完整桌面文件桥接与导出。
- 大项目、长时间编辑、异常断电、全部媒体格式、专业 HDR/颜色管理以及所有商业剪映功能尚未验证或实现。
- 草稿导入的第二轮已验证本机受控不透明载荷；仍不证明所有剪映版本或完整效果兼容，详见 [CAPCUT_INTEROP.md](CAPCUT_INTEROP.md)。

## 开发依赖审计

本机 `.test-output/npm-audit-production.json` 的 npm production tree 已报告 **0 项已知 advisory**。完整 `.test-output/npm-audit.json` 报告 **8 个 moderate 开发依赖条目**，均由 `sprintf-js` 的 [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) 拒绝服务 advisory 经 `roarr → global-agent → @electron/get → electron-builder` 等构建链传递，包含 `app-builder-lib`、`dmg-builder` 和 Windows installer 构建组件。它们不是八个独立 advisory。

该链属于构建/下载工具，不是本项目 production npm 依赖，也不随编辑器的运行时 npm 模块分发；不能因此把开发依赖报告写成零。当前使用 electron-builder 26.15.3，开发依赖报告保留供后续依赖维护。npm audit 只反映当时 registry 数据和 npm 依赖图，不覆盖系统 FFmpeg、全部 Electron/Chromium 原生代码或未知漏洞。

## 复现命令

```sh
npm ci
npm run check
npm run test:timeline
npm run test:desktop
npm run test:visual
npm run test:storage
npm run test:player
npm run test:audio
npm run test:tracks
npm run test:subtitles
npm run test:portable
npm run test:source
npm run test:workspace
npm run test:transition
npm run test:capcut
npm run licenses
npm run demo
npm run dist:mac:installer
npm run test:package
```

执行结果以各次真实输出及生成的 `.test-output/` 记录为准。后续重新构建应重新运行 package smoke 并更新指纹；跨平台结果只有在对应环境实际执行后追加，不把命令或配置存在写成已通过。
