import { describe, expect, it } from "vitest";
import {
  CAPCUT_MAX_TIMELINES,
  CAPCUT_SIDECAR_MAX_BYTES,
  describeCapcutProjectSelection,
  planCapcutProjectImport,
  selectCapcutTimelineDraft,
} from "../electron/capcutProject";

// Minimal independent fixture using the observed 11.0.12922/version-0 sidecar
// schema. Actual source sidecars are retained privately with research evidence.
const main = "11111111-1111-4111-8111-111111111111";
const active = "22222222-2222-4222-8222-222222222222";
const deleted = "33333333-3333-4333-8333-333333333333";
function manifest() {
  return {
    version: 0,
    main_timeline_id: main,
    timelines: [
      { id: main, name: "时间线01", is_marked_delete: false },
      { id: active, name: "时间线02", is_marked_delete: false },
      { id: deleted, name: "旧时间线", is_marked_delete: true },
    ],
  };
}

describe("modern Capcut timeline selection", () => {
  it("keeps distinct main and active timelines and never defaults to the empty root", () => {
    const plan = planCapcutProjectImport(
      "/fixtures/project/draft_info.json",
      "file",
      JSON.stringify(manifest()),
      JSON.stringify({ activeTimeline: active }),
    );
    expect(plan.timelines).toHaveLength(2);
    expect(plan.timelines[0]).toMatchObject({
      id: main,
      isMain: true,
      isActive: false,
    });
    expect(plan.timelines[1]).toMatchObject({
      id: active,
      isMain: false,
      isActive: true,
    });
    expect(plan.recommendedTimelineId).toBe(active);
    expect(plan.requiresTimelineChoice).toBe(true);
    expect(() => selectCapcutTimelineDraft(plan)).toThrow("明确选择");
    expect(selectCapcutTimelineDraft(plan, active)).toBe(
      `/fixtures/project/Timelines/${active}/draft_info.json`,
    );
    expect(() => selectCapcutTimelineDraft(plan, deleted)).toThrow("清单");
  });

  it("recognizes root, manifest, layout and explicit timeline selections", () => {
    for (const [path, kind] of [
      ["/fixtures/project", "directory"],
      ["/fixtures/project/Timelines", "directory"],
      ["/fixtures/project/Timelines/project.json", "file"],
      ["/fixtures/project/timeline_layout.json", "file"],
    ] as const) {
      const description = describeCapcutProjectSelection(path, kind);
      expect(description.projectDirectory).toBe("/fixtures/project");
      expect(description.manifestPath).toBe(
        "/fixtures/project/Timelines/project.json",
      );
      expect(description.layoutPath).toBe(
        "/fixtures/project/timeline_layout.json",
      );
      expect(description.directDraftPath).toBe(
        "/fixtures/project/draft_info.json",
      );
    }
    for (const [path, kind] of [
      [`/fixtures/project/Timelines/${main}`, "directory"],
      [`/fixtures/project/Timelines/${main}/draft_info.json`, "file"],
    ] as const) {
      const plan = planCapcutProjectImport(path, kind, manifest(), {
        activeTimeline: active,
      });
      expect(plan.selectedTimelineId).toBe(main);
      expect(plan.requiresTimelineChoice).toBe(false);
      expect(selectCapcutTimelineDraft(plan)).toBe(
        `/fixtures/project/Timelines/${main}/draft_info.json`,
      );
    }
  });

  it("supports Windows paths independently of the test host", () => {
    const plan = planCapcutProjectImport(
      "C:\\Projects\\用户草稿\\Timelines\\project.json",
      "file",
      manifest(),
    );
    expect(plan.selection.projectDirectory).toBe("C:\\Projects\\用户草稿");
    expect(selectCapcutTimelineDraft(plan, active)).toBe(
      `C:\\Projects\\用户草稿\\Timelines\\${active}\\draft_info.json`,
    );
  });

  it("accepts one unambiguous surviving timeline while preserving classic file choice", () => {
    const single = manifest();
    single.timelines[1].is_marked_delete = true;
    const plan = planCapcutProjectImport(
      "/fixtures/project",
      "directory",
      single,
    );
    expect(plan.requiresTimelineChoice).toBe(false);
    expect(selectCapcutTimelineDraft(plan)).toBe(
      `/fixtures/project/Timelines/${main}/draft_info.json`,
    );
    const classic = planCapcutProjectImport(
      "/fixtures/classic/draft_content.json",
      "file",
    );
    expect(classic.kind).toBe("single-draft");
    expect(selectCapcutTimelineDraft(classic)).toBe(
      "/fixtures/classic/draft_content.json",
    );
  });

  it("warns about stale or malformed layout hints without choosing a root draft", () => {
    const plan = planCapcutProjectImport(
      "/fixtures/project",
      "directory",
      { ...manifest(), main_timeline_id: deleted, version: 12 },
      { activeTimeline: deleted },
    );
    expect(plan.mainTimelineId).toBeUndefined();
    expect(plan.activeTimelineId).toBeUndefined();
    expect(plan.warnings).toHaveLength(3);
    expect(plan.requiresTimelineChoice).toBe(true);
    const malformed = planCapcutProjectImport(
      "/fixtures/project",
      "directory",
      manifest(),
      "{invalid",
    );
    expect(malformed.recommendedTimelineId).toBe(main);
    expect(malformed.warnings).toEqual([
      "时间线布局无法验证，已忽略活动时间线提示。",
    ]);
  });

  it("rejects untrusted path traversal, URL paths and ambiguous deletion state", () => {
    for (const id of [
      "../escape",
      "../../secret",
      "..",
      ".",
      "/absolute",
      "C:\\escape",
      "a/b",
      "a\\b",
      "bad\0id",
      "nul",
      "LPT1",
      "x".repeat(129),
    ]) {
      const source = manifest();
      source.timelines[0].id = id;
      expect(() =>
        planCapcutProjectImport("/fixtures/project", "directory", source),
      ).toThrow("安全");
    }
    expect(() =>
      describeCapcutProjectSelection("https://example.com/project", "file"),
    ).toThrow("绝对路径");
    const uncertain = {
      version: 0,
      timelines: [{ id: main, name: "未知状态" }],
    };
    expect(() =>
      planCapcutProjectImport("/fixtures/project", "directory", uncertain),
    ).toThrow("删除状态");
    expect(() =>
      planCapcutProjectImport(
        `/fixtures/project/Timelines/${deleted}/draft_info.json`,
        "file",
        manifest(),
      ),
    ).toThrow("已删除");
  });

  it("bounds byte size, timeline count and duplicates before producing paths", () => {
    const oversized = JSON.stringify({
      ...manifest(),
      ignored: "中".repeat(CAPCUT_SIDECAR_MAX_BYTES / 2),
    });
    expect(() =>
      planCapcutProjectImport("/fixtures/project", "directory", oversized),
    ).toThrow("大小限制");
    expect(() =>
      planCapcutProjectImport("/fixtures/project", "directory", {
        version: 0,
        timelines: Array.from({ length: CAPCUT_MAX_TIMELINES + 1 }, (_, i) => ({
          id: `timeline-${i}`,
          is_marked_delete: false,
        })),
      }),
    ).toThrow("数量");
    const duplicate = manifest();
    duplicate.timelines[1].id = main.toLowerCase();
    expect(() =>
      planCapcutProjectImport("/fixtures/project", "directory", duplicate),
    ).toThrow("重复");
    const empty = manifest();
    empty.timelines.forEach((entry) => (entry.is_marked_delete = true));
    expect(() =>
      planCapcutProjectImport("/fixtures/project", "directory", empty),
    ).toThrow("没有可导入");
  });

  it("ignores manifest-supplied paths and preserves names strictly as labels", () => {
    const source = manifest();
    Object.assign(source.timelines[0], {
      path: "/private/unrelated/draft_info.json",
      name: "<script>label</script>",
    });
    const plan = planCapcutProjectImport(
      "/fixtures/project",
      "directory",
      source,
    );
    expect(plan.timelines[0].name).toBe("<script>label</script>");
    expect(plan.timelines[0].draftPath).toBe(
      `/fixtures/project/Timelines/${main}/draft_info.json`,
    );
  });
});
