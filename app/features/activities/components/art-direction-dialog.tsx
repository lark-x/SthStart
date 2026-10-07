'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isActivityArtStylePayload, type Activity, type ActivityArtDirection, type GenerationPreset, type GenerationPresetRef, type ImageConfigDocument } from '@sthstart/contracts';
import { fetchGenerationPresets } from '@/app/features/generation/api';
import { activityKeys } from '@/app/lib/query-keys';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { Button } from '@/app/components/ui/button';
import { FormField } from '@/app/components/ui/form-field';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { useImageConfigDraft } from '../queries';
import { commitActivityArtDirection, createActivityArtStyle, fetchActivityArtStyles } from '../studio-api';

function presetRef(preset: GenerationPreset): GenerationPresetRef {
  return { purpose: preset.purpose, presetId: preset.id, presetRevision: preset.revision, workflowId: preset.workflowId, workflowVersion: preset.workflowVersion };
}
function ensureDirection(document: ImageConfigDocument): ActivityArtDirection {
  return document.artDirection ?? { selectedStyle: null, quality: 'draft', canvas: { width: 1024, height: 768 },
    renderProfiles: { draft: null, final: null }, parameterOverrides: {} };
}

/**
 * 常用画布（计划 §10.2）：尺寸是独立设置，不等于草稿／成稿档位。
 * 1920×1080 明确标注高显存／高耗时，且不会自动成为默认。
 */
const CANVAS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '768x512', label: '768 × 512' },
  { value: '1024x768', label: '1024 × 768' },
  { value: '1280x720', label: '1280 × 720' },
  { value: '1920x1080', label: '1920 × 1080（高显存／高耗时）' },
];

/** 预设里实际生效的模型文件名；取不到就说“未声明”，不猜。 */
function presetModelSummary(preset: GenerationPreset | undefined): string | null {
  if (!preset) return null;
  const entry = Object.entries(preset.values).find(([key, value]) =>
    typeof value === 'string' && value.trim() !== '' && /(ckpt|checkpoint|unet|model)/i.test(key));
  return entry ? String(entry[1]) : null;
}

