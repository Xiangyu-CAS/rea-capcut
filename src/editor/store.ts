import { create } from "zustand";
import type {
  Clip,
  MediaAsset,
  Project,
  Track,
  TrackKind,
} from "../core/types";
import {
  createProject,
  createTrack,
  createClip,
  clone,
  id,
  splitClip,
  trimClip,
  changeClipSpeed,
  snapToFrame,
  validateProject,
} from "../core/model";
import type { Subtitle } from "../core/subtitles";
interface EditorState {
  project: Project;
  path?: string;
  selectedIds: string[];
  playhead: number;
  playing: boolean;
  zoom: number;
  snapping: boolean;
  magnetic: boolean;
  dirty: boolean;
  past: Project[];
  future: Project[];
  clipboard: Clip[];
  setProject: (project: Project, path?: string) => void;
  commit: (project: Project) => void;
  beginTransaction: () => void;
  endTransaction: () => void;
  transactionOpen: boolean;
  transactionRecorded: boolean;
  updateProject: (patch: Partial<Project>) => void;
  addAssets: (assets: MediaAsset[]) => void;
  removeAsset: (assetId: string) => void;
  addAssetClip: (assetId: string, start?: number, trackId?: string, range?: { sourceIn: number; duration: number }) => void;
  addText: () => void;
  addSubtitles: (cues: Subtitle[]) => void;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  updateSelected: (patch: Partial<Clip>) => void;
  moveClips: (ids: string[], delta: number, trackId?: string) => void;
  trim: (clipId: string, edge: "start" | "end", time: number) => void;
  split: () => void;
  deleteSelected: () => void;
  duplicate: () => void;
  copy: () => void;
  paste: () => void;
  addTrack: (kind: TrackKind) => void;
  deleteTrack: (trackId: string) => void;
  reorderTrack: (trackId: string, direction: "up" | "down") => void;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  select: (ids: string[]) => void;
  seek: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setSnapping: (value: boolean) => void;
  setMagnetic: (value: boolean) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (path: string) => void;
}
const acceptsAsset = (track: Track, asset: MediaAsset) =>
  track.kind === asset.kind ||
  (track.kind === "video" && asset.kind === "image");
const acceptsClip = (p: Project, track: Track, clip: Clip) =>
  clip.text
    ? track.kind === "text"
    : !!p.assets.find((a) => a.id === clip.assetId && acceptsAsset(track, a));
const editable = (p: Project, clip: Clip) =>
  !!p.tracks.find((t) => t.id === clip.trackId && !t.locked);
