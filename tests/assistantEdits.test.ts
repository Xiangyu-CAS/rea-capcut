import { beforeEach, describe, expect, it } from "vitest";
import { assistantProjectContext, assistantRequestMode, assistantTranscriptionRequest, previewAssistantEdits } from "../src/core/assistantEdits";
import { clone, createClip, createProject, createTrack, evaluateFade, evaluateKeyframes } from "../src/core/model";
import { agentPlanStatus, useEditorStore } from "../src/editor/store";
import { validateAssistantRequest } from "../electron/assistantBackend";
import type { Project } from "../src/core/types";
import type { AssistantTranscription } from "../src/core/assistantTypes";

function fixture(): Project {
  const p = createProject("合成项目");
  p.assets = [{ id: "asset", name: "合成视频", path: "/tmp/private-synthetic.mp4", url: "reacut-media://private", kind: "video", duration: 20, width: 640, height: 360, fps: 30, hasAudio: true }];
  const c = createClip(p.assets[0], p.tracks[1].id, 2, p.fps);
  c.id = "clip"; c.duration = 8; c.sourceIn = 2; c.speed = 2;
  c.fadeIn = 2; c.fadeOut = 3; c.audioFadeIn = 1; c.audioFadeOut = 2;
  c.keyframes = [
    { id: "key0", property: "x", time: 0, value: 0, easing: "linear" },
    { id: "key1", property: "x", time: 8, value: 800, easing: "easeInOut" },
  ];
  p.clips = [c]; return p;
}
beforeEach(() => useEditorStore.getState().setProject(createProject()));

