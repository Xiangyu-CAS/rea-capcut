/** Source media preview behavior with generated media and isolated browser state. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { generateFixtures } from "../scripts/generate-fixtures";
const output = path.resolve(".test-output/source-preview");
await mkdir(output, { recursive: true });
const fixtures = await generateFixtures(path.join(output, "fixtures"));
const fileURL = (file: string) => `/@fs${file}`;
const assets = [
  { id: "video", name: "合成红色视频.mp4", path: fixtures.video, url: fileURL(fixtures.video), kind: "video", duration: 4, fps: 10, width: 160, height: 90, hasAudio: true },
  { id: "audio", name: "合成音频.wav", path: fixtures.audio, url: fileURL(fixtures.audio), kind: "audio", duration: 4, fps: 0, width: 0, height: 0, hasAudio: true, waveform: [.1, .5, .9, .4] },
  { id: "image", name: "合成蓝图.png", path: fixtures.image, url: fileURL(fixtures.image), kind: "image", duration: 5, fps: 0, width: 80, height: 40, hasAudio: false },
];
const entry = `
import React, {useState} from 'react';import {createRoot} from 'react-dom/client';
import SourcePreview from '/src/components/SourcePreview.tsx';import MediaLibrary from '/src/components/MediaLibrary.tsx';import {createProject} from '/src/core/model.ts';import '/src/styles.css';
const assets=${JSON.stringify(assets)};const p=createProject('源预览验收');p.assets=assets;
function Harness(){const [asset,setAsset]=useState(assets[0]);const [added,setAdded]=useState(null);const [whole,setWhole]=useState('');window.qa={select:setAsset,assets};return <><main style={{display:'grid',gridTemplateColumns:'360px minmax(0,1fr)',height:520,gap:7,padding:8}}><MediaLibrary project={p} onImport={()=>{}} onRemoveAsset={()=>{}} onAddAsset={setWhole} onPreviewAsset={id=>setAsset(assets.find(a=>a.id===id))}/>{asset?<SourcePreview asset={asset} fps={30} onClose={()=>setAsset(null)} onAddRange={(sourceIn,duration)=>setAdded({id:asset.id,sourceIn,duration})}/>:<div data-testid="closed">已返回</div>}</main><pre data-testid="range">{JSON.stringify(added)}</pre><div data-testid="whole">{whole}</div><button id="outside">外部焦点</button></>};createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);
`;
const server = await createServer({configFile:false,plugins:[react(),{
  name:"source-preview-test",
  resolveId(id){if(id==="virtual:source-test")return "\0virtual:source-test";},
  load(id){if(id==="\0virtual:source-test")return entry;},
  async transform(code,id){if(id==="\0virtual:source-test"){const {transform}=await import('esbuild');return transform(code,{loader:'jsx',jsx:'automatic'});}},
  configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=="/source-test")return next();void s.transformIndexHtml('/source-test','<html><head></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:source-test"></script></body></html>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html);});});}
}],server:{host:'127.0.0.1',port:5194,strictPort:true}});
await server.listen();
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
const page=await browser.newPage({viewport:{width:1024,height:720}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const checks:string[]=[];
try {
 await page.goto('http://127.0.0.1:5194/source-test');
 await expect(page.getByRole('button',{name:'播放素材',exact:true})).toBeEnabled();
 await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
 const pixel=await page.locator('video').evaluate(v=>{const c=document.createElement('canvas');c.width=2;c.height=2;const x=c.getContext('2d')!;x.drawImage(v as HTMLVideoElement,0,0,2,2);return Array.from(x.getImageData(0,0,1,1).data);});
 assert(pixel[0]>200&&pixel[1]<30&&pixel[2]<30,'Decoded synthetic red video');
 checks.push('real video decode in React StrictMode');
 await page.getByRole('button',{name:'播放素材',exact:true}).click();
 await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(.2);
 await page.getByRole('button',{name:'暂停素材',exact:true}).click();
 const paused=await page.locator('video').evaluate(v=>(v as HTMLVideoElement).paused);assert(paused);
 await page.getByLabel('源素材入点',{exact:true}).fill('1');
 await page.getByLabel('源素材出点',{exact:true}).fill('2');
 await page.getByRole('button',{name:'播放素材',exact:true}).click();
 await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).paused)).toBe(true);
 const stop=await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime);assert(Math.abs(stop-2)<.04);
 checks.push('play, pause, selected-range restart and stop at out point');
 await page.getByLabel('素材预览进度').fill('1.4');
 await page.getByRole('region',{name:'素材源预览'}).focus();await page.keyboard.press('i');
 await expect(page.getByLabel('源素材入点',{exact:true})).toHaveValue('1.4');
 await page.getByLabel('素材预览进度').fill('2.4');await page.getByRole('region',{name:'素材源预览'}).focus();await page.keyboard.press('o');
 await expect(page.getByLabel('源素材出点',{exact:true})).toHaveValue('2.4');
 await page.locator('#outside').focus();await page.keyboard.press('i');await expect(page.getByLabel('源素材入点',{exact:true})).toHaveValue('1.4');
 await page.getByRole('button',{name:'添加选中片段',exact:true}).click();
 assert.deepEqual(JSON.parse((await page.getByTestId('range').textContent())!),{id:'video',sourceIn:1.4,duration:1});
 checks.push('I/O marks only with source focus; selected range callback uses source seconds');
 await page.getByLabel('源素材出点',{exact:true}).fill('0');
 const inValue=Number(await page.getByLabel('源素材入点',{exact:true}).inputValue()),outValue=Number(await page.getByLabel('源素材出点',{exact:true}).inputValue());assert(outValue-inValue>=1/30-1e-6);
 await page.getByRole('button',{name:'重置源素材范围'}).click();await expect(page.getByLabel('源素材入点',{exact:true})).toHaveValue('0');await expect(page.getByLabel('源素材出点',{exact:true})).toHaveValue('4');
 checks.push('minimum one project frame and reset range');
 await page.getByRole('button',{name:'播放素材',exact:true}).click();
 await page.evaluate('window.oldMedia=document.querySelector("video")');
 await page.locator('[data-asset-id="audio"]').click();
 await expect(page.locator('audio')).toHaveCount(1);assert(await page.evaluate('window.oldMedia.paused && !window.oldMedia.getAttribute("src")'));
 await expect(page.getByRole('button',{name:'播放素材',exact:true})).toBeEnabled();await page.getByRole('button',{name:'播放素材',exact:true}).click();await expect.poll(()=>page.locator('audio').evaluate(v=>(v as HTMLAudioElement).currentTime)).toBeGreaterThan(.15);
 await page.getByRole('button',{name:'暂停素材',exact:true}).click();
 await page.getByLabel('源素材入点',{exact:true}).fill('.5');await page.getByLabel('源素材出点',{exact:true}).fill('1.5');await page.getByRole('button',{name:'添加选中片段'}).click();assert.deepEqual(JSON.parse((await page.getByTestId('range').textContent())!),{id:'audio',sourceIn:.5,duration:1});
 checks.push('single-click audio source preview, true audio playback, video teardown and audio range');
 await page.locator('[data-asset-id="image"]').click();await expect(page.getByRole('button',{name:'添加图片',exact:true})).toBeEnabled();await page.getByRole('button',{name:'添加图片',exact:true}).click();assert.deepEqual(JSON.parse((await page.getByTestId('range').textContent())!),{id:'image',sourceIn:0,duration:5});
 await page.locator('[data-asset-id="image"]').dblclick();await expect(page.getByTestId('whole')).toHaveText('image');
 checks.push('image load/add and double-click still adds entire asset');
 await page.evaluate('window.qa.select({...window.qa.assets[0], id:"missing", missing:true})');await expect(page.getByRole('alert')).toContainText('素材文件丢失');await expect(page.getByRole('button',{name:'添加选中片段'})).toBeDisabled();
 await page.evaluate('window.qa.select({...window.qa.assets[0], id:"bad", url:window.qa.assets[2].url})');await expect(page.getByRole('alert')).toContainText('无法解码');await expect(page.getByRole('button',{name:'添加选中片段'})).toBeDisabled();
 checks.push('missing and undecodable media have explicit errors and cannot be added');
 await page.evaluate('window.qa.select(window.qa.assets[0])');await expect(page.getByRole('button',{name:'播放素材',exact:true})).toBeEnabled();await page.getByRole('button',{name:'播放素材',exact:true}).click();await page.evaluate('window.oldMedia=document.querySelector("video")');await page.getByRole('button',{name:'返回时间线播放器'}).click();await expect(page.getByTestId('closed')).toBeVisible();assert(await page.evaluate('window.oldMedia.paused && !window.oldMedia.getAttribute("src")'));
 checks.push('closing unmounts and releases a playing source');
 await page.locator('[data-asset-id="video"]').click();await expect(page.getByRole('button',{name:'播放素材',exact:true})).toBeEnabled();
 await page.getByLabel('源素材入点',{exact:true}).fill('1');await page.getByLabel('源素材出点',{exact:true}).fill('3');
 await page.screenshot({path:path.join(output,'source-preview.png')});
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'evidence.json'),JSON.stringify({passedAt:new Date().toISOString(),checks,errors,pixel},null,2));console.log(JSON.stringify({checks,errors}));
}finally {await browser.close();await server.close();}
