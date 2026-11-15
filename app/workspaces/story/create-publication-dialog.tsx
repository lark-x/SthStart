'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import type {StoryDocument} from '@sthstart/contracts';
import {ResponsiveEditOverlay} from '@/app/components/ui/responsive-edit-overlay';
import {Button} from '@/app/components/ui/button';
import {Alert} from '@/app/components/ui/alert';
import {Checkbox} from '@/app/components/ui/checkbox';
import {EmptyState} from '@/app/components/ui/empty-state';
import {storyApi} from '@/app/features/story/api';
import {publicationApi} from '@/app/features/activities/publication/api';

export function publicationPreselect(
  chapters:StoryDocument[],
  activeId:string|undefined,
  initialChapterIds:string[]|undefined,
){
  const requested=initialChapterIds?.length?initialChapterIds:activeId?[activeId]:[];
  const preselect=requested.filter((id,index)=>requested.indexOf(id)===index&&chapters.some(c=>c.id===id));
  const explicit=Boolean(initialChapterIds?.length||activeId);
  return preselect.length?preselect:explicit?[]:chapters.slice(0,1).map(c=>c.id);
}

export function CreatePublicationDialog({open,onOpenChange,projectId,chapters,activeId,initialChapterIds,flush}:{open:boolean;onOpenChange:(open:boolean)=>void;projectId:string;chapters:StoryDocument[];activeId?:string;initialChapterIds?:string[];flush:()=>Promise<boolean>}) {
  const router=useRouter(),[ids,setIds]=useState<string[]>(()=>open?publicationPreselect(chapters,activeId,initialChapterIds):[]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [prevOpen,setPrevOpen]=useState(open);
  if(open!==prevOpen){
    setPrevOpen(open);
    if(open){
      setIds(publicationPreselect(chapters,activeId,initialChapterIds));
      setError('');
    }
  }
  async function create(){setBusy(true);setError('');try{
    if(!await flush()) throw new Error('当前正文尚未保存，请先处理保存冲突。');
    const revisions=await Promise.all(ids.map(async id=>{const r=await storyApi.listRevisions(projectId,'chapter',id);if(!r.items[0]) throw new Error('章节没有已保存版本。');return r.items[0].id;}));
    const draft=await publicationApi.create(projectId,revisions);onOpenChange(false);router.push(`/apps/activities/${draft.activityId}`);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <ResponsiveEditOverlay open={open} onOpenChange={v=>!busy&&onOpenChange(v)} title="创建制作版本" description="冻结已保存章节版本，开始关键画面＋对白制作。不会修改正式剧情。"
    footer={<><Button variant="outline" onClick={()=>onOpenChange(false)} disabled={busy}>取消</Button><Button variant="primary" onClick={()=>void create()} disabled={!ids.length} loading={busy}>{busy?'创建中…':'创建制作版本'}</Button></>}>
    <div className="space-y-4"><p className="text-sm text-muted">建议先选一段 1–3 分钟的剧情，拆成 6–12 个关键画面。竖屏漫画和配音视频可以共用画面。</p>
      {!chapters.length&&<EmptyState title="还没有可制作的章节" description="请先在写作工作区创建并保存章节正文。" />}
      {!!chapters.length && <fieldset className="min-w-0 space-y-2"><legend className="mb-2 text-sm font-medium text-ink">选择要冻结的章节修订</legend>
        {chapters.map(c=><div key={c.id} className="flex min-w-0 items-center gap-3 rounded-control bg-surface-muted p-3"><Checkbox aria-label={`选择章节 ${c.title}`} checked={ids.includes(c.id)} onChange={e=>setIds(v=>e.target.checked?[...v,c.id]:v.filter(id=>id!==c.id))}/><span className="min-w-0 flex-1 truncate text-sm text-ink">{c.title}</span><span className="shrink-0 text-xs text-muted">v{c.revision}</span></div>)}
      </fieldset>}
      {error&&<Alert variant="danger" title="无法创建制作版本">{error}</Alert>}
    </div>
  </ResponsiveEditOverlay>;
}
