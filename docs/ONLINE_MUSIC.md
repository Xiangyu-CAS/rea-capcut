# 在线配乐 / Online music

**剪辑 Agent → 推荐配乐**，输入曲名、情绪或乐器并提交。也可在 Agent 输入「帮我给这个视频加上轻快配乐」或 “Find upbeat background music”。单独的配乐请求在本机匹配并打开在线曲目卡片，无需登录 Codex、注册 Openverse 或配置 API Key。搜索仅发送音乐关键词，不发送工程内容或媒体。

- **搜索与试听**：Openverse 提供 CC0 和 CC BY 的广搜索引。索引结果显示来源链接，不把收听地址视为下载授权。Incompetech 的官方 CC BY 4.0 曲库提供可试听、可直接下载的 MP3。试听只按需获取所选曲目，并复用同一文件，不预下载曲库。Openverse 无法连接或返回 429 时依然显示 Incompetech 结果（若可访问）。请在原站核对许可证；ReaCut 并非 Openverse 官方产品。
- **下载并添加**：把曲目保存到本机，并同时加入素材库和当前时间线的独立「背景音乐」轨道。以可见画面区间为目标，无画面时从播放头开始。超过区间的部分会被裁短；短曲不自动循环。默认音量 20%，带淡入淡出，不改原有轨道，可一步撤销。在另一台电脑打开工程时，请使用收集素材功能或重新链接。
- **署名**：保存作品名、作者、来源和许可证；导出面板可复制当前区间的 CC BY 署名到发布说明。不会把署名烧录进视频。

**技术边界**：搜索和下载由受来源校验的 Electron 主进程处理。渲染层仅传关键词或受控结果 ID；不打开来源任意文件链接，不追随下载重定向。只从来源明确提供直下的 MP3 目录取文件，限制大小和超时，完成后才纳入本地素材。在线功能为可选，已下载的本地媒体和其余编辑功能不依赖在线搜索。

来源：[Openverse API](https://api.openverse.org/v1/) · [Openverse 使用条款](https://docs.openverse.org/terms_of_service) · [Incompetech 曲库接口](https://incompetech.com/agent-section/) · [Incompetech 许可](https://incompetech.com/music/royalty-free/licenses/)
