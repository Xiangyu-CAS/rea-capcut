import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {generateSpeech,cancelSpeech,cleanSpeechTemporaries,runSpeechProcess} from '../electron/speech';
import {createProject} from '../src/core/model';
describe('speech worker boundaries',()=>{
 it('rejects malformed requests and serializes/cancels jobs before work',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'reacut-speech-test-'));
  try{const id=randomUUID(),p=createProject();const promise=generateSpeech(id,p,{mode:'tts',text:'hello',voice:'unknown',rate:180},{},dir,()=>{});cancelSpeech(id);
   expect(()=>generateSpeech(randomUUID(),p,{mode:'tts',text:'hello',voice:'unknown',rate:180},{},dir,()=>{})).toThrow(/already/);
   await expect(promise).rejects.toThrow();expect(await readdir(dir)).toEqual([]);
   await expect(generateSpeech(randomUUID(),p,{mode:'asr',source:'asset:absent',language:'en'},{},dir,()=>{})).rejects.toThrow(/source/);
   expect(await readdir(dir)).toEqual([]);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('cleans only interrupted temporary directories, retaining completed assets',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'reacut-speech-test-'));
  try{await mkdir(path.join(dir,'.speech-abandoned'));await writeFile(path.join(dir,'.speech-abandoned/text.txt'),'synthetic');await writeFile(path.join(dir,'complete.wav'),'fixture');await cleanSpeechTemporaries(dir);expect(await readdir(dir)).toEqual(['complete.wav']);}finally{await rm(dir,{recursive:true,force:true});}
 });
 it('terminates an actual child process on cancellation and permits the next operation',async()=>{
  const controller=new AbortController();const task=runSpeechProcess(process.execPath,['-e','setInterval(()=>{},1000)'],controller.signal);controller.abort();await expect(task).rejects.toThrow(/cancelled/);
  expect(await runSpeechProcess(process.execPath,['-e','process.stdout.write("ok")'])).toBe('ok');
 });
 it('bounds process runtime and surfaces a missing executable',async()=>{
  await expect(runSpeechProcess(process.execPath,['-e','setInterval(()=>{},1000)'],undefined,undefined,30)).rejects.toThrow(/timed out/);
  await expect(runSpeechProcess(path.join(os.tmpdir(),'reacut-nonexistent-executable'),[])).rejects.toThrow();
 });
});
