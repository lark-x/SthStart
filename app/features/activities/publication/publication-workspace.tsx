'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicationDocument, PublicationShot, PublicationPreview, SpeechProfile, ActivityLora } from '@sthstart/contracts';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { Button } from '@/app/components/ui/button';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { publicationApi, publicationFile } from './api';
import { usePublicationDraft } from './use-publication-draft';
import { PublicationComicPreview } from './publication-preview';
import { PublicationAudioHistory } from './publication-audio-history';
import { ApiClientError } from '@/app/lib/api-client';
import { Camera, AlertCircle, ArrowUp, ArrowDown, X } from 'lucide-react';

const labels: Record<string, string> = {
  queued: '等待制作',
  preparing: '准备中',
  running: '制作中',
  succeeded: '已完成',
  failed: '需要处理',
  unknown: '结果待核对',
  interrupted: '需要人工恢复',
  stopped: '已停止',
};

const emptyPrompt = () => ({ actors: [], camera: ['medium shot'], scene: [], details: [], naturalLanguage: '' });
const fieldClass = 'space-y-1.5 text-sm';

function PublicationThumbnail({
  artifactId,
  alt = '',
  className = '',
  fallbackText = '无图',
}: {
  artifactId?: string | null;
  alt?: string;
  className?: string;
  fallbackText?: string;
}) {
  const [failedArtifact, setFailedArtifact] = useState<string | null>(null);
  const isFailed = Boolean(artifactId && failedArtifact === artifactId);

  if (!artifactId || isFailed) {
    return (
      <div className={`flex items-center justify-center bg-surface-muted text-xs text-muted select-none border border-border-subtle ${className}`}>
        <span>{isFailed ? '读取失败' : fallbackText}</span>
      </div>
    );
  }

  return (
    <img
      src={publicationFile(artifactId)}
      alt={alt}
      onError={() => setFailedArtifact(artifactId)}
      className={className}
    />
  );
}

function MainShotViewport({ shot }: { shot: PublicationShot }) {
  const currentId = shot.selectedImage?.artifactId ?? null;
  const [failedId, setFailedId] = useState<string | null>(null);
  const isFailed = Boolean(currentId && failedId === currentId);

  if (!shot.selectedImage) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center rounded-panel border border-border-default bg-surface-muted/50 p-6 text-center space-y-2">
        <Camera className="h-6 w-6 text-muted" />
        <p className="text-sm font-medium text-ink">当前镜头尚未生成或绑定画面</p>
        <p className="text-xs text-muted max-w-md">方案确认并批准后将自动绘制；你也可在下方按批准配置重绘或从历史中选择。</p>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center rounded-panel border border-warning/40 bg-warning/5 p-6 text-center space-y-2">
        <AlertCircle className="h-6 w-6 text-warning-fg" />
        <p className="text-sm font-medium text-warning-fg">画面文件暂不可读取或尚未就绪</p>
        <p className="text-xs font-mono text-muted">产物 ID: {shot.selectedImage.artifactId}</p>
        <p className="text-sm text-muted">可重新加载画面，或在历史版本中选择其他图片。</p>
        <Button size="sm" variant="outline" onClick={() => setFailedId(null)}>重新加载画面</Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-56 items-center justify-center rounded-panel border border-border-default bg-surface p-2 overflow-hidden shadow-2xs">
      <img
        src={publicationFile(shot.selectedImage.artifactId)}
        alt="当前关键镜头画面"
        onError={() => currentId && setFailedId(currentId)}
        className="max-h-[50dvh] w-full object-contain rounded-control"
      />
    </div>
  );
}

