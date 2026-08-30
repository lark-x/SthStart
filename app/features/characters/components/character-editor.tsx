'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import {
  ArrowLeft,
  Upload,
  Download,
  Send,
  Save,
  Sparkles,
  User,
  Heart,
  Palette,
  Users,
  Layers,
} from 'lucide-react';
import type { CharacterDraft } from '@sthstart/contracts';
import { useCharacterDetail, useCharacters } from '../queries';
import {
  useCreateCharacter,
  useUpdateCharacter,
  useGenerateCharacterDraft,
  usePublishCharacter,
  useUploadCharacterAvatar,
  useGenerateCharacterAvatar,
  useApplyCharacterAvatar,
  useImportTavernCard,
  useSaveRelationship,
  useDeleteRelationship,
} from '../mutations';
import { exportTavernCard, fetchCharacterGenerationTask } from '../api';
import { EMPTY_DRAFT } from '../schemas';
import {
  characterDraftToFormValues,
  characterFormValuesToDraft,
  type CharacterFormValues,
} from './character-form';
import { IdentitySection } from './identity-section';
import { PersonalitySection } from './personality-section';
import { AppearanceSection } from './appearance-section';
import { RelationsSection } from './relations-section';
import { PublishSection } from './publish-section';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useToast } from '@/app/providers/ui-provider';
import { EyeCareToggle } from '@/app/components/shared/eye-care-toggle';

type Section = 'identity' | 'personality' | 'appearance' | 'relations' | 'publish';

const EMPTY_FORM_VALUES = characterDraftToFormValues(EMPTY_DRAFT);

