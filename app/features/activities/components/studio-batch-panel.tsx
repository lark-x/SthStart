'use client';

import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Value} from '@sinclair/typebox/value';
import {StudioBatchRequestSchema,StudioBatchRetrySchema,type StudioBatchRequest,type StudioBatchRetry,type StudioJob,type StudioTarget,type ContentDocument,type StudioItem} from '@sthstart/contracts';
import {Button} from '@/app/components/ui/button';
import {FormField} from '@/app/components/ui/form-field';
import {activityKeys} from '@/app/lib/query-keys';
import {fetchComicDraft} from '../comic/api';
import {useStudioItems,isStudioJobActive} from '../studio-queries';
import {useStudioJobMutations} from '../studio-mutations';
import {getEffectiveStageScenes} from '../scene-beat-utils';
import {studioStatusLabels} from './studio-proposal-review';
import {StudioTaskControls} from './studio-task-controls';

const selectClass='h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 text-sm';
const stateLabels:Record<StudioItem['state'],string>={waiting:'待提交',preparing:'准备中',submitted:'已提交',succeeded:'已完成',failed:'失败',skipped:'已跳过',cancelled:'已停止',interrupted:'已中断',unknown:'结果未确定'};
export function StudioBatchPanel({activityId,content,job,beforeAction,onSelectJob,onSync}:{activityId:string;content:ContentDocument;job:StudioJob|null;
  beforeAction():Promise<boolean>;onSelectJob(id:string|null):void;onSync():Promise<void>}){
  const [kind,setKind]=useState<StudioTarget['kind']>('beat'),[targets,setTargets]=useState<StudioTarget[]>([]),[count,setCount]=useState(1),[placement,setPlacement]=useState<'history_only'|'fill_empty'>('history_only');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [retryIds,setRetryIds]=useState<string[]>([]),retryRequest=useRef<StudioBatchRetry|null>(null);
  const key=`sthstart:studio-batch:${activityId}`,initialized=useRef(false),pending=useRef<StudioBatchRequest|null>(null);
  const retryStorageKey=`sthstart:studio-batch-retry:${activityId}:${job?.id??''}`;
  useEffect(()=>{if(!job)return;try{const saved=JSON.parse(sessionStorage.getItem(retryStorageKey)??'null');if(Value.Check(StudioBatchRetrySchema,saved)){retryRequest.current=saved;setRetryIds(saved.itemIds);}}catch{/* Invalid local data never starts a retry. */}},[job?.id,retryStorageKey]);
  const operations=useStudioJobMutations(activityId),items=useStudioItems(activityId,job);
  const comics=useQuery({queryKey:activityKeys.comicDraft(activityId),queryFn:()=>fetchComicDraft(activityId),enabled:!job&&kind==='comic_panel'});
  useEffect(()=>{if(initialized.current)return;initialized.current=true;try{const saved=JSON.parse(sessionStorage.getItem(key)??'null');
    if(saved&&Value.Check(StudioBatchRequestSchema,saved.pending)){pending.current=saved.pending;setKind(saved.pending.input.targets[0].kind);setTargets(saved.pending.input.targets);setCount(saved.pending.input.candidateCount);setPlacement(saved.pending.input.placement);}
    else if(saved&&Value.Check(StudioBatchRequestSchema.properties.input,saved.input)){setKind(saved.input.targets[0].kind);setTargets(saved.input.targets);setCount(saved.input.candidateCount);setPlacement(saved.input.placement);}
  }catch{/* Local draft recovery cannot modify a saved document. */}},[key]);
  const persist=(input:StudioBatchRequest['input'],request:StudioBatchRequest|null)=>{try{sessionStorage.setItem(key,JSON.stringify({input,pending:request}));}catch{/* Optional recovery. */}};
  const update=(selected:StudioTarget[],candidateCount=count,selection=placement)=>{setTargets(selected);setCount(candidateCount);setPlacement(selection);pending.current=null;persist({targets:selected,candidateCount,placement:selection},null);setError('');};
  const candidates:Array<{target:StudioTarget;name:string;locked:boolean}>=kind==='beat' ? content.stages.flatMap(stage=>getEffectiveStageScenes(stage,content.scenes).flatMap(scene=>scene.beats.map((beat,index)=>({target:{kind:'beat' as const,stageId:stage.id,sceneId:scene.id,beatId:beat.id},name:`${scene.title} · ${index+1}. ${beat.action}`,locked:stage.locked}))))
    :kind==='comic_panel' ? (comics.data?.document.panels ?? []).map(panel=>({target:{kind:'comic_panel' as const,panelId:panel.id},name:panel.visualDescription,locked:Boolean(content.stages.find(stage=>stage.id===panel.source.stageId)?.locked)}))
    :content.mediaSlots.filter(slot=>slot.kind==='image').map(slot=>({target:{kind:'media_slot' as const,slotId:slot.id},name:slot.caption||slot.shotDescription||slot.id,locked:Boolean(content.stages.find(stage=>stage.id===slot.stageId)?.locked||content.editingPolicy?.lockedMediaSlotIds.includes(slot.id))}));
  const same=(a:StudioTarget,b:StudioTarget)=>JSON.stringify(a)===JSON.stringify(b);
  const preview=async()=>{if(busy)return;setBusy(true);setError('');try{
    if(!targets.length||targets.length>12||targets.length*count>24)throw new Error('请选择 1–12 个目标，总数最多 24 张。');
    if(!await beforeAction())throw new Error('编辑内容未保存，请先处理保存状态。');
    const request=pending.current??{kind:'render_batch' as const,versions:await operations.prepare.mutateAsync(),input:{targets,candidateCount:count,placement},idempotencyKey:crypto.randomUUID()};
    pending.current=request;persist(request.input,request);
    const created=await operations.create.mutateAsync(request);pending.current=null;persist(request.input,null);onSelectJob(created.id);
  }catch(reason){setError(reason instanceof Error?reason.message:'预览失败，选择与原提交标识保留。');}finally{setBusy(false);}};
  const start=async()=>{if(!job||!job.planHash||busy)return;setBusy(true);setError('');try{
    if(!await beforeAction())throw new Error('编辑内容未保存，请先处理冲突。');
    await operations.start.mutateAsync({jobId:job.id,input:{expectedJobRevision:job.revision,planHash:job.planHash}});
  }catch(reason){setError(reason instanceof Error?reason.message:'启动失败，请重新检查预览。');}finally{setBusy(false);}};
  const stop=async()=>{if(!job)return;try{await operations.stop.mutateAsync(job);}catch(reason){setError((reason as Error).message);}};
  const retry=async()=>{if(!job||busy||!retryIds.length)return;setBusy(true);setError('');try{
    if(!await beforeAction())throw new Error('编辑内容未保存，请先处理冲突。');
    if(!retryRequest.current)await operations.prepare.mutateAsync();
    const input=retryRequest.current??{expectedJobRevision:job.revision,itemIds:retryIds,idempotencyKey:crypto.randomUUID()};
    retryRequest.current=input;
    try{sessionStorage.setItem(retryStorageKey,JSON.stringify(input));}catch{/* In-memory key is still stable. */}
    const next=await operations.retry.mutateAsync({jobId:job.id,input});retryRequest.current=null;try{sessionStorage.removeItem(retryStorageKey);}catch{/* Optional local recovery. */}setRetryIds([]);onSelectJob(next.id);
  }catch(reason){setError((reason as Error).message);}finally{setBusy(false);}};
  const loaded=items.data?.pages.flatMap(page=>page.items)??[],result=job?.result&&'plans' in job.result?job.result:null;
  return <section aria-label="批量绘制" className="space-y-4">
    {!job?<><p className="text-sm text-muted">先预检，再明确确认。默认只入历史，每次仅绘制一种对象；预览先保存已变化的内容版本，不调用优化模型或提交图片。</p>
      <fieldset disabled={busy} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">
        <FormField label="绘制对象"><select aria-label="批次对象类型" className={selectClass} value={kind} onChange={e=>{setKind(e.target.value as StudioTarget['kind']);update([]);}}><option value="beat">活动镜头</option><option value="comic_panel">漫画画格</option><option value="media_slot">素材槽位</option></select></FormField>
        <FormField label="每个目标图片数"><select aria-label="每目标图片数" className={selectClass} value={count} onChange={e=>update(targets,Number(e.target.value))}>{[1,2,3].map(n=><option key={n} value={n}>{n} 张</option>)}</select></FormField></div>
        <FormField label="图片写回方式"><select aria-label="批次图片写回" className={selectClass} value={placement} onChange={e=>update(targets,count,e.target.value as typeof placement)}><option value="history_only">仅加入历史（默认）</option><option value="fill_empty">仅填入当前为空的画面</option></select></FormField>
        {placement==='fill_empty'&&<p className="text-sm text-warning-fg">这次明确授权选图；已有图不会被覆盖，描述变化或文件不可用也只留历史。</p>}
        <fieldset className="space-y-2"><legend className="text-sm font-medium">选择目标 · {targets.length}/12 · 共 {targets.length*count} 张</legend>
          {comics.isError&&kind==='comic_panel'&&<p role="alert">{comics.error.message}</p>}
          {!candidates.length&&<p className="text-sm text-muted">没有可选对象。请先保存镜头、漫画画格或素材槽位。</p>}
          <div className="max-h-64 space-y-2 overflow-y-auto">{candidates.map(candidate=><label key={JSON.stringify(candidate.target)} className="flex items-start gap-2 rounded-lg bg-surface-subtle p-3 text-sm"><input type="checkbox" aria-label={`选择绘制 ${candidate.name}`} disabled={candidate.locked||(!targets.some(target=>same(target,candidate.target))&&(targets.length>=12||(targets.length+1)*count>24))}
            checked={targets.some(target=>same(target,candidate.target))} onChange={e=>update(e.target.checked?[...targets,candidate.target]:targets.filter(target=>!same(target,candidate.target)))} /><span className="min-w-0 break-words">{candidate.name}{candidate.locked?'（已锁定）':''}</span></label>)}</div>
        </fieldset></fieldset><Button loading={busy} disabled={busy||!targets.length||targets.length*count>24} onClick={()=>void preview()}>预览批次</Button></>
      :<><h3 className="font-semibold">{studioStatusLabels[job.status]}</h3><p className="text-xs text-muted">任务 {job.id} · 刷新后仍能查看，关闭页面不停止任务。</p>
        {job.errorMessage&&<p role="alert" className="text-danger-fg">{job.errorMessage}</p>}
        <StudioTaskControls activityId={activityId} job={job} beforeAction={beforeAction} onSelectJob={onSelectJob}/>
        {result&&<><p className="text-sm font-medium">{result.imageTaskCount} 个图片任务 · {result.modelRequestCount} 次提示词优化调用 · {result.placement==='fill_empty'?'仅填空画面':'仅加入历史'}</p>
          <p className="text-xs text-muted">画面描述尚未经过本次优化；实际提交提示词在各项调用日志中查看。</p>
          <div className="space-y-2">{result.plans.map((plan,index)=><article key={index} className="rounded-lg bg-surface-subtle p-3 text-sm"><p className="font-medium">{index+1}. {plan.name} · {plan.empty?'空画面':'已有画面'} · {plan.canSubmit?'可提交':'不可提交'}</p>
            <p className="mt-1 text-xs text-muted">{plan.workflowId} v{plan.workflowVersion} · {plan.model||'未记录模型'} · seed {plan.seed}</p>
            <p className="text-xs text-muted">角色：{plan.actorIds.map(id=>content.actors.find(actor=>actor.id===id)?.displayName??id).join('、')||'空景'} · 参考图：{plan.referenceSelected?'已选中':plan.referenceSupported?'未选中':'仅文字参考'}</p>
            <p className="text-xs text-muted">LoRA：{plan.loras.filter(lora=>lora.enabled).map(lora=>`${lora.model} (${lora.strength})`).join('、')||'未启用'} · 提示词策略 v{plan.promptPolicyRevision}</p>
            <p className="text-xs text-muted">提示词优化：{plan.optimizerEnabled===undefined?'未记录':plan.optimizerEnabled?plan.optimizerModel||'尚未绑定模型':'关闭，不调用文本模型'}</p>
            <details className="mt-2"><summary className="text-xs">来源编译描述（本次优化前）</summary><p className="mt-1 whitespace-pre-wrap break-words text-xs">{plan.compiledPrompt??'旧预览未记录'}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs">反向词：{plan.negativePrompt??'无'}</p></details>
            <details className="mt-2"><summary className="text-xs">实际参数与目标 ID</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({target:plan.target,parameters:plan.parameters},null,2)}</pre></details>
            {plan.issues.map((issue,i)=><p key={i} className="mt-1 text-xs text-muted">{issue}</p>)}</article>)}</div>
          {job.status==='awaiting_review'&&!job.readOnly&&<Button loading={busy} disabled={busy||result.plans.some(plan=>!plan.canSubmit)} onClick={()=>void start()}>确认绘制 {result.imageTaskCount} 张</Button>}</>}
        <div className="space-y-2"><h4 className="text-sm font-medium">逐项进度 · {loaded.filter(item=>item.state==='succeeded').length} 项完成 · {loaded.reduce((sum,item)=>sum+item.artifactIds.length-(item.unavailableArtifactIds?.length??0),0)} 张可用图片</h4>
          {items.isError&&<p role="alert" className="text-danger-fg">{items.error.message}</p>}
          {loaded.map(item=><article key={item.id} className="rounded-lg bg-surface-subtle p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{stateLabels[item.state]} · 候选 {item.candidateIndex+1} · 尝试 {item.attemptNo+1} · seed {item.seed}</span>
            {item.callId&&<a className="text-accent" href={`/settings/ai-logs?callId=${encodeURIComponent(item.callId)}`} target="_blank" rel="noopener noreferrer">调用日志</a>}</div>
            <p className="mt-1 text-xs text-muted">{item.target.kind==='beat'?`镜头 ${item.target.beatId}`:item.target.kind==='comic_panel'?`画格 ${item.target.panelId}`:`素材 ${item.target.slotId}`} · {item.artifactIds.length} 张图片</p>
            <a className="mt-1 inline-block text-xs text-accent" href={targetLink(activityId,item.target)}>定位对象与图片历史</a>
            {item.placementReason&&<p className="mt-1 text-xs">{item.placementReason}</p>}{item.errorMessage&&<p className="mt-1 text-xs text-danger-fg">{item.errorMessage}</p>}
            {Boolean(item.unavailableArtifactIds?.length)&&<p className="mt-1 text-xs text-warning-fg">{item.unavailableArtifactIds!.length} 个图片文件不可用，历史记录和引用仍保留。</p>}
            {item.state==='failed'&&!job.readOnly&&['paused','partially_succeeded','failed','interrupted'].includes(job.status)&&<label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={retryIds.includes(item.id)} disabled={busy} onChange={e=>{retryRequest.current=null;try{sessionStorage.removeItem(retryStorageKey);}catch{/* Optional local recovery. */}setRetryIds(ids=>e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id));}}/>选择此失败项重试</label>}
          </article>)}{items.hasNextPage&&<Button variant="ghost" loading={items.isFetchingNextPage} onClick={()=>void items.fetchNextPage()}>更多条目</Button>}</div>
        {retryIds.length>0&&<div className="space-y-2"><p className="text-sm text-muted">仅为选中的失败项建立新尝试，使用当前设置、换种子并重新预检。成功项不重绘，上游未知时会拒绝重试。</p><Button loading={busy} onClick={()=>void retry()}>预览 {retryIds.length} 项失败重试</Button></div>}
        {isStudioJobActive(job)&&!job.readOnly&&<Button variant="outline" loading={operations.stop.isPending} onClick={()=>void stop()}>停止后续提交</Button>}
        {loaded.some(item=>item.placementState==='applied')&&<div className="space-y-2"><p className="text-sm text-muted">已填入空画面。后台不会覆盖正在编辑的输入；同步前会先保存，冲突时保留本地内容。</p><Button variant="outline" onClick={()=>void (async()=>{try{if(!await beforeAction())throw new Error('本地输入未保存，暂不同步；请先处理冲突。');await onSync();}catch(reason){setError((reason as Error).message);}})()}>同步已填画面</Button></div>}
      </>}
    {error&&<p role="alert" className="text-sm text-danger-fg">{error}</p>}
  </section>;
}

function targetLink(activityId:string,target:StudioTarget){
  const search=new URLSearchParams({tab:'studio',view:target.kind==='beat'?'storyboard':target.kind==='comic_panel'?'comic':'assets'});
  if(target.kind==='beat'){search.set('stageId',target.stageId);search.set('sceneId',target.sceneId);search.set('beatId',target.beatId);}
  else if(target.kind==='comic_panel')search.set('panelId',target.panelId);else search.set('slotId',target.slotId);
  return `/apps/activities/${encodeURIComponent(activityId)}?${search}`;
}
