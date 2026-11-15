'use client';

import React, { useId, useState } from 'react';
import type {
  AppLlmAssignment,
  PurposeBinding,
  ResumeWorldRun,
  StartWorldRun,
  WorldBranch,
  WorldDefinition,
  WorldRun,
  WorldRunSettings,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection, ShortFieldGrid } from '@/app/components/ui/form-section';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Switch } from '@/app/components/ui/switch';
import { useGenerationOptions } from '../hooks/use-external-options';
import { useStoredDraft } from '../hooks/use-stored-draft';
import {
  describeError,
  formatDuration,
  formatQuota,
  formatTick,
  idempotencyKey,
  modelOptionLabel,
  quotaPercent,
  resolveEffectiveModel,
  resumeTargetTick,
  runSettingsFromRun,
  runStatusLabel,
  runStatusTone,
  runTargetTick,
  type ModelProfileOption,
  validateResumeSettings,
  workflowsForEngine,
} from '../hooks/world-format';

export interface RunFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: WorldDefinition;
  branch: WorldBranch;
  run: WorldRun | null;
  modelCatalog: ModelProfileOption[];
  purposeBindings: PurposeBinding[];
  assignments: AppLlmAssignment[];
  profilesUnavailable?: boolean;
  onSubmit: (input: StartWorldRun) => Promise<WorldRun>;
  onResume?: (input: ResumeWorldRun) => Promise<WorldRun>;
  onSaved?: (run: WorldRun) => void;
}

interface RunDraft {
  settings: WorldRunSettings;
  expectedRevision: number;
}

