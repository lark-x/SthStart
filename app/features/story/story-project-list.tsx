'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Compass, Lightbulb, Plus } from 'lucide-react';
import type { StoryProjectType } from '@sthstart/contracts';
import { storyApi } from './api';
import { useStoryProjects } from './queries';
// Projects owns this key. Story reaches it through the documented pure re-export
// so the Story module keeps its one-way dependency on the projects feature.
import { projectKeys } from '@/app/lib/query-keys';
import { storyKeys } from '@/app/features/story/query-keys';
import { getPagination } from '@/app/lib/pagination';
import { Button } from '@/app/components/ui/button';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EmptyState } from '@/app/components/ui/empty-state';
import { AsyncState } from '@/app/components/ui/async-state';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { FormField } from '@/app/components/ui/form-field';
import { Pagination } from '@/app/components/ui/pagination';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { StoryProjectTypeChoice } from './components/story-project-type-choice';
import {
  readStoryListState, storyListHref, storyProjectHref, type StoryListState,
} from './model/story-list-state';

function StorySearch({
  value,
  onSearch,
}: {
  value: string;
  onSearch: (value: string) => void;
}) {
  const [input, setInput] = useState({ source: value, draft: value });
  if (input.source !== value) setInput({ source: value, draft: value });
  const draft = input.source === value ? input.draft : value;
  const setDraft = (next: string) => setInput({ source: value, draft: next });
  const [composing, setComposing] = useState(false);
  const callback = useRef(onSearch);
  useEffect(() => { callback.current = onSearch; }, [onSearch]);
  useEffect(() => {
    if (composing || draft.trim() === value) return;
    const timer = setTimeout(() => callback.current(draft.trim()), 350);
    return () => clearTimeout(timer);
  }, [draft, value, composing]);
  return (
    <div className="flex w-full max-w-sm items-center gap-2">
      <Input
        aria-label="搜索全部剧情项目"
        placeholder="搜索标题、简介或作品"
        value={draft}
        maxLength={200}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onChange={(event) => setDraft(event.target.value)}
      />
      {draft && (
        <Button size="sm" variant="ghost" onClick={() => { setDraft(''); callback.current(''); }}>
          清空
        </Button>
      )}
    </div>
  );
}

