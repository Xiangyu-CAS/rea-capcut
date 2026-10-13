import { describe, expect, it } from "vitest";
import {
  changeClipSpeed,
  createClip,
  createProject,
  evaluateKeyframes,
  evaluateFade,
  splitClip,
  trimClip,
  validateProject,
} from "../src/core/model";
import type { MediaAsset, Project } from "../src/core/types";
function fixture(): Project {
  const p = createProject("测试");
  const a: MediaAsset = {
    id: "asset",
    name: "视频",
    path: "/tmp/test.mp4",
    url: "file:///tmp/test.mp4",
    kind: "video",
    duration: 20,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
  };
  p.assets = [a];
  const c = createClip(a, p.tracks[1].id, 2, p.fps);
  c.duration = 8;
  c.sourceIn = 2;
  c.speed = 2;
  c.fadeIn = 2;
  c.fadeOut = 3;
  c.audioFadeIn = 1;
  c.audioFadeOut = 2;
  c.keyframes = [
    { id: "key0", property: "x", time: 0, value: 0, easing: "linear" },
    { id: "key1", property: "x", time: 8, value: 800, easing: "easeInOut" },
  ];
  p.clips = [c];
  return p;
}

describe("timeline semantics", () => {
  it("splits at one-frame boundaries despite floating-point subtraction", () => {
    for (const fps of [24, 25, 30, 50, 60])
      for (const start of [2, 123, 80000]) {
        const p = fixture(); p.fps = fps; p.clips[0].start = start;
        const original = p.clips[0];
        for (const at of [start + 1 / fps, start + original.duration - 1 / fps]) {
          const next = splitClip(p, original.id, at);
          expect(next.clips).toHaveLength(2);
          expect(Math.min(...next.clips.map(c => c.duration))).toBeCloseTo(1 / fps, 8);
          expect(next.clips[0].duration + next.clips[1].duration).toBeCloseTo(original.duration, 8);
          expect(next.clips[1].sourceIn).toBeCloseTo(original.sourceIn + next.clips[0].duration * original.speed, 8);
          expect(() => validateProject(next)).not.toThrow();
        }
        expect(splitClip(p, original.id, start)).toBe(p);
        expect(splitClip(p, original.id, start + original.duration)).toBe(p);
      }
  });
  it("split keeps source ranges and exact animation across both clips", () => {
    const p = fixture(),
      original = p.clips[0],
      next = splitClip(p, original.id, 5);
    const [left, right] = next.clips;
    expect(left.duration).toBe(3);
    expect(right.sourceIn).toBe(8);
    expect(right.duration).toBe(5);
    expect(right.fadeIn).toBe(0);
    expect(left.fadeOut).toBe(0);
    for (let t = 0; t <= 8; t += 0.125) {
      const c = t <= 3 ? left : right;
      expect(evaluateKeyframes(c, t <= 3 ? t : t - 3).transform.x).toBeCloseTo(
        evaluateKeyframes(original, t).transform.x,
        8,
      );
    }
    expect(p.clips).toEqual([original]);
    expect(() => validateProject(next)).not.toThrow();
  });
  it("trim retains exact easing curve, including after repeated trims and split", () => {
    const p = fixture(),
      original = p.clips[0];
    let next = trimClip(p, original.id, "start", 4);
    next = trimClip(next, original.id, "end", 8);
    for (let t = 0; t <= 4; t += 0.125)
      expect(evaluateKeyframes(next.clips[0], t).transform.x).toBeCloseTo(
        evaluateKeyframes(original, t + 2).transform.x,
        8,
      );
    next = splitClip(next, original.id, 6);
    for (let t = 0; t <= 4; t += 0.125) {
      const c = t <= 2 ? next.clips[0] : next.clips[1];
      expect(evaluateKeyframes(c, t <= 2 ? t : t - 2).transform.x).toBeCloseTo(
        evaluateKeyframes(original, t + 2).transform.x,
        8,
      );
    }
    expect(() => validateProject(next)).not.toThrow();
  });
  it("evaluates very narrow easing windows without numerical cancellation", () => {
    const c = fixture().clips[0];
    c.keyframes[1].easingWindow = { start: 1 - 1e-12, end: 1 };
    const value = evaluateKeyframes(c, 4).transform.x;
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(800);
  });
  it("split inside overlapping video/audio fades preserves the original envelope on both sides", () => {
    const p = fixture(),
      c = p.clips[0];
    c.fadeIn = 6;
    c.fadeOut = 7;
    c.audioFadeIn = 7;
    c.audioFadeOut = 6;
    const next = splitClip(p, c.id, c.start + 3);
    for (const kind of ["video", "audio"] as const)
      for (let t = 0; t <= 8; t += 0.125) {
        const part = t <= 3 ? next.clips[0] : next.clips[1];
        expect(evaluateFade(part, t <= 3 ? t : t - 3, kind)).toBeCloseTo(
          evaluateFade(c, t, kind),
          12,
        );
      }
    expect(() => validateProject(next)).not.toThrow();
  });
  it("repeated trims and split preserve fading while speed rescales all envelope times", () => {
    const p = fixture(),
      c = p.clips[0];
    c.fadeIn = 6;
    c.fadeOut = 7;
    c.audioFadeIn = 7;
    c.audioFadeOut = 6;
    let next = trimClip(p, c.id, "start", 4);
    next = trimClip(next, c.id, "end", 8);
    next = changeClipSpeed(next, c.id, 4);
    const part = next.clips[0];
    for (const kind of ["video", "audio"] as const)
      for (let t = 0; t <= 2; t += 0.0625)
        expect(evaluateFade(part, t, kind)).toBeCloseTo(
          evaluateFade(c, t * 2 + 2, kind),
          12,
        );
    expect(part.videoFadeWindow).toMatchObject({
      offset: 1,
      duration: 4,
      fadeIn: 3,
      fadeOut: 3.5,
    });
    expect(() => validateProject(next)).not.toThrow();
  });
  it("extending the start keeps a negative fade window and delays the original fade onset", () => {
    const p = fixture(),
      c = p.clips[0];
    c.fadeIn = 4;
    const next = trimClip(p, c.id, "start", 1).clips[0];
    expect(next.videoFadeWindow?.offset).toBe(-1);
    expect(evaluateFade(next, 0.5, "video")).toBe(0);
    for (let t = 0; t <= 8; t += 0.125)
      expect(evaluateFade(next, t + 1, "video")).toBeCloseTo(
        evaluateFade(c, t, "video"),
        12,
      );
    expect(() => validateProject({ ...p, clips: [next] })).not.toThrow();
  });
  it("strictly validates every optional fade-window field", () => {
    for (const field of ["offset", "duration", "fadeIn", "fadeOut"])
      for (const value of [undefined, NaN, Infinity, "1"]) {
        const p = fixture();
        p.clips[0].videoFadeWindow = {
          offset: 0,
          duration: 8,
          fadeIn: 1,
          fadeOut: 1,
        };
        (p.clips[0].videoFadeWindow as unknown as Record<string, unknown>)[
          field
        ] = value;
        expect(() => validateProject(p)).toThrow();
      }
    const p = fixture();
    p.clips[0].audioFadeWindow = {
      offset: 0,
      duration: 8,
      fadeIn: 9,
      fadeOut: 0,
    };
    expect(() => validateProject(p)).toThrow();
  });
  it("uses destination easing and last duplicate timestamp consistently", () => {
    const c = fixture().clips[0];
    expect(evaluateKeyframes(c, 2).transform.x).toBe(125);
    c.keyframes.push({
      id: "duplicate",
      property: "x",
      time: 8,
      value: 1600,
      easing: "linear",
    });
    expect(evaluateKeyframes(c, 2).transform.x).toBe(400);
  });
  it("speed preserves source extent and scales keyframes and fades", () => {
    const p = fixture(),
      c = p.clips[0],
      next = changeClipSpeed(p, c.id, 4).clips[0];
    expect(next.duration * next.speed).toBe(c.duration * c.speed);
    expect(next.keyframes[1].time).toBe(4);
    expect(next.fadeOut).toBe(1.5);
    expect(next.audioFadeOut).toBe(1);
  });
  it("clamps all fades when trimming and rejects invalid times", () => {
    const p = fixture(),
      c = p.clips[0];
    const trimmed = trimClip(p, c.id, "end", 3).clips[0];
    for (const field of [
      "fadeIn",
      "fadeOut",
      "audioFadeIn",
      "audioFadeOut",
    ] as const)
      expect(trimmed[field]).toBeLessThanOrEqual(1);
    expect(splitClip(p, c.id, NaN)).toBe(p);
    expect(trimClip(p, c.id, "start", Infinity)).toBe(p);
  });
  it("respects track locks in all model edits and minimum frame split", () => {
    const p = fixture(),
      c = p.clips[0];
    p.tracks[1].locked = true;
    expect(splitClip(p, c.id, 5)).toBe(p);
    expect(trimClip(p, c.id, "end", 5)).toBe(p);
    expect(changeClipSpeed(p, c.id, 4)).toBe(p);
    p.tracks[1].locked = false;
    expect(splitClip(p, c.id, c.start)).toBe(p);
    expect(splitClip(p, c.id, c.start + c.duration)).toBe(p);
  });
});