describe("assistant atomic edit proposals", () => {
  it("adds translated text from a transcript at the original media times and supports one undo", () => {
    useEditorStore.getState().setProject(fixture());
    const project = useEditorStore.getState().project;
    const transcription: AssistantTranscription = {
      id: "test-speech", request: assistantTranscriptionRequest("clip:clip"), time: 0,
      cues: [{ start: 1, end: 3, text: "你好" }, { start: 4, end: 7, text: "再见" }],
    };
    const caption = { type: "addCaptions", transcriptionId: transcription.id, translations: ["Hello", "Goodbye"] };
    expect(() => previewAssistantEdits(project, [caption])).toThrow("转录已失效");
    expect(() => previewAssistantEdits(project, [caption, { type: "trimClip", clipId: "clip", edge: "start", time: 3 }], "en", [transcription]))
      .toThrow("source range changed");
    expect(() => previewAssistantEdits(project, [{ ...caption, translations: ["Hello"] }], "en", [transcription]))
      .toThrow("one translation for each");
    useEditorStore.getState().submitAgentEdits(project, [caption], {
      source: "agent", mode: "edit", transcriptions: [transcription],
    });
    const [video, ...cues] = useEditorStore.getState().project.clips;
    expect(video).toEqual(project.clips[0]);
    expect(cues).toMatchObject([
      { start: 2.5, duration: 1, text: { text: "Hello" } },
      { start: 4, duration: 1.5, text: { text: "Goodbye" } },
    ]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.clips).toEqual(project.clips);
  });

  it("limits transcription to an attached source range and places that range when adding captions", () => {
    const project = fixture();
    project.clips = [];
    const range = { sourceIn: 5, duration: 3 };
    const request = assistantTranscriptionRequest("asset:asset", undefined, [{ assetId: "asset", range }]);
    const action = { type: "addCaptions", transcriptionId: "media-transcript" };
    const result = previewAssistantEdits(project, [action], "en", [{
      id: action.transcriptionId, request, time: 10, cues: [{ start: 0.5, end: 2, text: "Test caption" }],
    }]);
    expect(() => assistantTranscriptionRequest("asset:/tmp/media.mp4")).toThrow();
    expect(result.project.clips).toMatchObject([
      { assetId: "asset", start: 10, ...range },
      { start: 10.5, duration: 1.5, text: { text: "Test caption" } },
    ]);
  });
  it("validates all operations on a clone and leaves the project untouched on later failure", () => {
    const p = fixture(), snapshot = clone(p);
    expect(() => previewAssistantEdits(p, [
      { type: "setVolume", clipId: "clip", volume: .4 },
      { type: "addText", text: "新增", start: 0, duration: 2 },
      { type: "deleteClip", clipId: "missing" },
    ])).toThrow("不存在");
    expect(p).toEqual(snapshot);
  });
  it("publishes a direct multi-action edit and its result as one reversible update", () => {
    const p = fixture();
    useEditorStore.getState().setProject(p);
    const before = useEditorStore.getState().project;
    const published: boolean[] = [];
    const stop = useEditorStore.subscribe(state => published.push(state.agentPlan?.status === "applied"));
    try {
      useEditorStore.getState().submitAgentEdits(before, [
        { type: "setVolume", clipId: "clip", volume: .4 },
        { type: "addText", text: "新增", start: 0, duration: 2 },
        { type: "setProject", width: 1080, height: 1920 },
      ], { source: "agent", mode: "edit" });
    } finally {
      stop();
    }
    expect(published).toEqual([true]);
    expect(useEditorStore.getState().past).toHaveLength(1);
    expect(useEditorStore.getState().project.clips).toHaveLength(2);
    useEditorStore.getState().undo(); expect(useEditorStore.getState().project).toEqual(before);
    useEditorStore.getState().redo(); expect(useEditorStore.getState().project.clips).toHaveLength(2);
  });
  it("tracks the plan's history entry across timeline switches and other edits", () => {
    const current = useEditorStore.getState;
    current().setProject(fixture());
    const mainTimeline = current().project.activeTimeline?.id ?? current().project.id;
    current().createTimeline("Alternate", "Main", false);
    const alternateTimeline = current().project.activeTimeline!.id;
    current().openTimeline(mainTimeline);
    current().updateProject({ name: "Earlier edit" });
    const base = current().project;
    const plan = current().submitAgentEdits(base, [
      { type: "setVolume", clipId: "clip", volume: .4 },
    ], { source: "chatgpt", mode: "preview" });
    current().applyAgentPlan(plan.id);
    current().updateProject({ name: "Later edit" });
    current().openTimeline(alternateTimeline);
    const status = () => agentPlanStatus(current().agentPlan!, current().project);
    const mainClip = () => current().project.otherTimelines!.find(timeline => timeline.id === mainTimeline)!.clips[0];

    current().undo();
    expect(status()).toBe("applied");
    current().undo();
    expect(current().project.activeTimeline?.id).toBe(alternateTimeline);
    expect(mainClip().volume).toBe(base.clips[0].volume);
    expect(status()).toBe("undone");
    current().undo();
    expect(status()).toBe("undone");
    current().redo();
    expect(status()).toBe("undone");
    current().redo();
    expect(mainClip().volume).toBe(.4);
    expect(status()).toBe("applied");
    current().undo();
    current().updateProject({ name: "New history branch" });
    expect(current().future).toHaveLength(0);
    expect(status()).toBe("undone");
  });
  it.each(["edit", "preview"] as const)("reports an unchanged %s without altering undo or redo history", mode => {
    const current = useEditorStore.getState;
    current().setProject(fixture());
    current().updateProject({ name: "Earlier edit" });
    current().updateProject({ name: "Later edit" });
    current().undo();
    current().seek(3);
    current().select(["clip"]);
    const before = current();
    const plan = before.submitAgentEdits(before.project, [
      { type: "setProject", name: before.project.name },
    ], { source: "agent", mode });
    expect(plan.status).toBe("unchanged");
    expect(plan.preview.descriptions).toEqual([]);
    expect(current().project).toBe(before.project);
    expect(current().past).toBe(before.past);
    expect(current().future).toBe(before.future);
    expect(current().playhead).toBe(3);
    expect(current().selectedIds).toEqual(["clip"]);
    current().setAgentPreview(plan.id);
    expect(current().agentPreviewId).toBeNull();
    expect(() => current().applyAgentPlan(plan.id)).toThrow();
  });
  it("keeps the current project and undo history when an automatic batch conflicts", () => {
    useEditorStore.getState().setProject(fixture());
    const state = useEditorStore.getState();
    const actions = [{ type: "deleteClip", clipId: "clip" }];
    state.beginTransaction();
    expect(() => state.submitAgentEdits(state.project, actions, { source: "agent", mode: "edit" })).toThrow();
    expect(useEditorStore.getState().project).toBe(state.project);
    expect(useEditorStore.getState().past).toHaveLength(0);
    state.endTransaction();
    state.updateProject({ name: "Manual change" });
    const current = useEditorStore.getState();
    expect(() => state.submitAgentEdits(state.project, actions, { source: "agent", mode: "edit" })).toThrow();
    expect(useEditorStore.getState()).toBe(current);
  });
  it("proposes source ranges for a rough cut and rejects ranges beyond the media", () => {
    const p = fixture();
    const preview = previewAssistantEdits(p, [{ type: "addAsset", assetId: "asset", start: 12, sourceIn: 3.5, duration: 2 }], "en");
    expect(preview.project.clips.at(-1)).toMatchObject({ start: 12, sourceIn: 3.5, duration: 2 });
    expect(preview.descriptions[0]).toContain("Source in 3.50s");
    expect(() => previewAssistantEdits(p, [{ type: "addAsset", assetId: "asset", start: 12, sourceIn: 19, duration: 2 }])).toThrow("超出素材范围");
    expect(p.clips).toHaveLength(1);
  });
  it("blocks changes to locked source tracks and locked/incompatible destinations", () => {
    const p = fixture(); p.tracks[1].locked = true;
    for (const action of [{ type: "deleteClip", clipId: "clip" }, { type: "setVolume", clipId: "clip", volume: 0 }, { type: "splitClip", clipId: "clip", time: 5 }])
      expect(() => previewAssistantEdits(p, [action])).toThrow("锁定");
    expect(() => previewAssistantEdits(p, [{ type: "addAsset", assetId: "asset", start: 0, trackId: p.tracks[1].id }])).toThrow("锁定");
    p.tracks[1].locked = false;
    expect(() => previewAssistantEdits(p, [{ type: "moveClip", clipId: "clip", start: 0, trackId: p.tracks[0].id }])).toThrow("不兼容");
  });
  it.each([
    { type: "execute", code: "do not execute" }, { type: "setVolume", clipId: "clip", volume: 1, path: "/tmp/no" },
    { type: "setVolume", clipId: "clip", volume: NaN }, { type: "setSpeed", clipId: "clip", speed: Infinity },
    { type: "moveClip", clipId: "clip", start: -1 }, { type: "setVolume", clipId: "clip", volume: 1, muted: "yes" },
    { type: "deleteClip", clipId: "missing" }, { type: "addAsset", assetId: "missing", start: 0 },
    { type: "setTransform", clipId: "clip" }, { type: "setProject" },
    { type: "setProject", fps: 29.97 }, { type: "setProject", width: 1279.5 },
    { type: "addText", text: "bad color", start: 0, duration: 1, color: "url(secret)" },
  ])("rejects malformed operation %#", action => expect(() => previewAssistantEdits(fixture(), [action])).toThrow());
  it("rejects invalid list/object prototypes and too many operations", () => {
    for (const actions of [[], null, Array(41).fill({ type: "deleteClip", clipId: "clip" }), [new Date()], [Object.create({ type: "deleteClip", clipId: "clip" })]])
      expect(() => previewAssistantEdits(fixture(), actions)).toThrow();
  });
  it("bounds cuts to the existing clip and prevents source or 24-hour overflow", () => {
    const p = fixture();
    for (const action of [{ type: "trimClip", clipId: "clip", edge: "start", time: 1 }, { type: "splitClip", clipId: "clip", time: 2 }, { type: "splitClip", clipId: "clip", time: 10 }, { type: "addAsset", assetId: "asset", start: 0, duration: 21 }, { type: "moveClip", clipId: "clip", start: 86399 }])
      expect(() => previewAssistantEdits(p, [action])).toThrow();
  });
  it("applies a valid one-frame split instead of reporting a silent no-op", () => {
    const p = fixture();
    const preview = previewAssistantEdits(p, [{ type: "splitClip", clipId: "clip", time: 2 + 1 / 30 }]);
    expect(preview.project.clips).toHaveLength(2);
    expect(preview.project.clips[0].duration).toBeCloseTo(1 / 30, 10);
    expect(preview.before.clips).toBe(1); expect(preview.after.clips).toBe(2);
  });
  it("preserves animation, source range and fades through trim, speed and split", () => {
    const p = fixture(), original = clone(p.clips[0]);
    const cut = previewAssistantEdits(p, [{ type: "trimClip", clipId: "clip", edge: "start", time: 4 }, { type: "trimClip", clipId: "clip", edge: "end", time: 8 }, { type: "setSpeed", clipId: "clip", speed: 4 }]).project;
    expect(cut.clips[0]).toMatchObject({ start: 4, duration: 2, sourceIn: 6, speed: 4 });
    const parts = previewAssistantEdits(cut, [{ type: "splitClip", clipId: "clip", time: 5 }]).project.clips;
    for (let t = 0; t <= 2; t += .125) {
      const part = t <= 1 ? parts[0] : parts[1], local = t <= 1 ? t : t - 1;
      expect(evaluateKeyframes(part, local).transform.x).toBeCloseTo(evaluateKeyframes(original, 2 + t * 2).transform.x, 8);
      for (const kind of ["video", "audio"] as const)
        expect(evaluateFade(part, local, kind)).toBeCloseTo(evaluateFade(original, 2 + t * 2, kind), 8);
    }
    expect(parts[1].sourceIn).toBe(10);
  });
  it("replaces prior trim fade windows when explicitly setting fades", () => {
    const trimmed = previewAssistantEdits(fixture(), [{ type: "trimClip", clipId: "clip", edge: "start", time: 4 }]).project;
    const next = previewAssistantEdits(trimmed, [{ type: "setFades", clipId: "clip", fadeIn: 1, fadeOut: 1, audioFadeIn: .5, audioFadeOut: .5 }]).project.clips[0];
    expect(next.videoFadeWindow).toBeUndefined(); expect(next.audioFadeWindow).toBeUndefined();
    expect(evaluateFade(next, .5, "video")).toBe(.5);
  });
  it("does not silently ignore an explicit property change because keyframes override it", () => {
    const p = fixture();
    expect(() => previewAssistantEdits(p, [{ type: "setTransform", clipId: "clip", x: 200 }])).toThrow("关键帧");
    p.clips[0].keyframes.push({ id: "volume-key", property: "volume", time: 0, value: .5, easing: "linear" });
    expect(() => previewAssistantEdits(p, [{ type: "setVolume", clipId: "clip", volume: .1 }])).toThrow("关键帧");
    expect(previewAssistantEdits(p, [{ type: "setTransform", clipId: "clip", y: 100 }]).project.clips[0].transform.y).toBe(100);
  });
  it("shows actual values and target tracks in review descriptions", () => {
    const p = fixture();
    const track = createTrack("video", "目标轨"); p.tracks.push(track);
    const preview = previewAssistantEdits(p, [
      { type: "setTransform", clipId: "clip", y: 60, rotation: 30, scale: .8 },
      { type: "setFades", clipId: "clip", fadeIn: 1, fadeOut: 2, audioFadeIn: .5, audioFadeOut: .75 },
      { type: "moveClip", clipId: "clip", start: 4, trackId: track.id },
      { type: "setProject", name: "成片", background: "#123456" },
    ]);
    expect(preview.descriptions[0]).toContain("Y 60"); expect(preview.descriptions[0]).toContain("旋转 30°"); expect(preview.descriptions[0]).toContain("缩放 0.8×");
    expect(preview.descriptions[1]).toContain("画面淡入 1s · 淡出 2s · 声音淡入 0.5s · 淡出 0.75s");
    expect(preview.descriptions[2]).toContain("目标轨"); expect(preview.descriptions[2]).toContain("4.00s");
    expect(preview.descriptions[3]).toContain("成片"); expect(preview.descriptions[3]).toContain("#123456");
  });
});