export function StoryProjectList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const state = useMemo(() => readStoryListState(searchParams), [searchParams]);
  const projects = useStoryProjects();

  const returnTo = searchParams.get('returnTo') || '';
  const resourcesHref = searchParams.get('from') === 'resources'
    ? (/^\/apps\/resources(?:[?#]|$)/.test(returnTo) && !/[\\\u0000-\u0020]/.test(returnTo) ? returnTo : '/apps/resources')
    : null;
  const listHref = storyListHref(state, searchParams.toString());

  const updateList = (patch: Partial<StoryListState>) => {
    const next = { ...state, ...patch };
    if ('q' in patch || 'sort' in patch || 'pageSize' in patch || 'type' in patch) next.page = 1;
    router.push(storyListHref(next, searchParams.toString()), { scroll: false });
  };

  const [title, setTitle] = useState('');
  const [workId, setWorkId] = useState('');
  const [projectType, setProjectType] = useState<StoryProjectType>(
    state.type !== 'all' ? state.type : 'fiction',
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
      setProjectType(state.type !== 'all' ? state.type : 'fiction');
      setError('');
      await queryClient.invalidateQueries({ queryKey: storyKeys.projects() });
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      router.push(created.projectType === 'reflection'
        ? `/apps/story/${created.id}?returnTo=${encodeURIComponent(listHref)}`
        : `/apps/projects/${created.id}?returnTo=${encodeURIComponent(listHref)}`);
    },
    onError: (cause) => setError(cause.message),
  });

  const handleOpenCreate = (targetType?: StoryProjectType) => {
    setError('');
    setProjectType(targetType ?? (state.type !== 'all' ? state.type : 'fiction'));
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
    setProjectType(state.type !== 'all' ? state.type : 'fiction');
  };

  const submitCreate = () => {
    if (title.trim() && !create.isPending) create.mutate();
  };

  const handleTabChange = (next: string) => {
    const valid = next === 'all' || next === 'fiction' || next === 'reflection' ? next : 'all';
    updateList({ type: valid });
  };

  const filteredItems = useMemo(() => {
    const items = projects.data?.items ?? [];
    const needle = state.q.trim().toLowerCase();
    return items
      .filter((item) => (state.type === 'all' || item.projectType === state.type)
        && `${item.title} ${item.summary} ${item.workId || ''}`.toLowerCase().includes(needle))
      .sort((a, b) => (state.sort === 'title'
        ? a.title.localeCompare(b.title)
        : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
  }, [projects.data?.items, state.q, state.sort, state.type]);
  const pagination = getPagination(filteredItems.length, state.page, state.pageSize);
  const pageItems = filteredItems.slice(pagination.start ? pagination.start - 1 : 0, pagination.end);
  useEffect(() => {
    if (!projects.data || projects.isFetching || state.page === pagination.page) return;
    router.replace(storyListHref({ ...state, page: pagination.page }, searchParams.toString()), { scroll: false });
  }, [projects.data, projects.isFetching, pagination.page, router, searchParams, state]);

  const headerTitle = state.type === 'reflection'
    ? '对话感想记录'
    : state.type === 'fiction'
      ? '剧情创作工程'
      : '剧情与记录工作室';

  return (
    <div className="min-h-0 w-full bg-paper py-6 text-ink">
      <PageContainer className="space-y-5">
        {resourcesHref && (
          <Link href={resourcesHref} className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink">
            返回资料库
          </Link>
        )}
        <PageHeader
          compact
          title={headerTitle}
          description="整理剧情创作与对话感想项目。"
          navigation={
            <PageTabs
              variant="local"
              ariaLabel="项目类型筛选"
              value={state.type}
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
              <span>{state.type === 'reflection' ? '新建感想记录' : '新建项目'}</span>
            </Button>
          }
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center min-w-0 flex-1">
            <StorySearch value={state.q} onSearch={(q) => updateList({ q })} />
            <Select
              aria-label="项目排序"
              className="w-full sm:w-auto sm:min-w-36"
              value={state.sort}
              onChange={(event) => updateList({ sort: event.target.value === 'title' ? 'title' : 'updated' })}
            >
              <option value="updated">最近更新</option>
              <option value="title">标题顺序</option>
            </Select>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={projects.isFetching}
            onClick={() => void projects.refetch()}
            className="shrink-0 self-end sm:self-auto"
          >
            刷新列表
          </Button>
        </div>

        {projects.isError && !projects.data && (
          <AsyncState
            status="error"
            title="剧情项目加载失败"
            description={projects.error.message}
            onRetry={() => void projects.refetch()}
          />
        )}
        {projects.isError && projects.data && (
          <Alert variant="danger" title="项目列表更新失败">
            {projects.error.message}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void projects.refetch()}>重试</Button>
          </Alert>
        )}

        {projects.isLoading ? (
          <div className="divide-y divide-border-subtle border-y border-border-subtle" role="status" aria-label="正在读取剧情项目">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center gap-3 py-3.5 sm:py-4">
                <Skeleton className="h-8 w-8 flex-none rounded-control" />
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
            title={state.q
              ? '没有匹配的项目'
              : state.type === 'reflection'
                ? '暂无对话感想记录'
                : state.type === 'fiction'
                  ? '暂无剧情创作工程'
                  : '暂无剧情项目'}
            description={state.q
              ? '请修改或清空搜索关键词。'
              : '从结构化小说大纲或对话感想记录开始，支持 AI 辅助构思与标准 MCP 协议协作。'}
            actions={
              <div className="flex flex-wrap items-center justify-center gap-3">
                {(state.type === 'all' || state.type === 'fiction') && (
                  <Button variant="outline" size="sm" className="gap-2 text-sm" onClick={() => handleOpenCreate('fiction')}>
                    <BookOpen className="size-4 text-muted" aria-hidden="true" />
                    <span>新建剧情创作工程</span>
                  </Button>
                )}
                {(state.type === 'all' || state.type === 'reflection') && (
                  <Button variant="secondary" size="sm" className="gap-2 text-sm" onClick={() => handleOpenCreate('reflection')}>
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
                    href={storyProjectHref(item.id, isReflection ? 'reflection' : 'fiction', listHref)}
                    className="group flex min-w-0 items-start justify-between gap-3 py-3 transition-colors hover:bg-surface-hover sm:items-center sm:py-4"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-control bg-surface-sunken text-muted transition-colors group-hover:text-ink sm:mt-0">
                        {isReflection
                          ? <Lightbulb className="size-4 text-muted" aria-hidden="true" />
                          : <BookOpen className="size-4 text-muted" aria-hidden="true" />}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold tracking-tight text-ink transition-colors group-hover:text-accent sm:text-base">
                            {item.title}
                          </span>
                          <Badge variant="secondary" className="shrink-0">
                            {isReflection ? '对话感想' : '剧情创作'}
                          </Badge>
                          {item.workId && (
                            <Badge variant="outline" className="hidden shrink-0 font-mono sm:inline-flex">{item.workId}</Badge>
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

        {filteredItems.length > 0 && (
          <Pagination
            total={filteredItems.length}
            page={pagination.page}
            pageSize={state.pageSize}
            loading={projects.isFetching}
            onPageChange={(page) => updateList({ page })}
            onPageSizeChange={(pageSize) => updateList({ pageSize })}
          />
        )}

        <ResponsiveEditOverlay
          open={createOpen}
          onOpenChange={(open) => { if (!open) closeCreate(); }}
          title={projectType === 'reflection' ? '新建对话感想记录' : '新建剧情创作工程'}
          description="选择项目类型以适配最合适的工作台布局与协作模式。"
          footer={
            <>
              <Button type="button" variant="outline" onClick={closeCreate} disabled={create.isPending}>取消</Button>
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
            onSubmit={(event) => { event.preventDefault(); submitCreate(); }}
          >
            <div>
              <p className="mb-2 text-sm font-medium text-ink">项目类型</p>
              <StoryProjectTypeChoice value={projectType} onChange={setProjectType} />
            </div>
            <FormField label={projectType === 'reflection' ? '记录册名称' : '项目名称'} required>
              <Input
                autoFocus
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={projectType === 'reflection' ? '例如：芙宁娜日常对话随感' : '例如：枫丹雨夜篇章'}
                className="text-base sm:text-sm"
              />
            </FormField>
            <FormField
              label="所属作品（选填）"
              hint={projectType === 'reflection' ? '用于归档同一作品的感想记录。' : '用于角色库筛选与项目概览。'}
            >
              <Input
                value={workId}
                onChange={(event) => setWorkId(event.target.value)}
                placeholder="例如：原神"
                className="text-base sm:text-sm"
              />
            </FormField>
            {error && <Alert variant="danger" title="创建失败">{error}</Alert>}
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
            setProjectType(state.type !== 'all' ? state.type : 'fiction');
            setError('');
          }}
        />
      </PageContainer>
    </div>
  );
}
