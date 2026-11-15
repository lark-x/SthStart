'use client';

import React, { useId, useMemo, useState } from 'react';
import type {
  PlanWorldImages,
  SubmitWorldImage,
  WorldBranch,
  WorldEvent,
  WorldImage,
  WorldRun,
} from '@sthstart/contracts';
import type { WorldImageList } from '../api';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection } from '@/app/components/ui/form-section';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { useGenerationOptions } from '../hooks/use-external-options';
import { useStoredDraft } from '../hooks/use-stored-draft';
import {
  IMAGE_PHASE_META,
  IMAGE_STATUS_META,
  describeError,
  formatTick,
  idempotencyKey,
  imageStatusTone,
  workflowsForEngine,
} from '../hooks/world-format';

export interface ImagePlanFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: WorldBranch;
  events: WorldEvent[];
  selectedEventId?: string;
  onSubmit: (input: PlanWorldImages) => Promise<WorldImageList>;
  onSaved?: (images: WorldImageList) => void;
}

interface ImagePlanDraft {
  eventIds: string[];
  expectedRevision: number;
}

export function ImagePlanForm({
  open,
  onOpenChange,
  branch,
  events,
  selectedEventId,
  onSubmit,
  onSaved,
}: ImagePlanFormProps) {
  const formId = useId();
  const { draft, setDraft, reset, clear, isDirty, hasConflict, rebase } = useStoredDraft<ImagePlanDraft>(
    `image-plan:${branch.id}`,
    () => ({
      eventIds: selectedEventId && events.some((event) => event.id === selectedEventId)
        ? [selectedEventId]
        : [],
      expectedRevision: branch.revision,
    }),
    { open, expectedRevision: branch.revision },
  );
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const visibleEvents = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return events;
    return events.filter((event) =>
      event.title.toLowerCase().includes(keyword)
      || event.summary.toLowerCase().includes(keyword));
  }, [events, query]);

  const toggleEvent = (eventId: string) => {
    setDraft((current) => {
      if (current.eventIds.includes(eventId)) {
        return { ...current, eventIds: current.eventIds.filter((id) => id !== eventId) };
      }
      if (current.eventIds.length >= 12) return current;
      return { ...current, eventIds: [...current.eventIds, eventId] };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (draft.eventIds.length === 0) {
      setValidationError('至少选择一个事件。');
      return;
    }
    if (draft.eventIds.length > 12) {
      setValidationError('一次最多规划 12 个事件。');
      return;
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const images = await onSubmit({ expectedRevision: draft.expectedRevision, eventIds: draft.eventIds });
      clear();
      onOpenChange(false);
      onSaved?.(images);
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
      title="规划配图"
      description="每个事件会拆成场景建立、关键行动和结果变化三个画面；这里只规划，不直接消耗生成名额。"
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => {
              reset();
              setError(null);
              setValidationError(null);
            }}
          >
            重置草稿
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            生成配图计划
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        {hasConflict && (
          <Alert variant="warning" title="分支修订版本已更新">
            分支已推进至修订版 {branch.revision}（草稿基于修订版 {draft.expectedRevision}）。
            您可以保留已选事件并更新基准版本，或重置草稿。
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
        {Boolean(error?.trim()) && <Alert variant="danger" title="规划失败">{error}</Alert>}
        {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能规划">{validationError}</Alert>}
        <Alert variant="info">
          已选择 {draft.eventIds.length} / 12 个事件。失败或待重做的图片会保留，图片任务不会阻塞故事阅读。
        </Alert>
        <Input
          aria-label="筛选事件"
          placeholder="按标题或摘要筛选事件"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {events.length === 0 ? (
          <p className="rounded-panel border border-dashed border-border-default px-4 py-6 text-center text-sm text-muted">
            当前时间窗口没有可规划的事件。调整时间窗口或先在故事流中运行出事件。
          </p>
        ) : (
          <div className="max-h-[45dvh] space-y-1 overflow-y-auto pr-1" data-autohide-scroll>
            {visibleEvents.map((event) => {
              const checked = draft.eventIds.includes(event.id);
              const disabled = !checked && draft.eventIds.length >= 12;
              return (
                <div key={event.id} className="flex items-start gap-3 rounded-control bg-surface-sunken/35 px-3 py-2">
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleEvent(event.id)}
                    aria-label={`选择事件 ${event.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{event.title}</p>
                    <p className="text-xs text-muted">
                      {formatTick(event.tick)} · {event.participantIds.length} 人参与
                    </p>
                    {event.summary && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{event.summary}</p>}
                  </div>
                </div>
              );
            })}
            {visibleEvents.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted">没有匹配的事件。</p>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

export interface ImageSubmitFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: WorldBranch;
  image: WorldImage | null;
  run?: WorldRun | null;
  onSubmit: (input: SubmitWorldImage) => Promise<WorldImage>;
  onSaved?: (image: WorldImage) => void;
}

interface ImageSubmitDraft {
  engineId: string;
  workflowId: string;
  model: string;
  attachRun: boolean;
  expectedRevision: number;
}

export function ImageSubmitForm({
  open,
  onOpenChange,
  branch,
  image,
  run,
  onSubmit,
  onSaved,
}: ImageSubmitFormProps) {
  const formId = useId();
  const options = useGenerationOptions(open);
  const { draft, setDraft, reset, clear, isDirty, hasConflict, rebase } = useStoredDraft<ImageSubmitDraft>(
    `image-submit:${image?.id ?? 'none'}`,
    () => ({
      engineId: '',
      workflowId: '',
      model: '',
      attachRun: Boolean(run && (run.status === 'running' || run.status === 'queued')),
      expectedRevision: branch.revision,
    }),
    { open, expectedRevision: branch.revision },
  );
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const engines = useMemo(() => options.data?.engines ?? [], [options.data?.engines]);
  const workflows = useMemo(() => options.data?.workflows ?? [], [options.data?.workflows]);
  const selectedEngine = engines.find((engine) => engine.id === draft.engineId);
  const usableWorkflows = workflowsForEngine(workflows, selectedEngine);
  const canAttachRun = Boolean(run && (run.status === 'running' || run.status === 'queued'));
  const canSubmit = Boolean(image && ['planned', 'failed', 'stale'].includes(image.status));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || !image || !canSubmit) return;
    if (!draft.engineId) {
      setValidationError('请选择一个生成引擎。');
      return;
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit({
        expectedRevision: draft.expectedRevision,
        idempotencyKey: idempotencyKey('image', {
          imageId: image.id,
          engineId: draft.engineId,
          workflowId: draft.workflowId || null,
          model: draft.model.trim() || null,
          runId: draft.attachRun && run ? run.id : null,
          expectedRevision: draft.expectedRevision,
        }),
        engineId: draft.engineId,
        ...(draft.workflowId ? { workflowId: draft.workflowId } : {}),
        ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
        ...(draft.attachRun && run ? { runId: run.id } : {}),
      });
      clear();
      onOpenChange(false);
      onSaved?.(result);
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
      title="提交配图任务"
      description="每幅图独立提交；服务端按公共图片队列调度，同类任务共享名额。"
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => {
              reset();
              setError(null);
              setValidationError(null);
            }}
          >
            重置草稿
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting} disabled={!canSubmit}>
            提交生成
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        {hasConflict && (
          <Alert variant="warning" title="分支修订版本已更新">
            分支已推进至修订版 {branch.revision}（草稿基于修订版 {draft.expectedRevision}）。
            您可以更新修订基底后提交，或重置草稿。
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
        {Boolean(error?.trim()) && <Alert variant="danger" title="提交失败">{error}</Alert>}
        {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能提交">{validationError}</Alert>}
        {!image ? (
          <p className="text-sm text-muted">请选择一幅配图。</p>
        ) : (
          <>
            {!canSubmit && (
              <Alert variant="info">
                当前状态为「{IMAGE_STATUS_META[image.status].label}」，不能重复提交。服务端会在状态变化后更新详情。
              </Alert>
            )}
            <div className="rounded-panel border border-border-subtle bg-surface-sunken/35 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={imageStatusTone(image.status)}>{IMAGE_STATUS_META[image.status].label}</Badge>
                <Badge variant="outline">{IMAGE_PHASE_META[image.phase].label}</Badge>
                <span className="text-xs text-muted">事件 {image.eventId}</span>
              </div>
              <p className="text-sm font-medium text-ink">{image.caption || '未填写说明'}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">{image.prompt}</p>
              {image.negativePrompt && (
                <p className="mt-1 text-xs leading-relaxed text-muted">负面提示：{image.negativePrompt}</p>
              )}
              {image.consistencyNote && <Alert variant="info" className="mt-3">{image.consistencyNote}</Alert>}
              {image.error && <Alert variant="danger" className="mt-3" title="上次失败原因">{image.error}</Alert>}
            </div>
            <FormSection title="生成路径">
              {options.isError && <Alert variant="danger" title="生成配置读取失败">{describeError(options.error)}</Alert>}
              {options.isLoading && <p className="text-sm text-muted">正在读取现有生成引擎与工作流…</p>}
              <FormField label="生成引擎" required>
                <Select
                  value={draft.engineId}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    engineId: event.target.value,
                    workflowId: '',
                  }))}
                >
                  <option value="">选择引擎</option>
                  {engines.map((engine) => (
                    <option key={engine.id} value={engine.id}>
                      {engine.name}（{engine.kind}{engine.enabled ? '' : ' · 已停用'}）
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                label="工作流"
                hint={usableWorkflows.length === 0
                  ? '该引擎没有匹配的已发布工作流；可以只提交引擎，若服务端要求工作流会返回明确错误。'
                  : '只列出与该引擎匹配的工作流。'}
              >
                <Select
                  value={draft.workflowId}
                  onChange={(event) => setDraft((current) => ({ ...current, workflowId: event.target.value }))}
                  disabled={!selectedEngine}
                >
                  <option value="">使用服务端默认工作流</option>
                  {usableWorkflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}{workflow.latest_version ? ` · v${workflow.latest_version}` : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="模型覆盖" hint="可选；留空时按工作流或服务端配置。">
                <Input
                  value={draft.model}
                  maxLength={300}
                  onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                  placeholder="例如：某个检查点名称"
                />
              </FormField>
              {canAttachRun && (
                <Checkbox
                  checked={draft.attachRun}
                  onChange={(event) => setDraft((current) => ({ ...current, attachRun: event.target.checked }))}
                  label="关联当前运行"
                  description="失败任务和结果不明的任务仍会占用已提交额度。"
                />
              )}
            </FormSection>
            <Alert variant="info">
              参考素材：{image.referenceArtifactIds.length} 个。未生成、排队、失败和待重做会分别显示；图片延迟不会阻塞故事阅读。
            </Alert>
          </>
        )}
      </form>
    </Dialog>
  );
}