const freshCopy = (clip: Clip): Clip => ({
  ...clone(clip),
  id: id(),
  keyframes: clip.keyframes.map((k) => ({ ...clone(k), id: id() })),
});
function patchClip(
  project: Project,
  clipId: string,
  patch: Partial<Clip>,
): Project {
  let p = project;
  const original = p.clips.find((c) => c.id === clipId);
  if (!original || !editable(p, original)) return p;
  const rest = { ...clone(patch) };
  delete rest.id;
  if (rest.trackId !== undefined) {
    const target = p.tracks.find((t) => t.id === rest.trackId && !t.locked);
    if (!target || !acceptsClip(p, target, { ...original, ...rest })) return p;
  }
  if (
    Object.prototype.hasOwnProperty.call(rest, "fadeIn") ||
    Object.prototype.hasOwnProperty.call(rest, "fadeOut")
  )
    rest.videoFadeWindow = undefined;
  if (
    Object.prototype.hasOwnProperty.call(rest, "audioFadeIn") ||
    Object.prototype.hasOwnProperty.call(rest, "audioFadeOut")
  )
    rest.audioFadeWindow = undefined;
  if (rest.speed !== undefined) {
    p = changeClipSpeed(p, clipId, rest.speed);
    delete rest.speed;
  }
  if (!Object.keys(rest).length) return p;
  return {
    ...p,
    clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...rest } : c)),
  };
}
export const useEditorStore = create<EditorState>((set, get) => ({
  project: createProject(),
  selectedIds: [],
  playhead: 0,
  playing: false,
  zoom: 60,
  snapping: true,
  magnetic: false,
  dirty: false,
  past: [],
  future: [],
  clipboard: [],
  transactionOpen: false,
  transactionRecorded: false,
  beginTransaction: () => {
    if (!get().transactionOpen)
      set({ transactionOpen: true, transactionRecorded: false });
  },
  endTransaction: () =>
    set({ transactionOpen: false, transactionRecorded: false }),
  setProject: (project, path) =>
    set({
      project: validateProject(project),
      path,
      selectedIds: [],
      playhead: 0,
      playing: false,
      dirty: false,
      past: [],
      future: [],
      clipboard: [],
      transactionOpen: false,
      transactionRecorded: false,
    }),
  commit: (project) => {
    const s = get();
    if (
      project === s.project ||
      JSON.stringify(project) === JSON.stringify(s.project)
    )
      return;
    set({
      project: { ...clone(project), updatedAt: new Date().toISOString() },
      dirty: true,
      past:
        s.transactionOpen && s.transactionRecorded
          ? s.past
          : [...s.past, clone(s.project)].slice(-150),
      future: [],
      transactionRecorded: s.transactionOpen,
    });
  },
  updateProject: (patch) => get().commit({ ...get().project, ...clone(patch) }),
  addAssets: (assets) => {
    const p = get().project,
      paths = new Set(p.assets.map((a) => a.path)),
      ids = new Set(p.assets.map((a) => a.id));
    const fresh = assets.filter((a) => {
      if (paths.has(a.path) || ids.has(a.id)) return false;
      paths.add(a.path);
      ids.add(a.id);
      return true;
    });
    if (fresh.length) get().commit({ ...p, assets: [...p.assets, ...fresh] });
  },
  removeAsset: (assetId) => {
    const p = get().project;
    if (p.clips.some((c) => c.assetId === assetId))
      throw new Error("素材仍被时间线使用，请先删除对应片段");
    get().commit({ ...p, assets: p.assets.filter((a) => a.id !== assetId) });
  },
  addAssetClip: (assetId, start, trackId, range) => {
    let p = get().project;
    const asset = p.assets.find((a) => a.id === assetId);
    if (!asset || (start !== undefined && !Number.isFinite(start))) return;
    if (range && (asset.missing || !Number.isFinite(range.sourceIn) || !Number.isFinite(range.duration) ||
        range.sourceIn < 0 || range.duration < 1 / p.fps - 1e-9 || range.duration > 86400 ||
        (asset.kind === "image" ? range.sourceIn !== 0 : range.sourceIn + range.duration > asset.duration + 1e-9)))
      throw new Error("素材选段无效或超出源素材范围");
    let track: Track | undefined;
    if (trackId !== undefined) {
      track = p.tracks.find(
        (t) => t.id === trackId && !t.locked && acceptsAsset(t, asset),
      );
      if (!track) return;
    } else track = p.tracks.find((t) => !t.locked && acceptsAsset(t, asset));
    if (!track) {
      track = createTrack(asset.kind);
      p = { ...p, tracks: [...p.tracks, track] };
    }
    const end = p.clips
        .filter((c) => c.trackId === track!.id)
        .reduce((end, c) => Math.max(end, c.start + c.duration), 0),
      clip = createClip(asset, track.id, start ?? end, p.fps);
    if (range) { clip.sourceIn = range.sourceIn; clip.duration = range.duration; }
    get().commit({ ...p, clips: [...p.clips, clip] });
    set({ selectedIds: [clip.id], playhead: clip.start });
  },
  addText: () => {
    let p = get().project;
    let track = p.tracks.find((t) => t.kind === "text" && !t.locked);
    if (!track) {
      track = createTrack("text");
      p = { ...p, tracks: [track, ...p.tracks] };
    }
    const clip = createClip(undefined, track.id, get().playhead, p.fps);
    get().commit({ ...p, clips: [...p.clips, clip] });
    set({ selectedIds: [clip.id] });
  },
  addSubtitles: (cues) => {
    const p = get().project,
      track = createTrack("text", "字幕");
    const clips = cues
      .filter(
        (c) =>
          Number.isFinite(c.start) &&
          Number.isFinite(c.end) &&
          c.start >= 0 &&
          c.end > c.start,
      )
      .map((c) => {
        const clip = createClip(undefined, track.id, c.start, p.fps);
        return {
          ...clip,
          name: c.text,
          duration: Math.max(1 / p.fps, snapToFrame(c.end, p.fps) - clip.start),
          transform: { ...clip.transform, y: p.height * 0.36 },
          text: { ...clip.text!, text: c.text, fontSize: p.height * 0.05 },
        };
      });
    if (!clips.length) return;
    get().commit({
      ...p,
      tracks: [track, ...p.tracks],
      clips: [...p.clips, ...clips],
    });
    set({ selectedIds: clips.slice(0, 1).map((c) => c.id) });
  },
  updateClip: (clipId, patch) =>
    get().commit(patchClip(get().project, clipId, patch)),
  updateSelected: (patch) => {
    let p = get().project;
    for (const clipId of get().selectedIds) p = patchClip(p, clipId, patch);
    get().commit(p);
  },
  moveClips: (ids, delta, trackId) => {
    const p = get().project;
    if (!Number.isFinite(delta)) return;
    const moving = p.clips.filter((c) => ids.includes(c.id) && editable(p, c));
    if (!moving.length) return;
    const adjusted = Math.max(delta, -Math.min(...moving.map((c) => c.start))),
      target = p.tracks.find((t) => t.id === trackId && !t.locked);
    get().commit({
      ...p,
      clips: p.clips.map((c) =>
        !moving.includes(c)
          ? c
          : {
              ...c,
              start: Math.max(0, snapToFrame(c.start + adjusted, p.fps)),
              trackId:
                target && acceptsClip(p, target, c) ? target.id : c.trackId,
            },
      ),
    });
  },
  trim: (clipId, edge, time) =>
    get().commit(trimClip(get().project, clipId, edge, time)),
  split: () => {
    let p = get().project;
    const ids = get().selectedIds.length
      ? get().selectedIds
      : p.clips
          .filter(
            (c) =>
              c.start < get().playhead && c.start + c.duration > get().playhead,
          )
          .map((c) => c.id);
    for (const clipId of ids) p = splitClip(p, clipId, get().playhead);
    get().commit(p);
  },
  deleteSelected: () => {
    const s = get(),
      p = s.project,
      removed = p.clips.filter(
        (c) => s.selectedIds.includes(c.id) && editable(p, c),
      );
    if (!removed.length) return;
    let clips = p.clips.filter((c) => !removed.includes(c));
    if (s.magnetic) {
      const ranges = new Map<string, [number, number][]>();
      for (const deleted of [...removed].sort((a, b) => a.start - b.start)) {
        const list = ranges.get(deleted.trackId) ?? [],
          last = list.at(-1),
          end = deleted.start + deleted.duration;
        if (last && deleted.start <= last[1]) last[1] = Math.max(last[1], end);
        else list.push([deleted.start, end]);
        ranges.set(deleted.trackId, list);
      }
      clips = clips.map((c) => ({
        ...c,
        start: Math.max(
          0,
          c.start -
            (ranges.get(c.trackId) ?? []).reduce(
              (sum, [start, end]) => sum + (c.start >= end ? end - start : 0),
              0,
            ),
        ),
      }));
    }
    get().commit({ ...p, clips });
    set({
      selectedIds: s.selectedIds.filter(
        (selected) => !removed.some((c) => c.id === selected),
      ),
    });
  },
  duplicate: () => {
    const s = get(),
      originals = s.project.clips.filter(
        (c) => s.selectedIds.includes(c.id) && editable(s.project, c),
      );
    const copies = originals.map((c) => ({
      ...freshCopy(c),
      start: c.start + c.duration,
    }));
    if (copies.length) {
      get().commit({ ...s.project, clips: [...s.project.clips, ...copies] });
      set({ selectedIds: copies.map((c) => c.id) });
    }
  },
  copy: () =>
    set({
      clipboard: clone(
        get().project.clips.filter((c) => get().selectedIds.includes(c.id)),
      ),
    }),
  paste: () => {
    const s = get();
    if (!s.clipboard.length) return;
    const min = Math.min(...s.clipboard.map((c) => c.start)),
      clips = s.clipboard
        .filter((c) =>
          s.project.tracks.some(
            (t) =>
              t.id === c.trackId && !t.locked && acceptsClip(s.project, t, c),
          ),
        )
        .map((c) => ({
          ...freshCopy(c),
          start: Math.max(
            0,
            snapToFrame(s.playhead + c.start - min, s.project.fps),
          ),
        }));
    if (!clips.length) return;
    get().commit({ ...s.project, clips: [...s.project.clips, ...clips] });
    set({ selectedIds: clips.map((c) => c.id) });
  },
  addTrack: (kind) => {
    const p = get().project,
      track = createTrack(
        kind,
        `${{ video: "视频", image: "画面", audio: "音频", text: "文字" }[kind]} ${p.tracks.filter((t) => t.kind === kind).length + 1}`,
      );
    get().commit({
      ...p,
      tracks: kind === "audio" ? [...p.tracks, track] : [track, ...p.tracks],
    });
  },
  deleteTrack: (trackId) => {
    const s = get(),
      p = s.project,
      track = p.tracks.find((t) => t.id === trackId);
    if (!track || track.locked) return;
    const removed = new Set(
      p.clips.filter((c) => c.trackId === trackId).map((c) => c.id),
    );
    get().commit({
      ...p,
      tracks: p.tracks.filter((t) => t.id !== trackId),
      clips: p.clips.filter((c) => c.trackId !== trackId),
    });
    set({ selectedIds: s.selectedIds.filter((id) => !removed.has(id)) });
  },
  reorderTrack: (trackId, direction) => {
    const p = get().project,
      index = p.tracks.findIndex((t) => t.id === trackId),
      target = index + (direction === "up" ? -1 : 1);
    if (
      index < 0 ||
      target < 0 ||
      target >= p.tracks.length ||
      p.tracks[index].locked ||
      p.tracks[target].locked
    )
      return;
    const tracks = [...p.tracks];
    [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
    get().commit({ ...p, tracks });
  },
  updateTrack: (trackId, patch) => {
    const p = get().project,
      track = p.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const rest = { ...clone(patch) };
    delete rest.id;
    delete rest.kind;
    if (rest.name !== undefined) {
      if (track.locked || !rest.name.trim()) delete rest.name;
      else rest.name = rest.name.trim();
    }
    get().commit({
      ...p,
      tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...rest } : t)),
    });
  },
  select: (selectedIds) => set({ selectedIds: [...selectedIds] }),
  seek: (time) => {
    if (Number.isFinite(time))
      set({ playhead: Math.max(0, time), playing: false });
  },
  setPlaying: (playing) => set({ playing }),
  setZoom: (zoom) => {
    if (Number.isFinite(zoom)) set({ zoom: Math.min(400, Math.max(5, zoom)) });
  },
  setSnapping: (snapping) => set({ snapping }),
  setMagnetic: (magnetic) => set({ magnetic }),
  undo: () => {
    const s = get();
    if (s.past.length)
      set({
        project: clone(s.past[s.past.length - 1]),
        past: s.past.slice(0, -1),
        future: [clone(s.project), ...s.future],
        dirty: true,
        selectedIds: [],
        playing: false,
        transactionOpen: false,
        transactionRecorded: false,
      });
  },
  redo: () => {
    const s = get();
    if (s.future.length)
      set({
        project: clone(s.future[0]),
        past: [...s.past, clone(s.project)].slice(-150),
        future: s.future.slice(1),
        dirty: true,
        selectedIds: [],
        playing: false,
        transactionOpen: false,
        transactionRecorded: false,
      });
  },
  markSaved: (path) => set({ path, dirty: false }),
}));
