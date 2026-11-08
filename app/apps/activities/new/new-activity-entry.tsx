'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Sparkles,
  Users,
  Compass,
  ArrowRight,
  Layers,
  Check,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { storyApi } from '@/app/features/story/api';
import { publicationApi } from '@/app/features/activities/publication/api';
import { createActivity } from '@/app/features/activities/api';
import { PlanningWizard } from '@/app/features/activities/components/planning-wizard';
import { useCharacters } from '@/app/features/characters/queries';

type EntryMode = 'quick' | 'wizard';
type QuickTab = 'story' | 'character' | 'blank';

export function NewActivityEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storyProjectIdParam = searchParams.get('storyProjectId') || '';
  const hasWizardParams = Boolean(
    searchParams.get('session') ||
    (searchParams.get('template') && searchParams.get('template') !== 'blank') ||
    searchParams.get('refs')
  );

  const [entryMode, setEntryMode] = useState<EntryMode>(() =>
    hasWizardParams && !storyProjectIdParam ? 'wizard' : 'quick'
  );
  const [quickTab, setQuickTab] = useState<QuickTab>('story');

  // 小说项目与章节制作状态
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => storyProjectIdParam);
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [deriving, setDeriving] = useState(false);
  const [deriveError, setDeriveError] = useState('');

  // 快速角色创建状态
  const [customTitle, setCustomTitle] = useState('');
  const [customTheme, setCustomTheme] = useState('');
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [quickCreating, setQuickCreating] = useState(false);
  const [quickError, setQuickError] = useState('');

  const [prevParam, setPrevParam] = useState(storyProjectIdParam);
  if (storyProjectIdParam !== prevParam) {
    setPrevParam(storyProjectIdParam);
    if (storyProjectIdParam) {
      setSelectedProjectId(storyProjectIdParam);
      setQuickTab('story');
    }
  }

  // 数据查询
  const projectsQuery = useQuery({
    queryKey: ['story', 'projects-for-derive'],
    queryFn: () => storyApi.listProjects(),
    staleTime: 30_000,
  });

  const documentsQuery = useQuery({
    queryKey: ['story', selectedProjectId, 'documents-for-derive'],
    queryFn: () => storyApi.listDocuments(selectedProjectId),
    enabled: Boolean(selectedProjectId),
    staleTime: 30_000,
  });

  const charactersQuery = useCharacters();

  const projects = projectsQuery.data?.items ?? [];
  // 不允许 outline 作为正式制作来源，仅允许 chapter 正文
  const chapters = (documentsQuery.data?.items ?? []).filter((d) => d.kind === 'chapter');
  const allCharacters = charactersQuery.data?.items ?? [];

  const selectedCharacters = selectedCharacterIds
    .map((id) => allCharacters.find((c) => c.id === id))
    .filter((c): c is (typeof allCharacters)[number] => Boolean(c));
  const selectedUnpublished = selectedCharacters.filter(
    (c) => typeof c.latestVersion !== 'number' || c.latestVersion < 1
  );

  // 1. 从小说章节派生正式制作版本
  const handleDeriveFromStory = async () => {
    if (!selectedProjectId || !selectedChapterId || deriving) return;
    setDeriving(true);
    setDeriveError('');
    try {
      const chapter = chapters.find((c) => c.id === selectedChapterId);
      if (!chapter) throw new Error('未找到所选章节，请重新选择。');

      // 读取所选章节已保存的 revision
      const revisionsRes = await storyApi.listRevisions(selectedProjectId, 'chapter', selectedChapterId);
      const latestRevision = revisionsRes.items?.[0];
      if (!latestRevision) {
        throw new Error('所选章节尚未保存任何历史修订版本，请先在创作项目中保存章节正文后再进行制作。');
      }

      // 正式调用 publicationApi.create 建立制作版本，保留来源
      const draft = await publicationApi.create(selectedProjectId, [latestRevision.id]);
      router.push(`/apps/activities/${draft.activityId}`);
    } catch (err) {
      setDeriveError(err instanceof Error ? err.message : '制作版本创建失败');
    } finally {
      setDeriving(false);
    }
  };

  // 2. 快速角色与设定创建
  const handleQuickCreate = async () => {
    if (!customTitle.trim() || quickCreating) return;
    setQuickCreating(true);
    setQuickError('');
    try {
      if (selectedCharacters.length === 0) {
        throw new Error('请至少选择一位出镜角色。');
      }

      // 检查是否有未发布正式版本的角色，明确提示去角色库发布，不虚构 id 或 version
      if (selectedUnpublished.length > 0) {
        throw new Error(
          `角色《${selectedUnpublished.map((u) => u.displayName).join('》、《')}》尚未发布版本。快速制作要求角色具有已发布版本，请前往角色库发布正式版本后再选用，不可使用未发布角色。`
        );
      }

      const actors = selectedCharacters.map((c) => ({
        sourceCharacterId: c.id,
        sourceVersion: c.latestVersion as number,
        displayName: c.displayName,
        activityRole: '核心主角',
      }));

      const res = await createActivity({
        title: customTitle.trim(),
        type: '四幕分镜漫剧',
        theme: customTheme.trim() || '奇幻冒险',
        location: '主场景',
        rules: '四幕起承转合分镜漫剧工程。',
        stageTitles: ['第一幕 起', '第二幕 承', '第三幕 转', '第四幕 合'],
        actors,
      });

      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : '创建制作工程失败');
    } finally {
      setQuickCreating(false);
    }
  };

  // 3. 空白起步
  const handleBlankCreate = async () => {
    if (quickCreating) return;
    setQuickCreating(true);
    try {
      const res = await createActivity({
        title: '全新制作工坊',
        type: '分镜漫剧',
        theme: '自由创作',
        location: '舞台',
        stageTitles: ['第一场', '第二场'],
        actors: [{ displayName: '主角', activityRole: '登场角色' }],
      });
      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : '创建空白工坊失败');
    } finally {
      setQuickCreating(false);
    }
  };

  if (entryMode === 'wizard') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-6 py-2.5">
          <span className="text-xs text-muted">当前为传统多阶段企划向导</span>
          <Button size="sm" variant="ghost" onClick={() => setEntryMode('quick')} className="text-xs">
            返回快速制作工坊
          </Button>
        </div>
        <PlanningWizard />
      </div>
    );
  }

  return (
    <PageContainer width="settings" className="space-y-6 py-6">
      <PageHeader
        title="新建制作工坊"
        description="从创作项目章节冻结生成正式制作版本，或挑选已发布角色快速建立分镜漫剧工程。"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEntryMode('wizard')}
            className="text-sm text-muted hover:text-ink gap-1"
          >
            <Compass className="size-3.5" />
            <span>切换传统企划向导</span>
          </Button>
        }
      />

      {/* 核心方式三选一导航 */}
      {[projectsQuery, documentsQuery, charactersQuery].map((query, index) => query.isError ? <div key={index} role="alert">{['项目', '章节', '角色'][index]}读取失败。<Button disabled={query.isFetching} onClick={() => void query.refetch()}>重新读取</Button></div> : query.isLoading && query.fetchStatus === 'fetching' ? <p key={index} role="status">正在读取{['项目', '章节', '角色'][index]}…</p> : null)}
      <div className="flex items-center gap-1 bg-surface-muted p-1 rounded-control border border-border-subtle" role="tablist" aria-label="创建方式">
        <button
          type="button"
          role="tab"
          aria-selected={quickTab === 'story'}
          onClick={() => setQuickTab('story')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-control py-2 text-sm font-medium transition-all ${
            quickTab === 'story'
              ? 'bg-surface text-ink font-semibold shadow-xs'
              : 'text-muted hover:text-ink'
          }`}
        >
          <BookOpen className="size-3.5 text-muted" />
          <span>从小说章节制作 (推荐)</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={quickTab === 'character'}
          onClick={() => setQuickTab('character')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-control py-2 text-sm font-medium transition-all ${
            quickTab === 'character'
              ? 'bg-surface text-ink font-semibold shadow-xs'
              : 'text-muted hover:text-ink'
          }`}
        >
          <Users className="size-3.5 text-muted" />
          <span>挑选角色与题材生成</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={quickTab === 'blank'}
          onClick={() => setQuickTab('blank')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-control py-2 text-sm font-medium transition-all ${
            quickTab === 'blank'
              ? 'bg-surface text-ink font-semibold shadow-xs'
              : 'text-muted hover:text-ink'
          }`}
        >
          <Layers className="size-3.5 text-muted" />
          <span>空白画卷起步</span>
        </button>
      </div>

      {/* 方式 1：从小说章节制作 */}
      {quickTab === 'story' && (
        <section className="space-y-5 rounded-panel border border-border-subtle bg-surface p-6">
          <div className="border-b border-border-subtle pb-3">
            <h3 className="text-base font-semibold text-ink">选择要制作的正式章节</h3>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              冻结已保存章节正文版本，建立关键画面与配音制作工程。完整保留来源项目与章节关联，不会修改正式剧情。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="select-story-project" className="block text-xs font-medium text-fg-subtle mb-1.5">
                1. 选择所属创作项目
              </label>
              <select
                id="select-story-project"
                aria-label="选择所属创作项目"
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setSelectedChapterId('');
                }}
                className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">-- 请选择创作项目 --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="select-story-chapter" className="block text-xs font-medium text-fg-subtle mb-1.5">
                2. 选择正式章节正文
              </label>
              <select
                id="select-story-chapter"
                aria-label="选择正式章节正文"
                value={selectedChapterId}
                disabled={!selectedProjectId || chapters.length === 0}
                onChange={(e) => setSelectedChapterId(e.target.value)}
                className="w-full rounded-control border border-border-control bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">
                  {selectedProjectId
                    ? chapters.length > 0
                      ? '-- 请选择章节 --'
                      : documentsQuery.isError ? '章节读取失败' : documentsQuery.isLoading ? '正在读取章节…' : '该项目暂无章节正文'
                    : '-- 请先选择项目 --'}
                </option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} (v{c.revision})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedProjectId && !documentsQuery.isLoading && !documentsQuery.isError && chapters.length === 0 && (
            <div className="flex items-center justify-between rounded-control bg-surface-sunken p-3 text-xs text-muted border border-border-subtle">
              <span>当前创作项目尚未包含正式章节正文（大纲不可作为正式制作来源）。请先前往该项目撰写并保存章节正文后再制作。</span>
              <Link
                href={`/apps/projects/${selectedProjectId}`}
                className="text-accent underline font-medium hover:text-accent-dark ml-2 shrink-0"
              >
                前往编写正文
              </Link>
            </div>
          )}

          {deriveError && (
            <p className="text-xs text-danger-fg bg-danger/8 border border-danger/20 rounded-control p-2.5">
              {deriveError}
            </p>
          )}

          <div className="border-t border-border-subtle pt-4">
            <Button
              variant="accent"
              disabled={!selectedProjectId || !selectedChapterId || deriving}
              onClick={() => void handleDeriveFromStory()}
              className="font-semibold"
            >
              {deriving ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              <span>创建制作版本并进入制作台</span>
            </Button>
          </div>
        </section>
      )}

      {/* 方式 2：挑选角色与题材生成 */}
      {quickTab === 'character' && (
        <section className="space-y-5 rounded-panel border border-border-subtle bg-surface p-6">
          <div className="border-b border-border-subtle pb-3">
            <h3 className="text-base font-semibold text-ink">挑选出镜角色与题材</h3>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              从角色库中挑选已发布版本角色，快速建立独立分镜漫剧工程。角色将绑定真实版本与外貌设定。
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="custom-activity-title" className="block text-xs font-medium text-fg-subtle mb-1.5">
                漫剧工程名称
              </label>
              <Input
                id="custom-activity-title"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="例如：提瓦特冬日温泉物语"
                className="max-w-md text-base sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="custom-activity-theme" className="block text-xs font-medium text-fg-subtle mb-1.5">
                故事梗概或主题 (可选)
              </label>
              <Textarea
                id="custom-activity-theme"
                rows={2}
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
                placeholder="例如：几人在初雪之夜围坐畅谈，偶遇神秘来客…"
                className="max-w-md text-base sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-fg-subtle mb-1.5">
                挑选登场角色 (已选 {selectedCharacterIds.length} 位)
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2.5 rounded-control border border-border-subtle bg-surface-sunken">
                {allCharacters.map((c) => {
                  const isSelected = selectedCharacterIds.includes(c.id);
                  const isPublished = typeof c.latestVersion === 'number' && c.latestVersion > 0;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCharacterIds((prev) =>
                          isSelected ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                        );
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs transition-colors ${
                        isSelected
                          ? 'bg-accent text-fg-on-accent font-medium'
                          : 'bg-surface border border-border-subtle text-ink hover:border-border-strong'
                      }`}
                    >
                      {isSelected && <Check className="size-3" />}
                      <span>{c.displayName}</span>
                      {!isPublished ? (
                        <span className="rounded bg-amber-500/15 px-1 py-0.2 text-[10px] text-amber-700 dark:text-amber-400">
                          未发布
                        </span>
                      ) : (
                        <span className="opacity-60 text-xs">v{c.latestVersion}</span>
                      )}
                      {c.tags?.[0] && <span className="opacity-60 text-xs">· {c.tags[0]}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedUnpublished.length > 0 && (
              <div className="flex items-center gap-2 rounded-control bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400 border border-amber-500/20">
                <AlertCircle className="size-4 shrink-0" />
                <span>
                  已选角色中包含未发布正式版本：{selectedUnpublished.map((c) => `《${c.displayName}》`).join('、')}。快速制作只支持已发布角色，请前往 <Link href="/apps/characters" className="underline font-medium">角色库</Link> 发布正式版本后再选用。
                </span>
              </div>
            )}
          </div>

          {quickError && (
            <p className="text-xs text-danger-fg bg-danger/8 border border-danger/20 rounded-control p-2.5">
              {quickError}
            </p>
          )}

          <div className="border-t border-border-subtle pt-4">
            <Button
              variant="accent"
              disabled={!customTitle.trim() || quickCreating}
              onClick={() => void handleQuickCreate()}
              className="font-semibold"
            >
              {quickCreating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              <span>创建四幕分镜工程</span>
            </Button>
          </div>
        </section>
      )}

      {/* 方式 3：空白起步 */}
      {quickTab === 'blank' && (
        <section className="space-y-4 rounded-panel border border-border-subtle bg-surface p-8 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-surface-sunken text-fg-subtle border border-border-subtle">
            <Plus className="size-5" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-semibold text-ink">快速建立空白视觉工坊</h3>
            <p className="text-xs text-muted leading-relaxed">
              不预设剧情与模板，直接进入自由分镜与漫画连环画排版画布。
            </p>
          </div>
          {quickError && (
            <p className="text-xs text-danger-fg bg-danger/8 border border-danger/20 rounded-control p-2.5 max-w-sm mx-auto">
              {quickError}
            </p>
          )}
          <div className="pt-2">
            <Button
              variant="accent"
              disabled={quickCreating}
              onClick={() => void handleBlankCreate()}
              className="font-semibold"
            >
              {quickCreating ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              <span>直接开启空白工坊</span>
            </Button>
          </div>
        </section>
      )}
    </PageContainer>
  );
}
