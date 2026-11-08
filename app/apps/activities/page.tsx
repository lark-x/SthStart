'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  FolderDown,
  Copy,
  Archive,
  ArchiveRestore,
  Trash2,
  Calendar,
  Compass,
    CalendarDays,
  Lightbulb,
  MoreHorizontal,
  ArrowRight,
  Film,
} from 'lucide-react';
import { useActivityPage } from '@/app/features/activities/use-activity-page';
import { Pagination } from '@/app/components/ui/pagination';
import { positiveInteger } from '@/app/lib/pagination';
import {
  useDeleteActivity,
  useDuplicateActivity,
  useUpdateActivity,
} from '@/app/features/activities/mutations';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Skeleton } from '@/app/components/ui/skeleton';
import { Alert } from '@/app/components/ui/alert';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import { EmptyState } from '@/app/components/ui/empty-state';
import { ActivityImportModal } from '@/app/features/activities/components/activity-import-modal';
import type { Activity } from '@sthstart/contracts';

export default function ActivitiesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const search = params.get('q') || '';
  const [searchDraft, setSearchDraft] = useState(search);
  const [previousSearch, setPreviousSearch] = useState(search);
  const [composing, setComposing] = useState(false);
  if (previousSearch !== search) { setPreviousSearch(search); setSearchDraft(search); }
  const showArchived = params.get('archived') === 'true';
  const page = positiveInteger(params.get('page'));
  const pageSize = [20, 50, 100].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 20;
  const updateList = (patch: Record<string, string | number | boolean>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) next.set(key, String(value));
    router.push('/apps/activities?' + next, {scroll: false});
  };
  useEffect(() => {
    if (composing || searchDraft === search) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString()); next.set('q', searchDraft); next.set('page', '1');
      router.push('/apps/activities?' + next, {scroll: false});
    }, 250);
    return () => clearTimeout(timer);
  }, [composing, searchDraft, search, params, router]);
  const setShowArchived = (archived: boolean) => updateList({archived, page: 1});
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);


  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useActivityPage({q: search, archived: showArchived, page, pageSize});

  const deleteMutation = useDeleteActivity();
  const duplicateMutation = useDuplicateActivity();
  const updateMutation = useUpdateActivity();

  const filtered = data?.items ?? [];
  useEffect(() => {
    if (data && !isPlaceholderData && data.page !== page) {
      const next = new URLSearchParams(params.toString()); next.set('page', String(data.page));
      router.replace('/apps/activities?' + next, {scroll: false});
    }
  }, [data, isPlaceholderData, page, params, router]);

  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const element = moreMenuRef.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.isComposing || event.keyCode === 229 || event.key !== 'Escape') return;
        element.open = false;
        element.querySelector('summary')?.focus();
      } else if (!element.contains(event.target as Node)) {
        element.open = false;
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, []);

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`确定要彻底删除制作项目《${title}》吗？此操作无法撤销。`)) return;
    setActionError(null);
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除制作项目失败');
    }
  };

  const handleDuplicate = async (id: string) => {
    setActionError(null);
    try {
      const res = await duplicateMutation.mutateAsync({ id });
      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '复制制作项目失败');
    }
  };

  const handleToggleArchive = async (act: Activity) => {
    setActionError(null);
    try {
      await updateMutation.mutateAsync({
        id: act.id,
        expectedHeadVersion: act.headVersion,
        patch: { archived: !act.archived },
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '归档操作失败');
    }
  };

  return (
    <div className="w-full bg-paper text-ink py-6">
      <PageContainer className="space-y-5">
        <PageHeader
          title="制作项目"
          description="管理配音与画面制作版本及互动演出工程。支持从创作项目正文派生制作，亦可直接开展独立制作；支持随时返回项目列表。"
          actions={
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <Link
                href="/apps/projects"
                className="inline-flex h-9 items-center gap-1.5 rounded-control border border-border-default bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-accent"
              >
                <span>返回项目列表</span>
              </Link>

              <Link
                href="/apps/activities/new"
                className="inline-flex h-9 items-center gap-1.5 rounded-control bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-accent-dark focus-visible:outline focus-visible:outline-accent"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>新建制作</span>
              </Link>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportModalOpen(true)}
                className="gap-1.5 text-sm font-medium"
              >
                <FolderDown className="h-4 w-4 text-muted" aria-hidden="true" />
                <span className="hidden sm:inline">导入制作</span>
                <span className="sm:hidden">导入</span>
              </Button>

              <details ref={moreMenuRef} className="relative">
                <summary
                  aria-label="更多活动工具"
                  className="flex h-9 cursor-pointer list-none items-center justify-center gap-1 rounded-control border border-border-default bg-surface px-2.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-accent"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </summary>
                <div
                  role="menu"
                  aria-label="更多活动工具"
                  className="absolute right-0 top-full z-30 mt-1.5 flex w-44 flex-col gap-0.5 rounded-control border border-border-subtle bg-surface p-1 shadow-floating"
                >
                  <Link
                    href="/apps/inspiration"
                    role="menuitem"
                    className="flex items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-2 text-sm text-ink transition-colors hover:bg-surface-hover"
                    onClick={() => { if (moreMenuRef.current) moreMenuRef.current.open = false; }}
                  >
                    <Lightbulb className="size-3.5 text-muted" aria-hidden="true" />
                    <span>从话题找灵感</span>
                  </Link>
                  <Link
                    href="/apps/calendar"
                    role="menuitem"
                    className="flex items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-2 text-sm text-ink transition-colors hover:bg-surface-hover"
                    onClick={() => { if (moreMenuRef.current) moreMenuRef.current.open = false; }}
                  >
                    <CalendarDays className="size-3.5 text-muted" aria-hidden="true" />
                    <span>角色日历</span>
                  </Link>
                </div>
              </details>
            </div>
          }
        />

        {error && (
          <Alert variant="danger" title="制作项目列表加载失败">
            {error instanceof Error ? error.message : String(error)}
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => { void refetch(); }}>重试读取</Button>
          </Alert>
        )}

        {actionError && (
          <Alert variant="danger" title="操作失败">
            {actionError}
          </Alert>
        )}

        {/* Filter Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1">
          <div className="relative w-full sm:max-w-md">
            <Search className="h-4 w-4 absolute left-3.5 top-3 text-muted" />
            <Input
              value={searchDraft}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={e => {setComposing(false); setSearchDraft(e.currentTarget.value);}}
              onChange={(e) => setSearchDraft(e.target.value)}
              maxLength={500}
              aria-label="搜索制作项目"
              placeholder="搜索制作项目标题、主题或类型…"
              className="pl-9 h-10 border-border-control text-base sm:text-sm"
            />
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-1 bg-surface-sunken p-1 rounded-control border border-border-subtle/70" role="group" aria-label="制作项目状态筛选">
              <button
                type="button"
                aria-pressed={!showArchived}
                onClick={() => setShowArchived(false)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-[calc(var(--radius-control)-2px)] transition-colors cursor-pointer ${
                  !showArchived ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink font-normal'
                }`}
              >
                活跃活动
              </button>
              <button
                type="button"
                aria-pressed={showArchived}
                onClick={() => setShowArchived(true)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-[calc(var(--radius-control)-2px)] transition-colors cursor-pointer ${
                  showArchived ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink font-normal'
                }`}
              >
                已归档
              </button>
            </div>

            <span className="text-xs text-muted font-medium flex-shrink-0 tabular-nums">
              共 {data?.total ?? 0} 个制作项目
            </span>
          </div>
        </div>

        {/* Activity Continuous Row List */}
        {(isFetching || searchDraft !== search) && <p role="status">正在更新列表…</p>}
        {error ? null : isLoading ? (
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            {[1, 2, 3, 4].map((n) => (
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
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Compass}
            title={showArchived ? '暂无已归档制作项目' : '暂无制作项目'}
            description="支持从创作项目章节直接创建制作版本，或选用角色与模板快速建立独立制作工程。"
            actions={
              !showArchived && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/apps/projects"
                    className="inline-flex items-center gap-2 rounded-control border border-border-default bg-surface px-4 py-2 text-sm font-medium text-ink shadow-xs transition-colors hover:border-accent hover:text-accent"
                  >
                    <span>返回创作项目</span>
                  </Link>
                  <Link
                    href="/apps/activities/new"
                    className="inline-flex items-center gap-1.5 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-accent-dark"
                  >
                    <Plus className="size-4" />
                    <span>新建制作工程</span>
                  </Link>
                </div>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-y border-border-subtle">
            {filtered.map((act) => (
              <li
                key={act.id}
                className="group flex min-w-0 items-start gap-2.5 py-3 transition-colors hover:bg-surface-hover sm:items-center sm:gap-4 sm:py-4"
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                  <span className="mt-0.5 hidden h-8 w-8 flex-none items-center justify-center rounded-control bg-surface-sunken text-muted transition-colors group-hover:text-ink sm:mt-0 sm:flex">
                    <Film className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/apps/activities/${act.id}`}
                        className="min-w-0 truncate text-sm font-semibold tracking-tight text-ink transition-colors hover:text-accent group-hover:text-accent sm:text-base"
                      >
                        {act.title}
                      </Link>
                      <span className="shrink-0 font-mono text-xs text-muted">
                        v{act.headVersion}
                      </span>
                      {act.type === 'publication' ? (
                        <Badge variant="accent" className="shrink-0 text-xs">
                          配音/画面制作
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 text-xs">
                          互动演出{act.type ? ` · ${act.type}` : ''}
                        </Badge>
                      )}
                      {act.archived && (
                        <Badge variant="stopped" className="shrink-0 text-xs">
                          已归档
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted">
                      <time className="shrink-0 tabular-nums">{new Date(act.updatedAt).toLocaleDateString('zh-CN')}</time>
                      {act.type === 'publication' ? <><span aria-hidden="true">·</span><span className="truncate">正式制作版本</span></> : act.type ? <><span aria-hidden="true">·</span><span className="truncate">{act.type}</span></> : null}
                      {act.theme && <><span aria-hidden="true">·</span><span className="truncate">{act.theme}</span></>}
                      {act.location && <><span aria-hidden="true">·</span><span className="hidden truncate sm:inline">{act.location}</span></>}
                      {act.rules && <span className="hidden min-w-0 truncate text-fg-subtle md:inline">{act.rules}</span>}
                    </div>
                    {act.location && (
                      <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted sm:hidden">
                        <Calendar className="size-3 shrink-0 text-muted" aria-hidden="true" />
                        <span className="truncate">{act.location}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-1 self-center sm:gap-2">
                  <div className="hidden items-center gap-2 md:flex">
                    <span className="whitespace-nowrap text-xs text-muted tabular-nums">
                      更新于 {new Date(act.updatedAt).toLocaleDateString('zh-CN')}
                    </span>
                    <Link
                      href={`/apps/activities/${act.id}`}
                      className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-accent group-hover:text-accent"
                    >
                      <span>{act.type === 'publication' ? '进入制作台' : '进入工作室'}</span>
                      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </div>
                  <RowActionsMenu label={`管理制作项目 ${act.title}`} items={[
                    { label: '复制副本', icon: <Copy className="size-4" />, onSelect: () => { void handleDuplicate(act.id); } },
                    { label: act.archived ? '恢复制作项目' : '归档制作项目', icon: act.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />, onSelect: () => { void handleToggleArchive(act); } },
                    { label: '删除制作项目', icon: <Trash2 className="size-4" />, tone: 'danger', separatorBefore: true, onSelect: () => { void handleDelete(act.id, act.title); } },
                  ]} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <Pagination total={data?.total ?? 0} page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} loading={isFetching || searchDraft !== search} onPageChange={page => updateList({page})} onPageSizeChange={pageSize => updateList({pageSize, page: 1})} />
        <ActivityImportModal
          open={importModalOpen}
          onOpenChange={setImportModalOpen}
        />
      </PageContainer>
    </div>
  );
}
