'use client';

import { useQuery } from '@tanstack/react-query';
import type { GenerationTaskDescriptor } from '@sthstart/contracts';
import { ImageGenerationPanel } from '@/app/features/generation/components/image-generation-panel';
import { fetchImageGenerationOptions } from '@/app/features/generation/image-api';

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import {
  ArrowLeft,
  Upload,
  Download,
  Save,
  Sparkles,
  Palette,
  Globe,
  Plus,
  Trash2,
  Check,
  Layers,
  FolderInput,
  RotateCcw,
  MoreHorizontal,
  Camera,
  User,
  SlidersHorizontal,
} from 'lucide-react';
import type { CharacterVariant } from '@sthstart/contracts';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Dialog } from '@/app/components/ui/dialog';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { TagsInput } from '@/app/components/shared/tags-input';
import { useToast } from '@/app/providers/ui-provider';
import { ApiClientError } from '@/app/lib/api-client';
import { useCharacterDetail, useCharacterAssets } from '../queries';
import {
  useCreateCharacter,
  useUpdateCharacter,
  useUploadCharacterAsset,
  useSetCharacterActiveAsset,
  useFetchAvatarFromUrl,
  useGenerateCharacterAvatar,
  useApplyCharacterAvatar,
} from '../mutations';
import { exportTavernCard, fetchCharacterGenerationTask } from '../api';
import { EMPTY_DRAFT_V2 } from '../schemas';
import {
  characterDraftToFormValues,
  characterFormValuesToDraft,
  type CharacterFormValues,
} from './character-form';
import { CharacterImportDialog } from './character-import-dialog';
import { CharacterMultiSourceDialog } from './character-multi-source-dialog';

const EMPTY_FORM_VALUES = characterDraftToFormValues(EMPTY_DRAFT_V2);

const PERSONA_PLACEHOLDER = [
  '### 身份与经历',
  '社会身份、对外形象与核心经历。',
  '',
  '### 性格与处世',
  '- 语气特征与日常处世风格',
  '- 话语与内在情感的反差',
  '',
  '### 好恶与动机',
  '- 喜欢：...',
  '- 不喜欢：...',
  '- 核心内在动机：...',
].join('\n');

type EditorTab = 'persona' | 'visual' | 'lora';

function subscribeRecovery(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('sthstart:character-recovery', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('sthstart:character-recovery', callback);
  };
}

