'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useMemo, useEffect } from 'react';
import { Pagination } from '@/app/components/ui/pagination';
import { getPagination, positiveInteger } from '@/app/lib/pagination';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Lightbulb, Plus, Compass, ArrowRight } from 'lucide-react';
import type { StoryProjectType } from '@sthstart/contracts';
import { storyApi } from './api';
import { useStoryProjects } from './queries';
import { projectKeys, storyKeys } from '@/app/lib/query-keys';
import { Button } from '@/app/components/ui/button';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { Input } from '@/app/components/ui/input';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EmptyState } from '@/app/components/ui/empty-state';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageTabs } from '@/app/components/ui/page-tabs';

type FilterType = 'all' | StoryProjectType;

export function StoryProjectList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '';
  const resourcesHref = searchParams.get('from') === 'resources'
    ? (/^\/apps\/resources(?:[?#]|$)/.test(returnTo) && !/[\\\u0000-\u0020]/.test(returnTo) ? returnTo : '/apps/resources')
    : null;
  const queryClient = useQueryClient();
  const projects = useStoryProjects();

  const urlType = searchParams?.get('type');
  const activeTypeTab: FilterType = urlType === 'reflection' || urlType === 'fiction' ? urlType : 'all';
  const keyword = searchParams.get('q') || '';
  const sort = searchParams.get('sort') === 'title' ? 'title' : 'updated';
  const page = positiveInteger(searchParams.get('page'));
  const pageSize = [20, 50, 100].includes(Number(searchParams.get('pageSize'))) ? Number(searchParams.get('pageSize')) : 20;
  const updateList = (patch: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) params.set(key, String(value));
    router.push('/apps/story?' + params, {scroll: false});
  };

  const [title, setTitle] = useState('');
  const [workId, setWorkId] = useState('');
  const [projectType, setProjectType] = useState<StoryProjectType>(
    activeTypeTab !== 'all' ? activeTypeTab : 'fiction'
  );
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const create = useMutation({
    mutationFn: () => storyApi.createProject(title.trim(), '', workId.trim() || undefined, projectType),
    onSuccess: async (created) => {
      setCreateOpen(false);
      setTitle('');
      setWorkId('');
      setProjectType(activeTypeTab !== 'all' ? activeTypeTab : 'fiction');
      setError('');
      await queryClient.invalidateQueries({ queryKey: storyKeys.projects() });
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      // 新建后前往项目概览页
      router.push(created.projectType === 'reflection' ? `/apps/story/${created.id}` : `/apps/projects/${created.id}`);
    },
    onError: (cause) => setError(cause.message),
  });

  const handleOpenCreate = (targetType?: StoryProjectType) => {
    setError('');
    setProjectType(targetType ?? (activeTypeTab !== 'all' ? activeTypeTab : 'fiction'));
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (create.isPending) return;
    if (title.trim() || workId.trim()) {
      setDiscardOpen(true);
      return;
    }
    setCreateOpen(false);
    setError('');
    setProjectType(activeTypeTab !== 'all' ? activeTypeTab : 'fiction');
  };

  const submitCreate = () => {
    if (title.trim() && !create.isPending) create.mutate();
  };

  const handleTabChange = (next: string) => {
    const valid = next === 'all' || next === 'fiction' || next === 'reflection' ? (next as FilterType) : 'all';
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (valid === 'all') params.delete('type');
    else params.set('type', valid);
    params.set('page', '1');
    router.replace(`/apps/story${params.size ? `?${params.toString()}` : ''}`, { scroll: false });
  };

  const filteredItems = useMemo(() => {
    const items = projects.data?.items ?? [];
    return items.filter(item => (activeTypeTab === 'all' || item.projectType === activeTypeTab) && `${item.title} ${item.summary} ${item.workId || ''}`.toLowerCase().includes(keyword.trim().toLowerCase()))
      .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
  }, [projects.data?.items, activeTypeTab, keyword, sort]);
  const pagination = getPagination(filteredItems.length, page, pageSize);
  const pageItems = filteredItems.slice(pagination.start ? pagination.start - 1 : 0, pagination.end);
  useEffect(() => {
    if (!projects.data || projects.isFetching || page === pagination.page) return;
    const params = new URLSearchParams(searchParams.toString()); params.set('page', String(pagination.page));
    router.replace('/apps/story?' + params, {scroll: false});
  }, [projects.data, projects.isFetching, page, pagination.page, searchParams, router]);

  const headerTitle = activeTypeTab === 'reflection'
    ? '对话感想记录'
    : activeTypeTab === 'fiction'
    ? '剧情创作工程'
    : '剧情与记录工作室';

  return (
    <div className="min-h-0 w-full bg-paper py-6 text-ink">
      <PageContainer className="space-y-5">
        {resourcesHref && <Link href={resourcesHref} className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink">返回资料库</Link>}
        <PageHeader
          compact
          title={headerTitle}
          description="整理剧情创作与对话感想项目。"
          navigation={
            <PageTabs
              variant="local"
              ariaLabel="项目类型筛选"
              value={activeTypeTab}
              tabs={[
                { id: 'all', label: '全部项目' },
                { id: 'fiction', label: '剧情创作' },
                { id: 'reflection', label: '对话感想' },
              ]}
              onChange={handleTabChange}
            />
          }
          actions={
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleOpenCreate()}
              className="gap-1.5"
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>{activeTypeTab === 'reflection' ? '新建感想记录' : '新建项目'}</span>
            </Button>
          }
        />

        {projects.error && (
          <p role="alert" className="text-sm text-danger-fg">
            {projects.error.message}
            <Button variant="outline" size="sm" disabled={projects.isFetching} onClick={() => void projects.refetch()}>重新加载</Button>
          </p>
        )}

        {/* Project Continuous Row List */}
        <div className="flex flex-wrap gap-2">
          <Input aria-label="搜索全部剧情项目" placeholder="搜索标题、简介或作品" value={keyword} onChange={e => updateList({q: e.target.value, page: 1})} />
          <select aria-label="项目排序" value={sort} onChange={e => updateList({sort: e.target.value, page: 1})}><option value="updated">最近更新</option><option value="title">标题</option></select>
        </div>
        {projects.isLoading ? (
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center gap-3 py-3.5 sm:py-4">
                <Skeleton className="h-8 w-8 rounded-control flex-none" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-20 flex-none" />
              </div>
            ))}
          </div>
        ) : projects.isError && !projects.data ? null : filteredItems.length === 0 ? (
          <EmptyState
            icon={Compass}
            title={keyword.trim() ? '没有匹配的项目' : activeTypeTab === 'reflection' ? '暂无对话感想记录' : activeTypeTab === 'fiction' ? '暂无剧情创作工程' : '暂无剧情项目'}
            description={keyword.trim() ? '请修改或清空搜索关键词。' : '从结构化小说大纲或对话感想记录开始，支持 AI 辅助构思与标准 MCP 协议协作。'}
            actions={
              <div className="flex flex-wrap items-center justify-center gap-3">
                {(activeTypeTab === 'all' || activeTypeTab === 'fiction') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 text-sm"
                    onClick={() => handleOpenCreate('fiction')}
                  >
                    <BookOpen className="size-4 text-muted" aria-hidden="true" />
                    <span>新建剧情创作工程</span>
                  </Button>
                )}
                {(activeTypeTab === 'all' || activeTypeTab === 'reflection') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-2 text-sm"
                    onClick={() => handleOpenCreate('reflection')}
                  >
                    <Lightbulb className="size-4 text-muted" aria-hidden="true" />
                    <span>新建对话感想记录</span>
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-y border-border-subtle">
            {pageItems.map((item) => {
              const isReflection = item.projectType === 'reflection';
              return (
                <li key={item.id}>
                  <Link
                    href={isReflection ? `/apps/story/${item.id}` : `/apps/projects/${item.id}`}
                    className="group flex min-w-0 items-start justify-between gap-3 py-3 transition-colors hover:bg-surface-hover sm:items-center sm:py-4"
                  >
                    <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-control bg-surface-sunken text-muted group-hover:text-ink transition-colors mt-0.5 sm:mt-0">
                        {isReflection ? (
                          <Lightbulb className="size-4 text-muted" aria-hidden="true" />
                        ) : (
                          <BookOpen className="size-4 text-muted" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm sm:text-base font-semibold tracking-tight text-ink transition-colors group-hover:text-accent">
                            {item.title}
                          </span>
                          <span className="shrink-0 text-xs font-normal text-fg-subtle">
                            {isReflection ? '对话感想' : '剧情创作'}
                          </span>
                          {item.workId && (
                            <span className="hidden shrink-0 text-xs font-mono text-muted sm:inline">
                              {item.workId}
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-1 text-xs text-muted">
                          {item.summary || (isReflection ? '暂无感想记录描述' : '尚未填写项目简介')}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                      <span className="hidden tabular-nums sm:inline">更新于 {new Date(item.updatedAt).toLocaleDateString('zh-CN')}</span>
                      <span className="flex items-center gap-1 font-medium transition-colors group-hover:text-accent">
                        <span className="hidden sm:inline">项目概览</span>
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Pagination total={filteredItems.length} page={pagination.page} pageSize={pageSize} loading={projects.isFetching} onPageChange={page => updateList({page})} onPageSizeChange={pageSize => updateList({pageSize, page: 1})} />
        <ResponsiveEditOverlay
          open={createOpen}
          onOpenChange={(open) => {
            if (!open) closeCreate();
          }}
          title={projectType === 'reflection' ? '新建对话感想记录' : '新建剧情创作工程'}
          description="选择项目类型以适配最合适的工作台布局与协作模式。"
          footer={
            <>
              <Button type="button" variant="outline" onClick={closeCreate} disabled={create.isPending}>
                取消
              </Button>
              <Button
                type="submit"
                variant="primary"
                form="story-create-project"
                disabled={!title.trim() || create.isPending}
                loading={create.isPending}
              >
                创建项目
              </Button>
            </>
          }
        >
          <form
            id="story-create-project"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitCreate();
            }}
          >
            <div>
              <label className="block text-sm font-medium text-ink mb-2">项目类型</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setProjectType('fiction')}
                  className={`flex flex-col items-start rounded-control border p-3 text-left text-sm transition-colors ${
                    projectType === 'fiction'
                      ? 'border-accent bg-accent/5 shadow-xs'
                      : 'border-border-default bg-surface hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <BookOpen className="size-4 text-muted" aria-hidden="true" />
                    <span className="font-semibold text-sm text-ink">剧情创作</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    小说章节、大纲、世界观与角色设定，串联制作版本。
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setProjectType('reflection')}
                  className={`flex flex-col items-start rounded-control border p-3 text-left text-sm transition-colors ${
                    projectType === 'reflection'
                      ? 'border-accent bg-accent/5 shadow-xs'
                      : 'border-border-default bg-surface hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Lightbulb className="size-4 text-muted" aria-hidden="true" />
                    <span className="font-semibold text-sm text-ink">对话感想</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    记录与角色聊天、剧情体验后的随笔、复盘与灵感摘录。
                  </p>
                </button>
              </div>
            </div>

            <label className="block space-y-1.5 text-sm font-medium text-ink">
              <span>{projectType === 'reflection' ? '记录册名称' : '项目名称'}</span>
              <Input
                aria-label="项目名称"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={projectType === 'reflection' ? '例如：芙宁娜日常对话随感' : '例如：枫丹雨夜篇章'}
                className="text-base sm:text-sm"
                autoFocus
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium text-ink">
              <span>所属作品（选填）</span>
              <Input
                aria-label="所属作品"
                value={workId}
                onChange={(event) => setWorkId(event.target.value)}
                placeholder="例如：原神"
                className="text-base sm:text-sm"
              />
            </label>
            {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
          </form>
        </ResponsiveEditOverlay>

        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title="放弃未保存的新建项目？"
          description="关闭后已填写的名称与作品信息不会保留。"
          confirmLabel="放弃填写"
          danger
          onConfirm={() => {
            setDiscardOpen(false);
            setCreateOpen(false);
            setTitle('');
            setWorkId('');
            setProjectType(activeTypeTab !== 'all' ? activeTypeTab : 'fiction');
            setError('');
          }}
        />
      </PageContainer>
    </div>
  );
}
