import type { Clip, Project } from './types';
import { clone, createClip, createTrack, changeClipSpeed, id, snapToFrame, splitClip, trimClip, validateProject } from './model';

export type PlacementMode = 'insert' | 'overwrite' | 'overlay';
const end = (c: Clip) => c.start + c.duration;
const locked = (p: Project, c: Clip) => p.tracks.find(t => t.id === c.trackId)?.locked ?? true;

/** Keep the clicked clip first so the inspector continues to show that clip. */
export function linkedIds(p: Project, ids: string[]): string[] {
  const groups = new Set(p.clips.filter(c => ids.includes(c.id) && c.linkId).map(c => c.linkId));
  return [...new Set([...ids, ...p.clips.filter(c => c.linkId && groups.has(c.linkId)).map(c => c.id)])];
}
export function unlinkClips(p: Project, ids: string[]): Project {
  const members = new Set(linkedIds(p, ids));
  if (p.clips.some(c => members.has(c.id) && locked(p, c))) return p;
  return { ...p, clips: p.clips.map(c => members.has(c.id) ? { ...c, linkId: undefined } : c) };
}
export function detachLinkedAudio(p: Project, clipId: string): { project: Project; audioId: string } {
  const video = p.clips.find(c => c.id === clipId);
  const asset = p.assets.find(a => a.id === video?.assetId);
  if (!video || asset?.kind !== 'video' || !asset.hasAudio) throw new Error('请选择带声音的视频片段');
  if (locked(p, video)) throw new Error('请先解锁轨道');
  if (video.linkId) throw new Error('此片段已有画声关联，请先解除关联');
  const audio = { ...asset, id: id(), kind: 'audio' as const, name: asset.name + ' · 音频', width: 0, height: 0, thumbnail: undefined };
  const track = p.tracks.find(t => t.kind === 'audio' && !t.locked) ?? createTrack('audio', '分离音频');
  const linkId = id();
  const clip: Clip = { ...clone(video), id: id(), assetId: audio.id, trackId: track.id, name: audio.name, linkId,
    keyframes: video.keyframes.filter(k => k.property === 'volume').map(k => ({ ...clone(k), id: id() })) };
  return { audioId: clip.id, project: { ...p, assets: [...p.assets, audio],
    tracks: p.tracks.includes(track) ? p.tracks : [...p.tracks, track],
    clips: [...p.clips.map(c => c.id === video.id ? { ...c, muted: true, linkId } : c), clip] } };
}

/** Clamp the requested edge delta once against every member's source handles. */
export function trimLinked(p: Project, clipId: string, edge: 'start' | 'end', time: number): Project {
  const primary = p.clips.find(c => c.id === clipId);
  if (!primary || !Number.isFinite(time)) return p;
  const ids = new Set(linkedIds(p, [clipId]));
  const members = p.clips.filter(c => ids.has(c.id));
  if (members.some(c => locked(p, c))) return p;
  const edgeAt = (c: Clip) => edge === 'start' ? c.start : end(c);
  const requested = snapToFrame(time, p.fps) - edgeAt(primary);
  let delta = requested;
  for (const c of members) {
    const next = trimClip(p, c.id, edge, edgeAt(c) + requested).clips.find(v => v.id === c.id)!;
    const allowed = edgeAt(next) - edgeAt(c);
    delta = requested > 0 ? Math.min(delta, allowed) : Math.max(delta, allowed);
  }
  for (const c of members) p = trimClip(p, c.id, edge, edgeAt(c) + delta);
  return p;
}

/** A split creates independent left/right linked groups, never a four-clip group. */
export function splitLinked(p: Project, ids: string[], time: number): Project {
  const selected = new Set(linkedIds(p, ids));
  const members = p.clips.filter(c => selected.has(c.id));
  if (members.some(c => locked(p, c))) return p;
  const originalIds = new Set(p.clips.map(c => c.id));
  const rightGroups = new Map<string, string>();
  for (const c of members) {
    const next = splitClip(p, c.id, time);
    if (c.linkId && next !== p) {
      if (!rightGroups.has(c.linkId)) rightGroups.set(c.linkId, id());
      p = { ...next, clips: next.clips.map(v => !originalIds.has(v.id) && v.linkId === c.linkId
        ? { ...v, linkId: rightGroups.get(c.linkId!) } : v) };
      for (const v of p.clips) originalIds.add(v.id);
    } else p = next;
  }
  return p;
}

// A retained interval uses the same boundary anchors and fade windows as manual trimming.
function retain(p: Project, c: Clip, from: number, to: number): Clip | undefined {
  if (to - from < 1 / p.fps - 1e-8) return undefined;
  let part = { ...p, clips: [clone(c)] };
  if (to < end(c) - 1e-8) part = trimClip(part, c.id, 'end', to);
  if (from > c.start + 1e-8) part = trimClip(part, c.id, 'start', from);
  return part.clips[0];
}

