/** Actual App → source marks → store → saved file → bundled export, synthetic media only. */
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { generateFixtures } from '../scripts/generate-fixtures';
import { importAssets, runMediaTool } from '../electron/media';
import { createProject } from '../src/core/model';
const root=process.cwd(),output=path.join(root,'.test-output/source-preview-electron');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const files=await generateFixtures(path.join(output,'fixtures'));
const assets=await importAssets([files.temporal],path.join(output,'cache'));
const project=createProject('源素材选段验收');project.width=160;project.height=90;project.assets=assets;
const projectFile=path.join(output,'source.reacut'),exported=path.join(output,'selected.mp4');await writeFile(projectFile,JSON.stringify(project));
const appPath=process.env.REACUT_TEST_APP;
const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));env.REACUT_USER_DATA=path.join(output,'user-data');delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
if(appPath){env.PATH='';delete env.REACUT_FFMPEG;delete env.REACUT_FFPROBE;}
const app=await electron.launch({...appPath?{executablePath:path.join(path.resolve(appPath),'Contents/MacOS/ReaCut'),args:[projectFile],cwd:output}:{args:[path.join(root,'dist-electron/main.cjs'),projectFile]},env});
const page=await app.firstWindow(),errors:string[]=[],checks:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await app.evaluate(({dialog},exported)=>{(dialog as any).showSaveDialog=async()=>({canceled:false,filePath:exported});(dialog as any).showMessageBox=async()=>({response:2});},exported);
 await expect(page.locator('[data-asset-id]')).toHaveCount(1,{timeout:30000});
 await page.locator('[data-asset-id]').click();const source=page.getByRole('region',{name:'素材源预览'});
 await expect(source.getByRole('button',{name:'播放素材',exact:true})).toBeEnabled();
 await source.getByLabel('素材预览进度').fill('2');await source.focus();await page.keyboard.press('i');
 await source.getByLabel('素材预览进度').fill('3');await source.focus();await page.keyboard.press('o');
 await expect(source.getByLabel('源素材入点',{exact:true})).toHaveValue('2');await expect(source.getByLabel('源素材出点',{exact:true})).toHaveValue('3');
 await page.screenshot({path:path.join(output,'source-preview.png')});
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(1024,600);w.setSize(1024,720);});
 await expect.poll(()=>page.evaluate(()=>window.innerWidth)).toBe(1024);
 const geometry=await source.getByRole('button',{name:'添加选中片段'}).evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.source-preview')!.getBoundingClientRect();return {bottom:r.bottom,panelBottom:p.bottom,right:r.right,panelRight:p.right};});
 assert(geometry.bottom<=geometry.panelBottom+1 && geometry.right<=geometry.panelRight+1,'source add remains inside panel at 1024×720');
 await page.screenshot({path:path.join(output,'source-preview-1024.png')});checks.push('1024×720 source marking and add controls stay within the preview panel');
 await source.getByRole('button',{name:'添加选中片段'}).click();await expect(source).toHaveCount(0);await expect(page.locator('.tl-clip')).toHaveCount(1);
 await page.getByRole('button',{name:'保存项目',exact:true}).click();
 await expect.poll(async()=>JSON.parse(await readFile(projectFile,'utf8')).clips.length).toBe(1);
 const saved=JSON.parse(await readFile(projectFile,'utf8'));assert.equal(saved.clips[0].sourceIn,2);assert.equal(saved.clips[0].duration,1);
 checks.push('single-click real source preview; I/O marks select 2–3s; timeline and saved project retain exact source range');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('.tl-clip')).toHaveCount(0);
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.locator('.tl-clip')).toHaveCount(1);checks.push('source insertion is one undo/redo operation');
 await page.getByRole('button',{name:'导出',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出视频'});
 await dialog.getByRole('button',{name:'开始导出',exact:true}).click();await expect(dialog.getByText('导出完成',{exact:true})).toBeVisible({timeout:60000});
 const metadata=JSON.parse((await runMediaTool('ffprobe',['-v','error','-show_format','-show_streams','-of','json',exported])).toString());assert(Math.abs(Number(metadata.format.duration)-1)<.06);
 const frame=await runMediaTool('ffmpeg',['-v','error','-i',exported,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);const at=(45*160+80)*3;assert(frame[at+2]>180&&frame[at]<50);
 const pcm=await runMediaTool('ffmpeg',['-v','error','-i',exported,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);let energy=0;for(let i=0;i<pcm.length;i+=4)energy+=pcm.readFloatLE(i)**2;assert(Math.sqrt(energy/(pcm.length/4))>.03);
 checks.push('actual export decodes selected blue source second with audible audio, exact one-second duration');
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'evidence.json'),JSON.stringify({at:new Date().toISOString(),packaged:!!appPath,checks,duration:Number(metadata.format.duration),pixel:[...frame.subarray(at,at+3)],errors},null,2));console.log(`Source-preview desktop: ${checks.length} checks passed (packaged=${!!appPath})`);
}catch(e){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}finally{await app.close();}
