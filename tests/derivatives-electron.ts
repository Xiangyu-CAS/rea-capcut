import { firstChineseWindow } from "./ui-language";
/** Original numbered-frame video through the real desktop UI, storage, preview and export. */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClip, createProject } from '../src/core/model';
import { importAssets, runMediaTool } from '../electron/media';
import type { Project } from '../src/core/types';
const out=path.resolve('.test-output/derivatives-electron');await rm(out,{recursive:true,force:true});await mkdir(path.join(out,'frames'),{recursive:true});
const colors:number[][]=[];
for(let i=0;i<72;i++){
 const c=createCanvas(320,180),ctx=c.getContext('2d'),rgb=[16+32*(i%8),16+32*(Math.floor(i/8)%8),48+32*Math.floor(i/64)];colors.push(rgb);
 ctx.fillStyle=`rgb(${rgb.join(',')})`;ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='bold 48px sans-serif';ctx.fillText(String(i).padStart(2,'0'),125,90);ctx.font='14px sans-serif';ctx.fillText('ReaCut original frame test',60,125);
 await writeFile(path.join(out,'frames',`${String(i).padStart(3,'0')}.png`),c.toBuffer('image/png'));
}
const source=path.join(out,'numbered-frames.mp4');
await runMediaTool('ffmpeg',['-v','error','-y','-framerate','12','-i',path.join(out,'frames','%03d.png'),'-f','lavfi','-i','aevalsrc=0.1*sin(2*PI*(220+110*floor(t))*t):s=48000:d=6','-c:v','libx264','-crf','12','-pix_fmt','yuv420p','-c:a','aac',source]);
const sourceHash=createHash('sha256').update(await readFile(source)).digest('hex');
const [asset]=await importAssets([source],path.join(out,'thumbnails'));
const p=createProject('倒放与定格 · 原创帧编号验收');p.width=320;p.height=180;p.fps=24;p.assets=[asset];
const video=createClip(asset,p.tracks[1].id,0,24);Object.assign(video,{sourceIn:.5,duration:3,speed:1.5});p.clips=[video];
const saved=path.join(out,'reverse-freeze.reacut'),output=path.join(out,'reverse-freeze.mp4');await writeFile(saved,JSON.stringify(p));
const env: Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));env.REACUT_USER_DATA=path.join(out,'user-data');delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
let app!:ElectronApplication,page!:Page;const errors:string[]=[],checks:string[]=[],previews:number[]=[];
async function launch(){app=await electron.launch({args:[path.resolve('dist-electron/main.cjs'),saved],env});page=await firstChineseWindow(app);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({dialog,BrowserWindow},output)=>{BrowserWindow.getAllWindows()[0].setSize(1470,834);(dialog as any).showSaveDialog=async()=>({canceled:false,filePath:output});(dialog as any).showMessageBox=async()=>({response:2});},output);await expect(page.locator('.tl-clip').first()).toBeVisible({timeout:30000});}
async function save():Promise<Project>{const time=(await stat(saved)).mtimeMs;await page.getByRole('button',{name:'保存项目',exact:true}).click();await expect.poll(async()=>(await stat(saved)).mtimeMs).toBeGreaterThan(time);return JSON.parse(await readFile(saved,'utf8'));}
async function seek(t:number){const r=(await page.locator('.tl-ruler-body').boundingBox())!;await page.mouse.click(r.x+t*60,r.y+15);}
const select=async()=>{await page.locator(`[data-clip-id="${video.id}"]`).click({position:{x:20,y:26}});};
const undo=()=>page.getByRole('button',{name:'撤销',exact:true}).click(),redo=()=>page.getByRole('button',{name:'重做',exact:true}).click();
const identify=(rgb:number[])=>{const d=colors.map(c=>c.reduce((s,v,j)=>s+(v-rgb[j])**2,0));assert(Math.min(...d)<500,`unexpected pixel ${rgb}`);return d.indexOf(Math.min(...d));};
const reversed=Array.from({length:72},(_,i)=>Math.floor((.5+i/24*1.5)*12+1e-6)).reverse();
try{
 await launch();await select();await page.getByRole('button',{name:'分离音频',exact:true}).click();const paired=await save();
 await page.getByRole('button',{name:'倒放',exact:true}).click();let d=page.getByRole('dialog',{name:'视频倒放',exact:true});
 await d.getByRole('button',{name:'生成倒放',exact:true}).click();await d.getByRole('button',{name:'取消处理',exact:true}).click();await expect(d.getByRole('button',{name:'关闭',exact:true})).toBeEnabled({timeout:30000});await d.getByRole('button',{name:'关闭',exact:true}).click();assert.deepEqual((await save()).clips,paired.clips);
 checks.push('UI cancellation preserves the whole project');
 await page.getByRole('button',{name:'倒放',exact:true}).click();d=page.getByRole('dialog',{name:'视频倒放',exact:true});await d.getByLabel('倒放声音').selectOption('reverse');await d.getByRole('button',{name:'生成倒放',exact:true}).click();await expect(d).toHaveCount(0,{timeout:30000});
 let q=await save();assert(q.clips.every(c=>c.sourceIn===0&&c.speed===1&&c.duration===3));assert(q.clips[0].linkId===q.clips[1].linkId);assert(q.clips[0].muted&&!q.clips[1].muted);
 await undo();assert.deepEqual((await save()).clips,paired.clips);await redo();q=await save();
 checks.push('reverse applies the trimmed 1.5x source to both linked members; one-step undo/redo restores assets and clips');
 await select();await seek(1);await page.getByRole('button',{name:'定格',exact:true}).click();d=page.getByRole('dialog',{name:'插入定格',exact:true});await d.getByLabel('定格时长（秒）').fill('1.5');await page.screenshot({path:path.join(out,'freeze-dialog.png')});await d.getByRole('button',{name:'生成定格',exact:true}).click();await expect(d).toHaveCount(0,{timeout:30000});
 q=await save();assert.equal(q.clips.length,5);const hold=q.clips.find(c=>q.assets.find(a=>a.id===c.assetId)?.kind==='image')!;assert(hold.start===1&&hold.duration===1.5);
 assert.equal(q.clips.filter(c=>c.start===2.5&&c.sourceIn===1).length,2);await undo();await expect(page.locator('.tl-clip')).toHaveCount(2);await redo();q=await save();
 checks.push('freeze at the playhead inserts 1.5 seconds and ripples linked video/audio; undo is atomic');
 await app.close();await launch();await expect(page.locator('.tl-clip')).toHaveCount(5);
 const expected=[...reversed.slice(0,24),...Array(36).fill(reversed[24]),...reversed.slice(24)];
 for(const frame of [0,12,24,40,59,60,80,81,82,107]){
  await seek(frame/24);
  let current=-1;
  await expect.poll(async()=>{const rgb=await page.evaluate(()=>{const c=document.querySelector<HTMLCanvasElement>('.player-panel canvas')!;return [...c.getContext('2d')!.getImageData(c.width*.03,c.height*.85,1,1).data].slice(0,3);});try{current=identify(rgb);}catch{return false;}return current===expected[frame];}).toBe(true);previews.push(current);
 }
 await seek(1.5);await page.locator(`[data-clip-id="${hold.id}"]`).click({position:{x:25,y:26}});await page.screenshot({path:path.join(out,'editor.png')});
 checks.push('actual process restart restores generated media and linked references; ten decoded preview frames match numbered source frames');
 await page.getByRole('button',{name:'导出',exact:true}).click();d=page.getByRole('dialog',{name:'导出视频',exact:true});await d.getByRole('button',{name:'开始导出',exact:true}).click();await expect(d.getByText('导出完成',{exact:true})).toBeVisible({timeout:60000});
 const raw=await runMediaTool('ffmpeg',['-v','error','-i',output,'-map','0:v:0','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],60000,32*1024*1024);
 const actual=Array.from({length:raw.length/(320*180*3)},(_,i)=>{const n=(i*320*180+153*320+10)*3;return identify([...raw.subarray(n,n+3)]);});assert.deepEqual(actual,expected);
 const pcm=await runMediaTool('ffmpeg',['-v','error','-i',output,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1']);const rms=(from:number,to:number)=>{let sum=0;for(let i=Math.round(from*48000);i<Math.round(to*48000);i++)sum+=pcm.readFloatLE(i*4)**2;return Math.sqrt(sum/((to-from)*48000));};const levels=[rms(.2,.7),rms(1.2,2.2),rms(2.7,3.2)];assert(levels[0]>.04&&levels[1]<.001&&levels[2]>.04);
 assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),sourceHash);assert.deepEqual(errors,[]);
 checks.push('all 108 exported frames match reversed/held source IDs; audio is audible around the silent freeze; source hash unchanged');
 await writeFile(path.join(out,'evidence.json'),JSON.stringify({at:new Date().toISOString(),checks,previews,frameCount:actual.length,frameIds:actual,audioRMS:levels,errors},null,2));console.log(`Derivatives desktop: ${checks.length} groups passed`);
}catch(e){await page!?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}finally{await app!?.close().catch(()=>{});}
