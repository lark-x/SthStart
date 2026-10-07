'use client';

import { useEffect,useRef,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Value } from '@sinclair/typebox/value';
import { StudioRefineRequestSchema,type StudioRefineRequest,type ContentDocument,type StudioJob,type StudioVisualPatch } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Textarea } from '@/app/components/ui/textarea';
import { FormField } from '@/app/components/ui/form-field';
import { fetchComicDraft } from '../comic/api';
import { fetchStudioVersions } from '../studio-api';
import { useStudioJobMutations } from '../studio-mutations';
import { isStudioJobActive,useStudioJob } from '../studio-queries';
import { getEffectiveStageScenes } from '../scene-beat-utils';
import { studioStatusLabels } from './studio-proposal-review';
import {StudioTaskControls} from './studio-task-controls';

const labels:Record<string,string>={wide:'远景',medium:'中景',closeup:'特写',detail:'细节',full_body:'全身',eye_level:'平视',high:'俯视',low:'仰视',natural:'自然光',warm:'暖光',rim:'轮廓光',low_key:'低调光',calm:'平静',tense:'紧张',joyful:'愉悦',melancholy:'忧郁'};
function describe(patch:StudioVisualPatch){return [patch.director && Object.values(patch.director).map(value=>labels[value] ?? value).join(' · '),patch.composition && `构图：${patch.composition}`,patch.visualSupplement && `视觉补充：${patch.visualSupplement}`,patch.expression && `表情：${patch.expression}`].filter(Boolean).join('\n') || '未设置';}

