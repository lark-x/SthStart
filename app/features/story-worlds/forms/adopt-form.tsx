'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ProjectList,
  WorldActor,
  WorldAdoption,
  WorldAdoptionResult,
  WorldBranch,
  WorldEvent,
  WorldProjectBinding,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection } from '@/app/components/ui/form-section';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { storyApi } from '@/app/features/story/api';
import { projectKeys } from '@/app/features/projects/query-keys';
import { projectEditorHref } from '@/app/features/projects/list-state';
import { storyWorldKeys, storyWorldOptionKeys } from '../query-keys';
import { useProjectOptions } from '../hooks/use-external-options';
import { useWorldProjectBinding } from '../queries';
import { useStoredDraft } from '../hooks/use-stored-draft';
import {
  clearAdoptionAttempt,
  persistAdoptionAttempt,
  persistAdoptionDraftSnapshot,
  readAdoptionAttempt,
} from '../hooks/adoption-attempt-storage';
import { useAdoptionEvents } from '../hooks/use-adoption-events';
import {
  ADOPTION_EVENT_MAX,
  ADOPTION_TITLE_MAX,
  adoptionRequestFingerprint,
  composeAdoptionChapterBody,
  defaultAdoptionTitle,
  nextAdoptionAttempt,
  normalizeMinuteRange,
  reviewAdoptionSelection,
} from '../model/adoption-preview';
import {
  describeError,
  formatTick,
  idempotencyKey,
} from '../hooks/world-format';

export interface AdoptFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldTitle: string;
  worldId: string;
  branch: WorldBranch;
  actors: WorldActor[];
  events?: WorldEvent[];
  selectedEventId?: string;
  onSubmit: (input: WorldAdoption) => Promise<WorldAdoptionResult>;
  onBind: (
    projectId: string,
    expectedRevision: number,
    expectedBinding?: WorldProjectBinding | null,
  ) => Promise<WorldProjectBinding>;
  onSaved?: (result: WorldAdoptionResult) => void;
}

interface AdoptDraft {
  projectId: string;
  eventIds: string[];
  actorId: string;
  title: string;
  expectedRevision: number;
  rangeFrom: number;
  rangeTo: number;
}

const PREVIEW_CHAR_LIMIT = 20_000;
const AUTO_LOCATE_PAGE_LIMIT = 3;

