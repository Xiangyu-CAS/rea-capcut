import { describe, expect, it } from 'vitest';
import { applyDerivative, derivativePlan } from '../src/core/derivativeEdits';
import { createClip, createProject, validateProject } from '../src/core/model';
import { detachLinkedAudio } from '../src/core/timelineEdits';
import { useEditorStore } from '../src/editor/store';
import type { DerivativeRequest, MediaAsset } from '../src/core/types';
const source: MediaAsset = { id:'source', name:'source', path:'/test.mp4', url:'test', kind:'video', duration:10, width:160,height:90,fps:30,hasAudio:true };
const reversed: MediaAsset = { ...source, id:'reverse', path:'/reverse.mp4', duration:2 };
const still: MediaAsset = { ...source, id:'still',path:'/still.png', kind:'image',hasAudio:false,duration:0,fps:0 };
const reverse: DerivativeRequest = { mode:'reverse',audio:'reverse',time:0,duration:2 };
const freeze: DerivativeRequest = { ...reverse,mode:'freeze',time:1,duration:2 };
function fixture() { const p=createProject(); p.assets=[source]; const c=createClip(source,p.tracks[1].id,0,30); c.sourceIn=1;c.speed=2;c.duration=2;p.clips=[c]; return p; }
describe('derived media edit semantics',()=>{
 it('replaces exactly the selected source range and bakes speed without moving keyframes or fades',()=>{
  const p=fixture(),c=p.clips[0]; c.keyframes=[{id:'k',property:'x',time:1,value:100,easing:'linear'}];c.fadeIn=.5;
  const q=applyDerivative(p,c.id,reverse,reversed).project;
  expect(q.clips[0]).toMatchObject({sourceIn:0,speed:1,duration:2,fadeIn:.5,keyframes:c.keyframes});expect(p.clips[0].sourceIn).toBe(1);
 });
 it('replaces both linked members with one generated file and preserves their original mute state',()=>{
  const p=fixture(),c=p.clips[0];const pair=detachLinkedAudio(p,c.id).project;
  const q=applyDerivative(pair,c.id,reverse,reversed).project;
  expect(q.clips.map(c=>c.muted)).toEqual([true,false]);expect(q.clips.every(c=>c.sourceIn===0&&c.speed===1)).toBe(true);
  expect(q.clips.map(c=>q.assets.find(a=>a.id===c.assetId)!.path)).toEqual(['/reverse.mp4','/reverse.mp4']);
  expect(q.clips[0].linkId).toBe(q.clips[1].linkId);
  expect(applyDerivative(pair,c.id,{...reverse,audio:'mute'},{...reversed,hasAudio:false}).project.clips.every(c=>c.muted)).toBe(true);
 });
 it('refuses locks, mismatched linked ranges and invalid requests atomically',()=>{
  const p=fixture(),c=p.clips[0],pair=detachLinkedAudio(p,c.id).project;
  pair.clips[1].sourceIn+=.1;expect(()=>derivativePlan(pair,c.id,reverse)).toThrow(/解除关联/);
  pair.clips[1].sourceIn=c.sourceIn;pair.tracks[2].locked=true;expect(()=>derivativePlan(pair,c.id,reverse)).toThrow(/解锁/);
  expect(()=>derivativePlan(p,c.id,{...freeze,time:2})).toThrow();expect(()=>derivativePlan(p,c.id,{...freeze,duration:NaN})).toThrow();
 });
 it('inserts a static evaluated transform and ripples video plus associated audio in one edit',()=>{
  const p=fixture(),c=p.clips[0];c.keyframes=[{id:'k0',time:0,property:'x',value:0,easing:'linear'},{id:'k1',time:2,property:'x',value:100,easing:'linear'}];
  const pair=detachLinkedAudio(p,c.id).project,q=applyDerivative(pair,c.id,freeze,still);
  const hold=q.project.clips.find(c=>c.id===q.clipId)!;expect(hold.duration).toBe(2);expect(hold.transform.x).toBe(50);expect(hold.keyframes).toEqual([]);
  expect(q.project.clips.filter(c=>c.start===3)).toHaveLength(2);expect(q.project.clips.filter(c=>c.start===3).map(c=>c.sourceIn)).toEqual([3,3]);
  expect(validateProject(JSON.parse(JSON.stringify(q.project))).clips).toEqual(q.project.clips);
 });
 it('preflights freeze ripple locks and permits changing its duration later as an ordinary image',()=>{
  const p=fixture(),c=p.clips[0];p.tracks[1].locked=true;expect(()=>derivativePlan(p,c.id,freeze)).toThrow(/解锁/);p.tracks[1].locked=false;
  const q=applyDerivative(p,c.id,freeze,still);useEditorStore.getState().setProject(q.project);
  useEditorStore.getState().select([q.clipId]);useEditorStore.getState().updateSelected({duration:4});
  expect(useEditorStore.getState().project.clips.find(c=>c.id===q.clipId)!.duration).toBe(4);
 });
 it('undo and redo include all new assets and the linked replacement atomically',()=>{
  const p=fixture(),c=p.clips[0];useEditorStore.getState().setProject(p);
  const q=applyDerivative(p,c.id,reverse,reversed).project;useEditorStore.getState().commit(q);
  useEditorStore.getState().undo();expect(useEditorStore.getState().project.assets).toEqual(p.assets);
  useEditorStore.getState().redo();expect(useEditorStore.getState().project.clips).toEqual(q.clips);
 });
});
