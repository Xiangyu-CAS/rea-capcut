/** Original ReaCut assets. Files are generated locally by scripts/generate-assets.ts. */
export type BuiltinAssetCategory = "stickers" | "backgrounds" | "titles" | "sounds";
export interface BuiltinAsset {
  id: string;
  name: string;
  category: BuiltinAssetCategory;
  kind: "image" | "audio";
  fileName: string;
  width: number;
  height: number;
  duration: number;
  tags: string[];
  transparent: boolean;
}
const image = (id: string, name: string, category: Exclude<BuiltinAssetCategory, "sounds">, tags: string[]): BuiltinAsset => ({
  id, name, category, kind: "image", fileName: `${id}.png`,
  width: category === "stickers" ? 512 : 1920,
  height: category === "stickers" ? 512 : 1080,
  duration: 5, tags, transparent: category !== "backgrounds",
});
const sound = (id: string, name: string, duration: number, tags: string[]): BuiltinAsset => ({
  id, name, category: "sounds", kind: "audio", fileName: `${id}.wav`,
  width: 0, height: 0, duration, tags, transparent: false,
});
export const BUILTIN_ASSETS: readonly BuiltinAsset[] = [
  image("sparkle", "四角星光", "stickers", ["星星", "闪耀", "sparkle"]),
  image("burst", "活力爆炸贴", "stickers", ["爆炸", "强调", "burst"]),
  image("heart", "珊瑚爱心", "stickers", ["爱心", "喜欢", "heart"]),
  image("arrow-curved", "手绘转弯箭头", "stickers", ["箭头", "指引", "arrow"]),
  image("arrow-left", "向左倒带", "stickers", ["倒带", "箭头", "reverse"]),
  image("play", "薄荷播放键", "stickers", ["播放", "视频", "play"]),
  image("check", "完成勾选", "stickers", ["成功", "完成", "check"]),
  image("pin", "旅行定位", "stickers", ["旅行", "位置", "pin"]),
  image("speech", "对话气泡", "stickers", ["对话", "文字", "speech"]),
  image("quote", "引用符号", "stickers", ["采访", "引用", "quote"]),
  image("film", "迷你胶片", "stickers", ["电影", "胶片", "film"]),
  image("clap", "开拍场记板", "stickers", ["场记", "电影", "clap"]),
  image("sun", "日光小太阳", "stickers", ["天气", "阳光", "sun"]),
  image("rainbow", "柔彩彩虹", "stickers", ["彩虹", "生活", "rainbow"]),
  image("confetti", "庆祝纸屑", "stickers", ["庆祝", "节日", "confetti"]),
  image("focus", "取景框", "stickers", ["镜头", "对焦", "focus"]),
  image("bg-midnight", "午夜渐层", "backgrounds", ["深蓝", "渐变", "dark"]),
  image("bg-sunrise", "日出珊瑚", "backgrounds", ["暖色", "渐变", "warm"]),
  image("bg-mint", "薄荷流光", "backgrounds", ["清新", "绿色", "mint"]),
  image("bg-paper", "暖白纸纹", "backgrounds", ["纸张", "极简", "paper"]),
  image("bg-grid", "深色坐标网格", "backgrounds", ["科技", "网格", "grid"]),
  image("bg-orbit", "蓝紫轨道", "backgrounds", ["科技", "圆环", "orbit"]),
  image("title-mint", "薄荷人物条", "titles", ["人物", "下三分之一", "采访"]),
  image("title-coral", "珊瑚字幕条", "titles", ["字幕", "下三分之一", "标题"]),
  image("title-glass", "深色信息卡", "titles", ["信息", "卡片", "标题"]),
  image("title-frame", "电影细线边框", "titles", ["边框", "电影", "标题"]),
  image("title-corner", "角标与侧栏", "titles", ["角标", "栏目", "标题"]),
  image("title-ribbon", "重点飘带", "titles", ["重点", "飘带", "标题"]),
  sound("sound-pop", "轻快气泡", 0.25, ["气泡", "转场", "pop"]),
  sound("sound-click", "柔和点按", 0.12, ["点击", "界面", "click"]),
  sound("sound-chime", "清亮提示", 1.2, ["铃声", "提示", "chime"]),
  sound("sound-rise", "向上滑音", 0.65, ["上升", "转场", "rise"]),
  sound("sound-whoosh", "空气掠过", 0.8, ["掠过", "转场", "whoosh"]),
  sound("sound-complete", "完成三音", 1.4, ["成功", "完成", "complete"]),
];
export const BUILTIN_CATEGORIES: { id: BuiltinAssetCategory; name: string }[] = [
  { id: "stickers", name: "贴纸" }, { id: "backgrounds", name: "背景" },
  { id: "titles", name: "标题底板" }, { id: "sounds", name: "音效" },
];
export function findBuiltinAsset(id: string): BuiltinAsset | undefined {
  return BUILTIN_ASSETS.find((asset) => asset.id === id);
}
export function filterBuiltinAssets(category: BuiltinAssetCategory | "all", query: string): BuiltinAsset[] {
  const text = query.trim().toLocaleLowerCase();
  return BUILTIN_ASSETS.filter((asset) => (category === "all" || asset.category === category) &&
    `${asset.name} ${asset.tags.join(" ")}`.toLocaleLowerCase().includes(text));
}
export function builtinAssetUrl(asset: BuiltinAsset): string {
  return `${import.meta.env.BASE_URL}builtin-assets/${asset.fileName}`;
}
