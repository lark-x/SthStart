'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { ArrowLeft, Check, Save } from 'lucide-react';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Dialog } from '@/app/components/ui/dialog';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useToast } from '@/app/providers/ui-provider';
import { useCharacterDetail, useCharacterAssets } from '../queries';
import { EMPTY_DRAFT_V2 } from '../schemas';
import {
  characterDraftToFormValues,
  characterFormValuesToDraft,
  type CharacterFormValues,
} from '../model/character-form-values';
import { buildCharacterAvatarPrompt, type CharacterEditorStatus } from '../model/character-editor-model';
import { useCharacterDraftSession } from '../hooks/use-character-draft-session';
import { useCharacterAssetActions } from '../hooks/use-character-asset-actions';
import { useCharacterAvatarGeneration } from '../hooks/use-character-avatar-generation';
import { useCharacterVariants } from '../hooks/use-character-variants';
import { CharacterEditorSidebar } from './character-editor-sidebar';
import { CharacterEditorForm, type CharacterEditorTab } from './character-editor-form';
import { CharacterAvatarGenerationOverlay, CharacterAvatarUrlDialog, type CharacterAvatarGenerationPanel } from './character-avatar-dialogs';
import { CharacterImportDialog } from './character-import-dialog';
import { CharacterMultiSourceDialog } from './character-multi-source-dialog';

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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [multiSourceDialogOpen, setMultiSourceDialogOpen] = useState(false);

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

  const assetActions = useCharacterAssetActions({ characterId, refetchDetail, refetchAssets });
  const avatar = useCharacterAvatarGeneration({ characterId, enabled: aiAvatarDialogOpen, refetchDetail });

  const currentVariant = variantsApi.variants.find((variant) => variant.id === variantsApi.activeVariantId) || null;
  const currentAvatarUrl = currentVariant?.avatarUrl || detailData?.avatarUrl;
  const currentPortraitUrl = detailData?.portraitUrl;
  const assets = assetsData?.items || [];

  const handleFetchUrlAvatar = async () => {
    const done = await assetActions.importAvatarFromUrl(customAvatarUrl);
    if (!done) return;
    setUrlDialogOpen(false);
    setCustomAvatarUrl('');
  };

  const handleTriggerAiAvatar = () => {
    if (!characterId) {
      toast.warning('请先保存角色档案后再生成 AI 头像');
      return;
    }
    avatar.setPrompt(buildCharacterAvatarPrompt(draft));
    setAiAvatarDialogOpen(true);
  };

  const handleAddVariant = () => {
    const variant = variantsApi.addVariant(newVariantName);
    if (!variant) return;
    setNewVariantName('');
    setAddVariantDialogOpen(false);
  };

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
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-8">
          <Skeleton className="h-10 w-1/3" />
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            <Skeleton className="h-96 w-full rounded-xl" />
            <Skeleton className="h-[600px] w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageContainer className="space-y-4 pb-8">
      {/* 顶部页头 */}
      <PageHeader compact
        backHref="/apps/characters"
        backLabel="角色资料库"
        title={draft.displayName || '新建角色档案'}
        status={
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                status === 'saving'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  : status === 'saved'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : status === 'dirty' || isDirty
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                  : 'bg-surface-sunken text-muted'
              }`}
            >
              {status === 'saving' ? (
                '正在保存...'
              ) : status === 'saved' ? (
                <>
                  <Check className="h-3 w-3" />
                  已保存
                </>
              ) : status === 'dirty' || isDirty ? (
                '未保存修改'
              ) : (
                '就绪'
              )}
            </span>
            {draft.work && (
              <span className="text-xs text-muted truncate max-w-[160px]">
                {draft.work}
              </span>
            )}
          </div>
        }
        actions={
          <div className="flex items-center gap-2.5">
            <Button
              size="sm"
              variant="accent"
              onClick={() => void session.handleSave()}
              loading={status === 'saving'}
              className="px-4 font-semibold shadow-sm"
            >
              <Save className="h-4 w-4 mr-1.5" aria-hidden="true" />
              <span>保存档案</span>
            </Button>
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

      {/* 双栏工作台：左栏立绘卡片与资产管理，右栏沉浸式档案创作 */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
        <CharacterEditorSidebar
          characterId={characterId}
          displayName={draft.displayName || ''}
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
          onUploadAsset={assetActions.handleUploadAsset}
          onSetActiveAsset={assetActions.handleSetActiveAsset}
          isUploading={assetActions.isUploading}
          isSettingActive={assetActions.isSettingActive}
          onOpenMultiSource={() => setMultiSourceDialogOpen(true)}
          onOpenUrlImport={() => setUrlDialogOpen(true)}
          onOpenImport={() => setImportDialogOpen(true)}
          onExportTavern={() => void assetActions.exportTavern(draft.displayName)}
          onTriggerAiAvatar={handleTriggerAiAvatar}
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
          hasActiveVariant={Boolean(currentVariant)}
          onResetVariant={() => variantsApi.setActiveVariantId(null)}
          onRefreshCharacter={() => {
            void refetchDetail();
            void refetchAssets();
          }}
          activeTab={activeTab}
          onTabChange={setActiveTab}
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
        dirty={isDirty || status === 'dirty' || status === 'saving'}
        options={avatar.avatarOptions.data}
        optionsLoading={avatar.avatarOptions.isLoading}
        prompt={avatar.prompt}
        characterId={characterId}
        draftRevision={detailData?.draftRevision}
        taskId={avatar.taskId}
        pollError={avatar.pollError}
        result={avatar.result}
        applying={avatar.isApplying}
        onRefreshOptions={() => { void avatar.avatarOptions.refetch(); }}
        onGenerate={avatar.submit}
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
        description="为角色创建一个情境形态（如：日常常服、雪山特训、夏日泳装），形态将挂在原角色档案下。"
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
          <label className="block text-xs font-semibold text-ink">形态名称</label>
          <Input
            value={newVariantName}
            onChange={(event) => setNewVariantName(event.target.value)}
            placeholder="例如：雪山特训"
            autoFocus
            onKeyDown={(event) => {
              if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter') handleAddVariant();
            }}
          />
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
    </PageContainer>
  );
}
