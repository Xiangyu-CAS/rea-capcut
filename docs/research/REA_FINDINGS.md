# 剪映 macOS：独立实现的取证记录

本页保留首轮观察；草稿解码、调用链与受控导出的新结论见 [第二轮报告](DRAFT_FORMAT_ROUND2.md)，下文“未解码”等状态指首轮当时的边界。

调查日期：2026-10-13（Asia/Shanghai）。目标：`/Applications/VideoFusion-macOS.app`，`com.lemon.lvpro`，`CFBundleShortVersionString=11.0.12922`，`CFBundleVersion=11.1.0-beta3`。目标是记录行为和数据模型线索，指导自主实现；不将剪映源代码、二进制、图标、字体或模板素材加入开源产品。

## Evidence 索引

| ID | 来源、边界 | 证据类型 | 保存位置 |
| --- | --- | --- | --- |
| `ev_4d96321be94ace4c66327aae2b2b4b85c451ccc7715184016221868a86b4fd4e` | REA 6.4.0 `inspect-artifact`；整个已安装 app 目录 | shipped-artifact，静态包 inventory | `.research/evidence/rea-artifact.json`（扩展名为 json，内容实际为 CLI TOON） |
| `ev_39a244b8a17ae7ea0995c8fca9dd2dbed1269953dd7d6e956e96a8cf7b5b2649` | 上述 inspection 的 `inventory_artifact` 子步骤 | 静态包 graph | 同上 |
| `agm_ffc5574cc4d3ebed49d4f8a82825f8fda8435fb6185663707b0a6d6650634791` | REA graph manifest | 4,610 nodes、6,537 occurrences、6,335 edges | 同上 |
| `ev_53fbb85e7d8aea3467e3957a4f5527ba926599e3391c706023d7335a823cc7e8` | REA `observe-native-ui`；已运行 PID 88567、明确 window 8230，未提供操作 steps | 运行时窗口截图/AX tree | `.research/evidence/rea-native-ui-editor.json`、`.png` |
| `ev_25f346811fe7ba3c1f873a283bd562e989acda7bf13b5b9fc06ed18729733a87` | REA MCP `observe_native_ui`; PID 88567/window 8230, 1280x720 pixels, 77 AX nodes, no steps | Runtime observation: synthetic media preview with empty timeline | MCP retained Evidence; screenshot SHA-256 `8c6183ff9ac894a10f20472a853367256b45ba8c52dccfcfc5e4f64bcbbe1027` |
| `ev_fb4bec800eef26b4b0e58f1202a0b52b5b46dec3970fb5784740916491ca3981` | REA MCP `observe_native_ui`; PID 88567/window 8230, no steps, selected controlled three-second clip in 时间线02 | Runtime observation: timeline clip, transform handles and properties | MCP retained Evidence; screenshot SHA-256 `e0af3115ce35189a7f60f7a34bd306b6f3ff47530ad4e280d1f21cc0731d6d98` |
| `LOCAL-DRAFT-001` | Only authorized new test draft 10月13日: file names, sizes, digests and JSON parseability | Local file observation, no decoding/decryption | `.research/evidence/test-draft-inventory.json` |
| `LOCAL-INV-001` | `Contents` 目录普通文件与 Info.plist，4,827 个文件；本地补充清单，计数方法不同于 REA graph | 原文件元数据观察 | `.research/evidence/local-inventory.json` |
| `LOCAL-STR-001` | `Contents/Frameworks/libvideoeditor.dylib`；10 个指定 literal，每项最多 40 条字符串 | 字符串存在证据，无执行 | `.research/evidence/native-model-strings.json` |
| `LOCAL-STR-002` | 同一 dylib；8 个指定 JSON literal，每项最多 5 处、每处最多 23 行上下文 | 嵌入式 schema/示例文本观察，无执行 | `.research/evidence/model-contexts.json` |
| `LOCAL-STR-003` | 同一 dylib；20 个指定功能 literal，每项最多 20 条、单行小于 400 字符 | 字符串存在证据，无执行 | `.research/evidence/feature-strings.json` |

