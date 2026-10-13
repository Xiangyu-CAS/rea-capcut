/** Panel layout preferences: real pointer/keyboard, resize, restart, no project mutations. */
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createProject, createClip } from '../src/core/model';
const root=process.cwd(),output=path.join(root,'.test-output/workspace-electron');await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const p=createProject('三栏布局验收');const clip=createClip(undefined,p.tracks[0].id,0,30);clip.text!.text='熟悉的剪辑空间';p.clips=[clip];
const file=path.join(output,'layout.reacut');await writeFile(file,JSON.stringify(p));
const packaged=process.env.REACUT_TEST_APP,env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));env.REACUT_USER_DATA=path.join(output,'user-data');delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;if(packaged){env.PATH='';delete env.REACUT_FFMPEG;delete env.REACUT_FFPROBE;}
const launch=()=>electron.launch({...packaged?{executablePath:path.join(path.resolve(packaged),'Contents/MacOS/ReaCut'),args:[file],cwd:output}:{args:[path.join(root,'dist-electron/main.cjs'),file]},env});
let app=await launch(),page=await app.firstWindow();const errors:string[]=[],checks:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const geometry=()=>page.locator('.editor-workspace').evaluate(el=>{const panels=Array.from(el.children).filter(c=>!c.classList.contains('workspace-divider'));return {left:panels[0].getBoundingClientRect().width,center:panels[1].getBoundingClientRect().width,right:panels[2].getBoundingClientRect().width,total:el.getBoundingClientRect().width,document:document.documentElement.scrollWidth,window:window.innerWidth};});
try{
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1470,834));await expect.poll(()=>page.evaluate(()=>window.innerWidth)).toBe(1470);
 await expect(page.locator('.tl-clip')).toHaveCount(1);await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();
 const original=await geometry();const left=page.getByRole('separator',{name:'调整素材区宽度'}),right=page.getByRole('separator',{name:'调整属性区宽度'});
 const rect=await left.boundingBox();assert(rect);await page.mouse.move(rect.x+3,rect.y+80);await page.mouse.down();await page.mouse.move(rect.x+83,rect.y+80,{steps:8});await page.mouse.up();
 await expect.poll(async()=>Math.round((await geometry()).left-original.left)).toBe(80);
 await right.focus();await page.keyboard.press('ArrowLeft');await expect.poll(async()=>Math.round((await geometry()).right-original.right)).toBe(10);
 await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();const adjusted=await geometry();checks.push('pointer drag and arrow keys resize adjacent panels without changing project undo history');
 await app.close();app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('.tl-clip')).toHaveCount(1);
 await expect.poll(async()=>Math.round((await geometry()).left)).toBe(Math.round(adjusted.left));checks.push('panel widths persist across an actual application restart');
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(1024,600);w.setSize(1024,720);});await expect.poll(()=>page.evaluate(()=>window.innerWidth)).toBe(1024);
 await expect.poll(async()=>{const g=await geometry();return g.document<=g.window;}).toBe(true);let small=await geometry();assert(small.center>=319.9&&small.left>=279.9&&small.right>=279.9&&small.document<=small.window);await page.getByRole('button',{name:'剪辑助手',exact:true}).click();small=await geometry();assert(small.center>=319.9&&small.right>=309.9&&small.document<=small.window);checks.push('saved widths adapt at 1024px and maintain usable player/assistant minimums without page overflow');
 const edge=page.getByRole('separator',{name:'调整素材区宽度'});await edge.focus();for(let i=0;i<15;i++)await page.keyboard.press('Shift+ArrowRight');
 await expect.poll(async()=>Math.round((await geometry()).center)).toBe(320);
 const controls=await page.locator('.player-controls').evaluate(el=>{const parent=el.getBoundingClientRect();return [...el.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=parent.left&&r.right<=parent.right;});});assert(controls,'all player controls remain within their panel at maximum resource width');checks.push('maximum-width clamp preserves the complete player control row');
 await page.screenshot({path:path.join(output,'workspace-small.png')});await page.getByRole('button',{name:'剪辑助手',exact:true}).click();
 const reset=page.getByRole('separator',{name:'调整素材区宽度'});await reset.dblclick();await expect.poll(()=>page.evaluate(()=>localStorage.getItem('reacut-panel-widths-v1'))).toBeNull();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1470,834));await expect.poll(async()=>Math.round((await geometry()).left)).toBe(Math.round(original.left));checks.push('double click resets preferences and restores responsive default widths');
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'evidence.json'),JSON.stringify({at:new Date().toISOString(),packaged:!!packaged,checks,original,adjusted,small,errors},null,2));console.log(`Workspace: ${checks.length} checks passed (packaged=${!!packaged})`);
}catch(e){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}finally{await app.close();}
