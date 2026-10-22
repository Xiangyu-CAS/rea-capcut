import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { importAssets, probeFile, runMediaTool } from './media';
import { speechSource, validateCues, type SpeechInfo, type SpeechProgress, type SpeechRequest, type SpeechResult, type SpeechSettings, type SpeechVoice } from '../src/core/speech';
import type { Project } from '../src/core/types';

// Always pass a local model directory and decoded PCM; neither the model loader nor FFmpeg can fetch URLs.
export const whisperWorker = String.raw`
import sys, os, json, wave, socket
os.environ['HF_HUB_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
def no_network(*args, **kwargs): raise RuntimeError('Network is disabled in local speech recognition')
socket.socket.connect=no_network
socket.create_connection=no_network
import mlx_whisper, numpy as np, importlib
if sys.argv[1]=='check':
    print(json.dumps({'ready':True}),flush=True)
    sys.exit(0)
model, audio, language = sys.argv[1:4]
if not os.path.isdir(model): raise RuntimeError('Local model directory is missing')
class Progress:
    def __init__(self,*args,**kwargs): self.total=kwargs.get('total',1); self.n=0
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def update(self,n):
        self.n+=n
        print(json.dumps({'progress':min(1,self.n/self.total)}),flush=True)
importlib.import_module('mlx_whisper.transcribe').tqdm.tqdm=Progress
with wave.open(audio,'rb') as f:
    assert f.getframerate()==16000 and f.getnchannels()==1 and f.getsampwidth()==2
    pcm=np.frombuffer(f.readframes(f.getnframes()),dtype=np.int16).astype(np.float32)/32768.0
# Keep a short safety margin, but do not let a model timestamp a long digital-silence prefix at zero.
active=np.flatnonzero(np.abs(pcm)>0.0001)
if not len(active):
    print(json.dumps({'cues':[]}),flush=True)
    sys.exit(0)
offset=max(0, int(active[0])-1280) if active[0]>3200 else 0
r=mlx_whisper.transcribe(pcm[offset:],path_or_hf_repo=model,language=None if language=='auto' else language,task='transcribe',verbose=False,temperature=0,condition_on_previous_text=False,word_timestamps=True)
cues=[]
def units(text): return sum(2 if ord(c)>0x2e80 else 1 for c in text)
def emit(words):
    if words and words[-1]['end']>words[0]['start']:
        cues.append({'start':words[0]['start']+offset/16000,'end':words[-1]['end']+offset/16000,'text':''.join(w['word'] for w in words).strip()})
for s in r['segments']:
    words=s.get('words',[])
    if not words:
        if s['end']>s['start']: cues.append({'start':s['start']+offset/16000,'end':s['end']+offset/16000,'text':s['text']})
        continue
    group=[]
    for w in words:
        if group and (units(''.join(x['word'] for x in group)+w['word'])>42 or w['end']-group[0]['start']>5):
            emit(group);group=[]
        group.append(w)
        if w['word'].strip().endswith(('.', '?', '!', '。', '？', '！')): emit(group);group=[]
    emit(group)
print(json.dumps({'cues':cues},ensure_ascii=False),flush=True)
`;
/** Only abandoned per-job temporary directories are removed at app startup. Completed WAVs are retained. */
export async function cleanSpeechTemporaries(directory:string) {
  try { for (const entry of await readdir(directory,{withFileTypes:true})) if(entry.isDirectory()&&entry.name.startsWith('.speech-')) await rm(path.join(directory,entry.name),{recursive:true,force:true}); }
  catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
}
const jobs = new Map<string,{controller:AbortController;done:Promise<SpeechResult>}>();
export function cancelSpeech(id:string) { jobs.get(id)?.controller.abort(); }
export async function cancelAllSpeech() { for(const j of jobs.values()) j.controller.abort(); await Promise.allSettled([...jobs.values()].map(j=>j.done)); }
export async function runSpeechProcess(file:string,args:string[],signal?:AbortSignal,onLine?:(line:string)=>void,timeout=120000):Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{shell:false,env:{...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
    let output='', pending='', diagnostic='', failure:Error|undefined;
    const abort=()=>{failure=new Error('Speech task cancelled.');child.kill('SIGKILL');};
    signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted) abort();
    const timer=setTimeout(()=>{failure=new Error('Local speech process timed out.');child.kill('SIGKILL');},timeout);
    child.stdout.on('data',data=>{ output+=data; pending+=data; if(output.length>8*1024*1024){failure=new Error('Speech output exceeds limit.');child.kill('SIGKILL');return;}const lines=pending.split('\n');pending=lines.pop()??'';for(const line of lines) onLine?.(line); });
    child.stderr.on('data',data=>{diagnostic=(diagnostic+data).slice(-4000);});
    child.on('error',e=>{failure=e;});
    child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure||code!==0) reject(failure??new Error(`Local speech failed: ${diagnostic || code}`));else resolve(output);});
  });
}
export async function speechVoices(signal?:AbortSignal):Promise<SpeechVoice[]> {
  if(process.platform!=='darwin') return [];
  const result=await runSpeechProcess('/usr/bin/say',['-v','?'],signal,undefined,15000);
  return result.split('\n').flatMap(line=>{const m=line.match(/^(.+?)\s+([a-z]{2,3}_[A-Z]{2})\s+#/);return m?[{name:m[1].trim(),locale:m[2]}]:[];});
}
export async function localSpeechSettings(settings:SpeechSettings):Promise<SpeechSettings> {
  const result={...settings};
  result.python=process.env.REACUT_SPEECH_PYTHON || result.python;
  result.model=process.env.REACUT_SPEECH_MODEL || result.model;
  if(!result.model) {
    const snapshots=path.join(os.homedir(),'.cache/huggingface/hub/models--mlx-community--whisper-small-mlx/snapshots');
    try {const entries=await readdir(snapshots);for(const entry of entries.sort()){try {const folder=path.join(snapshots,entry);await modelBytes(folder);result.model=folder;break;} catch { /* Skip incomplete cached snapshots. */ }}} catch { /* No download. */ }
  }
  return result;
}
async function modelBytes(folder:string):Promise<number> {
  if(!path.isAbsolute(folder)) throw new Error('Choose a local MLX model folder (config.json and weights.npz / weights.safetensors).');
  await access(path.join(folder,'config.json'));
  for(const name of ['weights.safetensors','weights.npz']) {try {const s=await stat(path.join(folder,name));if(s.isFile()&&s.size>0) return s.size;}catch{/* Next format. */}}
  throw new Error('Local model weights are missing; no files will be downloaded.');
}
export async function speechInfo(settings:SpeechSettings):Promise<SpeechInfo> {
  const config=await localSpeechSettings(settings), voices=await speechVoices().catch(()=>[]);
  try {
    if(process.platform!=='darwin'||process.arch!=='arm64') throw new Error('MLX ASR requires Apple Silicon macOS.');
    if(!config.python || !path.isAbsolute(config.python)) throw new Error('Choose an existing Python executable with mlx-whisper installed. No automatic installation.');
    if(!config.model) throw new Error('Select an already downloaded MLX Whisper model folder.');
    const bytes=await modelBytes(config.model);
    await runSpeechProcess(config.python,['-c',whisperWorker,'check'],undefined,undefined,30000);
    return {...config,ready:true,modelBytes:bytes,voices};
  }catch(e){return {...config,ready:false,error:(e as Error).message,voices};}
}
export function generateSpeech(jobId:string,p:Project,request:SpeechRequest,settings:SpeechSettings,directory:string,progress:(p:SpeechProgress)=>void):Promise<SpeechResult> {
  if(typeof jobId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(jobId)) throw new Error('Invalid speech job.');
  if(jobs.size) throw new Error('A speech task is already running.');
  if(!request || !['asr','tts'].includes(request.mode)) throw new Error('Invalid speech request.');
  const controller=new AbortController();
  const done=Promise.resolve().then(generate).finally(()=>jobs.delete(jobId));jobs.set(jobId,{controller,done});return done;
  async function generate():Promise<SpeechResult>{
    const {signal}=controller;let temp:string|undefined;
    const report=(stage:SpeechProgress['stage'],value?:number)=>{signal.throwIfAborted();progress({jobId,stage,progress:value});};
    try {
      report('prepare',0);await mkdir(directory,{recursive:true});temp=await mkdtemp(path.join(directory,'.speech-'));
      const wav=path.join(temp,'speech.wav');
      if(request.mode==='asr'){
        if(!['auto','zh','en'].includes(request.language)||typeof request.source!=='string') throw new Error('Invalid recognition language/source.');
        const source=speechSource(p,request.source), config=await localSpeechSettings(settings);
        if(process.platform!=='darwin'||process.arch!=='arm64'||!config.python||!path.isAbsolute(config.python)||!config.model) throw new Error('Configure local MLX Whisper and Python first.');
        await modelBytes(config.model);
        const probe=await probeFile(source.asset.path,signal);if(!probe.streams.some(s=>s.codec_type==='audio')) throw new Error('Source has no audio stream.');
        const before=await stat(source.asset.path);
        await runMediaTool('ffmpeg',['-v','error','-nostdin','-y','-ss',String(source.sourceIn),'-i',source.asset.path,'-t',String(source.duration),'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav],3600000,1024*1024,{signal});
        report('recognize',0);let cues:unknown;
        await runSpeechProcess(config.python,['-c',whisperWorker,config.model,wav,request.language],signal,line=>{
          try {const event=JSON.parse(line);if(Number.isFinite(event.progress)) report('recognize',Math.max(0,Math.min(1,event.progress)));if(event.cues) cues=event.cues;}catch{ /* Non-protocol runtime output. */ }
        },3600000);
        signal.throwIfAborted();const after=await stat(source.asset.path);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs) throw new Error('Source changed during recognition.');
        const validated=validateCues(cues,source.duration);if(!validated.length) throw new Error('No speech detected.');
        report('complete',1);return {mode:'asr',cues:validated};
      }
      if(process.platform!=='darwin') throw new Error('Local system TTS currently requires macOS.');
      if(typeof request.text!=='string'||!request.text.trim()||request.text.length>10000||!Number.isInteger(request.rate)||request.rate<80||request.rate>400) throw new Error('Enter 1–10000 characters and a rate of 80–400 words/minute.');
      if(!(await speechVoices(signal)).some(v=>v.name===request.voice)) throw new Error('Selected system voice is unavailable.');
      const input=path.join(temp,'text.txt'),aiff=path.join(temp,'speech.aiff');await writeFile(input,request.text,'utf8');
      report('synthesize');await runSpeechProcess('/usr/bin/say',['-v',request.voice,'-r',String(request.rate),'-f',input,'-o',aiff],signal,undefined,600000);
      await runMediaTool('ffmpeg',['-v','error','-nostdin','-y','-i',aiff,'-ar','48000','-ac','1','-c:a','pcm_s16le',wav],600000,1024*1024,{signal});
      report('import',.9);
      const [asset]=await importAssets([wav],path.join(directory,'thumbnails'),signal);signal.throwIfAborted();
      const destination=path.join(directory,randomUUID()+'.wav');await rename(wav,destination);
      asset.path=destination;asset.url=`reacut-media://asset?path=${encodeURIComponent(destination)}`;asset.name=request.text.trim().slice(0,40);
      // Audio WAV has no preview proxy; the persistent source is the playback asset.
      report('complete',1);return {mode:'tts',asset};
    }finally {if(temp) await rm(temp,{recursive:true,force:true});}
  }
}