describe("untrusted project validation", () => {
  it("accepts own projects and image duration zero; returns detached data", () => {
    const p = fixture(),
      safe = validateProject(p);
    expect(safe).toEqual(p);
    safe.clips[0].transform.x = 40;
    expect(p.clips[0].transform.x).toBe(0);
    const empty = createProject();
    expect(() => validateProject(empty)).not.toThrow();
    p.assets[0].kind = "image";
    p.assets[0].duration = 0;
    expect(() => validateProject(p)).not.toThrow();
  });
  it.each([
    "start",
    "duration",
    "sourceIn",
    "speed",
    "volume",
    "fadeIn",
    "fadeOut",
    "audioFadeIn",
    "audioFadeOut",
  ])("rejects missing and coerced clip %s", (field) => {
    for (const invalid of [undefined, null, "1", NaN, Infinity]) {
      const p = fixture();
      (p.clips[0] as unknown as Record<string, unknown>)[field] = invalid;
      expect(() => validateProject(p)).toThrow();
    }
  });
  it.each(["x", "y", "scale", "rotation", "opacity", "flipX", "flipY"])(
    "rejects missing transform %s",
    (field) => {
      const p = fixture();
      delete (p.clips[0].transform as unknown as Record<string, unknown>)[
        field
      ];
      expect(() => validateProject(p)).toThrow();
    },
  );
  it.each(["brightness", "contrast", "saturation", "temperature", "blur"])(
    "rejects missing adjustment %s",
    (field) => {
      const p = fixture();
      delete (p.clips[0].adjustments as unknown as Record<string, unknown>)[
        field
      ];
      expect(() => validateProject(p)).toThrow();
    },
  );
  it("rejects malformed objects, bad references, duplicate IDs and bad keyframe windows", () => {
    for (const mutate of [
      (p: Project) => {
        p.clips[0].transform = null as never;
      },
      (p: Project) => {
        p.assets[0] = null as never;
      },
      (p: Project) => {
        p.tracks[0].id = p.tracks[1].id;
      },
      (p: Project) => {
        p.clips[0].trackId = "missing";
      },
      (p: Project) => {
        p.clips[0].keyframes[1].easingWindow = { start: 0.8, end: 0.2 };
      },
      (p: Project) => {
        p.clips[0].keyframes[0].easingWindow = { start: 0, end: 1 };
      },
      (p: Project) => {
        p.clips[0].keyframes[1].time = 9;
      },
      (p: Project) => {
        p.clips[0].speed = 8;
      },
      (p: Project) => {
        p.tracks[1].muted = undefined as never;
      },
      (p: Project) => {
        p.background = "url(https://invalid)";
      },
    ]) {
      const p = fixture();
      mutate(p);
      expect(() => validateProject(p)).toThrow();
    }
  });
  it("validates every required text field rather than trusting a shape assertion", () => {
    const p = createProject();
    p.clips = [createClip(undefined, p.tracks[0].id, 0, p.fps)];
    expect(() => validateProject(p)).not.toThrow();
    for (const field of [
      "text",
      "fontSize",
      "fontFamily",
      "color",
      "background",
      "align",
      "bold",
      "stroke",
      "strokeWidth",
    ]) {
      const invalid = structuredClone(p);
      delete (invalid.clips[0].text as unknown as Record<string, unknown>)[
        field
      ];
      expect(() => validateProject(invalid)).toThrow();
    }
  });
});

