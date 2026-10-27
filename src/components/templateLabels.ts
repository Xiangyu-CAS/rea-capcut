import type { ProjectTemplate } from "../core/projectTemplates";
import type { Language } from "../i18n";
import { LIBRARY_ENGLISH } from "./libraryLabels";

export const TEMPLATE_NAMES: Readonly<Record<string, string>> = {
  promo: "Product promo · Three scenes",
  talk: "Talking head · Key points",
  gallery: "Photo story · Travel journal",
};
const textByExample: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  promo: {
    "新品宣传 · 三段节奏": TEMPLATE_NAMES.promo,
    "让灵感发生": "Let inspiration happen",
    "用画面讲述你的故事": "Tell your story through pictures",
    "本地剪辑 · 自由创作": "Edit locally · Create freely",
  },
  talk: {
    "口播字幕 · 要点讲解": TEMPLATE_NAMES.talk,
    "第一步：导入你的口播视频": "Step 1: Import your talking-head video",
    "第二步：替换每段字幕文案": "Step 2: Replace each subtitle",
    "第三步：调整节奏并导出": "Step 3: Adjust the pacing and export",
    "本地创作课堂": "Local editing workshop",
    "栏目角标": "Corner label",
  },
  gallery: {
    "图文展示 · 旅行手记": TEMPLATE_NAMES.gallery,
    "记录沿途的光": "Capture the light along the way",
    "收藏生活的颜色": "Collect the colors of life",
    "下一站，继续出发": "Next stop, a new adventure",
  },
};
const common: Readonly<Record<string, string>> = {
  "文字": "Text", "视频 1": "Video 1", "音频 1": "Audio 1", "默认文本": "Default text",
  "午夜渐层": LIBRARY_ENGLISH["午夜渐层"], "薄荷流光": LIBRARY_ENGLISH["薄荷流光"],
  "蓝紫轨道": LIBRARY_ENGLISH["蓝紫轨道"], "深色坐标网格": LIBRARY_ENGLISH["深色坐标网格"],
  "暖白纸纹": LIBRARY_ENGLISH["暖白纸纹"], "日出珊瑚": LIBRARY_ENGLISH["日出珊瑚"],
  "海蓝波浪": LIBRARY_ENGLISH["海蓝波浪"],
};

/** Only a newly instantiated, explicitly built-in example is eligible. Saved or
 * imported templates must not be translated, even if their names match ours. */
export function localizeBuiltinTemplate(
  template: ProjectTemplate,
  builtinId: string | undefined,
  language: Language,
): ProjectTemplate {
  const phrases = builtinId ? textByExample[builtinId] : undefined;
  if (language === "zh-CN" || !phrases) return template;
  const result = structuredClone(template);
  const label = (value: string) => phrases[value] ?? common[value] ?? value;
  result.name = label(result.name);
  const copyName = template.name + " · 副本";
  result.project.name = result.project.name === copyName
    ? result.name + " · Copy"
    : label(result.project.name);
  result.project.tracks.forEach(track => { track.name = label(track.name); });
  result.project.assets.forEach(asset => { asset.name = label(asset.name); });
  result.project.clips.forEach(clip => {
    clip.name = label(clip.name);
    if (clip.text) clip.text.text = label(clip.text.text);
  });
  result.slots.forEach(slot => { slot.label = label(slot.label); });
  return result;
}
