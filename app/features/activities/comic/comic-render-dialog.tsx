'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityLoraOverride, ComicJob, ComicPanel, ComicRenderPreview, SceneBeatRenderSettings } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { useActivityComicGenerationOptions } from '../queries';
import { useCreateComicPanelRender, usePreviewComicPanelRender } from '../mutations';
import type { Workflow, WorkflowVersion } from '@/app/features/generation/types';

interface ComicRenderDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  activityId: string;
  draftVersion: number | null;
  panel: ComicPanel;
  actorReferenceKeys: Array<{ key: string; actorName: string }>;
  onSettingsChange(settings: SceneBeatRenderSettings): void;
  flush(): Promise<boolean>;
  getDraftVersion(): number | null;
  onSubmitted(job: ComicJob): void;
}

const controlClass = 'w-full rounded-[var(--radius-control)] border border-border-default bg-surface px-2.5 py-2 text-sm text-ink';
const labelClass = 'block space-y-1 text-xs font-medium text-muted';
type RenderOption = { key: string; purpose: string; workflowId: string; workflowVersion: number; presetId?: string; presetRevision?: number; label: string };
type EditableField = { key: string; label: string; type: string; min?: number; max?: number; step?: number; options?: string[]; required: boolean };

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function workflowVersion(workflows: Workflow[] | undefined, workflowId: string, version: number): WorkflowVersion | undefined {
  return workflows?.find((item) => item.id === workflowId)?.versions.find((item) => item.version === version && item.isPublished);
}

function editableFields(version: WorkflowVersion | undefined): EditableField[] {
  if (!version) return [];
  const schema = record(version.inputSchema);
  const editorFields = record(version.editorConfig?.fields);
  return Object.entries(schema).flatMap(([key, raw]) => {
    const input = record(raw);
    const editor = record(editorFields[key]);
    const semantic = String(input.semantic ?? key).toLowerCase().replaceAll('_', '');
    if (['prompt', 'positiveprompt', 'negativeprompt', 'seed'].includes(semantic)) return [];
    const rawType = String(editor.type ?? input.type ?? 'text');
    if (!['integer', 'number', 'seed', 'model', 'enum', 'text', 'long-text'].includes(rawType)) return [];
    const allowed = Array.isArray(editor.allowedModels) ? editor.allowedModels.filter((item): item is string => typeof item === 'string')
      : Array.isArray(editor.enumValues) ? editor.enumValues.filter((item): item is string => typeof item === 'string') : [];
    return [{ key, label: String(editor.label ?? key), type: rawType,
      ...(typeof editor.minimum === 'number' ? { min: editor.minimum } : {}), ...(typeof editor.maximum === 'number' ? { max: editor.maximum } : {}),
      ...(typeof editor.step === 'number' ? { step: editor.step } : {}), ...(allowed.length ? { options: allowed } : {}), required: input.required === true }];
  });
}

