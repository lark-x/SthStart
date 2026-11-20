'use client';

import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  CreativeApproval,
  CreativeArtifact,
  CreativeMessageResponse,
  CreativeRun,
  CreativeScope,
} from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Card } from '@/app/components/ui/card';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { creativeApi } from './api';
import { creativeKeys, useCreativeRun, useCreativeRuns, useCreativeWorkflows } from './queries';
import { payloadLabels } from './workflow-model';
import { ActivateCandidate, RecoverNode } from './run-recovery';
import { AssistantArtifact } from './assistant-artifact';

export const runStatus: Record<CreativeRun['status'], string> = {
  queued: '等待执行',
  running: '创作中',
  waiting_approval: '等你确认',
  paused: '已暂停',
  uncertain: '执行结果待核实',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
};
const nodeStatus: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  waiting: '等待确认',
  succeeded: '已完成',
  skipped: '已跳过',
  failed: '失败',
  uncertain: '待核实',
};
const artifactStatus: Record<string, string> = {
  candidate: '候选',
  accepted: '已采用',
  superseded: '已有新版本',
  stale: '上游已改变',
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function RunDetail({
  id,
  onPropose,
  onSpeculate,
  onSelectRun,
}: {
  id: string;
  onPropose?: (proposal: NonNullable<CreativeMessageResponse['proposal']>, scope: CreativeScope) => void;
  onSpeculate?: (candidateArtifactId: string, scope: CreativeScope, title: string) => void;
  onSelectRun?: (id: string) => void;
}) {
  const query = useCreativeRun(id);
  const allRuns = useCreativeRuns();
  const workflows = useCreativeWorkflows();
  const client = useQueryClient();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [altOpen, setAltOpen] = useState(false);
  const [altAngle, setAltAngle] = useState('');
  const detail = query.data;

  useEffect(() => {
    if (detail?.run.status !== 'completed') return;
    void client.invalidateQueries({ queryKey: creativeKeys.workflows });
    if (typeof detail.run.input.conversationId === 'string') {
      void client.invalidateQueries({ queryKey: creativeKeys.conversation(detail.run.input.conversationId) });
    }
  }, [detail?.run.status, detail?.run.input.conversationId, client]);

  const control = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!detail) return;
    setBusy(action);
    setError('');
    try {
      await creativeApi.controlRun(id, action, detail.run.revision);
      await client.invalidateQueries({ queryKey: creativeKeys.runs });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务操作失败');
      throw cause;
    } finally {
      setBusy('');
    }
  };

  if (query.isPending) {
    return (
      <p role="status" className="p-6 text-muted">
        正在读取任务与产物…
      </p>
    );
  }
  if (query.error || !detail) {
    return (
      <Alert variant="danger">
        {query.error?.message ?? '任务不存在'}
        <Button onClick={() => void query.refetch()} variant="ghost">
          重新读取
        </Button>
      </Alert>
    );
  }

  const workflow = workflows.data?.items.find((item) => item.id === detail.run.workflowId);
  const pending = detail.approvals.filter((item) => item.status === 'pending');
  const preferredDefaultArtifact =
    detail.artifacts.find((item) => item.kind === 'scene' && item.status !== 'superseded' && item.status !== 'stale') ??
    detail.artifacts.find((item) => item.kind === 'image' && item.status !== 'superseded' && item.status !== 'stale') ??
    detail.artifacts.filter((item) => item.status !== 'superseded').at(-1);
  const artifact = detail.artifacts.find((item) => item.id === selectedArtifact) ?? preferredDefaultArtifact;
  const speculatableScene =
    detail.run.status === 'waiting_approval' &&
    Boolean(detail.run.scope.worldId) &&
    !detail.run.scope.projectId &&
    detail.artifacts.find(
      (item) =>
        item.kind === 'scene' &&
        item.status === 'candidate' &&
        (item.content.speculation === null || item.content.speculation === undefined),
    );
  const liveReviews = detail.artifacts.filter(
    (item) => item.kind === 'review' && item.status !== 'superseded' && item.status !== 'stale',
  );
  const contextArtifact = detail.artifacts.find((item) => item.kind === 'context');
  const siblingRuns = (allRuns.data?.items ?? []).filter(
    (item) =>
      item.id !== detail.run.id &&
      (item.input.alternativeOfRunId === detail.run.id ||
        detail.run.input.alternativeOfRunId === item.id ||
        (typeof detail.run.input.alternativeOfRunId === 'string' &&
          item.input.alternativeOfRunId === detail.run.input.alternativeOfRunId)),
  );
  const comparisonRunId = siblingRuns[0]?.id ?? null;

  const startAlternative = async (angleText: string) => {
    const trimmed = angleText.trim();
    if (!trimmed) return;
    setBusy('alternative');
    setError('');
    try {
      const created = await creativeApi.startAlternative(detail.run.id, {
        angle: trimmed,
        idempotencyKey: `alt_${crypto.randomUUID().replaceAll('-', '')}`,
      });
      setAltOpen(false);
      setAltAngle('');
      await client.invalidateQueries({ queryKey: creativeKeys.runs });
      onSelectRun?.(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '启动对比分支失败');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{workflow?.document.name ?? '创作任务'}</h2>
          <p className="text-sm text-muted">
            {detail.run.scope.workName ?? '独立创作'} · 流程第 {detail.run.workflowVersion} 版
          </p>
          <Badge
            variant={
              detail.run.status === 'failed'
                ? 'error'
                : detail.run.status === 'uncertain' || detail.run.status === 'waiting_approval'
                  ? 'warning'
                  : detail.run.status === 'completed'
                    ? 'online'
                    : 'default'
            }
          >
            {runStatus[detail.run.status]}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {speculatableScene && onSpeculate && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onSpeculate(
                  speculatableScene.id,
                  detail.run.scope,
                  typeof speculatableScene.content.title === 'string'
                    ? speculatableScene.content.title
                    : '待审场景',
                )
              }
            >
              预写下一场景
            </Button>
          )}
          {workflow?.document.purpose === 'story' &&
            ['waiting_approval', 'completed'].includes(detail.run.status) && (
              <Button
                size="sm"
                variant={altOpen ? 'secondary' : 'outline'}
                disabled={Boolean(busy)}
                onClick={() => setAltOpen((prev) => !prev)}
              >
                对比另一走向
              </Button>
            )}
          {['queued', 'running'].includes(detail.run.status) && (
            <Button
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => void control('pause').catch(() => undefined)}
            >
              暂停
            </Button>
          )}
          {detail.run.status === 'paused' && detail.run.input.externalCandidate !== true && (
            <Button
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => void control('resume').catch(() => undefined)}
            >
              继续
            </Button>
          )}
          {!['completed', 'failed', 'cancelled'].includes(detail.run.status) && (
            <Button
              size="sm"
              variant="danger-ghost"
              disabled={Boolean(busy)}
              onClick={() => setCancelOpen(true)}
            >
              取消任务
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            刷新
          </Button>
        </div>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{detail.run.instruction}</p>

      {detail.nodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="流程推进步骤">
          {detail.nodes.map((node) => {
            const label =
              workflow?.document.nodes.find((item) => item.id === node.nodeId)?.label ?? node.nodeId;
            return (
              <Badge
                key={node.id}
                variant={
                  node.status === 'failed'
                    ? 'error'
                    : node.status === 'waiting' || node.status === 'uncertain'
                      ? 'warning'
                      : node.status === 'succeeded'
                        ? 'online'
                        : 'secondary'
                }
              >
                {label} · {nodeStatus[node.status]}
              </Badge>
            );
          })}
        </div>
      )}

      {detail.run.status === 'uncertain' && (
        <Alert variant="warning" title="需要核实上一次执行结果">
          外部调用可能已经完成。系统已停止自动重投，避免重复生成或扣费；请在执行记录中核实结果后恢复。
        </Alert>
      )}
      {(error || detail.run.error) && <Alert variant="danger">{error || detail.run.error}</Alert>}
      {altOpen && (
        <Card variant="sunken" className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">生成同起点对比备选（Dramatron / Re3 选优模式）</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                '高冲突反转版：人物利益当场撕裂或真相提前暴露',
                '克制暗线版：对话表面平和，靠动作细节与潜台词推进',
              ].map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={() => void startAlternative(preset)}
                >
                  {preset.split('：')[0]}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="co-field min-w-0 flex-1">
              自定义备选走向说明
              <Input
                value={altAngle}
                disabled={Boolean(busy)}
                placeholder="例如：改为由配角率先发难，主角顺水推舟隐瞒真实底牌"
                onChange={(event) => setAltAngle(event.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'alternative'}
              disabled={!altAngle.trim() || Boolean(busy)}
              onClick={() => void startAlternative(altAngle)}
            >
              生成对比稿
            </Button>
          </div>
        </Card>
      )}
      {comparisonRunId && (
        <AlternativeCompare
          currentDetail={detail}
          otherRunId={comparisonRunId}
          onSelectRun={onSelectRun}
        />
      )}
      {detail.run.status === 'paused' && detail.run.input.externalCandidate === true && (
        <ActivateCandidate run={detail.run} />
      )}
      {detail.nodes
        .filter((node) => node.status === 'uncertain')
        .map((node) => (
          <RecoverNode
            key={`${node.id}-${node.attempt}`}
            run={detail.run}
            node={node}
            label={workflow?.document.nodes.find((item) => item.id === node.nodeId)?.label ?? node.nodeId}
          />
        ))}
      {pending.map((approval) => (
        <ApprovalPanel
          key={`${approval.id}-${approval.revision}-${approval.bundleHash}`}
          approval={approval}
          artifacts={detail.artifacts}
          onRead={setSelectedArtifact}
        />
      ))}

      {detail.artifacts.length > 0 ? (
        <section className="space-y-4" aria-label="创作产物">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-2 font-semibold">产物阅读</h3>
            {detail.artifacts.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={artifact?.id === item.id ? 'secondary' : 'ghost'}
                aria-pressed={artifact?.id === item.id}
                onClick={() => setSelectedArtifact(item.id)}
              >
                {payloadLabels[item.kind]} · {artifactStatus[item.status]}
              </Button>
            ))}
          </div>
          {artifact && (
            <Card>
              {String(artifact.content.kind ?? '').startsWith('assistant-') ? (
                <AssistantArtifact
                  content={artifact.content}
                  onPropose={(proposal) => onPropose?.(proposal, detail.run.scope)}
                />
              ) : artifact.kind === 'scene' ? (
                <SceneReader
                  artifact={artifact}
                  reviews={liveReviews}
                  contextArtifact={contextArtifact}
                />
              ) : (
                <ArtifactReader artifact={artifact} />
              )}
            </Card>
          )}
        </section>
      ) : (
        <p className="py-8 text-center text-sm text-muted">
          任务开始执行后，方案、正文、审核与媒体产物会保存在这里。
        </p>
      )}

      <details className="space-y-3">
        <summary className="cursor-pointer text-xs text-muted">
          执行追踪与额度明细（已用 {detail.run.usage.textCalls} / {detail.run.budget.maxTextCalls} 次调用 ·{' '}
          {detail.run.usage.images} / {detail.run.budget.maxImages} 张图 ·{' '}
          {detail.run.usage.tokens.toLocaleString()} / {detail.run.budget.maxTokens.toLocaleString()} tokens）
        </summary>
        <p className="text-xs text-muted">
          tokens 包含已用量与待核对请求的预留额度；取得实际用量后会退回未用预留。
        </p>
        <ol className="space-y-2">
          {detail.nodes.map((node) => (
            <li key={node.id} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {workflow?.document.nodes.find((item) => item.id === node.nodeId)?.label ?? node.nodeId}
                </span>
                <Badge variant={node.status === 'failed' ? 'error' : 'secondary'}>
                  {nodeStatus[node.status]} · 第 {node.attempt + 1} 次
                </Badge>
              </div>
              {node.error && <p className="mt-1 text-danger-fg">{node.error}</p>}
            </li>
          ))}
        </ol>
      </details>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="取消这个创作任务？"
        description="保留已有产物，停止后续步骤。已发出的外部请求可能仍会完成。"
        confirmLabel="取消任务"
        cancelLabel="继续创作"
        danger
        onConfirm={() => control('cancel')}
      />
    </div>
  );
}

