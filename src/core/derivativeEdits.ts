import type { DerivativeRequest, MediaAsset, Project } from './types';
import { clone, evaluateKeyframes, id, snapToFrame, validateProject } from './model';
import { linkedIds, placeAsset } from './timelineEdits';

/** Shared preflight on both sides of IPC; a locked linked member blocks the entire edit. */
export function derivativePlan(p: Project, clipId: string, r: DerivativeRequest) {
  if (!r || !['reverse', 'freeze'].includes(r.mode) || !['reverse', 'mute'].includes(r.audio) ||
      !Number.isFinite(r.time) || !Number.isFinite(r.duration)) throw new Error('无效的媒体处理请求');
  const clip = p.clips.find(c => c.id === clipId), asset = p.assets.find(a => a.id === clip?.assetId);
  if (!clip || !asset || asset.kind !== 'video' || asset.missing) throw new Error('请选择可用的视频片段');
  const linked = new Set(linkedIds(p, [clipId]));
  const members = p.clips.filter(c => linked.has(c.id));
  if (members.some(c => p.tracks.find(t => t.id === c.trackId)?.locked)) throw new Error('请先解锁关联轨道');
  const frames = Math.round(clip.duration * p.fps);
  if (r.mode === 'reverse' && (frames < 1 || Math.abs(frames / p.fps - clip.duration) > 1e-6)) throw new Error('请先将片段时长对齐到项目帧');
  if (r.mode === 'reverse') {
    if (clip.duration > 3600) throw new Error('单次倒放最多 60 分钟，请先分割片段');
    if (members.some(c => { const a = p.assets.find(a => a.id === c.assetId); return a?.path !== asset.path ||
      c.sourceIn !== clip.sourceIn || c.speed !== clip.speed || c.duration !== clip.duration || c.start !== clip.start; }))
      throw new Error('关联片段源范围不同，请先解除关联再倒放');
  } else {
    const time = snapToFrame(r.time, p.fps);
    if (time < clip.start || time >= clip.start + clip.duration || r.duration < 1 / p.fps || r.duration > 3600)
      throw new Error('请将播放头移到所选视频内；定格时长须在一帧至 60 分钟之间');
    // Preflight ripple locks before doing any media work.
    if (p.clips.some(c => c.start + c.duration > time + 1e-8 && p.tracks.find(t => t.id === c.trackId)?.locked))
      throw new Error('插入定格会移动锁定轨道，请先解锁');
  }
  return { clip, asset, members, frames, time: snapToFrame(r.time, p.fps) };
}

export function applyDerivative(p: Project, clipId: string, r: DerivativeRequest, asset: MediaAsset): { project: Project; clipId: string } {
  const plan = derivativePlan(p, clipId, r);
  if (asset.kind !== (r.mode === 'reverse' ? 'video' : 'image')) throw new Error('衍生素材类型不匹配');
  const next = clone(p); next.assets.push(asset);
  if (r.mode === 'reverse') {
    const ids = new Set(plan.members.map(c => c.id));
    const audio = plan.members.some(c => p.assets.find(a => a.id === c.assetId)?.kind === 'audio')
      ? { ...asset, id: id(), kind: 'audio' as const, name: asset.name + ' · 音频', width: 0, height: 0, thumbnail: undefined } : undefined;
    if (audio) next.assets.push(audio);
    next.clips = next.clips.map(c => !ids.has(c.id) ? c : { ...c,
      assetId: p.assets.find(a => a.id === c.assetId)?.kind === 'audio' ? audio!.id : asset.id,
      name: c.name + ' · 倒放', sourceIn: 0, speed: 1, muted: r.audio === 'mute' || c.muted,
    });
    return { project: validateProject(next), clipId };
  }
  const placed = placeAsset(next, asset.id, plan.clip.trackId, plan.time, { sourceIn: 0, duration: r.duration }, 'insert');
  const evaluated = evaluateKeyframes(plan.clip, plan.time - plan.clip.start);
  placed.project.clips = placed.project.clips.map(c => c.id !== placed.clipId ? c : {
    ...c, name: plan.clip.name + ' · 定格', transform: clone(evaluated.transform), adjustments: clone(evaluated.adjustments),
    crop: clone(evaluated.crop), mask: clone(evaluated.mask), chromaKey: clone(evaluated.chromaKey),
  });
  return { ...placed, project: validateProject(placed.project) };
}
