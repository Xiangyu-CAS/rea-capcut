# 本机验证记录

日期：2026-10-13，Asia/Shanghai。本记录只描述 ReaCut 独立实现的本机证据，不证明与商业剪映完整对等，也不把剪映静态字符串、测试脚本或构建配置当成已执行的功能。

## 环境与执行范围

本机为 macOS arm64；Node.js `26.11.1`、Electron `44.7.0`、Vitest `5.0.4`、electron-builder `26.15.3`。系统 FFmpeg 为 `9.0.2`，独立进程调用，不随应用分发。应用源码统一格式化后，在本机通过 TypeScript 检查与 Vite/Electron 编译；最新完整测试记录为 05:28:34。独立 `.test-output/fresh-install/` 执行 `npm ci` 安装 405 个包成功，并实际检查 native canvas、esbuild 与 Electron 可用，不能只以原有 node_modules 成功代替干净安装。

当前 Vitest 配置只收集 `tests/**/*.test.ts`，排除 `.research/` 与构建目录。根代理记录的 `npm test` 结果为 **104 项通过、9 个测试文件通过**；本机 Vitest 缓存中对应九个 `tests/` 文件也均为未失败。旧缓存可能保留更早扫描研究工具时的条目，这些条目不属于当前 ReaCut 测试范围。

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

REA CLI 与 MCP 对安装包和本次专用新建草稿进行有限取证；MCP 观察只绑定明确 PID/window、完成后关闭绑定。素材预览及选中三秒时间线样片的证据 ID、截图指纹、推断与未知项见 [REA_FINDINGS.md](research/REA_FINDINGS.md)。未读取既有私人草稿、未解密不透明草稿，也未调用或绕过付费/账号能力。

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

## 打包与未覆盖边界

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
- classic 导入只验证合成的明文 schema。本机剪映 11.0 专用草稿载荷不透明，不支持且未尝试破解；详见 [CAPCUT_INTEROP.md](CAPCUT_INTEROP.md)。

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
npm run test:transition
npm run licenses
npm run demo
npm run dist:mac:installer
npm run test:package
```

执行结果以各次真实输出及生成的 `.test-output/` 记录为准。后续重新构建应重新运行 package smoke 并更新指纹；跨平台结果只有在对应环境实际执行后追加，不把命令或配置存在写成已通过。
