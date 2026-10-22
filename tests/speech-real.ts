/** Opt-in: uses already installed local MLX, cached weights and macOS voices. No downloads. */
import {mkdir,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateSpeech,speechInfo,cancelSpeech} from '../electron/speech';
import {createProject} from '../src/core/model';
import {runMediaTool} from '../electron/media';
const out=path.resolve('.test-output/speech-real');await mkdir(out,{recursive:true});
const info=await speechInfo({});assert(info.ready,info.error);console.log(JSON.stringify(info));
const p=createProject(),results:unknown[]=[];
for(const [language,voice,text] of [['zh','Tingting','你好，欢迎使用本地视频编辑器。今天我们测试自动字幕和语音合成。'],['en','Samantha','Hello, welcome to the local video editor. Today we are testing automatic subtitles and speech synthesis.']] as const){
 const t0=Date.now();const tts=await generateSpeech(randomUUID(),p,{mode:'tts',text,voice,rate:170},{},out,()=>{});assert(tts.mode==='tts');
 const pcm=await runMediaTool('ffmpeg',['-v','error','-i',tts.asset.path,'-ac','1','-ar','16000','-f','f32le','pipe:1']);let power=0;for(let i=0;i<pcm.length;i+=4)power+=pcm.readFloatLE(i)**2;const rms=Math.sqrt(power/(pcm.length/4));assert(rms>.01);p.assets.push(tts.asset);
 const asr=await generateSpeech(randomUUID(),p,{mode:'asr',source:`asset:${tts.asset.id}`,language},{},out,e=>console.log(language,e));assert(asr.mode==='asr');const recognized=asr.cues.map(c=>c.text).join('');console.log('recognized',recognized,asr.cues);assert(language==='en'?/local video editor/i.test(recognized):/本地.*[视視][频頻].*[编編][辑輯]/.test(recognized));
 results.push({language,text,recognized,cues:asr.cues,duration:tts.asset.duration,rms,elapsedMs:Date.now()-t0,asset:{id:tts.asset.id,path:tts.asset.path,duration:tts.asset.duration}});
}
const job=randomUUID();const task=generateSpeech(job,p,{mode:'asr',source:`asset:${p.assets[0].id}`,language:'zh'},{},out,e=>{if(e.stage==='recognize'&&e.progress===0)setTimeout(()=>cancelSpeech(job),200);});await assert.rejects(task);assert(!(await readdir(out)).some(f=>f.startsWith('.speech-')));
const silence=path.join(out,'silence.wav');await runMediaTool('ffmpeg',['-v','error','-y','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','2',silence]);
const silent={...p.assets[0],id:'silent-test',path:silence,duration:2};p.assets.push(silent);
await assert.rejects(generateSpeech(randomUUID(),p,{mode:'asr',source:'asset:silent-test',language:'auto'},{},out,()=>{}),/No speech/);
await writeFile(path.join(out,'evidence.json'),JSON.stringify({at:new Date().toISOString(),model:info.model,modelBytes:info.modelBytes,results,cancelled:true,silenceRejected:true},null,2));console.log('REAL SPEECH PASSED');
