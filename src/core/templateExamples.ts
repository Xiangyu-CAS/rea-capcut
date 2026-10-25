import { createClip, createProject, createTrack, id } from "./model";
import { defaultTemplate } from "./projectTemplates";
import { subtitleAnimation } from "./subtitleWorkflow";
import type { MediaAsset } from "./types";
export const TEMPLATE_EXAMPLES = [
  {
    id: "promo",
    name: "新品宣传 · 三段节奏",
    background: "bg-midnight",
    media: ["bg-midnight", "bg-mint", "bg-orbit"],
    description: "12 秒横屏宣传片，三段画面与标题，适合换成产品视频。",
  },
  {
    id: "talk",
    name: "口播字幕 · 要点讲解",
    background: "bg-grid",
    media: ["bg-grid"],
    description:
      "12 秒口播版式，三段字幕与角标；将主画面替换为自己的口播视频。",
  },
  {
    id: "gallery",
    name: "图文展示 · 旅行手记",
    background: "bg-paper",
    media: ["bg-paper", "bg-sunrise", "bg-ocean"],
    description: "12 秒图文展示，三段画面与文案，保留独立可调的推近动画。",
  },
] as const;
export function buildTemplateExample(key: string, assets: MediaAsset[]) {
  const def = TEMPLATE_EXAMPLES.find((d) => d.id === key);
  if (!def || assets.length !== def.media.length)
    throw new Error("原创示例不存在或素材不完整");
  const p = createProject(def.name);
  p.width = 640;
  p.height = 360;
  p.assets = assets;
  const video = p.tracks.find((t) => t.kind === "video")!,
    text = p.tracks[0];
  const messages =
    key === "promo"
      ? ["让灵感发生", "用画面讲述你的故事", "本地剪辑 · 自由创作"]
      : key === "talk"
        ? [
            "第一步：导入你的口播视频",
            "第二步：替换每段字幕文案",
            "第三步：调整节奏并导出",
          ]
        : ["记录沿途的光", "收藏生活的颜色", "下一站，继续出发"];
  for (let i = 0; i < assets.length; i++) {
    const c = createClip(
      assets[i],
      video.id,
      key === "talk" ? 0 : i * 4,
      p.fps,
    );
    c.duration = key === "talk" ? 12 : 4;
    if (key === "gallery")
      c.keyframes = [
        { id: id(), property: "scale", time: 0, value: 1, easing: "linear" },
        {
          id: id(),
          property: "scale",
          time: 4,
          value: 1.08,
          easing: "easeInOut",
        },
      ];
    p.clips.push(c);
  }
  for (let i = 0; i < 3; i++) {
    let c = createClip(undefined, text.id, i * 4, p.fps);
    c.duration = 4;
    c.text = {
      ...c.text!,
      text: messages[i],
      fontSize: key === "talk" ? 26 : 32,
      background: "#101015cc",
      strokeWidth: 0,
    };
    c.transform.y = key === "talk" ? 110 : 65;
    c = subtitleAnimation(
      c,
      {
        entrance: "slide-up",
        exit: "fade",
        inDuration: 0.4,
        outDuration: 0.4,
        distance: 18,
        hold: "still",
      },
      p.fps,
    );
    p.clips.push(c);
  }
  if (key === "talk") {
    const track = createTrack("text", "栏目角标");
    p.tracks.unshift(track);
    const c = createClip(undefined, track.id, 0, p.fps);
    c.duration = 12;
    c.text = {
      ...c.text!,
      text: "本地创作课堂",
      fontSize: 20,
      color: "#40ead3",
      strokeWidth: 0,
    };
    c.transform.y = -140;
    p.clips.push(c);
  }
  return defaultTemplate(p);
}
