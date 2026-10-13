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
  image("bolt", "闪电强调", "stickers", ["闪电", "能量", "bolt"]),
  image("cloud", "绵软云朵", "stickers", ["天气", "天空", "cloud"]),
  image("moon", "月夜星辰", "stickers", ["月亮", "夜晚", "moon"]),
  image("leaf", "新芽绿叶", "stickers", ["植物", "自然", "leaf"]),
  image("flame", "热力火苗", "stickers", ["火焰", "热门", "flame"]),
  image("camera", "旅行相机", "stickers", ["摄影", "旅行", "camera"]),
  image("headphones", "随身耳机", "stickers", ["音乐", "聆听", "headphones"]),
  image("microphone", "播客话筒", "stickers", ["录音", "采访", "microphone"]),
  image("coffee", "咖啡时刻", "stickers", ["生活", "饮品", "coffee"]),
  image("paw", "萌宠脚印", "stickers", ["动物", "宠物", "paw"]),
  image("medal", "高光奖章", "stickers", ["奖励", "成就", "medal"]),
  image("clock", "时间提醒", "stickers", ["时钟", "倒计时", "clock"]),
  image("bg-aurora", "极光夜幕", "backgrounds", ["极光", "夜景", "aurora"]),
  image("bg-ocean", "海蓝波浪", "backgrounds", ["海洋", "蓝色", "ocean"]),
  image("bg-lavender", "薰衣草光晕", "backgrounds", ["紫色", "梦幻", "lavender"]),
  image("bg-peach", "蜜桃几何", "backgrounds", ["粉色", "几何", "peach"]),
  image("bg-sand", "大漠沙丘", "backgrounds", ["沙漠", "自然", "sand"]),
  image("bg-dots", "奶油波点", "backgrounds", ["波点", "可爱", "dots"]),
  image("bg-blueprint", "工程蓝图", "backgrounds", ["蓝图", "科技", "blueprint"]),
  image("bg-comic", "漫画放射", "backgrounds", ["漫画", "强调", "comic"]),
  image("title-pill", "圆角姓名牌", "titles", ["人物", "圆角", "pill"]),
  image("title-news", "资讯双层条", "titles", ["资讯", "新闻", "news"]),
  image("title-split", "双色章节卡", "titles", ["章节", "分屏", "split"]),
  image("title-subtitle", "柔暗字幕底", "titles", ["字幕", "渐变", "subtitle"]),
  image("title-tape", "便签胶带", "titles", ["手账", "胶带", "tape"]),
  image("title-chapter", "极简章节线", "titles", ["章节", "极简", "chapter"]),
  sound("sound-shutter", "电子快门", 0.22, ["摄影", "快门", "shutter"]),
  sound("sound-impact", "低频强调", 0.5, ["鼓点", "强调", "impact"]),
  sound("sound-twinkle", "星点提示", 1.5, ["提示", "星光", "twinkle"]),
  sound("sound-fall", "向下滑音", 0.65, ["下降", "转场", "fall"]),
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
