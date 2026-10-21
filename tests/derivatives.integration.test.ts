import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { runMediaTool, importAssets, probeFile } from '../electron/media';
import { deriveMedia, cancelDerivative, cancelDerivatives } from '../electron/derivatives';
import { applyDerivative } from '../src/core/derivativeEdits';
import { collectPortableProject, resolvePortableDocument } from '../electron/portableProject';
import { createClip, createProject } from '../src/core/model';
import type { DerivativeRequest, MediaAsset } from '../src/core/types';
let dir: string, asset: MediaAsset, originalHash: string, colors: number[][];
const reverse: DerivativeRequest = { mode:'reverse',audio:'reverse',time:0,duration:2 };
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const decode = async (file:string) => { const b=await runMediaTool('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);return Array.from({length:b.length/(64*64*3)},(_,i)=>[...b.subarray((i*64*64+32*64+32)*3,(i*64*64+32*64+32)*3+3)]); };
const identify = (pixels:number[][]) => pixels.map(pixel=>{const distances=colors.map(c=>c.reduce((s,v,j)=>s+(v-pixel[j])**2,0));const best=Math.min(...distances);expect(best).toBeLessThan(180);return distances.indexOf(best);});
function project(speed=1,sourceIn=.35,duration=3,fps=30) { const p=createProject('Derivative');p.width=64;p.height=64;p.fps=fps;p.assets=[asset];const c=createClip(asset,p.tracks[1].id,0,fps);Object.assign(c,{speed,sourceIn,duration});p.clips=[c];return p; }
beforeAll(async()=>{
 dir=await mkdtemp(path.join(tmpdir(),'reacut-derivatives-'));const file=path.join(dir,'source.mp4');
 await runMediaTool('ffmpeg',['-v','error','-y','-f','lavfi','-i',"nullsrc=s=64x64:r=30:d=6,format=gbrp,geq=r='16+32*mod(N,8)':g='16+32*mod(floor(N/8),8)':b='16+32*floor(N/64)'",'-f','lavfi','-i','aevalsrc=0.1*sin(2*PI*(220+220*floor(t))*t):s=48000:d=6','-c:v','libx264','-crf','12','-g','90','-bf','3','-pix_fmt','yuv420p','-c:a','aac',file]);
 [asset]=await importAssets([file],path.join(dir,'thumbnails'));colors=await decode(file);originalHash=hash(await readFile(file));
});
afterAll(async()=>{await cancelDerivatives();await rm(dir,{recursive:true,force:true});});
describe('local reverse/freeze real media',()=>{
 it.each([{speed:1,sourceIn:.35,duration:3,fps:30},{speed:1.5,sourceIn:.35,duration:3,fps:24},{speed:.5,sourceIn:3.05,duration:2.5,fps:30}])('reverses every sampled frame across block boundaries $speed x / $fps fps',async({speed,sourceIn,duration,fps})=>{
  const p=project(speed,sourceIn,duration,fps),events:number[]=[];
  const a=await deriveMedia(randomUUID(),p,p.clips[0].id,reverse,path.join(dir,'derived'),e=>events.push(e.progress));
  const expected=Array.from({length:Math.round(duration*fps)},(_,i)=>Math.floor((sourceIn+i/fps*speed)*30+1e-6)).reverse();
  expect(identify(await decode(a.path))).toEqual(expected);expect(events[0]).toBe(0);expect(events.at(-1)).toBe(1);
  expect(a.duration).toBeCloseTo(duration,1);expect(a.hasAudio).toBe(true);
  const timestamps=JSON.parse((await runMediaTool('ffprobe',['-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',a.path])).toString()).frames;
  timestamps.forEach((f:{best_effort_timestamp_time:string},i:number)=>expect(Number(f.best_effort_timestamp_time)).toBeCloseTo(i/fps,5));
 });
 it('freeze keeps preceding source frame at a fractional seek, including speed',async()=>{
  const p=project(1.5,.35,3),time=1.1;
  const a=await deriveMedia(randomUUID(),p,p.clips[0].id,{...reverse,mode:'freeze',time},path.join(dir,'derived'),()=>{});
  expect(a.kind).toBe('image');expect(identify(await decode(a.path))).toEqual([Math.floor((.35+time*1.5)*30+1e-8)]);
 });
 it('cache reuse keeps bytes and modification time; mute makes a distinct video with no audio stream',async()=>{
  const p=project(),first=await deriveMedia(randomUUID(),p,p.clips[0].id,reverse,path.join(dir,'derived'),()=>{}),mtime=(await stat(first.path)).mtimeMs;
  const next=await deriveMedia(randomUUID(),p,p.clips[0].id,reverse,path.join(dir,'derived'),()=>{});
  expect(next.path).toBe(first.path);expect((await stat(next.path)).mtimeMs).toBe(mtime);
  const muted=await deriveMedia(randomUUID(),p,p.clips[0].id,{...reverse,audio:'mute'},path.join(dir,'derived'),()=>{});
  expect(muted.path).not.toBe(first.path);expect((await probeFile(muted.path)).streams.some(s=>s.codec_type==='audio')).toBe(false);
  expect(hash(await readFile(asset.path))).toBe(originalHash);
 });
 it('reverses actual audible tone order, including the chunk boundary',async()=>{
  const p=project(1,0,4),a=await deriveMedia(randomUUID(),p,p.clips[0].id,reverse,path.join(dir,'derived'),()=>{});
  const pcm=await runMediaTool('ffmpeg',['-v','error','-i',a.path,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);
  for(let i=0;i<4;i++) { let power=0,crossings=0,last=0;for(let n=Math.round((i+.25)*48000);n<(i+.75)*48000;n++){const v=pcm.readFloatLE(n*4);power+=v*v;if(last<=0&&v>0)crossings++;last=v;}expect(crossings*2).toBeCloseTo((4-i)*220,-1);expect(Math.sqrt(power/24000)).toBeGreaterThan(.05); }
 });
 it('VFR gaps hold the preceding source frame before reversing or freezing',async()=>{
  const file=path.join(dir,'vfr.mp4');
  const keep=(n:number)=>n<12?n%3===0:(n>=72&&n<=85)||(n>=105&&n%5===0);
  await runMediaTool('ffmpeg',['-v','error','-y','-i',asset.path,'-vf',"select='lt(n,12)*not(mod(n,3))+between(n,72,85)+gte(n,105)*not(mod(n,5))'",'-fps_mode','vfr','-c:v','libx264','-crf','12','-an',file]);
  const [vfr]=await importAssets([file],path.join(dir,'thumbnails'));const p=project(1.5,1.1,1.5);p.assets=[{...vfr,id:asset.id}];
  const ids=Array.from({length:180},(_,i)=>i).filter(keep);
  const expected=Array.from({length:45},(_,i)=>ids.filter(n=>n/30<=1.1+i/30*1.5+1e-8).at(-1)!).reverse();
  const a=await deriveMedia(randomUUID(),p,p.clips[0].id,{...reverse,audio:'mute'},path.join(dir,'derived'),()=>{});
  expect(identify(await decode(a.path))).toEqual(expected);
  const still=await deriveMedia(randomUUID(),p,p.clips[0].id,{...reverse,mode:'freeze',time:0},path.join(dir,'derived'),()=>{});
  expect(identify(await decode(still.path))).toEqual([9]);
 });
 it('portable collection includes generated files and reopens with package-relative media',async()=>{
  const p=project(),a=await deriveMedia(randomUUID(),p,p.clips[0].id,reverse,path.join(dir,'derived'),()=>{});
  const q=applyDerivative(p,p.clips[0].id,reverse,a).project;
  const folder=await collectPortableProject(q,dir,new AbortController().signal,()=>{});
  const file=path.join(folder,'项目.reacut');const document=JSON.parse(await readFile(file,'utf8'));
  const loaded=await resolvePortableDocument(document,file);
  const resolvedFolder=await realpath(folder);expect(loaded.assets.every(a=>a.path.startsWith(resolvedFolder + path.sep))).toBe(true);
  const derived=loaded.assets.find(item=>item.id===a.id)!;
  expect(hash(await readFile(derived.path))).toBe(hash(await readFile(a.path)));
 });
 it('cancels before the first worker and refuses overlapping jobs',async()=>{
  const p=project(),job=randomUUID();const pending=deriveMedia(job,p,p.clips[0].id,reverse,path.join(dir,'derived'),()=>{});
  expect(()=>deriveMedia(randomUUID(),p,p.clips[0].id,reverse,path.join(dir,'derived'),()=>{})).toThrow(/已有/);
  cancelDerivative(job);await expect(pending).rejects.toThrow('已取消处理');
 });
 it('cancels active ffmpeg, clears temporary blocks, and permits a later operation',async()=>{
  const p=project(1,.7,4),job=randomUUID();let cancelled=false;
  const pending=deriveMedia(job,p,p.clips[0].id,reverse,path.join(dir,'cancelled'),e=>{if(e.progress>0&&!cancelled){cancelled=true;cancelDerivative(job);}});
  await expect(pending).rejects.toThrow();expect(cancelled).toBe(true);
  expect((await readdir(path.join(dir,'cancelled'))).filter(n=>n.startsWith('.processing'))).toEqual([]);
  const next=await deriveMedia(randomUUID(),p,p.clips[0].id,{...reverse,mode:'freeze',time:1},path.join(dir,'cancelled'),()=>{});expect(next.kind).toBe('image');
 });
});