export function StudioRefinePanel({ activityId,content,beatId,panelId,job,beforeAction,onSelectJob,onApplied }: {
  activityId:string;content:ContentDocument;beatId?:string;panelId?:string;job:StudioJob|null;
  beforeAction():Promise<boolean>;onSelectJob(id:string|null):void;onApplied(job:StudioJob):Promise<void>;
}) {
  const operations=useStudioJobMutations(activityId), key=`sthstart:studio-refine:${activityId}`;
  const [instructions,setInstructions]=useState(''),[targetKey,setTargetKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<StudioRefineRequest|null>(null);
  const comic=useQuery({ queryKey:['studio-refine-comic',activityId],queryFn:()=>fetchComicDraft(activityId),enabled:!job });
  const child=useStudioJob(activityId,job?.appliedResult?.childJobId ?? null,true);
  const targets:Array<{ key:string;label:string;target:StudioRefineRequest['input']['target'] }>=content.stages.flatMap(stage=>
    getEffectiveStageScenes(stage,content.scenes).flatMap(scene=>scene.beats.map((beat,index)=>({ key:`beat:${beat.id}`,label:`${stage.title} / ${scene.title} / 镜头 ${index+1}：${beat.action}`,target:{ kind:'beat' as const,stageId:stage.id,sceneId:scene.id,beatId:beat.id } }))));
  for(const panel of comic.data?.document.panels ?? []) targets.push({key:`comic:${panel.id}`,label:`漫画画格：${panel.visualDescription}`,target:{kind:'comic_panel',panelId:panel.id}});
  useEffect(()=>{
    try{const recovery=JSON.parse(sessionStorage.getItem(key) ?? 'null');if(recovery){if(typeof recovery.instructions==='string')setInstructions(recovery.instructions);if(typeof recovery.targetKey==='string')setTargetKey(recovery.targetKey);if(Value.Check(StudioRefineRequestSchema,recovery.pending))pending.current=recovery.pending;return;}}catch{/* optional form recovery */}
    setTargetKey(panelId ? `comic:${panelId}`:beatId ? `beat:${beatId}`:'');
  },[key,beatId,panelId]);
  const persist=(text:string,target:string,request:StudioRefineRequest|null)=>{try{sessionStorage.setItem(key,JSON.stringify({instructions:text,targetKey:target,pending:request}));}catch{/* quota doesn't alter content */}};
  const update=(text:string,target:string)=>{pending.current=null;setInstructions(text);setTargetKey(target);persist(text,target,null);setError('');};
  const submit=async()=>{
    setBusy(true);setError('');
    try{
      if(!await beforeAction())throw new Error('当前输入未保存，请先处理保存状态。');
      const target=targets.find(item=>item.key===targetKey)?.target;
      if(!target || !instructions.trim() || instructions.length>2000)throw new Error('请选择镜头或画格，输入 1–2000 字的视觉调整要求。');
      const request=pending.current ?? {kind:'refine' as const,versions:await operations.prepare.mutateAsync(),input:{target,instructions},idempotencyKey:crypto.randomUUID()};
      pending.current=request;persist(instructions,targetKey,request);
      const created=await operations.create.mutateAsync(request);pending.current=null;persist(instructions,targetKey,null);onSelectJob(created.id);
    }catch(reason){setError(reason instanceof Error ? reason.message:'创建失败，输入和重试标识仍保留。');}finally{setBusy(false);}
  };
  const result=job?.result && 'patch' in job.result ? job.result:null;
  const apply=async(renderAfterApply:boolean)=>{
    if(!job || !result)return;setBusy(true);setError('');
    try{if(!await beforeAction())throw new Error('当前输入未保存，请先处理保存冲突。');
      const next=await operations.apply.mutateAsync({jobId:job.id,input:{expectedJobRevision:job.revision,versions:await fetchStudioVersions(activityId),resultHash:result.resultHash,renderAfterApply}});
      await onApplied(next);
    }catch(reason){setError(reason instanceof Error ? reason.message:'应用失败，原文未被覆盖。');}finally{setBusy(false);}
  };
  const stop=async(value:StudioJob)=>{try{await operations.stop.mutateAsync(value);}catch(reason){setError(reason instanceof Error?reason.message:'停止失败，请刷新状态。');}};
  return <section aria-label="画面调整" className="space-y-4">
    <p className="text-sm text-muted">只调整景别、角度、光影、构图和表情。不会修改角色、台词、剧情或模型，也不会编辑源图片文件。</p>
    {!job ? <fieldset disabled={busy} className="space-y-4">
      <FormField label="调整对象"><select aria-label="画面调整对象" className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 text-sm" value={targetKey} onChange={event=>update(instructions,event.target.value)}>
        <option value="">选择镜头或漫画画格</option>{targets.map(target=><option key={target.key} value={target.key}>{target.label}</option>)}</select></FormField>
      <div className="flex flex-wrap gap-2">{['拉远一点','换成俯视角度','改为暖光','表情更平静'].map(text=><Button key={text} size="sm" variant="outline" onClick={()=>update([instructions,text].filter(Boolean).join('，'),targetKey)}>{text}</Button>)}</div>
      <FormField label="视觉调整要求"><Textarea aria-label="画面调整要求" rows={4} value={instructions} onChange={event=>update(event.target.value,targetKey)}/></FormField>
      <Button loading={busy} onClick={()=>void submit()}>生成待审调整</Button>
    </fieldset>:<>
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{studioStatusLabels[job.status]}</h3>{job.callId&&<a className="text-sm text-accent" target="_blank" rel="noopener noreferrer" href={`/settings/ai-logs?callId=${encodeURIComponent(job.callId)}`}>查看调用日志</a>}</div>
      <details className="rounded-lg bg-surface-subtle p-3 text-xs"><summary>冻结来源与要求</summary><p className="mt-2 whitespace-pre-wrap break-words">{String(job.input.description ?? '')}</p><p>{(job.input.request as StudioRefineRequest)?.input.instructions}</p></details>
      <StudioTaskControls activityId={activityId} job={job} beforeAction={beforeAction} onSelectJob={onSelectJob}/>
      {isStudioJobActive(job)&&!job.readOnly&&<><p role="status">正在生成提案，不会自动修改画面设置。</p><Button variant="outline" onClick={()=>void stop(job)}>停止此任务</Button></>}
      {result&&<><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-surface-subtle p-3"><h4 className="text-sm font-medium">调整前</h4><p className="mt-2 whitespace-pre-wrap text-sm">{describe(result.before)}</p></div><div className="rounded-lg bg-accent-soft p-3"><h4 className="text-sm font-medium">提议修改</h4><p className="mt-2 whitespace-pre-wrap text-sm">{describe(result.patch)}</p></div></div><p className="text-sm">{result.explanation}</p></>}
      {job.status==='awaiting_review'&&!job.readOnly&&<><p className="text-xs text-muted">“应用并绘制”按修改后的描述生成独立新图，不是局部修改原图；结果仅加入历史，不覆盖当前画面。</p><div className="flex flex-wrap gap-2"><Button loading={busy} disabled={busy} onClick={()=>void apply(false)}>仅应用调整</Button><Button variant="outline" disabled={busy} onClick={()=>void apply(true)}>应用并绘制新图</Button></div></>}
      {job.applyState==='applied'&&<p role="status" className="text-sm text-success-fg">已应用，重复操作不会再修改或重复提交。</p>}
      {child.data&&<div className="rounded-lg bg-surface-subtle p-3 text-sm"><p>关联绘制：{studioStatusLabels[child.data.status]}</p><Button variant="ghost" size="sm" onClick={()=>onSelectJob(child.data!.id)}>查看绘制任务</Button>{isStudioJobActive(child.data)&&!child.data.readOnly&&<Button variant="outline" size="sm" onClick={()=>void stop(child.data!)}>停止后续提交</Button>}</div>}
      {job.errorMessage&&<p role="alert" className="text-sm text-danger-fg">{job.errorMessage}</p>}
    </>}
    {error&&<p role="alert" className="text-sm text-danger-fg">{error}</p>}
  </section>;
}