/** Insert ripples the entire sequence; overwrite cuts only destination clips and their linked partners. */
export function placeAsset(p: Project, assetId: string, trackId: string | undefined, time: number,
  range: { sourceIn: number; duration: number }, mode: PlacementMode): { project: Project; clipId: string } {
  const asset = p.assets.find(a => a.id === assetId);
  if (!asset || asset.missing || !Number.isFinite(time) || time < 0 ||
      !Number.isFinite(range.sourceIn) || !Number.isFinite(range.duration) || range.sourceIn < 0 ||
      range.duration < 1 / p.fps - 1e-9 || range.duration > 86400 ||
      (asset.kind === 'image' ? range.sourceIn !== 0 : range.sourceIn + range.duration > asset.duration + 1e-8))
    throw new Error('素材选段无效或超出源素材范围');
  if (!['insert', 'overwrite', 'overlay'].includes(mode)) throw new Error('未知入轨模式');
  const accepts = (kind: string) => kind === asset.kind || (asset.kind === 'image' && kind === 'video');
  let track = trackId ? p.tracks.find(t => t.id === trackId) : p.tracks.find(t => accepts(t.kind) && !t.locked);
  if (trackId && (!track || track.locked || !accepts(track.kind))) throw new Error('目标轨道已锁定或不兼容');
  if (!track) { track = createTrack(asset.kind); p = { ...p, tracks: [...p.tracks, track] }; }
  const clip = createClip(asset, track.id, time, p.fps);
  clip.sourceIn = range.sourceIn;
  // Do not extend the selected source range to round a fractional final frame up.
  clip.duration = Math.floor((range.duration + 1e-9) * p.fps) / p.fps;
  const from = clip.start, to = end(clip);
  const targetIds = new Set(linkedIds(p, p.clips.filter(c => c.trackId === track!.id && c.start < to - 1e-8 && end(c) > from + 1e-8).map(c => c.id)));
  const affected = (c: Clip) => mode === 'insert' ? end(c) > from + 1e-8 : mode === 'overwrite' && targetIds.has(c.id);
  if (p.clips.some(c => affected(c) && locked(p, c))) throw new Error('操作会改变锁定轨道上的片段，请先解锁相关轨道');
  const rightGroups = new Map<string, string>();
  const rightGroup = (c: Clip) => {
    if (!c.linkId) return undefined;
    if (!rightGroups.has(c.linkId)) rightGroups.set(c.linkId, id());
    return rightGroups.get(c.linkId);
  };
  const clips = p.clips.flatMap(c => {
    if (!affected(c)) return [c];
    if (mode === 'insert' && c.start >= from - 1e-8) return [{ ...c, start: c.start + clip.duration }];
    const left = retain(p, c, c.start, Math.min(from, end(c)));
    const right = retain(p, c, Math.max(mode === 'insert' ? from : to, c.start), end(c));
    if (right) {
      if (left) { right.id = id(); right.keyframes = right.keyframes.map(k => ({ ...k, id: id() })); }
      right.linkId = rightGroup(c);
      if (mode === 'insert') right.start += clip.duration;
    }
    return [left, right].filter((v): v is Clip => !!v);
  });
  return { project: validateProject({ ...p, clips: [...clips, clip] }), clipId: clip.id };
}

/** Shared by pointer, inspector and assistant edits. Linked partners keep their own tracks. */
export function moveLinked(p: Project, ids: string[], delta: number, trackId?: string): Project {
  if (!Number.isFinite(delta)) return p;
  const selected = new Set(linkedIds(p, ids));
  const members = p.clips.filter(c => selected.has(c.id));
  if (!members.length || members.some(c => locked(p, c))) return p;
  const target = p.tracks.find(t => t.id === trackId && !t.locked);
  const adjusted = Math.max(snapToFrame(delta, p.fps), -Math.min(...members.map(c => c.start)));
  return { ...p, clips: p.clips.map(c => !selected.has(c.id) ? c : { ...c,
    start: c.start + adjusted,
    trackId: target && (c.text ? target.kind === 'text' : p.assets.some(a => a.id === c.assetId && (a.kind === target.kind || (a.kind === 'image' && target.kind === 'video')))) ? target.id : c.trackId,
  }) };
}
export function speedLinked(p: Project, clipId: string, speed: number): Project {
  const ids = new Set(linkedIds(p, [clipId]));
  const members = p.clips.filter(c => ids.has(c.id));
  if (members.some(c => locked(p, c))) return p;
  for (const c of members) p = changeClipSpeed(p, c.id, speed);
  return p;
}
export function slipLinked(p: Project, clipId: string, sourceIn: number): Project {
  const primary = p.clips.find(c => c.id === clipId);
  if (!primary || !Number.isFinite(sourceIn)) return p;
  const ids = new Set(linkedIds(p, [clipId]));
  const members = p.clips.filter(c => ids.has(c.id));
  if (members.some(c => locked(p, c))) return p;
  const delta = sourceIn - primary.sourceIn;
  if (members.some(c => { const a = p.assets.find(a => a.id === c.assetId); return c.sourceIn + delta < 0 ||
    (a && a.kind !== 'image' && c.sourceIn + delta + c.duration * c.speed > a.duration + 1e-8); })) return p;
  return { ...p, clips: p.clips.map(c => members.includes(c) ? { ...c, sourceIn: c.sourceIn + delta } : c) };
}
