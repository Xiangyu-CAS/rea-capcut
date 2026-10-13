/** A synthetic 15-minute / 300-cue project; operation times include Playwright overhead. */
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createProject, createClip } from '../src/core/model';
const root=process.cwd(),output=path.join(root,'.test-output/large-subtitles-electron');await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const project=createProject('十五分钟字幕验收');project.tracks[0].name='字幕';project.clips=Array.from({length:300},(_,i)=>{const c=createClip(undefined,project.tracks[0].id,i*3,30);c.duration=3;c.text!.text=`第 ${String(i+1).padStart(3,'0')} 条合成字幕`;return c;});
const file=path.join(output,'large.reacut');await writeFile(file,JSON.stringify(project));
const packaged=process.env.REACUT_TEST_APP,env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));env.REACUT_USER_DATA=path.join(output,'user-data');delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;if(packaged){env.PATH='';delete env.REACUT_FFMPEG;delete env.REACUT_FFPROBE;}
const begin=performance.now();const app=await electron.launch({...packaged?{executablePath:path.join(path.resolve(packaged),'Contents/MacOS/ReaCut'),args:[file],cwd:output}:{args:[path.join(root,'dist-electron/main.cjs'),file]},env});const page=await app.firstWindow(),errors:string[]=[],checks:string[]=[];const timings:Record<string,number>={};page.on('pageerror',e=>errors.push(e.message));
try{
 await expect(page.locator('.tl-clip')).toHaveCount(300,{timeout:30000});timings.launchToTimelineMs=Math.round(performance.now()-begin);
 await app.evaluate(({dialog})=>{(dialog as any).showMessageBox=async()=>({response:2});});
 await page.getByRole('button',{name:'字幕',exact:true}).click();await expect(page.locator('.subtitle-cue')).toHaveCount(300);
 let start=performance.now();await page.getByLabel('搜索字幕',{exact:true}).fill('第 300');await expect(page.locator('.subtitle-cue')).toHaveCount(1);timings.searchMs=Math.round(performance.now()-start);
 await page.locator('.subtitle-cue-content').click();await expect(page.getByLabel('字幕开始时间',{exact:true})).toHaveValue('897');checks.push('300 cues across 15 minutes load, filter and locate the final cue at its absolute timeline position');
 await page.getByLabel('搜索字幕',{exact:true}).fill('');await page.getByRole('checkbox',{name:'选择搜索结果',exact:true}).check();await page.getByLabel('字幕偏移秒数',{exact:true}).fill('1');
 start=performance.now();await page.getByRole('button',{name:'检查修改',exact:true}).click();await page.getByRole('button',{name:'应用 300 条修改',exact:true}).click();await page.getByRole('button',{name:'保存项目',exact:true}).click();
 await expect.poll(async()=>JSON.parse(await readFile(file,'utf8')).clips[0].start,{timeout:20000}).toBe(1);timings.planApplySaveMs=Math.round(performance.now()-start);
 const shifted=JSON.parse(await readFile(file,'utf8'));assert(shifted.clips.every((c:any,i:number)=>Math.abs(c.start-(i*3+1))<1e-8&&c.duration===3&&c.text.text===project.clips[i].text!.text));checks.push('one batch operation shifts all 300 cues precisely and preserves every duration and text through native save');
 start=performance.now();await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'保存项目',exact:true}).click();await expect.poll(async()=>JSON.parse(await readFile(file,'utf8')).clips[0].start).toBe(0);timings.undoSaveMs=Math.round(performance.now()-start);
 const restored=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(restored.clips,JSON.parse(JSON.stringify(project.clips)));checks.push('a single undo restores all 300 original clips byte-for-byte in their project data');
 const memory=await app.evaluate(({app})=>app.getAppMetrics().filter(m=>m.type==='Tab').map(m=>({type:m.type,memory:m.memory})));
 await page.screenshot({path:path.join(output,'large-subtitles.png')});assert.deepEqual(errors,[]);await writeFile(path.join(output,'evidence.json'),JSON.stringify({at:new Date().toISOString(),packaged:!!packaged,cueCount:300,projectDurationSeconds:900,checks,timingsMsIncludingAutomation:timings,rendererMemory:memory,errors},null,2));console.log(JSON.stringify({checks,timings,memory,errors},null,2));
}catch(e){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}finally{await app.close();}
