import { describe, expect, it } from "vitest";
import { importCapcutDraft } from "../src/core/capcutImport";
import { validateProject } from "../src/core/model";
function draft() {
  return {
    name: "classic 测试",
    fps: 30,
    canvas_config: { width: 1920, height: 1080 },
    materials: {
      videos: [
        {
          id: "video",
          type: "video",
          path: "/tmp/test.mp4",
          material_name: "样片",
          duration: 10_000_000,
          width: 1920,
          height: 1080,
        },
      ],
      speeds: [{ id: "speed", speed: 2 }],
      texts: [
        {
          id: "text",
          type: "text",
          content: JSON.stringify({ text: "中文字幕" }),
        },
      ],
    },
    tracks: [
      {
        type: "video",
        segments: [
          {
            material_id: "video",
            target_timerange: { start: 1_000_000, duration: 2_000_000 },
            source_timerange: { start: 2_000_000, duration: 4_000_000 },
            extra_material_refs: ["speed"],
            volume: 0.4,
            clip: {
              transform: { x: 0.1, y: -0.2 },
              scale: { x: 1, y: 1 },
              alpha: 0.5,
            },
          },
        ],
      },
      {
        type: "text",
        segments: [
          {
            material_id: "text",
            target_timerange: { start: 0, duration: 2_000_000 },
          },
        ],
      },
    ],
  };
}
describe("experimental classic plaintext import", () => {
  it("maps synthetic microsecond ranges and known basic transforms independently", () => {
    const { project, warnings } = importCapcutDraft(JSON.stringify(draft()), {
      mediaUrl: (path) => "file://" + path,
    });
    expect(project.clips).toHaveLength(2);
    expect(project.clips[0]).toMatchObject({
      start: 1,
      duration: 2,
      sourceIn: 2,
      speed: 2,
      volume: 0.4,
      transform: { x: 96, y: 108, opacity: 0.5 },
    });
    expect(project.clips[1].text?.text).toBe("中文字幕");
    expect(warnings.some((w) => w.includes("实验性"))).toBe(true);
    expect(() => validateProject(project)).not.toThrow();
  });
  it("rejects opaque current drafts without decryption or side effects", () => {
    expect(() => importCapcutDraft("opaque-base64-carrier")).toThrow("不透明");
    expect(() => importCapcutDraft("{bad")).toThrow("无法解析");
    expect(() => importCapcutDraft({ tracks: [], materials: [] })).toThrow(
      "classic",
    );
  });
  it("skips unsupported/network paths and impossible source ranges with warnings", () => {
    const d = draft();
    d.materials.videos[0].path = "https://example.com/private.mp4";
    const remote = importCapcutDraft(d);
    expect(remote.project.clips).toHaveLength(1);
    expect(remote.warnings.some((w) => w.includes("本机绝对路径"))).toBe(true);
    d.materials.videos[0].path = "/tmp/test.mp4";
    d.materials.videos[0].duration = 3_000_000;
    const impossible = importCapcutDraft(d);
    expect(impossible.project.clips).toHaveLength(1);
    expect(impossible.warnings.some((w) => w.includes("源素材时长"))).toBe(
      true,
    );
  });
  it("infers missing source duration from every referencing segment", () => {
    const d = draft();
    d.materials.videos[0].duration = 0;
    const segment = d.tracks[0]
      .segments[0] as (typeof d.tracks)[0]["segments"][number] & {
      extra_material_refs: string[];
      volume: number;
      clip: {
        transform: { x: number; y: number };
        scale: { x: number; y: number };
        alpha: number;
      };
    };
    d.tracks[0].segments.push({
      ...segment,
      target_timerange: { start: 5_000_000, duration: 2_000_000 },
      source_timerange: { start: 6_000_000, duration: 4_000_000 },
    });
    const result = importCapcutDraft(d);
    expect(result.project.assets[0].duration).toBe(10);
    expect(result.project.clips).toHaveLength(3);
    expect(() => validateProject(result.project)).not.toThrow();
  });
  it("accepts Windows local paths and preserves synthetic text only with explicit style warning", () => {
    const d = draft();
    d.materials.videos[0].path = "C:\\素材\\测试.mp4";
    const result = importCapcutDraft(d);
    expect(result.project.assets[0].path).toBe(d.materials.videos[0].path);
    expect(result.warnings.some((w) => w.includes("样式"))).toBe(true);
  });
  it("bounds pathological input and skips nonpositive timeline ranges", () => {
    const d = draft();
    d.tracks[0].segments[0].target_timerange.duration = -1;
    expect(importCapcutDraft(d).project.clips).toHaveLength(1);
    expect(() =>
      importCapcutDraft({ tracks: Array(1001).fill({}), materials: {} }),
    ).toThrow("轨道数量");
  });
});
