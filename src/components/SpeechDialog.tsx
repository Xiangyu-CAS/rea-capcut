import { localizeMessage } from "../i18n/messages";
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../editor/store';
import { applySpeech, speechSource, type SpeechInfo, type SpeechLanguage, type SpeechProgress, type SpeechRequest } from '../core/speech';
import { useTranslation } from '../i18n/useTranslation';

export default function SpeechDialog({mode,onClose}:{mode:'asr'|'tts';onClose:()=>void}) {
  const {t,language:uiLanguage}=useTranslation(),project=useEditorStore(s=>s.project);
  const [source,setSource]=useState(()=>{
    const s=useEditorStore.getState(),clip=s.project.clips.find(c=>c.id===s.selectedIds[0]&&s.project.assets.some(a=>a.id===c.assetId&&a.hasAudio));
    return clip ? `clip:${clip.id}` : `asset:${s.project.assets.find(a=>a.hasAudio)?.id??''}`;
  });
  const [info,setInfo]=useState<SpeechInfo|null>(null),[language,setLanguage]=useState<SpeechLanguage>(mode==='tts'?(uiLanguage==='zh-CN'?'zh':'en'):'auto');
  const [voice,setVoice]=useState(''),[text,setText]=useState(''),[rate,setRate]=useState(180);
  const [busy,setBusy]=useState(false),[checking,setChecking]=useState(true),[error,setError]=useState(''),[progress,setProgress]=useState<SpeechProgress|null>(null);
  const running=useRef<string|null>(null),alive=useRef(true),cancelled=useRef(false);
  const fail=(e:unknown)=>{if(alive.current) setError(String(e).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/,''));};
  useEffect(()=>{
    alive.current=true;
    void window.editorAPI?.getSpeechInfo().then(value=>{if(alive.current) setInfo(value);}).catch(fail).finally(()=>{if(alive.current)setChecking(false);});
    const off=window.editorAPI?.onSpeechProgress(e=>{if(e.jobId===running.current)setProgress(e);});
    return ()=>{alive.current=false;off?.();if(running.current)void window.editorAPI?.cancelSpeech(running.current);};
  },[]);
  const voices=info?.voices.filter(v=>v.locale.startsWith(language==='zh'?'zh_':'en_'))??[];
  useEffect(()=>{setVoice(voices.find(v=>v.name===(language==='zh'?'Tingting':'Samantha'))?.name??voices[0]?.name??'');},[info,language]);
  const choose=async(kind:'python'|'model')=>{setChecking(true);setError('');try{setInfo(await window.editorAPI!.chooseSpeechDependency(kind));}catch(e){fail(e);}finally{setChecking(false);}};
  const importMedia=async()=>{
    setChecking(true);setError('');const before=useEditorStore.getState().project;
    try{const assets=await window.editorAPI!.importMedia();if(useEditorStore.getState().project!==before)throw new Error(t('speech.stale'));useEditorStore.getState().addAssets(assets);const first=assets.find(a=>a.hasAudio);if(first)setSource(`asset:${first.id}`);}catch(e){fail(e);}finally{setChecking(false);}
  };
  let sourceError='';if(mode==='asr'){try{speechSource(project,source);}catch(e){sourceError=(e as Error).message;}}
  const start=async()=>{
    if(!window.editorAPI||running.current)return;
    const store=useEditorStore.getState(),snapshot=store.project,time=store.playhead;
    const request:SpeechRequest=mode==='asr'?{mode,source,language}:{mode,text,voice,rate};
    const jobId=crypto.randomUUID();running.current=jobId;cancelled.current=false;setBusy(true);setError('');setProgress(null);
    try{
      const result=await window.editorAPI.generateSpeech(jobId,snapshot,request);
      if(!alive.current||cancelled.current)return;
      const latest=useEditorStore.getState();if(latest.project!==snapshot)throw new Error(t('speech.stale'));
      const edited=applySpeech(snapshot,request,result,time,{captions:t('speech.captions'),voice:t('speech.voiceTrack')});
      latest.commit(edited.project);latest.select(edited.selected);onClose();
    }catch(e){fail(e);}finally{running.current=null;if(alive.current)setBusy(false);}
  };
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={t(`speech.${mode}`)}>
    <header><h2>{t(`speech.${mode}`)}</h2></header>
    <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12,maxHeight:'70vh',overflow:'auto'}}>
      <p>{t('speech.offline')}</p>
      {mode==='asr'?<>
        <label>{t('speech.source')}<select aria-label={t('speech.source')} disabled={busy||checking} value={source} onChange={e=>setSource(e.target.value)}>
          <option value="">{t('speech.selectSource')}</option>
          <optgroup label={t('speech.timeline')}>{project.clips.filter(c=>project.assets.some(a=>a.id===c.assetId&&a.hasAudio)).map(c=><option key={c.id} value={`clip:${c.id}`}>{c.name} · {c.start.toFixed(2)}s</option>)}</optgroup>
          <optgroup label={t('speech.assets')}>{project.assets.filter(a=>a.hasAudio).map(a=><option key={a.id} value={`asset:${a.id}`}>{a.name}</option>)}</optgroup>
        </select></label>
        <button disabled={busy||checking} onClick={()=>void importMedia()}>{t('speech.import')}</button>
        <p className="muted small">{t('speech.alignment')}</p>
        <details><summary>{t('speech.dependencies')}</summary>
          <p className="small" style={{overflowWrap:'anywhere'}}>Python: {info?.python??'—'}<br/>MLX Whisper: {info?.model??'—'} {info?.modelBytes?`(${(info.modelBytes/1024/1024).toFixed(1)} MiB)`:''}</p>
          <button disabled={busy||checking} onClick={()=>void choose('python')}>{t('speech.python')}</button>{' '}
          <button disabled={busy||checking} onClick={()=>void choose('model')}>{t('speech.model')}</button>
          <p>{t('speech.setup')}</p>
        </details>
        {info&&!info.ready&&<p role="alert" className="inline-warning">{localizeMessage(info.error ?? "")}</p>}
      </>:<>
        <label>{t('speech.text')}<textarea aria-label={t('speech.text')} disabled={busy} maxLength={10000} rows={4} value={text} onChange={e=>setText(e.target.value)} style={{width:'100%'}}/></label>
      </>}
      <label>{t('speech.language')} <select aria-label={t('speech.language')} disabled={busy} value={language} onChange={e=>setLanguage(e.target.value as SpeechLanguage)}>
        {mode==='asr'&&<option value="auto">{t('speech.auto')}</option>}<option value="zh">中文</option><option value="en">English</option>
      </select></label>
      {mode==='tts'&&<>
        <label>{t('speech.voice')} <select aria-label={t('speech.voice')} value={voice} disabled={busy} onChange={e=>setVoice(e.target.value)}>{voices.map(v=><option key={v.name} value={v.name}>{v.name} ({v.locale})</option>)}</select></label>
        <label>{t('speech.rate')} <input aria-label={t('speech.rate')} disabled={busy} type="number" min={80} max={400} value={rate} onChange={e=>setRate(Number(e.target.value))}/></label>
        {info&&!voices.length&&<p role="alert">{t('speech.noVoice')}</p>}
      </>}
      <p className="muted small">{t('speech.storage')}</p>
      {checking&&<p role="status">{t('speech.checking')}</p>}
      {progress&&<div role="status"><p>{t(`speech.stage.${progress.stage}`)}</p><progress max={1} value={progress.progress}/>{progress.progress!==undefined&&<span> {Math.round(progress.progress*100)}%</span>}</div>}
      {(error||sourceError)&&<p role="alert" className="inline-warning">{localizeMessage(error||sourceError)}</p>}
    </div>
    <footer>{busy?<button onClick={()=>{cancelled.current=true;if(running.current)void window.editorAPI?.cancelSpeech(running.current).catch(fail);}}>{t('speech.cancel')}</button>:<>
      <button onClick={onClose}>{t('dialog.closeButton')}</button>
      <button className="primary" disabled={checking||(mode==='asr'?(!info?.ready||!!sourceError):(!voice||!text.trim()||rate<80||rate>400))} onClick={()=>void start()}>{t('speech.generate')}</button>
    </>}</footer>
  </section></div>;
}
