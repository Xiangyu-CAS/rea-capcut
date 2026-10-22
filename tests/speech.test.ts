import {describe,it,expect} from 'vitest';
import {createProject,createClip} from '../src/core/model';
import {applySpeech,speechSource,validateCues,type SpeechRequest} from '../src/core/speech';
import type {MediaAsset} from '../src/core/types';
const asset:MediaAsset={id:'audio',kind:'audio',path:'/fixture.wav',url:'file:///fixture.wav',duration:10,width:0,height:0,fps:0,hasAudio:true,name:'fixture'};
const names={captions:'Captions',voice:'Voice'};
describe('local speech edits',()=>{
 it('maps trimmed source timestamps through clip speed and position without changing the source clip',()=>{
  const p=createProject();p.assets=[asset];const c=createClip(asset,p.tracks[2].id,4,30);Object.assign(c,{sourceIn:2,duration:3,speed:2});p.clips=[c];
  const request:SpeechRequest={mode:'asr',source:`clip:${c.id}`,language:'en'};expect(speechSource(p,request.source).duration).toBe(6);
  const result=applySpeech(p,request,{mode:'asr',cues:[{start:1,end:3,text:'Hello'}]},0,names);
  expect(result.project.clips[0]).toEqual(c);expect(result.project.clips[1]).toMatchObject({start:4.5,duration:1,text:{text:'Hello'}});expect(p.clips).toHaveLength(1);
 });
 it('adds an entire source with editable captions at the playhead in one project edit',()=>{
  const p=createProject();p.assets=[asset];const r=applySpeech(p,{mode:'asr',source:'asset:audio',language:'auto'},{mode:'asr',cues:[{start:0,end:2,text:'你好'}]},3,names);
  expect(r.project.clips).toHaveLength(2);expect(r.project.clips.map(c=>c.start)).toEqual([3,3]);expect(r.project.assets).toHaveLength(1);
 });
 it('adds a persistent audio asset on a fresh unlocked track without altering locked tracks',()=>{
  const p=createProject();p.tracks.forEach(t=>t.locked=true);const r=applySpeech(p,{mode:'tts',text:'Hi',voice:'Samantha',rate:180},{mode:'tts',asset},2,names);
  expect(r.project.clips[0]).toMatchObject({assetId:'audio',start:2});expect(r.project.tracks.at(-1)?.locked).toBe(false);expect(p.assets).toHaveLength(0);
 });
 it('rejects malformed/empty results, missing audio and out of bounds timestamps',()=>{
  for(const cues of [[{start:NaN,end:2,text:'bad'}],[{start:1,end:.5,text:'bad'}],[{start:0,end:12,text:'bad'}]])expect(()=>validateCues(cues,10)).toThrow();
  expect(validateCues([{start:9,end:10.2,text:'  hi '}],10)).toEqual([{start:9,end:10,text:'hi'}]);
  const p=createProject();p.assets=[{...asset,hasAudio:false}];expect(()=>speechSource(p,'asset:audio')).toThrow();
  p.assets=[asset];expect(()=>applySpeech(p,{mode:'asr',source:'asset:audio',language:'zh'},{mode:'asr',cues:[]},0,names)).toThrow();
 });
});
