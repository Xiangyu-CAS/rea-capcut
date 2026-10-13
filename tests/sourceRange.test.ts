import { beforeEach, expect, it } from 'vitest';
import { createProject } from '../src/core/model';
import { useEditorStore } from '../src/editor/store';
const state=()=>useEditorStore.getState();
beforeEach(()=>{const p=createProject();p.assets=[{id:'v',kind:'video',name:'测试',path:'/synthetic.mp4',url:'file:///synthetic.mp4',duration:4.01,width:160,height:90,fps:30,hasAudio:true}];state().setProject(p);});
it('preserves exact source range, start, selection and atomic undo including new unlocked track',()=>{
 const p=state().project;p.tracks.forEach(t=>t.locked=true);state().setProject(p);
 state().addAssetClip('v',2,undefined,{sourceIn:3,duration:1.01});
 const c=state().project.clips[0];expect(c.sourceIn).toBe(3);expect(c.duration).toBe(1.01);expect(c.start).toBe(2);
 expect(state().selectedIds).toEqual([c.id]);expect(state().past).toHaveLength(1);expect(state().project.tracks).toHaveLength(p.tracks.length+1);
 state().undo();expect(state().project.clips).toHaveLength(0);expect(state().project.tracks).toHaveLength(p.tracks.length);
 state().redo();expect(state().project.clips[0].sourceIn).toBe(3);
});
it.each([{sourceIn:-1,duration:1},{sourceIn:0,duration:0},{sourceIn:4,duration:.1},{sourceIn:NaN,duration:1},{sourceIn:1,duration:Infinity}])('rejects invalid range without partial edits %j',range=>{
 const before=state().project;expect(()=>state().addAssetClip('v',0,undefined,range)).toThrow('选段');expect(state().project).toBe(before);expect(state().past).toHaveLength(0);
});
it('does not add a selection to an explicitly locked destination',()=>{const p=state().project;p.tracks[1].locked=true;state().setProject(p);state().addAssetClip('v',0,p.tracks[1].id,{sourceIn:1,duration:1});expect(state().project.clips).toHaveLength(0);expect(state().past).toHaveLength(0);});
