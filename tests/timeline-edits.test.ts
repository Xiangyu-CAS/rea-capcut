import { describe, expect, it } from 'vitest';
import { createClip, createProject, evaluateFade, evaluateKeyframes, validateProject } from '../src/core/model';
import { detachLinkedAudio, linkedIds, moveLinked, placeAsset, splitLinked, trimLinked, unlinkClips } from '../src/core/timelineEdits';
import { applyTransition } from '../src/core/creativePresets';
import { previewAssistantEdits } from '../src/core/assistantEdits';
import { useEditorStore } from '../src/editor/store';
import type { MediaAsset } from '../src/core/types';
const fixture = () => {
  const p = createProject('关联粗剪');
  const a: MediaAsset = { id: 'v', name: '自造素材', path: '/synthetic.mp4', url: 'file:///synthetic.mp4', kind: 'video', duration: 20, width: 160, height: 90, fps: 30, hasAudio: true };
  p.assets = [a];
  const c = createClip(a, p.tracks[1].id, 0, p.fps); c.duration = 6; c.sourceIn = 2;
  p.clips = [c]; return p;
};
const pair = () => { const p = fixture(); return detachLinkedAudio(p, p.clips[0].id).project; };
const ranges = (p: ReturnType<typeof fixture>, track = p.tracks[1].id) => p.clips.filter(c => c.trackId === track).sort((a,b) => a.start-b.start).map(c => [c.start,c.duration,c.sourceIn]);
describe('insert / overwrite with linked sound', () => {
  it('inserts I/O selection through a pair, ripples later tracks, preserves original source', () => {
    const p = pair(); const title = createClip(undefined,p.tracks[0].id,5,30);title.duration=1;p.clips.push(title);
    const original=JSON.stringify(p);
    const r=placeAsset(p,'v',p.tracks[1].id,2,{sourceIn:10,duration:1},'insert').project;
    expect(ranges(r)).toEqual([[0,2,2],[2,1,10],[3,4,4]]);
    expect(ranges(r,p.tracks[2].id)).toEqual([[0,2,2],[3,4,4]]);
    expect(r.clips.find(c=>c.id===title.id)!.start).toBe(6);
    expect(r.clips.filter(c=>c.linkId===p.clips[0].linkId)).toHaveLength(2);
    const right=r.clips.find(c=>c.start===3)!;expect(linkedIds(r,[right.id])).toHaveLength(2);
    expect(right.linkId).not.toBe(p.clips[0].linkId);expect(JSON.stringify(p)).toBe(original);
  });
  it('overwrites only target and linked partners, retaining both sides without doubling sound',()=>{
    const p=pair();const music={...p.clips[1],id:'music',linkId:undefined};p.clips.push(music);
    const r=placeAsset(p,'v',p.tracks[1].id,2,{sourceIn:10,duration:1},'overwrite').project;
    expect(ranges(r)).toEqual([[0,2,2],[2,1,10],[3,3,5]]);
    expect(r.clips.find(c=>c.id==='music')).toEqual(music);
    expect(r.clips.filter(c=>c.trackId===p.tracks[2].id&&c.id!=='music').map(c=>[c.start,c.duration,c.sourceIn])).toEqual([[0,2,2],[3,3,5]]);
  });
  it('covers multiple overlapping clips and retains only valid outside intervals',()=>{
    const p=fixture();p.clips.push({...p.clips[0],id:'overlap',start:1,duration:2});
    const r=placeAsset(p,'v',p.tracks[1].id,0,{sourceIn:10,duration:4},'overwrite').project;
    expect(ranges(r)).toEqual([[0,4,10],[4,2,6]]);
  });
  it('preserves keyframe and fade phases at retained boundaries',()=>{
    const p=fixture(),c=p.clips[0];c.fadeIn=4;c.audioFadeOut=3;
    c.keyframes=[{id:'k1',time:0,property:'opacity',value:0,easing:'linear'},{id:'k2',time:6,property:'opacity',value:1,easing:'easeInOut'}];
    const r=placeAsset(p,'v',c.trackId,2,{sourceIn:10,duration:1},'overwrite').project;
    const right=r.clips.find(c=>c.start===3)!;
    for(const t of [0,.3,1,2.5]) {
      expect(evaluateKeyframes(right,t).transform.opacity).toBeCloseTo(evaluateKeyframes(c,t+3).transform.opacity,6);
      expect(evaluateFade(right,t,'video')).toBeCloseTo(evaluateFade(c,t+3,'video'),6);
      expect(evaluateFade(right,t,'audio')).toBeCloseTo(evaluateFade(c,t+3,'audio'),6);
    }
  });
  it('rejects a locked linked partner atomically; ignores unrelated locked tracks for overwrite',()=>{
    const p=pair();p.tracks[2].locked=true;const before=JSON.stringify(p);
    for(const mode of ['insert','overwrite'] as const)expect(()=>placeAsset(p,'v',p.tracks[1].id,2,{sourceIn:0,duration:1},mode)).toThrow('锁定');
    expect(JSON.stringify(p)).toBe(before);
    const q=fixture();q.tracks[0].locked=true;const text=createClip(undefined,q.tracks[0].id,0,30);q.clips.push(text);
    expect(()=>placeAsset(q,'v',q.tracks[1].id,2,{sourceIn:0,duration:1},'overwrite')).not.toThrow();
    expect(()=>placeAsset(q,'v',q.tracks[1].id,2,{sourceIn:0,duration:1},'insert')).toThrow('锁定');
  });
  it('inserts at boundaries and in gaps without creating zero length clips',()=>{
    const p=fixture();p.clips[0].start=2;
    const r=placeAsset(p,'v',p.tracks[1].id,2,{sourceIn:0,duration:1},'insert').project;
    expect(ranges(r)).toEqual([[2,1,0],[3,6,2]]);
    const q=placeAsset(p,'v',p.tracks[1].id,10,{sourceIn:0,duration:1},'insert').project;
    expect(ranges(q)).toEqual([[2,6,2],[10,1,0]]);
  });
  it('keeps overlay behavior and validates range, destination, duration and link metadata',()=>{
    const p=pair();const r=placeAsset(p,'v',p.tracks[1].id,1,{sourceIn:2,duration:1},'overlay').project;
    expect(r.clips.slice(0,2)).toEqual(p.clips);
    expect(()=>placeAsset(p,'v',p.tracks[2].id,0,{sourceIn:0,duration:1},'insert')).toThrow('不兼容');
    expect(()=>placeAsset(p,'v',undefined,0,{sourceIn:19,duration:2},'insert')).toThrow('范围');
    expect(()=>placeAsset(p,'v',undefined,86400,{sourceIn:0,duration:1},'insert')).toThrow();
    expect(()=>validateProject({...p,clips:[{...p.clips[0],linkId:42}]})).toThrow('关联');
  });
});
describe('linked timeline edits and persistence',()=>{
  it('selects a pair, moves/clamps together and trims by the most restrictive source handles',()=>{
    const p=pair();const ids=linkedIds(p,[p.clips[1].id]);expect(ids[0]).toBe(p.clips[1].id);expect(ids).toHaveLength(2);
    const moved=moveLinked(p,[p.clips[0].id],2);expect(moved.clips.map(c=>c.start)).toEqual([2,2]);
    const trimmed=trimLinked(moved,p.clips[0].id,'start',3);expect(trimmed.clips.map(c=>[c.start,c.sourceIn,c.duration])).toEqual([[3,3,5],[3,3,5]]);
    const q=structuredClone(trimmed);q.assets[1].duration=9;
    const limited=trimLinked(q,q.clips[0].id,'end',20);expect(limited.clips.map(c=>c.duration)).toEqual([6,6]);
    expect(moveLinked(moved,[p.clips[0].id],-5).clips.map(c=>c.start)).toEqual([0,0]);
    expect(validateProject(JSON.parse(JSON.stringify(limited)))).toEqual(limited);
  });
  it('splits into independent linked pairs and unlink preserves rendered clip timing',()=>{
    const p=pair(),r=splitLinked(p,[p.clips[0].id],2);expect(r.clips).toHaveLength(4);
    const right=r.clips.find(c=>c.start===2)!;expect(linkedIds(r,[right.id])).toHaveLength(2);
    const u=unlinkClips(r,[right.id]);expect(u.clips.filter(c=>c.linkId)).toHaveLength(2);
    expect(u.clips.map(c=>[c.start,c.duration,c.sourceIn])).toEqual(r.clips.map(c=>[c.start,c.duration,c.sourceIn]));
  });
  it('locked partners block movement, trim, split and unlink without a partial edit',()=>{
    const p=pair();p.tracks[2].locked=true;const c=p.clips[0];
    expect(moveLinked(p,[c.id],1)).toBe(p);expect(trimLinked(p,c.id,'end',3)).toBe(p);
    expect(splitLinked(p,[c.id],2)).toBe(p);expect(unlinkClips(p,[c.id])).toBe(p);
  });
  it('store commits placement, movement, trim, unlink atomically and preserves links after reopen',()=>{
    const p=pair();const state=()=>useEditorStore.getState();state().setProject(p);state().seek(2);
    state().placeAsset('v',p.tracks[1].id,{sourceIn:10,duration:1},'insert');expect(state().past).toHaveLength(1);
    state().undo();expect(state().project).toEqual(p);state().redo();const inserted=structuredClone(state().project);
    state().setProject(JSON.parse(JSON.stringify(inserted)));const right=state().project.clips.find(c=>c.start===3)!;
    state().select([right.id]);expect(state().selectedIds).toHaveLength(2);
    state().moveClips([right.id],1);expect(state().past).toHaveLength(1);state().undo();expect(state().project).toEqual(inserted);
    state().trim(right.id,'end',6);expect(state().project.clips.filter(c=>c.linkId===right.linkId).every(c=>c.duration===3)).toBe(true);
    state().undo();state().select([right.id]);state().unlinkSelected();expect(state().project.clips.filter(c=>c.linkId===right.linkId)).toHaveLength(0);state().undo();expect(state().project).toEqual(inserted);
  });
  it('inspector start, source offset and speed keep a pair synchronized; duplicate/paste use fresh groups',()=>{
    const state=()=>useEditorStore.getState();state().setProject(pair());const c=state().project.clips[0];
    state().updateClip(c.id,{start:2});state().updateClip(c.id,{sourceIn:3});state().updateClip(c.id,{speed:2});
    expect(state().project.clips.map(c=>[c.start,c.sourceIn,c.speed,c.duration])).toEqual([[2,3,2,3],[2,3,2,3]]);
    state().select([c.id]);state().duplicate();const copied=state().project.clips.slice(2);expect(copied[0].linkId).toBe(copied[1].linkId);expect(copied[0].linkId).not.toBe(c.linkId);
    state().copy();state().seek(10);state().paste();const pasted=state().project.clips.slice(4);expect(pasted[0].linkId).toBe(pasted[1].linkId);expect(pasted[0].linkId).not.toBe(copied[0].linkId);
  });
});

