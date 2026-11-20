'use client';

import { useId } from 'react';
import { useFieldArray, type Control, type FieldErrors, type UseFormClearErrors, type UseFormGetValues, type UseFormRegister, type UseFormSetValue } from 'react-hook-form';
import { Camera, Images, RotateCcw, User } from 'lucide-react';
import type { CharacterAssetDetail, CharacterDraftV2, CharacterVariant } from '@sthstart/contracts';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { Card } from '@/app/components/ui/card';
import { TagsInput } from '@/app/components/shared/tags-input';
import type { CharacterFormValues } from '../model/character-form-values';
import { effectiveCharacterDraft, type CharacterEditorStatus } from '../model/character-editor-model';
import { CharacterAssetTab } from './character-asset-tab';
import { CharacterDossierReading, CharacterPersonaPanel, CharacterVisualPanel } from './character-editor-fields';

export type CharacterEditorTab = 'persona' | 'visual' | 'assets';

/** 右栏表单：档案头、分段视图与保存状态；只通过 RHF 读写值，不另存角色草稿。 */
export function CharacterEditorForm({
  characterId,
  control,
  register,
  setValue,
  clearErrors,
  errors,
  status,
  isDirty,
  draft,
  tags,
  setTags,
  onDirty,
  assetsCount,
  avatarAssetId,
  portraitAssetId,
  activeVariant,
  onUpdateVariant,
  hasActiveVariant,
  onResetVariant,
  onRefreshCharacter,
  activeTab,
  onTabChange,
  editing,
  assets,
}: {
  characterId?: string;
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
  getValues?: UseFormGetValues<CharacterFormValues>;
  setValue: UseFormSetValue<CharacterFormValues>;
  clearErrors: UseFormClearErrors<CharacterFormValues>;
  errors: FieldErrors<CharacterFormValues>;
  status: CharacterEditorStatus;
  isDirty: boolean;
  draft: CharacterDraftV2;
  tags: string[];
  setTags: (tags: string[]) => void;
  onDirty: () => void;
  assetsCount?: number;
  avatarAssetId?: string | null;
  portraitAssetId?: string | null;
  activeVariant?: CharacterVariant | null;
  onUpdateVariant?: (variantId: string, patch: Partial<CharacterVariant>) => void;
  hasActiveVariant: boolean;
  onResetVariant: () => void;
  onRefreshCharacter: () => void;
  activeTab: CharacterEditorTab;
  onTabChange: (tab: CharacterEditorTab) => void;
  editing: boolean;
  assets: CharacterAssetDetail[];
}) {
  const panelPrefix = useId();
  const effectiveDraft = effectiveCharacterDraft(draft, activeVariant);
  const { fields: visualLoraFields, append: appendVisualLora, remove: removeVisualLora } = useFieldArray({
    control,
    name: 'visualLoras',
  });

  return (
    <Card className="order-2 flex w-full min-w-0 flex-col gap-5">
      {/* Dossier Hero Header: 仅编辑主档案时展示表单输入（阅读态由顶部名片横幅统一展示） */}
      {editing && !activeVariant && <div className="space-y-3.5">
        <div className="flex items-center justify-between gap-3 [&_.ui-mantine-input-wrapper]:min-w-0 [&_.ui-mantine-input-wrapper]:flex-1">
          <Input
            type="text"
            {...register('displayName', {
              required: true,
              onChange: () => {
                clearErrors('displayName');
                onDirty();
              },
            })}
            error={Boolean(errors.displayName)}
            variant="inline"
            aria-label="角色名称"
            placeholder="角色名称（例如：芙宁娜）"
            className="!h-auto !min-h-0 !px-0 !py-1 !text-[26px] sm:!text-[28px] !font-[680] !tracking-[-0.02em] text-ink placeholder:text-fg-subtle"
          />
          {hasActiveVariant && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onResetVariant}
              className="shrink-0 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              <span>返回主档案</span>
            </Button>
          )}
        </div>
        {errors.displayName && (
          <p className="text-xs text-danger">请填写角色名称</p>
        )}

        <div className="h-px bg-gradient-to-r from-border-default via-border-subtle to-transparent" aria-hidden="true" />

        {/* 结构化档案属性栏 */}
        <div className="space-y-3 rounded-xl border border-border-subtle bg-surface-sunken/50 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="shrink-0 font-medium text-ink/80">所属作品</span>
              <Input
                {...register('work', { onChange: onDirty })}
                aria-label="所属作品"
                placeholder="如：原神、星穹铁道、原创世界"
                className="h-8 min-h-8 w-52 bg-surface-input px-2.5 text-sm sm:text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className="shrink-0 font-medium text-ink/80 mr-1">角色定位</span>
              {(
                [
                  { value: 'ip', label: '原作角色' },
                  { value: 'derivative', label: '同人衍生' },
                  { value: 'original', label: '原创角色' },
                ] as const
              ).map((opt) => {
                const active = draft.originType === opt.value;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-pressed={active}
                    onClick={() => {
                      setValue('originType', opt.value, { shouldDirty: true });
                      onDirty();
                    }}
                    className={`min-h-[var(--control-h-touch)] sm:h-7 sm:min-h-7 px-2.5 rounded-control border text-xs font-medium ${
                      active
                        ? 'border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-fg)]'
                        : 'border-border-control bg-surface-input text-muted enabled:hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border-subtle/70 pt-2.5 sm:flex-row sm:items-center sm:gap-2.5 [&_.ui-mantine-input-wrapper]:min-w-0 [&_.ui-mantine-input-wrapper]:flex-1">
            <span className="shrink-0 text-xs font-medium text-ink/80">特征标签</span>
            <TagsInput
              value={tags}
              onChange={(nextTags) => {
                setTags(nextTags);
                onDirty();
              }}
              placeholder="添加角色特征标签，逗号或回车分隔（如：枫丹、水神、戏剧家）"
              aria-label="角色标签"
              className="min-h-9 w-full bg-surface-input text-sm text-ink placeholder:text-fg-subtle"
            />
          </div>
        </div>
      </div>}

      {/* 衍生形态专属属性面板（装甲 / SP / 阶段形态自带服装描述与背景故事） */}
      {editing && activeVariant && onUpdateVariant && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink">
              正在编辑衍生形态：{activeVariant.name}
              {activeVariant.variantKind === 'sp' ? '（SP 形态）' : activeVariant.variantKind === 'stage' ? '（装甲 / 阶段）' : ''}
            </span>
            <span className="text-xs text-muted">以下服装描写与背景故事归属当前形态</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm"><span>形态名称</span><Input value={activeVariant.name} onChange={e => onUpdateVariant(activeVariant.id, { name: e.target.value })} /></label>
            <label className="block space-y-1 text-sm"><span>形态类型</span><Select value={activeVariant.variantKind || 'form'} onChange={e => onUpdateVariant(activeVariant.id, { variantKind: e.target.value as CharacterVariant['variantKind'] })}><option value="form">独立形态</option><option value="stage">装甲 / 阶段</option><option value="sp">SP 形态</option></Select></label>
            <label className="block space-y-1 text-sm sm:col-span-2"><span>形态概述</span><Textarea rows={2} value={activeVariant.summary ?? draft.summary} onChange={e => onUpdateVariant(activeVariant.id, { summary: e.target.value })} /></label>
            <label className="block space-y-1 text-sm"><span>形态基础外貌</span><Textarea rows={3} value={activeVariant.appearance?.baseText ?? draft.appearance.baseText} onChange={e => onUpdateVariant(activeVariant.id, { appearance: { baseText: e.target.value, defaultOutfitText: activeVariant.appearance?.defaultOutfitText ?? draft.appearance.defaultOutfitText } })} /></label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-ink">形态服装描述（用于生图与出装）</span>
              <Textarea
                rows={3}
                value={activeVariant.appearance?.defaultOutfitText || ''}
                onChange={(e) =>
                  onUpdateVariant(activeVariant.id, {
                    appearance: {
                      baseText: activeVariant.appearance?.baseText ?? draft.appearance.baseText,
                      defaultOutfitText: e.target.value,
                    },
                  })
                }
                className="bg-surface text-xs"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-ink">形态背景故事（阶段设定）</span>
              <Textarea
                rows={3}
                value={activeVariant.personaText ?? draft.personaText}
                onChange={(e) => onUpdateVariant(activeVariant.id, { personaText: e.target.value })}
                className="bg-surface text-xs"
              />
            </label>
            {(['avatar', 'portrait'] as const).map(kind => <label key={kind} className="block space-y-1 text-sm"><span>{kind === 'avatar' ? '形态头像' : '形态立绘'}</span>
              <Select value={activeVariant[`${kind}AssetId`] || ''} onChange={e => { const asset = assets.find(item => item.id === e.target.value); onUpdateVariant(activeVariant.id, { [`${kind}AssetId`]: asset?.id ?? null, [`${kind}Url`]: asset?.url ?? null }); }}>
                <option value="">沿用主档案图片</option>{assets.filter(asset => asset.url).map(asset => <option key={asset.id} value={asset.id}>{asset.title || '未命名图片'}</option>)}
              </Select></label>)}
          </div>
        </div>
      )}

      {/* 分段创作画布导航（精简为 3 项，LoRA 收进外貌高级区） */}
      <PageTabs variant="local" ariaLabel="角色档案编辑分段" value={activeTab} onChange={id => onTabChange(id as CharacterEditorTab)} className="character-editor-tabs w-fit max-w-full" tabs={[
        { id: 'persona', panelId: `${panelPrefix}-persona`, label: <><User className="hidden h-4 w-4 sm:inline" aria-hidden="true" />人设演绎</> },
        { id: 'visual', panelId: `${panelPrefix}-visual`, label: <><Camera className="hidden h-4 w-4 sm:inline" aria-hidden="true" />外貌生图</> },
        { id: 'assets', panelId: `${panelPrefix}-assets`, label: <><Images className="hidden h-4 w-4 sm:inline" aria-hidden="true" />图片皮肤</>, count: assetsCount },
      ]} />

      {activeTab === 'persona' && (
        <div id={`${panelPrefix}-persona`} role="tabpanel" aria-label="人设演绎" tabIndex={0}>
          {editing && !activeVariant ? <CharacterPersonaPanel control={control} register={register} draft={draft} onDirty={onDirty} /> : <CharacterDossierReading draft={effectiveDraft} />}
        </div>
      )}

      {activeTab === 'visual' && (
        <div id={`${panelPrefix}-visual`} role="tabpanel" aria-label="外貌生图" tabIndex={0}>{editing && !activeVariant ? <CharacterVisualPanel
          register={register}
          onDirty={onDirty}
          loraFields={visualLoraFields}
          onAppendLora={() => appendVisualLora({ model: '', strength: 1, triggerWord: '', enabled: true })}
          onRemoveLora={removeVisualLora}
        /> : <CharacterDossierReading draft={effectiveDraft} visual />}</div>
      )}

      {activeTab === 'assets' && (
        <div id={`${panelPrefix}-assets`} role="tabpanel" aria-label="图片皮肤" tabIndex={0} className="space-y-5">
          {characterId ? (
            <CharacterAssetTab
              characterId={characterId}
              avatarAssetId={activeVariant?.avatarAssetId ?? avatarAssetId ?? undefined}
              portraitAssetId={activeVariant?.portraitAssetId ?? portraitAssetId ?? undefined}
              displayName={draft.displayName || '未命名角色'}
              variantName={activeVariant?.name}
              onSelectVariantImage={activeVariant && onUpdateVariant ? (asset, kind) => onUpdateVariant(activeVariant.id, { [`${kind}AssetId`]: asset.id, [`${kind}Url`]: asset.url }) : undefined}
              onRefreshCharacter={onRefreshCharacter}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border-subtle bg-surface/50 p-12 text-center text-muted">
              <Images className="mx-auto h-8 w-8 text-muted/50 mb-3" />
              <p className="text-sm font-medium text-ink">请先保存角色基础信息</p>
              <p className="text-xs text-muted mt-1">
                保存后即可管理该角色的头像、主立绘、多皮肤、表情差分与参考图。
              </p>
            </div>
          )}
        </div>
      )}

      {/* 底部保存状态栏 */}
      <div className="pt-4 border-t border-border-subtle flex items-center justify-between text-xs text-muted">
        <span className="text-xs text-muted">
          {status === 'error' ? '保存未完成，请查看错误提示后重试' : status === 'saving' ? '正在保存完整档案' : status === 'dirty' || isDirty
            ? '档案有未保存更改'
            : status === 'saved'
            ? '全部更改已保存到本地数据库'
            : '档案处于就绪状态'}
        </span>
        <span className="hidden sm:inline text-xs text-muted">
          顶部按钮与快捷键随时可提交
        </span>
      </div>
    </Card>
  );
}
