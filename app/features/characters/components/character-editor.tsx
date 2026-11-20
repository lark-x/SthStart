'use client';

import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { ArrowLeft, Check, Download, FolderInput, GitFork, History, Layers, MoreHorizontal, Save, Sparkles } from 'lucide-react';
import { Menu } from '@mantine/core';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Badge } from '@/app/components/ui/badge';
import { Dialog } from '@/app/components/ui/dialog';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useOverlayPortalTarget } from '@/app/components/ui/overlay-policy';
import { useToast } from '@/app/providers/ui-provider';
import { useCharacterDetail, useCharacterAssets } from '../queries';
import { useCharacterBrowser } from '../hooks/use-character-browser';
import { usePublishCharacter } from '../mutations';
import { uploadCharacterAsset } from '../api';
import { EMPTY_DRAFT_V2 } from '../schemas';
import {
  characterDraftToFormValues,
  characterFormValuesToDraft,
  type CharacterFormValues,
} from '../model/character-form-values';
import { buildCharacterAvatarPrompt, effectiveCharacterDraft, saveCharacterStage, type CharacterEditorStatus } from '../model/character-editor-model';
import type { CharacterVariant } from '@sthstart/contracts';
import { useCharacterDraftSession } from '../hooks/use-character-draft-session';
import { useCharacterAssetActions } from '../hooks/use-character-asset-actions';
import { useCharacterAvatarGeneration } from '../hooks/use-character-avatar-generation';
import { useCharacterVariants } from '../hooks/use-character-variants';
import { CharacterEditorSidebar } from './character-editor-sidebar';
import { CharacterEditorForm, type CharacterEditorTab } from './character-editor-form';
import { CharacterAvatarGenerationOverlay, CharacterAvatarUrlDialog, type CharacterAvatarGenerationPanel } from './character-avatar-dialogs';
import { CharacterImportDialog } from './character-import-dialog';
import { CharacterMultiSourceDialog } from './character-multi-source-dialog';
import { CharacterUpstreamDialog } from './character-upstream-dialog';
import { CharacterForkDialog } from './character-fork-dialog';

const EMPTY_FORM_VALUES = characterDraftToFormValues(EMPTY_DRAFT_V2);

export type CharacterEditorProps = {
  characterId?: string;
  /** 页面级槽位：注入带来源装配的生成面板；不传时使用通用无上下文面板。 */
  generationPanel?: CharacterAvatarGenerationPanel;
};