export function PublicationWorkspace({activityId}:{activityId:string}) {
  const client=useQueryClient(),incoming=useQuery({queryKey:['publication',activityId,'draft'],queryFn:()=>publicationApi.draft(activityId),refetchInterval:2500});
  const draft=usePublicationDraft(activityId,incoming.data),doc=draft.document;
  const runs=useQuery({queryKey:['publication',activityId,'runs'],queryFn:()=>publicationApi.runs(activityId),refetchInterval:q=>q.state.data?.items.some(r=>['running','queued'].includes(r.status))?2000:false});
  const options=useQuery({queryKey:['publication','image-options',activityId],queryFn:()=>publicationApi.options(activityId)});
  const profiles=useQuery({queryKey:['publication','speech-profiles'],queryFn:publicationApi.profiles});
  const speechModels=useQuery({queryKey:['publication','speech-models'],queryFn:publicationApi.speechModels});
  const [tab,setTab]=useState<'plan'|'media'|'export'>('plan'),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [overlay,setOverlay]=useState<'drawing'|'project'|'approve'|'bridge'|'speech'|null>(null),[editShot,setEditShot]=useState<PublicationShot|null>(null),[editDoc,setEditDoc]=useState<PublicationDocument|null>(null);
  const [preview,setPreview]=useState<PublicationPreview|null>(null),[speechId,setSpeechId]=useState(''),[makeVideo,setMakeVideo]=useState(true),[budget,setBudget]=useState(9);
  const [grantToken,setGrantToken]=useState(''),[speechEdit,setSpeechEdit]=useState<SpeechProfile|null>(null);
  const [pendingApprovalRequest, setPendingApprovalRequest] = useState<{approvalId:string;key:string}|null>(null);
  const approvalRequest=useRef<{approvalId:string;key:string}|null>(null),actionKey=useRef<string|null>(null);
  const shot=doc?.shots.find(s=>s.id===selected)??doc?.shots[0],run=runs.data?.items[0];
  const history=useQuery({queryKey:['publication',activityId,'history',shot?.id,run?.updatedAt],queryFn:()=>publicationApi.history(activityId,shot!.id),enabled:Boolean(shot)});
  const activeSpeechId = speechId || profiles.data?.items[0]?.id || '';
  const refresh=async()=>{await Promise.all([client.invalidateQueries({queryKey:['publication',activityId]}),client.invalidateQueries({queryKey:['publication','speech-profiles']})]);};
  async function action(fn:()=>Promise<unknown>,flush=true){setBusy(true);setError('');try{if(flush&&!await draft.flush())return;await fn();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function changeShot(next:PublicationShot){if(!doc)return;draft.update({...doc,shots:doc.shots.map(s=>s.id===next.id?next:s)});}
  function reorder(index:number,delta:number){if(!doc||index+delta<0||index+delta>=doc.shots.length)return;const list=[...doc.shots];[list[index],list[index+delta]]=[list[index+delta],list[index]];draft.update({...doc,shots:list});}
  function addShot(){if(!doc||doc.shots.length>=12)return;const id=crypto.randomUUID();draft.update({...doc,shots:[...doc.shots,{id,sourceRefs:[doc.source.entryRevisionIds[0]],actorIds:[],visualDescription:'',structuredPrompt:emptyPrompt(),renderSettings:{},selectedImage:null,utterances:[],presentation:'still'}]});setSelected(id);}
  async function openApproval(){await action(async()=>{const p=await publicationApi.preview(activityId,draft.version(),speechId||null,makeVideo);setPreview(p);setBudget(doc!.shots.length+3);setOverlay('approve');});}
  async function confirmApproval(){await action(async()=>{
    if(!preview)throw new Error('请先预览实际配置。');
    const chars=doc!.shots.flatMap(s=>s.utterances).filter(u=>!u.selectedAudioArtifactId).reduce((n,u)=>n+u.text.length,0);
    const approval=await publicationApi.approve(activityId,{expectedDraftVersion:draft.version(),expectedConfigHash:preview.configHash,speechProfileId:activeSpeechId||null,makeVideo,imageBudget:budget,speechCharacterBudget:makeVideo?chars:0});
    const req = {approvalId:approval.id,key:crypto.randomUUID()};
    approvalRequest.current=req; setPendingApprovalRequest(req);
    await publicationApi.start(activityId,approval.id,req.key);setOverlay(null);setTab('media');
  });}
  async function chooseImage(id:string){await action(async()=>{let result;try{result=await publicationApi.select(activityId,shot!.id,draft.version(),id);}catch(e){if(!(e instanceof ApiClientError)||e.code!=='publication_source_changed'||!window.confirm('镜头描述已经变化，仍使用这张旧描述图片吗？'))throw e;result=await publicationApi.select(activityId,shot!.id,draft.version(),id,true);}draft.accept(result);});}
  const closeOverlay=(open:boolean)=>{if(open||busy)return;if((overlay==='drawing'&&editShot&&JSON.stringify(editShot)!==JSON.stringify(shot))||(overlay==='project'&&editDoc&&JSON.stringify(editDoc)!==JSON.stringify(doc))){if(!window.confirm('放弃弹窗内尚未保存的修改？'))return;}setOverlay(null);setGrantToken('');};
  const savedStatus=<span className="text-xs text-muted">{draft.status}</span>;
  if(incoming.isError)return <div className="p-6" role="alert">{(incoming.error as Error).message}<Button onClick={()=>void incoming.refetch()}>重新载入</Button></div>;
  if(!doc)return <div className="p-6" role="status">正在载入制作文档…</div>;
  const active=shot;
  const shotList = (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between pb-1">
        <span className="text-xs font-semibold text-ink">关键镜头清单 ({doc.shots.length}/12)</span>
      </div>
      <div className="space-y-1.5">
        {doc.shots.map((s, i) => {
          const isActive = s.id === active?.id;
          return (
            <div
              key={s.id}
              className={`space-y-2 rounded-control border p-2 transition-colors ${
                isActive
                  ? 'border-accent bg-accent/5 ring-1 ring-accent/20'
                  : 'border-border-subtle bg-surface hover:border-border-default'
              }`}
            >
              <button
                type="button"
                aria-pressed={isActive}
                className="flex w-full min-w-0 items-start gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-accent"
                onClick={() => {
                  setSelected(s.id);
                }}
              >
                <span className="font-mono text-xs font-semibold text-accent shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="h-10 w-12 shrink-0 overflow-hidden rounded-control bg-surface-muted border border-border-subtle">
                  <PublicationThumbnail
                    artifactId={s.selectedImage?.artifactId}
                    alt=""
                    className="h-full w-full object-cover"
                    fallbackText="无图"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-sm font-medium text-ink" title={s.visualDescription || '未填写画面'}>{s.visualDescription || '未填写画面'}</p>
                  <p className="mt-1 whitespace-nowrap text-xs text-muted">{s.utterances.length} 句对白</p>
                </div>
              </button>

              <div role="group" aria-label={`镜头${i + 1}操作`} className="flex items-center justify-end gap-1 border-t border-border-subtle pt-1 text-xs">
                <button
                  type="button"
                  aria-label={`镜头${i + 1}上移`}
                  disabled={i === 0}
                  onClick={() => reorder(i, -1)}
                  className="rounded p-1 text-muted hover:text-ink hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`镜头${i + 1}下移`}
                  disabled={i === doc.shots.length - 1}
                  onClick={() => reorder(i, 1)}
                  className="rounded p-1 text-muted hover:text-ink hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`删除镜头${i + 1}`}
                  onClick={() => {
                    if (window.confirm('删除此制作镜头？历史图片仍保留。')) {
                      draft.update({ ...doc, shots: doc.shots.filter((x) => x.id !== s.id) });
                    }
                  }}
                  className="rounded p-1 text-muted hover:text-danger-fg hover:bg-danger/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2"
        disabled={doc.shots.length >= 12}
        onClick={addShot}
      >
        添加关键镜头
      </Button>
    </div>
  );
  return <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-paper text-ink" data-testid="publication-workspace">
    <WorkspaceHeader title={doc.title} backHref={`/apps/projects/${doc.source.storyProjectId}`} backLabel="来源项目" status={savedStatus}
      centerSlotOnMobile
      centerSlot={<PageTabs variant="local" ariaLabel="作品制作步骤" value={tab} onChange={value => setTab(value as typeof tab)} tabs={[
        {id:'plan',label:'1. 制作方案'}, {id:'media',label:'2. 画面与配音'}, {id:'export',label:'3. 预览与导出'},
      ]} />}
      actions={<><Button size="sm" variant="ghost" onClick={()=>setOverlay('bridge')}>AI 协作</Button><Button size="sm" variant="primary" disabled={busy} onClick={()=>void draft.flush()}>保存</Button></>}/>
    {(error||draft.error)&&<div role="alert" className="shrink-0 space-y-2 bg-danger/10 p-3 text-sm text-danger-fg"><p>{error||draft.error}</p>{draft.error&&<div className="flex flex-wrap gap-2"><Button size="sm" onClick={()=>void navigator.clipboard.writeText(JSON.stringify(doc,null,2))}>复制本地内容</Button><Button size="sm" onClick={()=>void action(async()=>{const server=await publicationApi.draft(activityId);if(window.confirm('使用服务器版本会放弃本地输入，请先复制备份。继续？'))draft.resolve(server,false);},false)}>查看并使用服务器版本</Button><Button size="sm" onClick={()=>void action(async()=>{const server=await publicationApi.draft(activityId);if(window.confirm('已核对服务器更新，仍以本地内容重新保存？'))draft.resolve(server,true);},false)}>手动恢复本地编辑</Button></div>}</div>}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row">
      <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface md:block" aria-label="关键镜头列表">{shotList}</aside>
      <div className="shrink-0 border-b border-border-subtle p-2 md:hidden"><Select aria-label="选择关键镜头" value={active?.id??''} onChange={e=>setSelected(e.target.value)}>{doc.shots.map((s,i)=><option key={s.id} value={s.id}>{i+1}. {s.visualDescription||'未填写'}</option>)}</Select><details><summary className="cursor-pointer py-2 text-sm">管理关键镜头</summary><div className="max-h-56 overflow-y-auto">{shotList}</div></details></div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      {tab==='plan'?<section className="mx-auto h-full max-w-5xl overflow-y-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle pb-4"><div><p className="text-xs font-medium text-accent">从剧情到发布</p><h2 className="mt-1 text-xl font-semibold text-ink">少量关键画面，完整讲一段故事</h2><p className="mt-1.5 text-xs text-muted">已冻结 {doc.source.entryRevisionIds.length} 个章节版本 · {doc.shots.length}/12 个镜头 · 不改变正式剧情</p></div><Button variant="outline" size="sm" onClick={()=>{setEditDoc(structuredClone(doc));setOverlay('project');}}>编辑作品与角色</Button></div>
        <div className="rounded-panel border border-border-default bg-surface p-4 text-sm leading-relaxed text-ink/90">{doc.synopsis||'让 DSH／其他 Harness 读取冻结章节，提交 6–12 个关键镜头。每个画面可配多句对白；英文生图提示词由创作模型一次完成，制作服务不再改写。也可以手动添加镜头。'}</div>
        <div><div className="space-y-4 rounded-panel border border-border-default bg-surface p-4">
          <h3 className="font-semibold text-sm text-ink">制作输出设置</h3><label className="flex items-center gap-2 text-sm text-ink cursor-pointer"><input type="checkbox" checked={makeVideo} onChange={e=>setMakeVideo(e.target.checked)} className="rounded border-border-control text-accent focus:ring-accent"/><span>漫画图片＋配音视频</span></label><p className="text-xs leading-5 text-muted">关闭视频仍会导出漫画、封面和发布文案。默认无背景音乐，不自动发布平台。</p>
          <div className={fieldClass}><label className="block text-xs font-medium text-muted">独立配音配置<Select value={speechId} onChange={e=>setSpeechId(e.target.value)} className="mt-1"><option value="">未配置／使用上传配音</option>{profiles.data?.items.map(p=><option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</Select></label>{profiles.isError?<div className="space-y-2 mt-1"><p role="alert" className="text-xs text-danger-fg">无法读取已保存的配音配置，可重试或直接使用上传配音。</p><Button variant="ghost" size="sm" onClick={()=>void profiles.refetch()}>重试读取配音配置</Button></div>:!profiles.isLoading&&!profiles.data?.items.length?<p className="text-xs text-muted mt-1">还没有保存的配音配置，可直接上传配音，或配置新的配音服务。</p>:null}</div>
          <Button variant="ghost" size="sm" onClick={()=>{setSpeechEdit(profiles.data?.items.find(p=>p.id===speechId)??{id:crypto.randomUUID(),revision:1,name:'在线配音',baseUrl:'',model:'',voices:['alloy'],defaultVoice:'alloy',speed:1,secretEnvironment:'STHSTART_SPEECH_API_KEY'});setOverlay('speech');}}>配置配音服务</Button>
          <div className="border-t border-border-subtle pt-3 space-y-2"><Button variant="primary" className="w-full" disabled={busy||doc.shots.length<6} onClick={()=>void openApproval()}>核对方案与额度</Button><p className="text-xs text-muted text-center">确认前不会发出生图或配音付费请求。</p></div>
        </div></div>
      </section>:tab==='media'?<div className="flex h-full min-h-0 min-w-0 flex-col md:flex-row">
        <section aria-label="画面与对白工作区" className="min-h-0 min-w-0 flex-1 overflow-y-auto min-[1440px]:overflow-hidden">
          {!active?<div className="rounded-panel border border-border-default bg-surface p-8 text-center space-y-3"><p className="text-sm text-muted">先准备关键镜头。</p><Button variant="outline" onClick={()=>setTab('plan')}>回到制作方案</Button></div>:<div className="grid min-h-0 min-w-0 grid-cols-1 min-[1440px]:h-full min-[1440px]:grid-cols-2"><section aria-label="镜头画面与描述" className="min-h-0 min-w-0 space-y-5 p-4 min-[1440px]:overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3"><h2 className="font-semibold text-ink text-base">镜头 {doc.shots.indexOf(active)+1} · {active.utterances.length} 句对白</h2><Button variant="outline" size="sm" onClick={()=>{setEditShot(structuredClone(active));setOverlay('drawing');}}>绘制设置</Button></div>
            <MainShotViewport shot={active} />
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={busy||!run} onClick={()=>void action(async()=>{actionKey.current??=crypto.randomUUID();await publicationApi.retry(activityId,active.id,run!.id,actionKey.current);actionKey.current=null;})}>按批准配置重绘</Button>{run&&<span className="text-xs text-muted">{labels[run.status]} · 已用 {run.imagesUsed} 张额度</span>}</div></div>
            <div className="space-y-2"><span className="text-xs font-medium text-muted">绘制历史与候选</span><div className="flex gap-2.5 overflow-x-auto pb-2" aria-label="绘制历史">{history.data?.items.map(i=><button key={`${i.taskId}:${i.artifactId}`} disabled={!i.available||busy} onClick={()=>void chooseImage(i.artifactId)} className={`shrink-0 rounded-control p-1 text-left transition-all border ${i.current?'border-accent ring-2 ring-accent/30 bg-accent/5':'border-border-default bg-surface hover:border-border-strong'}`}><div className="h-16 w-24 overflow-hidden rounded-control"><PublicationThumbnail artifactId={i.artifactId} alt="历史绘制图片" className="h-full w-full object-cover" fallbackText="文件不可用"/></div><span className={`text-[11px] font-medium ${i.current?'text-accent':'text-muted'}`}>{i.current?'当前采用':'历史候选'}</span></button>)}</div></div>
            <label className={fieldClass}><span className="font-medium text-ink">画面描述</span><Textarea value={active.visualDescription} rows={3} onChange={e=>changeShot({...active,visualDescription:e.target.value})}/><span className="block text-xs text-muted">修改画面含义后，请同时在绘制设置中更新英文提示词，再重新确认制作。</span></label>
            </section><section aria-label="对白与配音编辑" className="min-h-0 min-w-0 space-y-3 border-t border-border-subtle p-4 min-[1440px]:overflow-y-auto min-[1440px]:border-l min-[1440px]:border-t-0"><div className="flex items-center justify-between"><h3 className="font-semibold text-sm text-ink">对白与配音</h3><span className="text-xs text-muted">{active.utterances.length}/12 句</span></div>{active.utterances.map((u,i)=><div key={u.id} className="space-y-3 rounded-panel border border-border-default bg-surface p-4"><div className="flex flex-wrap items-center justify-between gap-2"><Select aria-label={`第${i+1}句发言人`} value={u.speakerActorId??''} onChange={e=>changeShot({...active,utterances:active.utterances.map(x=>x.id===u.id?{...x,speakerActorId:e.target.value||null}:x)})} className="!w-48"><option value="">旁白</option>{doc.actors.filter(a=>active.actorIds.includes(a.id)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select><Button variant="ghost" size="sm" onClick={()=>changeShot({...active,utterances:active.utterances.filter(x=>x.id!==u.id)})} className="text-muted hover:text-danger-fg">删除此句</Button></div>
              <Textarea aria-label={`第${i+1}句对白`} value={u.text} rows={2} onChange={e=>changeShot({...active,utterances:active.utterances.map(x=>x.id===u.id?{...x,text:e.target.value}:x)})}/>
              {u.selectedAudioArtifactId&&<div className="rounded-control bg-surface-muted p-2"><audio controls preload="none" src={publicationFile(u.selectedAudioArtifactId)} className="w-full h-8"/></div>}
              <div className="flex flex-wrap items-center gap-3 pt-1"><PublicationAudioHistory activityId={activityId} utteranceId={u.id} refreshKey={`${run?.updatedAt}:${u.selectedAudioArtifactId}:${u.text}`} disabled={busy} onSelect={id=>void action(async()=>{try{draft.accept(await publicationApi.audio(activityId,u.id,draft.version(),id));}catch(e){if(!(e instanceof ApiClientError)||e.code!=='publication_source_changed'||!window.confirm('对白或声音已经变化，仍使用这份旧配音吗？'))throw e;draft.accept(await publicationApi.audio(activityId,u.id,draft.version(),id,true));}})}/>
              <label className="relative inline-flex cursor-pointer rounded-control border border-border-default bg-surface px-3 py-1.5 text-xs text-ink hover:bg-surface-hover transition-colors">{u.selectedAudioArtifactId?'替换已有配音':'上传本地配音'}<input type="file" className="sr-only" accept=".wav,.mp3,.m4a" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void action(async()=>{const uploaded=await publicationApi.uploadAudio(activityId,u.id,f);draft.accept(await publicationApi.audio(activityId,u.id,draft.version(),uploaded.artifactId));});e.target.value='';}}/></label>
              <span className="text-xs text-muted">改句子后仅本句音频失效；重新确认即可只补缺失配音。</span></div>
            </div>)}<Button variant="outline" size="sm" disabled={active.utterances.length>=12} onClick={()=>changeShot({...active,utterances:[...active.utterances,{id:crypto.randomUUID(),speakerActorId:null,text:'新对白',voiceBindingId:null,selectedAudioArtifactId:null}]})}>添加一句对白</Button></section>
          </div>}
        </section>
      </div>:<section className="h-full overflow-y-auto p-4 sm:p-6"><div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"><PublicationComicPreview document={doc}/><div className="space-y-5"><div className="rounded-panel border border-border-default bg-surface p-5 space-y-3"><h2 className="font-semibold text-sm text-ink">发布前检查</h2><p className="text-xs leading-relaxed text-muted">漫画卡片：最多三句一张，长对白会提示溢出。视频按真实配音时长显示字幕。最终画面、读音和平台文案由你审核。</p><Button variant="outline" size="sm" onClick={()=>{setEditDoc(structuredClone(doc));setOverlay('project');}}>编辑发布文案</Button><Button variant="primary" disabled={busy} className="w-full" onClick={()=>void action(async()=>{actionKey.current??=crypto.randomUUID();await publicationApi.exports(activityId,draft.version(),makeVideo,actionKey.current);actionKey.current=null;})}>导出{makeVideo?'视频＋':' '}漫画发布包</Button></div>
        {runs.data?.items.map(r=><div key={r.id} className="space-y-3 rounded-panel border border-border-default bg-surface p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-ink">{labels[r.status]}</h3>{['running','queued'].includes(r.status)&&<Button size="sm" variant="outline" onClick={()=>void action(()=>publicationApi.stop(activityId,r.id),false)}>停止</Button>}</div><p className="text-xs text-muted">图片调用 {r.imagesUsed} · 配音 {r.speechCharactersUsed} 字</p>{r.tasks.filter(t=>t.kind==='export'&&t.status==='succeeded').map(t=><div key={t.id} className="space-y-3"><div className="flex flex-wrap gap-3">{t.artifactIds.map((id,i)=><a key={id} href={publicationFile(id)} download className="text-sm font-medium text-accent hover:underline">{i===0?'发布 ZIP':i===1?'封面 PNG':'视频 MP4'}</a>)}{t.artifactIds[2]&&<video controls preload="metadata" src={publicationFile(t.artifactIds[2])} className="w-full max-h-80 rounded-control border border-border-subtle"/>}</div></div>)}<details className="text-xs"><summary className="cursor-pointer text-muted hover:text-ink">调用与错误记录（{r.tasks.length}）</summary><div className="mt-3 space-y-2 border-t border-border-subtle pt-2">{r.tasks.map(t=><div key={t.id} className="space-y-0.5"><p className="text-ink">{t.kind==='image'?'绘图':t.kind==='speech'?'配音':'导出'} · {labels[t.status]}</p>{t.error&&<p className="text-danger-fg">{t.error}</p>}{t.callId&&<Link href={`/settings/ai-logs?callId=${t.callId}`} className="text-accent hover:underline">查看调用日志</Link>}</div>)}</div></details></div>)}
        </div></div></section>}
    </div>
    </div>
    <ResponsiveEditOverlay open={overlay==='drawing'} onOpenChange={closeOverlay} title="绘制设置" description="英文提示词由创作模型生成；这里只编译并追加固定画风与 LoRA。"
      footer={<><Button disabled={busy} onClick={()=>closeOverlay(false)}>取消</Button><Button variant="primary" disabled={busy} onClick={()=>void action(async()=>{if(editShot){changeShot(editShot);if(await draft.flush())setOverlay(null);}},false)}>保存镜头设置</Button></>}>
      {(error||draft.error)&&<p role="alert" className="text-sm text-danger-fg">{error||draft.error}</p>}
      {editShot&&<div className="space-y-5"><label className={fieldClass}>工作流／预设<Select value={editShot.renderSettings.presetId??''} onChange={e=>{const p=options.data?.presets.find(p=>p.id===e.target.value);setEditShot({...editShot,renderSettings:{...editShot.renderSettings,presetId:p?.id,presetRevision:p?.revision,workflowId:p?.workflowId,workflowVersion:p?.workflowVersion}});}}><option value="">优先邻舍对齐 · Base（未选预设时）</option>{options.data?.presets.map(p=><option key={p.id} value={p.id}>{p.name} · v{p.workflowVersion}</option>)}</Select><span className="block text-xs text-muted">未手选预设时，服务会优先对齐邻舍对齐 · Base；实际结果以「核对方案」和服务端最终配置为准。</span></label>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm">本镜头出现的角色</legend>{doc.actors.map(a=><label key={a.id} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={editShot.actorIds.includes(a.id)} onChange={e=>{const ids=e.target.checked?[...editShot.actorIds,a.id]:editShot.actorIds.filter(id=>id!==a.id);setEditShot({...editShot,actorIds:ids,structuredPrompt:{...editShot.structuredPrompt,actors:ids.map(id=>editShot.structuredPrompt.actors.find(p=>p.actorId===id)??{actorId:id,identity:[doc.actors.find(a=>a.id===id)!.name],appearance:[],clothing:[],action:[],expression:[]})}});}}/>{a.name} {a.universe&&`· ${a.universe}`}</label>)}</fieldset>
        <label className={fieldClass}>英文画面提示词<Textarea rows={5} value={editShot.structuredPrompt.naturalLanguage} onChange={e=>setEditShot({...editShot,structuredPrompt:{...editShot.structuredPrompt,naturalLanguage:e.target.value}})}/></label>
        <label className={fieldClass}>英文场景标签（逗号分隔）<Input value={editShot.structuredPrompt.scene.join(', ')} onChange={e=>setEditShot({...editShot,structuredPrompt:{...editShot.structuredPrompt,scene:e.target.value.split(',').map(t=>t.trim()).filter(Boolean)}})}/></label>
        <label className={fieldClass}>镜头呈现<Select value={editShot.presentation} onChange={e=>setEditShot({...editShot,presentation:e.target.value as PublicationShot['presentation']})}><option value="still">静态画面</option><option value="push_in">轻微推近</option></Select></label>
        <details><summary className="text-sm cursor-pointer">高级：尺寸、负向词与镜头 LoRA</summary><div className="mt-4 space-y-4"><div className="grid grid-cols-2 gap-4">{(['width','height'] as const).map(key=><label key={key} className={fieldClass}>{key==='width'?'宽度':'高度'}<Input type="number" min={256} max={2048} step={64} value={Number(editShot.renderSettings.parameters?.[key]??(key==='width'?768:1024))} onChange={e=>setEditShot({...editShot,renderSettings:{...editShot.renderSettings,parameters:{...editShot.renderSettings.parameters,[key]:Number(e.target.value)}}})}/></label>)}</div><label className={fieldClass}>反向提示词<Textarea value={editShot.renderSettings.negativePrompt??''} onChange={e=>setEditShot({...editShot,renderSettings:{...editShot.renderSettings,negativePrompt:e.target.value||undefined}})}/></label><LoraFields entries={(editShot.renderSettings.loraOverrides??[]).map(l=>({model:l.model,strength:l.strength??1,triggerWord:l.triggerWord??'',enabled:l.enabled??true}))} onChange={loras=>setEditShot({...editShot,renderSettings:{...editShot.renderSettings,loraOverrides:loras}})}/><Link href="/settings/generation" className="text-sm text-accent">全局画风与工作流设置</Link></div></details>
      </div>}
    </ResponsiveEditOverlay>
    <ResponsiveEditOverlay open={overlay==='project'} onOpenChange={closeOverlay} title="作品与角色资料" description="设置仅属于这份作品，不回写正式剧情。"
      footer={<><Button disabled={busy} onClick={()=>closeOverlay(false)}>取消</Button><Button variant="primary" disabled={busy} onClick={()=>void action(async()=>{if(editDoc){draft.update(editDoc);if(await draft.flush())setOverlay(null);}},false)}>保存资料</Button></>}>
      {(error||draft.error)&&<p role="alert" className="text-sm text-danger-fg">{error||draft.error}</p>}
      {editDoc&&<div className="space-y-5"><label className={fieldClass}>作品标题<Input value={editDoc.title} onChange={e=>setEditDoc({...editDoc,title:e.target.value})}/></label><label className={fieldClass}>故事摘要<Textarea value={editDoc.synopsis} onChange={e=>setEditDoc({...editDoc,synopsis:e.target.value})}/></label><label className={fieldClass}>输出方向<Select value={editDoc.orientation} onChange={e=>setEditDoc({...editDoc,orientation:e.target.value as PublicationDocument['orientation']})}><option value="portrait">竖屏优先</option><option value="landscape">横屏</option></Select></label>
        <h3 className="font-semibold">角色视觉与声音</h3>{editDoc.actors.map(a=><details key={a.id} className="rounded-xl bg-surface-muted p-4"><summary className="cursor-pointer text-sm">{a.name} · {a.universe||'作品来源未填写'}</summary><div className="mt-4 space-y-4"><label className={fieldClass}>角色名称<Input value={a.name} onChange={e=>setEditDoc({...editDoc,actors:editDoc.actors.map(x=>x.id===a.id?{...x,name:e.target.value}:x)})}/></label><label className={fieldClass}>所属游戏／世界<Input value={a.universe} onChange={e=>setEditDoc({...editDoc,actors:editDoc.actors.map(x=>x.id===a.id?{...x,universe:e.target.value}:x)})}/></label><label className={fieldClass}>视觉快照<Textarea value={a.visualDescription} onChange={e=>setEditDoc({...editDoc,actors:editDoc.actors.map(x=>x.id===a.id?{...x,visualDescription:e.target.value}:x)})}/></label><label className={fieldClass}>配音 voice ID（留空用默认）<Input value={a.voiceBindingId??''} onChange={e=>setEditDoc({...editDoc,actors:editDoc.actors.map(x=>x.id===a.id?{...x,voiceBindingId:e.target.value||null}:x)})}/></label><LoraFields entries={a.loras} onChange={loras=>setEditDoc({...editDoc,actors:editDoc.actors.map(x=>x.id===a.id?{...x,loras}:x)})}/></div></details>)}
        <Button onClick={()=>setEditDoc({...editDoc,actors:[...editDoc.actors,{id:crypto.randomUUID(),name:'新角色',universe:'',entryRevisionId:null,visualDescription:'',characterId:null,loras:[],referenceArtifactId:null,voiceBindingId:null}]})}>添加作品角色</Button>
        <label className={fieldClass}>发布标题<Input value={editDoc.publishingCopy.title} onChange={e=>setEditDoc({...editDoc,publishingCopy:{...editDoc.publishingCopy,title:e.target.value}})}/></label><label className={fieldClass}>发布介绍<Textarea value={editDoc.publishingCopy.description} onChange={e=>setEditDoc({...editDoc,publishingCopy:{...editDoc.publishingCopy,description:e.target.value}})}/></label><label className={fieldClass}>话题标签（逗号分隔）<Input value={editDoc.publishingCopy.tags.join(', ')} onChange={e=>setEditDoc({...editDoc,publishingCopy:{...editDoc.publishingCopy,tags:e.target.value.split(',').map(t=>t.trim()).filter(Boolean)}})}/></label></div>}
    </ResponsiveEditOverlay>
    <ResponsiveEditOverlay open={overlay==='approve'} onOpenChange={closeOverlay} title="确认本轮制作" description="确认冻结方案、实际配置和费用上限后开始；未知结果仍占额度。"
      footer={<><Button onClick={()=>closeOverlay(false)}>返回修改</Button><Button variant="primary" disabled={busy} onClick={()=>void confirmApproval()}>确认并开始制作</Button></>}>
      <div className="space-y-5"><p className="text-sm">{doc.shots.length} 个关键画面 · {makeVideo?'漫画＋配音视频':'漫画图片'} · {doc.orientation==='portrait'?'竖屏':'横屏'}</p><label className={fieldClass}>本轮图片调用额度<Input type="number" min={doc.shots.length} max={doc.shots.length+3} value={budget} onChange={e=>setBudget(Number(e.target.value))}/></label><p className="text-sm text-muted">配音额度：{makeVideo?doc.shots.flatMap(s=>s.utterances).filter(u=>!u.selectedAudioArtifactId).reduce((n,u)=>n+u.text.length,0):0} 字。已有可用配音直接复用。服务商单价由你确认，本项目不估算货币金额。</p>{preview?.shots.map((p,i)=><details key={p.shotId} className="rounded-xl bg-surface-muted p-3"><summary className="cursor-pointer text-sm">镜头 {i+1} · {p.workflowId} v{p.workflowVersion} · {p.models.join(' / ')}</summary><div className="mt-3 space-y-2 text-xs"><p className="whitespace-pre-wrap break-words">{p.positivePrompt}</p><p className="text-muted">负向：{p.negativePrompt||'无'}</p><p>LoRA：{p.loras.filter(l=>l.enabled).map(l=>`${l.model} (${l.strength})`).join('、')||'未启用'} · 参考图 {p.referenceArtifactIds.length}</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(p.parameters,null,2)}</pre></div></details>)}{error&&<p role="alert" className="text-danger-fg text-sm">{error}</p>}{pendingApprovalRequest&&error&&<Button onClick={()=>void action(()=>publicationApi.start(activityId,pendingApprovalRequest.approvalId,pendingApprovalRequest.key),false)}>查询／重发同一次启动</Button>}</div>
    </ResponsiveEditOverlay>
    <ResponsiveEditOverlay open={overlay==='bridge'} onOpenChange={closeOverlay} title="制作 AI 协作" description="独立凭据只能读制作来源、编辑制作方案和运行人工批准的额度；不能改正式剧情或批准费用。">
      <div className="space-y-4 text-sm"><p>在现有 DSH 中额外加载制作 MCP，或交给支持标准 MCP 的其他 Harness。旧剧情 MCP 的权限不变。</p><p className="break-all">作品 ID：{activityId}<br/>剧情项目 ID：{doc.source.storyProjectId}</p><Button disabled={busy} onClick={()=>void action(async()=>{if(!window.confirm('生成新的独立制作凭据？旧制作凭据将立即失效；不会更改旧剧情桥接。'))return;const grant=await publicationApi.grant(doc.source.storyProjectId);setGrantToken(grant.token);},false)}>生成独立制作凭据</Button><Button variant="ghost" disabled={busy} onClick={()=>void action(()=>publicationApi.revoke(doc.source.storyProjectId),false)}>撤销制作权限</Button>
        {grantToken&&<div className="space-y-2 rounded-xl bg-surface-muted p-4"><p>凭据只显示这一次。通过下面启动器交互粘贴，不放进命令行、模型聊天或配置文件。</p><Input readOnly type="password" value={grantToken} aria-label="一次性制作凭据"/><Button onClick={()=>void navigator.clipboard.writeText(grantToken)}>复制凭据</Button></div>}
        <code className="block overflow-x-auto rounded-xl bg-surface-muted p-3 text-xs">.\scripts\story-dsh\start.ps1 -ProjectId {doc.source.storyProjectId} -PortalUrl http://127.0.0.1:9320 -PairPublication</code>
        <Textarea readOnly rows={5} aria-label="交给创作模型的指令" value={`使用制作 MCP，读取作品 ${activityId} 的冻结章节，为1–3分钟故事规划6–12个关键画面。每格一个主要动作、多句对白，提供StructuredVisualPrompt英文提示词；画面不画文字。通过propose_publication_plan提交后等待我在SthStart批准，再start_approved_run。unknown结果不要自动重试。`}/><p className="text-muted">启动器与凭据说明见项目 docs/STORY_PUBLICATION.md。</p>
      </div>
    </ResponsiveEditOverlay>
    <ResponsiveEditOverlay open={overlay==='speech'} onOpenChange={closeOverlay} title="在线配音配置" description="通过 /audio/speech 配音；可复用公共服务中已配置的语音模型连接，不保存密钥明文。"
      footer={<><Button onClick={()=>closeOverlay(false)}>取消</Button><Button variant="primary" disabled={busy||!speechEdit} onClick={()=>void action(async()=>{const p=speechEdit!;await publicationApi.saveProfile(profiles.data?.items.find(x=>x.id===p.id)?.revision??0,p);setSpeechId(p.id);setOverlay(null);},false)}>保存配音配置</Button></>}>
      {speechEdit&&<div className="space-y-4"><label className={fieldClass}>从已配置的语音模型选择<Select value={speechModels.data?.items.find(m=>m.connectionId===speechEdit.connectionId&&m.model===speechEdit.model)?.modelProfileId??''} onChange={e=>{const m=speechModels.data?.items.find(m=>m.modelProfileId===e.target.value);if(m)setSpeechEdit({...speechEdit,name:m.name,connectionId:m.connectionId,baseUrl:m.baseUrl,model:m.model,defaultVoice:m.model.startsWith('stepaudio-')?'cixingnansheng':speechEdit.defaultVoice,voices:m.model.startsWith('stepaudio-')?['cixingnansheng']:speechEdit.voices});else{const {connectionId:_ignored,...manual}=speechEdit;setSpeechEdit(manual);}}}><option value="">单独配置配音服务</option>{speechModels.data?.items.map(m=><option key={m.modelProfileId} value={m.modelProfileId}>{m.name}{!m.hasCredential?'（缺密钥）':''}</option>)}</Select></label>{speechModels.isError&&<p role="alert" className="text-sm text-danger-fg">无法读取已配置模型，请重试或使用独立配置。</p>}{(['name','baseUrl','model','defaultVoice','secretEnvironment'] as const).filter(key=>!speechEdit.connectionId||key!=='secretEnvironment').map(key=><label key={key} className={fieldClass}>{{name:'配置名称',baseUrl:'兼容 API 根地址（例如 https://…/v1）',model:'语音模型 ID',defaultVoice:'默认声音 ID',secretEnvironment:'密钥环境变量名'}[key]}<Input readOnly={Boolean(speechEdit.connectionId)&&(key==='baseUrl'||key==='model')} value={speechEdit[key]} onChange={e=>setSpeechEdit({...speechEdit,[key]:e.target.value})}/></label>)}<label className={fieldClass}>声音清单（逗号分隔）<Input value={speechEdit.voices.join(', ')} onChange={e=>setSpeechEdit({...speechEdit,voices:e.target.value.split(',').map(v=>v.trim()).filter(Boolean)})}/></label><label className={fieldClass}>语速<Input type="number" min={0.5} max={2} step={0.1} value={speechEdit.speed} onChange={e=>setSpeechEdit({...speechEdit,speed:Number(e.target.value)})}/></label><p className="text-xs text-muted">{speechEdit.connectionId?'复用所选服务连接的加密凭据，无需再输入密钥；连接停用或地址改变会阻止配音。':`在服务运行环境配置上述密钥变量，或写入系统凭据 publication-speech:${speechEdit.id}。`}不会向 DSH 注入这个密钥。</p></div>}
      {(error||draft.error)&&<p role="alert" className="text-sm text-danger-fg">{error||draft.error}</p>}
    </ResponsiveEditOverlay>
  </main>;
}

function LoraFields({entries,onChange}:{entries:ActivityLora[];onChange:(entries:ActivityLora[])=>void}) {
  return <div className="space-y-3"><p className="text-sm font-medium">LoRA 文件与触发词</p>{entries.map((l,i)=><div key={i} className="grid gap-2 rounded-xl bg-surface-muted p-3 sm:grid-cols-2"><Input aria-label={`LoRA ${i+1} 文件名`} placeholder="models/loras 中的文件名" value={l.model} onChange={e=>onChange(entries.map((x,j)=>j===i?{...x,model:e.target.value}:x))}/><Input aria-label={`LoRA ${i+1} 强度`} type="number" min={-10} max={10} step={0.1} value={l.strength} onChange={e=>onChange(entries.map((x,j)=>j===i?{...x,strength:Number(e.target.value)}:x))}/><Input aria-label={`LoRA ${i+1} 触发词`} value={l.triggerWord} placeholder="英文触发词" onChange={e=>onChange(entries.map((x,j)=>j===i?{...x,triggerWord:e.target.value}:x))}/><div className="flex items-center justify-between"><label className="text-xs"><input type="checkbox" checked={l.enabled} onChange={e=>onChange(entries.map((x,j)=>j===i?{...x,enabled:e.target.checked}:x))}/>启用</label><Button variant="ghost" size="sm" onClick={()=>onChange(entries.filter((_,j)=>j!==i))}>删除</Button></div></div>)}<Button size="sm" onClick={()=>onChange([...entries,{model:'',strength:1,triggerWord:'',enabled:true}])}>添加／覆盖 LoRA</Button><p className="text-xs text-muted">继承全局配置，同名后一级覆盖；文件或节点缺失会阻止提交。</p></div>;
}