export function CharacterEditor({ characterId }: { characterId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [activeSection, setActiveSection] = useState<Section>('identity');
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<'clean' | 'dirty' | 'saving' | 'saved' | 'error'>('clean');
  const [aiPrompt, setAiPrompt] = useState('');
  const [useWeb, setUseWeb] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

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
  const draft = characterFormValuesToDraft(
    (watchedValues ?? EMPTY_FORM_VALUES) as CharacterFormValues
  );

  // Queries
  const { data: detailData, error: detailError, refetch: refetchDetail } = useCharacterDetail(characterId);
  const { data: libraryData } = useCharacters();
  const library = libraryData?.items ?? [];

  // Mutations
  const createMutation = useCreateCharacter();
  const updateMutation = useUpdateCharacter();
  const generateMutation = useGenerateCharacterDraft();
  const publishMutation = usePublishCharacter();
  const uploadAvatarMutation = useUploadCharacterAvatar();
  const generateAvatarMutation = useGenerateCharacterAvatar();
  const applyAvatarMutation = useApplyCharacterAvatar();
  const importMutation = useImportTavernCard();
  const saveRelMutation = useSaveRelationship();
  const deleteRelMutation = useDeleteRelationship();
  const [avatarTaskId, setAvatarTaskId] = useState<string | null>(null);

  const handleSave = useCallback(async (quiet = false) => {
    const currentDraft = characterFormValuesToDraft(getValues());
    if (!currentDraft.displayName.trim()) {
      setError('displayName', { type: 'required', message: '请先填写角色名称' });
      if (!quiet) {
        setErrorMessage('请先填写角色名称');
        toast.warning('请先填写角色名称');
      }
      return null;
    }

    setStatus('saving');
    setErrorMessage('');
    clearErrors('displayName');
    const savedTags = [...tags];

    try {
      if (!characterId) {
        const created = await createMutation.mutateAsync({
          displayName: currentDraft.displayName.trim(),
          draft: currentDraft,
          tags,
        });
        toast.success('角色创建成功');
        router.replace(`/apps/characters/${created.id}`);
        return created.id;
      }

      const updated = await updateMutation.mutateAsync({
        id: characterId,
        draft: currentDraft,
        tags,
      });
      const currentValues = characterFormValuesToDraft(getValues());
      const unchanged =
        JSON.stringify(currentValues) === JSON.stringify(currentDraft) &&
        JSON.stringify(tags) === JSON.stringify(savedTags);
      if (unchanged) {
        reset(characterDraftToFormValues(updated.draft));
        setTags(updated.tags);
      }
      setStatus(unchanged ? 'saved' : 'dirty');
      if (unchanged) setTimeout(() => setStatus('clean'), 1200);
      if (!quiet) toast.success('草稿已保存');
      return characterId;
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      if (!quiet) toast.error('保存失败', msg);
      return null;
    }
  }, [characterId, clearErrors, createMutation, getValues, reset, router, setError, tags, toast, updateMutation]);

  useEffect(() => {
    if (detailData && !isDirty && status === 'clean') {
      // Query refreshes may hydrate a clean editor, but never overwrite dirty input.
      reset(characterDraftToFormValues(detailData.draft));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTags(detailData.tags);
      setStatus('clean');
    }
  }, [detailData, isDirty, reset, status]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty && status !== 'dirty') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, status]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [handleSave]);

  // Auto save debounce
  useEffect(() => {
    if (!characterId || status !== 'dirty') return;
    const timer = setTimeout(() => {
      void handleSave(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [characterId, handleSave, status]);

  const handleDraftChange = (patch: Partial<CharacterDraft>) => {
    for (const [key, value] of Object.entries(patch) as Array<[
      keyof CharacterDraft,
      CharacterDraft[keyof CharacterDraft]
    ]>) {
      if (key === 'speech' && value && typeof value === 'object') {
        const speech = value as CharacterDraft['speech'];
        setValue('speech.tone', speech.tone, { shouldDirty: true, shouldTouch: true });
        setValue('speech.habits', speech.habits, { shouldDirty: true, shouldTouch: true });
        continue;
      }
      if (key === 'appearance' && value && typeof value === 'object') {
        const appearance = value as CharacterDraft['appearance'];
        setValue('appearance.description', appearance.description, { shouldDirty: true, shouldTouch: true });
        setValue('appearance.hair', appearance.hair, { shouldDirty: true, shouldTouch: true });
        setValue('appearance.eyes', appearance.eyes, { shouldDirty: true, shouldTouch: true });
        setValue('appearance.build', appearance.build, { shouldDirty: true, shouldTouch: true });
        continue;
      }
      setValue(key as never, value as never, { shouldDirty: true, shouldTouch: true });
    }
    if (patch.displayName !== undefined) clearErrors('displayName');
    setStatus('dirty');
  };

  const handleTagsChange = (newTags: string[]) => {
    setTags(newTags);
    setStatus('dirty');
  };

  const handleGenerate = async () => {
    let targetId = characterId;
    if (!targetId) {
      targetId = (await handleSave()) ?? undefined;
      if (!targetId) return;
    } else if (isDirty || status === 'dirty') {
      // 生成结果会整体重置表单；先把未保存的修改落库，避免并发编辑被覆盖。
      const saved = await handleSave(true);
      if (saved === null) {
        toast.error('生成草稿失败', '草稿保存失败，请先解决保存问题');
        return;
      }
    }
    if (!aiPrompt.trim()) {
      toast.warning('请填写角色描述用于 AI 提取');
      return;
    }

    try {
      const result = await generateMutation.mutateAsync({
        id: targetId,
        description: aiPrompt.trim(),
        useWeb,
      });
      reset(characterDraftToFormValues(result.draft));
      setStatus('clean');
      toast.success(`已生成可编辑草稿，并收录 ${result.sources.length} 条参考来源`);
      if (characterId) await refetchDetail();
    } catch (err) {
      toast.error('生成草稿失败', err instanceof Error ? err.message : String(err));
    }
  };

  const handlePublish = async () => {
    let targetId = characterId;
    if (!targetId) {
      targetId = (await handleSave()) ?? undefined;
      if (!targetId) return;
    } else if (isDirty || status === 'dirty') {
      // 发布快照的是服务端已保存的草稿，必须先落库未保存的修改，
      // 否则发布出去的版本不是用户屏幕上看到的版本。
      const saved = await handleSave(true);
      if (saved === null) {
        toast.error('发布失败', '草稿保存失败，请检查网络后重试');
        return;
      }
    }

    try {
      const ver = await publishMutation.mutateAsync(targetId);
      toast.success(`已成功发布版本 v${ver.version}`);
      if (characterId) await refetchDetail();
    } catch (err) {
      toast.error('发布失败', err instanceof Error ? err.message : String(err));
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !characterId) return;

    try {
      await uploadAvatarMutation.mutateAsync({ id: characterId, file });
      toast.success('头像上传成功');
      await refetchDetail();
    } catch (err) {
      toast.error('头像上传失败', err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerateAvatar = async () => {
    if (!characterId) {
      toast.warning('请先保存角色草稿');
      return;
    }
    try {
      if (isDirty || status === 'dirty') await handleSave(true);
      const task = await generateAvatarMutation.mutateAsync({ id: characterId });
      setAvatarTaskId(task.id);
      toast.success('头像生成任务已提交');
    } catch (err) {
      toast.error('提交头像生成失败', err instanceof Error ? err.message : String(err));
    }
  };

  // useMutation 返回的对象每次渲染都是新引用，绝不能进 effect 依赖；
  // 成功时先同步清空 avatarTaskId 再 await 应用结果，否则渲染触发的
  // effect 重启会让 stopped 守卫拦下 setAvatarTaskId(null)，形成
  // 「查询成功 → 应用 → 重启 → 再应用」的死循环并不断插入资产记录。
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
              toast.success('AI 头像已应用到角色');
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
        timer = window.setTimeout(() => void poll(), 1_500);
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

  // App Router 的客户端导航（返回链接、移动端滑动手势返回）不触发
  // beforeunload；已有角色的未保存修改在卸载时静默补存，避免丢失。
  const saveRef = useRef(handleSave);
  const characterIdRef = useRef(characterId);
  const pendingEditsRef = useRef(false);
  useEffect(() => {
    saveRef.current = handleSave;
    characterIdRef.current = characterId;
    pendingEditsRef.current = isDirty || status === 'dirty';
  }, [handleSave, characterId, isDirty, status]);
  useEffect(() => () => {
    if (characterIdRef.current && pendingEditsRef.current) void saveRef.current(true);
  }, []);

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const card = JSON.parse(await file.text()) as Record<string, unknown>;
      const created = await importMutation.mutateAsync(card);
      toast.success('角色卡导入成功');
      router.push(`/apps/characters/${created.id}`);
    } catch (err) {
      toast.error('导入失败', err instanceof Error ? err.message : '角色卡 JSON 格式无效');
    }
  };

  const handleExportJson = async () => {
    if (!characterId) return;
    try {
      const card = await exportTavernCard(characterId);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${detailData?.slug || 'character'}.json`;
      a.click();
      // iOS Safari 上同步 revoke 可能取消尚未开始的下载，延迟释放。
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('已导出 Tavern Card V2 JSON');
    } catch (err) {
      toast.error('导出失败', err instanceof Error ? err.message : String(err));
    }
  };

  const navItems: Array<{ id: Section; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'identity', label: '身份与经历', icon: User },
    { id: 'personality', label: '性格与表达', icon: Heart },
    { id: 'appearance', label: '外观与素材', icon: Palette },
    { id: 'relations', label: '关系与来源', icon: Users },
    { id: 'publish', label: '应用与版本', icon: Layers },
  ];

  // 编辑既有角色前必须等详情加载完成：空表单若允许交互，用户先打的字会
  // 阻断数据水合，随后自动保存用近乎空白的草稿整体覆盖服务端数据。
  if (characterId && !detailData) {
    if (detailError) {
      return (
        <main className="min-h-screen bg-[#f4f0e7] text-[#18201d]">
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="font-serif text-lg font-semibold">角色加载失败</p>
            <p className="max-w-sm text-xs text-[#68716d]">
              {detailError instanceof Error ? detailError.message : '无法加载该角色，请稍后重试。'}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => void refetchDetail()}>重试</Button>
              <Link
                href="/apps/characters"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#68716d] hover:text-[#e45d35] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>返回资料库</span>
              </Link>
            </div>
          </div>
        </main>
      );
    }
    return (
      <main className="min-h-screen bg-[#f4f0e7] text-[#18201d]">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-8">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  const saving = status === 'saving';

  return (
    <main className="min-h-screen bg-[#f4f0e7] text-[#18201d]">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-8 py-3.5 bg-[#f4f0e7]/90 backdrop-blur-md border-b border-[rgb(24_32_29/12%)]">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/apps/characters"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#68716d] hover:text-[#e45d35] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>资料库</span>
          </Link>
          <span className="text-xs text-[#68716d]">|</span>
          <span className="min-w-0 truncate text-xs text-[#68716d]">
            {status === 'saving'
              ? '正在自动保存…'
              : status === 'dirty'
              ? '等待保存修改…'
              : status === 'saved'
              ? '已保存'
              : detailData?.latestVersion
              ? `已发布 v${detailData.latestVersion}`
              : '未发布草稿'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <EyeCareToggle />
          <Button
            size="sm"
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            title="导入 Tavern Card V2 JSON"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">导入 JSON</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={!characterId}
            onClick={handleExportJson}
            title="导出为 Tavern Card V2 JSON"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">导出</span>
          </Button>

          <Button
            size="sm"
            variant="accent"
            onClick={handlePublish}
            disabled={!draft.displayName.trim() || saving}
            loading={publishMutation.isPending}
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            <span>发布版本</span>
          </Button>
        </div>
      </header>

      {errorMessage && (
        <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-4">
          <Alert variant="danger" onDismiss={() => setErrorMessage('')}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {/* Editor Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Navigation */}
        <aside className="lg:col-span-3 space-y-5 lg:sticky lg:top-20">
          <div className="flex items-center gap-3.5 p-3.5 rounded-[4px_16px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/12%)]">
            <button
              type="button"
              onClick={() => characterId && avatarInputRef.current?.click()}
              disabled={!characterId}
              className="relative h-14 w-14 rounded-full overflow-hidden bg-[#777865] flex items-center justify-center text-white font-serif text-2xl flex-shrink-0 cursor-pointer shadow-inner disabled:cursor-not-allowed"
              title={characterId ? '点击更换头像' : '保存后设置头像'}
              aria-label={characterId ? '更换角色头像' : '保存后设置头像'}
            >
              {detailData?.avatarUrl ? (
                <Image src={detailData.avatarUrl} alt="" fill unoptimized className="object-cover" />
              ) : (
                <span>{draft.displayName.slice(0, 1) || '角'}</span>
              )}
            </button>
            <div className="min-w-0">
              <h1 className="font-serif text-lg font-medium text-[#18201d] truncate">
                {draft.displayName || '新角色草稿'}
              </h1>
              <p className="text-xs text-[#68716d] truncate">
                {draft.work || draft.world || '尚未设置作品'}
              </p>
            </div>
          </div>

          <nav
            className="character-editor-tabs flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0"
            role="tablist"
            aria-label="角色编辑分区"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveSection(item.id)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors text-left cursor-pointer ${
                    isActive
                      ? 'bg-[#18201d] text-[#f4f0e7]'
                      : 'text-[#68716d] hover:bg-[rgb(24_32_29/6%)] hover:text-[#18201d]'
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Center Main Editor */}
        <div className="lg:col-span-6 space-y-6">
          {/* AI Extraction Assist */}
          <div className="p-4 rounded-[4px_18px_4px_4px] border border-[rgb(24_32_29/14%)] bg-[#fffdf8] space-y-3">
            <div className="flex items-center gap-2 text-[#e45d35]">
              <Sparkles className="h-4 w-4" />
              <strong className="text-xs font-bold uppercase tracking-wider">
                智能角色草稿提取
              </strong>
            </div>
            <p className="text-xs text-[#68716d] leading-relaxed">
              输入角色名或人物背景片段，系统将联网检索资料并自动生成结构化草稿，保留原始出处供复核。
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例如：芙宁娜（原神），保留她表面戏剧化、内心敏感的反差"
                className="flex-1 min-h-[38px] rounded border border-[rgb(24_32_29/18%)] bg-[#fffdf8] px-3 py-1 text-xs text-[#18201d] placeholder:text-[#68716d]/60 outline-none focus:border-[#e45d35]"
              />
              <Button
                size="sm"
                variant="accent"
                loading={generateMutation.isPending}
                disabled={saving}
                onClick={handleGenerate}
              >
                <span>生成草稿</span>
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#68716d] cursor-pointer select-none">
              <input type="checkbox" checked={useWeb} onChange={(e) => setUseWeb(e.target.checked)} className="accent-[#e45d35]" />
              联网检索公开资料（关闭时仅根据描述生成草稿，不产生外部请求）
            </label>
          </div>

          {/* Section Panels */}
          <div className="p-6 rounded-[4px_20px_4px_4px] border border-[rgb(24_32_29/14%)] bg-[#fffdf8] shadow-sm">
            {activeSection === 'identity' && (
              <IdentitySection
                draft={draft}
                tags={tags}
                onChange={handleDraftChange}
                onTagsChange={handleTagsChange}
                control={control}
                register={register}
                displayNameError={errors.displayName?.message}
              />
            )}

            {activeSection === 'personality' && (
              <PersonalitySection
                draft={draft}
                onChange={handleDraftChange}
                control={control}
                register={register}
              />
            )}

            {activeSection === 'appearance' && (
              <AppearanceSection
                draft={draft}
                avatarUrl={detailData?.avatarUrl}
                canUpload={Boolean(characterId)}
                onUploadClick={() => avatarInputRef.current?.click()}
                onGenerateAvatar={() => void handleGenerateAvatar()}
                generatingAvatar={generateAvatarMutation.isPending || Boolean(avatarTaskId) || applyAvatarMutation.isPending || saving}
                onChange={handleDraftChange}
                control={control}
                register={register}
              />
            )}

            {activeSection === 'relations' && (
              <RelationsSection
                detail={detailData}
                library={library}
                canEdit={Boolean(characterId)}
                onAddRelationship={async (rel) => {
                  if (!characterId) return;
                  try {
                    await saveRelMutation.mutateAsync({
                      characterId,
                      relationship: rel,
                    });
                    toast.success('关系已保存');
                  } catch (err) {
                    toast.error('保存关系失败', err instanceof Error ? err.message : String(err));
                  }
                }}
                onRemoveRelationship={async (relId) => {
                  if (!characterId) return;
                  try {
                    await deleteRelMutation.mutateAsync({
                      characterId,
                      relationshipId: relId,
                    });
                    toast.success('关系已移除');
                  } catch (err) {
                    toast.error('移除关系失败', err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            )}

            {activeSection === 'publish' && (
              <PublishSection
                detail={detailData}
                draft={draft}
                onPublish={handlePublish}
                publishing={publishMutation.isPending}
              />
            )}

            <div className="mt-8 pt-4 border-t border-[rgb(24_32_29/10%)] flex justify-end">
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                loading={status === 'saving'}
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>保存草稿</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Right Preview Card */}
        <aside className="lg:col-span-3 lg:sticky lg:top-20 hidden lg:block">
          <div className="p-4 rounded-[4px_20px_4px_4px] border border-[rgb(24_32_29/14%)] bg-[#fffdf8] shadow-sm space-y-3">
            <div className="relative aspect-4/5 w-full rounded-[3px_14px_3px_3px] overflow-hidden bg-[#777865] flex items-center justify-center text-white font-serif text-5xl shadow-inner">
              {detailData?.avatarUrl ? (
                <Image
                  src={detailData.avatarUrl}
                  alt={draft.displayName}
                  fill
                  unoptimized
                  className="object-cover"
                />
              ) : (
                <span>{draft.displayName.slice(0, 1) || '角'}</span>
              )}
            </div>

            <div>
              <span className="text-[9px] uppercase font-bold tracking-widest text-[#68716d] block truncate">
                {draft.work || draft.world || '原创世界'}
              </span>
              <h3 className="font-serif text-xl font-medium text-[#18201d] truncate mt-0.5">
                {draft.displayName || '未命名角色'}
              </h3>
              <p className="text-xs text-[#68716d] line-clamp-3 leading-relaxed mt-1">
                {draft.summary || draft.identity || '此处将实时展示角色卡片预览。'}
              </p>
            </div>

            <div className="flex flex-wrap gap-1 pt-2 border-t border-[rgb(24_32_29/10%)]">
              {draft.personality.slice(0, 4).map((trait) => (
                <span
                  key={trait}
                  className="text-[9px] bg-[rgb(24_32_29/6%)] text-[#68716d] px-2 py-0.5 rounded"
                >
                  {trait.slice(0, 10)}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={avatarInputRef}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="上传角色头像图片"
        onChange={handleUploadAvatar}
      />
      <input
        ref={importInputRef}
        hidden
        type="file"
        accept="application/json,.json"
        aria-label="导入角色 JSON 文件"
        onChange={handleImportJson}
      />
    </main>
  );
}