function AlternativeCompare({
  currentDetail,
  otherRunId,
  onSelectRun,
}: {
  currentDetail: { run: CreativeRun; artifacts: CreativeArtifact[] };
  otherRunId: string;
  onSelectRun?: (id: string) => void;
}) {
  const other = useCreativeRun(otherRunId);
  const currentScene = currentDetail.artifacts.find(
    (item) => item.kind === 'scene' && item.status !== 'superseded' && item.status !== 'stale',
  );
  const otherScene = other.data?.artifacts.find(
    (item) => item.kind === 'scene' && item.status !== 'superseded' && item.status !== 'stale',
  );

  return (
    <Card variant="sunken" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-sm">双走向对照阅读</h3>
        <span className="text-xs text-muted">
          点击「切换并审阅该版本」可进入对应候选进行批准采用
        </span>
      </div>
      <div className="co-alt-compare">
        <div className="rounded-control bg-surface p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="accent">当前浏览</Badge>
            <span className="text-xs text-muted">{runStatus[currentDetail.run.status]}</span>
          </div>
          <p className="font-medium text-sm">
            {typeof currentScene?.content.title === 'string'
              ? currentScene.content.title
              : '场景生成中或未完成'}
          </p>
          <p className="line-clamp-5 text-xs leading-relaxed text-muted">
            {typeof currentScene?.content.body === 'string'
              ? currentScene.content.body
              : currentDetail.run.instruction}
          </p>
        </div>
        <div className="rounded-control bg-surface p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">对比分支</Badge>
            <span className="text-xs text-muted">
              {other.data ? runStatus[other.data.run.status] : '读取中…'}
            </span>
          </div>
          <p className="font-medium text-sm">
            {typeof otherScene?.content.title === 'string'
              ? otherScene.content.title
              : (other.data?.run.input.alternativeAngle
                  ? String(other.data.run.input.alternativeAngle)
                  : '备选分支尚未出稿')}
          </p>
          <p className="line-clamp-5 text-xs leading-relaxed text-muted">
            {typeof otherScene?.content.body === 'string'
              ? otherScene.content.body
              : (other.data?.run.instruction ?? '')}
          </p>
          {onSelectRun && (
            <Button size="sm" variant="outline" onClick={() => onSelectRun(otherRunId)}>
              切换并审阅该版本
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function SceneReader({
  artifact,
  reviews,
  contextArtifact,
}: {
  artifact: CreativeArtifact;
  reviews: CreativeArtifact[];
  contextArtifact?: CreativeArtifact;
}) {
  const title = typeof artifact.content.title === 'string' ? artifact.content.title : '场景正文';
  const body = typeof artifact.content.body === 'string' ? artifact.content.body : '';
  const sceneCraft = record(artifact.content.sceneCraft);
  const intentions = Array.isArray(sceneCraft.characterIntentions) ? sceneCraft.characterIntentions : [];
  const beats = Array.isArray(sceneCraft.beats) ? sceneCraft.beats : [];
  const tensionHook = typeof sceneCraft.tensionHook === 'string' ? sceneCraft.tensionHook : '';
  const simulation = record(artifact.content.simulation);
  const events = Array.isArray(simulation.events) ? simulation.events : [];
  const newSettings = Array.isArray(artifact.content.newSettings) ? artifact.content.newSettings : [];
  const foreshadowing = Array.isArray(artifact.content.foreshadowing) ? artifact.content.foreshadowing : [];
  const matchingReviews = reviews.filter((rev) => rev.content.targetArtifactId === artifact.id);

  const worldOrProject = record(
    record(contextArtifact?.content.data).world ?? record(contextArtifact?.content.data).project,
  );
  const threadHealth = record(record(worldOrProject.longTerm).threadHealth);
  const pacingSuggestion = typeof record(threadHealth.pacingSignal).suggestion === 'string'
    ? String(record(threadHealth.pacingSignal).suggestion)
    : '';
  const threadAlerts = Array.isArray(threadHealth.openThreadAlerts) ? threadHealth.openThreadAlerts : [];

  return (
    <article className="mx-auto max-w-[75ch] space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-semibold">{title}</h3>
        <Badge variant={artifact.status === 'stale' ? 'warning' : 'secondary'}>
          {artifactStatus[artifact.status]}
        </Badge>
        {Boolean(artifact.content.speculation) && <Badge variant="warning">预写稿</Badge>}
      </div>
      {artifact.status === 'stale' && (
        <Alert variant="warning">依赖内容已变化，这份产物仅供追溯，需要重新创作后确认。</Alert>
      )}
      <div className="co-scene-prose whitespace-pre-wrap break-words">{body}</div>

      {(intentions.length > 0 || beats.length > 0 || pacingSuggestion || threadAlerts.length > 0) && (
        <details className="border-t border-border-subtle pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            创作构思与伏笔节奏参考（心智博弈 · {beats.length} 个节拍 · {threadAlerts.length} 条开放伏笔）
          </summary>
          <div className="mt-3 space-y-3 text-sm">
            {intentions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted">角色意图与认知边界推演</div>
                {intentions.map((item, idx) => {
                  const row = record(item);
                  return (
                    <div key={idx} className="rounded-control bg-surface-sunken p-2.5 text-xs space-y-0.5">
                      <div className="font-medium">角色：{String(row.actorId ?? '')} · 目标：{String(row.goal ?? '')}</div>
                      {row.hiddenAgenda ? <div className="text-muted">隐瞒：{String(row.hiddenAgenda)}</div> : null}
                      {row.mistakenBelief ? <div className="text-muted">误判：{String(row.mistakenBelief)}</div> : null}
                    </div>
                  );
                })}
              </div>
            )}
            {beats.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted mb-1">微观节拍</div>
                <ol className="list-decimal pl-5 text-xs space-y-1">
                  {beats.map((b, idx) => (
                    <li key={idx}>{String(b)}</li>
                  ))}
                </ol>
              </div>
            )}
            {tensionHook && <p className="text-xs text-muted">结尾留白/钩子：{tensionHook}</p>}
            {pacingSuggestion && (
              <p className="text-xs text-muted">节奏账本提示：{pacingSuggestion}</p>
            )}
          </div>
        </details>
      )}

      {matchingReviews.length > 0 && (
        <section className="space-y-3 border-t border-border-subtle pt-4">
          <h4 className="text-sm font-semibold text-muted">独立审核意见（{matchingReviews.length} 路）</h4>
          <div className="space-y-3">
            {matchingReviews.map((rev) => {
              const issues = Array.isArray(rev.content.issues) ? rev.content.issues : [];
              const scores = record(rev.content.scores);
              const hasScores = typeof scores.epistemic === 'number';
              return (
                <div key={rev.id} className="rounded-control bg-surface-sunken p-3 text-sm space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {valueNames[String(rev.content.verdict ?? '')] ?? String(rev.content.verdict ?? '审核')}
                    </span>
                    <span className="text-xs text-muted">{issues.length} 条问题</span>
                  </div>
                  {hasScores && (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Badge variant="secondary">知情隔离 {String(scores.epistemic)}/5</Badge>
                      <Badge variant="secondary">声线一致 {String(scores.voiceConsistency)}/5</Badge>
                      <Badge variant="secondary">画面展示 {String(scores.showDontTell)}/5</Badge>
                      <Badge variant="secondary">节奏张力 {String(scores.pacing)}/5</Badge>
                    </div>
                  )}
                  {typeof rev.content.summary === 'string' && (
                    <p className="text-muted leading-relaxed">{rev.content.summary}</p>
                  )}
                  {issues.length > 0 && (
                    <ul className="list-disc pl-5 text-xs space-y-1">
                      {issues.map((item, idx) => {
                        const issue = record(item);
                        return (
                          <li key={idx}>
                            [{valueNames[String(issue.severity ?? '')] ?? String(issue.severity ?? '')}]{' '}
                            {String(issue.message ?? '')}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(events.length > 0 || newSettings.length > 0 || foreshadowing.length > 0) && (
        <details className="border-t border-border-subtle pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            结构化变更同步预览（{events.length} 个事件 · {newSettings.length} 条新设定 · {foreshadowing.length} 条伏笔）
          </summary>
          <div className="mt-4 space-y-4 text-sm">
            {events.map((item, idx) => {
              const ev = record(item);
              const facts = Array.isArray(ev.facts) ? ev.facts : [];
              return (
                <div key={idx} className="rounded-control bg-surface-sunken p-3 space-y-1">
                  <div className="font-medium">
                    {String(ev.title ?? `事件 ${idx + 1}`)} · t={String(ev.tick ?? '')}
                  </div>
                  <p className="text-muted">{String(ev.summary ?? '')}</p>
                  {facts.length > 0 && (
                    <ul className="list-disc pl-5 text-xs space-y-0.5">
                      {facts.map((f, fIdx) => (
                        <li key={fIdx}>{String(record(f).content ?? '')}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {newSettings.length > 0 && (
              <div className="space-y-2">
                <h5 className="font-medium text-muted">新增设定</h5>
                {newSettings.map((s, idx) => (
                  <div key={idx} className="rounded-control bg-surface-sunken p-3">
                    <div className="font-medium">{String(record(s).title ?? '')}</div>
                    <p className="text-muted">{String(record(s).content ?? '')}</p>
                  </div>
                ))}
              </div>
            )}
            {foreshadowing.length > 0 && (
              <div className="space-y-2">
                <h5 className="font-medium text-muted">伏笔变化</h5>
                {foreshadowing.map((fs, idx) => (
                  <div key={idx} className="rounded-control bg-surface-sunken p-3">
                    <div className="font-medium">
                      [{String(record(fs).action ?? '')}] {String(record(fs).title ?? '')}
                    </div>
                    <p className="text-muted">{String(record(fs).detail ?? '')}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-muted">来源与版本信息</summary>
        <p className="mt-2 break-all text-xs text-muted">
          {artifact.id} · {new Date(artifact.createdAt).toLocaleString('zh-CN')}
        </p>
        <p className="mt-1 break-all text-xs text-muted">内容指纹：{artifact.contentHash}</p>
      </details>
    </article>
  );
}

function ApprovalPanel({
  approval,
  artifacts,
  onRead,
}: {
  approval: CreativeApproval;
  artifacts: CreativeArtifact[];
  onRead: (id: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError('');
    try {
      await creativeApi.decide(approval.id, {
        expectedRevision: approval.revision,
        bundleHash: approval.bundleHash,
        decision,
        comment,
      });
      await client.invalidateQueries({ queryKey: creativeKeys.runs });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '确认未完成');
      await client.invalidateQueries({ queryKey: creativeKeys.run(approval.runId) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-4" variant="sunken">
      <div>
        <h3 className="font-semibold">这组产物等待你的决定</h3>
        <p className="mt-1 text-sm text-muted">
          确认针对下面列出的这一版本；正文、状态变化、新设定及审核应一起阅读。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {approval.artifactIds.map((id) => {
          const artifact = artifacts.find((item) => item.id === id);
          return (
            <Button key={id} size="sm" variant="outline" onClick={() => onRead(id)}>
              {artifact ? payloadLabels[artifact.kind] : '查看产物'}
            </Button>
          );
        })}
      </div>
      <label className="co-field">
        意见 / 修改要求
        <Textarea
          rows={3}
          value={comment}
          maxLength={8000}
          onChange={(event) => setComment(event.target.value)}
          placeholder="例如：保留人物动机，重新处理结尾事件。"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} onClick={() => void decide('approve')}>
          确认这组产物
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void decide('reject')}>
          退回并保留意见
        </Button>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
    </Card>
  );
}

const fieldNames: Record<string, string> = {
  title: '标题',
  text: '正文',
  content: '内容',
  narration: '正文',
  scene: '场景',
  summary: '概要',
  plan: '方案',
  events: '事件',
  changes: '状态变化',
  newFacts: '新设定',
  stateChanges: '状态变化',
  foreshadowing: '伏笔',
  issues: '审核问题',
  verdict: '审核结论',
  evidence: '依据',
  location: '位置',
  message: '意见',
  severity: '程度',
  instruction: '创作要求',
  prompt: '提示词',
  negativePrompt: '反向提示词',
  reason: '原因',
  visualDetails: '视觉细节',
  dialogue: '对白',
  characters: '人物',
  scenes: '场景',
  status: '状态',
  decision: '决定',
  reviewer: '审核岗位',
  review: '审核意见',
  brief: '制作说明',
  shots: '镜头方案',
  executionStatus: '执行状态',
  requiresHumanApproval: '需要人工确认',
};
const valueNames: Record<string, string> = {
  approved: '通过',
  changes_requested: '需要修改',
  uncertain: '待核实',
  blocking: '必须修正',
  suggestion: '建议',
  unknown: '尚不确定',
  planning_only: '仅保存方案，尚未生成视频',
};
const hiddenFields = new Set([
  'targetArtifactId',
  'targetHash',
  'contentHash',
  'artifactId',
  'traceId',
  'modelId',
  'roleId',
  'runId',
  'nodeRunId',
  'dependencyIds',
  'sourceArtifactIds',
  'workflowId',
  'taskId',
  'kind',
]);
function ReadValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null) return null;
  if (typeof value === 'string') {
    return <p className="whitespace-pre-wrap break-words leading-7">{valueNames[value] ?? value}</p>;
  }
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  if (typeof value === 'number') return <span>{String(value)}</span>;
  if (depth > 6) {
    return <pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="space-y-4">
        {value.map((item, index) => (
          <li key={index}>
            <ReadValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="space-y-5">
      {Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !hiddenFields.has(key))
        .map(([key, child]) => (
          <div key={key}>
            <dt className="mb-1 text-sm font-semibold text-muted">{fieldNames[key] ?? key}</dt>
            <dd>
              <ReadValue value={child} depth={depth + 1} />
            </dd>
          </div>
        ))}
    </dl>
  );
}
function ArtifactReader({ artifact }: { artifact: CreativeArtifact }) {
  if (artifact.kind === 'context') {
    return (
      <article className="space-y-4">
        <h3 className="text-lg font-semibold">本次使用的创作资料</h3>
        <p className="text-sm leading-relaxed text-muted">
          任务固定保存了当时的作品资料、对话和可用操作，后续产物均可追溯到这份快照。
        </p>
        <details>
          <summary className="cursor-pointer text-sm text-muted">查看完整资料快照</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
            {JSON.stringify(artifact.content, null, 2)}
          </pre>
        </details>
      </article>
    );
  }
  const images = Array.isArray(artifact.content.images)
    ? artifact.content.images.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const image = value as Record<string, unknown>;
        if (typeof image.url !== 'string' || !/^\/api\/v1\/artifacts\/[A-Za-z0-9_-]+(?:\?|$)/.test(image.url)) {
          return [];
        }
        return [
          {
            url: image.url.replace(/^\/api\/v1\//, '/api/admin/'),
            id: String(image.artifactId ?? image.url),
          },
        ];
      })
    : [];
  const content = Object.fromEntries(Object.entries(artifact.content).filter(([key]) => key !== 'images'));
  return (
    <article className="mx-auto max-w-[75ch] space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{payloadLabels[artifact.kind]}</h3>
        <Badge variant={artifact.status === 'stale' ? 'warning' : 'secondary'}>
          {artifactStatus[artifact.status]}
        </Badge>
      </div>
      {artifact.status === 'stale' && (
        <Alert variant="warning">依赖内容已变化，这份产物仅供追溯，需要重新创作后确认。</Alert>
      )}
      {images.map((image, index) => (
        <figure key={image.id} className="space-y-2">
          <a href={image.url} target="_blank" rel="noreferrer">
            <img
              src={image.url}
              alt={`本次创作产物 ${index + 1}`}
              loading="lazy"
              className="max-h-[36rem] w-full object-contain"
            />
          </a>
          <figcaption className="text-xs text-muted">点击图片查看原图</figcaption>
        </figure>
      ))}
      {artifact.kind === 'image' && images.length === 0 && (
        <Alert variant="warning">尚未获得可读取的图片文件，请查看执行记录。</Alert>
      )}
      <ReadValue value={content} />
      <details>
        <summary className="cursor-pointer text-xs text-muted">来源与版本信息</summary>
        <p className="mt-2 break-all text-xs text-muted">
          {artifact.id} · {new Date(artifact.createdAt).toLocaleString('zh-CN')}
        </p>
        <p className="mt-1 break-all text-xs text-muted">内容指纹：{artifact.contentHash}</p>
      </details>
    </article>
  );
}
