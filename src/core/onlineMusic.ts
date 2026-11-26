export interface MusicCredit {
  title: string;
  creator: string;
  sourceUrl: string;
  license: "CC BY" | "CC0";
  licenseUrl: string;
}
export interface MusicResult extends MusicCredit {
  id: string;
  provider: "Incompetech" | "Openverse";
  duration: number;
  downloadable: boolean;
}
export interface MusicSearchResult {
  tracks: MusicResult[];
  openverse: "ok" | "unavailable" | "limited";
  incompetech: boolean;
}

export function musicCreditLine(credit: MusicCredit) {
  return `“${credit.title}” — ${credit.creator} · ${credit.license} (${credit.licenseUrl}) · ${credit.sourceUrl}`;
}

// Explicit music-only requests go through local search without sending project context to an AI.
export function musicPromptQuery(value: string): string | undefined {
  const text = value.trim().replace(/[。!?！？.]+$/, "");
  if (/[，,；;\n]|而且|并且|\band\s+(?:add|cut|trim|remove|translate|make|export|generate)\b/i.test(text)) return;
  if (/移除|删|去掉|提取|替换|关闭|清除|保留|调整|降低|降|提高|不需要|不要|如何|怎么/.test(text)) return;
  const chineseEnding = /(?:背景音乐|配乐|BGM)$/i.exec(text);
  if (chineseEnding && /[\p{Script=Han}]/u.test(text) &&
      /^(?:请|帮我|给|为|加|添加|增加|找|挑|选|推荐|用|配乐|背景音乐|BGM)/i.test(text)) {
    let query = text.slice(0, chineseEnding.index);
    for (let i = 0; i < 8; i++) {
      const remaining = query.replace(/^(?:请|帮我|给(?:这个视频|这段视频|当前视频|视频|这段|我)|为(?:这段视频|当前视频|视频)|加上|添加|增加|推荐|找一下|找点|找一首|找|挑|选|加|用|一段|一首|一个|些|适合的|合适的|合适|在线|免费的|免费)/, "");
      if (remaining === query) break;
      query = remaining;
    }
    return query.trim().slice(0, 120);
  }
  if (/^(?:background music|bgm)$/i.test(text)) return "";
  const english = /^(?:please\s+)?(?:add|find|recommend|search for)\s+(?:me\s+)?(?:some\s+|a\s+|an\s+)?(.{0,80}?)(?:background music|soundtrack|bgm)(?:\s+(?:for|to)\s+(?:this|the|my)\s+(?:video|clip|edit|project))?$/i.exec(text);
  return english?.[1].trim();
}
