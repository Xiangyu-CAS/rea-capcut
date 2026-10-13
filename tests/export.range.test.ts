import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClip, createProject } from "../src/core/model";
import { resolveExportRange, selectedClipRange } from "../src/core/exportRange";
import { importAssets, runMediaTool } from "../electron/media";
import { startExport } from "../electron/export";
import type { ExportOptions, Project } from "../src/core/types";
let directory:string;
beforeAll(async()=>{directory=await mkdtemp(path.join(tmpdir(),'reacut-range-'));});
afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
const baseProject=()=>{const p=createProject('区间');const c=createClip(undefined,p.tracks[0].id,0,30);c.duration=4;p.clips=[c];return p;};
describe('export range',()=>{
 it.each([{start:-1,end:2},{start:2,end:1},{start:0,end:8},{start:0,end:0},{start:NaN,end:2},{start:0,end:Infinity},{start:1,end:1.001},null,'bad'])('rejects invalid range %j',range=>{
  expect(()=>resolveExportRange(baseProject(),{fps:30,range:range as any})).toThrow('区间');
 });
 it('selects the bounding interval, preserving gaps and overlapping tracks',()=>{
  const p=baseProject();p.clips.push({...p.clips[0],id:'other',start:8,duration:2});
  expect(selectedClipRange(p,p.clips.map(c=>c.id))).toEqual({start:0,end:10});expect(selectedClipRange(p,[])).toBeUndefined();
  expect(resolveExportRange(p,{fps:30,range:{start:5,end:6}})).toEqual({start:5,end:6,duration:1});
 });
 it('exports the exact middle interval with original animation and audio envelopes',async()=>{
  const source=path.join(directory,'source.mkv');
  await runMediaTool('ffmpeg',['-v','error','-y','-f','lavfi','-i',"nullsrc=s=160x90:r=30:d=5,format=gbrp,geq=r='mod(N*7,240)':g='100':b='20'",'-f','lavfi','-i','sine=frequency=440:duration=5:sample_rate=48000','-c:v','ffv1','-c:a','pcm_s16le',source]);
  const [asset]=await importAssets([source],path.join(directory,'cache'));
  const p=createProject('动态范围');p.width=160;p.height=90;p.background='#000000';p.assets=[asset];
  const c=createClip(asset,p.tracks.find(t=>t.kind==='video')!.id,1,30);
  c.sourceIn=.5;c.speed=1.5;c.duration=2;c.fadeIn=.6;c.audioFadeIn=.8;c.audioFadeOut=.5;
  c.keyframes=[{id:'volume-a',property:'volume',time:0,value:.3,easing:'linear'},{id:'volume-b',property:'volume',time:2,value:1,easing:'easeInOut'},{id:'opacity-a',property:'opacity',time:0,value:.2,easing:'linear'},{id:'opacity-b',property:'opacity',time:2,value:1,easing:'easeInOut'}];p.clips=[c];
  const before=JSON.stringify(p), full=await render(p,'full'), part=await render(p,'part',{start:1.5,end:2.5});
  expect(JSON.stringify(p)).toBe(before);
  const probe=JSON.parse((await runMediaTool('ffprobe',['-v','error','-show_format','-show_streams','-of','json',part])).toString());
  expect(Number(probe.format.duration)).toBeCloseTo(1,2);
  const raw=async(file:string)=>runMediaTool('ffmpeg',['-v','error','-i',file,'-an','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  const [a,b]=await Promise.all([raw(full),raw(part)]), bytes=160*90*3;
  expect(b.length/bytes).toBe(30);
  for(const frame of [0,7,15,29]){
   const ref=a.subarray((45+frame)*bytes,(46+frame)*bytes),actual=b.subarray(frame*bytes,(frame+1)*bytes);
   let sum=0;for(let i=0;i<bytes;i++)sum+=Math.abs(ref[i]-actual[i]);expect(sum/bytes).toBeLessThan(4);
  }
  const samples=async(file:string,start:string)=>runMediaTool('ffmpeg',['-v','error','-i',file,'-ss',start,'-t','0.5','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);
  const rms=(b:Buffer)=>{let sum=0;for(let i=0;i<b.length;i+=4)sum+=b.readFloatLE(i)**2;return Math.sqrt(sum/(b.length/4));};
  const [af,bf]=await Promise.all([samples(full,'1.7'),samples(part,'0.2')]);
  expect(rms(bf)).toBeGreaterThan(.015);expect(Math.abs(rms(af)-rms(bf))).toBeLessThan(.003);
 },30000);
 it('does not require missing media entirely outside the requested interval',async()=>{
  const p=baseProject();p.width=160;p.height=90;
  const asset={id:'missing',name:'outside',path:path.join(directory,'absent.mp4'),url:'file:///absent.mp4',kind:'video' as const,duration:2,width:160,height:90,fps:30,hasAudio:false,missing:true};
  p.assets=[asset];p.clips.push({...createClip(asset,p.tracks.find(t=>t.kind==='video')!.id,5,30),duration:2});
  const result=await render(p,'outside',{start:0,end:1});expect(result).toContain('outside.mp4');
  await expect(render(p,'missing-range',{start:5,end:6})).rejects.toThrow('素材丢失');
 },20000);
});
async function render(project:Project,name:string,range?:ExportOptions['range']):Promise<string>{
 const file=path.join(directory,name+'.mp4');
 await new Promise<void>((resolve,reject)=>{void startExport(project,{path:file,width:160,height:90,fps:30,quality:'high',format:'mp4',range},event=>{if(event.status==='complete')resolve();else if(event.status==='error'||event.status==='cancelled')reject(new Error(event.message??event.status));}).catch(reject);});return file;
}
