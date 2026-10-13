import { beforeEach, describe, expect, it } from "vitest";
import { applySubtitleEdit, prepareSubtitleEdit, type SubtitleEdit } from "../src/core/subtitleEdits";
import { clone, createClip, createProject, createTrack, evaluateFade, evaluateKeyframes, id, validateProject } from "../src/core/model";
import { useEditorStore } from "../src/editor/store";

function fixture() {
  const p = createProject("字幕合成验收");
  p.tracks[0].name = "字幕";
  const titleTrack = createTrack("text", "片头标题");
  p.tracks.push(titleTrack);
  p.clips = [2, 6, 9].map((start, index) => {
    const c = createClip(undefined, p.tracks[0].id, start, p.fps);
    c.id = `cue-${index}`; c.duration = 3; c.text!.text = `字幕 ${index} [a].* $&`;
    c.name = c.text!.text;
    return c;
  });
  const title = createClip(undefined, titleTrack.id, 0, p.fps);
  title.id = "title"; title.text!.text = "保留标题"; p.clips.push(title);
  return p;
}
beforeEach(() => useEditorStore.getState().setProject(createProject()));

describe("subtitle batch edit workflow", () => {
  it("offsets only selected cues in frame increments and preserves all local animation", () => {
    const p = fixture(); p.clips[0].fadeIn = 1;
    p.clips[0].keyframes = [{ id: id(), property: "x", time: 1, value: 120, easing: "linear" }];
    const plan = prepareSubtitleEdit(p, ["cue-0", "cue-2"], { type: "offset", seconds: .049 });
    expect(plan.project.clips[0].start).toBeCloseTo(2 + 1 / 30, 10);
    expect(plan.project.clips[2].start).toBeCloseTo(9 + 1 / 30, 10);
    expect(plan.project.clips[1]).toEqual(p.clips[1]); expect(plan.project.clips[3]).toEqual(p.clips[3]);
    expect({ ...plan.project.clips[0], start: 2 }).toEqual(p.clips[0]);
    expect(plan.changedIds).toEqual(["cue-0", "cue-2"]);
  });
  it("fails the entire batch if any cue would go before zero or beyond 24 hours", () => {
    const p = fixture(), before = clone(p);
    expect(() => prepareSubtitleEdit(p, ["cue-2", "cue-0"], { type: "offset", seconds: -3 })).toThrow("未修改任何字幕");
    expect(() => prepareSubtitleEdit(p, ["cue-0", "cue-2"], { type: "offset", seconds: 86390 })).toThrow("范围");
    expect(p).toEqual(before);
  });
  it("permits overlapping cues and frame-aligns nonzero absolute start/end edits", () => {
    const p = fixture();
    const c = prepareSubtitleEdit(p, ["cue-0"], { type: "cue", text: "新字幕", start: 6.017, end: 8.081 }).project.clips[0];
    expect(c.start).toBeCloseTo(6 + 1 / 30, 10); expect(c.start + c.duration).toBeCloseTo(8 + 2 / 30, 10);
    expect(c.text!.text).toBe("新字幕"); expect(c.name).toBe("新字幕");
  });
  it.each([[0, 1], [20, 21], [3, 4], [1, 6]])("retimes a complete cue window %s–%s without clamping a disjoint move", (start, end) => {
    const plan = prepareSubtitleEdit(fixture(), ["cue-0"], { type: "cue", text: "时序", start, end });
    expect(plan.project.clips[0].start).toBe(start); expect(plan.project.clips[0].duration).toBe(end - start);
  });
  it("accepts exactly one frame with floating-point timing", () => {
    const plan = prepareSubtitleEdit(fixture(), ["cue-0"], { type: "cue", text: "一帧", start: 7, end: 7 + 1 / 30 });
    expect(plan.project.clips[0].duration).toBeCloseTo(1 / 30, 10);
  });
  it("moves the local envelope with translated and disjoint cues instead of fading them out permanently", () => {
    const p = fixture(), c = p.clips[0]; c.fadeIn = 1; c.fadeOut = 1;
    c.keyframes = [{ id: id(), time: 0, property: "x", value: 0, easing: "linear" }, { id: id(), time: 3, property: "x", value: 300, easing: "linear" }];
    for (const [start, end] of [[3, 6], [20, 23], [20, 22]]) {
      const after = prepareSubtitleEdit(p, [c.id], { type: "cue", text: c.text!.text, start, end }).project.clips[0];
      for (let t = 0; t <= end - start; t += .25) {
        expect(evaluateFade(after, t, "video")).toBeCloseTo(evaluateFade(c, t, "video"), 8);
        expect(evaluateKeyframes(after, t).transform.x).toBeCloseTo(evaluateKeyframes(c, t).transform.x, 8);
      }
    }
  });
  it("preserves animation curves and video/audio fade envelopes inside a cropped cue", () => {
    const p = fixture(), c = p.clips[0]; c.duration = 8;
    c.fadeIn = 3; c.fadeOut = 3; c.audioFadeIn = 2; c.audioFadeOut = 2;
    c.keyframes = [{ id: id(), time: 0, property: "x", value: -200, easing: "linear" }, { id: id(), time: 8, property: "x", value: 600, easing: "easeInOut" }];
    const after = prepareSubtitleEdit(p, [c.id], { type: "cue", text: c.text!.text, start: 4, end: 8 }).project.clips[0];
    for (let t = 0; t <= 4; t += .125) {
      expect(evaluateKeyframes(after, t).transform.x).toBeCloseTo(evaluateKeyframes(c, t + 2).transform.x, 7);
      for (const kind of ["video", "audio"] as const) expect(evaluateFade(after, t, kind)).toBeCloseTo(evaluateFade(c, t + 2, kind), 8);
    }
  });
  it("finds and replaces literal punctuation and preserves dollar replacement text", () => {
    const p = fixture();
    const plan = prepareSubtitleEdit(p, ["cue-0", "cue-1"], { type: "replace", find: "[a].*", replacement: "$&$1" });
    expect(plan.project.clips[0].text!.text).toBe("字幕 0 $&$1 $&");
    expect(plan.project.clips[1].text!.text).toBe("字幕 1 $&$1 $&");
    expect(plan.project.clips[2]).toEqual(p.clips[2]);
  });
  it("allows empty replacement and reports an empty changed set for unmatched text", () => {
    const p = fixture();
    expect(prepareSubtitleEdit(p, ["cue-0"], { type: "replace", find: "字幕 ", replacement: "" }).project.clips[0].text!.text).toBe("0 [a].* $&");
    expect(prepareSubtitleEdit(p, ["cue-0"], { type: "replace", find: "不存在", replacement: "新" }).changedIds).toEqual([]);
  });
  it("copies only text style, preserving every target's content, transforms, timing and keyframes", () => {
    const p = fixture(); p.clips[0].text!.fontSize = 99; p.clips[0].text!.color = "#112233";
    p.clips[1].transform.x = 230; p.clips[1].keyframes = [{ id: id(), time: 1, property: "opacity", value: .5, easing: "linear" }];
    const plan = prepareSubtitleEdit(p, ["cue-1", "cue-2"], { type: "style", referenceId: "cue-0" });
    for (const i of [1, 2]) {
      expect(plan.project.clips[i].text).toEqual({ ...p.clips[0].text!, text: p.clips[i].text!.text });
      expect({ ...plan.project.clips[i], text: p.clips[i].text }).toEqual(p.clips[i]);
    }
    expect(prepareSubtitleEdit(p, ["cue-0", "cue-1", "cue-2"], { type: "style", referenceId: "cue-0" }).changedIds).toEqual(["cue-1", "cue-2"]);
  });
  it("does not modify locked target tracks, including text-only edits", () => {
    const p = fixture(); p.tracks[0].locked = true;
    const edits: SubtitleEdit[] = [{ type: "offset", seconds: 1 }, { type: "replace", find: "字幕", replacement: "修改" }, { type: "style", referenceId: "title" }, { type: "cue", text: "修改", start: 2, end: 4 }];
    for (const edit of edits) expect(() => prepareSubtitleEdit(p, ["cue-0"], edit)).toThrow("锁定");
  });
  it("rejects stale plans after edits or project switches and detaches committed data", () => {
    const p = fixture(), plan = prepareSubtitleEdit(p, ["cue-0"], { type: "offset", seconds: 1 });
    const changed = clone(p); changed.name = "别的编辑";
    expect(() => applySubtitleEdit(changed, plan)).toThrow("项目已变化");
    const another = clone(p); another.id = id(); expect(() => applySubtitleEdit(another, plan)).toThrow("项目已变化");
    const applied = applySubtitleEdit(p, plan); applied.clips[0].start = 25; expect(plan.project.clips[0].start).toBe(3);
  });
  it("commits multiple replacements as one undo/redo and leaves unrelated titles intact", () => {
    useEditorStore.getState().setProject(fixture()); const before = clone(useEditorStore.getState().project);
    const plan = prepareSubtitleEdit(before, ["cue-0", "cue-1", "cue-2"], { type: "replace", find: "字幕", replacement: "台词" });
    useEditorStore.getState().commit(applySubtitleEdit(useEditorStore.getState().project, plan));
    expect(useEditorStore.getState().past).toHaveLength(1); expect(useEditorStore.getState().project.clips[3]).toEqual(before.clips[3]);
    useEditorStore.getState().undo(); expect(useEditorStore.getState().project).toEqual(before);
    useEditorStore.getState().redo(); expect(useEditorStore.getState().project.clips[0].text!.text).toContain("台词");
  });
  it.each<SubtitleEdit>([
    { type: "offset", seconds: NaN }, { type: "offset", seconds: Infinity }, { type: "offset", seconds: 100000 },
    { type: "cue", text: "无效", start: -1, end: 2 }, { type: "cue", text: "无效", start: 2, end: 2.001 },
    { type: "cue", text: "无效", start: NaN, end: 3 }, { type: "cue", text: "无效", start: 4, end: 3 },
    { type: "cue", text: "无效", start: 86400, end: 86401 }, { type: "replace", find: "", replacement: "a" },
    { type: "replace", find: "字幕", replacement: "\0" }, { type: "style", referenceId: "missing" },
  ])("rejects invalid data %# without mutating the input", edit => {
    const p = fixture(), snapshot = clone(p); expect(() => prepareSubtitleEdit(p, ["cue-0"], edit)).toThrow(); expect(p).toEqual(snapshot);
  });
  it("rejects a batch spanning tracks, duplicate/missing targets and replacement overflow", () => {
    const p = fixture();
    for (const ids of [[], ["cue-0", "cue-0"], ["cue-0", "title"], ["cue-0", "missing"]]) expect(() => prepareSubtitleEdit(p, ids, { type: "offset", seconds: 1 })).toThrow();
    p.clips[0].text!.text = "a".repeat(20000); validateProject(p);
    expect(() => prepareSubtitleEdit(p, ["cue-0"], { type: "replace", find: "a", replacement: "aa" })).toThrow("20000");
  });
});
