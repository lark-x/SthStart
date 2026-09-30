'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import type { CharacterDraftV2, CharacterVariant } from '@sthstart/contracts';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Dialog } from '@/app/components/ui/dialog';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { FormField } from '@/app/components/ui/form-field';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { TagsInput } from '@/app/components/shared/tags-input';
import { useToast } from '@/app/providers/ui-provider';
import { useCharacterDetail, useCharacters, useCharacterAssets } from '../queries';
import {
  useCreateCharacter,
  useUpdateCharacter,
  useUploadCharacterAvatar,
  useUploadCharacterAsset,
  useSetCharacterActiveAsset,
  useMatchOfficialAvatar,
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
  '她的社会身份、对外形象与核心经历。',
  '',
  '### 性格与处世',
  '- 语气特征与日常处世风格',
  '- 话语与内在情感的反差',
  '',
  '### 好恶与动机',
  '- 喜欢：…',
  '- 不喜欢：…',
  '- 核心内在动机：…',
].join('\n');

export function CharacterEditor({ characterId }: { characterId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const portraitInputRef = useRef<HTMLInputElement>(null);

  // Status & UI state
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'error'>('clean');
  const [errorMessage, setErrorMessage] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [variants, setVariants] = useState<CharacterVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

  // Dialogs state
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');
  const [aiAvatarDialogOpen, setAiAvatarDialogOpen] = useState(false);
  const [aiAvatarPrompt, setAiAvatarPrompt] = useState('');
  const [addVariantDialogOpen, setAddVariantDialogOpen] = useState(false);
  const [newVariantName, setNewVariantName] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [multiSourceDialogOpen, setMultiSourceDialogOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityDiscardOpen, setIdentityDiscardOpen] = useState(false);
  const [identityDraft, setIdentityDraft] = useState({ displayName: '', work: '', tags: [] as string[] });
  const [assetFilter, setAssetFilter] = useState<'all' | 'avatar' | 'portrait'>('all');

  // AI Avatar Task
  const [avatarTaskId, setAvatarTaskId] = useState<string | null>(null);

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

  // Queries
  const { data: detailData, error: detailError, refetch: refetchDetail } = useCharacterDetail(characterId);
  const { data: assetsData, refetch: refetchAssets } = useCharacterAssets(characterId);

  // Mutations
  const createMutation = useCreateCharacter();
  const updateMutation = useUpdateCharacter();
  const uploadAvatarMutation = useUploadCharacterAvatar();
  const uploadAssetMutation = useUploadCharacterAsset();
  const setActiveAssetMutation = useSetCharacterActiveAsset();
  const matchOfficialAvatarMutation = useMatchOfficialAvatar();
  const fetchAvatarFromUrlMutation = useFetchAvatarFromUrl();
  const generateAvatarMutation = useGenerateCharacterAvatar();
  const applyAvatarMutation = useApplyCharacterAvatar();

  // Populate data when detailData loads
  useEffect(() => {
    if (detailData) {
      reset(characterDraftToFormValues(detailData.draft));
      setTags(detailData.tags || []);
      setVariants(detailData.variants || []);
      setStatus('saved');
    }
  }, [detailData, reset]);

  // AI Avatar Generation Polling
  const applyAvatarRef = useRef(applyAvatarMutation);
  useEffect(() => {
    applyAvatarRef.current = applyAvatarMutation;
  }, [applyAvatarMutation]);

  useEffect(() => {
    if (!avatarTaskId || !characterId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const task = await fetchCharacterGenerationTask(characterId, avatarTaskId);
        if (stopped) return;
        if (task.status === 'succeeded') {
          setAvatarTaskId(null);
          try {
            await applyAvatarRef.current.mutateAsync({ id: characterId, taskId: avatarTaskId });
            if (!stopped) {
              await refetchDetail();
              toast.success('AI 头像已成功生成并应用！');
            }
          } catch (applyErr) {
            if (!stopped) {
              toast.error('应用 AI 头像失败', applyErr instanceof Error ? applyErr.message : String(applyErr));
            }
          }
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
          setAvatarTaskId(null);
          toast.error('查询头像生成状态失败', err instanceof Error ? err.message : String(err));
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
    const currentValues = getValues();
    const currentDraft = characterFormValuesToDraft(currentValues);
    if (!currentDraft.displayName.trim()) {
      setError('displayName', { type: 'required', message: '请先填写角色名称' });
      setErrorMessage('请先填写角色名称');
      toast.warning('请先填写角色名称');
      return null;
    }
    clearErrors('displayName');
    setErrorMessage('');
    setStatus('saving');

    try {
      if (characterId) {
        // 更新既有角色
        const res = await updateMutation.mutateAsync({
          id: characterId,
          draft: currentDraft,
          tags,
          variants,
          expectedDraftRevision: detailData?.draftRevision,
        });
        setStatus('saved');
        toast.success('角色已保存');
        await refetchDetail();
        return res.id;
      } else {
        // 新建角色
        const res = await createMutation.mutateAsync({
          displayName: currentDraft.displayName.trim(),
          draft: currentDraft,
          tags,
          variants,
        });
        setStatus('saved');
        toast.success('角色创建成功');
        router.push(`/apps/characters/${res.id}`);
        return res.id;
      }
    } catch (err: unknown) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : '保存失败，请检查网络或稍后重试';
      setErrorMessage(msg);
      toast.error('保存失败', msg);
      return null;
    }
  }, [getValues, clearErrors, setError, toast, characterId, updateMutation, tags, variants, detailData?.draftRevision, refetchDetail, createMutation, router]);

  const openIdentityEditor = () => {
    setIdentityDraft({ displayName: getValues('displayName'), work: getValues('work'), tags: [...tags] });
    setIdentityOpen(true);
  };
  const requestCloseIdentityEditor = () => {
    const changed = identityDraft.displayName !== getValues('displayName')
      || identityDraft.work !== getValues('work')
      || JSON.stringify(identityDraft.tags) !== JSON.stringify(tags);
    if (changed) setIdentityDiscardOpen(true);
    else setIdentityOpen(false);
  };
  const saveIdentityEditor = () => {
    clearErrors('displayName');
    setValue('displayName', identityDraft.displayName, { shouldDirty: true, shouldValidate: true });
    setValue('work', identityDraft.work, { shouldDirty: true });
    setTags(identityDraft.tags);
    setStatus('dirty');
    setIdentityOpen(false);
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
      toast.success(`已成功切换当前${kind === 'portrait' ? '主立绘' : '主头像'}`);
      await Promise.all([refetchDetail(), refetchAssets()]);
    } catch (err) {
      toast.error(`切换${kind === 'portrait' ? '立绘' : '头像'}失败`, err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Match Official Avatar
  const handleMatchOfficial = async () => {
    if (!characterId) {
      toast.warning('请先保存角色档案后再抓取官方头像');
      return;
    }
    try {
      await matchOfficialAvatarMutation.mutateAsync(characterId);
      toast.success('已成功抓取并应用官方高清头像！');
      await refetchDetail();
    } catch (err: unknown) {
      toast.error('官方头像抓取失败', err instanceof Error ? err.message : String(err));
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
      toast.success('已成功从链接导入头像！');
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
      'masterpiece, best quality, anime portrait, official art',
    ]
      .filter(Boolean)
      .join(', ');
    setAiAvatarPrompt(defaultPrompt);
    setAiAvatarDialogOpen(true);
  };

  const handleStartAiAvatarGeneration = async () => {
    if (!characterId) return;
    try {
      setAiAvatarDialogOpen(false);
      const task = await generateAvatarMutation.mutateAsync({
        id: characterId,
        prompt: aiAvatarPrompt.trim() || undefined,
      });
      setAvatarTaskId(task.id);
      toast.success('AI 头像生成任务已提交，正在生成中…');
    } catch (err: unknown) {
      toast.error('提交 AI 头像生成失败', err instanceof Error ? err.message : String(err));
    }
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
      {/* 顶部页头：无版本号、无草稿/已发布标签 */}
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
                '正在保存…'
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
              <span>保存角色</span>
            </Button>
          </div>
        }
      />

      {errorMessage && (
        <div className="mt-4">
          <Alert variant="danger" onDismiss={() => setErrorMessage('')}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {/* 双栏工作台：左栏卡片与工具，右栏精简人设与外观 */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
        {/* ================= 左栏：角色卡预览、头像工具、衍生形态 ================= */}
        <div className="space-y-6 lg:sticky lg:top-6">
          {/* 角色卡牌预览 */}
          <div className="rounded-xl border border-border-default bg-surface p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                角色卡牌预览
              </span>
              <span className="inline-flex items-center rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                {currentVariant ? `形态: ${currentVariant.name}` : '默认形态'}
              </span>
            </div>

            {/* 角色卡牌预览：立绘为主，头像为辅 */}
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-border-default/80 bg-surface-muted shadow-inner flex items-center justify-center">
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
                  className="object-cover opacity-80"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-muted">
                  <span className="text-5xl font-bold opacity-40">
                    {draft.displayName ? draft.displayName.slice(0, 1) : '角'}
                  </span>
                  <span className="mt-2 text-xs text-fg-subtle">暂未设置立绘与头像</span>
                </div>
              )}

              {/* 头像徽章（左上角浮动小圆图） */}
              {currentAvatarUrl && (
                <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-surface/90 backdrop-blur-md p-1 pr-2.5 shadow-md border border-border-default/60">
                  <div className="relative h-9 w-9 overflow-hidden rounded-full border border-border-default bg-surface-muted">
                    <Image
                      src={currentAvatarUrl}
                      alt={draft.displayName || '角色头像'}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                  <div className="text-[11px] leading-tight">
                    <span className="block font-bold text-ink">当前头像</span>
                  </div>
                </div>
              )}

              {/* 立绘状态标签（右上角） */}
              {currentPortraitUrl && (
                <div className="absolute top-3 right-3 rounded-md bg-surface/80 backdrop-blur-md px-2 py-0.5 text-[11px] font-medium text-ink shadow-sm border border-border-default/50">
                  当前立绘
                </div>
              )}
            </div>

            {/* 角色基本信息预览 */}
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-ink truncate">
                {draft.displayName || '未命名角色'}
              </h3>
              <p className="text-xs font-medium text-fg-subtle">
                {draft.work || '原创世界'}
                {draft.originType === 'ip' ? ' · IP 角色' : ' · 原创'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted line-clamp-3">
                {draft.summary || draft.personaText || '尚未填写一句话人设概述。'}
              </p>
            </div>

            {/* 标签 */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border-subtle">
                {tags.slice(0, 5).map((t) => (
                  <span key={t} className="rounded bg-surface-muted px-2 py-0.5 text-xs text-muted">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 头像与角色卡多源获取工具 */}
          <div className="rounded-xl border border-border-default bg-surface p-5 shadow-sm space-y-3">
            <h4 className="text-sm font-bold text-ink">获取头像与立绘</h4>
            <p className="text-xs text-muted leading-relaxed">
              支持多源（Enka CDN、百科 Wiki 等）自动匹配、AI 生图、本地上传与酒馆卡交互。
            </p>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {/* 多源获取头像与立绘 (重点入口) */}
              <Button
                type="button"
                size="sm"
                variant="accent"
                disabled={!characterId}
                onClick={() => setMultiSourceDialogOpen(true)}
                className="col-span-2 justify-center text-xs h-9 font-semibold shadow-sm"
                title="自动探测 Enka CDN、Fandom Wiki 等官方资源库"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                <span>多源获取头像与立绘</span>
              </Button>

              {/* 本地上传立绘 */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!characterId || uploadAssetMutation.isPending}
                onClick={() => portraitInputRef.current?.click()}
                className="justify-start text-xs h-9"
              >
                <Upload className="h-3.5 w-3.5 mr-1 text-purple-500" aria-hidden="true" />
                <span>上传立绘大图</span>
              </Button>

              {/* 本地上传头像 */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!characterId || uploadAssetMutation.isPending}
                onClick={() => avatarInputRef.current?.click()}
                className="justify-start text-xs h-9"
              >
                <Upload className="h-3.5 w-3.5 mr-1 text-emerald-500" aria-hidden="true" />
                <span>上传头像图标</span>
              </Button>

              {/* AI 生成头像 */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!characterId || avatarTaskId !== null}
                loading={avatarTaskId !== null}
                onClick={handleTriggerAiAvatar}
                className="justify-start text-xs h-9"
                title="基于外观与服装特征通过 ComfyUI 生成专属头像"
              >
                <Palette className="h-3.5 w-3.5 mr-1 text-indigo-500" aria-hidden="true" />
                <span>AI 生成头像</span>
              </Button>

              {/* 图片链接导入 */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!characterId}
                onClick={() => setUrlDialogOpen(true)}
                className="justify-start text-xs h-9"
              >
                <Globe className="h-3.5 w-3.5 mr-1 text-sky-500" aria-hidden="true" />
                <span>从链接获取</span>
              </Button>

              {/* 导入酒馆卡 */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setImportDialogOpen(true)}
                className="justify-start text-xs h-9"
                title="导入 Tavern Card V2 (PNG/JSON)"
              >
                <FolderInput className="h-3.5 w-3.5 mr-1 text-amber-500" aria-hidden="true" />
                <span>导入酒馆卡</span>
              </Button>

              {/* 导出酒馆卡 */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!characterId}
                onClick={handleExportTavern}
                className="justify-start text-xs h-9"
                title="导出为标准 Tavern Card V2 JSON"
              >
                <Download className="h-3.5 w-3.5 mr-1 text-purple-500" aria-hidden="true" />
                <span>导出酒馆卡</span>
              </Button>
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

          {/* 形象资产库 (Asset Gallery) */}
          <div className="rounded-xl border border-border-default bg-surface p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-ink flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-accent" />
                <span>形象资产库</span>
              </h4>
              <span className="text-xs text-muted">
                {assetsData?.items ? `${assetsData.items.length} 个资产` : '加载中…'}
              </span>
            </div>
            <p className="text-xs text-muted">
              管理该角色的所有头像与立绘，可随时一键切换当前生效的立绘或头像。
            </p>

            {/* 过滤 Tab */}
            <div className="flex items-center gap-1 bg-surface-muted p-1 rounded-lg text-xs">
              {(['all', 'portrait', 'avatar'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setAssetFilter(tab)}
                  className={`flex-1 py-1 rounded-md transition-colors font-medium ${
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
              <div className="py-6 text-center text-xs text-muted border border-dashed border-border-default rounded-lg">
                暂无此分类资产，可通过「多源获取」或「上传」添加
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 max-h-[360px] overflow-y-auto p-0.5">
                {filteredAssets.map((asset) => {
                  const isCurrentAvatar = asset.id === detailData?.avatarAssetId;
                  const isCurrentPortrait = asset.id === detailData?.portraitAssetId;
                  return (
                    <div
                      key={asset.id}
                      className="group relative rounded-lg border border-border-default bg-surface-muted/30 p-2 space-y-2 hover:border-border-hover transition-all"
                    >
                      <div className="relative aspect-[3/4] w-full rounded overflow-hidden bg-surface-muted flex items-center justify-center">
                        <Image
                          src={asset.url}
                          alt="角色资产"
                          fill
                          unoptimized
                          className="object-contain"
                        />
                        {/* 状态徽章 */}
                        <div className="absolute top-1 left-1 flex flex-col gap-1">
                          {isCurrentAvatar && (
                            <span className="rounded bg-emerald-500/90 text-white text-[9px] px-1 py-0.5 font-bold shadow-xs">
                              主头像
                            </span>
                          )}
                          {isCurrentPortrait && (
                            <span className="rounded bg-accent/90 text-white text-[9px] px-1 py-0.5 font-bold shadow-xs">
                              主立绘
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 切换按钮 */}
                      <div className="flex flex-col gap-1">
                        {!isCurrentAvatar && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 text-[11px] px-1.5 w-full"
                            onClick={() => handleSetActiveAsset(asset.id, 'avatar')}
                            disabled={setActiveAssetMutation.isPending}
                          >
                            设为主头像
                          </Button>
                        )}
                        {!isCurrentPortrait && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 text-[11px] px-1.5 w-full"
                            onClick={() => handleSetActiveAsset(asset.id, 'portrait')}
                            disabled={setActiveAssetMutation.isPending}
                          >
                            设为主立绘
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 衍生形态管理 (Variant Cards) */}
          <div className="rounded-xl border border-border-default bg-surface p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-accent" />
                <h4 className="text-sm font-bold text-ink">衍生形态</h4>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAddVariantDialogOpen(true)}
                className="h-7 px-2 text-xs text-accent hover:bg-accent/10"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                <span>新增形态</span>
              </Button>
            </div>
            <p className="text-xs text-muted">
              原角色档案为固定主体；各形态拥有专属人设微调、换装外观与角色卡。
            </p>

            <div className="space-y-1.5 pt-1">
              {/* 默认主体形态 */}
              <button
                type="button"
                onClick={() => setActiveVariantId(null)}
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  activeVariantId === null
                    ? 'bg-accent/10 text-accent border border-accent/30'
                    : 'bg-surface-muted text-ink hover:bg-surface-elevated'
                }`}
              >
                <span>默认形态 (主档案)</span>
                {activeVariantId === null && <Check className="h-3.5 w-3.5 text-accent" />}
              </button>

              {/* 用户自定义的衍生形态列表 */}
              {variants.map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
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
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ================= 右栏：精简人设与外观表单 ================= */}
        <div className="rounded-xl border border-border-default bg-surface p-6 shadow-sm space-y-6 max-w-[760px] w-full min-w-0">
          <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
            <div>
              <h2 className="text-lg font-bold text-ink">
                {currentVariant ? `编辑衍生形态：${currentVariant.name}` : '编辑基础档案与外观'}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {currentVariant
                  ? '该形态独立拥有定制的人设与外观服装描述。'
                  : '字段已精简为人设与外观两大核心，保存即生效。'}
              </p>
            </div>
            {currentVariant && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setActiveVariantId(null)}
                className="text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                <span>返回主档案</span>
              </Button>
            )}
          </div>

          <section className="flex min-w-0 items-start justify-between gap-4 rounded-[var(--radius-panel)] bg-surface-muted px-4 py-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-ink">{draft.displayName || '未命名角色'}</h3>
              <p className="mt-1 truncate text-sm text-muted">{draft.work || '未设置所属作品'}{tags.length ? ` · ${tags.slice(0, 3).join('、')}` : ''}</p>
            </div>
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={openIdentityEditor}>编辑身份资料</Button>
          </section>

          {/* 2. 角色人设 (Persona) */}
          <div className="space-y-4 pt-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-xs text-accent">
                2
              </span>
              角色人设 (Persona)
            </h3>

            <label className="block text-xs font-semibold text-ink">
              <span>一句话概述（卡片与列表展示）</span>
              <Textarea
                rows={2}
                {...register('summary')}
                placeholder="枫丹前水神，聚光灯下华丽戏剧化，内心敏感孤单的戏剧家。"
                className="mt-1 text-base"
              />
            </label>

            <label className="block text-xs font-semibold text-ink">
              <span>详细人设背景（身份、经历、性格、好恶）</span>
              <Textarea
                rows={12}
                {...register('personaText')}
                placeholder={PERSONA_PLACEHOLDER}
                className="mt-1 text-base font-mono leading-relaxed"
              />
            </label>
          </div>

          {/* 3. 角色外观 (Appearance) */}
          <div className="space-y-4 pt-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-xs text-accent">
                3
              </span>
              角色外观 (Appearance)
            </h3>

            <label className="block text-xs font-semibold text-ink">
              <span>基础外貌（面部、发型发色、体貌特征）</span>
              <Textarea
                rows={4}
                {...register('appearance.baseText')}
                placeholder="蓝白相间中长发，双色渐变微卷发尾；水蓝色异色瞳孔；身形娇小玲珑，神情灵动。"
                className="mt-1 text-base leading-relaxed"
              />
            </label>

            <label className="block text-xs font-semibold text-ink">
              <span>代表性装扮（默认服装、配饰细节）</span>
              <Textarea
                rows={4}
                {...register('appearance.defaultOutfitText')}
                placeholder="华丽的深蓝与白色枫丹礼服礼帽，精致蕾丝领结，左眼单片水滴装饰。"
                className="mt-1 text-base leading-relaxed"
              />
            </label>

            <details className="rounded-[var(--radius-control)] bg-surface-muted p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">角色 LoRA · {visualLoraFields.length} 项（可选）</summary>
              <div className="mt-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="max-w-[var(--shell-reading)] text-xs leading-relaxed text-muted">活动镜头使用此角色时，会把这些 LoRA 叠加到活动画风设置上。文件名需与 ComfyUI 的 models/loras 清单一致。</p>
                <Button type="button" size="sm" variant="outline" onClick={() => appendVisualLora({ model: '', strength: 1, triggerWord: '', enabled: true })}>
                  <Plus className="h-3.5 w-3.5" />添加
                </Button>
              </div>
              {visualLoraFields.length === 0 ? <p className="rounded border border-dashed border-border-default px-3 py-3 text-center text-xs text-muted">尚未配置角色 LoRA。</p> : (
                <div className="space-y-3">
                  {visualLoraFields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-1 gap-2 rounded-[var(--radius-control)] border border-border-default bg-surface p-3 sm:grid-cols-[minmax(0,1.5fr)_100px_minmax(0,1fr)_auto] sm:items-end">
                      <label className="block min-w-0 text-xs font-medium text-muted">LoRA 文件名
                        <Input {...register(`visualLoras.${index}.model`)} placeholder="character-style.safetensors" className="mt-1 bg-surface" />
                      </label>
                      <label className="block text-xs font-medium text-muted">强度
                        <Input type="number" min={-10} max={10} step={0.05} {...register(`visualLoras.${index}.strength`, { valueAsNumber: true })} className="mt-1 bg-surface" />
                      </label>
                      <label className="block min-w-0 text-xs font-medium text-muted">触发词
                        <Input {...register(`visualLoras.${index}.triggerWord`)} placeholder="角色或画风触发词" className="mt-1 bg-surface" />
                      </label>
                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        <label className="inline-flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" {...register(`visualLoras.${index}.enabled`)} className="h-4 w-4 accent-[var(--color-accent)]" />启用</label>
                        <Button type="button" size="sm" variant="ghost" aria-label={`移除第 ${index + 1} 个角色 LoRA`} onClick={() => removeVisualLora(index)}><Trash2 className="h-3.5 w-3.5 text-muted" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </details>
          </div>

          {/* 底部保存条 */}
          <div className="pt-6 border-t border-border-subtle flex items-center justify-between">
            <span className="text-xs text-muted">
              保存后即刻生效，无需繁琐的发布与版本号确认。
            </span>
            <Button
              type="button"
              variant="accent"
              size="lg"
              onClick={() => void handleSave()}
              loading={status === 'saving'}
              className="px-6 font-semibold"
            >
              <Save className="h-4 w-4 mr-2" />
              <span>保存角色</span>
            </Button>
          </div>
        </div>
      </div>

      <ResponsiveEditOverlay
        open={identityOpen}
        onOpenChange={(open) => { if (open) setIdentityOpen(true); else requestCloseIdentityEditor(); }}
        title="编辑身份资料"
        description="这些资料用于角色列表、检索和活动选人。保存到角色前仍需点击页面上的“保存角色”。"
        footer={<><Button type="button" variant="outline" onClick={requestCloseIdentityEditor}>取消</Button><Button type="button" disabled={!identityDraft.displayName.trim()} onClick={saveIdentityEditor}>应用到表单</Button></>}
      >
        <div className="space-y-5">
          <FormField label="角色名称" required error={errors.displayName ? '角色名称不能为空' : undefined}>
            <Input value={identityDraft.displayName} maxLength={120} onChange={(event) => setIdentityDraft((value) => ({ ...value, displayName: event.target.value }))} placeholder="例如：芙宁娜" />
          </FormField>
          <FormField label="所属作品"><Input value={identityDraft.work} maxLength={120} onChange={(event) => setIdentityDraft((value) => ({ ...value, work: event.target.value }))} placeholder="例如：原神" /></FormField>
          <FormField label="角色标签" hint="用于搜索和角色库筛选。">
            <TagsInput value={identityDraft.tags} onChange={(nextTags) => setIdentityDraft((value) => ({ ...value, tags: nextTags }))} placeholder="枫丹、水神、戏剧家" />
          </FormField>
        </div>
      </ResponsiveEditOverlay>
      <ConfirmDialog
        open={identityDiscardOpen}
        onOpenChange={setIdentityDiscardOpen}
        title="放弃身份资料修改？"
        description="弹窗中的临时修改尚未应用到角色表单，关闭后将丢弃。"
        cancelLabel="继续编辑"
        confirmLabel="放弃修改"
        onConfirm={() => setIdentityOpen(false)}
      />

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

      {/* AI 头像生成确认对话框 */}
      <Dialog
        open={aiAvatarDialogOpen}
        onOpenChange={setAiAvatarDialogOpen}
        title="AI 一键生成头像"
        description="系统已根据角色的外貌与代表性装扮自动合成提示词，您可以根据需要进行微调。"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAiAvatarDialogOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="accent"
              disabled={generateAvatarMutation.isPending}
              loading={generateAvatarMutation.isPending}
              onClick={handleStartAiAvatarGeneration}
            >
              开始生成
            </Button>
          </div>
        }
      >
        <div className="space-y-3 py-2">
          <label className="block text-xs font-semibold text-ink">生图提示词 (Prompt)</label>
          <Textarea
            rows={4}
            value={aiAvatarPrompt}
            onChange={(e) => setAiAvatarPrompt(e.target.value)}
            className="text-sm font-mono"
          />
        </div>
      </Dialog>

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
