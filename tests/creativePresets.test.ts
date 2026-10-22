import { describe, it, expect } from "vitest";
import {
  addTextPreset,
  applyTransition,
  makeTextPreset,
  motionPatch,
  MOTION_PRESETS,
  TEXT_PRESETS,
  TRANSITION_PRESETS,
} from "../src/core/creativePresets";
import {
  createClip,
  createProject,
  evaluateKeyframes,
  validateProject,
  clone,
} from "../src/core/model";
import { useEditorStore } from "../src/editor/store";
import type { MediaAsset } from "../src/core/types";
function pair() {
  const p = createProject();
  p.width = 640;
  p.height = 360;
  p.fps = 24;
  const a: MediaAsset = {
    id: "source",
    name: "Synthetic",
    path: "/synthetic.png",
    url: "file:///synthetic.png",
    kind: "image",
    width: 640,
    height: 360,
    duration: 0,
    fps: 0,
    hasAudio: false,
  };
  p.assets = [a];
  p.clips = [
    createClip(a, p.tracks[1].id, 0, 24),
    createClip(a, p.tracks[1].id, 2, 24),
  ];
  p.clips.forEach((c) => (c.duration = 2));
  return p;
}
describe("original editing recipes", () => {
  it.each(["easeIn", "easeOut", "easeInOut"] as const)(
    "preserves the remaining %s curve after an incoming transition",
    (easing) => {
      const p = pair(),
        next = p.clips[1];
      next.keyframes = [
        { id: "begin", time: 0, property: "x", value: 10, easing: "linear" },
        {
          id: "finish",
          time: 2,
          property: "x",
          value: 210,
          easing,
          easingWindow: { start: 0.15, end: 0.9 },
        },
      ];
      const changed = applyTransition(p, p.clips[0].id, "slide-left", 0.5)
        .project.clips[1];
      for (const time of [0.5, 0.7, 1, 1.5, 1.9, 2])
        expect(evaluateKeyframes(changed, time).transform.x).toBeCloseTo(
          evaluateKeyframes(next, time).transform.x,
          9,
        );
    },
  );
  it("adds editable text with responsive layout and a single undo, respecting locked tracks", () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [640, 360],
    ])
      for (const preset of TEXT_PRESETS) {
        const p = createProject();
        p.width = width;
        p.height = height;
        p.tracks[0].locked = true;
        const result = addTextPreset(p, preset, 0.47);
        validateProject(result.project);
        expect(result.clip.text?.text).toBe(preset.style.text);
        expect(result.clip.trackId).not.toBe(p.tracks[0].id);
        expect(result.clip.start).toBeCloseTo(14 / 30);
      }
    const p = createProject();
    useEditorStore.getState().setProject(p);
    const r = addTextPreset(p, TEXT_PRESETS[13], 0);
    useEditorStore.getState().commit(r.project);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project).toEqual(p);
  });
  it("motion preserves unrelated audio animation and remains valid at maximum scale", () => {
    for (const preset of MOTION_PRESETS) {
      const p = pair(),
        clip = p.clips[0];
      clip.transform.scale = 10;
      clip.keyframes = [
        {
          id: "volume",
          property: "volume",
          value: 0.7,
          time: 0,
          easing: "linear",
        },
      ];
      p.clips[0] = { ...clip, ...motionPatch(clip, preset.id, p) };
      validateProject(p);
      expect(p.clips[0].keyframes).toContainEqual(clip.keyframes[0]);
    }
    const p = pair(),
      clip = p.clips[0];
    const next = { ...clip, ...motionPatch(clip, "push", p) };
    expect(evaluateKeyframes(next, 0).transform.scale).toBe(1);
    expect(evaluateKeyframes(next, 2).transform.scale).toBeCloseTo(1.18);
  });
  it("all transitions preserve sources and durations, align to frames, and are atomic", () => {
    for (const recipe of TRANSITION_PRESETS) {
      const p = pair(),
        before = clone(p);
      const r = applyTransition(p, p.clips[0].id, recipe.id, 0.53);
      validateProject(r.project);
      expect(p).toEqual(before);
      expect(r.duration).toBe(0.5);
      expect(r.project.clips[1].start).toBe(recipe.id === "dip" ? 2 : 1.5);
      expect(r.project.clips[1].sourceIn).toBe(0);
      expect(r.project.clips[1].duration).toBe(2);
      expect(r.project.clips[0].audioFadeOut).toBe(0.5);
      const again = applyTransition(r.project, p.clips[0].id, recipe.id, 0.53);
      expect(again.project.clips[1].start).toBe(r.project.clips[1].start);
      useEditorStore.getState().setProject(p);
      useEditorStore.getState().commit(r.project);
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().project).toEqual(p);
    }
  });
  it("incoming motion meets existing animation and keeps later keyframes", () => {
    const p = pair(),
      next = p.clips[1];
    next.keyframes = [
      { id: "x0", time: 0, property: "x", value: 0, easing: "linear" },
      { id: "x2", time: 2, property: "x", value: 200, easing: "linear" },
    ];
    const r = applyTransition(p, p.clips[0].id, "slide-left", 0.5).project
      .clips[1];
    expect(evaluateKeyframes(r, 0).transform.x).toBe(690);
    expect(evaluateKeyframes(r, 0.5).transform.x).toBe(50);
    expect(evaluateKeyframes(r, 2).transform.x).toBe(200);
    expect(r.keyframes).toContainEqual(next.keyframes[1]);
  });
  it("rejects locked tracks, gaps, missing successors, bad durations and downstream collisions", () => {
    let p = pair();
    p.tracks[1].locked = true;
    expect(() => applyTransition(p, p.clips[0].id, "dissolve", 0.5)).toThrow(
      "解锁",
    );
    p = pair();
    p.clips[1].start = 4;
    expect(() => applyTransition(p, p.clips[0].id, "dissolve", 0.5)).toThrow(
      "相邻",
    );
    p = pair();
    expect(() => applyTransition(p, p.clips[1].id, "dissolve", 0.5)).toThrow(
      "相邻",
    );
    for (const value of [NaN, Infinity, 0, -1])
      expect(() =>
        applyTransition(p, p.clips[0].id, "dissolve", value),
      ).toThrow();
    p = pair();
    p.clips[0].duration = 1 / 24;
    p.clips[1].start = 1 / 24;
    expect(() => applyTransition(p, p.clips[0].id, "dissolve", 0.5)).toThrow(
      "太短",
    );
    p = pair();
    p.clips[1].start = 1.5;
    p.clips.push({ ...p.clips[1], id: "third", start: 3.5 });
    expect(() => applyTransition(p, p.clips[0].id, "dip", 0.5)).toThrow("后续");
  });
  it("uses project-relative typography without adding a raster image", () => {
    const p = createProject(),
      a = makeTextPreset(TEXT_PRESETS[0], p.tracks[0].id, 0, p);
    p.width = 960;
    p.height = 540;
    const b = makeTextPreset(TEXT_PRESETS[0], p.tracks[0].id, 0, p);
    expect(b.text!.fontSize).toBe(a.text!.fontSize / 2);
    expect(b.assetId).toBeUndefined();
  });
});
