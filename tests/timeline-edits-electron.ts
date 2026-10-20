/** Real desktop source editing, linked gestures, persistence, preview and decoded export. Synthetic media only. */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { generateFixtures } from '../scripts/generate-fixtures';
import { importAssets, runMediaTool } from '../electron/media';
import { createProject } from '../src/core/model';
import type { Project } from '../src/core/types';
const root=process.cwd(),out=path.join(root,'.test-output/timeline-edits-electron');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const files=await generateFixtures(path.join(out,'fixtures'));
const magenta=path.join(out,'fixtures','插入-洋红.mp4'),cyan=path.join(out,'fixtures','覆盖-青色.mp4');
for(const [file,color,tone] of [[magenta,'magenta',660],[cyan,'cyan',330]] as const)
 await runMediaTool('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=160x90:r=30:d=2`,'-f','lavfi','-i',`sine=frequency=${tone}:duration=2:sample_rate=48000`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file]);
const assets=await importAssets([files.temporal,magenta,cyan],path.join(out,'cache'));
const p=createProject('时间线插入、覆盖与画声关联');p.width=160;p.height=90;p.assets=assets;
const saved=path.join(out,'rough-cut.reacut'),exported=path.join(out,'rough-cut.mp4');await writeFile(saved,JSON.stringify(p));
const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));env.REACUT_USER_DATA=path.join(out,'user-data');delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
let app!:ElectronApplication,page!:Page;const errors:string[]=[],checks:string[]=[];
async function launch(){
 app=await electron.launch({args:[path.join(root,'dist-electron/main.cjs'),saved],env});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({dialog},exported)=>{(dialog as any).showSaveDialog=async()=>({canceled:false,filePath:exported});(dialog as any).showMessageBox=async()=>({response:2});},exported);
 await expect(page.locator('[data-asset-id]')).toHaveCount(assets.length+(checks.length?1:0),{timeout:30000});
}
async function save():Promise<Project>{
 const before=(await stat(saved)).mtimeMs;await page.getByRole('button',{name:'保存项目',exact:true}).click();
 await expect.poll(async()=>(await stat(saved)).mtimeMs).toBeGreaterThan(before);
 return JSON.parse(await readFile(saved,'utf8'));
}
async function seek(time:number){const r=(await page.locator('.tl-ruler-body').boundingBox())!;await page.mouse.click(r.x+time*60,r.y+15);}
async function add(index:number,from:number,to:number,mode:string){
 await page.locator(`[data-asset-id="${assets[index].id}"]`).click();
 const source=page.getByRole('region',{name:'素材源预览'});
 await expect(source.getByRole('button',{name:'播放素材',exact:true})).toBeEnabled();
 await source.getByLabel('源素材入点',{exact:true}).fill(String(from));await source.getByLabel('源素材出点',{exact:true}).fill(String(to));
 await source.getByLabel('入轨方式').selectOption(mode);await source.getByLabel('目标轨道').selectOption(p.tracks[1].id);
 if(index===2) await page.screenshot({path:path.join(out,'source-overwrite.png')});
 await source.getByRole('button',{name:'添加选中片段'}).click();await expect(source).toHaveCount(0);
}
const clip=(id:string)=>page.locator(`[data-clip-id="${id}"]`);
const undo=()=>page.getByRole('button',{name:'撤销',exact:true}).click();
const redo=()=>page.getByRole('button',{name:'重做',exact:true}).click();
try{
 await launch();await add(0,0,4,'insert');await page.getByRole('button',{name:'分离音频',exact:true}).click();
 let q=await save();const video=q.clips.find(c=>c.assetId===assets[0].id)!,audio=q.clips.find(c=>c.id!==video.id)!;
 assert(video.linkId&&video.linkId===audio.linkId);assert(video.muted&&!audio.muted);
 await clip(video.id).click({position:{x:35,y:26}});await expect(page.locator('.tl-clip.is-selected')).toHaveCount(2);
 // Real pointer move previews both members before the single committed gesture.
 await page.getByRole('button',{name:'时间线吸附',exact:true}).click();
 const box=(await clip(video.id).boundingBox())!,audioBefore=(await clip(audio.id).boundingBox())!;
 await page.mouse.move(box.x+35,box.y+26);await page.mouse.down();await page.mouse.move(box.x+95,box.y+26,{steps:6});
 assert(Math.abs((await clip(audio.id).boundingBox())!.x-audioBefore.x-60)<2);
 await page.mouse.up();q=await save();assert(q.clips.every(c=>Math.abs(c.start-1)<1e-8));await undo();
 await clip(video.id).click({position:{x:35,y:26}});
 await clip(video.id).getByRole('slider',{name:/出点/}).focus();await page.keyboard.press('ArrowLeft');q=await save();assert(q.clips.every(c=>Math.abs(c.duration-(4-1/30))<1e-7));await undo();
 checks.push('separation creates a persistent pair; single click selects both; pointer move previews both; trim and undo preserve synchronization');
 await page.getByRole('button',{name:'锁定音频 1',exact:true}).click();
 await clip(video.id).click({position:{x:35,y:26}});await page.keyboard.press('Alt+ArrowRight');q=await save();assert(q.clips.every(c=>c.start===0));
 await expect(page.getByRole('button',{name:'解除画声关联',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'解锁音频 1',exact:true}).click();
 await page.getByRole('button',{name:'解除画声关联',exact:true}).click();await clip(video.id).click({position:{x:35,y:26}});await page.keyboard.press('Alt+ArrowRight');q=await save();assert(Math.abs(q.clips.find(c=>c.id===video.id)!.start-1/30)<1e-8);assert.equal(q.clips.find(c=>c.id===audio.id)!.start,0);await undo();await undo();
 checks.push('locked partner blocks edits and unlink; unlink allows independent edits and can be undone');
 await seek(1);await add(1,.5,1.5,'insert');q=await save();assert.equal(q.clips.length,5);
 assert.deepEqual(q.clips.filter(c=>c.trackId===p.tracks[1].id).sort((a,b)=>a.start-b.start).map(c=>[c.start,c.duration,c.sourceIn]),[[0,1,0],[1,1,.5],[2,3,1]]);
 await undo();await expect(page.locator('.tl-clip')).toHaveCount(2);await redo();await expect(page.locator('.tl-clip')).toHaveCount(5);
 await seek(3);await add(2,.5,1.5,'overwrite');q=await save();assert.equal(q.clips.length,8);
 assert.deepEqual(q.clips.filter(c=>c.trackId===p.tracks[1].id).sort((a,b)=>a.start-b.start).map(c=>[c.start,c.duration,c.sourceIn]),[[0,1,0],[1,1,.5],[2,1,1],[3,1,.5],[4,1,3]]);
 const audioClips=q.clips.filter(c=>c.trackId===p.tracks[2].id);assert.deepEqual(audioClips.map(c=>[c.start,c.duration,c.sourceIn]),[[0,1,0],[2,1,1],[4,1,3]]);
 await undo();await expect(page.locator('.tl-clip')).toHaveCount(5);await redo();await expect(page.locator('.tl-clip')).toHaveCount(8);q=await save();
 checks.push('three synthetic sources: I/O insert ripples both tracks; overwrite retains both sides and removes associated old audio; each action undoes in one step');
 await app.close();await launch();await expect(page.locator('.tl-clip')).toHaveCount(8);
 assert.deepEqual(JSON.parse(await readFile(saved,'utf8')).clips,q.clips);
 const right=q.clips.find(c=>c.start===4)!;await clip(right.id).click({position:{x:20,y:26}});await expect(page.locator('.tl-clip.is-selected')).toHaveCount(2);
 const expectedColors=[[255,0,0],[255,0,255],[0,128,0],[0,255,255],[255,255,0]];
 const previews:number[][]=[];
 for(let i=0;i<5;i++){
   await seek(i+.4);
   await expect.poll(async()=>{const pixel=await page.evaluate(()=>{const c=document.querySelector<HTMLCanvasElement>('.player-panel canvas')!;return [...c.getContext('2d')!.getImageData(c.width/2,c.height/2,1,1).data].slice(0,3);});previews[i]=pixel;return pixel.every((v,j)=>Math.abs(v-expectedColors[i][j])<25);}).toBe(true);
 }
 await seek(3.4);
 await page.getByRole('separator',{name:'调整时间线高度'}).focus();for(let n=0;n<4;n++)await page.keyboard.press('ArrowUp');
 await page.screenshot({path:path.join(out,'editor.png')});
 checks.push('save and actual process restart retain associations; decoded preview shows red / magenta / green / cyan / yellow at exact edited positions');
 await page.getByRole('button',{name:'导出',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出视频'});
 await dialog.getByRole('button',{name:'开始导出',exact:true}).click();await expect(dialog.getByText('导出完成',{exact:true})).toBeVisible({timeout:60000});
 const meta=JSON.parse((await runMediaTool('ffprobe',['-v','error','-show_format','-show_streams','-of','json',exported])).toString());assert(Math.abs(Number(meta.format.duration)-5)<.05);
 const videoStream=meta.streams.find((s:any)=>s.codec_type==='video');const frames=await runMediaTool('ffmpeg',['-v','error','-i',exported,'-vf','scale=160:90','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
 const pixels=expectedColors.map((color,i)=>{const pos=(Math.round((i+.4)*30)*160*90+45*160+80)*3;const pixel=[...frames.subarray(pos,pos+3)];assert(pixel.every((v,j)=>Math.abs(v-color[j])<25),`export color ${i}: ${pixel}`);return pixel;});
 const pcm=await runMediaTool('ffmpeg',['-v','error','-i',exported,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);
 const audioStats=[440,660,880,330,220].map((frequency,i)=>{let energy=0,crossings=0,last=0;const from=Math.round((i+.25)*48000),n=24000;for(let j=from;j<from+n;j++){const sample=pcm.readFloatLE(j*4);energy+=sample*sample;if(last<=0&&sample>0)crossings++;last=sample;}const rms=Math.sqrt(energy/n),hz=crossings*2;assert(Math.abs(hz-frequency)<8,`audio frequency ${i}: ${hz}`);assert(rms>.05&&rms<.11,`single source level ${i}: ${rms}`);return {hz,rms};});
 checks.push('actual 5-second export matches five preview colors and five source tones; RMS confirms no doubled old audio in replaced intervals');
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'evidence.json'),JSON.stringify({at:new Date().toISOString(),checks,previews,pixels,audioStats,duration:Number(meta.format.duration),width:videoStream.width,height:videoStream.height,errors},null,2));
 console.log(`Timeline edits desktop: ${checks.length} checks passed`);
}catch(error){await page!?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}finally{await app!?.close().catch(()=>{});}
