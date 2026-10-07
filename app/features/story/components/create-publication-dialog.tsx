'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {StoryDocument} from '@sthstart/contracts';
import {ResponsiveEditOverlay} from '@/app/components/ui/responsive-edit-overlay';
import {Button} from '@/app/components/ui/button';
import {storyApi} from '../api';
import {publicationApi} from '@/app/features/activities/publication/api';

export function CreatePublicationDialog({open,onOpenChange,projectId,chapters,activeId,flush}:{open:boolean;onOpenChange:(open:boolean)=>void;projectId:string;chapters:StoryDocument[];activeId?:string;flush:()=>Promise<boolean>}) {
  const router=useRouter(),[ids,setIds]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(open){setIds(chapters.some(c=>c.id===activeId)?[activeId!]:chapters.slice(0,1).map(c=>c.id));setError('');}},[open,activeId]);
  async function create(){setBusy(true);setError('');try{
    if(!await flush()) throw new Error('当前正文尚未保存，请先处理保存冲突。');
    const revisions=await Promise.all(ids.map(async id=>{const r=await storyApi.listRevisions(projectId,'chapter',id);if(!r.items[0]) throw new Error('章节没有已保存版本。');return r.items[0].id;}));
    const draft=await publicationApi.create(projectId,revisions);onOpenChange(false);router.push(`/apps/activities/${draft.activityId}`);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <ResponsiveEditOverlay open={open} onOpenChange={v=>!busy&&onOpenChange(v)} title="制作作品" description="冻结已保存章节版本，开始关键画面＋对白制作。不会修改正式剧情。"
    footer={<><Button onClick={()=>onOpenChange(false)} disabled={busy}>取消</Button><Button variant="primary" onClick={()=>void create()} disabled={busy||!ids.length}>{busy?'创建中…':'进入制作台'}</Button></>}>
    <div className="space-y-4"><p className="text-sm text-muted">建议先选一段 1–3 分钟的剧情，拆成 6–12 个关键画面。竖屏漫画和配音视频可以共用画面。</p>
      {!chapters.length&&<p role="status">请先创建并保存章节正文。</p>}
      {chapters.map(c=><label key={c.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-surface-muted p-3"><input type="checkbox" checked={ids.includes(c.id)} onChange={e=>setIds(v=>e.target.checked?[...v,c.id]:v.filter(id=>id!==c.id))}/><span className="min-w-0 truncate">{c.title}</span><span className="ml-auto text-xs text-muted">v{c.revision}</span></label>)}
      {error&&<p role="alert" className="text-danger-fg">{error}</p>}
    </div>
  </ResponsiveEditOverlay>;
}
