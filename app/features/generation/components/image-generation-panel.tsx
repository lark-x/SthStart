'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { generateId } from '@/app/lib/uuid';
import type { CreativePurposeOptions, ImagePreparationResponse, ImageConfiguration } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { prepareImageGeneration, type ImageGenerationSubmission } from '../image-api';
import { ImageModeSwitch, useImageAdvancedMode } from './image-mode-switch';
import { ImageParameterFields } from './image-parameter-fields';

export type ImageGenerationInitial = { presetId?: string; parameters: Record<string, unknown>; description?: string; seed?: number | null };

const SCENE_STYLE_PRESETS = [
  { id: 'free', label: '默认自由', promptSuffix: '' },
  { id: 'anime', label: '动漫立绘', promptSuffix: '，精致二次元动漫立绘，细腻光影，高完成度角色设计' },
  { id: 'storyboard', label: '连环分镜', promptSuffix: '，连环分镜漫画构图，电影景深镜头，动感与戏剧张力' },
  { id: 'cinematic', label: '电影胶片', promptSuffix: '，电影胶片质感，真实光影，情绪电影感色调，大师级氛围' },
  { id: 'painterly', label: '厚涂插画', promptSuffix: '，艺术厚涂插画，油画肌理，饱满层次与细腻笔触' },
];

