/** Actual system voices, cached Whisper inference, desktop editing, playback, restart and FFmpeg export. */
import {_electron as electron,expect,type ElectronApplication,type Page} from '@playwright/test';
import {mkdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createProject} from '../src/core/model';
import {runMediaTool,probeFile} from '../electron/media';
import type {Project} from '../src/core/types';
const out=path.resolve('.test-output/speech-electron');await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const real=JSON.parse(await readFile('.test-output/speech-real/evidence.json','utf8'));
const source=path.join(out,'synthetic-video.mp4');
await runMediaTool('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=0x183c72:s=320x180:r=30:d=8','-i',real.results[1].asset.path,'-af','adelay=1000:all=1,apad','-t','8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
const saved=path.join(out,'speech.reacut'),exported=path.join(out,'speech.mp4'),srt=path.join(out,'speech.srt');
const p=createProject('本地语音 · 中英文真实验收');p.width=320;p.height=180;await writeFile(saved,JSON.stringify(p));
const model=process.env.REACUT_SPEECH_MODEL??real.model;
const python=process.env.REACUT_SPEECH_PYTHON;assert(python,'Set REACUT_SPEECH_PYTHON to an installed MLX Python.');
const env=Object.fromEntries(Object.entries(process.env).filter((x):x is [string,string]=>x[1]!==undefined));env.REACUT_USER_DATA=path.join(out,'user-data');delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;delete env.REACUT_SPEECH_PYTHON;delete env.REACUT_SPEECH_MODEL;
let app!:ElectronApplication,page!:Page;const errors:string[]=[],checks:string[]=[],network:string[]=[],levels:number[]=[];
const bundle=process.env.REACUT_TEST_APP?path.resolve(process.env.REACUT_TEST_APP):undefined;
let native:{packaged:boolean;version:string;path:string}|undefined;
if(bundle){delete env.REACUT_FFMPEG;delete env.REACUT_FFPROBE;env.PATH=path.join(out,'empty-path');await mkdir(env.PATH);}
let launches=0;
async function launch(){
 app=await electron.launch({...(bundle?{executablePath:path.join(bundle,'Contents/MacOS/ReaCut'),args:[saved]}:{args:[path.resolve('dist-electron/main.cjs'),saved]}),env});
 native=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),path:app.getAppPath()}));if(bundle){assert(native.packaged);assert(native.path.startsWith(bundle));assert.equal(native.version,JSON.parse(await readFile('package.json','utf8')).version);}
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await app.evaluate(({dialog,BrowserWindow},files)=>{
  BrowserWindow.getAllWindows()[0].setSize(1470,900);
  (dialog as any).showOpenDialog=async(...args:any[])=>({canceled:false,filePaths:[args.at(-1).title.includes('Python')?files.python:args.at(-1).title.includes('model folder')?files.model:args.at(-1).title==='打开 ReaCut 项目'?files.saved:files.source]});
  (dialog as any).showSaveDialog=async(...args:any[])=>({canceled:false,filePath:args.at(-1).defaultPath?.endsWith('.srt')?files.srt:args.at(-1).title?.includes('导出')?files.exported:files.saved});
  (dialog as any).showMessageBox=async()=>({response:2});
 },{python,model,source,saved,exported,srt});
 const auditScript=`const Native=window.AudioContext;window.__audioAudit=[];window.AudioContext=class extends Native { createMediaElementSource(element){const node=super.createMediaElementSource(element);const connect=node.connect.bind(node);node.connect=(target,...rest)=>{if(target instanceof GainNode){const analyser=this.createAnalyser();analyser.fftSize=2048;target.connect(analyser);window.__audioAudit.push({element,analyser});}return connect(target,...rest);};return node;}};`;await page.addInitScript({content:auditScript});if(launches>0)await page.evaluate(auditScript);
 if(launches++===0){
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'文件菜单',exact:true}).click();await page.getByRole('button',{name:'打开项目',exact:false}).click();
 }
 await expect(page.locator('.project-title input')).toHaveValue(p.name,{timeout:30000});
 await page.getByRole('button',{name:'字幕',exact:true}).click();
}
async function save():Promise<Project>{const before=(await stat(saved)).mtimeMs;await page.getByRole('button',{name:'保存项目',exact:true}).click();await expect.poll(async()=>(await stat(saved)).mtimeMs).toBeGreaterThan(before);return JSON.parse(await readFile(saved,'utf8'));}
async function seek(t:number){await page.locator('.tl-scroll').evaluate((el,t)=>{el.scrollLeft=Math.max(0,t*60-400);},t).catch(()=>{});const box=(await page.locator('.tl-ruler-body').boundingBox())!;await page.mouse.click(box.x+t*60,box.y+15);}
async function open(mode:'asr'|'tts'){await page.getByRole('button',{name:mode==='asr'?'自动识别字幕':'文字转语音',exact:true}).click();const d=page.getByRole('dialog',{name:mode==='asr'?'自动识别字幕':'文字转语音',exact:true});await expect(d.getByText('正在检查本地依赖…',{exact:true})).toHaveCount(0,{timeout:30000});return d;}
async function generate(d:ReturnType<typeof page.getByRole>){await d.getByRole('button',{name:'生成并添加',exact:true}).click();await expect(d).toHaveCount(0,{timeout:120000});}
async function audible(t:number){await seek(t);await page.getByRole('button',{name:'播放',exact:true}).click();let rms=0;await expect.poll(async()=>{rms=await page.evaluate(()=>Math.max(0,...((window as any).__audioAudit??[]).filter((e:any)=>!e.element.paused).map((e:any)=>{const a=new Float32Array(e.analyser.fftSize);e.analyser.getFloatTimeDomainData(a);return Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);})));return rms;},{timeout:8000}).toBeGreaterThan(.01);levels.push(rms);await page.getByRole('button',{name:'暂停',exact:true}).click();}
try{
 await launch();let d=await open('asr');await expect(d.getByRole('button',{name:'生成并添加',exact:true})).toBeDisabled();await d.locator('summary').click();await d.getByRole('button',{name:'选择 Python…',exact:true}).click();await expect(d.getByText('正在检查本地依赖…',{exact:true})).toHaveCount(0,{timeout:30000});await d.getByRole('button',{name:'选择模型文件夹…',exact:true}).click();await expect(d.getByText('正在检查本地依赖…',{exact:true})).toHaveCount(0,{timeout:30000});await d.getByRole('button',{name:'关闭',exact:true}).click();
 const config=JSON.parse(await readFile(path.join(out,'user-data/speech-settings.json'),'utf8'));assert.equal(config.python,python);assert.equal(config.model,model);checks.push('Missing dependency disables ASR; native Python/model selection persists without a download');
 // Cancel a genuine long system-voice task before any timeline edit.
 d=await open('tts');await d.getByLabel('配音文字',{exact:true}).fill('取消语音测试。'.repeat(1000));await d.getByRole('button',{name:'生成并添加',exact:true}).click();await d.getByRole('button',{name:'取消语音任务',exact:true}).click();await expect(d.getByRole('button',{name:'关闭',exact:true})).toBeEnabled({timeout:30000});await d.getByRole('button',{name:'关闭',exact:true}).click();assert.equal((await save()).clips.length,0);checks.push('Cancelling a real TTS task leaves the project unchanged');
 let chinese='',english='',zhEnd=0;
 for(const [language,text] of [['zh','你好，欢迎使用本地视频编辑器。今天我们测试自动字幕和语音合成。'],['en','Hello, welcome to the local video editor. Today we are testing automatic subtitles and speech synthesis.']] as const){
  await seek(language==='zh'?0:8);d=await open('tts');await d.getByLabel('语音语言',{exact:true}).selectOption(language);await d.getByLabel('配音文字',{exact:true}).fill(text);await generate(d);let q=await save();const audio=q.clips.at(-1)!;if(language==='zh'){chinese=audio.id;zhEnd=audio.start+audio.duration;}else english=audio.id;
  assert(q.assets.find(a=>a.id===audio.assetId)?.path.includes('speech-media'));await audible(audio.start+.3);
  await page.locator(`[data-clip-id="${audio.id}"]`).click({position:{x:20,y:26}});d=await open('asr');await d.getByLabel('语音语言',{exact:true}).selectOption(language);await generate(d);q=await save();const captions=q.clips.filter(c=>c.text&&c.start>=audio.start&&c.start<audio.start+audio.duration);const words=captions.map(c=>c.text!.text).join('');assert(language==='zh'?/[视視][频頻].*[编編][辑輯]/.test(words):/local video editor/i.test(words));for(const c of captions)assert(c.start>=audio.start&&c.start+c.duration<=audio.start+audio.duration+.1);
  const count=q.clips.length;await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal((await save()).clips.length,count-captions.length);await page.getByRole('button',{name:'重做',exact:true}).click();await save();
 }
 checks.push('Chinese Tingting and English Samantha generate persistent WAVs, play through real Web Audio, and transcribe with source-aligned editable timestamps; undo/redo is atomic');
 const beforeModal=await save();d=await open('tts');await d.getByRole('button',{name:'关闭',exact:true}).focus();await page.keyboard.press('Backspace');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('menu-action','new'));
 await expect(d).toBeVisible();await d.getByRole('button',{name:'关闭',exact:true}).click();assert.deepEqual((await save()).clips,beforeModal.clips);checks.push('Speech dialog blocks underlying timeline shortcuts and native menu project replacement');
 // Choose a genuine local video in the UI, then recognize its full source at the playhead.
 await seek(16);d=await open('asr');await d.getByRole('button',{name:'选择本地音视频…',exact:true}).click();await d.getByLabel('语音语言',{exact:true}).selectOption('en');await generate(d);let q=await save();const video=q.clips.find(c=>q.assets.find(a=>a.id===c.assetId)?.kind==='video')!;assert(video);const videoCaptions=q.clips.filter(c=>c.text&&c.trackId===q.tracks[0].id);assert(videoCaptions.length);assert(videoCaptions[0].start>16.5,'one-second source silence should be reflected in first word timestamp');
 // Real subtitle editor changes persist and render.
 await page.locator('.subtitle-cue-content').first().click();await page.getByLabel('字幕内容',{exact:true}).fill('本地字幕已验证 · Local captions verified');await page.getByRole('button',{name:'保存此条',exact:true}).click();q=await save();
 await seek(videoCaptions[0].start+.3);await expect.poll(async()=>page.evaluate(()=>{const c=document.querySelector<HTMLCanvasElement>('.player-panel canvas')!,ctx=c.getContext('2d')!,pixels=ctx.getImageData(0,c.height*.7,c.width,Math.floor(c.height*.3)).data;let white=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180&&pixels[i+1]>180&&pixels[i+2]>180)white++;return white;})).toBeGreaterThan(20);
 await page.locator('.tl-scroll').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,'editor.png')});await page.getByRole('button',{name:'导出全部 SRT',exact:true}).click();assert((await readFile(srt,'utf8')).includes('Local captions verified'));checks.push('Native local video import, one-second silence timestamps, subtitle editing, canvas rendering and SRT export pass');
 // Retain project and dependency selection across a real process restart.
 const before=q;await app.close();await mkdir(path.join(out,'user-data/speech-media/.speech-abandoned'),{recursive:true});await writeFile(path.join(out,'user-data/speech-media/.speech-abandoned/text.txt'),'interrupted synthetic test');await launch();q=await save();assert.deepEqual(q.clips,before.clips);assert.deepEqual(q.assets.map(a=>a.path),before.assets.map(a=>a.path));await assert.rejects(stat(path.join(out,'user-data/speech-media/.speech-abandoned')));d=await open('asr');await d.locator('summary').click();await expect(d.getByText(/Python:/)).toContainText(python!);await d.getByRole('button',{name:'关闭',exact:true}).click();await audible(8.3);checks.push('Actual restart restores generated media, captions and dependency settings; abandoned temporary text/audio are cleaned');
 // Export through normal UI.
 await page.getByRole('button',{name:'导出',exact:true}).click();d=page.getByRole('dialog',{name:'导出视频',exact:true});await d.getByRole('button',{name:'开始导出',exact:true}).click();await expect(d.getByText('导出完成',{exact:true})).toBeVisible({timeout:120000});await page.screenshot({path:path.join(out,'export.png')});
 const probe=await probeFile(exported);assert(probe.streams.some(s=>s.codec_type==='audio'));assert.equal(Number(probe.format.duration),24);
 const frame=await runMediaTool('ffmpeg',['-v','error','-ss',String(videoCaptions[0].start+.3),'-i',exported,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert(frame[2]>80&&frame[0]<40,'video background should decode blue');let bright=0;for(let i=320*126*3;i<frame.length;i+=3)if(frame[i]>180&&frame[i+1]>180&&frame[i+2]>180)bright++;assert(bright>20);
 const pcm=await runMediaTool('ffmpeg',['-v','error','-ss','8','-i',exported,'-t','3','-ac','1','-ar','16000','-f','f32le','pipe:1']);let energy=0;for(let i=0;i<pcm.length;i+=4)energy+=pcm.readFloatLE(i)**2;const exportRMS=Math.sqrt(energy/(pcm.length/4));assert(exportRMS>.01);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);checks.push('UI export decodes to H.264/AAC video with visible captions and non-silent TTS audio; no renderer errors or HTTP requests');
 await writeFile(path.join(out,'evidence.json'),JSON.stringify({at:new Date().toISOString(),sourceBuild:!bundle,native,checks,playbackRMS:levels,exportRMS,subtitlePixels:bright,duration:Number(probe.format.duration),model:real.model,modelBytes:real.modelBytes,videoCaptionTimes:videoCaptions.map(c=>({start:c.start,duration:c.duration})),errors,network},null,2));console.log(checks);
}catch(e){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.log(await page?.locator('body').innerText().catch(()=>''));throw e;}finally{await app?.close().catch(()=>{});}
