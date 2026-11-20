'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreativeBudget,
  CreativeMessageResponse,
  CreativeScope,
  CreativeStartRun,
} from '@sthstart/contracts';
import { useStoryWorlds, useStoryWorldOverview } from '@/app/features/story-worlds/queries';
import { useStoryProjects } from '@/app/features/story/queries';
import { Button } from '@/app/components/ui/button';
import { BudgetFields, defaultCreativeBudget } from './budget-fields';
import { MediaSettings, type CreativeMediaSettings } from './media-settings';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Alert } from '@/app/components/ui/alert';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Dialog } from '@/app/components/ui/dialog';
import { creativeApi } from './api';
import { creativeKeys, useCreativeRun, useCreativeRuns, useCreativeWorkflows } from './queries';
import { filterUserWorkflows } from './workflow-layout';
import { RunDetail, runStatus } from './run-detail';
import { ScopePolicy } from './scope-policy';
import { SceneBindingFields, type SceneBinding } from './scene-binding';

const emptyScope: CreativeScope = { workName: null, worldId: null, branchId: null, projectId: null };
type Proposal = NonNullable<CreativeMessageResponse['proposal']>;
type SpeculationSource = { candidateArtifactId: string; title: string };

const defaultAssistantBudget: CreativeBudget = {
  maxTextCalls: 12,
  maxImages: 0,
  maxTokens: 500_000,
  maxRevisions: 0,
};

