import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {cachedSpeechModels,generateSpeech,cancelSpeech,cleanSpeechTemporaries,runSpeechProcess} from '../electron/speech';
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
 it('offers complete known cache entries and skips invalid configurations and missing weights', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reacut-speech-cache-'));
  const config = Object.fromEntries(['n_mels', 'n_audio_ctx', 'n_audio_state', 'n_audio_head', 'n_audio_layer',
    'n_vocab', 'n_text_ctx', 'n_text_state', 'n_text_head', 'n_text_layer'].map(key => [key, 1]));
  try {
   for (const [model, revision, metadata, weight] of [
    ['small', '1', config, true], ['small', '2', {}, true], ['base', '3', config, false], ['unrelated', '4', config, true],
   ] as const) {
    const folder = path.join(dir, `models--mlx-community--whisper-${model}-mlx`, 'snapshots', revision.repeat(40));
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'config.json'), JSON.stringify(metadata));
    if (weight) await writeFile(path.join(folder, 'weights.npz'), 'fixture metadata only');
   }
   expect((await cachedSpeechModels(dir)).map(model => model.id)).toEqual(['small:' + '1'.repeat(40)]);
  } finally { await rm(dir, { recursive: true, force: true }); }
 });
});
