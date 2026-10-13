# 内置媒体工具

macOS v0.2.1 安装包自带 FFmpeg 与 FFprobe，无需 Homebrew、系统 FFmpeg 或剪映。它们位于应用的 `Contents/Resources/media-tools/`，作为独立子进程运行。设置中选择的自定义工具或 `REACUT_FFMPEG` / `REACUT_FFPROBE` 环境变量优先；没有覆盖时使用内置工具。内置文件缺失会明确报错，不悄悄使用开发机环境。

## 来源和许可

固定使用 FFmpeg 9.0.2 与 x264 `b35605ace3ddf7c1a5d67a2eb553f034aef41d55` 的官方源码，不修改上游源码。通过 `--enable-gpl --enable-libx264` 构建，所以媒体工具采用 GPL-2.0-or-later；对应源码、原始许可、构建脚本和清单随每个安装包一起提供。ReaCut 自行编写的代码保留 MIT 许可。详情见 [第三方声明](../THIRD_PARTY_NOTICES.md) 和 [FFmpeg 上游许可说明](https://ffmpeg.org/legal.html)。

构建没有启用 `nonfree`。第三方编解码库静态链接，运行依赖仅为 macOS 系统库/框架。网络协议在内置构建中关闭；应用原有的本地文件协议限制仍保留。支持当前 H.264/AAC 导出与经测试的本地媒体处理；未包含 x265 编码器，但已实际验证 HEVC 解码和 H.264 代理生成。

## 重建

在原生 macOS 主机安装 Xcode 命令行工具和项目所需 Node.js 后：

```sh
npm ci
npm run media:build
npm run dist:mac:installer
```

首次下载并校验固定源码，构建隔离的 pkgconf、x264 和 FFmpeg。pkgconf 仅为构建工具，也提供其源码。下载缓存和中间文件位于忽略的 `.media-build/`，最终媒体资源位于忽略的 `media-tools/darwin-<arch>/`。打包钩子自动运行相同校验/构建，避免遗漏资源；不支持跨架构打包。当前只验收了 arm64；x64 构建还需要 NASM，尚未运行验证。

所有上游源码归档、下载 URL、SHA-256、编译参数和许可证路径都在包内 `manifest.json` / `sources/` / `licenses/` 中。仓库留有脱敏的 [构建清单](media-tools-build.json)。清单的 `buildSHA256` 是签名前的指纹，应用签名可能改变可执行文件字节；最终签名后指纹另记录于 [验证摘要](validation-summary.json)。

源码开发仍可使用系统安装的工具；Windows/Linux 安装包尚未集成对应平台媒体工具。不要将本机 macOS 的验证外推至这些平台。