export function CharacterEditor({ characterId }: { characterId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const portraitInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const baseline = useRef<{ id?: string; snapshot: string; revision?: number } | null>(null);
  const liveSnapshot = useRef('');
  const saving = useRef(false);
  const recovering = useRef(false);

  // Status & UI state
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'error'>('clean');
  const [errorMessage, setErrorMessage] = useState('');
  const [revisionConflict, setRevisionConflict] = useState(false);
  const recoveryKey = `sthstart:character-recovery:${characterId ?? 'new'}`;
  const recoveryAvailable = useSyncExternalStore(subscribeRecovery, useCallback(() => {
    try { return Boolean(sessionStorage.getItem(recoveryKey)); } catch { return false; }
  }, [recoveryKey]), () => false);
  const [tags, setTags] = useState<string[]>([]);
  const [variants, setVariants] = useState<CharacterVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('persona');

  // Menus & Dialogs state
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');
  const [aiAvatarDialogOpen, setAiAvatarDialogOpen] = useState(false);
  const [aiAvatarPrompt, setAiAvatarPrompt] = useState('');
  const [avatarResult, setAvatarResult] = useState<GenerationTaskDescriptor | null>(null);
  const avatarOptions = useQuery({
    queryKey: ['generation', 'image-options', 'characters', 'character-avatar'],
    queryFn: () => fetchImageGenerationOptions('characters', 'character-avatar'),
    enabled: aiAvatarDialogOpen,
  });
  const [addVariantDialogOpen, setAddVariantDialogOpen] = useState(false);
  const [newVariantName, setNewVariantName] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [multiSourceDialogOpen, setMultiSourceDialogOpen] = useState(false);
  const [assetFilter, setAssetFilter] = useState<'all' | 'avatar' | 'portrait'>('all');

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setUploadMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // AI Avatar Task
  const [avatarTaskId, setAvatarTaskId] = useState<string | null>(null);
  const [avatarPollError, setAvatarPollError] = useState('');

  // Form
  const {
    control,
    register,
    getValues,
    reset,
    setValue,
    setError,
    clearErrors,
    formState: { isDirty, errors },
  } = useForm<CharacterFormValues>({ defaultValues: EMPTY_FORM_VALUES });

  const watchedValues = useWatch({ control });
  const { fields: visualLoraFields, append: appendVisualLora, remove: removeVisualLora } = useFieldArray({
    control,
    name: 'visualLoras',
  });
  const draft = characterFormValuesToDraft(
    (watchedValues ?? EMPTY_FORM_VALUES) as CharacterFormValues
  );
  useEffect(() => {
    liveSnapshot.current = JSON.stringify({ values: getValues(), tags, variants });
  });

  // Queries
  const { data: detailData, error: detailError, refetch: refetchDetail } = useCharacterDetail(characterId);
  const { data: assetsData, refetch: refetchAssets } = useCharacterAssets(characterId);

  // Mutations
  const createMutation = useCreateCharacter();
  const updateMutation = useUpdateCharacter();
  const uploadAssetMutation = useUploadCharacterAsset();
  const setActiveAssetMutation = useSetCharacterActiveAsset();
  const fetchAvatarFromUrlMutation = useFetchAvatarFromUrl();
  const generateAvatarMutation = useGenerateCharacterAvatar();
  const applyAvatarMutation = useApplyCharacterAvatar();

  // Populate data when detailData loads
  useEffect(() => {
    if (detailData) {
      if (recovering.current) return;
      const values = characterDraftToFormValues(detailData.draft);
      const snapshot = JSON.stringify({ values, tags: detailData.tags || [], variants: detailData.variants || [] });
      const previous = baseline.current;
      if (previous && previous.id === characterId) {
        if ((detailData.draftRevision ?? 0) < (previous.revision ?? 0)) return;
        if (previous.snapshot === snapshot && previous.revision === detailData.draftRevision) return;
        // A background refresh may update the avatar while text is still dirty.
        // Preserve both the input and the revision on which it was based.
        if (JSON.stringify({ values: getValues(), tags, variants }) !== previous.snapshot) return;
      }
      baseline.current = { id: characterId, snapshot, revision: detailData.draftRevision };
      reset(values);
      setTags(detailData.tags || []);
      setVariants(detailData.variants || []);
      setStatus('saved');
    }
  }, [characterId, detailData, getValues, reset, tags, variants]);

  // AI Avatar Generation Polling
  useEffect(() => {
    if (!avatarTaskId || !characterId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const task = await fetchCharacterGenerationTask(characterId, avatarTaskId);
        if (stopped) return;
        setAvatarPollError('');
        if (task.status === 'succeeded') {
          setAvatarTaskId(null);
          setAvatarResult(task);
          setAvatarPollError('');
          toast.success('头像生成完成，请预览后选择是否应用');
          return;
        }
        if (['failed', 'cancelled', 'abandoned'].includes(task.status)) {
          setAvatarTaskId(null);
          toast.error('头像生成失败', task.errorMessage || '生成任务未完成');
          return;
        }
        timer = window.setTimeout(() => void poll(), 1500);
      } catch (err) {
        if (!stopped) {
          setAvatarPollError(err instanceof Error ? err.message : String(err));
          timer = window.setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [avatarTaskId, characterId, refetchDetail, toast]);

  // Handle Save
  const handleSave = useCallback(async () => {
    if (saving.current) return null;
    const currentValues = getValues();
    const currentDraft = characterFormValuesToDraft(currentValues);
    if (!currentDraft.displayName.trim()) {
      setError('displayName', { type: 'required', message: '请先填写角色名称' });
      setErrorMessage('请先填写角色名称');
      toast.warning('请先填写角色名称');
      return null;
    }
    clearErrors('displayName');
    const submittedSnapshot = JSON.stringify({ values: currentValues, tags, variants });
    saving.current = true;
    setErrorMessage('');
    setRevisionConflict(false);
    setStatus('saving');

    try {
      if (characterId) {
        const res = await updateMutation.mutateAsync({
          id: characterId,
          draft: currentDraft,
          tags,
          variants,
          expectedDraftRevision: baseline.current?.revision,
        });
        const savedValues = characterDraftToFormValues(res.draft);
        baseline.current = { id: characterId, revision: res.draftRevision,
          snapshot: JSON.stringify({ values: savedValues, tags: res.tags, variants: res.variants || [] }) };
        if (liveSnapshot.current === submittedSnapshot) {
          reset(savedValues); setTags(res.tags); setVariants(res.variants || []);
          setStatus('saved');
        } else setStatus('dirty');
        toast.success('角色档案已保存');
        await refetchDetail();
        return res.id;
      } else {
        const res = await createMutation.mutateAsync({
          displayName: currentDraft.displayName.trim(),
          draft: currentDraft,
          tags,
          variants,
        });
        setStatus('saved');
        toast.success('角色档案创建成功');
        router.push(`/apps/characters/${res.id}`);
        return res.id;
      }
    } catch (err: unknown) {
      setStatus('error');
      setRevisionConflict(err instanceof ApiClientError && err.code === 'draft_revision_conflict');
      const msg = err instanceof ApiClientError && err.code === 'draft_revision_conflict'
        ? '角色已在其他页面更新，当前未保存输入仍保留。请保留草稿后载入最新版本，再合并修改。'
        : err instanceof Error ? err.message : '保存失败，请检查网络或稍后重试';
      setErrorMessage(msg);
      toast.error('保存失败', msg);
      return null;
    } finally { saving.current = false; }
  }, [getValues, clearErrors, setError, toast, characterId, updateMutation, tags, variants, refetchDetail, createMutation, router, reset]);

  const preserveAndReload = async () => {
    if (saving.current) return;
    saving.current = true;
    recovering.current = true;
    setStatus('saving');
    const snapshot = JSON.stringify({ values: getValues(), tags, variants });
    try {
      // Do not replace the form unless its complete local draft was preserved.
      sessionStorage.setItem(recoveryKey, JSON.stringify({ characterId,
        draft: characterFormValuesToDraft(getValues()), tags, variants }));
      window.dispatchEvent(new Event('sthstart:character-recovery'));
      const latest = await refetchDetail();
      if (latest.error || !latest.data) throw latest.error ?? new Error('无法载入最新角色档案。');
      if (liveSnapshot.current !== snapshot) throw new Error('载入期间又有新修改，已保留当前输入，请重新操作。');
      const values = characterDraftToFormValues(latest.data.draft);
      baseline.current = { id: characterId, revision: latest.data.draftRevision,
        snapshot: JSON.stringify({ values, tags: latest.data.tags, variants: latest.data.variants || [] }) };
      reset(values); setTags(latest.data.tags); setVariants(latest.data.variants || []);
      setStatus('saved'); setErrorMessage(''); setRevisionConflict(false);
      toast.success('已载入最新版本', '原有本机草稿已保留，可下载后对照合并。');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally { saving.current = false; recovering.current = false; }
  };

  const downloadRecovery = () => {
    try {
      const backup = sessionStorage.getItem(recoveryKey);
      if (!backup) throw new Error('未找到保留的本机草稿。');
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `character-${characterId ?? 'new'}-local-draft.json`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { toast.error('草稿下载失败', error instanceof Error ? error.message : String(error)); }
  };

  // Handle Asset Upload (Avatar or Portrait)
  const handleUploadAsset = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'avatar' | 'portrait') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !characterId) return;
    try {
      await uploadAssetMutation.mutateAsync({ id: characterId, file, kind, setAsActive: true });
      toast.success(`${kind === 'portrait' ? '立绘' : '头像'}上传成功`);
      await Promise.all([refetchDetail(), refetchAssets()]);
    } catch (err) {
      toast.error(`${kind === 'portrait' ? '立绘' : '头像'}上传失败`, err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Set Active Asset (Avatar or Portrait)
  const handleSetActiveAsset = async (assetId: string, kind: 'avatar' | 'portrait') => {
    if (!characterId) return;
    try {
      await setActiveAssetMutation.mutateAsync({ id: characterId, payload: { assetId, kind } });
      toast.success(`已切换当前${kind === 'portrait' ? '主立绘' : '主头像'}`);
      await Promise.all([refetchDetail(), refetchAssets()]);
    } catch (err) {
      toast.error(`切换${kind === 'portrait' ? '立绘' : '头像'}失败`, err instanceof Error ? err.message : String(err));
    }
  };

  // Handle URL Avatar Fetch
  const handleFetchUrlAvatar = async () => {
    if (!characterId) {
      toast.warning('请先保存角色档案后再抓取头像');
      return;
    }
    if (!customAvatarUrl.trim()) return;
    try {
      await fetchAvatarFromUrlMutation.mutateAsync({ id: characterId, url: customAvatarUrl.trim() });
      toast.success('已成功从链接导入头像');
      setUrlDialogOpen(false);
      setCustomAvatarUrl('');
      await refetchDetail();
    } catch (err: unknown) {
      toast.error('从链接导入头像失败', err instanceof Error ? err.message : String(err));
    }
  };

  // Handle AI Avatar Generation
  const handleTriggerAiAvatar = () => {
    if (!characterId) {
      toast.warning('请先保存角色档案后再生成 AI 头像');
      return;
    }
    const defaultPrompt = [
      draft.displayName,
      draft.work,
      draft.appearance.baseText,
      draft.appearance.defaultOutfitText,
      '角色头像，突出面部特征，保持角色身份和服装一致',
    ]
      .filter(Boolean)
      .join(', ');
    setAiAvatarPrompt(defaultPrompt);
    setAiAvatarDialogOpen(true);
  };

  // Handle Export Tavern Card
  const handleExportTavern = async () => {
    if (!characterId) return;
    try {
      const card = await exportTavernCard(characterId);
      const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${draft.displayName || 'character'}_tavern_card.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('已导出标准酒馆角色卡 (JSON)');
    } catch (err: unknown) {
      toast.error('导出酒馆卡失败', err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Add Variant
  const handleAddVariant = () => {
    if (!newVariantName.trim()) return;
    const newVariant: CharacterVariant = {
      id: crypto.randomUUID(),
      name: newVariantName.trim(),
      summary: draft.summary,
      personaText: draft.personaText,
      appearance: {
        baseText: draft.appearance.baseText,
        defaultOutfitText: draft.appearance.defaultOutfitText,
      },
    };
    const nextVariants = [...variants, newVariant];
    setVariants(nextVariants);
    setActiveVariantId(newVariant.id);
    setNewVariantName('');
    setAddVariantDialogOpen(false);
    setStatus('dirty');
    toast.success(`已添加衍生形态「${newVariant.name}」`);
  };

  // Handle Remove Variant
  const handleRemoveVariant = (variantId: string) => {
    const next = variants.filter((v) => v.id !== variantId);
    setVariants(next);
    if (activeVariantId === variantId) {
      setActiveVariantId(null);
    }
    setStatus('dirty');
    toast.info('已移除衍生形态');
  };

  // Active Variant Data
  const currentVariant = variants.find((v) => v.id === activeVariantId) || null;

  // Active Avatar & Portrait URLs
  const currentAvatarUrl = currentVariant?.avatarUrl || detailData?.avatarUrl;
  const currentPortraitUrl = detailData?.portraitUrl;

  const allAssets = assetsData?.items || [];
  const filteredAssets = allAssets.filter((item) => {
    if (assetFilter === 'all') return true;
    return item.kind === assetFilter;
  });

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
    <PageContainer className="pb-16 pt-2">
      {/* 顶部页头 */}
      <PageHeader
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
                  : 'bg-surface-muted text-muted'
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
              onClick={() => void handleSave()}
              loading={status === 'saving'}
              className="px-4 font-semibold shadow-sm"
            >
              <Save className="h-4 w-4 mr-1.5" aria-hidden="true" />
              <span>保存档案</span>
            </Button>
          </div>
        }
      />

      {errorMessage && (
        <div className="mt-4">
          <Alert variant="danger" onDismiss={() => setErrorMessage('')}>
            {errorMessage}
            {revisionConflict && <Button className="mt-2" size="sm" variant="outline" loading={status === 'saving'} onClick={() => void preserveAndReload()}>
              保留本机草稿并载入最新版
            </Button>}
          </Alert>
        </div>
      )}
      {recoveryAvailable && <Alert className="mt-4" variant="info" title="本机会话中保留了一份角色草稿">
        <button type="button" className="underline" onClick={downloadRecovery}>下载保留的草稿，供对照合并</button>
      </Alert>}

      {/* 双栏工作台：左栏立绘卡片与资产管理，右栏沉浸式档案创作 */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
        {/* ================= 左栏：角色卡预览、上下文微操作、资产库、衍生形态 ================= */}
        <div className="space-y-5 lg:sticky lg:top-6">
          {/* 角色卡牌预览 */}
          <div className="rounded-xl border border-border-default bg-surface p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                视觉预览
              </span>
              <span className="inline-flex items-center rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                {currentVariant ? `形态: ${currentVariant.name}` : '主档案形态'}
              </span>
            </div>

            {/* 立绘与头像展示区 */}
            <div className="group relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-border-default/80 bg-surface-muted shadow-inner flex items-center justify-center">
              {currentPortraitUrl ? (
                <Image
                  src={currentPortraitUrl}
                  alt={draft.displayName || '角色立绘'}
                  fill
                  unoptimized
                  className="object-contain"
                />
              ) : currentAvatarUrl ? (
                <Image
                  src={currentAvatarUrl}
                  alt={draft.displayName || '角色头像'}
                  fill
                  unoptimized
                  className="object-cover opacity-85"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-muted">
                  <User className="h-12 w-12 opacity-30" />
                  <span className="mt-2 text-xs text-muted">暂无立绘与头像</span>
                </div>
              )}

              {/* 头像徽章（左上角微圆图） */}
              {currentAvatarUrl && (
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-surface/90 backdrop-blur-md p-1 pr-2 shadow-sm border border-border-default/60">
                  <div className="relative h-7 w-7 overflow-hidden rounded-full border border-border-default bg-surface-muted">
                    <Image
                      src={currentAvatarUrl}
                      alt={draft.displayName || '角色头像'}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-ink">当前头像</span>
                </div>
              )}

              {/* 立绘标记（右上角） */}
              {currentPortraitUrl && (
                <div className="absolute top-2.5 right-2.5 rounded-md bg-surface/85 backdrop-blur-md px-1.5 py-0.5 text-[10px] font-medium text-ink shadow-sm border border-border-default/50">
                  当前立绘
                </div>
              )}
            </div>

            {/* 紧凑微操作工具行（替代原 7 按钮平铺） */}
            <div className="grid grid-cols-4 gap-1.5 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMultiSourceDialogOpen(true)}
                disabled={!characterId}
                className="flex flex-col items-center justify-center h-13 p-1 text-[11px] gap-1 hover:border-accent hover:text-accent transition-colors"
                title="自动探测 Enka CDN、Fandom Wiki 等官方资源库"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                <span>多源获取</span>
              </Button>

              <div className="relative" ref={uploadMenuRef}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setUploadMenuOpen((v) => !v)}
                  disabled={!characterId || uploadAssetMutation.isPending}
                  className="w-full flex flex-col items-center justify-center h-13 p-1 text-[11px] gap-1 hover:border-accent hover:text-accent transition-colors"
                  title="上传本地图片"
                >
                  <Upload className="h-3.5 w-3.5 text-muted" />
                  <span>本地上传</span>
                </Button>
                {uploadMenuOpen && (
                  <div className="absolute left-0 bottom-full mb-1.5 z-50 w-36 rounded-lg border border-border-default bg-surface p-1 shadow-lg anim-zoom-in-95">
                    <button
                      type="button"
                      onClick={() => {
                        setUploadMenuOpen(false);
                        portraitInputRef.current?.click();
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-1.5 text-ink"
                    >
                      <Camera className="h-3.5 w-3.5 text-muted" />
                      <span>上传立绘大图</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadMenuOpen(false);
                        avatarInputRef.current?.click();
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-1.5 text-ink"
                    >
                      <User className="h-3.5 w-3.5 text-muted" />
                      <span>上传头像图标</span>
                    </button>
                  </div>
                )}
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleTriggerAiAvatar}
                disabled={!characterId}
                className="flex flex-col items-center justify-center h-13 p-1 text-[11px] gap-1 hover:border-accent hover:text-accent transition-colors"
                title="基于外观与服装特征生成头像"
              >
                <Palette className="h-3.5 w-3.5 text-indigo-500" />
                <span>{avatarTaskId ? '生成中...' : avatarResult ? '预览新图' : 'AI 生图'}</span>
              </Button>

              <div className="relative" ref={moreMenuRef}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  className="w-full flex flex-col items-center justify-center h-13 p-1 text-[11px] gap-1 hover:border-accent hover:text-ink transition-colors"
                  title="更多导入导出操作"
                >
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted" />
                  <span>更多</span>
                </Button>
                {moreMenuOpen && (
                  <div className="absolute right-0 bottom-full mb-1.5 z-50 w-40 rounded-lg border border-border-default bg-surface p-1 shadow-lg anim-zoom-in-95">
                    <button
                      type="button"
                      disabled={!characterId}
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setUrlDialogOpen(true);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-1.5 text-ink disabled:opacity-40"
                    >
                      <Globe className="h-3.5 w-3.5 text-muted" />
                      <span>从图片链接导入</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setImportDialogOpen(true);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-1.5 text-ink"
                    >
                      <FolderInput className="h-3.5 w-3.5 text-muted" />
                      <span>导入酒馆角色卡</span>
                    </button>
                    <button
                      type="button"
                      disabled={!characterId}
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void handleExportTavern();
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-surface-muted transition-colors flex items-center gap-1.5 text-ink disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5 text-muted" />
                      <span>导出酒馆卡 (JSON)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 隐藏的本地图片选择器 */}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => handleUploadAsset(e, 'avatar')}
            />
            <input
              ref={portraitInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => handleUploadAsset(e, 'portrait')}
            />
          </div>

          {/* 形象资产库 */}
          <div className="rounded-xl border border-border-default bg-surface p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-ink flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-accent" />
                <span>形象资产库</span>
              </h4>
              <span className="text-[11px] text-muted">
                {assetsData?.items ? `${assetsData.items.length} 个` : '读取中...'}
              </span>
            </div>

            {/* 分类切换 */}
            <div className="flex items-center gap-1 bg-surface-muted p-0.5 rounded-lg text-xs">
              {(['all', 'portrait', 'avatar'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setAssetFilter(tab)}
                  className={`flex-1 py-1 rounded-md transition-colors text-[11px] font-medium ${
                    assetFilter === tab
                      ? 'bg-surface text-ink shadow-xs'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {tab === 'all' ? '全部' : tab === 'portrait' ? '立绘' : '头像'}
                </button>
              ))}
            </div>

            {/* 资产列表 */}
            {filteredAssets.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted border border-dashed border-border-default rounded-lg">
                暂无此类资产
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                {filteredAssets.map((asset) => {
                  const isCurrentAvatar = currentAvatarUrl === asset.url;
                  const isCurrentPortrait = currentPortraitUrl === asset.url;
                  return (
                    <div
                      key={asset.id}
                      className={`group relative aspect-square rounded-lg overflow-hidden border bg-surface-muted transition-all ${
                        isCurrentAvatar || isCurrentPortrait
                          ? 'border-accent ring-1 ring-accent'
                          : 'border-border-default hover:border-border-default/80'
                      }`}
                    >
                      <Image
                        src={asset.url}
                        alt="资产缩略图"
                        fill
                        unoptimized
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-1">
                        {!isCurrentAvatar && (
                          <button
                            type="button"
                            className="text-[9px] w-full py-0.5 px-1 rounded bg-surface/90 text-ink font-medium hover:bg-surface"
                            onClick={() => handleSetActiveAsset(asset.id, 'avatar')}
                            disabled={setActiveAssetMutation.isPending}
                          >
                            设为头像
                          </button>
                        )}
                        {!isCurrentPortrait && (
                          <button
                            type="button"
                            className="text-[9px] w-full py-0.5 px-1 rounded bg-surface/90 text-ink font-medium hover:bg-surface"
                            onClick={() => handleSetActiveAsset(asset.id, 'portrait')}
                            disabled={setActiveAssetMutation.isPending}
                          >
                            设为立绘
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 衍生形态管理 */}
          <div className="rounded-xl border border-border-default bg-surface p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-ink flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-accent" />
                <span>衍生形态</span>
              </h4>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAddVariantDialogOpen(true)}
                className="h-6 px-1.5 text-xs text-accent hover:bg-accent/10"
              >
                <Plus className="h-3 w-3 mr-0.5" />
                <span>新增</span>
              </Button>
            </div>

            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setActiveVariantId(null)}
                className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  activeVariantId === null
                    ? 'bg-accent/10 text-accent border border-accent/30'
                    : 'bg-surface-muted text-ink hover:bg-surface-elevated'
                }`}
              >
                <span>默认主档案</span>
                {activeVariantId === null && <Check className="h-3 w-3 text-accent" />}
              </button>

              {variants.map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                    activeVariantId === v.id
                      ? 'bg-accent/10 text-accent border border-accent/30 font-medium'
                      : 'bg-surface-muted text-ink hover:bg-surface-elevated'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveVariantId(v.id)}
                    className="flex-1 text-left truncate"
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveVariant(v.id)}
                    className="ml-2 text-muted hover:text-danger p-0.5"
                    title={`删除形态「${v.name}」`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ================= 右栏：行内档案头 + 分段创作画布 ================= */}
        <div className="rounded-xl border border-border-default bg-surface p-6 shadow-sm space-y-6 max-w-[780px] w-full min-w-0">
          {/* 行内原生档案头 (无需点击弹窗直接编辑) */}
          <div className="space-y-3 pb-5 border-b border-border-subtle">
            <div className="flex items-center justify-between gap-3">
              <input
                type="text"
                {...register('displayName', {
                  required: true,
                  onChange: () => {
                    clearErrors('displayName');
                    setStatus('dirty');
                  },
                })}
                placeholder="角色名称（例如：芙宁娜）"
                className={`w-full text-2xl sm:text-3xl font-bold bg-transparent border-b border-transparent hover:border-border-default focus:border-accent outline-none text-ink placeholder:text-muted/40 py-1 transition-colors ${
                  errors.displayName ? 'border-danger focus:border-danger' : ''
                }`}
              />
              {currentVariant && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveVariantId(null)}
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

            {/* 属性微胶囊行 */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span>所属作品:</span>
                <input
                  type="text"
                  {...register('work', { onChange: () => setStatus('dirty') })}
                  placeholder="如：原神、星穹铁道、原创世界"
                  className="h-7 px-2.5 text-xs bg-surface-muted border border-border-default/60 rounded-md text-ink placeholder:text-muted/50 focus:outline-none focus:border-accent w-48"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  const current = getValues('originType');
                  setValue('originType', current === 'ip' ? 'original' : 'ip', { shouldDirty: true });
                  setStatus('dirty');
                }}
                className={`h-7 px-2.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                  draft.originType === 'ip'
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border-default/60 bg-surface-muted text-muted hover:text-ink'
                }`}
              >
                {draft.originType === 'ip' ? 'IP 角色' : '原创角色'}
              </button>
            </div>

            {/* 角色标签行内编辑 */}
            <div className="pt-1">
              <TagsInput
                value={tags}
                onChange={(nextTags) => {
                  setTags(nextTags);
                  setStatus('dirty');
                }}
                placeholder="添加角色特征标签，回车完成（如：枫丹、水神、戏剧家）"
              />
            </div>
          </div>

          {/* 分段创作画布导航 (替代纵向无脑连续堆叠) */}
          <div className="flex items-center gap-1 bg-surface-muted p-1 rounded-lg border border-border-default/60">
            <button
              type="button"
              onClick={() => setActiveTab('persona')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'persona'
                  ? 'bg-surface text-accent shadow-xs font-semibold'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <User className="h-3.5 w-3.5" />
              <span>人设档案 (Persona)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('visual')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'visual'
                  ? 'bg-surface text-accent shadow-xs font-semibold'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Camera className="h-3.5 w-3.5" />
              <span>外貌与服装 (Visual)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('lora')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'lora'
                  ? 'bg-surface text-accent shadow-xs font-semibold'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>视觉 LoRA ({visualLoraFields.length})</span>
            </button>
          </div>

          {/* ================= 视图 1：人设档案 ================= */}
          {activeTab === 'persona' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="char-summary" className="font-semibold text-ink">
                    一句话概述
                  </label>
                  <span className="text-muted text-[11px]">用于卡片预览与人物列表</span>
                </div>
                <Textarea
                  id="char-summary"
                  rows={2}
                  {...register('summary', { onChange: () => setStatus('dirty') })}
                  placeholder="例如：枫丹前水神，聚光灯下华丽戏剧化，内心敏感孤单的戏剧家。"
                  className="text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="char-persona" className="font-semibold text-ink">
                    详细人设背景
                  </label>
                  <div className="flex items-center gap-3 text-muted text-[11px]">
                    <span>Markdown 结构化语法</span>
                    <span className="font-mono">{draft.personaText?.length || 0} 字</span>
                  </div>
                </div>
                <Textarea
                  id="char-persona"
                  rows={14}
                  {...register('personaText', { onChange: () => setStatus('dirty') })}
                  placeholder={PERSONA_PLACEHOLDER}
                  className="font-mono text-sm leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* ================= 视图 2：外貌与服装 ================= */}
          {activeTab === 'visual' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="char-appearance-base" className="font-semibold text-ink">
                    基础外貌特征
                  </label>
                  <span className="text-muted text-[11px]">面部、发型发色、身形与体貌特征</span>
                </div>
                <Textarea
                  id="char-appearance-base"
                  rows={5}
                  {...register('appearance.baseText', { onChange: () => setStatus('dirty') })}
                  placeholder="例如：蓝白相间中长发，双色渐变微卷发尾；水蓝色异色瞳孔；身形娇小玲珑，神情灵动。"
                  className="text-sm leading-relaxed"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="char-outfit" className="font-semibold text-ink">
                    代表性装扮与配饰
                  </label>
                  <span className="text-muted text-[11px]">默认服装、经典礼服或随身配饰</span>
                </div>
                <Textarea
                  id="char-outfit"
                  rows={5}
                  {...register('appearance.defaultOutfitText', { onChange: () => setStatus('dirty') })}
                  placeholder="例如：华丽的深蓝与白色枫丹礼服礼帽，精致蕾丝领结，左眼单片水滴装饰。"
                  className="text-sm leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* ================= 视图 3：视觉 LoRA ================= */}
          {activeTab === 'lora' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
                <div>
                  <h4 className="text-sm font-semibold text-ink">角色专属 LoRA 模型</h4>
                  <p className="text-xs text-muted mt-0.5">
                    活动镜头使用此角色时，会自动将这些 LoRA 叠加到画风设置中。
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => appendVisualLora({ model: '', strength: 1, triggerWord: '', enabled: true })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  <span>添加 LoRA</span>
                </Button>
              </div>

              {visualLoraFields.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-default p-8 text-center text-xs text-muted">
                  暂未配置角色 LoRA，生图时将采用全局与活动画风默认模型。
                </div>
              ) : (
                <div className="space-y-3">
                  {visualLoraFields.map((field, index) => (
                    <div
                      key={field.id}
                      className="grid grid-cols-1 gap-2.5 rounded-lg border border-border-default bg-surface p-3 sm:grid-cols-[minmax(0,1.5fr)_90px_minmax(0,1fr)_auto] sm:items-end"
                    >
                      <label className="block min-w-0 text-xs font-medium text-muted">
                        LoRA 文件名
                        <Input
                          {...register(`visualLoras.${index}.model`)}
                          placeholder="character-lora.safetensors"
                          className="mt-1 bg-surface h-8 text-xs"
                        />
                      </label>
                      <label className="block text-xs font-medium text-muted">
                        强度
                        <Input
                          type="number"
                          min={-10}
                          max={10}
                          step={0.05}
                          {...register(`visualLoras.${index}.strength`, { valueAsNumber: true })}
                          className="mt-1 bg-surface h-8 text-xs"
                        />
                      </label>
                      <label className="block min-w-0 text-xs font-medium text-muted">
                        触发词
                        <Input
                          {...register(`visualLoras.${index}.triggerWord`)}
                          placeholder="触发关键词"
                          className="mt-1 bg-surface h-8 text-xs"
                        />
                      </label>
                      <div className="flex items-center justify-between gap-2 sm:justify-end pb-0.5">
                        <label className="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                          <input
                            type="checkbox"
                            {...register(`visualLoras.${index}.enabled`)}
                            className="h-4 w-4 rounded accent-accent"
                          />
                          <span>启用</span>
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`移除第 ${index + 1} 个角色 LoRA`}
                          onClick={() => removeVisualLora(index)}
                          className="h-8 w-8 p-0 text-muted hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 底部保存状态栏 */}
          <div className="pt-4 border-t border-border-subtle flex items-center justify-between">
            <span className="text-xs text-muted">
              {status === 'dirty' || isDirty
                ? '档案有未保存更改'
                : status === 'saved'
                ? '全部更改已保存到本地数据库'
                : '档案处于就绪状态'}
            </span>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={() => void handleSave()}
              loading={status === 'saving'}
              className="px-5 font-semibold"
            >
              <Save className="h-4 w-4 mr-1.5" />
              <span>保存档案</span>
            </Button>
          </div>
        </div>
      </div>

      {/* URL 导入头像对话框 */}
      <Dialog
        open={urlDialogOpen}
        onOpenChange={setUrlDialogOpen}
        title="从图片链接获取头像"
        description="输入公开可访问的图片 URL，系统将自动下载并设为角色头像。"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setUrlDialogOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="accent"
              disabled={!customAvatarUrl.trim() || fetchAvatarFromUrlMutation.isPending}
              loading={fetchAvatarFromUrlMutation.isPending}
              onClick={handleFetchUrlAvatar}
            >
              抓取并应用
            </Button>
          </div>
        }
      >
        <div className="space-y-3 py-2">
          <Input
            value={customAvatarUrl}
            onChange={(e) => setCustomAvatarUrl(e.target.value)}
            placeholder="https://example.com/avatar.png"
            autoFocus
          />
        </div>
      </Dialog>

      {/* AI 头像生成浮层 */}
      <ResponsiveEditOverlay
        open={aiAvatarDialogOpen}
        onOpenChange={setAiAvatarDialogOpen}
        title="生成角色头像"
        description="根据角色外观生成图片，预览后再应用为头像。"
      >
        <div className="space-y-4">
          <ImageGenerationPanel
            appId="characters"
            purpose="character-avatar"
            contextKey={`character-avatar:${characterId}`}
            options={avatarOptions.data}
            loading={avatarOptions.isLoading}
            initialDescription={aiAvatarPrompt}
            onRefresh={() => {
              void avatarOptions.refetch();
            }}
            blockedReason={avatarTaskId ? '已有头像任务正在生成，完成后可预览结果。' : undefined}
            onGenerate={async (input) => {
              if (!characterId) throw new Error('请先保存角色。');
              const task = await generateAvatarMutation.mutateAsync({ id: characterId, input });
              setAvatarTaskId(task.id);
              toast.success('头像任务已提交');
            }}
          />
          {avatarPollError && (
            <p role="status" className="text-sm text-muted">
              状态暂时无法读取，正在重试：{avatarPollError}
            </p>
          )}
          {avatarTaskId && (
            <p role="status" className="text-sm text-muted">
              头像正在生成，可关闭面板继续编辑角色。
            </p>
          )}
          {avatarResult && (
            <section aria-label="头像生成结果" className="space-y-3">
              {avatarResult.artifacts
                .filter((item) => item.mediaKind === 'image')
                .map((item) => (
                  <img
                    key={item.artifactId}
                    src={`/api/admin/artifacts/${encodeURIComponent(item.artifactId)}/file`}
                    alt="新生成的角色头像"
                    className="mx-auto max-h-80 max-w-full rounded-[var(--radius-panel)] object-contain"
                  />
                ))}
              <Button
                variant="accent"
                loading={applyAvatarMutation.isPending}
                onClick={async () => {
                  if (!characterId) return;
                  try {
                    await applyAvatarMutation.mutateAsync({ id: characterId, taskId: avatarResult.id });
                    await refetchDetail();
                    setAvatarResult(null);
                    setAiAvatarDialogOpen(false);
                    toast.success('已应用新头像');
                  } catch (error) {
                    toast.error('应用头像失败', error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                应用为头像
              </Button>
            </section>
          )}
        </div>
      </ResponsiveEditOverlay>

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
            onChange={(e) => setNewVariantName(e.target.value)}
            placeholder="例如：雪山特训"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddVariant();
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
