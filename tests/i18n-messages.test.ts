import { afterEach, describe, expect, it } from "vitest";
import { localizeMessage } from "../src/i18n/messages";
import { useLanguageStore } from "../src/i18n/languageStore";

const original = useLanguageStore.getState().language;
afterEach(() => useLanguageStore.setState({ language: original }));

describe("application diagnostic localization", () => {
  it("translates representative media, export, template, caption and assistant messages", () => {
    for (const input of [
      "素材仍被时间线使用，请先删除对应片段", "时间线为空，请添加素材再导出。",
      "请先选择导出位置", "模板名称须为 1–120 字", "请选择至少两条相邻字幕",
      "已取消处理", "CLI 尚未登录或登录已失效。请在终端正常登录所选 CLI，然后重新发送。",
    ]) {
      expect(localizeMessage(input, "en")).not.toMatch(/[\u3400-\u9fff]/);
      expect(localizeMessage(input, "zh-CN")).toBe(input);
    }
  });

  it("retains dynamic user names, text and filenames unchanged", () => {
    expect(localizeMessage("轨道“我的视频”已锁定，请先解锁", "en"))
      .toBe("Track “我的视频” is locked. Unlock it first.");
    expect(localizeMessage("无法导入目录：/tmp/我的素材", "en"))
      .toBe("Cannot import a directory: /tmp/我的素材");
    expect(localizeMessage("占位“开场”至少需要 2.500 秒源素材（包含入点和速度），未应用任何替换", "en"))
      .toContain("“开场” needs at least 2.500 seconds");
    expect(localizeMessage("素材丢失：scene\n第二段.mp4", "en"))
      .toBe("Missing media: scene\n第二段.mp4");
  });

  it("preserves third-party diagnostic details and unrecognized messages", () => {
    expect(localizeMessage("FFmpeg 导出失败：编码器 unknown_codec", "en"))
      .toBe("FFmpeg export failed: 编码器 unknown_codec");
    expect(localizeMessage("我的字幕：时间线为空，请添加素材再导出。", "en"))
      .toBe("我的字幕：时间线为空，请添加素材再导出。");
    expect(localizeMessage("Custom backend error: 42", "en")).toBe("Custom backend error: 42");
    expect(localizeMessage("toString", "en")).toBe("toString");
  });

  it("translates IPC wrappers without dropping operation or nested details", () => {
    expect(localizeMessage("Error: Error invoking remote method 'project:save': Error: 模板文件过大", "en"))
      .toBe("Error: Error invoking remote method 'project:save': Error: The template file is too large.");
  });

  it("updates with the active language and uses English for missing Turkish messages", () => {
    useLanguageStore.setState({ language: "en" });
    expect(localizeMessage("正在检查素材")).toBe("Checking media");
    useLanguageStore.setState({ language: "zh-CN" });
    expect(localizeMessage("正在检查素材")).toBe("正在检查素材");
    expect(localizeMessage("正在检查素材", "tr")).toBe("Checking media");
  });

  it("translates progress counts and field validation", () => {
    expect(localizeMessage("正在收集素材 2 / 5", "en")).toBe("Collecting media 2 / 5");
    expect(localizeMessage("倒放分段 3/8", "en")).toBe("Reversing segment 3/8");
    expect(localizeMessage("宽度 必须为 2–8192 范围内的偶数。", "en"))
      .toBe("Width must be an even number between 2 and 8192.");
    expect(localizeMessage("字幕内容无效（最多 20000 字）", "en"))
      .toBe("Caption text is invalid (maximum 20,000 characters).");
  });
});