describe("optional source-space visual settings validation", () => {
  it("accepts old projects without new fields and retains settings across split/trim/speed", () => {
    const p = fixture(),
      c = p.clips[0];
    expect(() => validateProject(p)).not.toThrow();
    c.crop = { x: 0.1, y: 0.2, width: 0.8, height: 0.7 };
    c.chromaKey = {
      enabled: true,
      color: "#00ff00",
      similarity: 0.15,
      blend: 0.1,
    };
    c.mask = {
      shape: "ellipse",
      width: 0.8,
      height: 0.7,
      feather: 0.1,
      invert: false,
    };
    expect(() => validateProject(p)).not.toThrow();
    for (const next of [
      splitClip(p, c.id, 5),
      trimClip(p, c.id, "start", 4),
      changeClipSpeed(p, c.id, 4),
    ])
      for (const clip of next.clips) {
        expect(clip.crop).toEqual(c.crop);
        expect(clip.chromaKey).toEqual(c.chromaKey);
        expect(clip.mask).toEqual(c.mask);
        expect(() => validateProject(next)).not.toThrow();
      }
  });
  it("rejects each missing, coerced or nonfinite crop coordinate and checks bounds", () => {
    for (const field of ["x", "y", "width", "height"])
      for (const invalid of [undefined, "0.5", NaN, Infinity, null]) {
        const p = fixture();
        p.clips[0].crop = { x: 0, y: 0, width: 1, height: 1 };
        (p.clips[0].crop as unknown as Record<string, unknown>)[field] =
          invalid;
        expect(() => validateProject(p)).toThrow();
      }
    for (const crop of [
      { x: -0.1, y: 0, width: 1, height: 1 },
      { x: 0.1, y: 0, width: 1, height: 1 },
      { x: 0, y: 0.5, width: 1, height: 0.6 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 0.009, height: 1 },
    ]) {
      const p = fixture();
      p.clips[0].crop = crop;
      expect(() => validateProject(p)).toThrow();
    }
  });
  it("rejects chroma and mask malformed fields while accepting exact interval boundaries", () => {
    const base = fixture();
    base.clips[0].chromaKey = {
      enabled: false,
      color: "#aAbB00",
      similarity: 0.01,
      blend: 0,
    };
    base.clips[0].mask = {
      shape: "rectangle",
      width: 0.01,
      height: 1,
      feather: 0.5,
      invert: true,
    };
    expect(() => validateProject(base)).not.toThrow();
    for (const [object, fields] of [
      ["chromaKey", ["enabled", "color", "similarity", "blend"]],
      ["mask", ["shape", "width", "height", "feather", "invert"]],
    ] as const)
      for (const field of fields) {
        const p = structuredClone(base);
        delete (p.clips[0][object] as unknown as Record<string, unknown>)[
          field
        ];
        expect(() => validateProject(p)).toThrow();
      }
    for (const invalid of ["red", "#fff", "#ff000080", "url(x)"]) {
      const p = structuredClone(base);
      p.clips[0].chromaKey!.color = invalid;
      expect(() => validateProject(p)).toThrow();
    }
    for (const invalid of [-0.1, 0.501, NaN, "0"]) {
      const p = structuredClone(base);
      p.clips[0].mask!.feather = invalid as number;
      expect(() => validateProject(p)).toThrow();
    }
  });
});