it('assistant and plugin temporal edits respect associations and locked partners',()=>{
 const p=pair(),c=p.clips[0];
 const moved=previewAssistantEdits(p,[{type:'moveClip',clipId:c.id,start:2}]).project;
 expect(moved.clips.map(c=>c.start)).toEqual([2,2]);
 const cut=previewAssistantEdits(moved,[{type:'trimClip',clipId:c.id,edge:'end',time:5}]).project;
 expect(cut.clips.map(c=>c.duration)).toEqual([3,3]);
 expect(previewAssistantEdits(cut,[{type:'splitClip',clipId:c.id,time:3}]).project.clips).toHaveLength(4);
 p.tracks[2].locked=true;expect(()=>previewAssistantEdits(p,[{type:'moveClip',clipId:c.id,start:1}])).toThrow('锁定');
});

it('rejects magnetic deletion that would desynchronize surviving linked clips',()=>{
 const state=()=>useEditorStore.getState();const p=pair();const inserted=placeAsset(p,'v',p.tracks[1].id,2,{sourceIn:10,duration:1},'insert');
 state().setProject(inserted.project);state().setMagnetic(true);state().select([inserted.clipId]);
 expect(()=>state().deleteSelected()).toThrow('错位');expect(state().past).toHaveLength(0);expect(state().project).toEqual(inserted.project);
 state().setMagnetic(false);state().deleteSelected();expect(state().project.clips).toHaveLength(4);
});
it('transitions move and fade associated audio together and reject locked partners',()=>{
 const p=pair();const cut=splitLinked(p,[p.clips[0].id],3);const first=cut.clips.find(c=>c.start===0&&c.trackId===p.tracks[1].id)!;
 const next=applyTransition(cut,first.id,'dissolve',.5).project;
 expect(next.clips.filter(c=>c.start>0).map(c=>[c.start,c.audioFadeIn])).toEqual([[2.5,.5],[2.5,.5]]);
 cut.tracks[2].locked=true;expect(()=>applyTransition(cut,first.id,'dissolve',.5)).toThrow('锁定');
});

it('copy operations do not create a silent half-pair when a partner track is locked',()=>{
 const state=()=>useEditorStore.getState();const p=pair();state().setProject(p);state().select([p.clips[0].id]);state().copy();
 state().updateTrack(p.tracks[2].id,{locked:true});const before=structuredClone(state().project),history=state().past.length;
 state().duplicate();state().paste();expect(state().project).toEqual(before);expect(state().past).toHaveLength(history);
});
