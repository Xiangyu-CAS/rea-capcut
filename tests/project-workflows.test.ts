import { describe, expect, it } from "vitest";
import { createClip, createProject, splitClip, trimClip, validateProject } from "../src/core/model";
import { activateTimeline, addProjectTimeline } from "../src/core/projectTimelines";
import { averageSpeed, sourceOffsetAt, timelineOffsetAt } from "../src/core/speedCurve";
import { importCapcutTimelines } from "../src/core/capcutImport";
import { splitAtBeats } from "../src/core/timelineEdits";
import type { MediaAsset } from "../src/core/types";
import { clipBeatTimes } from "../src/core/beats";

const asset: MediaAsset = {
  id: "source", kind: "video", name: "Synthetic video", path: "/test/source.mp4", url: "/test/source.mp4",
  width: 320, height: 180, duration: 10, fps: 30, hasAudio: true,
};

function projectWithClip() {
  const project = createProject();
  project.assets = [asset];
  const clip = createClip(asset, project.tracks[1].id, 0, project.fps);
  clip.duration = 4;
  clip.sourceIn = 1;
  project.clips = [clip];
  return { project, clip };
}

describe("timeline and source timing", () => {
  it("duplicates independent timeline identities and keeps the old canvas and shared source", () => {
    const { project, clip } = projectWithClip();
    const copy = addProjectTimeline(project, "Vertical", "Wide", true);
    copy.width = 720;
    copy.height = 1280;
    const reopened = validateProject(JSON.parse(JSON.stringify(copy)));
    expect(reopened.clips[0].id).not.toBe(clip.id);
    expect(reopened.assets).toEqual([asset]);
    const wide = activateTimeline(reopened, project.id);
    expect([wide.width, wide.height, wide.clips[0].id]).toEqual([1920, 1080, clip.id]);
    expect(activateTimeline(wide, reopened.activeTimeline!.id)).toMatchObject({
      width: 720, height: 1280, clips: reopened.clips,
    });
    wide.otherTimelines![0].clips[0].trackId = wide.tracks[1].id;
    expect(() => validateProject(wide)).toThrow(/轨道引用/);
  });

  it("keeps the same source samples when trimming and splitting a speed ramp", () => {
    const { project, clip } = projectWithClip();
    clip.speedCurve = [{ position: 0, rate: 0.6 }, { position: 0.5, rate: 2 }, { position: 1, rate: 1 }];
    clip.speed = averageSpeed(clip.speedCurve);
    const cut = 1.3;
    const split = validateProject(splitClip(project, clip.id, cut));
    const trimmed = validateProject(trimClip(project, clip.id, "start", cut));
    for (const local of [0, 0.3, 1, 2.7]) {
      const expected = clip.sourceIn + sourceOffsetAt(clip, cut + local);
      expect(split.clips[1].sourceIn + sourceOffsetAt(split.clips[1], local)).toBeCloseTo(expected, 7);
      expect(trimmed.clips[0].sourceIn + sourceOffsetAt(trimmed.clips[0], local)).toBeCloseTo(expected, 7);
      expect(timelineOffsetAt(clip, sourceOffsetAt(clip, cut + local))).toBeCloseTo(cut + local, 7);
    }
  });

  it("maps source beats across a ramp and splits only the selected clip at frame boundaries", () => {
    const { project, clip } = projectWithClip();
    clip.speedCurve = [{ position: 0, rate: 0.5 }, { position: 1, rate: 1.5 }];
    const beats = [1, 2, 3].map(local => clip.sourceIn + sourceOffsetAt(clip, local));
    project.assets = [{ ...asset, beats: { bpm: 90, times: beats } }];
    const unrelated = { ...clip, id: "unrelated" };
    project.clips.push(unrelated);
    expect(clipBeatTimes(clip, project.assets[0])).toEqual([1, 2, 3]);
    const next = splitAtBeats(project, [clip.id]);
    expect(next.clips.map(clip => clip.start)).toEqual([0, 1, 2, 3, 0]);
    expect(next.clips.at(-1)).toEqual(unrelated);
  });

  it("imports multiple readable drafts with shared media, simple crop, typed keyframes and text", () => {
    const draft = (width: number, height: number) => JSON.stringify({
      fps: 30, canvas_config: { width, height },
      materials: {
        videos: [{ id: "v", path: "/test/source.mp4", duration: 5000000, width: 320, height: 180,
          crop: { upper_left_x: 0.25, upper_left_y: 0, lower_right_x: 0.75, lower_right_y: 1 } }],
        texts: [{ id: "t", alignment: 2, content: JSON.stringify({ text: "Test", styles: [
          { range: [0, 4], bold: true, fill: { content: { solid: { color: [1, 0.5, 0] } } } },
        ] }) }],
      },
      tracks: [
        { type: "video", segments: [{ material_id: "v", target_timerange: { duration: 2000000 },
          common_keyframes: [{ property_type: "KFTypePositionX", keyframe_list: [
            { time_offset: 1000000, values: [0.5], curveType: "Line" },
          ] }] }] },
        { type: "text", segments: [{ material_id: "t", target_timerange: { duration: 1000000 } }] },
      ],
    });
    const { project } = importCapcutTimelines([
      { id: "wide", name: "Wide", text: draft(320, 180) },
      { id: "vertical", name: "Vertical", text: draft(180, 320) },
    ], "Combined", "vertical");
    const video = project.clips.find(clip => clip.assetId)!;
    expect(project.activeTimeline?.id).toBe("vertical");
    expect(video.crop).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(video.keyframes[0]).toMatchObject({ property: "x", time: 1, value: 45 });
    expect(project.clips.find(clip => clip.text)?.text).toMatchObject({ text: "Test", align: "right", color: "#ff8000" });
    expect(project.otherTimelines?.[0].clips.find(clip => clip.assetId)?.assetId).toBe(video.assetId);
    expect(project.assets).toHaveLength(1);
  });
});
