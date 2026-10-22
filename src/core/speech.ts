import type { MediaAsset, Project } from './types';
import { clone, createClip, createTrack, snapToFrame } from './model';
import type { Subtitle } from './subtitles';
export type SpeechLanguage = 'auto' | 'zh' | 'en';
export interface SpeechSettings { python?: string; model?: string }
export interface SpeechVoice { name: string; locale: string }
export interface SpeechInfo extends SpeechSettings { modelBytes?: number; ready: boolean; error?: string; voices: SpeechVoice[] }
export type SpeechRequest = { mode: 'asr'; source: string; language: SpeechLanguage } | { mode: 'tts'; text: string; voice: string; rate: number };
export interface SpeechProgress { jobId: string; stage: 'prepare' | 'recognize' | 'synthesize' | 'import' | 'complete'; progress?: number }
export type SpeechResult = { mode: 'asr'; cues: Subtitle[] } | { mode: 'tts'; asset: MediaAsset };
export function speechSource(p: Project, source: string) {
  const clip = source.startsWith('clip:') ? p.clips.find(c => c.id === source.slice(5)) : undefined;
  const asset = p.assets.find(a => a.id === (clip?.assetId ?? (source.startsWith('asset:') ? source.slice(6) : '')));
  if (!asset || asset.missing || !['audio','video'].includes(asset.kind) || !asset.hasAudio) throw new Error('Select an audio or video source with sound.');
  const duration = clip ? clip.duration * clip.speed : asset.duration;
  const sourceIn = clip?.sourceIn ?? 0;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600 || sourceIn + duration > asset.duration + .1) throw new Error('Speech recognition supports up to 60 minutes within the source.');
  return { asset, clip, duration, sourceIn, speed: clip?.speed ?? 1 };
}
export function validateCues(input: unknown, duration: number): Subtitle[] {
  if (!Array.isArray(input) || input.length > 20000) throw new Error('Invalid recognition result.');
  return input.map((c: any) => {
    if (!c || !Number.isFinite(c.start) || !Number.isFinite(c.end) || typeof c.text !== 'string' || c.text.length > 10000 || c.start < 0 || c.end <= c.start || c.start >= duration || c.end > duration + 1) throw new Error('Invalid recognition timestamp.');
    return { start: c.start, end: Math.min(duration, c.end), text: c.text.trim() };
  }).filter(c => c.text).sort((a,b) => a.start-b.start);
}
/** One ordinary project edit: existing preview, undo, save, portable collection and export all apply. */
export function applySpeech(p: Project, request: SpeechRequest, result: SpeechResult, time: number, names: { captions: string; voice: string }): { project: Project; selected: string[] } {
  if (request.mode !== result.mode || !Number.isFinite(time) || time < 0) throw new Error('Invalid speech result.');
  const next = clone(p), selected: string[] = [];
  if (request.mode === 'tts' && result.mode === 'tts') {
    if (result.asset.kind !== 'audio' || !result.asset.duration) throw new Error('Invalid generated audio.');
    const track = createTrack('audio', names.voice), clip = createClip(result.asset, track.id, time, p.fps);
    next.assets.push(result.asset); next.tracks.push(track); next.clips.push(clip); selected.push(clip.id);
  } else if (request.mode === 'asr' && result.mode === 'asr') {
    const source = speechSource(p, request.source), cues = validateCues(result.cues, source.duration);
    if (!cues.length) throw new Error('No speech was detected.');
    const start = source.clip?.start ?? snapToFrame(time,p.fps);
    if (!source.clip) {
      const track = createTrack(source.asset.kind === 'video' ? 'video' : 'audio', source.asset.name);
      next.tracks.push(track); next.clips.push(createClip(source.asset,track.id,start,p.fps));
    }
    const track = createTrack('text',names.captions); next.tracks.unshift(track);
    for (const cue of cues) {
      const clip = createClip(undefined,track.id,start+cue.start/source.speed,p.fps);
      clip.duration = Math.max(1/p.fps,snapToFrame(start+cue.end/source.speed,p.fps)-clip.start);
      clip.name=cue.text; clip.text={...clip.text!,text:wrapCaption(cue.text,p.width/(p.height*.05)*.8),fontSize:p.height*.05}; clip.transform.y=p.height*.36;
      next.clips.push(clip); selected.push(clip.id);
    }
  }
  return { project:next, selected:selected.slice(0,1) };
}

export function wrapCaption(text:string,maxUnits:number):string {
  const limit=Math.max(8,Math.floor(maxUnits)),lines:string[]=[];let line='',width=0;
  for(const token of text.match(/[\u2e80-\uffff]|[^\s\u2e80-\uffff]+\s*|\s+/gu)??[]) {
    const units=[...token].reduce((n,c)=>n+(c.codePointAt(0)!>=0x2e80?1:.55),0);
    if(line&&width+units>limit){lines.push(line.trim());line='';width=0;}
    line+=token;width+=units;
  }
  if(line.trim())lines.push(line.trim());return lines.join('\n');
}
