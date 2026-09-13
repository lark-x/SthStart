'use client';

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
import { useTriggerTextGeneration, useAdoptCandidate } from '../mutations';
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

export function GenerationModal({ open, onOpenChange, activity, stages, currentStageId, onCandidateAdopted }: GenerationModalProps) {
  const initialMode: GenerationMode = currentStageId ? 'stage' : 'plan';
  const [mode, setMode] = useState<GenerationMode>(initialMode);
  const [targetStageId, setTargetStageId] = useState<string>(currentStageId || stages[0]?.id || '');
  const [instruction, setInstruction] = useState('');
  const [speakerActorId, setSpeakerActorId] = useState('');
  const [authorActorId, setAuthorActorId] = useState('');
  const [shotActorIds, setShotActorIds] = useState<string[]>([]);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [batchAdopting, setBatchAdopting] = useState(false);

  const triggerMutation = useTriggerTextGeneration();
  const adoptMutation = useAdoptCandidate();
  const { data: jobData } = useActivityJob(activity.id, activeJobId || undefined);
  const { data: draftData } = useActivityDraft(activity.id);

  const document = draftData?.draft.document;
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

  /** 整批采用：按顺序逐个采用，使用服务端返回的 headVersion 递增，避免中途版本冲突。 */
  const handleAdoptBatch = async () => {
    if (!orderedCandidates.length) return;
    setBatchAdopting(true);
    setErrorMsg(null);
    let headVersion = activity.headVersion;
    try {
      for (const candidate of orderedCandidates) {
        const result = await adoptMutation.mutateAsync({ id: activity.id, candidateId: candidate.id, expectedHeadVersion: headVersion });
        headVersion = result.activity.headVersion;
      }
      onCandidateAdopted?.();
      onOpenChange(false);
      setActiveJobId(null);
      setPickedCandidateId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '整批采用失败');
    } finally { setBatchAdopting(false); }
  };

  const activeCandidate = candidateList.find((candidate) => candidate.id === pickedCandidateId) || candidateList[candidateList.length - 1];
  const activePayload = activeCandidate?.payload as Record<string, unknown> | undefined;
  const job = jobData?.job;
  const canBatchAdopt = job?.status === 'succeeded' && orderedCandidates.length > 1;
  const isSnippet = SNIPPET_MODES.includes(mode);
  const modeHint = MODE_GROUPS.flatMap((group) => group.items).find((item) => item.id === mode)?.desc;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="AI 活动内容生成"
      description="基于角色快照与剧情约束生成内容。生成结果是候选方案，必须由创作者确认后才会写入采用版本。"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
          <div className="flex flex-wrap items-center gap-2">
            {canBatchAdopt && (
              <Button size="sm" variant="outline" disabled={batchAdopting || adoptMutation.isPending} onClick={() => void handleAdoptBatch()}>
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
            {activeCandidate && (
              <Button size="sm" disabled={adoptMutation.isPending} onClick={() => void handleAdopt(activeCandidate.id)} className="bg-accent text-white hover:bg-accent-dark">
                <Check className="h-3.5 w-3.5" />采用并更新版本
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {errorMsg && <Alert variant="danger" title="生成提示">{errorMsg}</Alert>}

        <div className="space-y-3">
          {MODE_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">{group.title}</span>
                <span className="text-xs text-muted">{group.hint}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isSelected = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={`rounded-lg border p-2.5 text-left transition-all ${isSelected ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border-subtle bg-surface hover:border-accent/40'}`}
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
        {job?.status === 'failed' && <Alert variant="danger" title="生成失败">{job.errorMessage || '可以调整要求后重试。'}</Alert>}
        {job?.status === 'result_unknown' && <Alert variant="warning" title="任务中断">服务重启导致任务中断，可重新发起生成。</Alert>}

        {activeCandidate && activePayload && (
          <div className="max-h-72 space-y-2.5 overflow-y-auto rounded-lg border border-border-default bg-surface p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline" className="border-green-300 bg-green-50 text-xs text-green-700">生成候选已就绪</Badge>
              <span className="text-xs text-muted">
                {candidateList.length > 1 ? `共 ${candidateList.length} 份候选 · ` : ''}候选 ID {activeCandidate.id.slice(0, 8)}…
              </span>
            </div>
            {candidateList.length > 1 && (
              <Select
                value={activeCandidate.id}
                onChange={(event) => setPickedCandidateId(event.target.value)}
                className="h-8 text-sm"
              >
                {orderedCandidates.map((candidate, index) => {
                  const scopeStageId = String((candidate.scope as Record<string, unknown>)?.stageId || '');
                  const stageTitle = stages.find((stage) => stage.id === scopeStageId)?.title;
                  return <option key={candidate.id} value={candidate.id}>{index + 1}. {stageTitle || candidate.id.slice(0, 8)}</option>;
                })}
              </Select>
            )}

            {typeof activePayload.overview === 'string' && (
              <div className="rounded border border-border-subtle bg-surface-raised p-2 text-sm text-ink">
                <span className="font-semibold">剧情规划概览：</span>{activePayload.overview}
              </div>
            )}
            {typeof activePayload.summary === 'string' && (
              <div className="rounded border border-border-subtle bg-surface-raised p-2 text-sm text-ink">
                <span className="font-semibold">阶段梗概：</span>{activePayload.summary as string}
              </div>
            )}

            {Array.isArray(activePayload.stages) && (
              <div className="space-y-1.5">
                <div className="text-sm font-semibold text-ink">规划阶段清单（{(activePayload.stages as unknown[]).length}）</div>
                {(activePayload.stages as Record<string, unknown>[]).map((stage, index) => (
                  <div key={index} className="space-y-1 rounded border border-border-subtle bg-surface-raised p-2 text-sm">
                    <div className="font-medium text-ink">#{index + 1} {String(stage.title)}（{String(stage.location || '无地点')}）</div>
                    <div className="text-muted">{String(stage.description || stage.instruction || '')}</div>
                  </div>
                ))}
              </div>
            )}

            {Array.isArray(activePayload.messages) && (activePayload.messages as unknown[]).length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-semibold text-ink">群聊消息（{(activePayload.messages as unknown[]).length} 条）</div>
                {(activePayload.messages as Record<string, unknown>[]).slice(0, 6).map((message, index) => (
                  <div key={index} className="rounded border border-border-default bg-surface-raised p-1.5 text-sm text-ink">
                    <span className="font-medium text-accent">{nameOf(String(message.speakerActorId || ''))}：</span>{String(message.text)}
                  </div>
                ))}
                {(activePayload.messages as unknown[]).length > 6 && <div className="pl-1 text-xs text-muted">… 以及另外 {(activePayload.messages as unknown[]).length - 6} 条消息</div>}
              </div>
            )}

            {Array.isArray(activePayload.posts) && (activePayload.posts as unknown[]).length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-semibold text-ink">朋友圈动态（{(activePayload.posts as unknown[]).length} 条）</div>
                {(activePayload.posts as Record<string, unknown>[]).map((post, index) => (
                  <div key={index} className="rounded border border-border-default bg-surface-raised p-2 text-sm text-ink">
                    <span className="font-medium text-accent">{nameOf(String(post.authorActorId || ''))}：</span>{String(post.text)}
                  </div>
                ))}
              </div>
            )}

            {Array.isArray(activePayload.mediaSlots) && (activePayload.mediaSlots as unknown[]).length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-semibold text-ink">配图方案（{(activePayload.mediaSlots as unknown[]).length} 条）</div>
                {(activePayload.mediaSlots as Record<string, unknown>[]).map((slot, index) => (
                  <div key={index} className="rounded border border-border-default bg-surface-raised p-2 text-sm text-ink">
                    <div className="font-medium">{String(slot.caption || '配图')}</div>
                    <div className="text-xs text-muted">{String(slot.shotDescription || '')}</div>
                  </div>
                ))}
              </div>
            )}

            {Array.isArray(activePayload.rewrittenMessages) && (activePayload.rewrittenMessages as unknown[]).length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-semibold text-ink">重写后的消息</div>
                {(activePayload.rewrittenMessages as Record<string, unknown>[]).map((row, index) => (
                  <div key={index} className="rounded border border-border-default bg-surface-raised p-1.5 text-sm text-ink">{String(row.text)}</div>
                ))}
              </div>
            )}
            {Array.isArray(activePayload.rewrittenPosts) && (activePayload.rewrittenPosts as unknown[]).length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-semibold text-ink">重写后的动态</div>
                {(activePayload.rewrittenPosts as Record<string, unknown>[]).map((row, index) => (
                  <div key={index} className="rounded border border-border-default bg-surface-raised p-2 text-sm text-ink">{String(row.text)}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isSnippet && mode === 'plan' && <p className="text-xs text-muted">阶段规划会保留已锁定的阶段，并把后续阶段标记为需要复核。</p>}
        {mode === 'whole-text' && <p className="text-xs text-muted">整场生成会按阶段顺序串行生成，全部完成后可以一次性按顺序采用。</p>}
      </div>
    </Dialog>
  );
}