export function RunForm({
  open,
  onOpenChange,
  definition,
  branch,
  run,
  modelCatalog,
  purposeBindings,
  assignments,
  profilesUnavailable,
  onSubmit,
  onResume,
  onSaved,
}: RunFormProps) {
  const formId = useId();
  const { draft, setDraft, reset, clear, hasConflict, rebase } = useStoredDraft<RunDraft>(
    `run:${branch.id}`,
    () => ({ settings: runSettingsFromRun(run), expectedRevision: branch.revision }),
    { open, expectedRevision: branch.revision },
  );
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const generation = useGenerationOptions(open);
  const engines = generation.data?.engines ?? [];
  const workflows = generation.data?.workflows ?? [];
  const imageConfig = draft.settings.imageConfig;
  const selectedImageEngine = engines.find((engine) => engine.id === imageConfig?.engineId);
  const imageWorkflows = workflowsForEngine(workflows, selectedImageEngine);
  const active = run?.status === 'queued' || run?.status === 'running';
  const paused = run?.status === 'paused';
  const blocked = active || run?.status === 'uncertain' || (paused && !onResume);
  const startTick = paused && run ? run.startTick : branch.currentTick;
  const targetTick = paused && run ? resumeTargetTick(run, draft.settings) : runTargetTick(branch, draft.settings);
  const textPercent = quotaPercent(run?.textCallsUsed ?? 0, draft.settings.maxTextCalls);
  const imagePercent = quotaPercent(run?.imagesSubmitted ?? 0, draft.settings.maxImages);

  const updateSetting = <K extends keyof WorldRunSettings>(key: K, value: WorldRunSettings[K]) => {
    setDraft((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  };

  const updateImageConfig = (patch: { engineId?: string; workflowId?: string; model?: string }) => {
    setDraft((current) => {
      const existing = current.settings.imageConfig;
      const engineId = patch.engineId !== undefined ? patch.engineId : existing?.engineId ?? '';
      if (!engineId) {
        return { ...current, settings: { ...current.settings, imageConfig: undefined } };
      }
      const workflowId = patch.workflowId !== undefined ? patch.workflowId : existing?.workflowId ?? '';
      const model = patch.model !== undefined ? patch.model : existing?.model ?? '';
      return {
        ...current,
        settings: {
          ...current.settings,
          imageConfig: {
            engineId,
            ...(workflowId ? { workflowId } : {}),
            ...(model.trim() ? { model: model.trim() } : {}),
          },
        },
      };
    });
  };

  const normalizedSettings = (settings: WorldRunSettings): WorldRunSettings => {
    const { imageConfig: config, ...rest } = settings;
    if (!settings.autoImages || !config?.engineId) return rest;
    return {
      ...rest,
      imageConfig: {
        engineId: config.engineId,
        ...(config.workflowId ? { workflowId: config.workflowId } : {}),
        ...(config.model?.trim() ? { model: config.model.trim() } : {}),
      },
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || blocked) return;
    const { settings } = draft;
    if (settings.durationTicks < 1 || settings.durationTicks > 10_080) {
      setValidationError('推进时长需要在 1–10080 分钟之间。');
      return;
    }
    if (settings.stepTicks < 1 || settings.stepTicks > 1_440) {
      setValidationError('步长需要在 1–1440 分钟之间。');
      return;
    }
    if (settings.stepTicks > settings.durationTicks) {
      setValidationError('步长不能大于总推进时长。');
      return;
    }
    if (settings.maxTextCalls < 1 || settings.maxTextCalls > 10_000) {
      setValidationError('文本调用额度需要在 1–10000 次之间。');
      return;
    }
    if (settings.maxImages < 0 || settings.maxImages > 100) {
      setValidationError('配图额度需要在 0–100 幅之间。');
      return;
    }
    if (settings.autoImages) {
      if (generation.isError) {
        setValidationError('生成配置读取失败，不能启动自动配图。');
        return;
      }
      if (!imageConfig?.engineId) {
        setValidationError('勾选自动配图后必须明确选择图片引擎，不会自动使用第一个引擎。');
        return;
      }
      if (!selectedImageEngine) {
        setValidationError('所选图片引擎不存在或尚未加载完成。');
        return;
      }
      if (!selectedImageEngine.enabled) {
        setValidationError(`图片引擎「${selectedImageEngine.name}」已停用。`);
        return;
      }
      if (imageWorkflows.length > 0 && !imageConfig.workflowId) {
        setValidationError('该图片引擎有可用工作流，请明确选择工作流。');
        return;
      }
      if (settings.maxImages < 1) {
        setValidationError('自动配图需要配图额度至少为 1。');
        return;
      }
    }
    const settingsForSubmit = normalizedSettings(settings);
    if (paused && run) {
      const resumeError = validateResumeSettings(run, settingsForSubmit);
      if (resumeError) {
        setValidationError(resumeError);
        return;
      }
      if (settings.maxTextCalls <= run.textCallsUsed) {
        setValidationError(`文本调用额度需要高于已使用的 ${run.textCallsUsed} 次，否则恢复后会立即因额度耗尽暂停。`);
        return;
      }
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const result = paused && run && onResume
        ? await onResume({
            expectedRevision: branch.revision,
            settings: settingsForSubmit,
          })
        : await onSubmit({
            expectedRevision: branch.revision,
            idempotencyKey: idempotencyKey('run', {
              branchId: branch.id,
              settings: settingsForSubmit,
              expectedRevision: branch.revision,
            }),
            settings: settingsForSubmit,
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
      title="运行设置"
      description="启动后服务端会在额度内自动推进；关闭网页不会停止后台运行，重新打开会恢复状态。"
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
            关闭
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting} disabled={blocked}>
            {paused ? '更新额度并恢复' : '启动运行'}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        {hasConflict && (
          <Alert variant="warning" title="分支修订版本已更新">
            分支已推进至修订版 {branch.revision}（草稿基于修订版 {draft.expectedRevision}）。
            您可以保留设置并更新修订基底，或重置草稿。
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
        {Boolean(error?.trim()) && <Alert variant="danger" title={paused ? '恢复失败' : '启动失败'}>{error}</Alert>}
        {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能提交">{validationError}</Alert>}
        {blocked && (
          <Alert variant="info" title="当前运行尚未结束">
            {run?.status === 'uncertain'
                ? '上游结果不明，服务需要先核对已有任务，不能直接重复提交。'
                : '一个分支同时只允许一个推进任务。'}
          </Alert>
        )}
        {paused && run && (
          <Alert variant="info" title="已暂停，可更新额度后恢复">
            可以增加文本调用或配图额度，也可以延长目标时刻；文本额度需要高于已使用的 {run.textCallsUsed} 次，配图额度不能低于 {run.imagesSubmitted} 幅，目标时刻不能早于 {formatTick(run.targetTick)}。
          </Alert>
        )}

        <FormSection title="本次推进" description="时间从世界起点起算；达到时长或文本调用额度时先到者暂停。">
          <ShortFieldGrid>
            <FormField label="推进时长（分钟）" required hint={`约 ${formatDuration(draft.settings.durationTicks)}`}>
              <Input
                type="number"
                min={1}
                max={10_080}
                value={draft.settings.durationTicks}
                onChange={(event) => updateSetting('durationTicks', Number(event.target.value))}
              />
            </FormField>
            <FormField label="文本调用硬额度" required hint="失败后的修正调用也计入。">
              <Input
                type="number"
                min={1}
                max={10_000}
                value={draft.settings.maxTextCalls}
                onChange={(event) => updateSetting('maxTextCalls', Number(event.target.value))}
              />
            </FormField>
          </ShortFieldGrid>
          <details open className="rounded-panel border border-border-subtle bg-surface-sunken/25 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">步长与配图额度</summary>
            <ShortFieldGrid className="mt-4">
              <FormField label="单步时长（分钟）" required hint="重要互动会拆分到更细的事件。">
                <Input
                  type="number"
                  min={1}
                  max={1_440}
                  value={draft.settings.stepTicks}
                  onChange={(event) => updateSetting('stepTicks', Number(event.target.value))}
                />
              </FormField>
              <FormField label="配图提交额度" required hint="失败请求也计入已提交额度。">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.settings.maxImages}
                  onChange={(event) => updateSetting('maxImages', Number(event.target.value))}
                />
              </FormField>
            </ShortFieldGrid>
          </details>
          <Switch
            label="自动规划配图"
            description="只生成配图计划并排队；图片延迟不会阻塞故事阅读。"
            checked={draft.settings.autoImages}
            onChange={(event) => updateSetting('autoImages', event.target.checked)}
          />
          {draft.settings.autoImages && (
            <details open className="rounded-panel border border-border-subtle bg-surface-sunken/40 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">自动配图路径</summary>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                必须明确选择图片引擎和工作流；不会自动使用第一个引擎。路径缺失时不能启动。
              </p>
              <div className="mt-4 space-y-4">
              {generation.isError && (
                <Alert variant="danger" title="生成配置读取失败">
                  {describeError(generation.error)} 自动配图无法确认可用路径。
                </Alert>
              )}
              {generation.isLoading && <p className="text-sm text-muted">正在读取现有生成引擎与工作流…</p>}
              <FormField label="图片引擎" required>
                <Select
                  value={imageConfig?.engineId ?? ''}
                  onChange={(event) => {
                    const engineId = event.target.value;
                    updateImageConfig({ engineId, workflowId: '', model: '' });
                  }}
                >
                  <option value="">选择图片引擎</option>
                  {engines.map((engine) => (
                    <option key={engine.id} value={engine.id}>
                      {engine.name}（{engine.kind}{engine.enabled ? '' : ' · 已停用'}）
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                label="工作流"
                required={imageWorkflows.length > 0}
                hint={selectedImageEngine
                  ? imageWorkflows.length > 0
                    ? '只列出与该引擎匹配的工作流。'
                    : '该引擎没有匹配的已发布工作流；服务端会按引擎默认路径处理或明确失败。'
                  : '先选择图片引擎。'}
              >
                <Select
                  value={imageConfig?.workflowId ?? ''}
                  onChange={(event) => updateImageConfig({ workflowId: event.target.value })}
                  disabled={!selectedImageEngine}
                >
                  <option value="">{imageWorkflows.length > 0 ? '选择工作流' : '引擎默认工作流'}</option>
                  {imageWorkflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}{workflow.latest_version ? ` · v${workflow.latest_version}` : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="模型覆盖" hint="可选；留空时按工作流或服务端配置。">
                <Input
                  value={imageConfig?.model ?? ''}
                  maxLength={300}
                  onChange={(event) => updateImageConfig({ model: event.target.value })}
                  placeholder="例如：某个检查点名称"
                />
              </FormField>
              <div className="rounded-control bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
                <p className="font-medium text-ink">实际路径</p>
                <p className="mt-1">
                  {selectedImageEngine
                    ? `${selectedImageEngine.name}${imageConfig?.workflowId
                        ? ` · ${imageWorkflows.find((workflow) => workflow.id === imageConfig.workflowId)?.name ?? imageConfig.workflowId}`
                        : ' · 引擎默认工作流'}${imageConfig?.model?.trim() ? ` · ${imageConfig.model.trim()}` : ' · 工作流默认模型'}`
                    : '尚未选择图片引擎'}
                </p>
                <p className="mt-2">
                  一致性限制：角色/地点参考与 LoRA 是否生效取决于所选工作流能力。未支持的路径会明确失败或保留待配图，不会假装成功。
                </p>
              </div>
              </div>
            </details>
          )}
          <div className="rounded-control bg-surface-sunken/55 px-4 py-3 text-sm leading-relaxed text-muted">
            时间范围：{formatTick(startTick)} → {formatTick(targetTick)}
            <br />
            调用量是硬限制。当前没有可用的价格配置，因此不显示费用估算。
          </div>
        </FormSection>

        <details className="rounded-panel border border-border-subtle bg-surface-sunken/25 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">生效模型</summary>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            按服务端的解析顺序显示：世界显式绑定、用途绑定、应用文本默认。
          </p>
          <div className="mt-4 space-y-4">
          {profilesUnavailable && (
            <Alert variant="warning" title="模型名称暂不可用">公共模型配置读取失败；运行仍由服务端按现有配置处理。</Alert>
          )}
          <dl className="space-y-2 text-sm">
            {([
              ['action', '人物行动'],
              ['adjudication', '环境裁定'],
              ['narration', '叙事整理'],
            ] as const).map(([key, label]) => (
              (() => {
                const effective = resolveEffectiveModel(key, definition.models[key], {
                  catalog: modelCatalog,
                  purposeBindings,
                  assignments,
                });
                return (
                  <div key={key} className="rounded-control bg-surface-sunken/40 px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <dt className="text-muted">{label}</dt>
                      <dd className="min-w-0 break-words text-ink">{effective.label}</dd>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {effective.source === 'explicit'
                        ? '世界冻结定义中的显式绑定'
                        : effective.source === 'purpose'
                          ? '故事世界用途绑定'
                          : effective.source === 'app'
                            ? '应用文本默认'
                            : '当前不可用'}
                    </p>
                    {effective.warning && <p className="mt-1 text-xs leading-relaxed text-warning-fg">{effective.warning}</p>}
                  </div>
                );
              })()
            ))}
          </dl>
          {modelCatalog.length > 0 && (
            <p className="text-xs leading-relaxed text-muted">
              当前可用模型：{modelCatalog.filter((profile) => profile.capabilities.includes('text')).map(modelOptionLabel).join('；') || '没有文本模型'}
            </p>
          )}
          </div>
        </details>

        {run && (
          <FormSection title="当前运行" description="服务端保存进度与调用记录；刷新页面不会重置已完成的步骤。">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={runStatusTone(run.status)} dot>{runStatusLabel(run.status)}</Badge>
              <span className="text-xs text-muted">
                已推进到 {formatTick(run.completedTick)} / 目标 {formatTick(run.targetTick)}
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span>文本调用</span>
                <span>{formatQuota(run.textCallsUsed, draft.settings.maxTextCalls)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/8" aria-hidden="true">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${textPercent}%` }} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span>配图提交</span>
                <span>{formatQuota(run.imagesSubmitted, draft.settings.maxImages)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/8" aria-hidden="true">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${imagePercent}%` }} />
              </div>
            </div>
            {run.pauseReason && (
              <Alert variant={run.status === 'failed' ? 'danger' : 'warning'} title="运行说明">
                {run.pauseReason}
              </Alert>
            )}
          </FormSection>
        )}
      </form>
    </Dialog>
  );
}
