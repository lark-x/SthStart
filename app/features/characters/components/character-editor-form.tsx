'use client';

import { useFieldArray, type Control, type FieldErrors, type UseFormClearErrors, type UseFormGetValues, type UseFormRegister, type UseFormSetValue } from 'react-hook-form';
import { Camera, Images, RotateCcw, User } from 'lucide-react';
import type { CharacterDraftV2 } from '@sthstart/contracts';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { TagsInput } from '@/app/components/shared/tags-input';
import type { CharacterFormValues } from '../model/character-form-values';
import type { CharacterEditorStatus } from '../model/character-editor-model';
import { CharacterAssetTab } from './character-asset-tab';
import { CharacterLoraPanel, CharacterPersonaPanel, CharacterVisualPanel } from './character-editor-fields';

export type CharacterEditorTab = 'persona' | 'visual' | 'assets' | 'lora';

/** 右栏表单：档案头、分段视图与保存状态；只通过 RHF 读写值，不另存角色草稿。 */
export function CharacterEditorForm({
  characterId,
  control,
  register,
  getValues,
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
  hasActiveVariant,
  onResetVariant,
  onRefreshCharacter,
  activeTab,
  onTabChange,
}: {
  characterId?: string;
  control: Control<CharacterFormValues>;
  register: UseFormRegister<CharacterFormValues>;
  getValues: UseFormGetValues<CharacterFormValues>;
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
  hasActiveVariant: boolean;
  onResetVariant: () => void;
  onRefreshCharacter: () => void;
  activeTab: CharacterEditorTab;
  onTabChange: (tab: CharacterEditorTab) => void;
}) {
  const { fields: visualLoraFields, append: appendVisualLora, remove: removeVisualLora } = useFieldArray({
    control,
    name: 'visualLoras',
  });

  return (
    <div className="order-1 w-full min-w-0 space-y-5 tpl-panel p-5 lg:order-2">
      {/* Dossier Hero Header: 档案大标题 + 结构化属性栏 */}
      <div className="space-y-3.5">
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
            aria-label="角色名称"
            placeholder="角色名称（例如：芙宁娜）"
            className={`!h-auto !min-h-0 !rounded-none !border-0 !border-b !border-transparent !bg-transparent !px-0 !py-1 !text-[26px] sm:!text-[28px] !font-[680] !tracking-[-0.02em] text-ink placeholder:text-fg-subtle hover:!border-border-subtle focus:!border-accent focus-visible:!outline-none transition-colors ${
              errors.displayName ? '!border-danger focus:!border-danger' : ''
            }`}
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

            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="shrink-0 font-medium text-ink/80">角色定位</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={draft.originType === 'ip'}
                onClick={() => {
                  const current = getValues('originType');
                  setValue('originType', current === 'ip' ? 'original' : 'ip', { shouldDirty: true });
                  onDirty();
                }}
                className={`min-h-[var(--control-h-touch)] sm:h-8 sm:min-h-8 px-3 rounded-control border text-xs font-medium ${
                  draft.originType === 'ip'
                    ? 'border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-fg)]'
                    : 'border-border-control bg-surface-input text-muted enabled:hover:text-ink'
                }`}
              >
                {draft.originType === 'ip' ? 'IP 角色' : '原创角色'}
              </Button>
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
      </div>

      {/* 分段创作画布导航 */}
      <PageTabs variant="local" ariaLabel="角色档案编辑分段" value={activeTab} onChange={id => onTabChange(id as CharacterEditorTab)} className="character-editor-tabs w-fit max-w-full" tabs={[
        {id:'persona',label:<><User className="h-4 w-4" aria-hidden="true" />人设</>},
        {id:'visual',label:<><Camera className="h-4 w-4" aria-hidden="true" />外貌</>},
        {id:'assets',label:<><Images className="h-4 w-4" aria-hidden="true" />资产</>,count:assetsCount},
        {id:'lora',label:'LoRA',count:visualLoraFields.length || undefined},
      ]} />

      {activeTab === 'persona' && (
        <CharacterPersonaPanel register={register} draft={draft} onDirty={onDirty} />
      )}

      {activeTab === 'visual' && (
        <CharacterVisualPanel register={register} onDirty={onDirty} />
      )}

      {activeTab === 'assets' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {characterId ? (
            <CharacterAssetTab
              characterId={characterId}
              avatarAssetId={avatarAssetId ?? undefined}
              portraitAssetId={portraitAssetId ?? undefined}
              displayName={draft.displayName || '未命名角色'}
              onRefreshCharacter={onRefreshCharacter}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border-subtle bg-surface/50 p-12 text-center text-muted">
              <Images className="mx-auto h-8 w-8 text-muted/50 mb-3" />
              <p className="text-sm font-medium text-ink">请先保存角色基础信息</p>
              <p className="text-xs text-muted mt-1">
                保存后即可开启该角色的 7 大细分分类资产库（立绘、头像、差分、服装、CG、设定图）、标签及邻舍双向推拉。
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'lora' && (
        <CharacterLoraPanel
          register={register}
          fields={visualLoraFields}
          onAppend={() => appendVisualLora({ model: '', strength: 1, triggerWord: '', enabled: true })}
          onRemove={removeVisualLora}
        />
      )}

      {/* 底部保存状态栏 */}
      <div className="pt-4 border-t border-border-subtle flex items-center justify-between text-xs text-muted">
        <span className="text-xs text-muted">
          {status === 'dirty' || isDirty
            ? '档案有未保存更改'
            : status === 'saved'
            ? '全部更改已保存到本地数据库'
            : '档案处于就绪状态'}
        </span>
        <span className="hidden sm:inline text-[11px] text-muted">
          顶部按钮与快捷键随时可提交
        </span>
      </div>
    </div>
  );
}
