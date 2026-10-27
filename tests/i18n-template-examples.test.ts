import { describe, expect, it } from "vitest";
import { BUILTIN_ASSETS } from "../src/core/builtinAssets";
import { buildTemplateExample, TEMPLATE_EXAMPLES } from "../src/core/templateExamples";
import { instantiateTemplate } from "../src/core/projectTemplates";
import { localizeBuiltinTemplate, TEMPLATE_NAMES } from "../src/components/templateLabels";

function example(key: string) {
  const definition = TEMPLATE_EXAMPLES.find(item => item.id === key)!;
  return instantiateTemplate(buildTemplateExample(key, definition.media.map(id => ({
    id, name: BUILTIN_ASSETS.find(asset => asset.id === id)!.name,
    kind: "image" as const, path: `/synthetic/${id}.png`, url: `file:///synthetic/${id}.png`,
    duration: 12, width: 640, height: 360, fps: 0, hasAudio: false,
  }))));
}
function textContent(template: ReturnType<typeof example>) {
  return [template.name, template.project.name,
    ...template.project.tracks.map(track => track.name),
    ...template.project.assets.map(asset => asset.name),
    ...template.project.clips.flatMap(clip => [clip.name, clip.text?.text ?? ""]),
    ...template.slots.map(slot => slot.label),
  ].join("\n");
}
describe("new built-in template language", () => {
  it.each(TEMPLATE_EXAMPLES.map(item => item.id))("localizes all %s example content without altering its source or timeline", key => {
    const original = example(key), snapshot = structuredClone(original);
    const result = localizeBuiltinTemplate(original, key, "en");
    expect(textContent(result)).not.toMatch(/[\u3400-\u9fff]/);
    expect(result.project.name).toBe(TEMPLATE_NAMES[key] + " · Copy");
    expect(original).toEqual(snapshot);
    expect(result.project.clips.map(({ name, text, ...rest }) => rest))
      .toEqual(original.project.clips.map(({ name, text, ...rest }) => rest));
    expect(result.slots.map(slot => slot.targetId)).toEqual(original.slots.map(slot => slot.targetId));
  });
  it("retains Chinese example content for Chinese UI", () => {
    const original = example("talk");
    expect(localizeBuiltinTemplate(original, "talk", "zh-CN")).toBe(original);
    expect(textContent(original)).toContain("本地创作课堂");
  });
  it("uses English fallback for newly loaded Turkish examples", () => {
    expect(textContent(localizeBuiltinTemplate(example("gallery"), "gallery", "tr"))).not.toMatch(/[\u3400-\u9fff]/);
  });
  it("never translates saved or imported templates even when their content matches an example", () => {
    const saved = example("promo"), snapshot = structuredClone(saved);
    expect(localizeBuiltinTemplate(saved, undefined, "en")).toBe(saved);
    expect(saved).toEqual(snapshot);
    expect(textContent(saved)).toContain("让灵感发生");
  });
  it("does not guess translations for unknown templates or custom text", () => {
    const original = example("talk");
    original.project.clips.find(clip => clip.text)!.text!.text = "用户自定义内容";
    expect(localizeBuiltinTemplate(original, "unknown", "en")).toBe(original);
    expect(textContent(localizeBuiltinTemplate(original, "talk", "en"))).toContain("用户自定义内容");
  });
});
