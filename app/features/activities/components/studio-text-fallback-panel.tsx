'use client';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Value} from '@sinclair/typebox/value';
import {StudioTextFallbackPreviewSchema,StudioTextFallbackRequestSchema,type StudioTextFallbackPreview,type StudioTextFallbackRequest,type StudioJob} from '@sthstart/contracts';
import {Button} from '@/app/components/ui/button';
import {FormField} from '@/app/components/ui/form-field';
import {ResponsiveEditOverlay} from '@/app/components/ui/responsive-edit-overlay';
import {fetchStudioTextFallbackOptions,previewStudioTextFallback} from '../studio-api';
import {useStudioJobMutations} from '../studio-mutations';

/** Local form recovery never dispatches. Every changed model needs a new server
 * preview; a lost confirmation response reuses its exact saved payload/key. */
export function StudioTextFallbackPanel({activityId,job,beforeAction,onSelectJob}:{activityId:string;job:StudioJob;beforeAction():Promise<boolean>;onSelectJob(id:string|null):void}){
  const [open,setOpen]=useState(false),[profileId,setProfileId]=useState(''),[preview,setPreview]=useState<StudioTextFallbackPreview|null>(null),
    [error,setError]=useState(''),[busy,setBusy]=useState(false),pending=useRef<StudioTextFallbackRequest|null>(null),generation=useRef(0);
  const key=`sthstart:studio-text-fallback:${activityId}:${job.id}`,operations=useStudioJobMutations(activityId);
  const options=useQuery({queryKey:['studio-text-fallback-options',activityId,job.id,job.revision],queryFn:()=>fetchStudioTextFallbackOptions(activityId,job.id),enabled:open});
  const remember=(value:{open:boolean;profileId:string;preview:StudioTextFallbackPreview|null;error:string},request=pending.current)=>{
    try{sessionStorage.setItem(key,JSON.stringify({...value,pending:request}));}catch{/* Optional form state, never formal content. */}
  };
  useEffect(()=>{pending.current=null;setOpen(false);setProfileId('');setPreview(null);setError('');generation.current++;
    try{const saved=JSON.parse(sessionStorage.getItem(key)??'null');if(saved&&typeof saved.open==='boolean'&&typeof saved.profileId==='string'){
      setOpen(saved.open);setProfileId(saved.profileId);if(typeof saved.error==='string')setError(saved.error);
      if(Value.Check(StudioTextFallbackPreviewSchema,saved.preview))setPreview(saved.preview);
      if(Value.Check(StudioTextFallbackRequestSchema,saved.pending))pending.current=saved.pending;
    }}catch{/* Invalid UI recovery cannot execute or authorize a request. */}
    return()=>{generation.current++;};
  },[key]);
  const changeOpen=(value:boolean)=>{if(busy||operations.textFallback.isPending)return;generation.current++;setOpen(value);remember({open:value,profileId,preview,error});};
  const inspect=async()=>{const run=++generation.current;setBusy(true);setError('');setPreview(null);pending.current=null;
    remember({open:true,profileId,preview:null,error:''},null);
    try{if(!await beforeAction())throw new Error('本地输入未保存，请先处理冲突。');
      const next=await previewStudioTextFallback(activityId,job.id,{profileId});if(run!==generation.current)return;
      setPreview(next);remember({open:true,profileId,preview:next,error:''});
    }catch(reason){if(run===generation.current){const message=(reason as Error).message;setError(message);remember({open:true,profileId,preview:null,error:message});}}
    finally{if(run===generation.current)setBusy(false);}
  };
  const confirm=async()=>{if(!preview)return;setError('');
    try{if(!await beforeAction())throw new Error('本地输入未保存，未执行备用请求。');
      const input=pending.current??{profileId:preview.profileId,expectedJobRevision:preview.expectedJobRevision,planHash:preview.planHash,idempotencyKey:crypto.randomUUID()};
      pending.current=input;remember({open:true,profileId,preview,error:''},input);
      const next=await operations.textFallback.mutateAsync({jobId:job.id,input});pending.current=null;
      try{sessionStorage.removeItem(key);}catch{/* Optional local form persistence. */}setOpen(false);onSelectJob(next.id);
    }catch(reason){const message=(reason as Error).message;setError(message);remember({open:true,profileId,preview,error:message});}
  };
  if(job.kind==='render_batch'||job.readOnly)return null;
  const used=job.input.fallback as {fallbackOf?:string;model?:string}|undefined;
  if(used)return <p role="status" className="text-xs text-muted">本任务为一次备用尝试 · {used.model??'历史未记录模型'}。再次失败会暂停，不继续自动切换。<button className="ml-2 text-accent" onClick={()=>onSelectJob(used.fallbackOf??null)}>查看原失败任务</button></p>;
  if(!['failed','paused','interrupted','unknown'].includes(job.status)||job.stopRequested)return null;
  return <>
    <Button size="sm" variant="outline" onClick={()=>changeOpen(true)}>选择备用文本模型</Button>
    <ResponsiveEditOverlay open={open} onOpenChange={changeOpen} title="备用文本模型"
      description="只影响本次新尝试，不修改全局绑定；最多一次，结果仍需人工审阅。"
      footer={<><Button variant="outline" disabled={busy||operations.textFallback.isPending} onClick={()=>changeOpen(false)}>取消</Button>
        {preview?<Button loading={operations.textFallback.isPending} disabled={busy} onClick={()=>void confirm()}>{pending.current?'重试相同确认':'确认这一次备用尝试'}</Button>:
          <Button loading={busy} disabled={!profileId||!options.data?.allowed} onClick={()=>void inspect()}>预览备用调用</Button>}</>}>
      <div className="space-y-4">
        <p className="text-sm">原任务失败：{job.errorMessage??'尚需核对具体原因'}</p>
        <p className="text-xs text-muted">原实际模型：{options.data?.originalModel??'历史未记录，不能推断'}；文本任务没有图片工作流，不会直接产生图片。</p>
        {options.isPending&&<p role="status">读取已有配置…</p>}
        {options.isError&&<><p role="alert" className="text-sm text-danger-fg">{options.error.message}</p><Button variant="outline" onClick={()=>void options.refetch()}>重新读取配置</Button></>}
        {options.data&&<p role="status" className="text-sm">{options.data.reason}</p>}
        {(options.data?.allowed||pending.current)&&<FormField label="本次备用模型"><select aria-label="本次备用文本模型" className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 text-sm"
          value={profileId} disabled={busy||operations.textFallback.isPending||Boolean(pending.current)} onChange={event=>{generation.current++;setProfileId(event.target.value);setPreview(null);setError('');pending.current=null;remember({open:true,profileId:event.target.value,preview:null,error:''},null);}}>
          <option value="">选择已有的启用模型</option>{options.data?.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
          {pending.current&&!options.data?.profiles.some(profile=>profile.id===profileId)&&<option value={profileId}>{preview?.profileName??profileId} · 已保存的相同确认</option>}
        </select></FormField>}
        {preview&&<section aria-label="备用调用确认" className="space-y-2 rounded-lg bg-surface-subtle p-3 text-sm">
          <h3 className="font-semibold">将使用 {preview.profileName} · {preview.model}</h3><p>{preview.scope}</p>
          <p>本次 1 次文本模型调用 · 0 次图片调用 · 备用上限 1 次</p>
          <p className="text-muted">输出措辞、分镜构图可能变化。原正文与成功图片不变；这里只创建待审提案。</p>
        </section>}
        {error&&<p role="alert" className="text-sm text-danger-fg">{error}</p>}
        <a className="text-sm text-accent" target="_blank" rel="noopener noreferrer" href="/settings/public-services?section=routing&app=activities">管理已有文本模型</a>
      </div>
    </ResponsiveEditOverlay>
  </>;
}