export function TaskStudio() {
  const searchParams = useSearchParams();
  const [localScope, setScope] = useState<CreativeScope>(() => ({
    workName: searchParams.get('workName') || null,
    worldId: searchParams.get('worldId') || null,
    branchId: searchParams.get('branchId') || null,
    projectId: searchParams.get('projectId') || null,
  }));
  const [selectedRun, setSelectedRun] = useState<string | null>(() => searchParams.get('run'));
  const [createOpen, setCreateOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const startRequest = useRef<{ signature: string; key: string } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [speculateFrom, setSpeculateFrom] = useState<SpeculationSource | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(() => searchParams.get('conversation'));
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');
  const arcTitle = searchParams.get('arcTitle') || '';
  const [policyOpen, setPolicyOpen] = useState(false);
  const [craftDialogOpen, setCraftDialogOpen] = useState(false);
  const [messageMode, setMessageMode] = useState<'ai' | 'advisory'>('ai');
  const [assistantBudget, setAssistantBudget] = useState<CreativeBudget>(defaultAssistantBudget);
  const messageRequest = useRef<{ signature: string; key: string } | null>(null);
  const runs = useCreativeRuns();
  const workflows = useCreativeWorkflows();
  const activeRunDetail = useCreativeRun(selectedRun);
  const client = useQueryClient();

  const conversation = useQuery({
    queryKey: creativeKeys.conversation(conversationId ?? ''),
    queryFn: () => creativeApi.conversation(conversationId!),
    enabled: Boolean(conversationId),
    refetchInterval: conversationId ? 5000 : false,
  });

  const scope =
    conversation.data?.scope ??
    (localScope.worldId || localScope.projectId
      ? localScope
      : (runs.data?.items.find((run) => run.id === selectedRun)?.scope ?? localScope));

  const runAssistantProposal = useMemo<Proposal | null>(() => {
    const result = activeRunDetail.data?.artifacts.find(
      (item) => item.kind === 'result' && item.content.executionStatus === 'awaiting_budget_confirmation',
    );
    const raw = result?.content.proposal as Record<string, unknown> | undefined;
    if (
      !raw ||
      typeof raw.workflowId !== 'string' ||
      typeof raw.workflowVersion !== 'number' ||
      typeof raw.instruction !== 'string'
    ) {
      return null;
    }
    return {
      workflowId: raw.workflowId,
      workflowVersion: raw.workflowVersion,
      instruction: raw.instruction,
      input:
        raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input)
          ? (raw.input as Record<string, unknown>)
          : {},
      reason: '总管建议的下一步创作',
    };
  }, [activeRunDetail.data]);

  const effectiveProposal = proposal ?? runAssistantProposal;

  const selectRun = (id: string | null) => {
    setSelectedRun(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('run', id);
    else url.searchParams.delete('run');
    window.history.replaceState(null, '', url);
  };

  const started = async (id: string) => {
    setCreateOpen(false);
    setProposal(null);
    setSpeculateFrom(null);
    selectRun(id);
    await client.invalidateQueries({ queryKey: creativeKeys.runs });
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !message.trim()) return;
    const form = event.currentTarget as HTMLFormElement;
    const submitted = message.trim();
    setSending(true);
    setError('');
    setPendingMessage(submitted);
    const signature = JSON.stringify({ conversationId, scope, submitted, messageMode, assistantBudget });
    if (messageRequest.current?.signature !== signature) {
      messageRequest.current = { signature, key: `message_${crypto.randomUUID().replaceAll('-', '')}` };
    }
    try {
      const result = await creativeApi.message({
        ...(conversationId ? { conversationId } : {}),
        scope,
        message: submitted,
        mode: messageMode,
        ...(messageMode === 'ai'
          ? { budget: assistantBudget, idempotencyKey: messageRequest.current.key }
          : {}),
      });
      setConversationId(result.conversationId);
      setMessage('');
      form.reset();
      setProposal(result.proposal);
      messageRequest.current = null;
      const url = new URL(window.location.href);
      url.searchParams.set('conversation', result.conversationId);
      window.history.replaceState(null, '', url);
      if (result.runId) {
        selectRun(result.runId);
        await client.invalidateQueries({ queryKey: creativeKeys.runs });
      }
      await client.invalidateQueries({ queryKey: creativeKeys.conversation(result.conversationId) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发送失败，请重试');
    } finally {
      setSending(false);
      setPendingMessage('');
    }
  };

  const resetConversation = () => {
    setConversationId(null);
    setProposal(null);
    setError('');
    const url = new URL(window.location.href);
    url.searchParams.delete('conversation');
    window.history.replaceState(null, '', url);
  };

  const visibleRuns = (runs.data?.items ?? []).filter((run) =>
    scope.worldId
      ? run.scope.worldId === scope.worldId
      : scope.projectId
        ? run.scope.projectId === scope.projectId
        : true,
  );

  return (
    <div className="space-y-5 min-w-0">
      <div className="co-topbar min-w-0">
        <div className="min-w-0 flex-1">
          <ScopePicker
            scope={scope}
            onChange={(next) => {
              setScope(next);
              resetConversation();
              selectRun(null);
            }}
            disabled={sending}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scope.worldId && (
            <Link
              href={`/apps/story-worlds?world=${encodeURIComponent(scope.worldId)}${scope.branchId ? `&branch=${encodeURIComponent(scope.branchId)}` : ''}`}
              className="rounded-control border border-border-default bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-hover"
            >
              返回作品主页
            </Link>
          )}
          {(scope.projectId || (scope.worldId && scope.branchId)) && (
            <Button size="sm" variant="outline" onClick={() => setCraftDialogOpen(true)}>
              风格与声线设置
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setProposal(null);
              setSpeculateFrom(null);
              setCreateOpen(true);
            }}
          >
            从流程启动
          </Button>
        </div>
      </div>

      {arcTitle && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-hairline bg-surface px-4 py-2.5 text-xs">
          <span className="text-ink">
            当前聚焦篇章：<strong className="font-semibold">{arcTitle}</strong>
          </span>
          {!message && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMessage(`请围绕篇章「${arcTitle}」的限定阵容与当前舞台，为下一场剧情起草场景规划与正文草案。`)}
            >
              填入本篇起草提示
            </Button>
          )}
        </div>
      )}

      {(scope.projectId || (scope.worldId && scope.branchId)) && (
        <details onToggle={(event) => setPolicyOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-xs text-muted">普通插图自动采用策略</summary>
          {policyOpen && (
            <div className="mt-3">
              <ScopePolicy key={JSON.stringify(scope)} scope={scope} defaultTab="illustration" />
            </div>
          )}
        </details>
      )}

      <div className="co-studio min-w-0">
        <section className="co-conversation space-y-4 min-w-0" aria-label="与创作总管对话">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">与创作总管对话</h2>
            {conversationId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={sending}
                onClick={() => {
                  setScope(scope);
                  resetConversation();
                }}
              >
                新对话
              </Button>
            )}
          </div>
          {!conversationId && (
            <p className="text-xs leading-relaxed text-muted">
              随时提问、梳理剧情或创建作品；普通咨询直接回答，涉及写入时会先给出预览方案。
            </p>
          )}
          <div className="co-messages space-y-4" aria-live="polite">
            {conversation.isPending && conversationId ? (
              <p role="status" className="text-sm text-muted">
                正在恢复对话…
              </p>
            ) : (
              conversation.data?.messages.map((item) => (
                <article
                  key={item.id}
                  className={`space-y-1.5 ${item.role === 'user' ? 'bg-surface-sunken p-3 rounded-panel' : ''}`}
                >
                  <h3 className="text-xs font-semibold text-muted">
                    {item.role === 'user' ? '你' : '创作总管'}
                  </h3>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p>
                </article>
              ))
            )}
            {pendingMessage && (
              <article className="space-y-1.5 rounded-panel bg-surface-sunken p-3">
                <h3 className="text-xs font-semibold text-muted">你</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{pendingMessage}</p>
                <p role="status" className="text-xs text-muted">
                  总管正在整理方案…
                </p>
              </article>
            )}
          </div>
          {(error || conversation.error) && (
            <Alert variant="danger">{error || conversation.error?.message}</Alert>
          )}
          {effectiveProposal && (
            <Card variant="sunken" className="space-y-2">
              <h3 className="text-sm font-semibold">
                建议启动：
                {workflows.data?.items.find((item) => item.id === effectiveProposal.workflowId)?.document.name ??
                  '创作流程'}
              </h3>
              <p className="text-xs leading-relaxed text-muted">{effectiveProposal.reason}</p>
              <p className="whitespace-pre-wrap break-words text-xs">{effectiveProposal.instruction}</p>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setProposal(effectiveProposal);
                  setSpeculateFrom(null);
                  setCreateOpen(true);
                }}
              >
                检查额度并启动
              </Button>
            </Card>
          )}
          <form aria-label="发送创作消息" onSubmit={(event) => void send(event)} className="space-y-2.5">
            <label className="co-field">
              创作需求或反馈
              <Textarea
                name="message"
                disabled={sending}
                required
                rows={3}
                maxLength={20000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="例如：从两人抵达港口开始写下一场，保留各自尚未说出的目的。"
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    (event.ctrlKey || event.metaKey) &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-muted min-w-0">
                <span>协作方式</span>
                <Select
                  aria-label="协作方式"
                  className="w-auto max-w-full text-xs"
                  value={messageMode}
                  disabled={sending}
                  onChange={(event) => setMessageMode(event.target.value as 'ai' | 'advisory')}
                >
                  <option value="ai">AI 总管：分析并提出操作方案</option>
                  <option value="advisory">流程建议：不调用模型</option>
                </Select>
              </label>
              <Button size="sm" type="submit" variant="primary" loading={sending}>
                {messageMode === 'ai' ? '启动总管分析' : '获取流程建议'}
              </Button>
            </div>
            {messageMode === 'ai' && (
              <details>
                <summary className="cursor-pointer text-xs leading-relaxed text-muted">
                  总管分析上限：{assistantBudget.maxTextCalls} 次调用 /{' '}
                  {assistantBudget.maxTokens.toLocaleString()} tokens（可展开调整）
                </summary>
                <div className="mt-3">
                  <BudgetFields budget={assistantBudget} onChange={setAssistantBudget} disabled={sending} />
                </div>
              </details>
            )}
          </form>

          {visibleRuns.length > 0 && (
            <div className="space-y-2 border-t border-border-subtle pt-4">
              <div className="flex items-center justify-between text-xs font-semibold text-muted">
                <span>近期任务（{visibleRuns.length}）</span>
                {selectedRun && (
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => selectRun(null)}
                  >
                    全部列表
                  </button>
                )}
              </div>
              <ul className="space-y-1">
                {visibleRuns.slice(0, 12).map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      className={`co-task-row w-full px-2.5 py-2 text-left ${selectedRun === run.id ? 'is-active' : ''}`}
                      onClick={() => selectRun(run.id)}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium">
                          {workflows.data?.items.find((item) => item.id === run.workflowId)?.document.name ??
                            '创作任务'}
                        </span>
                        <Badge
                          variant={
                            run.status === 'waiting_approval' || run.status === 'uncertain'
                              ? 'warning'
                              : run.status === 'failed'
                                ? 'error'
                                : run.status === 'completed'
                                  ? 'online'
                                  : 'secondary'
                          }
                        >
                          {runStatus[run.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-muted">{run.instruction}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="co-tasks min-w-0 space-y-5" aria-label="创作任务">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{selectedRun ? '创作审阅舞台' : '创作任务'}</h2>
            {selectedRun && (
              <Button size="sm" variant="ghost" onClick={() => selectRun(null)}>
                返回任务列表
              </Button>
            )}
          </div>
          {runs.error && (
            <Alert variant="danger">
              {runs.error.message}
              <Button variant="ghost" onClick={() => void runs.refetch()}>
                重新读取
              </Button>
            </Alert>
          )}
          {runs.isPending && (
            <p role="status" className="text-sm text-muted">
              正在读取任务…
            </p>
          )}
          {selectedRun ? (
            <RunDetail
              key={selectedRun}
              id={selectedRun}
              onSelectRun={selectRun}
              onPropose={(next, targetScope) => {
                setScope(targetScope);
                resetConversation();
                setSpeculateFrom(null);
                setProposal(next);
                setCreateOpen(true);
              }}
              onSpeculate={(candidateArtifactId, targetScope, title) => {
                setScope(targetScope);
                setProposal(null);
                setSpeculateFrom({ candidateArtifactId, title });
                setCreateOpen(true);
              }}
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {visibleRuns.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    className="co-task-row w-full px-2 py-4 text-left"
                    onClick={() => selectRun(run.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {workflows.data?.items.find((item) => item.id === run.workflowId)?.document.name ??
                          '创作任务'}
                      </span>
                      <Badge
                        variant={
                          run.status === 'waiting_approval' || run.status === 'uncertain'
                            ? 'warning'
                            : run.status === 'failed'
                              ? 'error'
                              : run.status === 'completed'
                                ? 'online'
                                : 'secondary'
                        }
                      >
                        {runStatus[run.status]}
                      </Badge>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{run.instruction}</p>
                    <p className="mt-2 text-xs text-muted">
                      {run.scope.workName ?? '独立创作'} · {new Date(run.updatedAt).toLocaleString('zh-CN')}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!runs.isPending && visibleRuns.length === 0 && !selectedRun && (
            <p className="py-12 text-center text-sm leading-7 text-muted">
              还没有创作任务。
              <br />
              在左侧与总管商议方案，或点击上方「从流程启动」开始第一场创作。
            </p>
          )}
        </section>
      </div>

      <Dialog
        open={craftDialogOpen}
        onOpenChange={setCraftDialogOpen}
        title="风格指南、角色声线与采用策略"
        description="设置本作品的文风示范、禁用 AI 套话与关键角色的原声对白样本，帮助生成更稳定自然的剧情。"
        size="lg"
      >
        {(scope.projectId || (scope.worldId && scope.branchId)) && (
          <ScopePolicy key={`dialog-${JSON.stringify(scope)}`} scope={scope} defaultTab="style" />
        )}
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!starting) setCreateOpen(open);
        }}
        title={speculateFrom ? '预写下一场景' : '启动创作任务'}
        description={
          speculateFrom
            ? `基于待审场景「${speculateFrom.title}」继续预写下一幕；在上一场正式采用前不会改变正式历史。`
            : '选择已发布的创作流程，确认本次任务的执行范围与额度档位。'
        }
        size="lg"
      >
        <StartRunForm
          key={`${createOpen}-${proposal?.workflowId ?? speculateFrom?.candidateArtifactId ?? 'manual'}`}
          scope={scope}
          proposal={proposal}
          speculateFrom={speculateFrom}
          onStarted={started}
          requestRef={startRequest}
          onBusy={setStarting}
        />
      </Dialog>
    </div>
  );
}

function ScopePicker({
  scope,
  onChange,
  disabled,
}: {
  scope: CreativeScope;
  onChange: (scope: CreativeScope) => void;
  disabled: boolean;
}) {
  const worlds = useStoryWorlds();
  const projects = useStoryProjects();
  const overview = useStoryWorldOverview(scope.worldId ?? undefined);
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="co-field">
          创作范围
          <Select
            value={
              scope.worldId ? `world:${scope.worldId}` : scope.projectId ? `project:${scope.projectId}` : ''
            }
            disabled={disabled}
            onChange={(event) => {
              const [kind, id] = event.target.value.split(':');
              const world = kind === 'world' ? worlds.data?.items.find((item) => item.id === id) : undefined;
              const project =
                kind === 'project' ? projects.data?.items.find((item) => item.id === id) : undefined;
              onChange({
                ...emptyScope,
                worldId: world?.id ?? null,
                projectId: project?.id ?? null,
                workName: world?.title ?? project?.workId ?? project?.title ?? null,
              });
            }}
          >
            <option value="">全站讨论 / 先选择创作范围</option>
            <optgroup label="已配置的故事作品">
              {worlds.data?.items.map((world) => (
                <option key={world.id} value={`world:${world.id}`}>
                  {world.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="独立写作项目">
              {projects.data?.items.map((project) => (
                <option key={project.id} value={`project:${project.id}`}>
                  {project.title}
                </option>
              ))}
            </optgroup>
          </Select>
        </label>
        <label className="co-field">
          故事历史
          <Select
            value={scope.branchId ?? ''}
            disabled={disabled || !scope.worldId || overview.isPending}
            onChange={(event) => onChange({ ...scope, branchId: event.target.value || null })}
          >
            <option value="">选择要继续的历史</option>
            {overview.data?.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.title}
                {branch.mode === 'alternate' ? '（平行版本）' : ''}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {(worlds.error || overview.error || projects.error) && (
        <Alert variant="danger">
          {worlds.error?.message || overview.error?.message || projects.error?.message}
        </Alert>
      )}
      <p className="text-xs leading-relaxed text-muted">
        可选择已配置故事的作品，或独立写作项目。
        <Link href="/apps/story-worlds" className="ml-1 text-accent underline">
          管理作品与故事资料
        </Link>
        <Link href="/apps/story" className="ml-2 text-accent underline">
          管理写作项目
        </Link>
      </p>
    </div>
  );
}

function StartRunForm({
  scope,
  proposal,
  speculateFrom,
  onStarted,
  requestRef,
  onBusy,
}: {
  scope: CreativeScope;
  proposal: Proposal | null;
  speculateFrom: SpeculationSource | null;
  onStarted: (id: string) => Promise<void>;
  requestRef: React.RefObject<{ signature: string; key: string } | null>;
  onBusy: (busy: boolean) => void;
}) {
  const workflows = useCreativeWorkflows();
  const published = filterUserWorkflows(workflows.data?.items ?? [], {
    includeSystem: false,
    publishedOnly: true,
  });
  const [workflowId, setWorkflowId] = useState(proposal?.workflowId ?? '');
  const selected =
    published.find((item) => item.id === workflowId) ?? (workflowId ? undefined : published[0]);
  const [instruction, setInstruction] = useState(
    proposal?.instruction ??
      (speculateFrom ? `紧接上一待审场景「${speculateFrom.title}」的结尾继续推进下一场景。` : ''),
  );
  const [budget, setBudget] = useState<CreativeBudget>(defaultCreativeBudget);
  const [media, setMedia] = useState<CreativeMediaSettings | null>(null);
  const [sceneBinding, setSceneBinding] = useState<SceneBinding>({ importance: 'unknown' });
  const needsMedia =
    selected?.document.purpose === 'illustration' ||
    selected?.document.nodes.some((node) => node.config.tool === 'image_generation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      aria-label="创作任务与额度"
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setError('');
        if (!selected) {
          setError('请先保存、验证并发布一个创作流程。');
          return;
        }
        if (scope.worldId && !scope.branchId) {
          setError('请先在工作台选择本次创作对应的故事历史。');
          return;
        }
        if (!scope.worldId && !scope.projectId) {
          setError('请先在工作台选择故事作品或独立写作项目。');
          return;
        }
        if (needsMedia && !media) {
          setError('请选择本次插图使用的已发布图片方案。');
          return;
        }
        const payload: Omit<CreativeStartRun, 'idempotencyKey'> = {
          workflowId: selected.id,
          workflowVersion:
            proposal?.workflowId === selected.id ? proposal.workflowVersion : selected.publishedVersion,
          scope,
          instruction,
          budget,
          input: {
            ...(proposal?.workflowId === selected.id ? proposal.input : {}),
            ...(speculateFrom ? { candidateArtifactId: speculateFrom.candidateArtifactId } : {}),
            ...(needsMedia && media ? { media, ...sceneBinding } : {}),
          },
        };
        const signature = JSON.stringify(payload);
        if (requestRef.current?.signature !== signature) {
          requestRef.current = { signature, key: `ui_${crypto.randomUUID().replaceAll('-', '')}` };
        }
        setBusy(true);
        onBusy(true);
        try {
          const result = await creativeApi.start({ ...payload, idempotencyKey: requestRef.current.key });
          requestRef.current = null;
          await onStarted(result.id);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '任务启动失败');
        } finally {
          setBusy(false);
          onBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted">
        当前范围：{scope.workName ?? '独立创作'}
        {scope.worldId && !scope.branchId ? ' · 尚未选择故事历史' : ''}
      </p>
      <label className="co-field">
        创作流程
        <Select required value={selected?.id ?? ''} onChange={(event) => setWorkflowId(event.target.value)}>
          <option value="">选择已发布流程</option>
          {published.map((item) => (
            <option key={item.id} value={item.id}>
              {item.document.name} · 第{' '}
              {proposal?.workflowId === item.id ? proposal.workflowVersion : item.publishedVersion} 版
            </option>
          ))}
        </Select>
      </label>
      <label className="co-field">
        这次要完成什么
        <Textarea
          name="instruction"
          required
          rows={5}
          value={instruction}
          maxLength={20000}
          onChange={(event) => setInstruction(event.target.value)}
        />
      </label>
      {needsMedia && <MediaSettings value={media} onChange={setMedia} />}
      {needsMedia && <SceneBindingFields scope={scope} value={sceneBinding} onChange={setSceneBinding} />}
      <BudgetFields budget={budget} onChange={setBudget} disabled={busy} />
      {error && <Alert variant="danger">{error}</Alert>}
      <Button type="submit" variant="primary" loading={busy}>
        启动创作任务
      </Button>
    </form>
  );
}