export function CharacterEditor({ characterId, generationPanel }: CharacterEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<CharacterEditorStatus>('clean');
  const [tags, setTags] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<CharacterEditorTab>('persona');
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');
  const [aiAvatarDialogOpen, setAiAvatarDialogOpen] = useState(false);
  const [addVariantDialogOpen, setAddVariantDialogOpen] = useState(false);
  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantKind, setNewVariantKind] = useState<CharacterVariant['variantKind']>('form');
  const [editing, setEditing] = useState(!characterId);
  const [uploadingVariant, setUploadingVariant] = useState(false);
  const [generationVariant, setGenerationVariant] = useState<{ id: string; name: string } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [multiSourceDialogOpen, setMultiSourceDialogOpen] = useState(false);
  const [upstreamDialogOpen, setUpstreamDialogOpen] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [stageLabel, setStageLabel] = useState('');
  const [savingStage, setSavingStage] = useState(false);
  const menuPortalTarget = useOverlayPortalTarget();
  const publishMutation = usePublishCharacter();
  const worksBrowser = useCharacterBrowser({ page: 1, pageSize: 20 }, forkDialogOpen);

  // Form 仍是唯一表单事实；服务器快照、脏值与恢复由 session Hook 协调。
  const { control, register, getValues, reset, setValue, setError, clearErrors, formState: { isDirty, errors } } = useForm<CharacterFormValues>({ defaultValues: EMPTY_FORM_VALUES });
  const watchedValues = useWatch({ control });
  const draft = characterFormValuesToDraft((watchedValues ?? EMPTY_FORM_VALUES) as CharacterFormValues);
  const markDirty = useCallback(() => setStatus('dirty'), []);
  const variantsApi = useCharacterVariants({ draft, markDirty });

  const { data: detailData, error: detailError, refetch: refetchDetail } = useCharacterDetail(characterId);
  const { data: assetsData, refetch: refetchAssets } = useCharacterAssets(characterId);

  const session = useCharacterDraftSession({
    characterId,
    detailData,
    refetchDetail,
    getValues,
    reset,
    setError,
    clearErrors,
    setStatus,
    tags,
    setTags,
    variants: variantsApi.variants,
    setVariants: variantsApi.setVariants,
  });
  const handleSave = session.handleSave;

  const assetActions = useCharacterAssetActions({ characterId, refetchDetail, refetchAssets });
  const avatar = useCharacterAvatarGeneration({ characterId, enabled: aiAvatarDialogOpen, refetchDetail });

  const currentVariant = variantsApi.variants.find((variant) => variant.id === variantsApi.activeVariantId) || null;
  const effectiveDraft = effectiveCharacterDraft(draft, currentVariant);
  const currentAvatarUrl = currentVariant?.avatarUrl || detailData?.avatarUrl;
  const currentPortraitUrl = currentVariant?.portraitUrl || detailData?.portraitUrl;
  const assets = assetsData?.items || [];

  const handleFetchUrlAvatar = async () => {
    const done = await assetActions.importAvatarFromUrl(customAvatarUrl);
    if (!done) return;
    setUrlDialogOpen(false);
    setCustomAvatarUrl('');
  };

  const handleTriggerAiAvatar = async () => {
    if (!characterId) {
      toast.warning('请先保存角色档案后再生成 AI 头像');
      return;
    }
    if (avatar.taskId || avatar.result) { setAiAvatarDialogOpen(true); return; }
    if (session.hasUnsavedChanges && !(await session.handleSave())) return;
    setGenerationVariant(currentVariant ? { id: currentVariant.id, name: currentVariant.name } : null);
    avatar.setPrompt(buildCharacterAvatarPrompt(effectiveDraft));
    setAiAvatarDialogOpen(true);
  };

  const handleUploadAsset = async (event: ChangeEvent<HTMLInputElement>, kind: 'avatar' | 'portrait') => {
    if (!currentVariant || !characterId) { assetActions.handleUploadAsset(event, kind); return; }
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingVariant(true);
    try {
      const asset = await uploadCharacterAsset(characterId, file, kind, false);
      variantsApi.updateVariant(currentVariant.id, { [`${kind}AssetId`]: asset.id, [`${kind}Url`]: asset.url });
      await Promise.all([refetchAssets(), refetchDetail()]);
      toast.success(`已选择「${currentVariant.name}」的${kind === 'avatar' ? '头像' : '立绘'}，保存档案后生效`);
    } catch (error) { toast.error('上传形态图片失败', error instanceof Error ? error.message : String(error)); }
    finally { setUploadingVariant(false); event.target.value = ''; }
  };

  const handleAddVariant = () => {
    const variant = variantsApi.addVariant(newVariantName, newVariantKind);
    if (!variant) return;
    setNewVariantName('');
    setAddVariantDialogOpen(false);
    setEditing(true);
  };

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [handleSave]);

  // Loading Skeleton
  if (characterId && !detailData) {
    if (detailError) {
      return (
        <div className="bg-paper text-ink">
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-lg font-semibold">角色加载失败</p>
            <p className="max-w-sm text-sm text-muted">
              {detailError instanceof Error ? detailError.message : '无法加载该角色，请稍后重试。'}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => void refetchDetail()}>
                重试
              </Button>
              <Link
                href="/apps/characters"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-accent transition-colors"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>返回资料库</span>
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="bg-paper text-ink">
        <div className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-8">
          <Skeleton className="h-10 w-1/3" />
          <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-5">
            <Skeleton className="h-[520px] w-full rounded-xl" />
            <Skeleton className="h-[640px] w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageContainer className="space-y-4 pb-8">
      {/* 顶部页头：只显示页面定位，不再重复正文的超大号角色标题 */}
      <PageHeader compact
        backHref="/apps/characters"
        backLabel="角色资料库"
        title={characterId ? '角色详情' : '新建角色档案'}
        status={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge role="status" variant={status === 'error' ? 'error' : status === 'saving' || session.hasUnsavedChanges ? 'warning' : 'online'}
            >
              {status === 'saving' ? (
                '正在保存...'
              ) : status === 'error' ? '保存未完成' : session.hasUnsavedChanges ? '未保存修改' : status === 'saved' ? (
                <>
                  <Check className="h-3 w-3" />
                  已保存
                </>
              ) : (
                '就绪'
              )}
            </Badge>
            {draft.work && (
              <span className="text-xs text-muted truncate max-w-[160px]">
                {draft.work}
              </span>
            )}
          </div>
        }
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {characterId && <Button size="sm" variant="outline" aria-pressed={editing} onClick={() => setEditing(value => !value)}>{editing ? '返回阅读' : currentVariant ? '编辑当前形态' : '编辑档案'}</Button>}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                if (characterId && session.hasUnsavedChanges && !(await session.handleSave())) return;
                setUpstreamDialogOpen(true);
              }}
              disabled={status === 'saving' || savingStage}
              aria-label="上游重构 RP 卡"
              className="gap-1.5 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span className="hidden sm:inline">上游重构 RP 卡</span><span className="sm:hidden">上游采集</span>
            </Button>

            <Button
              size="sm"
              variant="accent"
              onClick={() => void session.handleSave()}
              loading={status === 'saving'}
              disabled={savingStage}
              className="px-4 font-semibold shadow-sm"
            >
              <Save className="h-4 w-4 mr-1.5" aria-hidden="true" />
              <span>保存档案</span>
            </Button>

            <Menu
              position="bottom-end"
              withinPortal
              portalProps={menuPortalTarget ? { target: menuPortalTarget } : undefined}
              closeOnItemClick
              returnFocus
              shadow="md"
              radius="md"
            >
              <Menu.Target>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="更多档案操作"
                  className="px-2.5"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Menu.Target>
              <Menu.Dropdown className="w-48">
                <Menu.Item
                  leftSection={<Layers className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
                  onClick={() => setAddVariantDialogOpen(true)}
                >
                  新增衍生形态
                </Menu.Item>
                <Menu.Item
                  leftSection={<FolderInput className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
                  onClick={() => setImportDialogOpen(true)}
                >
                  导入酒馆角色卡
                </Menu.Item>
                <Menu.Item
                  leftSection={<Download className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
                  disabled={!characterId}
                  onClick={() => void assetActions.exportTavern(draft.displayName)}
                >
                  导出酒馆卡 (JSON)
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        }
      />

      {session.errorMessage && (
        <div className="mt-4">
          <Alert variant="danger" onDismiss={() => session.setErrorMessage('')}>
            {session.errorMessage}
            {session.revisionConflict && <Button className="mt-2" size="sm" variant="outline" loading={status === 'saving'} onClick={() => void session.preserveAndReload()}>
              保留本机草稿并载入最新版
            </Button>}
          </Alert>
        </div>
      )}
      {session.recoveryAvailable && <Alert className="mt-4" variant="info" title="本机会话中保留了一份角色草稿">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-auto min-h-[var(--control-h-touch)] sm:min-h-0 px-0 py-0 text-sm font-normal text-current underline enabled:hover:bg-transparent"
          onClick={session.downloadRecovery}
        >
          下载保留的草稿，供对照合并
        </Button>
      </Alert>}

      {/* 原作/同人：同源角色族切换条与派生按钮 */}
      {characterId && (draft.originType !== 'original' || (detailData?.familyMembers?.length ?? 0) > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-hairline bg-surface px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium text-muted mr-1">同源版本</span>
            {(detailData?.familyMembers && detailData.familyMembers.length > 0
              ? detailData.familyMembers
              : [{ id: characterId, displayName: draft.displayName, work: draft.work, originType: draft.originType, interpretation: '', avatarUrl: null }]
            ).map((member) => {
              const active = member.id === characterId;
              const prefix = member.originType === 'ip' ? '原作' : member.originType === 'derivative' ? '同人' : '原创';
              return (
                <Link
                  key={member.id}
                  href={`/apps/characters/${member.id}`}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-fg)]'
                      : 'border-hairline bg-surface-sunken/60 text-muted hover:text-ink'
                  }`}
                >
                  <span>{prefix}</span>
                  <span>·</span>
                  <span className="truncate max-w-[160px]">{member.work || member.displayName}</span>
                </Link>
              );
            })}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              if (session.hasUnsavedChanges && !(await session.handleSave())) return;
              setForkDialogOpen(true);
            }}
            className="h-7 min-h-7 gap-1 px-2.5 text-xs"
          >
            <GitFork className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>复制到同人作品</span>
          </Button>
        </div>
      )}

      {/* 原创角色专属：阶段人设版本记录（仅原创故事开启多阶段版本） */}
      {characterId && draft.originType === 'original' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-hairline bg-surface px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted mr-1">
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span>阶段版本</span>
            </span>
            {(detailData?.versions || []).length === 0 ? (
              <span className="text-xs text-muted">尚无阶段快照（可随故事推进保存阶段版本）</span>
            ) : (
              (detailData?.versions || []).slice(0, 6).map((ver) => (
                <span
                  key={ver.version}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                    ver.version === detailData?.latestVersion
                      ? 'border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-fg)] font-medium'
                      : 'border-hairline bg-surface-sunken/60 text-muted'
                  }`}
                >
                  <span className="tabular-nums">v{ver.version}</span>
                  {ver.versionLabel && <span>· {ver.versionLabel}</span>}
                </span>
              ))
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setStageDialogOpen(true)}
            className="h-7 min-h-7 gap-1 px-2.5 text-xs"
          >
            <History className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>保存为新阶段</span>
          </Button>
        </div>
      )}

      {/* 左右双栏工作台：左栏紧凑卡片（立绘 + 核心身份/标签/形态），右栏全宽人设与编辑画布 */}
      <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] gap-5 items-start">
        <CharacterEditorSidebar
          characterId={characterId}
          displayName={draft.displayName || ''}
          work={draft.work}
          originType={draft.originType}
          tags={tags}
          summary={effectiveDraft.summary}
          birthday={draft.birthday}
          editing={editing}
          onResetVariant={() => variantsApi.setActiveVariantId(null)}
          avatarUrl={currentAvatarUrl ?? undefined}
          portraitUrl={currentPortraitUrl ?? undefined}
          assets={assets}
          assetsLoaded={Boolean(assetsData?.items)}
          variants={variantsApi.variants}
          activeVariantId={variantsApi.activeVariantId}
          onSelectVariant={variantsApi.setActiveVariantId}
          onRemoveVariant={variantsApi.removeVariant}
          onAddVariant={() => setAddVariantDialogOpen(true)}
          onOpenAssets={() => setActiveTab('assets')}
          onUploadAsset={(event, kind) => void handleUploadAsset(event, kind)}
          onSetActiveAsset={assetActions.handleSetActiveAsset}
          isUploading={assetActions.isUploading || uploadingVariant}
          isSettingActive={assetActions.isSettingActive}
          onOpenMultiSource={() => { variantsApi.setActiveVariantId(null); setMultiSourceDialogOpen(true); }}
          onOpenUrlImport={() => { variantsApi.setActiveVariantId(null); setUrlDialogOpen(true); }}
          onOpenImport={() => setImportDialogOpen(true)}
          onExportTavern={() => void assetActions.exportTavern(draft.displayName)}
          onTriggerAiAvatar={() => void handleTriggerAiAvatar()}
          avatarTaskId={avatar.taskId}
          hasAvatarResult={Boolean(avatar.result)}
        />

        <CharacterEditorForm
          characterId={characterId}
          control={control}
          register={register}
          getValues={getValues}
          setValue={setValue}
          clearErrors={clearErrors}
          errors={errors}
          status={status}
          isDirty={isDirty}
          draft={draft}
          tags={tags}
          setTags={setTags}
          onDirty={markDirty}
          assetsCount={assetsData?.items?.length}
          avatarAssetId={detailData?.avatarAssetId}
          portraitAssetId={detailData?.portraitAssetId}
          activeVariant={currentVariant}
          onUpdateVariant={variantsApi.updateVariant}
          hasActiveVariant={Boolean(currentVariant)}
          onResetVariant={() => variantsApi.setActiveVariantId(null)}
          onRefreshCharacter={() => {
            void refetchDetail();
            void refetchAssets();
          }}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          editing={editing}
          assets={assets}
        />
      </div>

      <CharacterAvatarUrlDialog
        open={urlDialogOpen}
        onOpenChange={setUrlDialogOpen}
        value={customAvatarUrl}
        onValueChange={setCustomAvatarUrl}
        onSubmit={() => void handleFetchUrlAvatar()}
        pending={assetActions.isImportingUrlAvatar}
      />

      <CharacterAvatarGenerationOverlay
        open={aiAvatarDialogOpen}
        onOpenChange={setAiAvatarDialogOpen}
        dirty={session.hasUnsavedChanges || status === 'saving'}
        options={avatar.avatarOptions.data}
        optionsLoading={avatar.avatarOptions.isLoading}
        prompt={avatar.prompt}
        characterId={characterId}
        draftRevision={detailData?.draftRevision}
        variantId={generationVariant?.id}
        variantName={generationVariant?.name}
        taskId={avatar.taskId}
        pollError={avatar.pollError}
        result={avatar.result}
        applying={avatar.isApplying}
        onRefreshOptions={() => { void avatar.avatarOptions.refetch(); }}
        onGenerate={input => avatar.submit(input, generationVariant?.id)}
        onApply={async () => {
          if (await avatar.apply()) setAiAvatarDialogOpen(false);
        }}
        generationPanel={generationPanel}
      />

      {/* 新增衍生形态对话框 */}
      <Dialog
        open={addVariantDialogOpen}
        onOpenChange={setAddVariantDialogOpen}
        title="新增衍生形态"
        description="装甲、SP 与阶段人设作为独立形态保存。普通换装请在「图片皮肤」中管理。"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAddVariantDialogOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="accent"
              disabled={!newVariantName.trim()}
              onClick={handleAddVariant}
            >
              确认添加
            </Button>
          </div>
        }
      >
        <div className="space-y-3 py-2">
          <label htmlFor="character-variant-name" className="block text-sm font-semibold text-ink">形态名称</label>
          <Input
            id="character-variant-name"
            value={newVariantName}
            onChange={(event) => setNewVariantName(event.target.value)}
            placeholder="例如：觉醒形态"
            autoFocus
            onKeyDown={(event) => {
              if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter') handleAddVariant();
            }}
          />
          <label htmlFor="character-variant-kind" className="block text-sm font-semibold text-ink">形态类型</label>
          <Select id="character-variant-kind" value={newVariantKind || 'form'} onChange={event => setNewVariantKind(event.target.value as CharacterVariant['variantKind'])}>
            <option value="form">独立形态</option><option value="stage">装甲 / 阶段</option><option value="sp">SP 形态</option>
          </Select>
        </div>
      </Dialog>

      {/* 酒馆卡导入对话框 */}
      <CharacterImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        initialMode="online"
        onCommitted={(newId) => {
          setImportDialogOpen(false);
          router.push(`/apps/characters/${newId}`);
        }}
      />

      {/* 多源获取头像与立绘对话框 */}
      {characterId && (
        <CharacterMultiSourceDialog
          characterId={characterId}
          characterName={draft.displayName || '未命名角色'}
          open={multiSourceDialogOpen}
          onOpenChange={setMultiSourceDialogOpen}
          onSuccess={() => {
            void Promise.all([refetchDetail(), refetchAssets()]);
          }}
        />
      )}

      {/* 上游一键采集与 RP 卡重构向导 */}
      <CharacterUpstreamDialog
        open={upstreamDialogOpen}
        onOpenChange={setUpstreamDialogOpen}
        characterId={characterId}
        initialName={draft.displayName}
        initialWork={draft.work}
        draftRevision={detailData?.draftRevision}
        onApplied={(appliedId) => {
          if (!characterId) {
            router.push(`/apps/characters/${appliedId}`);
          } else {
            void Promise.all([refetchDetail(), refetchAssets()]);
          }
        }}
      />

      {characterId && (
        <CharacterForkDialog
          open={forkDialogOpen}
          onOpenChange={setForkDialogOpen}
          characterId={characterId}
          displayName={draft.displayName || detailData?.displayName || '未命名角色'}
          sourceWork={draft.work || ''}
          works={worksBrowser.facets?.works || []}
          onForked={(newId) => {
            router.push(`/apps/characters/${newId}`);
          }}
        />
      )}

      {characterId && (
        <Dialog
          open={stageDialogOpen}
          onOpenChange={(next) => {
            if (!savingStage) setStageDialogOpen(next);
          }}
          title="保存原创角色阶段版本"
          description="为当前人设保存一个阶段快照（例如：序章少年、黑化觉醒期），供故事世界或剧情项目绑定。"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={savingStage} onClick={() => setStageDialogOpen(false)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="accent"
                loading={savingStage}
                onClick={async () => {
                  if (savingStage) return;
                  setSavingStage(true);
                  try {
                    const published = await saveCharacterStage({
                      prepare: session.preparePublication,
                      publish: saved => publishMutation.mutateAsync({
                        id: saved.id,
                        expectedDraftRevision: saved.draftRevision,
                        versionLabel: stageLabel.trim() || undefined,
                      }),
                    });
                    if (!published) return;
                    toast.success(`已保存阶段版本 v${published.version}${stageLabel.trim() ? `（${stageLabel.trim()}）` : ''}`);
                    setStageLabel('');
                    setStageDialogOpen(false);
                    void refetchDetail();
                  } catch (err) {
                    toast.error('保存阶段失败', err instanceof Error ? err.message : String(err));
                  } finally { setSavingStage(false); }
                }}
              >
                确认保存阶段
              </Button>
            </div>
          }
        >
          <div className="space-y-2 py-1">
            <label htmlFor="stage-label-input" className="block text-xs font-semibold text-ink">
              阶段名称（可选）
            </label>
            <Input
              id="stage-label-input"
              value={stageLabel}
              onChange={(e) => setStageLabel(e.target.value)}
              placeholder="例如：第一卷 · 学徒期 / 终局觉醒"
            />
          </div>
        </Dialog>
      )}
    </PageContainer>
  );
}
