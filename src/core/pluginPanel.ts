import type { Clip, ExportProgress, MediaAsset, Project } from "./types";
import type { AssistantMediaSelection } from "./assistantTypes";

export const PANEL_META = "reacut/panel";
export const PANEL_FILE_ACTIONS = ["import", "open", "new", "save", "export", "cancelExport", "desktop", "previewPlan", "applyPlan", "switchTimeline", "undo", "redo"] as const;
export type PanelFileAction = typeof PANEL_FILE_ACTIONS[number];
export type PanelCommandOptions = { planId?: string; format?: "mp4" | "mov"; timelineId?: string };
export const PANEL_CLIP_LIMIT = 10_000;

const projectFields = ["name", "width", "height", "fps", "background", "tracks", "activeTimeline", "otherTimelines"] as const;
export type PanelProjectPatch = Partial<Pick<Project, Exclude<typeof projectFields[number], "activeTimeline" | "otherTimelines">>> & {
  activeTimeline?: Project["activeTimeline"] | null;
  otherTimelines?: Project["otherTimelines"] | null;
  assetIds?: string[];
  clips?: { values: Clip[]; order?: string[] };
};
export interface PanelView {
  selectedIds: string[];
  agentMedia: AssistantMediaSelection[];
  playhead: number;
  playing: boolean;
}
export interface PanelSnapshot extends PanelView {
  revision: number;
  ready: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  project?: Project;
  plan?: { id: string; status: string; descriptions: string[]; focus: number; project?: Project };
  export?: Pick<ExportProgress, "progress" | "status" | "message">;
}
export interface PanelMediaChunk {
  type: string;
  size: number;
  version: string;
  data: string;
}

// The iframe never needs local filenames, original URLs or cache directories.
export function panelProject(project: Project): Project {
  return {
    ...project,
    assets: project.assets.map(({ id, name, kind, duration, width, height, fps, hasAudio, missing, waveform, beats }): MediaAsset =>
      ({ id, name, kind, duration, width, height, fps, hasAudio, missing, waveform, beats, path: id, url: "about:blank" })),
  };
}

const equal = (left: unknown, right: unknown) => left === right || JSON.stringify(left) === JSON.stringify(right);

export function panelProjectPatch(base: Project, next: Project): PanelProjectPatch {
  const patch: PanelProjectPatch = Object.fromEntries(projectFields
    .filter(field => !equal(base[field], next[field]))
    .map(field => [field, next[field] ?? null]));
  if (!equal(base.assets.map(asset => asset.id), next.assets.map(asset => asset.id)))
    patch.assetIds = next.assets.map(asset => asset.id);
  const originals = new Map(base.clips.map(clip => [clip.id, clip]));
  const values = next.clips.filter(clip => !equal(originals.get(clip.id), clip));
  const order = next.clips.map(clip => clip.id);
  if (!equal([...originals.keys()], order)) patch.clips = { values, order };
  else if (values.length) patch.clips = { values };
  return patch;
}

export function applyPanelProjectPatch(project: Project, patch: PanelProjectPatch): Project {
  const next = { ...project };
  for (const field of projectFields) {
    if (Object.hasOwn(patch, field)) Object.assign(next, { [field]: patch[field] ?? undefined });
  }
  if (patch.assetIds) {
    const known = new Map(project.assets.map(asset => [asset.id, asset]));
    next.assets = patch.assetIds.map(id => {
      const asset = known.get(id);
      if (!asset) throw new Error("Import media through the file picker first.");
      return asset;
    });
  }
  if (patch.clips) {
    const clips = new Map(project.clips.map(clip => [clip.id, clip]));
    for (const clip of patch.clips.values) clips.set(clip.id, clip);
    next.clips = (patch.clips.order ?? project.clips.map(clip => clip.id)).map(id => {
      const clip = clips.get(id);
      if (!clip) throw new Error("Unknown clip.");
      return clip;
    });
  }
  return next;
}
