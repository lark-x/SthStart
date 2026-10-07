'use client';
import {useQuery} from '@tanstack/react-query';
import Link from 'next/link';
import {Button} from '@/app/components/ui/button';
import {publicationApi,publicationFile} from './api';

export function PublicationAudioHistory({activityId,utteranceId,refreshKey,disabled,onSelect}:{
  activityId:string;utteranceId:string;refreshKey:string;disabled:boolean;onSelect:(id:string)=>void;
}) {
  const query=useQuery({queryKey:['publication',activityId,'audio-history',utteranceId,refreshKey],queryFn:()=>publicationApi.audioHistory(activityId,utteranceId)});
  if(query.isError)return <p role="alert" className="text-xs text-danger-fg">配音历史读取失败，可刷新重试。</p>;
  if(!query.data?.items.length)return null;
  return <details className="text-xs"><summary className="cursor-pointer">本句配音历史（{query.data.items.length}）</summary>
    <div className="mt-3 space-y-3">{query.data.items.map(item=><div key={item.artifactId} className="space-y-2 rounded-xl bg-surface-muted p-3">
      <p>{item.current?'当前配音':item.staleSource?'旧对白／声音配音':'历史配音'} · {(item.durationMs/1000).toFixed(1)} 秒 · {new Date(item.createdAt).toLocaleString()}</p>
      {item.available?<audio controls preload="none" src={publicationFile(item.artifactId)} className="w-full max-w-full"/>:<p>文件不可用</p>}
      <div className="flex items-center gap-3"><Button size="sm" disabled={disabled||!item.available||item.current} onClick={()=>onSelect(item.artifactId)}>使用此配音</Button>{item.callId&&<Link className="text-accent" href={`/settings/ai-logs?callId=${item.callId}`}>调用日志</Link>}</div>
    </div>)}</div>
  </details>;
}
