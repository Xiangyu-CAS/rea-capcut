import type { Project, ProjectTimeline, TimelineContent, TimelineLabel } from "./types";

export const MAX_PROJECT_TIMELINES = 32;
export const MAX_TIMELINE_NAME = 120;

export function timelineContent({ width, height, fps, background, tracks, clips }: TimelineContent): TimelineContent {
  return { width, height, fps, background, tracks, clips };
}

export function timelineLabel({ id, name, index }: TimelineLabel): TimelineLabel {
  return { id, name, index };
}

export function projectTimelineLabels(project: Project, defaultName = "Timeline 1"): TimelineLabel[] {
  const active = project.activeTimeline ?? { id: project.id, name: defaultName, index: 0 };
  return [active, ...(project.otherTimelines ?? []).map(timelineLabel)].sort((a, b) => a.index - b.index);
}

export function activateTimeline(project: Project, id: string): Project {
  const selected = project.otherTimelines?.find(timeline => timeline.id === id);
  if (!selected || !project.activeTimeline) return project;
  const previous: ProjectTimeline = { ...project.activeTimeline, ...timelineContent(project) };
  return {
    ...project,
    ...timelineContent(selected),
    activeTimeline: timelineLabel(selected),
    otherTimelines: project.otherTimelines!.map(timeline => timeline.id === id ? previous : timeline),
  };
}

export function addProjectTimeline(project: Project, name: string, defaultName: string, duplicate: boolean): Project {
  const labels = projectTimelineLabels(project, defaultName);
  if (labels.length >= MAX_PROJECT_TIMELINES) throw new Error("This project has reached the timeline limit.");
  const active = project.activeTimeline ?? labels[0];
  const newName = name.trim().slice(0, MAX_TIMELINE_NAME);
  if (!newName) return project;
  const ids = new Map<string, string>();
  const newId = (value: string) => {
    if (!ids.has(value)) ids.set(value, crypto.randomUUID());
    return ids.get(value)!;
  };
  return {
    ...project,
    activeTimeline: { id: crypto.randomUUID(), name: newName, index: labels.length },
    otherTimelines: [...(project.otherTimelines ?? []), { ...active, ...timelineContent(project) }],
    tracks: project.tracks.map(track => ({
      ...track, id: newId(track.id),
      ...(duplicate ? {} : { muted: false, hidden: false, locked: false, audioDucking: undefined }),
    })),
    clips: duplicate ? project.clips.map(clip => ({
      ...clip, id: newId(clip.id), trackId: newId(clip.trackId),
      linkId: clip.linkId ? newId(clip.linkId) : undefined,
      keyframes: clip.keyframes.map(key => ({ ...key, id: crypto.randomUUID() })),
    })) : [],
  };
}

export function renameProjectTimeline(project: Project, name: string): Project {
  const next = name.trim().slice(0, MAX_TIMELINE_NAME);
  const active = project.activeTimeline ?? { id: project.id, name: "", index: 0 };
  return next && next !== active.name ? { ...project, activeTimeline: { ...active, name: next } } : project;
}

export function projectUsesAsset(project: Project, assetId: string): boolean {
  return [project, ...(project.otherTimelines ?? [])].some(timeline =>
    timeline.clips.some(clip => clip.assetId === assetId),
  );
}