export function AdoptForm({
  open,
  onOpenChange,
  worldTitle,
  worldId,
  branch,
  actors,
  selectedEventId,
  onSubmit,
  onBind,
  onSaved,
}: AdoptFormProps) {
  const formId = useId();
  const client = useQueryClient();
  const projects = useProjectOptions(open);
  const { draft, setDraft, reset, clear, hasConflict, rebase } = useStoredDraft<AdoptDraft>(
    `adopt:${branch.id}`,
    () => ({
      projectId: '',
      eventIds: selectedEventId ? [selectedEventId] : [],
      actorId: '',
      title: defaultAdoptionTitle(worldTitle, branch.title),
      expectedRevision: branch.revision,
      rangeFrom: 0,
      rangeTo: Math.max(branch.currentTick, 0),
    }),
    { open, expectedRevision: branch.revision },
  );
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WorldAdoptionResult | null>(null);
  const [adoptedCount, setAdoptedCount] = useState(0);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [bindingNotice, setBindingNotice] = useState<string | null>(null);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const range = normalizeMinuteRange(draft.rangeFrom, draft.rangeTo, branch.currentTick);
  const adoptionEvents = useAdoptionEvents(worldId, branch.id, range, open);
  const events = adoptionEvents.events;
  const actorNames = useMemo(
    () => new Map(actors.map((actor) => [actor.id, actor.name])),
    [actors],
  );
  const selectedEvents = useMemo(() => {
    const selected = new Set(draft.eventIds);
    return events.filter((event) => selected.has(event.id));
  }, [draft.eventIds, events]);
  const missingSelectionCount = draft.eventIds.length - selectedEvents.length;
  const visibleEvents = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return events;
    return events.filter((event) =>
      event.title.toLowerCase().includes(keyword)
      || event.summary.toLowerCase().includes(keyword));
  }, [events, query]);
  const review = useMemo(() => reviewAdoptionSelection({
    title: draft.title,
    worldId,
    branchId: branch.id,
    branchRevision: draft.expectedRevision,
    actorId: draft.actorId || null,
    events: selectedEvents,
    actorNames,
  }), [actorNames, branch.id, draft.actorId, draft.expectedRevision, draft.title, selectedEvents, worldId]);
  const previewBody = useMemo(
    () => selectedEvents.length > 0
      ? composeAdoptionChapterBody({
          worldId,
          branchId: branch.id,
          branchRevision: draft.expectedRevision,
          actorId: draft.actorId || null,
          events: selectedEvents,
          actorNames,
        })
      : '',
    [actorNames, branch.id, draft.actorId, draft.expectedRevision, selectedEvents, worldId],
  );
  const bindingQuery = useWorldProjectBinding(draft.projectId, open && Boolean(draft.projectId));
  const currentBinding = bindingQuery.data?.binding ?? null;
  const boundToCurrent = currentBinding?.worldId === worldId && currentBinding.branchId === branch.id;
  const bindingStale = Boolean(
    boundToCurrent && currentBinding && currentBinding.sourceRevision < branch.revision,
  );

  const { hasNextPage: adoptionHasNextPage, isFetchingNextPage: adoptionFetchingNext, fetchNextPage: adoptionFetchNext } = adoptionEvents;
  useEffect(() => {
    if (!open || missingSelectionCount === 0) return;
    if (!adoptionHasNextPage || adoptionFetchingNext) return;
    if ((adoptionEvents.data?.pages.length ?? 0) >= AUTO_LOCATE_PAGE_LIMIT) return;
    void adoptionFetchNext().catch(() => undefined);
  }, [adoptionEvents.data?.pages.length, adoptionFetchNext, adoptionFetchingNext, adoptionHasNextPage, missingSelectionCount, open]);

  const updateRange = (patch: Partial<{ from: number; to: number }>) => {
    setDraft((current) => {
      const next = normalizeMinuteRange(
        patch.from ?? current.rangeFrom,
        patch.to ?? current.rangeTo,
        branch.currentTick,
      );
      return { ...current, rangeFrom: next.from, rangeTo: next.to };
    });
  };

  const toggleEvent = (eventId: string) => {
    if (draft.eventIds.includes(eventId)) {
      setDraft((current) => ({
        ...current,
        eventIds: current.eventIds.filter((id) => id !== eventId),
      }));
      return;
    }
    if (draft.eventIds.length >= ADOPTION_EVENT_MAX) {
      setLimitNotice(`最多选择 ${ADOPTION_EVENT_MAX} 个事件；取消一个已选事件后才能继续添加。`);
      return;
    }
    setDraft((current) => {
      if (current.eventIds.includes(eventId)) return current;
      if (current.eventIds.length >= ADOPTION_EVENT_MAX) return current;
      return { ...current, eventIds: [...current.eventIds, eventId] };
    });
    setLimitNotice(null);
  };

  const loadMore = async () => {
    setLoadMoreError(null);
    try {
      await adoptionEvents.fetchNextPage();
    } catch (loadError) {
      setLoadMoreError(describeError(loadError));
    }
  };

  const createProject = async () => {
    const title = newProjectTitle.trim();
    if (!title || creatingProject) return;
    const existing = (projects.data?.items ?? []).find(
      (item) => item.project.title.trim() === title,
    );
    if (existing) {
      setDraft((current) => ({ ...current, projectId: existing.project.id }));
      setProjectError(null);
      setProjectNotice(`已有同名项目「${title}」，已直接选中，没有重复创建。`);
      setNewProjectTitle('');
      return;
    }
    setCreatingProject(true);
    setProjectError(null);
    setProjectNotice(null);
    try {
      const created = await storyApi.createProject(title);
      client.setQueryData<ProjectList>(
        storyWorldOptionKeys.projects(),
        (current) => current
          ? {
              items: [
                {
                  project: created,
                  chapters: 0,
                  characters: 0,
                  references: 0,
                  productions: 0,
                },
                ...current.items.filter((item) => item.project.id !== created.id),
              ],
            }
          : current,
      );
      await client.invalidateQueries({ queryKey: storyWorldOptionKeys.projects() });
      await client.invalidateQueries({ queryKey: projectKeys.all });
      setDraft((current) => ({ ...current, projectId: created.id }));
      setNewProjectTitle('');
    } catch (createError) {
      setProjectError(describeError(createError));
    } finally {
      setCreatingProject(false);
    }
  };

  const handleBind = async () => {
    if (!draft.projectId || bindingBusy) return;
    setBindingBusy(true);
    setBindingError(null);
    setBindingNotice(null);
    try {
      const binding = await onBind(draft.projectId, branch.revision, currentBinding);
      await client.invalidateQueries({ queryKey: storyWorldKeys.projectBinding(draft.projectId) });
      setBindingNotice(`已绑定到当前分支（来源修订 ${binding.sourceRevision}）。`);
    } catch (bindError) {
      setBindingError(describeError(bindError));
    } finally {
      setBindingBusy(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!draft.projectId) {
      setValidationError('请选择要采纳到的创作项目，或先新建一个项目。');
      return;
    }
    if (draft.eventIds.length === 0) {
      setValidationError('至少选择一个事件。');
      return;
    }
    if (missingSelectionCount > 0) {
      setValidationError('有已选事件不在当前时间范围内。请恢复该事件所在时间范围或取消选择后再提交。');
      return;
    }
    if (review.titleError) {
      setValidationError(review.titleError);
      return;
    }
    if (review.bodyError) {
      setValidationError(review.bodyError);
      return;
    }
    if (review.perspectiveIssues.length > 0) {
      setValidationError('所选人物视角缺少参与事件或正文，请调整事件或改为客观视角。');
      return;
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const fingerprint = adoptionRequestFingerprint({
        projectId: draft.projectId,
        eventIds: draft.eventIds,
        actorId: draft.actorId || null,
        title: draft.title,
      });
      const draftKey = `adopt:${branch.id}`;
      const attempt = nextAdoptionAttempt(
        readAdoptionAttempt(draftKey),
        fingerprint,
        () => idempotencyKey('adopt', {
          projectId: draft.projectId,
          eventIds: draft.eventIds,
          actorId: draft.actorId || null,
          title: draft.title.trim(),
          attempt: Date.now(),
          random: Math.random().toString(36).slice(2),
        }),
      );
      persistAdoptionAttempt(draftKey, attempt);
      persistAdoptionDraftSnapshot(draftKey, draft, draft.expectedRevision);
      const adoption = await onSubmit({
        expectedRevision: draft.expectedRevision,
        idempotencyKey: attempt.key,
        projectId: draft.projectId,
        eventIds: draft.eventIds,
        ...(draft.actorId ? { actorId: draft.actorId } : {}),
        title: draft.title.trim(),
      });
      setAdoptedCount(draft.eventIds.length);
      clearAdoptionAttempt(draftKey);
      clear();
      setResult(adoption);
      onSaved?.(adoption);
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const resultHref = result ? projectEditorHref(result.projectId, null, result.documentId) : '';
  const productionHref = result
    ? `/apps/projects/${encodeURIComponent(result.projectId)}?adopted=${encodeURIComponent(result.documentId)}`
    : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        if (!next) setResult(null);
        onOpenChange(next);
      }}
      title="采纳进创作项目"
      description="采纳会保留来源分支、事件范围和版本；正文仍走现有项目版本与提案机制。"
      size="lg"
      footer={
        result ? (
          <Button type="button" variant="primary" onClick={() => onOpenChange(false)}>完成</Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => {
                reset();
                setError(null);
                setValidationError(null);
                setLimitNotice(null);
                setLoadMoreError(null);
              }}
            >
              重置草稿
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={submitting}>
              采纳到项目
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <Alert variant="success" title="已采纳">
            已把 {adoptedCount} 个事件写入项目 {result.projectId} 的新章节，来源版本为分支修订 {result.sourceRevision}。
          </Alert>
          <div className="flex flex-wrap gap-4">
            <Link href={resultHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              打开并继续编辑该章节
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href={productionHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              用该章节创建制作版本
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href={`/apps/projects/${encodeURIComponent(result.projectId)}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
            >
              打开项目总览
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        <form id={formId} className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
          {hasConflict && (
            <Alert variant="warning" title="分支修订版本已更新">
              分支已推进至修订版 {branch.revision}（草稿基于修订版 {draft.expectedRevision}）。
              保留已选事件时，重试会沿用同一幂等键，不会重复创建章节。
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" type="button" onClick={() => rebase(branch.revision)}>
                  更新至 rev {branch.revision}
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => reset()}>
                  重置草稿
                </Button>
              </div>
            </Alert>
          )}
          {Boolean(error?.trim()) && <Alert variant="danger" title="采纳失败">{error}</Alert>}
          {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能采纳">{validationError}</Alert>}
          <FormSection title="目标项目">
            {projects.isError && (
              <Alert variant="danger" title="项目列表读取失败">{describeError(projects.error)}</Alert>
            )}
            {projects.isLoading && <p className="text-sm text-muted">正在读取创作项目…</p>}
            {!projects.isLoading && !projects.isError && (projects.data?.items.length ?? 0) === 0 && (
              <Alert variant="info" title="还没有创作项目">
                可以直接在下方新建项目，再采纳为第一章。
              </Alert>
            )}
            <FormField label="创作项目" required>
              <Select
                value={draft.projectId}
                onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))}
                disabled={projects.isLoading}
              >
                <option value="">选择项目</option>
                {(projects.data?.items ?? []).map((item) => (
                  <option key={item.project.id} value={item.project.id}>{item.project.title}</option>
                ))}
              </Select>
            </FormField>
            <div className="flex flex-wrap items-end gap-2">
              <FormField label="新建创作项目" hint="会立即创建空项目并选中；不会重复创建同名项目。" className="min-w-56 flex-1">
                <Input
                  value={newProjectTitle}
                  maxLength={200}
                  placeholder="项目名称"
                  onChange={(event) => setNewProjectTitle(event.target.value)}
                />
              </FormField>
              <Button
                type="button"
                variant="outline"
                loading={creatingProject}
                disabled={!newProjectTitle.trim()}
                onClick={() => void createProject()}
              >
                新建并选择
              </Button>
            </div>
            {projectNotice && <Alert variant="info" onDismiss={() => setProjectNotice(null)}>{projectNotice}</Alert>}
            {projectError && <Alert variant="danger" title="项目创建失败">{projectError}</Alert>}
            <FormField label="采纳标题" required hint={`最多 ${ADOPTION_TITLE_MAX} 个字符，不会自动截断。`}>
              <Input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </FormField>
            {review.titleError && <p className="text-xs text-danger-fg">{review.titleError}</p>}
            <FormField label="阅读视角" hint="可选；指定后所有所选事件都必须有该人物的个人正文。">
              <Select
                value={draft.actorId}
                onChange={(event) => setDraft((current) => ({ ...current, actorId: event.target.value }))}
              >
                <option value="">不限定人物视角</option>
                {actors.map((actor) => (
                  <option key={actor.id} value={actor.id}>{actor.name}</option>
                ))}
              </Select>
            </FormField>
            {review.perspectiveIssues.length > 0 && (
              <Alert variant="warning" title="人物视角不能覆盖全部所选事件">
                <ul className="list-disc space-y-1 pl-4">
                  {review.perspectiveIssues.slice(0, 6).map((issue) => (
                    <li key={issue.eventId}>{issue.eventTitle}：{issue.reason}</li>
                  ))}
                </ul>
                {review.perspectiveIssues.length > 6 && (
                  <p className="mt-2">另有 {review.perspectiveIssues.length - 6} 个事件同样不满足视角要求。</p>
                )}
              </Alert>
            )}
          </FormSection>
          <FormSection title="项目绑定" description="绑定与采纳是两件事：只有你点击绑定才会改变项目关联。">
            {!draft.projectId ? (
              <p className="text-sm text-muted">选择项目后查看它与故事世界分支的当前绑定。</p>
            ) : bindingQuery.isLoading ? (
              <p className="text-sm text-muted">正在读取项目绑定…</p>
            ) : bindingQuery.isError ? (
              <Alert variant="danger" title="项目绑定读取失败">{describeError(bindingQuery.error)}</Alert>
            ) : currentBinding ? (
              <div className="space-y-2 rounded-control bg-surface-sunken/40 px-3 py-3 text-sm leading-relaxed">
                <p className="font-medium text-ink">
                  {boundToCurrent ? '当前绑定：本世界 · 当前分支' : '当前绑定：另一条分支'}
                </p>
                <p className="text-xs text-muted">
                  世界 {currentBinding.worldId} · 分支 {currentBinding.branchId} · 绑定时修订 {currentBinding.sourceRevision}
                  {boundToCurrent && currentBinding.sourceRevision < branch.revision
                    ? `（分支现为修订 ${branch.revision}，绑定版本不会自动假装最新）`
                    : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-muted">
                这个项目还没有绑定故事世界分支。采纳不会自动建立绑定。
              </p>
            )}
            {bindingError && <Alert variant="danger" title="绑定失败" onDismiss={() => setBindingError(null)}>{bindingError}</Alert>}
            {bindingNotice && <Alert variant="success" title="绑定已更新" onDismiss={() => setBindingNotice(null)}>{bindingNotice}</Alert>}
            {bindingStale && (
              <p className="text-xs leading-relaxed text-muted">
                绑定仍指向修订 {currentBinding!.sourceRevision}；分支已推进到修订 {branch.revision}。绑定记录不会自动跟随。
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={bindingBusy}
                disabled={!draft.projectId || bindingQuery.isLoading || bindingQuery.isError}
                onClick={() => void handleBind()}
              >
                {boundToCurrent ? '更新绑定修订' : currentBinding ? '改绑到当前分支' : '绑定到当前分支'}
              </Button>
              {draft.projectId && (
                <Link
                  href={`/apps/projects/${encodeURIComponent(draft.projectId)}`}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  跳转项目
                </Link>
              )}
            </div>
          </FormSection>
          <FormSection
            title="采纳哪些事件"
            description="这里独立读取分支事件，不受画布时间窗口、人物或故事线筛选影响。"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="起始分钟" hint={formatTick(range.from)}>
                <Input
                  type="number"
                  min={0}
                  max={branch.currentTick}
                  value={draft.rangeFrom}
                  onChange={(event) => updateRange({ from: Number(event.target.value) })}
                />
              </FormField>
              <FormField label="结束分钟" hint={formatTick(range.to)}>
                <Input
                  type="number"
                  min={0}
                  max={branch.currentTick}
                  value={draft.rangeTo}
                  onChange={(event) => updateRange({ to: Number(event.target.value) })}
                />
              </FormField>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {formatTick(range.from)} – {formatTick(range.to)} · 已读取 {adoptionEvents.loadedCount} / {adoptionEvents.total} 个事件 · 已选 {draft.eventIds.length} / {ADOPTION_EVENT_MAX}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={adoptionEvents.isFetching}
                onClick={() => void adoptionEvents.refetch()}
              >
                刷新事件
              </Button>
            </div>
            {adoptionEvents.truncated && (
              <Alert variant="warning" title="事件列表尚未完整加载">
                当前时间范围共有 {adoptionEvents.total} 个事件，已加载 {adoptionEvents.loadedCount} 个。
                可以继续加载后续页面直到完整历史，或缩小时间范围。
              </Alert>
            )}
            {missingSelectionCount > 0 && (
              <Alert variant="warning" title="已选事件不在当前范围">
                有 {missingSelectionCount} 个已选事件未被当前范围加载。恢复范围或取消选择后才能提交。
              </Alert>
            )}
            {limitNotice && <Alert variant="info" onDismiss={() => setLimitNotice(null)}>{limitNotice}</Alert>}
            <Input
              aria-label="筛选事件"
              placeholder="按标题或摘要筛选已加载事件"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {adoptionEvents.isError ? (
              <Alert variant="danger" title="事件读取失败">{describeError(adoptionEvents.error)}</Alert>
            ) : adoptionEvents.isLoading ? (
              <p className="text-sm text-muted">正在读取事件…</p>
            ) : events.length === 0 ? (
              <p className="rounded-panel border border-dashed border-border-default px-4 py-6 text-center text-sm text-muted">
                当前时间范围没有事件。
              </p>
            ) : (
              <div className="max-h-[34dvh] space-y-1 overflow-y-auto pr-1" data-autohide-scroll>
                {visibleEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 rounded-control bg-surface-sunken/35 px-3 py-2">
                    <Checkbox
                      checked={draft.eventIds.includes(event.id)}
                      onChange={() => toggleEvent(event.id)}
                      aria-label={`选择事件 ${event.title}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{event.title}</p>
                      <p className="text-xs text-muted">{formatTick(event.tick)} · {event.participantIds.length} 人参与</p>
                      {event.summary && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{event.summary}</p>}
                    </div>
                  </div>
                ))}
                {visibleEvents.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-muted">没有匹配的事件。</p>
                )}
              </div>
            )}
            {adoptionEvents.hasNextPage && (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={adoptionEvents.isFetchingNextPage}
                  onClick={() => void loadMore()}
                >
                  加载更多事件
                </Button>
                {loadMoreError && <span className="text-xs text-danger-fg">{loadMoreError}</span>}
              </div>
            )}
          </FormSection>
          <FormSection title="章节预览" description="按所选事件与视角生成；提交时服务端会重新校验并原子写入。">
            <p className="text-xs text-muted">
              标题「{draft.title.trim() || '未填写'}」 · 正文 {review.bodyLength} 字符
              {review.bodyError ? ' · 超过上限' : ''}
            </p>
            {review.bodyError && <Alert variant="danger" title="正文超过单章上限">{review.bodyError}</Alert>}
            {previewBody ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-control bg-surface-sunken/40 px-4 py-3 text-xs leading-relaxed text-ink">
                {previewBody.length > PREVIEW_CHAR_LIMIT
                  ? `${previewBody.slice(0, PREVIEW_CHAR_LIMIT)}\n\n…预览仅显示前 ${PREVIEW_CHAR_LIMIT} 个字符，提交仍按完整正文校验。`
                  : previewBody}
              </pre>
            ) : (
              <p className="text-sm text-muted">选择事件后在这里查看将要写入的章节正文。</p>
            )}
          </FormSection>
          <Alert variant="info">
            采纳会新建正文并保留来源；已有正文不会被静默覆盖。
          </Alert>
        </form>
      )}
    </Dialog>
  );
}
