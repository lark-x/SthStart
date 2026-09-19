'use client';
import { normalizeCreationProfile } from '@sthstart/contracts';

import { CandidateReviewPanel } from './candidate-review-panel';
import { useSearchParams } from 'next/navigation';
import { fetchActivityJobs, fetchActivityJob, retryActivityTextJob } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Check,
  Compass,
  MessageSquare,
  Layers,
  Mail,
  Cake,
  Camera,
  ImagePlus,
  Pencil,
} from 'lucide-react';
import type { Activity, StageDefinition } from '@sthstart/contracts';
import { useActivityJob, useActivityDraft } from '../queries';
import { useTriggerTextGeneration, useAdoptCandidate, useAdoptCandidateBatch } from '../mutations';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';

type GenerationMode =
  | 'plan' | 'stage' | 'whole-text' | 'rewrite-records'
  | 'invite' | 'wish' | 'moment' | 'shot';

interface GenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
  stages: StageDefinition[];
  currentStageId?: string;
  onCandidateAdopted?: () => void;
}

const MODE_GROUPS: Array<{
  title: string;
  hint: string;
  items: Array<{ id: GenerationMode; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }>;
}> = [
  {
    title: '整体与阶段',
    hint: '规划情节骨架或生成整个阶段的内容。',
    items: [
      { id: 'plan', label: '阶段规划', icon: Compass, desc: '构建整体情节骨架' },
      { id: 'stage', label: '阶段内容', icon: MessageSquare, desc: '生成群聊与朋友圈' },
      { id: 'whole-text', label: '整场生成', icon: Layers, desc: '逐阶段串行成文' },
    ],
  },
  {
    title: '快捷文案',
    hint: '选择目标阶段与发言人，生成后追加到该阶段。',
    items: [
      { id: 'invite', label: '生成邀请', icon: Mail, desc: '指定角色口吻的邀请消息' },
      { id: 'wish', label: '生日祝福', icon: Cake, desc: '对寿星的祝福语' },
      { id: 'moment', label: '朋友圈文案', icon: Camera, desc: '一条动态正文' },
      { id: 'shot', label: '配图描述', icon: ImagePlus, desc: '镜头描述与配文' },
    ],
  },
  {
    title: '调整已有内容',
    hint: '只修改选中的记录，不影响其他内容。',
    items: [
      { id: 'rewrite-records', label: '局部重写', icon: Pencil, desc: '调整选中的对话或动态' },
    ],
  },
];

const STAGE_SCOPED: GenerationMode[] = ['stage', 'rewrite-records', 'invite', 'wish', 'moment', 'shot'];
const SNIPPET_MODES: GenerationMode[] = ['invite', 'wish', 'moment', 'shot'];

