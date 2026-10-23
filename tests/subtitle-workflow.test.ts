import { parseSubtitles, stringifySubtitles } from "../src/core/subtitles";
import { describe, it, expect } from "vitest";
import {
  createProject,
  createClip,
  evaluateKeyframes,
  evaluateFade,
  validateProject,
  clone,
} from "../src/core/model";
import {
  applySubtitleEdit,
  prepareSubtitleEdit,
  type SubtitleEdit,
} from "../src/core/subtitleEdits";
import { subtitleAnimation, TEXT_MOTIONS } from "../src/core/subtitleWorkflow";
import { useEditorStore } from "../src/editor/store";
function fixture() {
  const p = createProject();
  p.tracks[0].name = "字幕";
  p.clips = [0, 2, 5].map((start, i) => {
    const c = createClip(undefined, p.tracks[0].id, start, 30);
    c.id = "cue" + i;
    c.duration = 3;
    c.text!.text = ["你好👩🏽‍💻世界 Hello", "第二句\nOverlap", "Third subtitle"][i];
    return c;
  });
  return p;
}
const animation = {
  entrance: "slide-up",
  exit: "zoom",
  inDuration: 0.5,
  outDuration: 0.5,
  distance: 40,
} as const;
it.each(["srt", "vtt"] as const)(
  "keeps plain %s cues usable through animation and SRT round-trip",
  (format) => {
    const input =
      format === "vtt"
        ? "WEBVTT\n\n00:00.000 --> 00:03.000 align:start\n你好 Hello\n\n00:02.500 --> 00:05.000\n重叠字幕"
        : "1\n00:00:00,000 --> 00:00:03,000\n你好 Hello\n\n2\n00:00:02,500 --> 00:00:05,000\n重叠字幕";
    const original = parseSubtitles(input);
    expect(original).toHaveLength(2);
    const s = useEditorStore.getState();
    s.setProject(createProject());
    s.addSubtitles(original);
    const p = useEditorStore.getState().project;
    const edited = prepareSubtitleEdit(
      p,
      p.clips.map((c) => c.id),
      { type: "animation", options: animation },
    ).project;
    const plain = stringifySubtitles(
      edited.clips.map((c) => ({
        start: c.start,
        end: c.start + c.duration,
        text: c.text!.text,
      })),
    );
    expect(parseSubtitles(plain)).toEqual(original);
    expect(plain).not.toContain("ease");
  },
);
it("removes animation from a valid subframe legacy cue without stretching it", () => {
  const p = fixture();
  p.clips[0].duration = 0.01;
  p.clips[0].keyframes = [
    { id: "k", time: 0, property: "opacity", value: 0, easing: "linear" },
  ];
  const q = prepareSubtitleEdit(p, ["cue0"], {
    type: "animation",
    options: { ...animation, entrance: "none", exit: "none" },
  }).project;
  expect(q.clips[0].duration).toBe(0.01);
  expect(q.clips[0].keyframes).toEqual([]);
});
describe("subtitle split, merge, style and motion", () => {
  it("splits text at a grapheme boundary and time at a frame, preserving sampled curves and fades", () => {
    const p = fixture();
    p.clips[0] = subtitleAnimation(p.clips[0], animation, p.fps);
    p.clips[0].fadeIn = 0.8;
    p.clips[0].fadeOut = 0.8;
    const c = p.clips[0],
      offset = "你好👩🏽‍💻".length;
    const plan = prepareSubtitleEdit(p, [c.id], {
      type: "split",
      at: 1.017,
      offset,
    });
    const left = plan.project.clips.find((k) => k.id === c.id)!,
      right = plan.project.clips.find(
        (k) => !p.clips.some((v) => v.id === k.id),
      )!;
    expect(left.duration).toBeCloseTo(1 + 1 / 30, 10);
    expect(right.start).toBeCloseTo(left.duration, 10);
    expect(left.text!.text + right.text!.text).toBe(c.text!.text);
    for (const part of [left, right])
      for (let t = 0; t < part.duration; t += 1 / 30) {
        for (const key of ["y", "scale", "opacity"] as const)
          expect(evaluateKeyframes(part, t).transform[key]).toBeCloseTo(
            evaluateKeyframes(c, t + part.start).transform[key],
            8,
          );
        expect(evaluateFade(part, t, "video")).toBeCloseTo(
          evaluateFade(c, t + part.start, "video"),
          8,
        );
      }
    expect(plan.changedIds).toHaveLength(2);
    expect(validateProject(JSON.parse(JSON.stringify(plan.project)))).toEqual(
      plan.project,
    );
  });
  it.each([0, 1, 3, 5, 6])(
    "rejects invalid text boundaries %s atomically",
    (offset) => {
      const p = fixture();
      p.clips[0].text!.text = "👩🏽‍💻字";
      const original = clone(p);
      expect(() =>
        prepareSubtitleEdit(p, ["cue0"], { type: "split", at: 1, offset }),
      ).toThrow();
      expect(p).toEqual(original);
    },
  );
  it.each([0, 3, NaN, Infinity])("rejects invalid split times %s", (at) =>
    expect(() =>
      prepareSubtitleEdit(fixture(), ["cue0"], {
        type: "split",
        at,
        offset: 2,
      }),
    ).toThrow(),
  );
  it("merges consecutive cues across overlaps/gaps with newline text and stretches the first appearance", () => {
    const p = fixture();
    p.clips[0] = subtitleAnimation(p.clips[0], animation, p.fps);
    p.clips[0].fadeIn = 0.4;
    const plan = prepareSubtitleEdit(p, ["cue2", "cue0", "cue1"], {
        type: "merge",
      }),
      c = plan.project.clips[0];
    expect(c.duration).toBe(8);
    expect(c.text!.text).toBe(p.clips.map((k) => k.text!.text).join("\n"));
    expect(c.id).toBe("cue0");
    expect(plan.changedIds).toEqual(["cue0", "cue1", "cue2"]);
    for (let t = 0; t <= 8; t += 0.2) {
      for (const property of [
        "x",
        "y",
        "scale",
        "opacity",
        "rotation",
      ] as const)
        expect(evaluateKeyframes(c, t).transform[property]).toBeCloseTo(
          evaluateKeyframes(p.clips[0], (t * 3) / 8).transform[property],
          10,
        );
      expect(evaluateFade(c, t, "video")).toBeCloseTo(
        evaluateFade(p.clips[0], (t * 3) / 8, "video"),
        8,
      );
    }
  });
  it("rejects nonconsecutive, oversized, linked and locked edits without partial changes", () => {
    const p = fixture();
    expect(() =>
      prepareSubtitleEdit(p, ["cue0", "cue2"], { type: "merge" }),
    ).toThrow(/连续/);
    p.clips[0].text!.text = "a".repeat(20000);
    expect(() =>
      prepareSubtitleEdit(p, ["cue0", "cue1"], { type: "merge" }),
    ).toThrow(/20000/);
    p.clips[0].text!.text = "hello";
    p.clips[0].linkId = "linked";
    expect(() =>
      prepareSubtitleEdit(p, ["cue0", "cue1"], { type: "merge" }),
    ).toThrow(/关联/);
    delete p.clips[0].linkId;
    p.tracks[0].locked = true;
    for (const edit of [
      { type: "split", at: 1, offset: 2 },
      { type: "merge" },
      { type: "animation", options: animation },
    ] as SubtitleEdit[])
      expect(() =>
        prepareSubtitleEdit(
          p,
          edit.type === "split" ? ["cue0"] : ["cue0", "cue1"],
          edit,
        ),
      ).toThrow(/锁定/);
  });
  it("applies editable style values while preserving each cue content and animation", () => {
    const p = fixture();
    p.clips[0] = subtitleAnimation(p.clips[0], animation, p.fps);
    const values = {
      fontSize: 38,
      color: "#ffeedd",
      background: "transparent",
      bold: true,
      align: "left",
      stroke: "#112233",
      strokeWidth: 2,
    } as const;
    const q = prepareSubtitleEdit(p, ["cue0", "cue1"], {
      type: "styleValues",
      values,
    }).project;
    for (let i = 0; i < 2; i++) {
      expect(q.clips[i].text).toMatchObject(values);
      expect(q.clips[i].text!.text).toBe(p.clips[i].text!.text);
      expect(q.clips[i].keyframes).toEqual(p.clips[i].keyframes);
    }
    expect(q.clips[2]).toEqual(p.clips[2]);
    expect(() =>
      prepareSubtitleEdit(p, ["cue0"], {
        type: "styleValues",
        values: { ...values, fontSize: NaN },
      }),
    ).toThrow();
    expect(() =>
      prepareSubtitleEdit(p, ["cue0"], {
        type: "styleValues",
        values: { ...values, text: "overwrite" } as any,
      }),
    ).toThrow();
  });
  it.each(TEXT_MOTIONS)(
    "bakes %s entrance/exit, holds base values, preserves unrelated curves and can remove motion",
    (motion) => {
      const p = fixture(),
        c = p.clips[0];
      c.transform.y = 80;
      c.transform.opacity = 0.8;
      c.transform.scale = 1.2;
      c.keyframes = [
        {
          id: "keep",
          time: 0,
          property: "rotation",
          value: 25,
          easing: "linear",
        },
      ];
      c.fadeIn = 0.5;
      const q = prepareSubtitleEdit(p, ["cue0", "cue1"], {
        type: "animation",
        options: { ...animation, entrance: motion, exit: motion },
      }).project;
      const changed = q.clips[0];
      expect(changed.keyframes[0]).toEqual(c.keyframes[0]);
      expect(changed.fadeIn).toBe(0);
      expect(evaluateKeyframes(changed, 1).transform).toMatchObject({
        y: 80,
        opacity: 0.8,
        scale: 1.2,
        rotation: 25,
      });
      if (motion !== "none") {
        expect(evaluateKeyframes(changed, 0).transform.opacity).toBe(0);
        expect(evaluateKeyframes(changed, 3).transform.opacity).toBe(0);
      }
      expect(validateProject(JSON.parse(JSON.stringify(q)))).toEqual(q);
    },
  );
  it("rejects a whole animation batch when one cue is too short, a duration is invalid or key limit exceeded", () => {
    const p = fixture();
    p.clips[1].duration = 0.5;
    const before = clone(p);
    expect(() =>
      prepareSubtitleEdit(p, ["cue0", "cue1"], {
        type: "animation",
        options: animation,
      }),
    ).toThrow(/太短/);
    expect(p).toEqual(before);
    for (const options of [
      { ...animation, inDuration: 0 },
      { ...animation, outDuration: NaN },
      { ...animation, distance: Infinity },
      { ...animation, entrance: "unknown" },
    ])
      expect(() =>
        prepareSubtitleEdit(p, ["cue0"], {
          type: "animation",
          options: options as any,
        }),
      ).toThrow();
    p.clips[0].keyframes = Array.from({ length: 400 }, (_, i) => ({
      id: String(i),
      property: "x",
      time: i / 200,
      value: i,
      easing: "linear",
    }));
    expect(() =>
      prepareSubtitleEdit(p, ["cue0"], {
        type: "animation",
        options: animation,
      }),
    ).toThrow();
  });
  it("undoes each structural/batch edit in one step and rejects stale merge plans", () => {
    const p = fixture(),
      s = useEditorStore.getState();
    s.setProject(p);
    const plan = prepareSubtitleEdit(p, ["cue0", "cue1"], { type: "merge" });
    s.commit(
      applySubtitleEdit(
        s.project === p ? p : useEditorStore.getState().project,
        plan,
      ),
    );
    expect(useEditorStore.getState().past).toHaveLength(1);
    s.undo();
    expect(useEditorStore.getState().project).toEqual(p);
    s.redo();
    expect(useEditorStore.getState().project.clips).toHaveLength(2);
    expect(() => applySubtitleEdit({ ...p, name: "changed" }, plan)).toThrow(
      /项目已变化/,
    );
  });
});

