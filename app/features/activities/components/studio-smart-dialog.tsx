'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Value } from '@sinclair/typebox/value';
import { StudioStoryboardRequestSchema, type ContentDocument, type StudioJob, type StudioStoryboardRequest } from '@sthstart/contracts';
import { storyApi } from '@/app/features/story/api';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { FormField } from '@/app/components/ui/form-field';
import { useStudioJob, useStudioJobs } from '../studio-queries';
import { useStudioJobMutations } from '../studio-mutations';
import { getEffectiveStageScenes } from '../scene-beat-utils';
import { StudioProposalReview, studioStatusLabels } from './studio-proposal-review';
import { StudioRefinePanel } from './studio-refine-panel';
import { StudioBatchPanel } from './studio-batch-panel';

const selectClass = 'h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 text-sm';
export function StudioSmartDialog({ activityId, content, open, stageId, sceneId, beatId, panelId, jobId, onClose, onSelectJob, beforeAction, onApplied }: {
  activityId: string; content: ContentDocument; open: boolean; stageId?: string; sceneId?: string; beatId?:string;panelId?:string; jobId: string | null;
  onClose(): void; onSelectJob(id: string | null): void; beforeAction(): Promise<boolean>; onApplied(job: StudioJob): Promise<void>;
}) {
  const [input, setInput] = useState<StudioStoryboardRequest['input'] | null>(null);
  const [mode,setMode]=useState<'storyboard'|'refine'|'render_batch'>('storyboard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [countText, setCountText] = useState('6');
  const [projectId, setProjectId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const initialized = useRef(false);
  const pending = useRef<StudioStoryboardRequest | null>(null);
  const recoveryKey = `sthstart:studio-storyboard:${activityId}`;
  const jobs = useStudioJobs(activityId, open);
  const selected = useStudioJob(activityId, jobId, open);
  const operations = useStudioJobMutations(activityId);
  const projects = useQuery({ queryKey: ['studio-source-projects'], queryFn: storyApi.listProjects,
    enabled: open && input?.source.kind === 'story_chapter' });
  const chapters = useQuery({ queryKey: ['studio-source-chapters', projectId], queryFn: () => storyApi.listDocuments(projectId),
    enabled: open && input?.source.kind === 'story_chapter' && Boolean(projectId) });
  const revisions = useQuery({ queryKey: ['studio-source-revisions', projectId, chapterId],
    queryFn: () => storyApi.listRevisions(projectId, 'chapter', chapterId),
    enabled: open && input?.source.kind === 'story_chapter' && Boolean(projectId && chapterId) });

  useEffect(() => {
    if (!open || initialized.current) return;
    initialized.current = true;
    let defaults: StudioStoryboardRequest['input'] = { source: { kind: 'text', text: '' }, actorIds: content.actors.slice(0, 8).map(actor => actor.id),
      output: 'beats', count: 6, stageId: stageId ?? content.stages[0]?.id ?? '', sceneId: sceneId ?? null, instructions: '' };
    try {
      const recovery = JSON.parse(sessionStorage.getItem(recoveryKey) ?? 'null');
      if (recovery?.input) {
        // Incomplete/oversized local form text is still recoverable. Only the normalized copy is schema-checked;
        // the original value stays visible and is validated again before any server request.
        const probe = structuredClone(recovery.input);
        if (probe.source?.kind === 'text' && typeof probe.source.text === 'string') probe.source.text = probe.source.text.slice(0, 12000) || ' ';
        if (probe.source?.kind === 'story_chapter') for (const key of ['projectId', 'chapterId', 'revisionId']) {
          if (typeof probe.source[key] === 'string' && !probe.source[key]) probe.source[key] = 'unfinished-local-choice';
        }
        if (probe.source?.kind === 'scene') for (const key of ['contentRevisionId', 'sceneId']) {
          if (typeof probe.source[key] === 'string' && !probe.source[key]) probe.source[key] = 'unfinished-local-choice';
        }
        if (typeof probe.instructions === 'string') probe.instructions = probe.instructions.slice(0, 2000);
        if (typeof probe.count === 'number' && Number.isInteger(probe.count)) probe.count = Math.max(2, Math.min(12, probe.count));
        if (Value.Check(StudioStoryboardRequestSchema.properties.input, probe)) defaults = recovery.input;
      }
      if (recovery && Value.Check(StudioStoryboardRequestSchema, recovery.pending)) pending.current = recovery.pending;
    } catch { /* Optional local recovery never replaces a server document. */ }
    setInput(defaults); setCountText(String(defaults.count));
    if (defaults.source.kind === 'story_chapter') { setProjectId(defaults.source.projectId); setChapterId(defaults.source.chapterId); }
  }, [open, recoveryKey, content, stageId, sceneId]);
  // Persist unfinished text separately from formal content. Retain the exact request/key if a network response is lost.
  const persist = (value: StudioStoryboardRequest['input'], request = pending.current) => {
    try { sessionStorage.setItem(recoveryKey, JSON.stringify({ input: value, pending: request })); } catch { /* quota is non-fatal */ }
  };
  const update = (patch: Partial<StudioStoryboardRequest['input']>) => {
    if (!input || busy) return;
    const value = { ...input, ...patch }; pending.current = null; setInput(value); persist(value, null); setError('');
  };
  const create = async () => {
    if (!input || busy) return;
    setBusy(true); setError('');
    try {
      const count = Number(countText);
      if (!/^\d+$/.test(countText) || !Number.isInteger(count) || count < (input.output === 'comic' ? 4 : 2) || count > (input.output === 'comic' ? 8 : 12))
        throw new Error(input.output === 'comic' ? '漫画画格数需为 4–8。' : '镜头数需为 2–12。');
      if (input.source.kind === 'text' && input.source.text.length > 12000) throw new Error('正文超过 12000 字，请自行分段；输入仍保留。');
      if (!await beforeAction()) throw new Error('当前编辑输入尚未保存；请先处理保存状态。');
      let request = pending.current;
      if (!request) {
        const versions = await operations.prepare.mutateAsync();
        if (input.source.kind === 'scene' && (!versions.contentRevisionId || !input.sceneId)) throw new Error('请选择已提交内容版本中的来源场次。');
        request = { kind: 'storyboard', versions, input: { ...input, count,
          source: input.source.kind === 'scene' ? { kind: 'scene', contentRevisionId: versions.contentRevisionId!, stageId: input.stageId, sceneId: input.sceneId! } : input.source },
          idempotencyKey: crypto.randomUUID() };
      }
      if (!Value.Check(StudioStoryboardRequestSchema, request)) throw new Error('请填写有效来源、目标阶段与角色；正文最多 12000 字。');
      pending.current = request; persist(request.input, request);
      const job = await operations.create.mutateAsync(request);
      pending.current = null; persist(request.input, null); onSelectJob(job.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '请求失败，输入和重试键仍保留。'); }
    finally { setBusy(false); }
  };
  const targetStage = input ? content.stages.find(stage => stage.id === input.stageId) : undefined;
  const scenes = targetStage ? getEffectiveStageScenes(targetStage, content.scenes) : [];
  return <ResponsiveEditOverlay open={open} onOpenChange={next => { if (!next && !busy) onClose(); }} title="智能制作"
    description="正文分镜、批量绘制或调整画面。审阅并明确确认后执行，默认保留已有画面。"
    footer={<><Button variant="outline" disabled={busy} onClick={onClose}>关闭</Button>
      {!jobId && mode==='storyboard' && <Button loading={busy} disabled={!input || busy} onClick={() => void create()}>生成待审分镜</Button>}</>}>
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{(selected.data?.kind ?? mode)==='refine' ? '调整画面':(selected.data?.kind ?? mode)==='render_batch'?'批量绘制':'从正文生成分镜'}</h3>
        {jobId && <Button size="sm" variant="outline" onClick={() => { setMode(selected.data?.kind ?? 'storyboard');setError(''); onSelectJob(null); }}>新建任务</Button>}</div>
      {!jobId&&<div className="flex flex-wrap gap-2"><Button variant={mode==='storyboard'?'secondary':'ghost'} size="sm" onClick={()=>setMode('storyboard')}>正文分镜</Button><Button variant={mode==='render_batch'?'secondary':'ghost'} size="sm" onClick={()=>setMode('render_batch')}>批量绘制</Button><Button variant={mode==='refine'?'secondary':'ghost'} size="sm" onClick={()=>setMode('refine')}>调整画面</Button></div>}
      {jobId ? selected.isPending ? <p role="status">读取任务…</p> : selected.isError ? <p role="alert" className="text-danger-fg">{selected.error.message}</p>
        : selected.data && (selected.data.kind==='refine' ? <StudioRefinePanel key={jobId} activityId={activityId} content={content} job={selected.data} beforeAction={beforeAction} onSelectJob={onSelectJob} onApplied={onApplied}/>
          : selected.data.kind==='render_batch' ? <StudioBatchPanel key={jobId} activityId={activityId} content={content} job={selected.data} beforeAction={beforeAction} onSelectJob={onSelectJob} onSync={()=>onApplied(selected.data!)}/>
          : <StudioProposalReview key={jobId} activityId={activityId} job={selected.data} content={content} beforeApply={beforeAction} onApplied={onApplied} onSelectJob={onSelectJob}/>)
        : mode==='refine' ? <StudioRefinePanel activityId={activityId} content={content} beatId={beatId} panelId={panelId} job={null} beforeAction={beforeAction} onSelectJob={onSelectJob} onApplied={onApplied}/>
        : mode==='render_batch' ? <StudioBatchPanel activityId={activityId} content={content} job={null} beforeAction={beforeAction} onSelectJob={onSelectJob} onSync={async()=>{}}/>
        : input && <fieldset disabled={busy} className="space-y-4">
          <FormField label="正文来源"><select aria-label="分镜正文来源" className={selectClass} value={input.source.kind} onChange={event => {
            const kind = event.target.value;
            update({ source: kind === 'scene' ? { kind, contentRevisionId: '', stageId: input.stageId, sceneId: input.sceneId ?? '' }
              : kind === 'story_chapter' ? { kind, projectId: '', chapterId: '', revisionId: '' } : { kind: 'text', text: '' } });
            setProjectId(''); setChapterId('');
          }}><option value="text">粘贴正文</option><option value="scene">已保存的活动场次</option><option value="story_chapter">正式剧情章节的不可变版本</option></select></FormField>
          {input.source.kind === 'text' && <FormField label="正文（最多 12000 字）"><Textarea aria-label="分镜来源正文" rows={7} value={input.source.text}
            onChange={event => update({ source: { kind: 'text', text: event.target.value } })} /><p className="text-xs text-muted">{input.source.text.length}/12000；超限会阻止提交，不截断正文。</p></FormField>}
          <div className="grid gap-4 sm:grid-cols-2"><FormField label="目标阶段"><select aria-label="分镜目标阶段" className={selectClass} value={input.stageId} onChange={event => update({ stageId: event.target.value, sceneId: null })}>
            {content.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.title}{stage.locked ? '（已锁定）' : ''}</option>)}</select></FormField>
            <FormField label="来源场次 / 可替换范围"><select aria-label="分镜来源场次" className={selectClass} value={input.sceneId ?? ''} onChange={event => update({ sceneId: event.target.value || null })}>
              <option value="">只追加新场次</option>{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></FormField></div>
          {input.source.kind === 'scene' && <p className="text-xs text-muted">点击生成时先保存当前编辑内容，仅为变化的内容建立版本，再读取该版本中的来源场次。打开此页面不会提交版本。</p>}
          {input.source.kind === 'story_chapter' && <div className="space-y-3">
            <FormField label="剧情项目"><select aria-label="来源剧情项目" className={selectClass} value={projectId} onChange={event => { setProjectId(event.target.value); setChapterId(''); update({ source: { kind: 'story_chapter', projectId: event.target.value, chapterId: '', revisionId: '' } }); }}>
              <option value="">选择项目</option>{projects.data?.items.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></FormField>
            <FormField label="正式章节"><select aria-label="来源正式章节" className={selectClass} value={chapterId} onChange={event => { setChapterId(event.target.value); update({ source: { kind: 'story_chapter', projectId, chapterId: event.target.value, revisionId: '' } }); }}>
              <option value="">选择章节</option>{chapters.data?.items.filter(item => item.kind === 'chapter').map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></FormField>
            <FormField label="冻结章节版本"><select aria-label="来源章节版本" className={selectClass} value={input.source.revisionId} onChange={event => update({ source: { kind: 'story_chapter', projectId, chapterId, revisionId: event.target.value } })}>
              <option value="">选择已保存版本</option>{revisions.data?.items.map(revision => <option key={revision.id} value={revision.id}>v{revision.revision} · {new Date(revision.createdAt).toLocaleString()}</option>)}</select></FormField>
            {[projects, chapters, revisions].filter(query => query.isError).map((query, index) => <p key={index} role="alert" className="text-xs text-danger-fg">{query.error?.message}</p>)}
          </div>}
          <fieldset className="space-y-2"><legend className="text-sm font-medium">允许使用的活动角色</legend><div className="flex flex-wrap gap-3">
            {content.actors.map(actor => <label key={actor.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={input.actorIds.includes(actor.id)}
              onChange={event => update({ actorIds: event.target.checked ? [...input.actorIds, actor.id] : input.actorIds.filter(id => id !== actor.id) })} />{actor.displayName}</label>)}
          </div><p className="text-xs text-muted">只使用已有角色；不选角色可生成空景。最多 8 人，不会由模型新增角色。</p></fieldset>
          <div className="grid gap-4 sm:grid-cols-2"><FormField label="分镜形式"><select aria-label="分镜形式" className={selectClass} value={input.output} onChange={event => update({ output: event.target.value as 'beats' | 'comic' })}>
            <option value="beats">活动镜头</option><option value="comic">漫画画格</option></select></FormField>
            <FormField label={input.output === 'comic' ? '画格数（4–8）' : '镜头数（2–12）'}><Input aria-label="分镜数量" inputMode="numeric" value={countText} onChange={event => { setCountText(event.target.value); pending.current = null;
              if (/^\d+$/.test(event.target.value)) update({ count: Number(event.target.value) }); }} /></FormField></div>
          <FormField label="补充要求"><Textarea aria-label="分镜补充要求" rows={3} value={input.instructions} onChange={event => update({ instructions: event.target.value })} /></FormField>
        </fieldset>}
      {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
      <section aria-label="智能制作任务记录" className="space-y-2"><h3 className="text-sm font-semibold">任务记录</h3>
        {jobs.isError && <p role="alert" className="text-danger-fg">{jobs.error.message}</p>}
        {jobs.isPending ? <p role="status" className="text-sm text-muted">读取记录…</p> : !jobs.data?.pages.some(page => page.items.length) ? <p className="text-sm text-muted">还没有任务。生成后刷新页面仍可从这里审阅。</p> :
          jobs.data.pages.flatMap(page => page.items).map(job => <button type="button" key={job.id} disabled={busy} className={`flex w-full items-center justify-between gap-3 rounded-lg p-3 text-left text-sm ${job.id === jobId ? 'bg-accent-soft' : 'bg-surface-subtle'}`}
            onClick={() => onSelectJob(job.id)}><span className="min-w-0 truncate">{job.kind==='refine'?'调整画面':job.kind==='render_batch'?'绘制':'分镜'} · {new Date(job.createdAt).toLocaleString()}</span><span className="shrink-0">{studioStatusLabels[job.status]}</span></button>)}
        {jobs.hasNextPage && <Button variant="ghost" size="sm" loading={jobs.isFetchingNextPage} onClick={() => void jobs.fetchNextPage()}>更多任务</Button>}
      </section>
    </div>
  </ResponsiveEditOverlay>;
}