// 每组按自身条目数分列：固定 6 列会把 3/4 张卡片压到 ~80px，导致四字标题逐字折行。
const GROUP_GRID_CLASS: Record<number, string> = {
  1: 'sm:grid-cols-2',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

/** 失败原因分层呈现：模型输出格式问题给出明确的重试引导，其余原因原样透出（可展开查看）。 */
function describeJobFailure(message: string | null | undefined): { title: string; detail: string; raw?: string } {
  const raw = (message || '').trim();
  if (!raw) return { title: '生成失败', detail: '可以调整要求后重试。' };
  if (raw.startsWith('invalid_ai_output:') || raw.includes('无法解析为 JSON')) {
    return {
      title: '模型输出不符合格式',
      detail: '模型没有按约定的 JSON 结构返回内容。系统已自动修复常见偏差（如缺失字段、数字形式的文字）；请直接重试，若反复出现可补充生成指引或更换生成模型。',
      raw,
    };
  }
  return { title: '生成失败', detail: raw };
}

export function GenerationModal({ open, onOpenChange, activity, stages, currentStageId, onCandidateAdopted }: GenerationModalProps) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [stageIds, setStageIds] = useState<string[]>(stages.filter(stage => !stage.locked).map(stage => stage.id));
  const [modeOverride, setMode] = useState<GenerationMode|null>(null);
  const [targetStageId, setTargetStageId] = useState<string>(currentStageId || stages[0]?.id || '');
  const [instructionOverride, setInstruction] = useState<string|null>(null);
  const [speakerActorId, setSpeakerActorId] = useState('');
  const [authorActorId, setAuthorActorId] = useState('');
  const [shotActorIds, setShotActorIds] = useState<string[]>([]);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const [activeJobId, setActiveJobId] = useState<string | null>(searchParams.get('jobId'));
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [candidateSelection,setCandidateSelection]=useState<string[]|null>(null);
  const [batchAdopting, setBatchAdopting] = useState(false);

  useEffect(() => {
    if (!open || activeJobId) return;
    let active = true;
    void fetchActivityJobs(activity.id).then(result => {
      const latest = result.items.filter(j => j.kind === 'text').sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (active && latest) setActiveJobId(latest.id);
    }).catch(error => { if (active) setErrorMsg(error instanceof Error ? error.message : "读取历史任务失败"); });
    return () => { active = false; };
  }, [open, activity.id, activeJobId]);

  const triggerMutation = useTriggerTextGeneration();
  const adoptMutation = useAdoptCandidate();
  const { data: jobData } = useActivityJob(activity.id, activeJobId || undefined);
  useEffect(() => {
    if (!open || !activeJobId) return;
    let active = true;
    void fetchActivityJob(activity.id, activeJobId).then(result => {
      if (active && searchParams.get('jobId') === activeJobId && MODE_GROUPS.some(group=>group.items.some(item=>item.id===result.job.mode))) setMode(result.job.mode as GenerationMode);
    }).catch(error => { if (active) setErrorMsg(error instanceof Error ? error.message : '读取任务失败'); });
    return () => { active = false; };
  }, [open, activity.id, activeJobId]);
  const handleRetry = async () => {
    if (!activeJobId) return;
    setRetrying(true);
    try { await retryActivityTextJob(activity.id, activeJobId); await queryClient.invalidateQueries(); }
    catch (error) { setErrorMsg(error instanceof Error ? error.message : '继续生成失败'); }
    finally { setRetrying(false); }
  };
  const { data: draftData } = useActivityDraft(activity.id);

  const document = draftData?.draft.document;
  const profileMode = normalizeCreationProfile((document?.activity.creationProfile?.values||{}) as Record<string,unknown>).textMode;
  const mode: GenerationMode = modeOverride ?? (currentStageId ? 'stage' : stages.length && profileMode === 'plan' ? 'whole-text' : profileMode);
  const instruction = instructionOverride ?? normalizeCreationProfile((document?.activity.creationProfile?.values||{}) as Record<string,unknown>).instruction;
  const allActors = document?.actors || [];
  const stageActorIds = useMemo(() => {
    // 阶段里没有参与者时回退到全部角色，避免选择器为空。
    const stage = stages.find((item) => item.id === targetStageId);
    return stage?.actorIds?.length ? stage.actorIds : allActors.map((actor) => actor.id);
  }, [stages, targetStageId, allActors]);
  const stageActors = useMemo(() => allActors.filter((actor) => stageActorIds.includes(actor.id)), [allActors, stageActorIds]);
  const birthdayActorIds = document?.activity?.birthdayActorIds || [];
  const nameOf = (actorId?: string) => allActors.find((actor) => actor.id === actorId)?.displayName || actorId || '未指定';

  // 选择结果直接派生：阶段变化或角色不在该阶段时回退到首位，不需要同步状态的副作用。
  const effectiveSpeakerActorId = stageActors.some((actor) => actor.id === speakerActorId) ? speakerActorId : stageActors[0]?.id || '';
  const effectiveAuthorActorId = stageActors.some((actor) => actor.id === authorActorId) ? authorActorId : stageActors[0]?.id || '';

  const selectableRecords = useMemo(() => {
    if (!document) return [] as Array<{ id: string; label: string }>;
    const displayNameOf = (actorId?: string) => document.actors.find((actor) => actor.id === actorId)?.displayName || actorId || '未指定';
    const messages = document.messages.filter((message) => message.stageId === targetStageId);
    const posts = document.posts.filter((post) => post.stageId === targetStageId);
    return [
      ...messages.map((message) => ({ id: message.id, label: `[消息] ${displayNameOf(message.speakerActorId)}：${message.text.slice(0, 40)}` })),
      ...posts.map((post) => ({ id: post.id, label: `[动态] ${displayNameOf(post.authorActorId)}：${post.text.slice(0, 40)}` })),
    ];
  }, [document, targetStageId]);

  // 切换阶段后自动丢弃不属于该阶段的旧选择，不需要在副作用里重置。
  const effectiveRecordIds = selectedRecordIds.filter((id) => selectableRecords.some((record) => record.id === id));

  const handleStartGeneration = async () => {
    setErrorMsg(null);
    setPickedCandidateId(null);
    if (mode === 'rewrite-records' && !effectiveRecordIds.length) {
      setErrorMsg('请先选择要重写的消息或动态。');
      return;
    }
    const scope: Record<string, unknown> = {};
    if (mode === 'whole-text') {
      scope.stageIds = stageIds.filter(id => stages.some(stage => stage.id === id && !stage.locked));
      if (!(scope.stageIds as string[]).length) { setErrorMsg('请至少选择一个未锁定阶段。'); return; }
    }
    if (STAGE_SCOPED.includes(mode)) scope.stageId = targetStageId;
    if (mode === 'rewrite-records') scope.recordIds = effectiveRecordIds;
    if (mode === 'invite' || mode === 'wish') scope.speakerActorId = effectiveSpeakerActorId;
    if (mode === 'wish') scope.birthdayActorIds = birthdayActorIds;
    if (mode === 'moment') scope.authorActorId = effectiveAuthorActorId;
    if (mode === 'shot') scope.actorIds = shotActorIds.length ? shotActorIds : stageActorIds;

    try {
      const job = await triggerMutation.mutateAsync({
        id: activity.id,
        input: {
          mode,
          userInstruction: instruction.trim() || undefined,
          scope,
          idempotencyKey: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        },
      });
      setActiveJobId(job.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '启动生成任务失败');
    }
  };

  const handleAdopt = async (candidateId: string) => {
    try {
      await adoptMutation.mutateAsync({ id: activity.id, candidateId, expectedHeadVersion: activity.headVersion });
      onCandidateAdopted?.();
      onOpenChange(false);
      setActiveJobId(null);
      setPickedCandidateId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '采用候选失败');
    }
  };

  const candidateList = jobData?.candidates || [];
  const orderedCandidates = useMemo(() => {
    // 整场生成的候选按阶段顺序采用；其他模式保持生成顺序。
    const order = new Map(stages.map((stage, index) => [stage.id, index]));
    return [...candidateList].sort((left, right) => {
      const leftStage = String((left.scope as Record<string, unknown>)?.stageId || '');
      const rightStage = String((right.scope as Record<string, unknown>)?.stageId || '');
      const leftOrder = order.get(leftStage);
      const rightOrder = order.get(rightStage);
      // 没有阶段信息的候选保持原有相对顺序，排在最后。
      if (leftOrder === undefined && rightOrder === undefined) return 0;
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      return leftOrder - rightOrder;
    });
  }, [candidateList, stages]);

  const adoptBatchMutation = useAdoptCandidateBatch();

  /** 整批采用：调用原子批量采用接口，在单事务中按阶段顺序统一提交。 */
  const handleAdoptBatch = async () => {
    if (!orderedCandidates.length) return;
    setBatchAdopting(true);
    setErrorMsg(null);
    try {
      await adoptBatchMutation.mutateAsync({
        id: activity.id,
        input: {
          candidateIds: orderedCandidates.filter(c=>candidateSelection===null||candidateSelection.includes(c.id)).map((c) => c.id),
          expectedHeadVersion: activity.headVersion,
          expectedDraftVersion: draftData?.draft.draftVersion ?? 1,
        },
      });
      onCandidateAdopted?.();
      onOpenChange(false);
      setActiveJobId(null);
      setPickedCandidateId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '整批采用失败');
    } finally {
      setBatchAdopting(false);
    }
  };

  const activeCandidate = candidateList.find((candidate) => candidate.id === pickedCandidateId) || candidateList[candidateList.length - 1];
  const activePayload = activeCandidate?.payload as Record<string, unknown> | undefined;
  const job = jobData?.job;
  const canBatchAdopt = job?.status === 'succeeded' && orderedCandidates.length > 1;
  const isSnippet = SNIPPET_MODES.includes(mode);
  const modeHint = MODE_GROUPS.flatMap((group) => group.items).find((item) => item.id === mode)?.desc;
  const jobFailure = job?.status === 'failed' ? describeJobFailure(job.errorMessage) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="AI 活动内容生成"
      description="选择写哪一段，按需补充要求，然后开始生成。先预览，确认满意后再采用。"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
          <div className="flex flex-wrap items-center gap-2">
            {(job?.status === 'failed' || job?.status === 'result_unknown') && <Button size="sm" variant="outline" disabled={retrying}
              onClick={handleRetry}>{retrying ? '正在恢复…' : '继续原任务（保留成功阶段）'}</Button>}
            {canBatchAdopt && (
              <Button size="sm" variant="outline" disabled={batchAdopting || adoptMutation.isPending || candidateSelection?.length===0} onClick={() => void handleAdoptBatch()}>
                {batchAdopting ? '整批采用中…' : `按阶段顺序采用全部 ${orderedCandidates.length} 份`}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={triggerMutation.isPending || job?.status === 'running' || job?.status === 'queued'}
              onClick={() => void handleStartGeneration()}
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              {activeCandidate ? '重新生成' : '开始生成'}
            </Button>
            {activeCandidate && !activeCandidate.scope.reviewBaseline && (
              <Button size="sm" disabled={adoptMutation.isPending || !!activeCandidate.scope.reviewBaseline} onClick={() => void handleAdopt(activeCandidate.id)} className="bg-accent text-white hover:bg-accent-dark">
                <Check className="h-3.5 w-3.5" />采用并更新版本
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {errorMsg && <Alert variant="danger" title="生成提示">{errorMsg}</Alert>}

        {mode === 'whole-text' && <details className="rounded-lg border border-border-subtle p-3">
          <summary className="cursor-pointer text-sm text-muted">生成 {stageIds.filter(id => stages.some(stage => stage.id === id && !stage.locked)).length} 个阶段 · 按需调整范围</summary>
          <p className="mt-2 text-sm text-muted">默认按顺序写完整场活动，已锁定的阶段会保留。</p>
          <fieldset className="mt-2 space-y-2">
          <legend className="text-sm font-medium">本次生成的阶段</legend>
          <div className="flex flex-wrap gap-3">{stages.map(stage => <label key={stage.id} className="text-sm flex items-center gap-1">
            <input type="checkbox" disabled={stage.locked} checked={!stage.locked && stageIds.includes(stage.id)}
              onChange={event => setStageIds(current => event.target.checked ? [...current, stage.id] : current.filter(id => id !== stage.id))} />
            {stage.title}{stage.locked ? '（已锁定）' : ''}</label>)}</div>
        </fieldset></details>}
        <label className="block space-y-1.5 text-sm font-medium">
          <span>这次写什么</span>
          <Select value={mode} onChange={event => setMode(event.target.value as GenerationMode)}>
            <option value="whole-text">整场活动内容</option>
            <option value="stage">一个阶段的内容</option>
            {!['whole-text', 'stage'].includes(mode) && <option value={mode}>{MODE_GROUPS.flatMap(group => group.items).find(item => item.id === mode)?.label}</option>}
          </Select>
        </label>
        <details className="rounded-lg border border-border-subtle p-3">
        <summary className="cursor-pointer text-sm text-muted">更多写作方式：邀请、祝福、重写、阶段规划</summary>
        <div className="mt-3 space-y-3">
          {MODE_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">{group.title}</span>
                <span className="text-xs text-muted">{group.hint}</span>
              </div>
              <div className={`grid grid-cols-2 gap-2 ${GROUP_GRID_CLASS[group.items.length] || 'sm:grid-cols-3'}`}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isSelected = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={`h-full min-w-0 rounded-lg border p-2.5 text-left transition-all ${isSelected ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border-subtle bg-surface hover:border-accent/40'}`}
                    >
                      <Icon className={`mb-1.5 h-4 w-4 ${isSelected ? 'text-accent' : 'text-muted'}`} />
                      <div className="text-sm font-semibold text-ink">{item.label}</div>
                      <div className="mt-0.5 text-xs leading-tight text-muted">{item.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        </details>

        {STAGE_SCOPED.includes(mode) && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">目标阶段</span>
            <Select value={targetStageId} onChange={(event) => setTargetStageId(event.target.value)} className="h-9 text-sm">
              {stages.map((stage, index) => (
                <option key={stage.id} value={stage.id}>#{index + 1} {stage.title}{stage.locked ? '（已锁定）' : ''}</option>
              ))}
            </Select>
          </label>
        )}

        {(mode === 'invite' || mode === 'wish') && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">发言角色</span>
            <Select value={effectiveSpeakerActorId} onChange={(event) => setSpeakerActorId(event.target.value)} className="h-9 text-sm">
              {stageActors.map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}
            </Select>
          </label>
        )}

        {mode === 'moment' && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">动态发布者</span>
            <Select value={effectiveAuthorActorId} onChange={(event) => setAuthorActorId(event.target.value)} className="h-9 text-sm">
              {stageActors.map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}
            </Select>
          </label>
        )}

        {mode === 'shot' && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-ink">画面中的角色</legend>
            <div className="flex flex-wrap gap-3">
              {stageActors.map((actor) => (
                <label key={actor.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={shotActorIds.includes(actor.id)}
                    onChange={(event) => setShotActorIds((current) => event.target.checked ? [...current, actor.id] : current.filter((id) => id !== actor.id))}
                  />
                  {actor.displayName}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">未选择时默认使用该阶段全部参与角色。此入口只生成描述，不会自动出图。</p>
          </fieldset>
        )}

        {mode === 'wish' && (
          <p className="text-xs text-muted">寿星：{birthdayActorIds.length ? birthdayActorIds.map((id) => nameOf(id)).join('、') : '未在本场活动中标记寿星，将按阶段主角生成祝福。'}</p>
        )}

        {mode === 'rewrite-records' && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-ink">选择要重写的记录（{effectiveRecordIds.length}）</legend>
            <div className="max-h-40 space-y-1 overflow-auto rounded border border-border-subtle p-2">
              {selectableRecords.map((record) => (
                <label key={record.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={effectiveRecordIds.includes(record.id)}
                    onChange={(event) => setSelectedRecordIds((current) => event.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id))}
                  />
                  <span>{record.label}</span>
                </label>
              ))}
              {!selectableRecords.length && <p className="text-sm text-muted">该阶段还没有消息或动态，请先生成阶段内容。</p>}
            </div>
          </fieldset>
        )}

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">生成指引与风格要求（可选）</span>
          <Textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={`例如：${modeHint || '保持温馨氛围'}，突出每位角色的性格差异。`}
            rows={3}
            className="text-sm"
          />
        </label>

        {(job?.status === 'running' || job?.status === 'queued') && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200/80 bg-amber-50/50 p-3.5">
            <Spinner className="h-4 w-4 text-amber-600" />
            <div className="text-sm text-amber-900">AI 正在生成内容中… 请稍候</div>
          </div>
        )}
        {jobFailure && (
          <Alert variant="danger" title={jobFailure.title}>
            {jobFailure.detail}
            {jobFailure.raw && (
              <details className="mt-1.5 text-xs text-muted">
                <summary className="cursor-pointer select-none">查看原始错误</summary>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all">{jobFailure.raw}</pre>
              </details>
            )}
          </Alert>
        )}
        {job?.status === 'result_unknown' && <Alert variant="warning" title="任务中断">服务重启导致任务中断，可继续原任务，保留已经生成的成功阶段。</Alert>}

        {canBatchAdopt&&<fieldset className="flex flex-wrap gap-3 rounded border border-border-default p-3"><legend className="text-sm">选择采用的阶段</legend>{orderedCandidates.map(candidate=><label key={candidate.id} className="text-sm"><input type="checkbox" checked={candidateSelection===null||candidateSelection.includes(candidate.id)} onChange={e=>setCandidateSelection(current=>e.target.checked?[...(current||[]),candidate.id]:(current||orderedCandidates.map(c=>c.id)).filter(id=>id!==candidate.id))}/>{stages.find(s=>s.id===candidate.scope.stageId)?.title||'阶段候选'}</label>)}</fieldset>}
        {activeCandidate && <CandidateReviewPanel key={activeCandidate.id} activityId={activity.id} candidateId={activeCandidate.id} onApplied={() => { onCandidateAdopted?.(); }} />}
        {!!activeCandidate?.scope.reviewBaseline&&orderedCandidates.length>1&&<div className="flex gap-2 flex-wrap">{orderedCandidates.map((candidate,index)=><Button key={candidate.id} size="sm" variant="outline" onClick={()=>setPickedCandidateId(candidate.id)}>候选 {index+1}</Button>)}</div>}
        {activeCandidate && !activeCandidate.scope.reviewBaseline && activePayload && (
          <div className="space-y-3 rounded-lg border border-border-default bg-surface p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-green-300 bg-green-50 text-xs text-green-700">
                  生成候选已就绪
                </Badge>
                <span className="text-xs text-muted">
                  候选 ID: {activeCandidate.id.slice(0, 8)}…
                </span>
              </div>
              {canBatchAdopt && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={batchAdopting || adoptMutation.isPending || candidateSelection?.length===0}
                  onClick={() => void handleAdoptBatch()}
                  className="h-7 text-xs"
                >
                  {batchAdopting ? '整批采用中…' : `采用所选 ${candidateSelection===null?orderedCandidates.length:candidateSelection.length} 个阶段`}
                </Button>
              )}
            </div>

            {/* 阶段切换标签页 (当存在多个候选时) */}
            {candidateList.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {orderedCandidates.map((candidate, index) => {
                  const scopeStageId = String((candidate.scope as Record<string, unknown>)?.stageId || '');
                  const stageTitle = stages.find((stage) => stage.id === scopeStageId)?.title;
                  const isSelected = candidate.id === activeCandidate.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setPickedCandidateId(candidate.id)}
                      className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'bg-accent text-white shadow-xs'
                          : 'bg-surface-raised border border-border-subtle text-muted hover:text-ink'
                      }`}
                    >
                      #{index + 1} {stageTitle || candidate.id.slice(0, 6)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {typeof activePayload.overview === 'string' && (
                <div className="rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-sm text-ink">
                  <span className="font-semibold text-accent">剧情规划概览：</span>
                  {activePayload.overview}
                </div>
              )}
              {typeof activePayload.summary === 'string' && (
                <div className="rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-sm text-ink">
                  <span className="font-semibold text-accent">阶段梗概：</span>
                  {activePayload.summary as string}
                </div>
              )}

              {Array.isArray(activePayload.stages) && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">
                    规划阶段清单 ({(activePayload.stages as unknown[]).length})
                  </div>
                  {(activePayload.stages as Record<string, unknown>[]).map((stage, index) => (
                    <div key={index} className="rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-sm">
                      <div className="font-medium text-ink">
                        #{index + 1} {String(stage.title)}（{String(stage.location || '无地点')}）
                      </div>
                      <div className="mt-1 text-xs text-muted leading-relaxed">
                        {String(stage.description || stage.instruction || '')}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 群聊消息原生对话气泡样式 */}
              {Array.isArray(activePayload.messages) && (activePayload.messages as unknown[]).length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">
                    群聊对话 ({(activePayload.messages as unknown[]).length} 条)
                  </div>
                  <div className="space-y-2.5 rounded-lg border border-border-subtle bg-surface-raised/40 p-3">
                    {(activePayload.messages as Record<string, unknown>[]).map((message, index) => {
                      const speakerName = nameOf(String(message.speakerActorId || ''));
                      return (
                        <div key={index} className="flex items-start gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                            {speakerName.slice(0, 1)}
                          </div>
                          <div className="space-y-1 max-w-[85%]">
                            <div className="text-[11px] font-medium text-muted">
                              {speakerName}
                            </div>
                            <div className="rounded-2xl rounded-tl-xs border border-border-subtle bg-surface px-3 py-2 text-sm text-ink shadow-2xs">
                              {String(message.text)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 朋友圈动态卡片样式 */}
              {Array.isArray(activePayload.posts) && (activePayload.posts as unknown[]).length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">
                    朋友圈动态 ({(activePayload.posts as unknown[]).length} 条)
                  </div>
                  <div className="space-y-2.5">
                    {(activePayload.posts as Record<string, unknown>[]).map((post, index) => {
                      const authorName = nameOf(String(post.authorActorId || ''));
                      return (
                        <div key={index} className="rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-2xs">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                              {authorName.slice(0, 1)}
                            </div>
                            <span className="text-xs font-semibold text-ink">{authorName}</span>
                          </div>
                          <p className="text-sm text-ink leading-relaxed pl-8">{String(post.text)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 配图方案预览卡片 */}
              {Array.isArray(activePayload.mediaSlots) && (activePayload.mediaSlots as unknown[]).length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">
                    配图方案 ({(activePayload.mediaSlots as unknown[]).length} 条)
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(activePayload.mediaSlots as Record<string, unknown>[]).map((slot, index) => (
                      <div key={index} className="rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-semibold text-ink">
                          <Camera className="h-3.5 w-3.5 text-accent" />
                          <span>{String(slot.caption || '待出图')}</span>
                        </div>
                        {Boolean(slot.shotDescription) && (
                          <p className="text-muted text-[11px] leading-relaxed">
                            {String(slot.shotDescription)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Array.isArray(activePayload.rewrittenMessages) && (activePayload.rewrittenMessages as unknown[]).length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">重写后的消息</div>
                  {(activePayload.rewrittenMessages as Record<string, unknown>[]).map((row, index) => (
                    <div key={index} className="rounded border border-border-subtle bg-surface-raised p-2 text-sm text-ink">
                      {String(row.text)}
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(activePayload.rewrittenPosts) && (activePayload.rewrittenPosts as unknown[]).length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">重写后的动态</div>
                  {(activePayload.rewrittenPosts as Record<string, unknown>[]).map((row, index) => (
                    <div key={index} className="rounded border border-border-subtle bg-surface-raised p-2 text-sm text-ink">
                      {String(row.text)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!isSnippet && mode === 'plan' && <p className="text-xs text-muted">阶段规划会保留已锁定的阶段，并把后续阶段标记为需要复核。</p>}
        {mode === 'whole-text' && <p className="text-xs text-muted">整场生成会按阶段顺序串行生成，全部完成后可以一次性按顺序采用。</p>}
      </div>
    </Dialog>
  );
}