export function ArtDirectionDialog({ activity, open, onOpenChange, beforeApply, onApplied }: {
  activity: Activity; open: boolean; onOpenChange(open: boolean): void;
  beforeApply(): Promise<boolean>; onApplied(): Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const config = useImageConfigDraft(activity.id);
  const styles = useQuery({ queryKey: ['activity-art-styles'], queryFn: fetchActivityArtStyles, enabled: open });
  const presets = useQuery({ queryKey: ['activity-art-profiles'], queryFn: () => fetchGenerationPresets({ appId: 'activities' }), enabled: open });
  const [temporary, setTemporary] = useState<ImageConfigDocument | null>(null);
  const [baseline, setBaseline] = useState('');
  const version = useRef(0);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [error, setError] = useState('');
  const [cardName, setCardName] = useState('');
  const editing = useRef(false);
  useEffect(() => {
    if (!open) { editing.current = false; setTemporary(null); return; }
    if (!config.data || editing.current) return;
    editing.current = true;
    version.current = config.data.draftVersion;
    const document = structuredClone(config.data.document);
    setTemporary(document); setBaseline(JSON.stringify(document)); setError('');
  }, [open, config.data]);
  const direction = temporary ? ensureDirection(temporary) : null;
  const updateDirection = (patch: Partial<ActivityArtDirection>) => {
    if (temporary && direction) setTemporary({ ...temporary, artDirection: { ...direction, ...patch } });
  };
  const close = (next: boolean) => {
    if (busy) return;
    if (!next && temporary && JSON.stringify(temporary) !== baseline) { setDiscardOpen(true); return; }
    onOpenChange(next);
  };
  const apply = async () => {
    if (!temporary || busy) return;
    setBusy(true); setError('');
    try {
      if (!await beforeApply()) throw new Error('活动内容尚未保存，请先处理保存状态。美术输入仍保留。');
      const result = await commitActivityArtDirection(activity.id, { expectedHeadVersion: activity.headVersion,
        expectedImageConfigDraftVersion: version.current, document: temporary });
      queryClient.setQueryData(activityKeys.imageConfigDraft(activity.id), result.draft);
      await queryClient.invalidateQueries({ queryKey: activityKeys.imageConfigRevisions(activity.id) });
      await onApplied();
      setBaseline(JSON.stringify(temporary)); onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '美术设置保存失败，输入仍保留。'); }
    finally { setBusy(false); }
  };
  const saveCard = async () => {
    if (!temporary || !direction || !cardName.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await createActivityArtStyle({ name: cardName.trim(), payload: { schemaKind: 'activity_art_style_v1',
        positiveStylePrompt: temporary.globalStylePrompt ?? '', negativePrompt: temporary.globalNegativePrompt ?? '',
        renderProfiles: direction.renderProfiles, defaultQuality: direction.quality, defaultCanvas: direction.canvas, previewArtifactId: null } });
      await styles.refetch(); setCardName('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存画风卡失败'); }
    finally { setBusy(false); }
  };
  const enabledPresets = presets.data?.items.filter(item => item.enabled && (item.purpose.startsWith('activity_image_') || item.purpose === 'activity_media_slot')) ?? [];
  return <>
    <ResponsiveEditOverlay open={open} onOpenChange={close} title="活动美术设置" description="镜头、漫画和素材共用；只影响之后的新绘制，历史图的“按原配置重绘”与“放大细化”各自保留原配置。"
      footer={<><Button variant="outline" disabled={busy} onClick={() => close(false)}>取消</Button><Button loading={busy} disabled={!temporary || busy} onClick={() => void apply()}>保存并应用</Button></>}>
      {config.isPending ? <p role="status" className="text-sm text-muted">读取美术设置…</p> : config.isError ? <p role="alert" className="text-danger-fg">{config.error.message}</p> : temporary && direction && <fieldset disabled={busy} className="space-y-5">
        <FormField label="画风卡"><select aria-label="活动画风卡" className="h-10 w-full rounded-[var(--radius-control)] border border-border-control bg-surface px-3 text-sm" value={direction.selectedStyle?.id ?? ''} onChange={event => {
          const style = styles.data?.items.find(item => item.id === event.target.value);
          if (!style || !isActivityArtStylePayload(style.payload)) { updateDirection({ selectedStyle: null }); return; }
          const payload = style.payload;
          setTemporary({ ...temporary, globalStylePrompt: payload.positiveStylePrompt, globalNegativePrompt: payload.negativePrompt,
            artDirection: { selectedStyle: { id: style.id, version: style.version, name: style.name, payloadSnapshot: payload },
              quality: payload.defaultQuality, canvas: payload.defaultCanvas, renderProfiles: payload.renderProfiles, parameterOverrides: {} } });
        }}><option value="">自定义活动画风</option>{styles.data?.items.map(style => <option key={style.id} value={style.id}>{style.name} · v{style.version}</option>)}
          {direction.selectedStyle && !styles.data?.items.some(item => item.id === direction.selectedStyle!.id) && <option value={direction.selectedStyle.id}>{direction.selectedStyle.name} · 已保存快照</option>}
        </select></FormField>
        {styles.isError && <p role="alert" className="text-xs text-danger-fg">画风卡加载失败，可继续编辑自定义配置：{styles.error.message}</p>}
        <div className="grid gap-4 sm:grid-cols-2"><FormField label="绘制品质"><select aria-label="活动绘制品质" className="h-10 w-full rounded border border-border-control bg-surface px-3 text-sm" value={direction.quality} onChange={event => updateDirection({ quality: event.target.value as 'draft' | 'final' })}><option value="draft">草图</option><option value="final">成稿</option></select></FormField>
          <FormField label="画幅"><select aria-label="活动画幅" className="h-10 w-full rounded border border-border-control bg-surface px-3 text-sm" value={`${direction.canvas.width}x${direction.canvas.height}`} onChange={event => {
            const [width,height] = event.target.value.split('x').map(Number); updateDirection({ canvas: { width, height } });
          }}>{[...CANVAS_OPTIONS, { value: `${direction.canvas.width}x${direction.canvas.height}`, label: `${direction.canvas.width} × ${direction.canvas.height}（当前）` }]
            .filter((option,index,array) => array.findIndex(item => item.value === option.value) === index)
            .map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <span className="mt-1 block text-xs text-muted">尺寸与草稿／成稿档位互相独立；1920×1080 不会自动成为默认。</span></FormField></div>
        <div className="rounded-[var(--radius-control)] bg-surface-muted p-3">
          <p className="text-sm font-medium text-ink">当前模型摘要</p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {(['draft','final'] as const).map(quality => {
              const bound = direction.renderProfiles[quality];
              const preset = bound ? presets.data?.items.find(item => item.id === bound.presetId) : undefined;
              const model = presetModelSummary(preset);
              return <li key={quality}>{quality === 'draft' ? '草图' : '成稿'}：{bound
                ? `${preset?.name ?? '已绑定预设（需检查可用性）'} · ${model ?? '预设未声明模型文件'}`
                : '跟随公共生成绑定'}</li>;
            })}
          </ul>
          <p className="mt-1 text-xs text-muted">这里只读展示，改档位请用下面的“高级：档位预设与反向词”。</p>
        </div>
        <FormField label="补充画风词" hint="会在画面描述优化之后追加；工作流内部质量词无需重复填写。"><Textarea rows={3} value={temporary.globalStylePrompt ?? ''} onChange={event => setTemporary({ ...temporary, globalStylePrompt: event.target.value })} /></FormField>
        <details className="rounded-[var(--radius-control)] bg-surface-muted p-4"><summary className="cursor-pointer text-sm font-semibold">高级：档位预设与反向词</summary><div className="mt-4 space-y-4">
          <p className="text-xs text-muted">两档分别绑定已发布预设，不能仅换 Base/Turbo 模型而共用采样参数。为空时跟随公共生成绑定；未保存前不会改动现有配置。</p>
          {(['draft','final'] as const).map(quality => <FormField key={quality} label={`${quality === 'draft' ? '草图' : '成稿'}预设`}><select aria-label={`${quality}预设`} className="h-10 w-full rounded border border-border-control bg-surface px-3 text-sm" value={direction.renderProfiles[quality]?.presetId ?? ''} onChange={event => {
            const selected = enabledPresets.find(item => item.id === event.target.value);
            updateDirection({ renderProfiles: { ...direction.renderProfiles, [quality]: selected ? presetRef(selected) : null } });
          }}><option value="">跟随公共生成绑定</option>{enabledPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name} · r{preset.revision}</option>)}
            {direction.renderProfiles[quality] && !enabledPresets.some(item => item.id === direction.renderProfiles[quality]!.presetId) && <option value={direction.renderProfiles[quality]!.presetId}>已绑定预设（需检查可用性）</option>}
          </select></FormField>)}
          {presets.isError && <p role="alert" className="text-xs text-danger-fg">生成预设读取失败：{presets.error.message}</p>}
          <FormField label="活动反向词" hint="空文本表示明确不使用活动负向词；不会被自动补回。"><Textarea rows={3} value={temporary.globalNegativePrompt ?? ''} onChange={event => setTemporary({ ...temporary, globalNegativePrompt: event.target.value })} /></FormField>
          <a href="/settings/generation" target="_blank" rel="noopener noreferrer" className="text-xs text-accent">管理已发布工作流、模型和全局 LoRA</a>
        </div></details>
        <details className="rounded bg-surface-muted p-4"><summary className="cursor-pointer text-sm">保存为可复用画风卡</summary><div className="mt-3 flex gap-2"><Input aria-label="新画风卡名称" value={cardName} onChange={event => setCardName(event.target.value)} placeholder="画风名称" /><Button variant="outline" disabled={!cardName.trim() || busy} onClick={() => void saveCard()}>保存卡片</Button></div><p className="mt-2 text-xs text-muted">创建新卡，不覆盖同名旧卡，不自动应用到其他活动。</p></details>
      </fieldset>}
      {error && <p role="alert" className="mt-3 whitespace-pre-wrap text-sm text-danger-fg">{error}</p>}
    </ResponsiveEditOverlay>
    <ConfirmDialog open={discardOpen} onOpenChange={setDiscardOpen} title="放弃未应用的美术设置？" description="活动当前配置不会改变。" onConfirm={() => { setDiscardOpen(false); onOpenChange(false); }} confirmLabel="放弃修改" />
  </>;
}