REA 根目录 SHA-256：`c2bf999306e3e4416f08e6233b9cbe7e86f499663b7cac9e9b07ff6053770022`。REA provider：`rea-artifact-graph` v1。CLI 使用隔离 `npx -y -p node@24 -p rea-agents@6.4.0 rea ...`；没有修改 REA 工具源或用户 MCP 配置。包 inspection 明确限制：没有执行 app，没有完成格式特定的语义分析。其 `complete-within-substeps` 只描述包 inventory 子步骤，不表示本调查覆盖完整。

## 已观察事实

1. **包的结构**：包含 Qt Core/Qml/Quick、Chromium Embedded Framework、`libvideoeditor.dylib`、`libVECreator.dylib`、`libavcodec.dylib` 与 `libonnxruntime`。资源含 Qt QML、Lua、shader/Metal、JSON 配置，且包含独立的 H5 文本模板发布、智能文稿、导出发布页面。证据：REA inventory/manifest，`LOCAL-INV-001`。这只能确认组件存在，不能由此认定调用路径、授权策略或算法能力。
2. **项目/草稿命名线索**：静态字符串中有 `draft_content.json`、`draft_info.json`、`material_id`、`source_timerange`、`target_timerange`、`canvas_config`。证据：`LOCAL-STR-001`。未读取用户已有私人草稿；只检查本次专用新建测试草稿。
3. **时间线结构线索**：嵌入式 JSON 示例包含项目 `fps`、`duration`、`canvas_config`、`tracks`；track 中含 `id`、`attribute`、`segments`；配置含 `video_mute`、`maintrack_adsorb`、`export_range`。画布配置示例包含 `width`、`height`、`ratio`、`background`。证据：`LOCAL-STR-002`。这不是已经验证的外部文件格式规范。
4. **时间单位线索**：schema 字符串中存在 `duration*1000000`、`audio_effect.duration*1000000`、`int64_t`。证据：`LOCAL-STR-002`。该字段的微秒推断需用专门测试草稿验证，不能扩展成“所有时间字段均为微秒”的事实。
5. **编辑功能线索**：存在 `common_keyframes`、`audio_fades`、`blend_mode`、`crop`、`subtitle_sync` 和 export_audio 相关符号；包含混合、色彩曲线、色度抠像、模糊、变形等效果资源。证据：`LOCAL-STR-003` 和 inventory。存在不等于 UI 可用或已验证执行。

6. **编辑器运行时布局**：空项目编辑器顶栏为素材、音频、文本、贴纸、特效、转场、字幕、智能包装、滤镜；上半区左素材库、中播放器、右草稿参数，下半区时间线。该新建空项目显示导入方式为保留在原有位置、自由层级已开启，磁吸/素材混排/代理模式未开启。证据：`ev_53fbb85e7d8aea3467e3957a4f5527ba926599e3391c706023d7335a823cc7e8` 的截图。AX tree 只覆盖少量素材菜单标签，不能据其空文本推断控件不存在。

7. **专用测试草稿文件**：`LOCAL-DRAFT-001` 显示根目录与 timeline 下 `draft_info.json` 的 1,176 字节载荷不是可解析的 JSON，两份 SHA-256 相同；同时有可解析 `timeline_layout.json`、`Timelines/project.json` 和 `template.tmp`。这只证明测试时的载荷形态，不能由不可解析 JSON 直接认定特定加密算法，也不能推导支持该 11.0 草稿格式。未尝试解密或访问控制绕过。
8. **素材预览与时间线分离**：REA MCP 证据 `ev_25f346811fe7ba3c1f873a283bd562e989acda7bf13b5b9fc06ed18729733a87` 只观察已有窗口：自生成 `rea-test.mp4` 已出现在素材库并被选中，中央素材预览显示彩条测试画面及三秒片长；时间线仍提示拖入素材，尚未添加片段。该图证明素材库预览可发生在空时间线上，未验证时间线播放、变速或导出。应用时间栏不作为系统时钟证据。