/** One form for all image consumers. Mode changes only presentation, never generation state. */
export function ImageGenerationPanel({ appId, purpose, contextKey, options, initial, initialDescription = '', referenceInput,
  onGenerate, onRefresh, onConfigurationChange, loading = false, blockedReason, submitLabel = '开始生成' }: {
  appId: 'creative-center' | 'characters'; purpose: string; contextKey: string;
  options?: CreativePurposeOptions; initial?: ImageGenerationInitial | null; initialDescription?: string;
  referenceInput?: React.ReactNode;
  onConfigurationChange?(configuration: ImageConfiguration | undefined): void;
  onGenerate(input: ImageGenerationSubmission): Promise<void>; onRefresh?(): void; loading?: boolean;
  blockedReason?: string; submitLabel?: string;
}) {
  const id = useId();
  const [activeStyle, setActiveStyle] = useState<string>('free');
  const [advanced, setAdvanced] = useImageAdvancedMode(contextKey);
  const [description, setDescription] = useState(initialDescription);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [ai, setAi] = useState(true);
  const [manual, setManual] = useState(false);
  const [prepared, setPrepared] = useState<ImagePreparationResponse | null>(null);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'submitting'>('idle');
  const [error, setError] = useState('');
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const restored = useRef(false);
  const running = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const storageKey = `sthstart:image-draft:${contextKey}`;
  const hydrated = hydratedKey === storageKey;
  const effectivePresetId = presetId ?? options?.defaultPresetId ?? null;
  const selected = effectivePresetId ? options?.presets.find(item => item.id === effectivePresetId) : undefined;
  const configuration = selected?.configuration ?? (!effectivePresetId ? options?.configuration : undefined);
  useEffect(() => { onConfigurationChange?.(configuration); }, [configuration, onConfigurationChange]);
  const missingReference = Object.entries(configuration?.inputCapabilities ?? {}).some(([key, capability]) => capability.required && (!referenceInput || key !== configuration?.referenceInputKey));
  const fields = configuration?.fields ?? [];
  const defaults = Object.fromEntries(fields.filter(field => field.defaultValue !== null && field.defaultValue !== undefined).map(field => [field.key, field.defaultValue]));
  const values = { ...defaults, ...overrides };
  const positiveKey = configuration?.promptKey;
  const negativeKey = configuration?.negativePromptKey;
  const busy = phase !== 'idle';
  const configurationChanged = Boolean(prepared && configuration && prepared.configurationHash !== configuration.configurationHash);
  const ready = Boolean(configuration && positiveKey && !selected?.unavailableReason && !missingReference && !configurationChanged);
  const advancedFields = fields.filter(field => field.key !== positiveKey && field.key !== negativeKey);
  const modified = advancedFields.filter(field => field.key in overrides && JSON.stringify(overrides[field.key]) !== JSON.stringify(defaults[field.key]));

  useEffect(() => {
    restored.current = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Record<string, unknown> | null;
      if (saved && typeof saved.description === 'string' && saved.overrides && typeof saved.overrides === 'object' && !Array.isArray(saved.overrides)) {
        // Browser draft recovery intentionally runs after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDescription(saved.description); setOverrides(saved.overrides as Record<string, unknown>);
        setPresetId(typeof saved.presetId === 'string' ? saved.presetId : null);
        setAi(saved.ai !== false); setManual(saved.manual === true);
        if (typeof saved.activeStyle === 'string' && SCENE_STYLE_PRESETS.some(style => style.id === saved.activeStyle)) {
          setActiveStyle(saved.activeStyle);
        } else {
          // Older drafts included the selected suffix in the description itself.
          const previousStyle = saved.manual !== true ? SCENE_STYLE_PRESETS.find(style => style.promptSuffix && (saved.description as string).endsWith(style.promptSuffix)) : undefined;
          setActiveStyle(previousStyle?.id ?? 'free');
          if (previousStyle) setDescription(saved.description.slice(0, -previousStyle.promptSuffix.length));
        }
      }
    } catch { /* Storage is optional; leave the current in-memory draft intact. */ }
    restored.current = true;
    setHydratedKey(storageKey);
  }, [storageKey]);
  useEffect(() => {
    if (!hydrated || !restored.current) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ description, overrides, presetId, ai, manual, activeStyle })); } catch { /* In-memory draft remains usable. */ }
  }, [hydrated, storageKey, description, overrides, presetId, ai, manual, activeStyle]);
  useEffect(() => {
    if (!initial) return;
    // Replaying a task is an explicit user action. Do not run its prompt through AI again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverrides({ ...initial.parameters, ...(initial.seed != null ? { seed: initial.seed } : {}) });
    setPresetId(initial.presetId ?? null); setDescription(initial.description ?? String(initial.parameters.prompt ?? ''));
    setManual(true); setActiveStyle('free'); setPrepared(null); setError('');
  }, [initial]);

  const update = (key: string, value: unknown) => {
    setOverrides(previous => ({ ...previous, [key]: value }));
    if (key === positiveKey || key === negativeKey) setManual(true);
    setError('');
  };
  const switchPreset = (next: string) => {
    setPresetId(next || null); setPrepared(null); setPendingPreset(null); setError('');
    // Prompt edits survive a preset change; sampler/model overrides explicitly reset.
    const nextConfig = options?.presets.find(item => item.id === next)?.configuration ?? options?.configuration;
    setOverrides(previous => ({
      ...(positiveKey && nextConfig?.promptKey && positiveKey in previous ? { [nextConfig.promptKey]: previous[positiveKey] } : {}),
      ...(negativeKey && nextConfig?.negativePromptKey && negativeKey in previous ? { [nextConfig.negativePromptKey]: previous[negativeKey] } : {}),
    }));
  };
  const requestPreset = (next: string) => {
    if (modified.length > 0) setPendingPreset(next);
    else switchPreset(next);
  };
  const run = async (submit: boolean, forcePrepare = false) => {
    if (running.current || !hydrated || !configuration || !positiveKey) return;
    setError('');
    const styledDescription = description + (SCENE_STYLE_PRESETS.find(style => style.id === activeStyle)?.promptSuffix ?? '');
    const prompt = manual && !forcePrepare ? String(Object.hasOwn(overrides, positiveKey) ? values[positiveKey] ?? '' : description) : styledDescription;
    let submittingTask = false;
    if (!prompt.trim() || ((!manual || forcePrepare) && !description.trim())) { setError('请先描述想生成的画面。'); return; }
    running.current = true;
    const fingerprint = JSON.stringify({ preset: selected?.id, revision: selected?.revision, values, prompt, ai: ai && (!manual || forcePrepare), configurationHash: configuration.configurationHash });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: `image-${generateId()}` };
    const key = attempt.current.key;
    try {
      let result = prepared ? { ...prepared, parameters: { ...values, [positiveKey]: prepared.positivePrompt } } : null;
      if (!result || result.configurationHash !== configuration.configurationHash || manual || !submit || forcePrepare) {
        setPhase('preparing');
        result = await prepareImageGeneration({ appId, purpose, description: prompt, ai: ai && (!manual || forcePrepare),
          parameters: values, ...(selected ? { presetId: selected.id, presetRevision: selected.revision } : {}), idempotencyKey: `${key}-prompt` });
        setPrepared(result); setOverrides(result.parameters);
        attempt.current = { fingerprint: JSON.stringify({ preset: selected?.id, revision: selected?.revision, values: result.parameters, prompt, ai: ai && (!manual || forcePrepare), configurationHash: configuration.configurationHash }), key };
      }
      if (!submit) return;
      submittingTask = true;
      setPhase('submitting');
      await onGenerate({ sourceDescription: description, parameters: result.parameters, configurationHash: result.configurationHash,
        ...(selected ? { presetId: selected.id, presetRevision: selected.revision } : {}),
        ...(result.optimizerCallId ? { optimizerCallId: result.optimizerCallId } : {}),
        ...(typeof result.parameters.seed === 'number' ? { seed: result.parameters.seed } : {}), idempotencyKey: key });
      attempt.current = null;
    } catch (reason) {
      if (!submittingTask) attempt.current = null;
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    finally { running.current = false; setPhase('idle'); }
  };

  return <section data-ready={hydrated ? 'true' : 'false'} aria-label="图片生成配置" className="min-w-0 rounded-[var(--radius-panel)] border border-border-subtle bg-surface">
    <div className="border-b border-border-subtle p-4"><ImageModeSwitch advanced={advanced} onChange={setAdvanced} modifiedCount={modified.length} disabled={busy || !hydrated} /></div>
    <fieldset disabled={busy || !hydrated} className="min-w-0 space-y-5 p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <label htmlFor={`${id}-description`} className="text-sm font-semibold text-ink">描述你的画面</label>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="画风情境预设">
            {SCENE_STYLE_PRESETS.map((style) => (
              <button
                key={style.id}
                type="button"
                aria-pressed={activeStyle === style.id}
                disabled={manual}
                onClick={() => {
                  const nextStyle = activeStyle === style.id ? 'free' : style.id;
                  if (nextStyle === activeStyle) return;
                  setActiveStyle(nextStyle);
                  setPrepared(null);
                  setError('');
                }}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50 ${
                  activeStyle === style.id
                    ? 'bg-accent/15 text-accent font-semibold'
                    : 'bg-surface-sunken/60 text-muted hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>
        {manual && <p className="text-xs text-muted">当前直接使用手动提示词，画风选项已暂停。编辑画面描述后可重新选择。</p>}
        <Textarea id={`${id}-description`} rows={5} maxLength={10000} value={description} placeholder="用中文描述人物、动作、场景和想要的氛围…"
          onChange={event => { setDescription(event.target.value); setManual(false); setPrepared(null); setError(''); }} />
        <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" checked={ai} onChange={event => { setAi(event.target.checked); setPrepared(null); }} className="mt-1" />
          <span>AI 生成专业提示词<span className="mt-0.5 block text-xs leading-relaxed text-muted">{manual ? '最终提示词已手动编辑，本次直接使用；修改画面描述后可重新生成。' : '生成时使用当前应用的文本模型整理画面描述，可关闭后直接使用原文。'}</span></span>
        </label>
      </div>
      {referenceInput}
      {missingReference && <Alert variant="warning" title="此方案需要参考素材">请选择不要求参考素材的方案，或在支持参考图的业务入口使用此工作流。</Alert>}
      {loading ? <p role="status" className="text-sm text-muted">正在读取生成方案…</p> : <div className="space-y-2">
        {advanced && options && options.presets.length > 0 && <div className="space-y-2">
          <label htmlFor={`${id}-workflow`} className="text-sm font-medium text-ink">工作流</label>
          <Select id={`${id}-workflow`} value={selected?.workflowId ?? options.workflow?.id ?? ''} onChange={event => {
            if (!options.defaultPresetId && event.target.value === options.workflow?.id) { requestPreset(''); return; }
            const next = options.presets.find(item => item.workflowId === event.target.value && !item.unavailableReason);
            if (next) requestPreset(next.id);
          }}>{[...new Set([...(options.workflow ? [options.workflow.id] : []), ...options.presets.map(item => item.workflowId)])].map(workflowId => <option key={workflowId} value={workflowId}>{options.presets.find(item => item.workflowId === workflowId)?.workflowName ?? options.workflow?.name}</option>)}</Select>
        </div>}
        <label htmlFor={`${id}-preset`} className="text-sm font-medium text-ink">生成方案</label>
        <Select id={`${id}-preset`} value={selected?.id ?? ''} onChange={event => requestPreset(event.target.value)}>
          {!options?.defaultPresetId && <option value="">使用当前绑定工作流</option>}
          {options?.presets.filter(preset => !advanced || !selected || preset.workflowId === selected.workflowId).map(preset => <option key={preset.id} value={preset.id} disabled={Boolean(preset.unavailableReason)}>{preset.name}{preset.isDefault ? '（默认）' : ''}{preset.unavailableReason ? '（不可用）' : ''}</option>)}
        </Select>
        <p className="text-xs leading-relaxed text-muted">{selected?.description || '方案包含工作流、模型与采样默认值；本次修改不会更改全局配置。'}</p>
      </div>}
      {configuration && configuration.sizePresets.length > 0 && <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">画幅</legend>
        <div className="grid grid-cols-2 gap-2">{configuration.sizePresets.map(size => <button key={`${size.width}x${size.height}`} type="button"
          aria-pressed={values.width === size.width && values.height === size.height}
          onClick={() => { update('width', size.width); update('height', size.height); }}
          className={`flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border p-2.5 text-left ${values.width === size.width && values.height === size.height ? 'border-accent bg-accent/10 text-ink' : 'border-border-subtle text-muted'}`}>
          <span aria-hidden="true" className="block shrink-0 rounded-sm border border-current" style={{ width: size.width >= size.height ? 24 : 24 * size.width / size.height, height: size.height >= size.width ? 24 : 24 * size.height / size.width }} />
          <span className="min-w-0 text-xs">{size.label}<span className="block text-xs text-muted">{size.width} × {size.height}</span></span>
        </button>)}</div>
      </fieldset>}
      {!advanced && <ImageParameterFields fields={advancedFields.filter(field => field.section === 'basic' && /style|artist|quality/i.test(field.key))} values={values} onChange={update} />}
      {!advanced && modified.length > 0 && <p className="break-words rounded-[var(--radius-control)] bg-surface-muted p-3 text-xs text-muted">{modified.map(field => `${field.label}：${String(values[field.key])}`).join(' · ')}</p>}
      {advanced && configuration && <div className="space-y-4">
        <section className="space-y-3 border-t border-border-subtle pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{configuration.promptMode === 'service-finalized-v1' ? '最终提示词' : '注入提示词'}</h3>
            <Button type="button" size="sm" variant="outline" onClick={() => { setManual(false); setPrepared(null); void run(false, true); }} disabled={busy || !description.trim()}>准备提示词</Button></div>
          <ImageParameterFields fields={fields.filter(field => field.key === positiveKey || field.key === negativeKey)} values={values} onChange={update} />
          {prepared && <p className="text-xs text-muted">来源：{prepared.optimizerCallId ? 'AI 生成' : '原文'}{manual ? ' → 手动编辑' : ''}；原始描述保留在上方。</p>}
        </section>
        {['models', 'sampling', 'other'].map(group => {
          const grouped = advancedFields.filter(field => group === 'models' ? field.type === 'model' || /lora/i.test(field.key) : group === 'sampling' ? field.type !== 'model' && !/lora/i.test(field.key) && /width|height|steps|cfg|seed|sampler|scheduler|denoise/i.test(field.key) : field.type !== 'model' && !/lora|width|height|steps|cfg|seed|sampler|scheduler|denoise/i.test(field.key));
          return grouped.length > 0 && <details key={group} open={group === 'sampling'} className="border-t border-border-subtle pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">{group === 'models' ? '模型与 LoRA' : group === 'sampling' ? '采样与尺寸' : '风格与其他参数'}</summary>
            <div className="mt-3"><ImageParameterFields fields={grouped} values={values} modelChoices={configuration.modelChoices} onChange={update} /></div>
          </details>;
        })}
        <p className="break-words text-xs text-muted">工作流：{selected?.workflowName ?? options?.workflow?.name} · v{selected?.workflowVersion ?? options?.workflow?.version}{selected ? ` · 预设修订 ${selected.revision}` : ''}</p>
        {configuration.modelChoicesStale && <p className="text-xs text-warning-fg">模型清单来自过期缓存，请刷新连接发现结果后再选择。</p>}
      </div>}
      {configuration?.warnings.map(warning => <p key={warning} className="text-xs leading-relaxed text-muted">{warning}</p>)}
      {configurationChanged && <Alert variant="warning" title="生成配置已更新">请确认新方案默认值后继续；画面描述会保留。
        <Button type="button" size="sm" variant="outline" onClick={() => {
          setOverrides(previous => ({
            ...(positiveKey ? { [positiveKey]: previous[positiveKey] ?? prepared?.positivePrompt ?? '' } : {}),
            ...(negativeKey ? { [negativeKey]: previous[negativeKey] ?? prepared?.negativePrompt ?? '' } : {}),
          }));
          setManual(true); setPrepared(null); attempt.current = null; setError('');
        }}>采用新配置，保留提示词</Button>
      </Alert>}
      {(!ready && !loading && !configurationChanged) && <Alert variant="warning" title="生成方案尚未就绪">{selected?.unavailableReason || (effectivePresetId && !selected ? '先前选择的方案已不可用，请选择有效方案。' : options?.status) || '请先配置图片工作流。'} <a href="/settings/generation" className="underline">前往生成设置</a>{onRefresh && <Button type="button" size="sm" variant="ghost" onClick={onRefresh}>重新读取</Button>}</Alert>}
      {blockedReason && <p className="text-xs text-muted">{blockedReason}</p>}
    </fieldset>
    <div className="xl:sticky xl:bottom-0 z-10 space-y-3 border-t border-border-subtle bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {error && <Alert variant="danger" title="本次生成未完成">{error}<div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setAi(false); setPrepared(null); setError(''); }}>关闭 AI 后继续编辑</Button><a href="/settings/public-services" className="text-xs underline">配置文本模型</a>{onRefresh && <Button type="button" size="sm" variant="ghost" onClick={onRefresh}>刷新生成配置</Button>}</div></Alert>}
      <Button type="button" variant="accent" className="w-full" loading={busy} disabled={!hydrated || !ready || busy || Boolean(blockedReason)} onClick={() => void run(true)}><Sparkles className="h-4 w-4" aria-hidden="true" />{phase === 'preparing' ? '准备提示词…' : phase === 'submitting' ? '提交图片任务…' : submitLabel}</Button>
      <p role="status" aria-live="polite" className="text-center text-xs text-muted">{busy ? '当前参数已锁定，完成后会保留在此处。' : '生成结果保留在当前业务中，不自动覆盖已有图片。'}</p>
    </div>
    <Dialog open={pendingPreset !== null} onOpenChange={open => { if (!open) setPendingPreset(null); }} title="切换生成方案" description="本次自定义的采样、尺寸和模型参数将恢复为新方案默认值，手动提示词会保留。"
      footer={<><Button variant="outline" onClick={() => setPendingPreset(null)}>继续编辑</Button><Button onClick={() => switchPreset(pendingPreset ?? '')}>应用新方案</Button></>}>
      <ul className="space-y-1 text-sm text-muted">{modified.map(field => <li key={field.key}>{field.label}：{String(values[field.key])}</li>)}</ul>
    </Dialog>
  </section>;
}
