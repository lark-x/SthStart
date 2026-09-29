'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityLoraOverride, ComicJob, ComicPanel, ComicRenderPreview, SceneBeatRenderSettings } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import Link from 'next/link';
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
  const drawing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrow(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
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
        workflowId: workflow.id, workflowVersion: version.version, label: workflow.name });
    }
    for (const preset of data.presets) {
      if (!preset.enabled) continue;
      const workflow = data.workflows.find((item) => item.id === preset.workflowId);
      if (!workflow || (workflow.category !== 'image' && workflow.versions.find((version) => version.version === preset.workflowVersion)?.category !== 'image')) continue;
      result.push({ key: `preset:${preset.id}:${preset.revision}`, purpose: preset.purpose, workflowId: preset.workflowId,
        workflowVersion: preset.workflowVersion, presetId: preset.id, presetRevision: preset.revision,
        label: preset.name });
    }
    return result;
  }, [optionsQuery.data]);

  const selectedOption = renderOptions.find((option) => option.workflowId === settings.workflowId && option.workflowVersion === settings.workflowVersion
    && (settings.presetId ? option.presetId === settings.presetId : !option.presetId)) ?? null;
  const defaultPurpose = settings.referenceAssetKey ? 'activity_image_edit' : 'activity_image_text';
  const defaultOption = !settings.workflowId && !settings.presetId
    ? renderOptions.find((option) => option.purpose === defaultPurpose && option.presetId
      && optionsQuery.data?.presets.some((preset) => preset.id === option.presetId && preset.isDefault))
      ?? renderOptions.find((option) => option.purpose === defaultPurpose && !option.presetId)
      ?? renderOptions.find((option) => option.purpose === 'activity_media_slot' && option.presetId
        && optionsQuery.data?.presets.some((preset) => preset.id === option.presetId && preset.isDefault))
      ?? renderOptions.find((option) => option.purpose === 'activity_media_slot' && !option.presetId)
    : null;
  const fieldOption = selectedOption ?? defaultOption;
  const selectedVersion = fieldOption ? workflowVersion(optionsQuery.data?.workflows, fieldOption.workflowId, fieldOption.workflowVersion) : undefined;
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
      return { preview: result, expectedDraftVersion };
    } catch (reason) { setError(reason instanceof Error ? reason.message : '绘制预览失败。'); }
  };

  const submit = async () => {
    if (drawing.current) return;
    drawing.current = true; setBusy(true);
    try {
      const checked = await runPreview();
      if (!checked) return;
      const { preview: current, expectedDraftVersion } = checked;
      if (!current.canSubmit) { setError(current.warnings.join(' ') || '当前绘制配置不可用，请检查生成配置。'); return; }
      if (getDraftVersion() !== expectedDraftVersion) { setError('画格内容刚刚发生变化，请再次绘制。'); return; }
      const attempt = submitAttempt.current?.planHash === current.planHash && submitAttempt.current.draftVersion === expectedDraftVersion
        ? submitAttempt.current : { planHash: current.planHash, draftVersion: expectedDraftVersion, seed: current.seed, idempotencyKey: crypto.randomUUID() };
      submitAttempt.current = attempt;
      try { sessionStorage.setItem(attemptStorageKey, JSON.stringify(attempt)); } catch { /* in-memory retry remains available */ }
      const job = await submitMutation.mutateAsync({ activityId, panelId: panel.id, request: {
        expectedDraftVersion, planHash: current.planHash, seed: current.seed, idempotencyKey: attempt.idempotencyKey,
      } });
      submitAttempt.current = null;
      try { sessionStorage.removeItem(attemptStorageKey); } catch { /* optional retry persistence */ }
      onSubmitted(job);
      setSeed(Math.floor(Math.random() * 2_147_483_647));
      onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '绘制任务提交失败。'); }
    finally { drawing.current = false; setBusy(false); }
  };

  const selectRenderOption = (key: string) => {
    const option = renderOptions.find((item) => item.key === key);
    if (!option) { updateSettings({ purpose: undefined, workflowId: undefined, workflowVersion: undefined, presetId: undefined, presetRevision: undefined, parameters: undefined }); return; }
    updateSettings({ purpose: option.purpose, workflowId: option.workflowId, workflowVersion: option.workflowVersion,
      presetId: option.presetId, presetRevision: option.presetRevision, parameters: undefined });
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

  const content = (
    <div className="space-y-4">
      <fieldset disabled={busy} className="min-w-0 space-y-4">
      <label className={labelClass}>绘制预设
        <select className={controlClass} value={selectedOption?.key ?? ''} onChange={(event) => selectRenderOption(event.target.value)}>
          <option value="">跟随活动默认配置</option>{renderOptions.filter((option) => option.presetId || option.key === selectedOption?.key).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      {optionsQuery.isLoading && <p className="text-xs text-muted">正在读取已发布的活动图片工作流…</p>}
      <label className={labelClass}>补充画面要求<textarea className={`${controlClass} min-h-20 resize-y`} maxLength={20_000} value={settings.customPrompt ?? ''}
        onChange={(event) => updateSettings({ customPrompt: event.target.value })} placeholder="例如：柔和的电影感逆光，保持角色服装细节。" /></label>
      <Link href="/settings/generation" target="_blank" className="inline-flex text-xs text-accent hover:underline">管理默认配置 / 测试连接</Link>
      <details className="rounded-[var(--radius-panel)] border border-border-default p-3" onToggle={(event) => { if (event.currentTarget.open && !preview && !previewMutation.isPending) void runPreview(); }}>
        <summary className="cursor-pointer text-sm font-medium text-ink">LoRA · 继承角色与活动配置</summary><p className="mt-1 text-xs text-muted">可按画格关闭或调权。</p>
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
        })}</div> : <p className="mt-2 text-xs text-muted">{previewMutation.isPending ? '正在读取 LoRA 配置…' : '本次未启用角色 LoRA。'}</p>}
      </details>
      <details className="rounded-[var(--radius-panel)] border border-border-default p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">高级设置：负向词、角色参考、种子与采样参数</summary>
        <div className="mt-3 space-y-3">
          <label className={labelClass}>切换其他工作流<select className={controlClass} value={selectedOption?.key ?? ''} onChange={(event) => selectRenderOption(event.target.value)}><option value="">跟随活动默认配置</option>{renderOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
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
      {preview && <details className="rounded-[var(--radius-panel)] border border-border-default bg-surface-muted/40 p-3"><summary className="cursor-pointer text-sm text-muted">查看提示词与实际配置</summary>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><strong className="text-ink">{preview.workflowName} v{preview.workflowVersion}</strong><span className="text-muted">模型：{preview.model || '工作流未识别模型'}</span><span className="text-muted">种子：{preview.seed}</span></div>
        <p className="mt-2 text-xs font-semibold text-ink">优化前提示词</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">{preview.positivePrompt}</pre>
        <p className="mt-2 text-xs font-semibold text-ink">反向提示词</p><p className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap text-xs text-muted">{preview.negativePrompt || '工作流未使用反向提示词输入'}</p>
        {preview.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-warning">{preview.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>}
        {!preview.canSubmit && <p role="alert" className="mt-2 text-xs font-medium text-danger">配置检查未通过，不能提交绘制。</p>}
      </details>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle pt-3">
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>完成</Button>
        <Button variant="primary" loading={busy} disabled={!draftVersion || busy || previewMutation.isPending} onClick={() => void submit()}>{previewMutation.isPending ? '检查连接与配置…' : '绘制新图'}</Button>
      </div>
    </div>
  );
  const description = '使用默认配置即可绘制；连接检查和提示词处理会自动完成。';
  return narrow ? <Drawer open={open} onOpenChange={onOpenChange} position="bottom" title="画格绘制" description={description}>{content}</Drawer>
    : <Dialog open={open} onOpenChange={onOpenChange} title="画格绘制" description={description} size="lg" className="max-h-[92dvh]">{content}</Dialog>;
}
