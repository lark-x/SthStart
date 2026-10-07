'use client';
import {useEffect,useRef,useState} from 'react';
import {StudioJobResumeSchema,type StudioJob,type StudioJobResume} from '@sthstart/contracts';
import {Value} from '@sinclair/typebox/value';
import {Button} from '@/app/components/ui/button';
import {ResponsiveEditOverlay} from '@/app/components/ui/responsive-edit-overlay';
import {useStudioJobMutations} from '../studio-mutations';
import {useStudioItems} from '../studio-queries';
import {StudioHealthPanel} from './studio-health-panel';
import {StudioTextFallbackPanel} from './studio-text-fallback-panel';
import {StudioImageFallbackPanel} from './studio-image-fallback-panel';

/** Recovery only continues safe never-submitted items; failed retries are separate new attempts. */
export function StudioTaskControls({activityId,job,beforeAction,onSelectJob}:{activityId:string;job:StudioJob;beforeAction():Promise<boolean>;onSelectJob?(id:string|null):void}){
  const operations=useStudioJobMutations(activityId),[open,setOpen]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<string[]>([]);
  const items=useStudioItems(activityId,job.kind==='render_batch'?job:null),pending=useRef<StudioJobResume|null>(null);
  const key=`sthstart:studio-resume:${activityId}:${job.id}`;
  const formKey=`${key}:form`;
  const remember=(value:{open:boolean;selected:string[];error?:string})=>{try{sessionStorage.setItem(formKey,JSON.stringify(value));}catch{/* Optional local form persistence. */}};
  const changeOpen=(value:boolean)=>{if(operations.resume.isPending)return;setOpen(value);remember({open:value,selected,error});};
  useEffect(()=>{pending.current=null;setSelected([]);setOpen(false);setError('');try{
    const form=JSON.parse(sessionStorage.getItem(formKey)??'null');
    if(form&&typeof form.open==='boolean'&&Array.isArray(form.selected)&&form.selected.every((id:unknown)=>typeof id==='string')){
      setOpen(form.open);setSelected(form.selected);if(typeof form.error==='string')setError(form.error);
    }
    const saved=JSON.parse(sessionStorage.getItem(key)??'null');if(Value.Check(StudioJobResumeSchema,saved)){pending.current=saved;setSelected(saved.itemIds??[]);}
  }catch{/* Recovery data cannot execute a task. */}},[key,formKey]);
  if(job.readOnly)return <p role="status" className="text-sm text-muted">导入的历史任务只读：可以查阅，不会恢复、重试或再次应用。</p>;
  const resumable=['paused','interrupted','partially_succeeded','failed'].includes(job.status)&&!job.stopRequested;
  const preNetwork=(job.input.recovery as {canResumeBeforeNetwork?:boolean}|undefined)?.canResumeBeforeNetwork;
  const showResume=Boolean(resumable&&(job.kind==='render_batch'||preNetwork&&!job.callId));
  const showQuery=job.kind==='render_batch'&&['unknown','interrupted','paused','partially_succeeded','cancelled','succeeded','failed'].includes(job.status);
  const resume=async()=>{setError('');try{
    if(!await beforeAction())throw new Error('本地输入未保存，请先处理冲突；任务仍保留。');
    if(job.kind==='render_batch'&&!selected.length)throw new Error('请选择本次要恢复的待提交项。');
    const input=pending.current??{expectedJobRevision:job.revision,...(job.planHash?{planHash:job.planHash}:{}),...(job.kind==='render_batch'?{itemIds:selected}:{})};
    pending.current=input;try{sessionStorage.setItem(key,JSON.stringify(input));}catch{/* In-memory confirmation is stable. */}
    await operations.resume.mutateAsync({jobId:job.id,input});pending.current=null;try{sessionStorage.removeItem(key);sessionStorage.removeItem(formKey);}catch{/* Optional local storage. */}setOpen(false);
  }catch(reason){const message=(reason as Error).message;setError(message);remember({open:true,selected,error:message});}};
  return <div className="space-y-2">
    <StudioHealthPanel key={job.id} activityId={activityId} job={job}/>
    {onSelectJob&&<StudioTextFallbackPanel key={`fallback:${job.id}`} activityId={activityId} job={job} beforeAction={beforeAction} onSelectJob={onSelectJob}/>}
    {onSelectJob&&<StudioImageFallbackPanel key={`image-fallback:${job.id}`} activityId={activityId} job={job} beforeAction={beforeAction} onSelectJob={onSelectJob}/>}
    {(showQuery||showResume)&&<p className="text-xs text-muted">先核对原任务。恢复只继续未提交项，已成功图片不会重绘；失败重试会建立独立新尝试。</p>}
    <div className="flex flex-wrap gap-2">{showQuery&&<Button variant="outline" loading={operations.reconcile.isPending} onClick={()=>void (async()=>{
      setError('');try{await operations.reconcile.mutateAsync(job.id);}catch(reason){setError((reason as Error).message);}
    })()}>核对原任务状态</Button>}{showResume&&<Button variant="outline" disabled={operations.reconcile.isPending} onClick={()=>changeOpen(true)}>恢复待提交项</Button>}</div>
    {error&&<p role="alert" className="text-sm text-danger-fg">{error}</p>}
    <ResponsiveEditOverlay open={open&&showResume} onOpenChange={changeOpen} title="恢复安全的待提交项" footer={<><Button variant="outline" disabled={operations.resume.isPending} onClick={()=>changeOpen(false)}>取消</Button><Button loading={operations.resume.isPending} disabled={operations.reconcile.isPending||job.kind==='render_batch'&&!selected.length} onClick={()=>void resume()}>确认恢复</Button></>}>
      <p className="text-sm">沿用已确认的来源、工作流、种子与提交标识。仍在运行、结果未知或来源已变化时会拒绝恢复；成功项不会重复生成。</p>
      {job.kind==='render_batch'&&<fieldset className="mt-3 space-y-2"><legend className="text-sm font-medium">本次继续 {selected.length} 项</legend>
        {(items.data?.pages.flatMap(page=>page.items)??[]).filter(item=>['waiting','submitted'].includes(item.state)).map(item=><label key={item.id} className="flex items-start gap-2 rounded-lg bg-surface-subtle p-2 text-sm"><input type="checkbox" checked={selected.includes(item.id)} disabled={operations.resume.isPending} onChange={e=>{pending.current=null;try{sessionStorage.removeItem(key);}catch{/* Optional recovery. */}const next=e.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id);setSelected(next);remember({open:true,selected:next,error});}}/><span>{item.target.kind==='beat'?`镜头 ${item.target.beatId}`:item.target.kind==='comic_panel'?`画格 ${item.target.panelId}`:`素材 ${item.target.slotId}`} · 候选 {item.candidateIndex+1} · seed {item.seed}{item.state==='submitted'?'（仅已关联且尚未发送的任务可恢复）':''}</span></label>)}
        {items.hasNextPage&&<Button variant="ghost" loading={items.isFetchingNextPage} onClick={()=>void items.fetchNextPage()}>更多待提交项</Button>}{items.isError&&<p role="alert">{items.error.message}</p>}
      </fieldset>}{error&&<p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
    </ResponsiveEditOverlay>
  </div>;
}