describe("assistant request modes", () => {
  it("honors the composer and lets explicit wording narrow its scope", () => {
    expect(assistantRequestMode("edit", "Add an opening title.")).toBe("edit");
    expect(assistantRequestMode("preview", "Add an opening title.")).toBe("preview");
    expect(assistantRequestMode("answer", "Add an opening title.")).toBe("answer");
    expect(assistantRequestMode("edit", "先预览粗剪效果，等我确认")).toBe("preview");
    expect(assistantRequestMode("edit", "Show me a preview before applying.")).toBe("preview");
    expect(assistantRequestMode("edit", "只给建议，先不要剪")).toBe("answer");
    expect(assistantRequestMode("edit", "Just give me advice.")).toBe("answer");
    expect(assistantRequestMode("edit", "先不要剪")).toBe("answer");
    expect(assistantRequestMode("edit", "Do not edit the timeline yet.")).toBe("answer");
    expect(assistantRequestMode("edit", "去掉空镜，但不要剪掉我说话的部分")).toBe("edit");
    expect(assistantRequestMode("edit", "Trim the opening. Don't edit the audio.")).toBe("edit");
    expect(assistantRequestMode("edit", "添加片头「只给建议」")).toBe("edit");
  });
});

describe("assistant project summary privacy and bounds", () => {
  it("keeps useful timing and selection, without paths, media data or unknown fields", () => {
    const p = fixture();
    p.name = "项目 /Users/person/private/video.mp4";
    p.assets[0].name = "文件 C:\\private\\video.mp4";
    p.assets[0].thumbnail = "data:secret"; p.assets[0].waveform = [.5, .6];
    (p.clips[0].transform as unknown as Record<string, unknown>).privateField = "sensitive";
    const context = assistantProjectContext(p, ["clip"], 3), summary = JSON.parse(context);
    expect(summary.clips[0]).toMatchObject({ id: "clip", sourceIn: 2, speed: 2 });
    expect(summary.selectedIds).toEqual(["clip"]);
    for (const secret of ["/Users", "C:\\", "private-synthetic", "reacut-media", "thumbnail", "waveform", "privateField", "sensitive"])
      expect(context).not.toContain(secret);
    expect(() => validateAssistantRequest({ requestId: "summary-test", provider: "codex", prompt: "给建议", history: [], context })).not.toThrow();
  });
  it("bounds a large Unicode summary, preserves the selected clip and retains reference integrity", () => {
    const p = createProject("大量字幕");
    for (let i = 0; i < 130; i++) {
      const track = createTrack("text", "轨道" + i); p.tracks.push(track);
      const clip = createClip(undefined, track.id, i, 30);
      clip.id = "clip-" + i; clip.text!.text = "中文标题".repeat(100); p.clips.push(clip);
    }
    const context = assistantProjectContext(p, ["clip-129"], 129), summary = JSON.parse(context);
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(100000);
    expect(summary.clips.some((c: any) => c.id === "clip-129")).toBe(true);
    expect(summary.clips.every((c: any) => summary.tracks.some((t: any) => t.id === c.trackId))).toBe(true);
    expect(summary.truncated).toBe(true);
    expect(() => validateAssistantRequest({ requestId: "summary-test", provider: "codex", prompt: "建议", history: [], context })).not.toThrow();
  });
  it("does not transmit paths encoded in names, ids or source metadata", () => {
    const p = fixture(); p.clips[0].name = "/mnt/private/recording";
    p.id = "/Users/private/project";
    p.assets[0].id = "/etc/private/asset"; p.clips[0].assetId = p.assets[0].id;
    const context = assistantProjectContext(p, [], 0);
    for (const secret of ["/mnt/private", "/Users/private", "/etc/private"]) expect(context).not.toContain(secret);
    expect(() => validateAssistantRequest({ requestId: "summary-test", provider: "codex", prompt: "建议", history: [], context })).not.toThrow();
  });
  it("keeps an attached source range beyond the asset limit and drops invalid selections", () => {
    const p = fixture(), original = p.assets[0];
    p.assets.push(...Array.from({ length: 110 }, (_, index) => ({ ...original, id: "asset-" + index })));
    const selected = { assetId: "asset-109", range: { sourceIn: 4, duration: 2 } };
    const context = assistantProjectContext(p, [], 0, [], [
      selected,
      { assetId: "asset-1", range: { sourceIn: 18, duration: 3 } },
      { assetId: "missing" },
    ]);
    const summary = JSON.parse(context);
    expect(summary.selectedMedia).toEqual([selected]);
    expect(summary.assets[0].id).toBe(selected.assetId);
    expect(summary.truncated).toBe(true);
    expect(context).not.toContain(original.path);
  });
  it("enforces the byte budget independently of list limits for long Unicode text", () => {
    const p = createProject("大量同轨字幕");
    for (let i = 0; i < 100; i++) {
      const clip = createClip(undefined, p.tracks[0].id, i, 30);
      clip.id = "caption-" + i; clip.text!.text = "中文标题".repeat(125); p.clips.push(clip);
    }
    const context = assistantProjectContext(p, ["caption-99"], 99), summary = JSON.parse(context);
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(90000);
    expect(summary.clips.length).toBeLessThan(100);
    expect(summary.clips[0].id).toBe("caption-99");
    expect(summary.truncated).toBe(true);
    expect(() => validateAssistantRequest({ requestId: "summary-test", provider: "codex", prompt: "建议", history: [], context })).not.toThrow();
  });
});
