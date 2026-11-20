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
  Plus,
} from 'lucide-react';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Spinner } from '@/app/components/ui/spinner';
import { Alert } from '@/app/components/ui/alert';
import { storyApi } from '@/app/features/story/api';
import { publicationApi } from '@/app/features/activities/publication/api';
import { createActivity } from '@/app/features/activities/api/activities';
import { PlanningWizard } from '@/app/features/activities/components/planning-wizard';
import { CharacterBrowserPicker, type CharacterBrowserSelection } from '@/app/features/characters/public-ui';

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
  const [selectedCharacters, setSelectedCharacters] = useState<Record<string, CharacterBrowserSelection>>({});
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


  const projects = projectsQuery.data?.items ?? [];
  // 不允许 outline 作为正式制作来源，仅允许 chapter 正文
  const chapters = (documentsQuery.data?.items ?? []).filter((d) => d.kind === 'chapter');
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
      if (Object.keys(selectedCharacters).length === 0) {
        throw new Error('请至少选择一位出镜角色。');
      }

      const actors = Object.values(selectedCharacters).map(selection => ({
        sourceCharacterId: selection.profile.id,
        sourceVersion: selection.version.version,
        sourceVariantId: selection.variantId,
        sourceCostumeAssetId: selection.costumeAssetId,
        displayName: selection.profile.displayName,
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
    return <PlanningWizard onExitWizard={() => setEntryMode('quick')} />;
  }

  return (
    <PageContainer width="settings" className="space-y-5 py-4">
      <PageHeader
        compact
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
      {[projectsQuery, documentsQuery].map((query, index) => query.isError ? <Alert key={index} variant="danger" title={`${['项目', '章节', '角色'][index]}读取失败`}><Button size="sm" variant="outline" className="mt-2" disabled={query.isFetching} onClick={() => void query.refetch()}>重新读取</Button></Alert> : query.isLoading && query.fetchStatus === 'fetching' ? <Spinner key={index} size="sm" label={`正在读取${['项目', '章节', '角色'][index]}…`} /> : null)}
      <PageTabs
        ariaLabel="创建方式"
        variant="local"
        value={quickTab}
        onChange={value => setQuickTab(value as QuickTab)}
        className="w-full [&_.mantine-Tabs-list]:w-full [&_[role=tab]]:flex-1 [&_[role=tab]]:justify-center"
        tabs={[
          { id: 'story', label: <><BookOpen className="size-3.5 text-muted" aria-hidden="true" /><span>从小说章节制作 (推荐)</span></> },
          { id: 'character', label: <><Users className="size-3.5 text-muted" aria-hidden="true" /><span>挑选角色与题材生成</span></> },
          { id: 'blank', label: <><Layers className="size-3.5 text-muted" aria-hidden="true" /><span>空白画卷起步</span></> },
        ]}
      />

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
              <Select
                id="select-story-project"
                aria-label="选择所属创作项目"
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setSelectedChapterId('');
                }}
                className="text-base sm:text-sm"
              >
                <option value="">-- 请选择创作项目 --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="select-story-chapter" className="block text-xs font-medium text-fg-subtle mb-1.5">
                2. 选择正式章节正文
              </label>
              <Select
                id="select-story-chapter"
                aria-label="选择正式章节正文"
                value={selectedChapterId}
                disabled={!selectedProjectId || chapters.length === 0}
                onChange={(e) => setSelectedChapterId(e.target.value)}
                className="text-base sm:text-sm"
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
              </Select>
            </div>
          </div>

          {selectedProjectId && !documentsQuery.isLoading && !documentsQuery.isError && chapters.length === 0 && (
            <div className="flex items-center justify-between rounded-control bg-surface-sunken p-3 text-xs text-muted border border-border-subtle">
              <span>当前创作项目尚未包含正式章节正文（大纲不可作为正式制作来源）。请先前往该项目撰写并保存章节正文后再制作。</span>
              <Link
                href={`/apps/projects/${selectedProjectId}`}
                className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'ml-2 shrink-0' })}
              >
                前往编写正文
              </Link>
            </div>
          )}

          {deriveError && (
            <Alert variant="danger" title="制作版本创建失败">{deriveError}</Alert>
          )}

          <div className="border-t border-border-subtle pt-4">
            <Button
              variant="accent"
              loading={deriving}
              disabled={!selectedProjectId || !selectedChapterId || deriving}
              onClick={() => void handleDeriveFromStory()}
              className="font-semibold"
            >
              {!deriving && <ArrowRight className="size-4" />}
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
              按作品、同源角色和形态选角，快速建立分镜漫剧工程。原创角色采用已保存阶段，所选服装将用于生图。
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="custom-activity-title" className="mb-1.5 block text-xs font-medium text-fg-subtle">
                漫剧工程名称 <span className="text-danger-fg" aria-hidden="true">*</span>
              </label>
              <Input
                id="custom-activity-title"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="例如：提瓦特冬日温泉物语"
                maxLength={120}
                required
                aria-required
                className="max-w-md text-base sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="custom-activity-theme" className="mb-1.5 block text-xs font-medium text-fg-subtle">
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
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-fg-subtle">
                  挑选登场角色 <span className="text-danger-fg" aria-hidden="true">*</span>
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {Object.keys(selectedCharacters).length > 0 ? `已选 ${Object.keys(selectedCharacters).length} 位` : '至少选 1 位'}
                </span>
              </div>
              <CharacterBrowserPicker active={quickTab === 'character'} selected={selectedCharacters} onSelectionChange={(selection, checked) => setSelectedCharacters(current => { const next = { ...current }; if (checked) next[selection.profile.id] = selection; else delete next[selection.profile.id]; return next; })} disabled={quickCreating} />
            </div>
          </div>

          {quickError && <Alert variant="danger" title="创建制作工程失败">{quickError}</Alert>}

          <div className="border-t border-border-subtle pt-4">
            <Button
              variant="accent"
              loading={quickCreating}
              disabled={!customTitle.trim() || quickCreating}
              onClick={() => void handleQuickCreate()}
              className="font-semibold"
            >
              {!quickCreating && <Sparkles className="size-4" />}
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
          {quickError && <Alert variant="danger" title="创建空白工坊失败" className="mx-auto max-w-sm text-left">{quickError}</Alert>}
          <div className="pt-2">
            <Button
              variant="accent"
              loading={quickCreating}
              disabled={quickCreating}
              onClick={() => void handleBlankCreate()}
              className="font-semibold"
            >
              {!quickCreating && <ArrowRight className="size-4" />}
              <span>直接开启空白工坊</span>
            </Button>
          </div>
        </section>
      )}
    </PageContainer>
  );
}