9. **专用样片时间线与选中属性**：父代理使用 CUA 对本次自造素材执行右键“根据选中素材新建时间线”后，REA MCP 被动观察证据 `ev_fb4bec800eef26b4b0e58f1202a0b52b5b46dec3970fb5784740916491ca3981` 显示“时间线02”激活，零时刻开始的 `rea-test.mp4` 片段显示三秒时长，素材缩略图标注“已添加”。中央预览有四角/边缘变换控制点；右侧有画面、音频、变速、动画、调整、AI效果标签，画面内有基础、抠像、蒙版、美颜美体子标签。当前基础面板显示缩放 100%、等比缩放开启、位置 X/Y 0、旋转 0.00°、圆角 0，以及关键帧菱形。AX 返回 135 个节点（含窗口，未截断），可读值包括基础/抠像/蒙版/美颜美体/等比缩放，其余值以截图为证。只观察状态，未操作这些参数，也未验证特定抠像、变速或 AI 能力。

## 实现推断与自主设计

- **推断（中等置信）**：剪映项目将引用素材的 segment 放入 track，并分别记录源素材时间和目标时间线时间。依据：`source_timerange`、`target_timerange`、`material_id` 的字符串及嵌入 schema。尚未动态验证变速、倒放、转场与特殊 track 的具体计算关系。
- **自主设计**：开源实现使用自己的版本化项目格式，当前 `version: 1`、媒体库、轨道、片段、画布、字幕。当前在整个内核固定使用秒；为导出编译为 FFmpeg filter graph。无需复制剪映字段或承诺剪映草稿兼容。
- **自主设计**：片段拥有 `sourceIn`、`duration`、`start`、`speed`；输出时长为源时长除以 speed。视频/图片轨支持 transform、透明度和基础色彩；裁切暂未作为已完成能力；音轨支持 gain、淡入淡出；标题/字幕使用自己定义的文字与样式。
- **范围更新**：用户已澄清 SaaS 与 AI API 能力均先留白，本期只实现客户端可以完成的功能。本地项目保存在用户选择的位置，不宣称云同步。

## 问题清单与未决项

| 原问题 | 状态 | 下一条有价值的证据 |
| --- | --- | --- |
| 目标身份与技术组件 | 已回答（包级） | 无需重复 inventory |
| 新草稿文件结构、时间单位、素材引用 | 部分回答：专用草稿的 `draft_info.json` 不透明，不能验证 classic schema | 未进行解密；classic 导入器只用合成数据测试，不能宣称当前 11.0 草稿兼容 |
| 标准编辑器布局与菜单 | 已回答（空项目及自造样片选中布局） | 字幕、导出状态仍需独立运行时观察 |
| 字幕编辑/导入/导出语义 | 部分回答 | 只针对测试草稿的 SRT 操作和时间线观察 |
| 变速、音量、效果的保存与导出一致性 | 未解决 | 只针对自造样片执行与导出对比 |
| 剪映的完整 native 调用图、AI 算法与付费资源 | 未解决，不作为自主实现依赖 | 若将来需要，针对具体边界再分析 |
| 所有商业剪映功能一比一兼容 | 未解决 | 本次不存在完整覆盖证据，不可宣称 |

原始证据目录由仓库忽略，只共享本报告中的行为/结构结论。未启动 Hopper 反编译会话。后续 MCP 只绑定目标 Mach-O、采集已运行窗口，完成后调用 `close_binary` 关闭绑定。首次缺少 PID/window-id 的 REA `observe-native-ui` 请求被 schema 拒绝；之后只读 CoreGraphics 定位明确 PID/window-id，成功被动采集主编辑器窗口，没有通过 REA 执行 UI 操作。

实现验证与逆向证据分开记录：核心模型测试验证自主实现的 split/trim/speed、轨道锁、历史快照和插值窗口；导入测试使用合成的 classic JSON。这些测试不增加剪映运行时行为或当前草稿兼容性的覆盖。
