import { describe, it, expect } from "vitest";
import {
  canMoveToTrack,
  formatTimelineTime,
  formatRulerTime,
  layoutTrackClips,
  rulerInterval,
  snapTimelineTime,
  waveformSamples,
} from "../src/components/Timeline";
import {
  COLOR_PRESETS,
  fadePatch,
  presetPatch,
} from "../src/components/EffectsPanel";
import { createClip, createProject, createTrack } from "../src/core/model";
import type { MediaAsset } from "../src/core/types";
const video: MediaAsset = {
  id: "v",
  name: "video",
  kind: "video",
  duration: 10,
  path: "",
  url: "",
  fps: 30,
  width: 1920,
  height: 1080,
  hasAudio: true,
};

describe("timeline positioning", () => {
  it("partitions overlaps into separate sublanes while adjacent clips share one lane", () => {
    const a = { ...createClip(video, "t", 0, 30), duration: 5 };
    const b = { ...createClip(video, "t", 2, 30), duration: 4 };
    const c = { ...createClip(video, "t", 5, 30), duration: 2 };
    const layout = layoutTrackClips([c, a, b]);
    expect(layout.count).toBe(2);
    expect(layout.height).toBe(132);
    expect(layout.lanes.get(a.id)).toBe(0);
    expect(layout.lanes.get(b.id)).toBe(1);
    expect(layout.lanes.get(c.id)).toBe(0);
  });
  it("empty tracks retain a usable target height", () => {
    expect(layoutTrackClips([]).height).toBe(70);
  });
  it("snaps only within the pixel-derived threshold and chooses the nearest edge", () => {
    expect(snapTimelineTime(3.09, [3, 3.2], 0.12)).toBe(3);
    expect(snapTimelineTime(3.09, [3, 3.2], 0.05)).toBe(3.09);
    expect(snapTimelineTime(3.17, [3, 3.2], 0.12)).toBe(3.2);
  });
  it("formats rounded frames without crossing minute boundary incorrectly", () => {
    expect(formatTimelineTime(59.99, 30)).toBe("01:00:00");
    expect(formatTimelineTime(-1, 30)).toBe("00:00:00");
  });
  it("labels fractional ticks accurately above one second", () => {
    expect(formatRulerTime(1.5, true)).toBe("00:01.5");
    expect(formatRulerTime(60.5, true)).toBe("01:00.5");
  });
  it("keeps ruler tick labels readable at different zoom levels", () => {
    expect(rulerInterval(8)).toBe(10);
    expect(rulerInterval(240)).toBe(0.5);
  });
  it("samples a trimmed and sped-up waveform from the relevant source interval", () => {
    const clip = {
      ...createClip(video, "t", 0, 30),
      sourceIn: 2,
      speed: 2,
      duration: 2,
    };
    expect(
      waveformSamples(
        clip,
        Array.from({ length: 10 }, (_, n) => n / 10),
        3,
        10,
      ),
    ).toEqual([0.2, 0.4, 0.6]);
  });
  it("prevents mismatched and locked track drops, allowing images onto visual tracks", () => {
    const project = createProject();
    const visual = createTrack("video"),
      audio = createTrack("audio"),
      text = createTrack("text");
    project.assets = [video, { ...video, id: "a", kind: "audio" }];
    const clip = createClip(video, visual.id, 0, 30),
      sound = createClip(project.assets[1], audio.id, 0, 30),
      title = createClip(undefined, text.id, 0, 30);
    expect(canMoveToTrack(clip, visual, project)).toBe(true);
    expect(canMoveToTrack(clip, audio, project)).toBe(false);
    expect(canMoveToTrack(clip, createTrack("image"), project)).toBe(false);
    expect(canMoveToTrack(sound, visual, project)).toBe(false);
    expect(canMoveToTrack(title, text, project)).toBe(true);
    expect(canMoveToTrack(clip, { ...visual, locked: true }, project)).toBe(
      false,
    );
  });
});
describe("local effects", () => {
  it("constructs complete adjustment parameters using multiplicative defaults", () => {
    const patch = presetPatch(COLOR_PRESETS.find((p) => p.id === "mono")!);
    expect(patch.adjustments?.saturation).toBe(0);
    expect(patch.adjustments?.contrast).toBe(1.15);
    expect(patch.adjustments?.brightness).toBe(0);
  });
  it("preserves existing adjustments when a partial preset is applied", () => {
    const clip = createClip(video, "t", 0, 30);
    clip.adjustments.blur = 3;
    const patch = presetPatch(
      {
        id: "custom",
        name: "",
        description: "",
        colors: "",
        adjustments: { saturation: 0.5 },
      },
      clip,
    );
    expect(patch.adjustments?.blur).toBe(3);
    expect(patch.adjustments?.saturation).toBe(0.5);
  });
  it("clamps two-ended fades to avoid overlap and keeps audio/visual parameters separate", () => {
    expect(fadePatch("visual", "both", 5, 2)).toEqual({
      fadeIn: 1,
      fadeOut: 1,
    });
    expect(fadePatch("audio", "in", 0.5, 2)).toEqual({
      audioFadeIn: 0.5,
      audioFadeOut: 0,
    });
    expect(fadePatch("visual", "none", 0, 2)).toEqual({
      fadeIn: 0,
      fadeOut: 0,
    });
  });
});