export function ComicRenderDialog({ open, onOpenChange, activityId, draftVersion, panel, actorReferenceKeys, onSettingsChange, flush, getDraftVersion, onSubmitted }: ComicRenderDialogProps) {
  const optionsQuery = useActivityComicGenerationOptions();
  const previewMutation = usePreviewComicPanelRender();
  const submitMutation = useCreateComicPanelRender();
  const settings = panel.renderSettings;
  const [preview, setPreview] = useState<ComicRenderPreview | null>(null);
  const submitAttempt = useRef<{ planHash: string; draftVersion: number; seed: number; idempotencyKey: string } | null>(null);
  const attemptStorageKey = `sthstart:comic-render-attempt:${activityId}:${panel.id}`;
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<number>(settings.parameters?.seed as number | undefined ?? Math.floor(Math.random() * 2_147_483_647));

  const renderOptions = useMemo<RenderOption[]>(() => {
    const data = optionsQuery.data;
    if (!data) return [];
    const result: RenderOption[] = [];
    for (const assignment of data.assignments) {
      const workflow = data.workflows.find((item) => item.id === assignment.workflow_id);
      const version = workflow?.versions.find((item) => item.version === assignment.workflow_version && item.isPublished);
      if (!workflow || !version || (workflow.category ?? version.category) !== 'image') continue;
      result.push({ key: `workflow:${assignment.purpose}:${workflow.id}:${version.version}`, purpose: assignment.purpose,
        workflowId: workflow.id, workflowVersion: version.version, label: `${assignment.purpose} · ${workflow.name} v${version.version}` });
    }
    for (const preset of data.presets) {
      const workflow = data.workflows.find((item) => item.id === preset.workflowId);
      if (!workflow || (workflow.category !== 'image' && workflow.versions.find((version) => version.version === preset.workflowVersion)?.category !== 'image')) continue;
      result.push({ key: `preset:${preset.id}:${preset.revision}`, purpose: preset.purpose, workflowId: preset.workflowId,
        workflowVersion: preset.workflowVersion, presetId: preset.id, presetRevision: preset.revision,
        label: `${preset.purpose} · 预设：${preset.name} r${preset.revision}` });
    }
    return result;
  }, [optionsQuery.data]);

  const selectedOption = renderOptions.find((option) => option.workflowId === settings.workflowId && option.workflowVersion === settings.workflowVersion
    && (settings.presetId ? option.presetId === settings.presetId : !option.presetId)) ?? null;
  const selectedVersion = selectedOption ? workflowVersion(optionsQuery.data?.workflows, selectedOption.workflowId, selectedOption.workflowVersion) : undefined;
  const fields = editableFields(selectedVersion);

  useEffect(() => {
    if (!open) { setPreview(null); setError(null); return; }
    try {
      const stored = sessionStorage.getItem(attemptStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as typeof submitAttempt.current;
        if (parsed && typeof parsed.planHash === 'string' && typeof parsed.idempotencyKey === 'string' && Number.isInteger(parsed.seed)) submitAttempt.current = parsed;
      }
    } catch { /* an unavailable session store still permits submission */ }
    setSeed(typeof settings.parameters?.seed === 'number' ? settings.parameters.seed : submitAttempt.current?.seed ?? Math.floor(Math.random() * 2_147_483_647));
  // Only reset for a different panel/open lifecycle, not every autosaved settings change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panel.id]);

  const updateSettings = (patch: Partial<SceneBeatRenderSettings>) => {
    onSettingsChange({ ...settings, ...patch });
    submitAttempt.current = null;
    try { sessionStorage.removeItem(attemptStorageKey); } catch { /* optional retry persistence */ }
    setPreview(null);
    setError(null);
  };
  const updateParameter = (key: string, value: unknown) => updateSettings({ parameters: { ...(settings.parameters ?? {}), [key]: value } });

  const runPreview = async () => {
    if (!draftVersion || !await flush()) { setError('漫画草稿未保存，先处理顶部的保存状态。'); return; }
    setError(null);
    const nextSeed = typeof settings.parameters?.seed === 'number' ? settings.parameters.seed : seed;
    try {
      const expectedDraftVersion = getDraftVersion() ?? draftVersion;
      const result = await previewMutation.mutateAsync({ activityId, panelId: panel.id, expectedDraftVersion, seed: nextSeed });
      if (submitAttempt.current && (submitAttempt.current.planHash !== result.planHash || submitAttempt.current.draftVersion !== expectedDraftVersion)) {
        submitAttempt.current = null;
        try { sessionStorage.removeItem(attemptStorageKey); } catch { /* optional retry persistence */ }
      }
      setPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '绘制预览失败。'); }
  };

  const submit = async () => {
    if (!preview || !preview.canSubmit || !draftVersion || !await flush()) { setError('请先完成可提交的配置预览，并确认漫画草稿已保存。'); return; }
    try {
      const expectedDraftVersion = getDraftVersion() ?? draftVersion;
      const attempt = submitAttempt.current?.planHash === preview.planHash && submitAttempt.current.draftVersion === expectedDraftVersion
        ? submitAttempt.current : { planHash: preview.planHash, draftVersion: expectedDraftVersion, seed: preview.seed, idempotencyKey: crypto.randomUUID() };
      submitAttempt.current = attempt;
      try { sessionStorage.setItem(attemptStorageKey, JSON.stringify(attempt)); } catch { /* in-memory retry remains available */ }
      const job = await submitMutation.mutateAsync({ activityId, panelId: panel.id, request: {
        expectedDraftVersion, planHash: preview.planHash, seed: preview.seed, idempotencyKey: attempt.idempotencyKey,
      } });
      submitAttempt.current = null;
      try { sessionStorage.removeItem(attemptStorageKey); } catch { /* optional retry persistence */ }
      onSubmitted(job);
      onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '绘制任务提交失败。'); }
  };

  const selectRenderOption = (key: string) => {
    const option = renderOptions.find((item) => item.key === key);
    if (!option) { updateSettings({ purpose: undefined, workflowId: undefined, workflowVersion: undefined, presetId: undefined, presetRevision: undefined }); return; }
    updateSettings({ purpose: option.purpose, workflowId: option.workflowId, workflowVersion: option.workflowVersion,
      presetId: option.presetId, presetRevision: option.presetRevision });
  };

  const setLoraEnabled = (model: string, enabled: boolean, strength: number) => {
    const current = new Map((settings.loraOverrides ?? []).map((item) => [item.model, item]));
    const old = current.get(model);
    const next: ActivityLoraOverride[] = [...current.values()].filter((item) => item.model !== model);
    next.push({ model, strength: old?.strength ?? strength, triggerWord: old?.triggerWord ?? '', enabled });
    updateSettings({ loraOverrides: next });
  };
  const setLoraStrength = (model: string, strength: number, enabled: boolean) => {
    const current = new Map((settings.loraOverrides ?? []).map((item) => [item.model, item]));
    const old = current.get(model);
    const next: ActivityLoraOverride[] = [...current.values()].filter((item) => item.model !== model);
    next.push({ model, strength, triggerWord: old?.triggerWord ?? '', enabled: old?.enabled ?? enabled });
    updateSettings({ loraOverrides: next });
  };

  return <Dialog open={open} onOpenChange={onOpenChange} title="画格绘制设置" description="提示词会在提交前由活动文本模型优化；工作流和 LoRA 以预览快照为准。" size="lg" className="max-h-[92dvh]">
    <div className="space-y-4">
      <label className={labelClass}>工作流 / 预设
        <select className={controlClass} value={selectedOption?.key ?? ''} onChange={(event) => selectRenderOption(event.target.value)}>
          <option value="">使用活动默认绑定</option>{renderOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      {optionsQuery.isLoading && <p className="text-xs text-muted">正在读取已发布的活动图片工作流…</p>}
      <label className={labelClass}>补充画面要求<textarea className={`${controlClass} min-h-20 resize-y`} maxLength={20_000} value={settings.customPrompt ?? ''}
        onChange={(event) => updateSettings({ customPrompt: event.target.value })} placeholder="例如：柔和的电影感逆光，保持角色服装细节。" /></label>
      <div className="rounded-[var(--radius-panel)] border border-border-default p-3">
        <h3 className="text-xs font-semibold text-ink">角色 LoRA</h3><p className="mt-1 text-xs text-muted">默认继承全局和角色设置，可按画格关闭或调权。</p>
        {preview?.loras.length ? <div className="mt-2 space-y-2">{preview.loras.map((lora) => {
          const override = settings.loraOverrides?.find((item) => item.model === lora.model);
          const enabled = override?.enabled ?? lora.enabled;
          const strength = override?.strength ?? lora.strength;
          return <div key={lora.model} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs">
            <label className="flex min-w-0 items-center gap-2 text-ink"><input type="checkbox" checked={enabled} onChange={(event) => setLoraEnabled(lora.model, event.target.checked, lora.strength)} /><span className="truncate" title={lora.model}>{lora.model}</span></label>
            <span className={lora.available ? 'text-success' : 'text-danger'}>{lora.available ? '可用' : '缺失'}</span>
            <input className="col-span-2 w-full accent-accent" type="range" min={-2} max={2} step={0.05} value={strength} disabled={!enabled}
              aria-label={`${lora.model} 强度`} onChange={(event) => setLoraStrength(lora.model, Number(event.target.value), enabled)} />
          </div>;
        })}</div> : <p className="mt-2 text-xs text-muted">先预览工作流，检查当前会继承的 LoRA。</p>}
      </div>
      <details className="rounded-[var(--radius-panel)] border border-border-default p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">高级设置：负向词、角色参考、种子与采样参数</summary>
        <div className="mt-3 space-y-3">
          <label className={labelClass}>反向提示词<textarea className={`${controlClass} min-h-16 resize-y`} maxLength={20_000} value={settings.negativePrompt ?? ''}
            onChange={(event) => updateSettings({ negativePrompt: event.target.value })} placeholder="留空时使用工作流提示词策略默认值" /></label>
          <label className={labelClass}>角色参考图<select className={controlClass} value={settings.referenceAssetKey ?? ''} onChange={(event) => updateSettings({ referenceAssetKey: event.target.value || undefined })}>
            <option value="">不使用参考图</option>{actorReferenceKeys.map((item) => <option key={item.key} value={item.key}>{item.actorName} · {item.key}</option>)}
          </select></label>
          <label className={labelClass}>随机种子<input className={controlClass} type="number" min={0} max={2_147_483_647} step={1} value={seed}
            onChange={(event) => { const next = Math.max(0, Math.min(2_147_483_647, Math.floor(Number(event.target.value) || 0))); setSeed(next); setPreview(null); }} /></label>
          {fields.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{fields.map((field) => {
            const value = settings.parameters?.[field.key] ?? '';
            return <label key={field.key} className={labelClass}>{field.label}{field.options?.length ? <select className={controlClass} value={String(value)} onChange={(event) => updateParameter(field.key, event.target.value)}>
              <option value="">使用预设 / 工作流默认值</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select> : field.type === 'integer' || field.type === 'number' || field.type === 'seed' ? <input className={controlClass} type="number"
              min={field.min ?? (field.key.toLowerCase().includes('width') || field.key.toLowerCase().includes('height') ? 256 : undefined)}
              max={field.max} step={field.step ?? (field.type === 'integer' || field.type === 'seed' ? 1 : 0.1)} value={String(value)}
              onChange={(event) => updateParameter(field.key, event.target.value === '' ? undefined : Number(event.target.value))} />
              : <input className={controlClass} type="text" value={String(value)} onChange={(event) => updateParameter(field.key, event.target.value)} />}</label>;
          })}</div>}
        </div>
      </details>
      {preview && <section className="rounded-[var(--radius-panel)] border border-border-default bg-surface-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><strong className="text-ink">{preview.workflowName} v{preview.workflowVersion}</strong><span className="text-muted">模型：{preview.model || '工作流未识别模型'}</span><span className="text-muted">种子：{preview.seed}</span></div>
        <p className="mt-2 text-xs font-semibold text-ink">优化前提示词</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">{preview.positivePrompt}</pre>
        <p className="mt-2 text-xs font-semibold text-ink">反向提示词</p><p className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap text-xs text-muted">{preview.negativePrompt || '工作流未使用反向提示词输入'}</p>
        {preview.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-warning">{preview.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>}
        {!preview.canSubmit && <p role="alert" className="mt-2 text-xs font-medium text-danger">配置检查未通过，不能提交绘制。</p>}
      </section>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle pt-3">
        <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        <Button variant="outline" loading={previewMutation.isPending} disabled={!draftVersion} onClick={() => void runPreview()}>检查绘制配置</Button>
        <Button variant="primary" loading={submitMutation.isPending} disabled={!preview?.canSubmit || !draftVersion} onClick={() => void submit()}>提交绘制</Button>
      </div>
    </div>
  </Dialog>;
}
