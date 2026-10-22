import { describe, expect, it } from "vitest";
import {
  createClip,
  createProject,
  evaluateKeyframes,
  splitClip,
  trimClip,
  validateProject,
} from "../src/core/model";
import { easingProgress, EASINGS } from "../src/core/easing";
import {
  copyKeys,
  pasteKeys,
  editKey,
  deleteKeys,
  putKey,
} from "../src/core/keyframeEdits";
import { keyframeExpression } from "../electron/export";
import { useEditorStore } from "../src/editor/store";
import type { Keyframe } from "../src/core/types";
function fixture(easing: Keyframe["easing"] = "easeIn") {
  const p = createProject();
  const c = createClip(undefined, p.tracks[0].id, 0, 30);
  c.duration = 4;
  c.keyframes = [
    { id: "a", property: "x", time: 0, value: 0, easing: "linear" },
    { id: "b", property: "x", time: 4, value: 200, easing },
  ];
  p.clips = [c];
  return p;
}
describe("keyframe curves", () => {
  it.each(EASINGS)(
    "preserves %s after repeated splitting and trimming",
    (easing) => {
      const p = fixture(easing),
        c = p.clips[0];
      let q = splitClip(p, c.id, 1.2);
      const right = q.clips[1];
      q = trimClip(q, right.id, "start", 1.7);
      q = trimClip(q, right.id, "end", 3.3);
      const trimmed = q.clips.find((k) => k.id === right.id)!;
      for (let i = 0; i <= 48; i++)
        expect(evaluateKeyframes(trimmed, i / 30).transform.x).toBeCloseTo(
          evaluateKeyframes(c, 1.7 + i / 30).transform.x,
          8,
        );
      expect(validateProject(JSON.parse(JSON.stringify(q))).clips).toEqual(
        q.clips,
      );
    },
  );
  it("shares polynomial evaluation and export coefficients, including tiny sliced windows", () => {
    for (const easing of EASINGS)
      for (const window of [
        undefined,
        { start: 0, end: 1e-12 },
        { start: 1 - 1e-10, end: 1 },
        { start: 0.2, end: 0.8 },
      ]) {
        const key = { easing, easingWindow: window };
        const mid = easingProgress(key, 0.5);
        expect(mid).toBeGreaterThanOrEqual(0);
        expect(mid).toBeLessThanOrEqual(1);
        expect(easingProgress(key, 0)).toBe(0);
        expect(easingProgress(key, 1)).toBeCloseTo(1, 10);
      }
    expect(easingProgress({ easing: "easeIn" }, 0.5)).toBe(0.25);
    expect(easingProgress({ easing: "easeOut" }, 0.5)).toBe(0.75);
    const p = fixture("easeOut");
    expect(keyframeExpression(p.clips[0], "x", 0)).toContain("200");
  });
  it("moves and edits points, rejects collision, invalid values and locks; changing easing resets its sliced window", () => {
    const p = fixture(),
      c = p.clips[0];
    c.keyframes[1].easingWindow = { start: 0.2, end: 0.8 };
    expect(editKey(p, c, "b", { time: 2.01, value: 50 })[1]).toMatchObject({
      time: 2,
      value: 50,
      easingWindow: { start: 0.2, end: 0.8 },
    });
    expect(
      editKey(p, c, "b", { easing: "easeOut" })[1].easingWindow,
    ).toBeUndefined();
    expect(() => editKey(p, c, "b", { time: 0 })).toThrow(/已有/);
    expect(() => editKey(p, c, "b", { time: Infinity })).toThrow();
    p.tracks[0].locked = true;
    expect(() => deleteKeys(p, c, ["a"])).toThrow(/解锁/);
  });
  it("copies relative times, replaces collisions with fresh IDs, and rejects overflow atomically", () => {
    const p = fixture(),
      c = p.clips[0];
    c.keyframes[1].time = 1;
    const copied = copyKeys(c, ["a", "b"]);
    const pasted = pasteKeys(p, c, copied, 1);
    expect(pasted.keys).toHaveLength(3);
    expect(pasted.ids.every((id) => !["a", "b"].includes(id))).toBe(true);
    expect(
      pasted.keys.filter((k) => pasted.ids.includes(k.id)).map((k) => k.time),
    ).toEqual([1, 2]);
    expect(() => pasteKeys(p, c, copied, 4)).toThrow(/超出/);
    expect(c.keyframes).toHaveLength(2);
  });
  it("pastes across clips with relative timing and rejects incompatible audio or collapsed ticks", () => {
    const p = fixture(),
      source = p.clips[0],
      target = {
        ...source,
        id: "target",
        start: 8,
        keyframes: [] as Keyframe[],
      };
    p.clips.push(target);
    source.keyframes[0].time = 1;
    source.keyframes[1].time = 2;
    source.keyframes[1].easingWindow = { start: 0.2, end: 0.8 };
    const copied = copyKeys(source, ["a", "b"]),
      result = pasteKeys(p, target, copied, 0.5);
    expect(result.keys.map((k) => k.time)).toEqual([0.5, 1.5]);
    expect(result.keys[1].easingWindow).toEqual({ start: 0.2, end: 0.8 });
    p.tracks[0].locked = true;
    expect(() => pasteKeys(p, target, copied, 0)).toThrow(/解锁/);
    p.tracks[0].locked = false;
    p.fps = 24;
    copied.keys[1].time = 1 / 60;
    expect(() => pasteKeys(p, target, copied, 0)).toThrow(/重叠/);
    target.assetId = "audio";
    p.assets.push({ id: "audio", kind: "audio" } as any);
    expect(() => pasteKeys(p, target, copied, 0)).toThrow(/音频/);
  });
  it("enforces property ranges and the 400-key cap", () => {
    const p = fixture(),
      c = p.clips[0];
    c.keyframes[0].property = "opacity";
    expect(() => editKey(p, c, "a", { value: 1.01 })).toThrow();
    c.keyframes = Array.from({ length: 400 }, (_, i) => ({
      id: String(i),
      time: i / 100,
      property: "x",
      value: i,
      easing: "linear",
    }));
    expect(() => putKey(p, c, "y", 2)).toThrow();
  });
  it("coalesces continuous point edits into one undo and persists pasted curves", () => {
    const p = fixture(),
      c = p.clips[0],
      s = useEditorStore.getState();
    s.setProject(p);
    s.beginTransaction();
    for (const value of [10, 20, 30])
      useEditorStore
        .getState()
        .updateClip(c.id, { keyframes: editKey(p, c, "b", { value }) });
    s.endTransaction();
    expect(useEditorStore.getState().past).toHaveLength(1);
    s.undo();
    expect(useEditorStore.getState().project.clips[0].keyframes).toEqual(
      c.keyframes,
    );
    s.redo();
    expect(
      validateProject(
        JSON.parse(JSON.stringify(useEditorStore.getState().project)),
      ).clips[0].keyframes[1].value,
    ).toBe(30);
  });
  it("rejects unsupported interpolation and malformed windows on project load", () => {
    const p = fixture();
    (p.clips[0].keyframes[1] as any).easing = "custom";
    expect(() => validateProject(p)).toThrow();
    p.clips[0].keyframes[1].easing = "easeIn";
    p.clips[0].keyframes[1].easingWindow = { start: 0.8, end: 0.2 };
    expect(() => validateProject(p)).toThrow();
  });
});
