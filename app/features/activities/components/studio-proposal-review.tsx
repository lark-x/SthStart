'use client';

import { useState } from 'react';
import type { ContentDocument, StudioJob, StudioStoryboardRequest, StudioStoryboardApply } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { fetchStudioVersions } from '../studio-api';
import { isStudioJobActive } from '../studio-queries';
import { useStudioJobMutations } from '../studio-mutations';
import {StudioTaskControls} from './studio-task-controls';

export const studioStatusLabels: Record<StudioJob['status'], string> = {
  queued: '排队中', preparing: '准备中', running: '正在生成', awaiting_review: '待审阅', paused: '已暂停',
  succeeded: '已完成', partially_succeeded: '部分完成', failed: '失败', cancelled: '已停止', interrupted: '已中断', unknown: '结果未确定',
};

export function StudioProposalReview({ activityId, job, content, beforeApply, onApplied,onSelectJob }: {
  activityId: string; job: StudioJob; content: ContentDocument;
  beforeApply(): Promise<boolean>; onApplied(job: StudioJob): Promise<void>;
  onSelectJob?(id:string):void;
}) {
  const operations = useStudioJobMutations(activityId);
  const [error, setError] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renderAfterApply,setRenderAfterApply]=useState(false),[placement,setPlacement]=useState<'history_only'|'fill_empty'>('history_only');
  const request = job.input.request as StudioStoryboardRequest | undefined;
  const result = job.result && 'output' in job.result ? job.result : null;
  const actorName = (id: string | null) => id ? content.actors.find(actor => actor.id === id)?.displayName ?? `未知角色 ${id}` : '旁白 / 空景';
  const apply = async (mode: StudioStoryboardApply['mode']) => {
    if (!result || busy) return;
    setBusy(true); setError('');
    try {
      if (!await beforeApply()) throw new Error('当前输入尚未保存。请先处理保存冲突；提案仍保留。');
      const versions = await fetchStudioVersions(activityId);
      const next = await operations.apply.mutateAsync({ jobId: job.id, input: { versions, expectedJobRevision: job.revision,
        resultHash: result.resultHash, mode, sceneId: request?.input.sceneId ?? null,
        renderAfterApply,placement,...(mode === 'replace_scene' ? { confirmReplace: true } : {}) } });
      setReplaceOpen(false); await onApplied(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '应用失败，正文未被覆盖。'); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    setError('');
    try { await operations.stop.mutateAsync(job); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '停止失败，请刷新任务状态。'); }
  };
  return <section aria-label="分镜提案审阅" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{studioStatusLabels[job.status]}</h3>
      {job.callId && <a className="text-sm text-accent" target="_blank" rel="noopener noreferrer" href={`/settings/ai-logs?callId=${encodeURIComponent(job.callId)}`}>查看调用日志</a>}</div>
    <p className="text-xs text-muted">{new Date(job.createdAt).toLocaleString()} · 任务 {job.id}</p>
    <StudioTaskControls activityId={activityId} job={job} beforeAction={beforeApply} onSelectJob={onSelectJob}/>
    {request && <details className="rounded-lg bg-surface-subtle p-3 text-xs"><summary>冻结输入与版本</summary>
      <p className="mt-2">来源：{result?.sourceLabel ?? String(job.input.sourceLabel ?? '已冻结资料')} · {request.input.output === 'comic' ? '漫画' : '镜头'} {request.input.count} 格</p>
      <p>内容草稿 v{request.versions.contentDraftVersion} · 美术草稿 v{request.versions.imageConfigDraftVersion} · 活动 v{request.versions.headVersion}</p>
      <p>角色：{request.input.actorIds.map(actorName).join('、') || '无角色（空景）'}</p>
      {request.input.source.kind === 'text' && <p className="mt-2 whitespace-pre-wrap break-words">{request.input.source.text}</p>}
    </details>}
    {isStudioJobActive(job) && !job.readOnly && <div className="space-y-2"><p role="status" className="text-sm text-muted">正在生成待审分镜，不会自动改正文或提交生图。关闭窗口后可从任务记录继续查看。</p>
      <Button variant="outline" loading={operations.stop.isPending} onClick={() => void stop()}>停止此任务</Button></div>}
    {job.errorMessage && <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">{job.errorMessage}</p>}
    {result && <div className="space-y-3">
      {result.output && <><h4 className="font-medium">{result.output.scene.title}</h4>
        <p className="text-xs text-muted">{[result.output.scene.timeText, result.output.scene.locationText, result.output.scene.environment].filter(Boolean).join(' · ')}</p>
        {result.output.beats.map((beat, index) => <article key={index} className="rounded-lg bg-surface-subtle p-3 text-sm">
          <p className="font-medium">{index + 1}. {beat.actorIds.map(actorName).join('、') || '空景'}</p><p className="mt-1 whitespace-pre-wrap">{beat.action}</p>
          {beat.dialogue && <p className="mt-2 whitespace-pre-wrap text-muted">{actorName(beat.primaryActorId)}：{beat.dialogue}</p>}
          {beat.composition && <p className="mt-2 text-xs text-muted">构图：{beat.composition}</p>}
        </article>)}</>}
      {result.comic?.panels.map((panel, index) => <article key={index} className="rounded-lg bg-surface-subtle p-3 text-sm">
        <p className="font-medium">{index + 1}. {panel.actorIds.map(actorName).join('、') || '空景'}</p><p className="mt-1 whitespace-pre-wrap">{panel.visualDescription}</p>
        {panel.bubbles.map((bubble, i) => <p key={i} className="mt-2 whitespace-pre-wrap text-muted">{actorName(bubble.speakerActorId)}：{bubble.text}</p>)}
      </article>)}
    </div>}
    {job.status === 'awaiting_review' && !job.readOnly && <div className="space-y-3">
      <p className="text-sm text-muted">默认追加，已有场次、裁切、图片与台词不变。替换只针对创建任务时指定的场次；内容变化会阻止应用。</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={renderAfterApply} disabled={busy} onChange={e=>setRenderAfterApply(e.target.checked)}/>应用后连续绘制本次新增的 {result?.output?.beats.length ?? result?.comic?.panels.length ?? 0} 个目标</label>
      {renderAfterApply&&<div className="space-y-2"><p className="text-xs text-muted">每目标 1 张，先执行工作流与文件预检；缺项不会提交图片。只处理本提案新建的目标，不包含其他历史内容。启用优化时每目标另有 1 次文本模型调用。</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={placement==='fill_empty'} disabled={busy} onChange={e=>setPlacement(e.target.checked?'fill_empty':'history_only')}/>明确授权：仅填入空画面（默认只入历史）</label></div>}
      <div className="flex flex-wrap gap-2"><Button loading={busy} disabled={busy} onClick={() => void apply('append')}>{renderAfterApply?'追加并连续绘制':'追加到活动'}</Button>
        <Button variant="outline" disabled={busy || !request?.input.sceneId} onClick={() => setReplaceOpen(true)}>替换来源场次</Button></div>
    </div>}
    {job.applyState === 'applied' && <p role="status" className="text-sm text-success-fg">已应用。重复操作不会再次新增分镜。</p>}
    {job.appliedResult?.childJobId&&<Button variant="outline" onClick={()=>onSelectJob?.(job.appliedResult!.childJobId!)}>查看连续绘制</Button>}
    {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
    <ConfirmDialog open={replaceOpen} onOpenChange={setReplaceOpen} title="替换来源场次？"
      description="仅替换本任务指定场次的分镜及对应漫画页面，原图仍保留在历史中。其他场次不会修改。此操作需要版本和来源校验通过。"
      confirmLabel="确认替换" onConfirm={() => apply('replace_scene')} />
  </section>;
}
