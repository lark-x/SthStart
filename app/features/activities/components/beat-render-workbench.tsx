'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, ImagePlus, LoaderCircle, RefreshCw, Settings2, Sparkles, WandSparkles } from 'lucide-react';
import type {
  ActivityScene, ActorSnapshot, BeatRenderCandidate, BeatRenderPreview, BeatRenderPreviewRequest, ContentDocument, SceneBeat, SceneBeatRenderSettings,
} from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { useToast } from '@/app/providers/ui-provider';
import { ApiClientError } from '@/app/lib/api-client';
import { fetchDraft } from '../api';
import { fetchBeatRenderCandidates, previewBeatRender, rerenderBeatRenderCandidate, selectBeatRenderImage, submitBeatRender } from '../beat-renders-api';

function statusLabel(status: string) {
  return ({ preparing: '准备中', queued: '排队中', running: '绘制中', succeeded: '已完成', failed: '绘制失败', adopted: '历史图片' } as Record<string, string>)[status] ?? status;
}

function settingsFromBeat(beat: SceneBeat): SceneBeatRenderSettings {
  return beat.renderSettings ?? {};
}

export function BeatRenderWorkbench({
  activityId, stageId, scene, beat, document, onBeforeAction, onAdopted, onSettingsChange, onAutoAppliedCheck, disabled = false,
}: {
  activityId: string; stageId: string; scene: ActivityScene; beat: SceneBeat; document: ContentDocument;
  onBeforeAction?: () => Promise<boolean>;
  onAdopted: (document: ContentDocument, draftVersion: number) => void;
  onSettingsChange: (settings: SceneBeatRenderSettings) => void;
  onAutoAppliedCheck?: () => void;
  disabled?: boolean;
}) {
  const initialSettings = settingsFromBeat(beat);
  const [settings, setSettings] = useState<SceneBeatRenderSettings>(initialSettings);
  const [plan, setPlan] = useState<BeatRenderPreview | null>(null);
  const [working, setWorking] = useState<'preview' | 'submit' | 'select' | 'rerender' | ''>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const [unavailableMediaUrl, setUnavailableMediaUrl] = useState('');
  const [narrowViewport, setNarrowViewport] = useState(false);
  const toast = useToast();
  const lastAutoAppliedVersion = useRef(0);
  const submitting = useRef(false);
  const drawAttempt = useRef<{ requestKey: string; idempotencyKey: string } | null>(null);
  const actor = useMemo(() => document.actors.find((item) => item.id === beat.characterId) as ActorSnapshot | undefined, [document.actors, beat.characterId]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrowViewport(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => { setSettings(settingsFromBeat(beat)); }, [beat.id, beat.renderSettings]);
  useEffect(() => { setPlan(null); setNumericDrafts({}); setError(''); setSettingsOpen(false); drawAttempt.current = null; }, [beat.id]);

  const candidateQuery = useInfiniteQuery({
    queryKey: ['activity-beat-renders', activityId, stageId, scene.id, beat.id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchBeatRenderCandidates(activityId, stageId, scene.id, beat.id, pageParam),
    getNextPageParam: (lastPage) => lastPage.offset + lastPage.items.length < lastPage.total
      ? lastPage.offset + lastPage.items.length
      : undefined,
    enabled: Boolean(activityId),
    refetchInterval: (query) => query.state.data?.pages.some((page) => page.items.some((item) => ['preparing', 'queued', 'running'].includes(item.status))) ? 1500 : false,
  });
  const candidates = candidateQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const candidateTotal = candidateQuery.data?.pages[0]?.total ?? 0;

  useEffect(() => {
    const result = candidateQuery.data;
    const draftVersion = result?.pages[0]?.draftVersion ?? 0;
    if (!result || !result.pages.some((page) => page.items.some((item) => item.autoApplyState === 'applied')) || draftVersion <= lastAutoAppliedVersion.current) return;
    lastAutoAppliedVersion.current = draftVersion;
    const serverCurrent = result.pages.flatMap((page) => page.items).flatMap((item) => item.images).find((image) => image.isCurrent);
    if (serverCurrent && serverCurrent.mediaUrl === beat.mediaUrl) return;
    onAutoAppliedCheck?.();
  }, [candidateQuery.data, beat.mediaUrl, onAutoAppliedCheck]);

  const persistSettings = (next: SceneBeatRenderSettings) => {
    setSettings(next);
    setError('');
    onSettingsChange(next);
  };

  const makeRequestFromSettings = (configured: SceneBeatRenderSettings, overrides: Partial<BeatRenderPreviewRequest> = {}): BeatRenderPreviewRequest => ({
    stageId, sceneId: scene.id, beatId: beat.id,
    ...(configured.purpose ? { purpose: configured.purpose } : {}),
    ...(configured.workflowId ? { workflowId: configured.workflowId, workflowVersion: configured.workflowVersion } : {}),
    ...(configured.presetId ? { presetId: configured.presetId, presetRevision: configured.presetRevision } : {}),
    customPrompt: configured.customPrompt,
    negativePrompt: configured.negativePrompt,
    parameters: configured.parameters,
    referenceAssetKey: configured.referenceAssetKey,
    loraOverrides: configured.loraOverrides,
    ...(typeof configured.parameters?.seed === 'number' ? { seed: configured.parameters.seed } : {}),
    ...overrides,
  });
  const makeRequest = (overrides: Partial<BeatRenderPreviewRequest> = {}) => makeRequestFromSettings(settings, overrides);

  const fetchPreview = async (request: BeatRenderPreviewRequest) => {
    const next = await previewBeatRender(activityId, request);
    setPlan(next);
    return next;
  };

  const loadSettingsPreview = async (configured: SceneBeatRenderSettings) => {
    setWorking('preview'); setError('');
    const request = makeRequestFromSettings(configured);
    try { await fetchPreview(request); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : '读取绘制配置失败';
      // Invalid saved overrides must not hide the very fields needed to repair them.
      if (Object.keys(request.parameters ?? {}).length) {
        try { await fetchPreview({ ...request, parameters: undefined, seed: undefined }); }
        catch { setPlan(null); }
      } else setPlan(null);
      setError(message);
    } finally { setWorking(''); }
  };

  const handleOpenSettings = async () => {
    setSettingsOpen(true);
    if (onBeforeAction) {
      const ok = await onBeforeAction();
      if (!ok) return;
    }
    if (!plan) await loadSettingsPreview(settings);
  };

  const changeWorkflowSettings = (next: SceneBeatRenderSettings) => {
    setNumericDrafts({});
    setPlan(null);
    persistSettings(next);
    void loadSettingsPreview(next);
  };

  const handleDraw = async (baseRequest = makeRequest()) => {
    if (submitting.current || disabled || working || running) return;
    setError('');
    if (Object.keys(numericDrafts).length) {
      setShowAdvanced(true);
      setSettingsOpen(true);
      setError('请先将数值参数填写为工作流允许的值。');
      return;
    }
    submitting.current = true;
    setWorking('submit');
    try {
      if (onBeforeAction && !(await onBeforeAction())) return;
      const requestKey = JSON.stringify(baseRequest);
      if (drawAttempt.current?.requestKey !== requestKey) drawAttempt.current = { requestKey, idempotencyKey: crypto.randomUUID() };
      await submitBeatRender(activityId, { ...baseRequest, idempotencyKey: drawAttempt.current.idempotencyKey });
      drawAttempt.current = null;
      setSettingsOpen(false);
      void candidateQuery.refetch();
      toast.success('已提交绘制任务', beat.mediaUrl ? '新图片完成后会保留在历史区，不会替换当前画面。' : '若绘制成功且镜头内容未变化，第一张图片会自动写入草稿。');
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status >= 400 && cause.status < 500) drawAttempt.current = null;
      const message = cause instanceof Error ? cause.message : '提交绘制失败';
      setError(message); void candidateQuery.refetch();
    } finally { submitting.current = false; setWorking(''); }
  };

  const selectImage = async (candidate: BeatRenderCandidate, artifactId: string) => {
    if (working || disabled || onBeforeAction && !(await onBeforeAction())) return;
    setWorking('select'); setError('');
    try {
      let result;
      try { result = await selectBeatRenderImage(activityId, candidate.id, artifactId); }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : '';
        if (!message.includes('已变化') && !message.includes('旧描述')) throw cause;
        if (!window.confirm(`${message}\n\n仍要将该历史图片切换为当前镜头画面吗？`)) return;
        result = await selectBeatRenderImage(activityId, candidate.id, artifactId, true);
      }
      onAdopted(result.document, result.draftVersion);
      void candidateQuery.refetch();
      toast.success('已切换当前镜头画面');
    } catch (cause) {
      // A failed response does not prove the write failed: serialization or
      // the proxy can fail after the draft transaction has committed.
      try {
        const latest = (await fetchDraft(activityId)).draft;
        const persistedScene = latest.document.scenes?.find((item) => item.id === scene.id)
          ?? latest.document.stages.flatMap((item) => item.scenes ?? []).find((item) => item.id === scene.id);
        if (persistedScene?.beats.find((item) => item.id === beat.id)?.mediaUrl
          === `/api/admin/artifacts/${encodeURIComponent(artifactId)}/file`) {
          onAdopted(latest.document, latest.draftVersion);
          void candidateQuery.refetch();
          toast.success('已切换当前镜头画面');
          return;
        }
      } catch { /* retain the original request error below */ }
      const message = cause instanceof Error ? cause.message : '切换历史图片失败';
      setError(message); toast.error('无法切换图片', message);
      // The server may have committed the switch before a response failed.
      // Re-read the draft so the displayed image never contradicts storage.
      onAutoAppliedCheck?.();
      void candidateQuery.refetch();
    } finally { setWorking(''); }
  };

  const rerender = async (candidate: BeatRenderCandidate) => {
    if (working || disabled || onBeforeAction && !(await onBeforeAction())) return;
    setWorking('rerender'); setError('');
    try {
      await rerenderBeatRenderCandidate(activityId, candidate.id, Math.floor(Math.random() * 2_147_483_647));
      await candidateQuery.refetch();
      toast.success('已按这张图片的原配置提交重绘');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '提交重绘失败';
      setError(message); toast.error('无法重绘', message);
    } finally { setWorking(''); }
  };

  const currentUrl = beat.mediaUrl;
  const history = candidates.flatMap((candidate) => candidate.images.map((image) => ({ candidate, image })));
  const failuresOrProcessing = candidates.filter((candidate) => ['failed', 'preparing', 'queued', 'running'].includes(candidate.status));
  const running = candidates.some((candidate) => ['preparing', 'queued', 'running'].includes(candidate.status));
  const selectedImage = history.find((item) => item.image.mediaUrl === beat.mediaUrl);
  const selectedCandidate = selectedImage?.candidate ?? null;
  const settingsLabel = !settings.workflowId && !settings.presetId ? '使用活动默认配置' : plan?.presetOptions.find((item) => item.id === plan.selectedPresetId)?.name ?? plan?.workflowName ?? '使用本镜头配置';

  const settingFields = plan?.fields.filter((field) => !['prompt', 'long-text'].includes(field.type) && !/negative.?prompt/i.test(field.key))
    .sort((left, right) => (['width', 'height'].indexOf(left.key) < 0 ? 2 : ['width', 'height'].indexOf(left.key))
      - (['width', 'height'].indexOf(right.key) < 0 ? 2 : ['width', 'height'].indexOf(right.key))) ?? [];
  const settingContent = (
    <div className="space-y-4">
      <p className="text-sm text-muted">直接使用活动默认配置即可绘制。这里的调整仅用于当前镜头。</p>
      <details className="rounded-[var(--radius-control)] border border-border-subtle p-3"><summary className="cursor-pointer text-sm text-muted">切换其他工作流</summary>
      <label className="mt-3 block space-y-1.5"><span className="text-sm font-medium text-ink">工作流</span>
        {plan?.workflowOptions.length ? <select aria-label="镜头工作流" value={`${settings.purpose ?? plan.purpose}|${settings.workflowId ?? plan.workflowId}|${settings.workflowVersion ?? plan.workflowVersion}`} onChange={(event) => {
          const item = plan.workflowOptions.find((option) => `${option.purpose}|${option.workflowId}|${option.workflowVersion}` === event.target.value);
          if (item) changeWorkflowSettings({ ...settings, purpose: item.purpose, workflowId: item.workflowId, workflowVersion: item.workflowVersion,
            presetId: item.presetId ?? undefined, presetRevision: undefined, parameters: undefined });
        }} className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 text-sm text-ink">
          {plan.workflowOptions.map((item) => <option key={`${item.purpose}|${item.workflowId}|${item.workflowVersion}`} value={`${item.purpose}|${item.workflowId}|${item.workflowVersion}`}>{item.workflowName} v{item.workflowVersion} · {item.engineName}</option>)}
        </select> : <p className="rounded border border-border-subtle bg-surface-raised px-3 py-2 text-sm text-muted">{settingsLabel}</p>}
      </label></details>
      {plan?.presetOptions.length ? <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">生成预设</span>
        <select aria-label="镜头绘制预设" value={settings.presetId ?? ''} onChange={(event) => {
          const preset = plan.presetOptions.find((item) => item.id === event.target.value);
          changeWorkflowSettings({ ...settings, purpose: preset ? plan.purpose : undefined, workflowId: preset?.workflowId, workflowVersion: preset?.workflowVersion,
            presetId: preset?.id, presetRevision: preset?.revision, parameters: undefined });
        }} className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 text-sm text-ink">
          <option value="">跟随活动默认配置</option>{plan.presetOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isDefault ? ' · 默认' : ''}</option>)}
        </select>
      </label> : null}
      <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" variant="ghost" disabled={Boolean(working)} onClick={() => changeWorkflowSettings({ customPrompt: settings.customPrompt })}>恢复活动默认</Button><Link href="/settings/generation" target="_blank" rel="noopener noreferrer" className="inline-flex text-xs text-accent hover:underline">管理默认配置 / 测试连接</Link></div>
      <label className="block space-y-1.5"><span className="text-sm font-medium text-ink">补充提示词</span>
        <Textarea rows={3} value={settings.customPrompt ?? ''} onChange={(event) => persistSettings({ ...settings, customPrompt: event.target.value })} placeholder="补充构图、光影或画风要求；镜头动作会自动带入" />
      </label>
      <details className="space-y-2 rounded-[var(--radius-control)] border border-border-subtle p-3" aria-label="镜头 LoRA 配置">
        <summary className="cursor-pointer text-sm font-medium text-ink">LoRA · 继承角色与活动配置</summary><p className="text-xs text-muted">需要改变画风或角色特征时，再添加、调权或关闭。</p>
        {plan?.loras.map((item) => {
          const existing = (settings.loraOverrides ?? []).find((override) => override.model === item.model);
          return <div key={item.model} className="grid gap-2 border-t border-border-subtle py-2 text-xs sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <div className="min-w-0"><div className="truncate font-medium text-ink">{item.model}</div><div className="text-muted">{item.source === 'global' ? '全局' : item.source === 'character' ? '角色' : '镜头'}{item.available ? '' : ' · 此实例不可用'}</div></div>
            {existing ? <Input aria-label={`${item.model} 本镜头强度`} type="number" min={-10} max={10} step={0.05} value={existing.strength ?? item.strength} onChange={(event) => {
              const next = [...(settings.loraOverrides ?? [])]; const index = next.findIndex((override) => override.model === item.model); next[index] = { ...existing, strength: Number(event.target.value) };
              persistSettings({ ...settings, loraOverrides: next });
            }} /> : <span className="self-center text-muted">强度 {item.strength}</span>}
            <Button type="button" size="sm" variant="outline" onClick={() => {
              const next = { model: item.model, strength: existing?.strength ?? item.strength, triggerWord: existing?.triggerWord ?? item.triggerWord, enabled: existing ? existing.enabled === false : false };
              persistSettings({ ...settings, loraOverrides: [...(settings.loraOverrides ?? []).filter((override) => override.model !== item.model), next] });
            }}>{existing?.enabled === false ? '已关闭 · 启用' : existing ? '覆盖中 · 关闭' : '关闭继承'}</Button>
            {existing && <Input aria-label={`${item.model} 本镜头触发词`} className="sm:col-span-3" value={existing.triggerWord ?? ''} placeholder="覆盖触发词（可选）" onChange={(event) => {
              const next = [...(settings.loraOverrides ?? [])]; const index = next.findIndex((override) => override.model === item.model); next[index] = { ...existing, triggerWord: event.target.value };
              persistSettings({ ...settings, loraOverrides: next });
            }} />}
          </div>;
        })}
        {(settings.loraOverrides ?? []).filter((override) => !plan?.loras.some((item) => item.model === override.model)).map((override, index) => <div key={`${override.model}-${index}`} className="grid gap-2 border-t border-border-subtle pt-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
          <select aria-label={`镜头 LoRA 文件 ${index + 1}`} value={override.model} onChange={(event) => {
            const model = event.target.value;
            const next = [...(settings.loraOverrides ?? [])]; next[index] = { ...override, model };
            persistSettings({ ...settings, loraOverrides: next });
          }} className="h-9 min-w-0 rounded border border-border-control bg-surface-raised px-2 text-xs text-ink">
            {plan?.loraModels.map((name) => <option key={name} value={name}>{name}</option>)}
            <option value={override.model}>{override.model}</option>
          </select>
          <Input aria-label="镜头 LoRA 强度" type="number" min={-10} max={10} step={0.05} value={override.strength ?? 1} onChange={(event) => {
            const next = [...(settings.loraOverrides ?? [])]; next[index] = { ...override, strength: Number(event.target.value) };
            persistSettings({ ...settings, loraOverrides: next });
          }} />
          <Button type="button" size="sm" variant="ghost" onClick={() => persistSettings({ ...settings, loraOverrides: (settings.loraOverrides ?? []).filter((_, itemIndex) => itemIndex !== index) })}>移除</Button>
          <Input aria-label="镜头 LoRA 触发词" className="sm:col-span-3" value={override.triggerWord ?? ''} placeholder="触发词（可选）" onChange={(event) => {
            const next = [...(settings.loraOverrides ?? [])]; next[index] = { ...override, triggerWord: event.target.value };
            persistSettings({ ...settings, loraOverrides: next });
          }} />
        </div>)}
        <Button type="button" size="sm" variant="outline" disabled={!plan?.loraModels.length || (settings.loraOverrides?.length ?? 0) >= 32} onClick={() => {
          const available = plan?.loraModels.find((model) => !plan.loras.some((item) => item.model === model) && !(settings.loraOverrides ?? []).some((override) => override.model === model));
          if (!available) { toast.info('请先在生成配置 → 活动 LoRA 中设置全局 LoRA，或在角色中配置 LoRA。'); return; }
          persistSettings({ ...settings, loraOverrides: [...(settings.loraOverrides ?? []), { model: available, strength: 1, triggerWord: '', enabled: true }] });
        }}><WandSparkles className="mr-1 h-4 w-4" />添加或覆盖</Button>
      </details>
      {error && <p role="alert" className="rounded border border-danger-fg/20 bg-danger-fg/5 px-3 py-2 text-sm text-danger-fg">{error}</p>}
      <details open={showAdvanced} onToggle={(event) => setShowAdvanced((event.currentTarget as HTMLDetailsElement).open)} className="rounded-[var(--radius-control)] border border-border-subtle p-3">
        <summary className="cursor-pointer select-none text-sm font-medium text-ink">高级设置：负向词、参考图、种子与采样参数</summary>
        <div className="mt-3 space-y-3">
          {settingFields.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{settingFields.map((field) => <label key={field.key} className="min-w-0 space-y-1"><span className="text-xs font-medium text-muted">{field.label}{field.required ? ' · 必填' : ''}</span>
            {field.type === 'enum' && field.enumValues?.length ? <select aria-label={field.label} value={String(settings.parameters?.[field.key] ?? field.value ?? '')} onChange={(event) => persistSettings({ ...settings, parameters: { ...settings.parameters, [field.key]: event.target.value } })} className="h-10 w-full rounded border border-border-control bg-surface-raised px-3 text-sm text-ink">{field.enumValues.map((value) => <option key={value} value={value}>{value}</option>)}</select>
              : field.type === 'boolean' ? <input aria-label={field.label} type="checkbox" checked={Boolean(settings.parameters?.[field.key] ?? field.value)} onChange={(event) => persistSettings({ ...settings, parameters: { ...settings.parameters, [field.key]: event.target.checked } })} className="h-4 w-4 accent-[var(--color-accent)]" />
                : <Input aria-label={field.label} type={['integer', 'number', 'seed'].includes(field.type) ? 'number' : 'text'} min={field.minimum} max={field.maximum} step={field.step} value={numericDrafts[field.key] ?? String(settings.parameters?.[field.key] ?? field.value ?? '')} onChange={(event) => {
                  const raw = event.target.value;
                  if (['integer', 'number', 'seed'].includes(field.type)) {
                    const value = Number(raw);
                    const valid = raw !== '' && Number.isFinite(value)
                      && (field.type === 'number' || Number.isSafeInteger(value))
                      && (field.minimum === undefined || value >= field.minimum)
                      && (field.maximum === undefined || value <= field.maximum)
                      && (field.step === undefined || Math.abs((value - (field.minimum ?? 0)) / field.step - Math.round((value - (field.minimum ?? 0)) / field.step)) < 1e-7);
                    if (!valid) { setNumericDrafts((drafts) => ({ ...drafts, [field.key]: raw })); return; }
                    setNumericDrafts((drafts) => { const next = { ...drafts }; delete next[field.key]; return next; });
                    persistSettings({ ...settings, parameters: { ...settings.parameters, [field.key]: value } });
                    return;
                  }
                  persistSettings({ ...settings, parameters: { ...settings.parameters, [field.key]: raw } });
                }} />}
          </label>)}</div>}
          <label className="block space-y-1"><span className="text-xs font-medium text-muted">反向提示词</span><Textarea rows={3} value={settings.negativePrompt ?? ''} onChange={(event) => persistSettings({ ...settings, negativePrompt: event.target.value })} placeholder="留空时使用工作流/提示词策略默认值" /></label>
          <label className="block space-y-1"><span className="text-xs font-medium text-muted">角色参考图</span><select aria-label="镜头参考图" value={settings.referenceAssetKey ?? ''} onChange={(event) => persistSettings({ ...settings, referenceAssetKey: event.target.value || undefined })} className="h-10 w-full rounded border border-border-control bg-surface-raised px-3 text-sm text-ink">
            <option value="">不使用参考图</option>{(actor?.appearanceReferenceAssetKeys ?? []).map((key) => <option key={key} value={key}>{key}</option>)}
          </select></label>
          {plan && <div className="space-y-2 rounded bg-surface-raised p-3 text-xs text-muted"><div className="font-semibold text-ink">提示词来源与工作流参数</div>
            <p>下列来源描述尚未经过本次自动优化；实际提交提示词会在生成记录中保留。</p>
            {plan.source.map((item) => <p key={item.label}><strong className="text-ink">{item.label}：</strong>{item.value}</p>)}
            <p>提示词优化：{plan.promptOptimization.enabled ? `开启 · 策略 r${plan.promptOptimization.policyRevision}` : '关闭'}</p>
            <p>反向提示词：{plan.negativePrompt || '未绑定或使用默认值'}</p>
            {plan.warnings.map((warning) => <p key={warning} className="flex items-start gap-1.5 text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</p>)}
          </div>}
        </div>
      </details>
      {plan && !plan.canSubmit && <p role="status" className="text-sm text-warning">{plan.warnings.join(' ')} 修正后可直接再次绘制。</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>完成</Button><Button type="button" variant="accent" disabled={disabled || Boolean(working) || running} onClick={() => void handleDraw()}>{working === 'submit' ? <LoaderCircle className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}绘制新图</Button></div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <section className="space-y-3" aria-label="当前镜头画面">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><div className="text-xs font-semibold text-ink">当前镜头画面</div><div className="max-w-full truncate text-[11px] text-muted">{settingsLabel}</div></div>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void handleOpenSettings()}><Settings2 className="mr-1 h-4 w-4" />绘制设置</Button>
        </div>
        <div className={`relative aspect-video w-full overflow-hidden rounded-[var(--radius-control)] border ${unavailableMediaUrl === currentUrl ? 'border-border-default bg-surface-muted' : currentUrl ? 'border-border-default bg-black' : 'border-dashed border-border-control bg-surface-muted/50'} flex items-center justify-center transition-all`}>
          {currentUrl ? unavailableMediaUrl === currentUrl
            ? <div role="status" className="p-4 text-center text-sm text-muted">当前画面文件不可用，历史图片仍可重新选择。</div>
            : beat.mediaType === 'video' ? <video src={currentUrl} controls onError={() => setUnavailableMediaUrl(currentUrl)} className="h-full w-full object-contain" />
              : <img src={currentUrl} alt="当前镜头画面" onError={() => setUnavailableMediaUrl(currentUrl)} className="h-full w-full object-contain" />
            : (
              <div className="p-6 text-center max-w-sm">
                <div className="mx-auto mb-2.5 flex size-11 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Sparkles className="size-5" />
                </div>
                <h4 className="text-sm font-semibold text-ink">
                  {actor?.displayName ? `${actor.displayName} · 镜头画面待绘制` : '分镜画面待绘制'}
                </h4>
                <p className="mt-1 line-clamp-2 text-xs text-muted">
                  {beat.action ? `动作：${beat.action}` : '点击下方按钮，使用 ComfyUI 动漫预设自动渲染画面。'}
                </p>
              </div>
            )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {selectedCandidate ? (
            <>
              <Button type="button" variant="accent" disabled={disabled || Boolean(working) || running} onClick={() => void rerender(selectedCandidate)}>
                {working === 'rerender' ? <LoaderCircle className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}换种子重抽
              </Button>
              <Button type="button" variant="outline" disabled={disabled || Boolean(working) || running} onClick={() => void handleOpenSettings()}>
                <Settings2 className="mr-1 h-4 w-4" />微调提示词重绘
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="accent" disabled={disabled || Boolean(working) || running || beat.mediaType === 'video'} onClick={() => void handleDraw()}>
                {working === 'submit' ? <LoaderCircle className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}一键极速绘制
              </Button>
              <Button type="button" variant="outline" disabled={disabled || Boolean(working) || running} onClick={() => void handleOpenSettings()}>
                <Settings2 className="mr-1 h-4 w-4" />自定义工作流/画风
              </Button>
            </>
          )}
        </div>
        {beat.mediaType === 'video' && <p className="text-xs text-muted">当前引用是视频，本入口暂不支持图片绘制；请先在“编辑镜头”中更换或移除视频。</p>}
        {running && <p className="flex items-center gap-2 text-sm text-muted" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />{candidates.some((item) => item.status === 'preparing') ? '正在准备提示词与绘制配置…' : candidates.some((item) => item.status === 'running') ? 'ComfyUI 正在绘制…' : '已提交，等待 ComfyUI 绘制…'}完成后图片会出现在下方。</p>}
        {error && <p role="alert" className="rounded border border-danger-fg/20 bg-danger-fg/5 px-3 py-2 text-xs text-danger-fg">{error}</p>}
      </section>

      <section className="min-w-0 space-y-2" aria-label="镜头绘制历史">
        <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-ink">历史图片</h3><span className="text-[11px] text-muted">{candidateTotal} 条绘制记录 · {candidateQuery.data?.pages[0]?.imageTotal ?? history.length} 张图片</span></div>
        {candidateQuery.isPending && !candidateQuery.data ? <p className="text-xs text-muted">正在读取绘制历史…</p>
          : candidateQuery.isError ? <p role="alert" className="text-xs text-danger-fg">读取绘制历史失败：{candidateQuery.error.message}</p>
            : history.length === 0 ? <div className="rounded border border-dashed border-border-default px-3 py-5 text-center text-xs text-muted">暂无历史图片；失败记录会列在下方。</div>
              : <div className="flex gap-2 overflow-x-auto pb-2" aria-label="历史图片缩略图">{history.map(({ candidate, image }) => {
                const isNew = candidate.status === 'succeeded' && !candidate.adoptedAt;
                const isCurrent = image.mediaUrl === beat.mediaUrl;
                const label = !image.available ? '文件不可用' : isCurrent ? '当前' : isNew ? '新图' : '历史';
                return <button key={`${candidate.id}:${image.artifactId}`} type="button" disabled={disabled || working === 'select' || !image.available}
                  onClick={() => void selectImage(candidate, image.artifactId)} aria-label={`${label}，绘制于 ${new Date(candidate.createdAt).toLocaleString()}`}
                  className={`group relative h-20 w-28 flex-none overflow-hidden rounded border text-left sm:h-24 sm:w-32 ${isCurrent ? 'border-accent ring-2 ring-accent/30' : 'border-border-default'} ${!image.available ? 'bg-surface-muted' : 'bg-black'}`}>
                  {image.available ? <img src={image.mediaUrl} alt="历史镜头图片缩略图" className="h-full w-full object-cover transition-transform group-hover:scale-105" /> : <span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-muted">文件不可用</span>}
                  <span className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${isCurrent ? 'bg-accent text-white' : isNew ? 'bg-surface text-ink' : 'bg-ink/75 text-white'}`}>{label}</span>
                </button>;
              })}</div>}
        {candidateQuery.hasNextPage && <Button type="button" size="sm" variant="ghost" disabled={candidateQuery.isFetchingNextPage} onClick={() => void candidateQuery.fetchNextPage()}>{candidateQuery.isFetchingNextPage ? '正在加载…' : '加载更早图片'}</Button>}
        {failuresOrProcessing.length > 0 && <details className="rounded border border-border-subtle bg-surface-raised/50 p-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">失败与处理中记录（{failuresOrProcessing.length}）</summary>
          <div className="mt-2 space-y-2">{candidates.filter((candidate) => ['failed', 'preparing', 'queued', 'running'].includes(candidate.status)).map((candidate) => <article key={candidate.id} className="flex min-w-0 items-start justify-between gap-2 border-t border-border-subtle pt-2 text-xs">
            <div className="min-w-0"><div className={candidate.status === 'failed' ? 'font-medium text-danger-fg' : 'font-medium text-ink'}>{statusLabel(candidate.status)} · {new Date(candidate.createdAt).toLocaleString()}</div>
              {candidate.error && <p className="mt-1 break-words text-danger-fg">{candidate.error}</p>}{candidate.autoApplyReason && <p className="mt-1 text-muted">{candidate.autoApplyReason}</p>}</div>
            <div className="flex flex-none items-center gap-2">{candidate.callId && <Link href={`/settings/ai-logs?callId=${encodeURIComponent(candidate.callId)}`} target="_blank" className="inline-flex items-center gap-1 text-accent hover:underline">调用日志<ExternalLink className="h-3 w-3" /></Link>}
              {candidate.status === 'failed' && <Button type="button" size="sm" variant="outline" disabled={disabled || Boolean(working) || running} onClick={() => void handleDraw(makeRequest())}>重新绘制</Button>}</div>
          </article>)}</div>
        </details>}
        {history.some(({ candidate }) => candidate.callId) && <div className="flex flex-wrap gap-x-3 gap-y-1">{[...new Map(history.filter(({ candidate }) => candidate.callId).map(({ candidate }) => [candidate.id, candidate])).values()].slice(0, 4).map((candidate) => <Link key={candidate.id} href={`/settings/ai-logs?callId=${encodeURIComponent(candidate.callId!)}`} target="_blank" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">{new Date(candidate.createdAt).toLocaleString()} · 调用日志<ExternalLink className="h-3 w-3" /></Link>)}</div>}
      </section>

      {narrowViewport ? <Drawer open={settingsOpen} onOpenChange={setSettingsOpen} position="bottom" title="绘制设置" description="默认配置保持简单；高级参数按需展开。" className="p-4">{settingContent}</Drawer>
        : <Dialog open={settingsOpen} onOpenChange={setSettingsOpen} title="绘制设置" description="选择预设、补充画面要求，即可直接绘制。" size="lg">{settingContent}</Dialog>}
    </div>
  );
}
