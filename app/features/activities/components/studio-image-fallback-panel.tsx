'use client';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Value} from '@sinclair/typebox/value';
import {StudioImageFallbackPreviewSchema,StudioImageFallbackRequestSchema,type StudioImageFallbackPreview,type StudioImageFallbackRequest,type StudioJob} from '@sthstart/contracts';
import {Button} from '@/app/components/ui/button';
import {FormField} from '@/app/components/ui/form-field';
import {ResponsiveEditOverlay} from '@/app/components/ui/responsive-edit-overlay';
import {fetchStudioImageFallbackOptions,previewStudioImageFallback} from '../studio-api';
import {useStudioJobMutations} from '../studio-mutations';

/** Image fallback replaces only the frozen preset for the failed items of one
 * batch. Every preset change needs a new server preview, and a lost confirmation
 * response reuses the exact saved payload so a second attempt is never sent. */
export function StudioImageFallbackPanel({activityId,job,beforeAction,onSelectJob}:{activityId:string;job:StudioJob;beforeAction():Promise<boolean>;onSelectJob(id:string|null):void}){
  const [open,setOpen]=useState(false),[presetId,setPresetId]=useState(''),[preview,setPreview]=useState<StudioImageFallbackPreview|null>(null),
    [error,setError]=useState(''),[busy,setBusy]=useState(false),pending=useRef<StudioImageFallbackRequest|null>(null),generation=useRef(0);
  const key=`sthstart:studio-image-fallback:${activityId}:${job.id}`,operations=useStudioJobMutations(activityId);
  const options=useQuery({queryKey:['studio-image-fallback-options',activityId,job.id,job.revision],
    queryFn:()=>fetchStudioImageFallbackOptions(activityId,job.id),enabled:open});
  const remember=(value:{open:boolean;presetId:string;preview:StudioImageFallbackPreview|null;error:string},request=pending.current)=>{
    try{sessionStorage.setItem(key,JSON.stringify({...value,pending:request}));}catch{/* Optional form state, never formal content. */}
  };
  useEffect(()=>{pending.current=null;setOpen(false);setPresetId('');setPreview(null);setError('');generation.current++;
    try{const saved=JSON.parse(sessionStorage.getItem(key)??'null');if(saved&&typeof saved.open==='boolean'&&typeof saved.presetId==='string'){
      setOpen(saved.open);setPresetId(saved.presetId);if(typeof saved.error==='string')setError(saved.error);
      if(Value.Check(StudioImageFallbackPreviewSchema,saved.preview))setPreview(saved.preview);
      if(Value.Check(StudioImageFallbackRequestSchema,saved.pending))pending.current=saved.pending;
    }}catch{/* Invalid UI recovery cannot execute or authorize a request. */}
    return()=>{generation.current++;};
  },[key]);
  const changeOpen=(value:boolean)=>{if(busy||operations.imageFallback.isPending)return;generation.current++;setOpen(value);remember({open:value,presetId,preview,error});};
  const inspect=async()=>{const run=++generation.current;setBusy(true);setError('');setPreview(null);pending.current=null;
    remember({open:true,presetId,preview:null,error:''},null);
    try{if(!await beforeAction())throw new Error('本地输入未保存，请先处理冲突。');
      const next=await previewStudioImageFallback(activityId,job.id,{presetId});if(run!==generation.current)return;
      setPreview(next);remember({open:true,presetId,preview:next,error:''});
    }catch(reason){if(run===generation.current){const message=(reason as Error).message;setError(message);remember({open:true,presetId,preview:null,error:message});}}
    finally{if(run===generation.current)setBusy(false);}
  };
  const confirm=async()=>{if(!preview)return;setError('');
    try{if(!await beforeAction())throw new Error('本地输入未保存，未执行备用绘制。');
      const input=pending.current??{presetId:preview.presetId,presetRevision:preview.presetRevision,expectedJobRevision:preview.expectedJobRevision,planHash:preview.planHash,idempotencyKey:crypto.randomUUID()};
      pending.current=input;remember({open:true,presetId,preview,error:''},input);
      const next=await operations.imageFallback.mutateAsync({jobId:job.id,input});pending.current=null;
      try{sessionStorage.removeItem(key);}catch{/* Optional local form persistence. */}setOpen(false);onSelectJob(next.id);
    }catch(reason){const message=(reason as Error).message;setError(message);remember({open:true,presetId,preview,error:message});}
  };
  if(job.kind!=='render_batch'||job.readOnly)return null;
  const used=job.input.fallback as {kind?:string;fallbackOf?:string;presetId?:string}|undefined;
  if(used)return <p role="status" className="text-xs text-muted">本批次为一次图片备用尝试 · 预设 {used.presetId??'历史未记录'}。再次失败会暂停，不继续自动切换。<button className="ml-2 text-accent" onClick={()=>onSelectJob(used.fallbackOf??null)}>查看原失败任务</button></p>;
  if(!['paused','failed','partially_succeeded','interrupted'].includes(job.status)||job.stopRequested)return null;
  return <>
    <Button size="sm" variant="outline" onClick={()=>changeOpen(true)}>选择备用图片预设</Button>
    <ResponsiveEditOverlay open={open} onOpenChange={changeOpen} title="备用图片预设"
      description="只重绘本批次明确失败的条目，仅替换图片预设；不改活动默认配置，最多一次。"
      footer={<><Button variant="outline" disabled={busy||operations.imageFallback.isPending} onClick={()=>changeOpen(false)}>取消</Button>
        {preview?<Button loading={operations.imageFallback.isPending} disabled={busy} onClick={()=>void confirm()}>{pending.current?'重试相同确认':'确认这一次备用绘制'}</Button>:
          <Button loading={busy} disabled={!presetId||!options.data?.allowed} onClick={()=>void inspect()}>预览备用绘制</Button>}</>}>
      <div className="space-y-4">
        <p className="text-sm">原批次未完成：{job.errorMessage??'尚需核对具体原因'}</p>
        <p className="text-xs text-muted">原预设：{options.data?.originalPresetId??'历史未记录'} · 原实际模型：{options.data?.originalModel??'历史未记录，不能推断'}。</p>
        {options.isPending&&<p role="status">读取已有预设…</p>}
        {options.isError&&<><p role="alert" className="text-sm text-danger-fg">{options.error.message}</p><Button variant="outline" onClick={()=>void options.refetch()}>重新读取预设</Button></>}
        {options.data&&<p role="status" className="text-sm">{options.data.reason}</p>}
        {(options.data?.allowed||pending.current)&&<FormField label="本次图片预设"><select aria-label="本次备用图片预设" className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 text-sm"
          value={presetId} disabled={busy||operations.imageFallback.isPending||Boolean(pending.current)} onChange={event=>{generation.current++;setPresetId(event.target.value);setPreview(null);setError('');pending.current=null;remember({open:true,presetId:event.target.value,preview:null,error:''},null);}}>
          <option value="">选择启用的图片预设</option>{options.data?.presets.map(preset=><option key={preset.id} value={preset.id}>{preset.name} · {preset.model??'未记录模型'}</option>)}
          {pending.current&&!options.data?.presets.some(preset=>preset.id===presetId)&&<option value={presetId}>{preview?.presetName??presetId} · 已保存的相同确认</option>}
        </select></FormField>}
        {preview&&<section aria-label="备用绘制确认" className="space-y-2 rounded-lg bg-surface-subtle p-3 text-sm">
          <h3 className="font-semibold">将使用 {preview.presetName} · {preview.model??'未记录模型'}</h3><p>{preview.scope}</p>
          <p>本次 {preview.imageTaskCount} 次图片调用 · {preview.modelRequestCount} 次文本优化 · 备用上限 1 次</p>
          <p className="text-muted">画风与细节可能变化。成功图片与原任务保持不变；新图只进入历史，不会自动替换已有画面。</p>
        </section>}
        {error&&<p role="alert" className="text-sm text-danger-fg">{error}</p>}
        <a className="text-sm text-accent" target="_blank" rel="noopener noreferrer" href="/settings/generation">管理已有图片预设</a>
      </div>
    </ResponsiveEditOverlay>
  </>;
}