it("bakes an editable breathing hold and preserves its phase through splits", () => {
  const p = fixture();
  const options = { ...animation, hold: "pulse" as const, pulseAmount: 0.1 };
  const animated = prepareSubtitleEdit(p, ["cue0"], {
    type: "animation",
    options,
  }).project;
  expect(evaluateKeyframes(animated.clips[0], 1.5).transform.scale).toBeCloseTo(
    1.1,
    10,
  );
  const cut = prepareSubtitleEdit(animated, ["cue0"], {
    type: "split",
    at: 1.5,
    offset: 2,
  }).project;
  const right = cut.clips.find((c) => c.start === 1.5)!;
  for (let t = 0; t < 1.5; t += 1 / 30)
    expect(evaluateKeyframes(right, t).transform.scale).toBeCloseTo(
      evaluateKeyframes(animated.clips[0], t + 1.5).transform.scale,
      10,
    );
  p.clips[0].duration = 1 + 1 / 30;
  expect(() =>
    prepareSubtitleEdit(p, ["cue0"], { type: "animation", options }),
  ).toThrow(/两帧/);
  expect(() =>
    prepareSubtitleEdit(fixture(), ["cue0"], {
      type: "animation",
      options: { ...options, pulseAmount: Infinity },
    }),
  ).toThrow(/幅度/);
});
