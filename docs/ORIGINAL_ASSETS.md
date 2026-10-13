# 原创离线素材

本地素材库包含 34 款由本项目自行绘制或合成的资源，不需要下载或登录：

| 分类 | 数量 | 格式与用途 |
| --- | ---: | --- |
| 贴纸 | 16 | 512 × 512 透明 PNG；星光、箭头、爱心、气泡、电影等图形 |
| 背景 | 6 | 1920 × 1080 不透明 PNG；渐层、网格、抽象图案 |
| 标题底板 | 6 | 1920 × 1080 透明 PNG；下三分之一、边框、角标，另外添加可编辑文字 |
| 短音效 | 6 | 48 kHz / 16-bit 单声道 PCM WAV；点击、滑音、提示、空气声 |

![原创素材联系表](screenshots/original-assets-contact.png)

这些素材从 SVG 几何图形和确定性音频合成生成，未取用第三方视频、照片、录音或其他应用素材。图形的 SVG 源文件与 PNG 一同存放于 `public/builtin-assets/`；应用使用 PNG，避免不同媒体引擎的 SVG 支持差异。透明贴纸和标题底板保存真实 alpha 通道，棋盘格仅是预览界面。

素材沿用项目 MIT 许可，包含完整许可文本，可用于个人与商业视频。`manifest.json` 记录每个文件的尺寸、用途、来源和 SHA-256；生成方法属于 `original-programmatic`，不冒称人工摄影或 AI 图片。声音是合成的短音效，不是音乐曲库。

重建素材：

```sh
npx tsx scripts/generate-assets.ts
npx vitest run tests/builtinAssets.test.ts
```

图标按用户指定的剪映左右镜像方向重新绘制矢量几何：交叉带端点朝左，薄荷青渐变配石墨黑圆角底，折角采用短曲线过渡。源文件为 `public/icons/reacut.svg`，由自主坐标路径生成，不嵌入第三方图标位图；视觉方向参考不构成品牌权利或法律审查结论。重建图标使用 `npm run icons`，生成 macOS ICNS、Windows ICO、Linux PNG 和界面图标 `public/icons/reacut.png`。

素材资源随 Vite 公共文件复制进入构建。桌面添加只允许固定清单内的 ID，由主进程解析本地安装资源后进入普通媒体素材流程；项目保存和导出仍使用正常的授权本地素材路径。
