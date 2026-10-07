'use client';
import {useEffect,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Value} from '@sinclair/typebox/value';
import {StudioTargetSchema,StudioHealthResultSchema,type StudioTarget,type StudioJob,type StudioHealthResult} from '@sthstart/contracts';
import {Button} from '@/app/components/ui/button';
import {ResponsiveEditOverlay} from '@/app/components/ui/responsive-edit-overlay';
import {inspectStudioHealth} from '../studio-api';

const labels={text:'提示词优化模型',connection:'生成实例连接',workflow:'工作流与输入输出',files:'模型与参考文件',queue:'生成队列'} as const;
const statuses={ok:'可用',error:'需处理',unknown:'未确认',not_required:'无需配置'} as const;

/** On-demand diagnostics only. Inspecting saved settings does not authorize a retry. */
export function StudioHealthPanel({activityId,job}:{activityId:string;job:StudioJob}){
  const [open,setOpen]=useState(false),[chosen,setChosen]=useState(''),[result,setResult]=useState<StudioHealthResult|null>(null),[error,setError]=useState('');
  const cache=useQueryClient(),formKey=`sthstart:studio-health:${activityId}:${job.id}`;
  const cacheKey=['studio-health-last',activityId,job.id] as const;
  const remember=(value:{open:boolean;chosen:string})=>{try{sessionStorage.setItem(formKey,JSON.stringify(value));}catch{/* UI state never authorizes a request. */}};
  const changeOpen=(value:boolean)=>{setOpen(value);remember({open:value,chosen});};
  useEffect(()=>{try{const saved=JSON.parse(sessionStorage.getItem(formKey)??'null');
    if(saved&&typeof saved.open==='boolean'&&typeof saved.chosen==='string'){setOpen(saved.open);setChosen(saved.chosen);}
    const data=cache.getQueryData(['studio-health-last',activityId,job.id]);if(Value.Check(StudioHealthResultSchema,data))setResult(data);
  }catch{/* No upstream call is made from restored UI state. */}},[formKey,cache,activityId,job.id]);
  const operation=useMutation({mutationFn:(target:StudioTarget)=>inspectStudioHealth(activityId,{target})});
  const candidates=(job.input.batch===true&&Array.isArray(job.input.plans)?job.input.plans:job.input.target?[{target:job.input.target}]:[]) as Array<{target?:unknown;preview?:{name?:string}}>;
  const targets=[...new Map(candidates.filter(item=>Value.Check(StudioTargetSchema,item.target)).map(item=>[JSON.stringify(item.target),{target:item.target as StudioTarget,name:item.preview?.name}])).entries()];
  const key=targets.some(([key])=>key===chosen)?chosen:targets[0]?.[0],selected=targets.find(([id])=>id===key)?.[1];
  if(job.readOnly||!selected)return null;
  const check=async()=>{setError('');setResult(null);cache.removeQueries({queryKey:cacheKey,exact:true});try{const data=await operation.mutateAsync(selected.target);setResult(data);cache.setQueryData(cacheKey,data);}catch(reason){setError((reason as Error).message);}};
  const visible=result&&JSON.stringify(result.target)===key?result:null;
  return <>
    <Button variant="ghost" onClick={()=>changeOpen(true)}>检查生成环境</Button>
    <ResponsiveEditOverlay open={open} onOpenChange={changeOpen} title="生成环境检查" footer={<><Button variant="outline" onClick={()=>changeOpen(false)}>关闭</Button><Button loading={operation.isPending} onClick={()=>void check()}>重新检查</Button></>}>
      <div className="space-y-4 min-w-0">
        <p className="text-sm text-muted">只检查已保存的目标设置，不调用文本模型、不绘制，也不会重新提交原任务。真正绘制前仍会再次校验。</p>
        <label className="block space-y-1 text-sm"><span>检查目标</span><select className="w-full min-w-0 rounded-lg border border-line bg-surface p-2" value={key} disabled={operation.isPending} onChange={e=>{setChosen(e.target.value);setResult(null);setError('');remember({open:true,chosen:e.target.value});}}>
          {targets.map(([id,{target,name}],index)=><option key={id} value={id}>{index+1}. {name??(target.kind==='beat'?`镜头 ${target.beatId}`:target.kind==='comic_panel'?`画格 ${target.panelId}`:`素材 ${target.slotId}`)}</option>)}
        </select></label>
        {error&&<p role="alert" className="text-sm text-danger-fg">{error}</p>}
        {!visible&&!error&&<p role="status" className="text-sm text-muted">点击“重新检查”，依次核对模型绑定、连接、工作流、文件与队列。</p>}
        {visible&&<>
          <p role="status" className="text-sm font-medium">{visible.canSubmit?'已保存的生成配置可用':'尚不能确认可提交，请查看以下具体检查'}</p>
          <p className="text-xs text-muted break-words">{visible.workflowId?`${visible.workflowId} v${visible.workflowVersion}`:'工作流尚未解析'} · {visible.model??'模型未确认'}</p>
          <ol className="space-y-3">{visible.layers.map(layer=><li key={layer.kind} className="rounded-xl bg-surface-subtle p-3 space-y-1">
            <div className="flex flex-wrap justify-between gap-2 text-sm font-medium"><span>{labels[layer.kind]}</span><span className={layer.status==='error'?'text-danger-fg':'text-muted'}>{statuses[layer.status]}</span></div>
            <p className="text-sm break-words">{layer.summary}</p>
            {layer.issues.length>0&&<ul className="list-disc pl-4 text-sm text-danger-fg">{layer.issues.map((issue,index)=><li key={index} className="break-words">{issue}</li>)}</ul>}
            {(layer.status==='error'||layer.status==='unknown')&&<a href={layer.settingsUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">打开相关配置（新标签页）</a>}
          </li>)}</ol>
          <p className="text-xs text-muted">检查时间：{new Date(visible.checkedAt).toLocaleString()}。排队数量不代表请求失败；结果未知的任务必须先核对。</p>
        </>}
      </div>
    </ResponsiveEditOverlay>
  </>;
}
