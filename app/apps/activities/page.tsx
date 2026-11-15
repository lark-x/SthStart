'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Menu } from '@mantine/core';
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
  X,
} from 'lucide-react';
import { useActivityPage } from '@/app/features/activities/use-activity-page';
import { Pagination } from '@/app/components/ui/pagination';
import { positiveInteger } from '@/app/lib/pagination';
import { useDeleteActivity, useDuplicateActivity, useUpdateActivity } from '@/app/features/activities/mutations/activities';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { Input } from '@/app/components/ui/input';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Skeleton } from '@/app/components/ui/skeleton';
import { Alert } from '@/app/components/ui/alert';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import { EmptyState } from '@/app/components/ui/empty-state';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Spinner } from '@/app/components/ui/spinner';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { useOverlayPortalTarget } from '@/app/components/ui/overlay-policy';
import { ActivityImportModal } from '@/app/features/activities/components/activity-import-modal';
import type { Activity } from '@sthstart/contracts';

const activityDateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });

/** 列表用相对时间表达「上次改动」，精确日期放在 title 与桌面端更新列里。 */
function formatActivityUpdated(iso: string): { label: string; title: string } {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return { label: '时间未知', title: '更新时间未知' };
  const exact = activityDateFormat.format(time);
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return { label: '今天更新', title: exact };
  if (days === 1) return { label: '昨天更新', title: exact };
  if (days < 30) return { label: `${days} 天前更新`, title: exact };
  return { label: `${exact} 更新`, title: exact };
}

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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const portalHost = useOverlayPortalTarget();


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

  /** 失败时抛出，让确认框保持打开；错误同时留在页面内。 */
  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除制作项目失败');
      throw err;
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
          compact
          title="制作项目"
          description="管理配音、画面与互动演出制作版本。"
          actions={
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <Link
                href="/apps/activities/new"
                className={buttonVariants({ variant: 'primary', size: 'sm' })}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>新建制作</span>
              </Link>

              <Menu
                position="bottom-end"
                withinPortal
                portalProps={portalHost ? { target: portalHost } : undefined}
                closeOnItemClick
                returnFocus
                transitionProps={{ duration: 100 }}
                shadow="md"
                radius="md"
              >
                <Menu.Target>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="更多活动工具"
                    className="h-9 min-h-0 px-2.5 text-muted hover:text-ink"
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown aria-label="更多活动工具" className="ui-row-menu w-44">
                  <Menu.Item
                    component={Link}
                    href="/apps/projects"
                    leftSection={<ArrowRight className="size-3.5 rotate-180 text-muted" aria-hidden="true" />}
                  >
                    返回项目列表
                  </Menu.Item>
                  <Menu.Item
                    onClick={() => setImportModalOpen(true)}
                    leftSection={<FolderDown className="size-3.5 text-muted" aria-hidden="true" />}
                  >
                    导入制作
                  </Menu.Item>
                  <Menu.Item
                    component={Link}
                    href="/apps/inspiration"
                    leftSection={<Lightbulb className="size-3.5 text-muted" aria-hidden="true" />}
                  >
                    从话题找灵感
                  </Menu.Item>
                  <Menu.Item
                    component={Link}
                    href="/apps/calendar"
                    leftSection={<CalendarDays className="size-3.5 text-muted" aria-hidden="true" />}
                  >
                    角色日历
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>
          }
        />

        {error && !data && (
          <Alert variant="danger" title="制作项目列表加载失败">
            {error instanceof Error ? error.message : String(error)}
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => { void refetch(); }}>重试读取</Button>
          </Alert>
        )}

        {error && data && (
          <Alert variant="danger" title="列表更新失败，当前仍显示上次读取结果">
            {error instanceof Error ? error.message : String(error)}
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => { void refetch(); }}>重新读取</Button>
          </Alert>
        )}

        {actionError && (
          <Alert variant="danger" title="操作失败">
            {actionError}
          </Alert>
        )}

        {/* Filter Toolbar */}
        <div className="flex flex-col justify-between gap-3 rounded-panel bg-surface p-3 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={searchDraft}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={e => {setComposing(false); setSearchDraft(e.currentTarget.value);}}
              onChange={(e) => setSearchDraft(e.target.value)}
              maxLength={500}
              aria-label="搜索制作项目"
              placeholder="搜索制作项目标题、主题或类型…"
              className="h-9 border-border-control pl-9 pr-9 text-base sm:text-sm"
            />
            {searchDraft && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="清空搜索"
                className="absolute right-1 top-1/2 size-7 min-h-0 -translate-y-1/2 p-0 text-muted hover:text-ink"
                onClick={() => { setSearchDraft(''); updateList({ q: '', page: 1 }); }}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 w-full sm:w-auto sm:justify-end">
            <PageTabs
              ariaLabel="制作项目状态筛选"
              variant="local"
              value={showArchived ? 'archived' : 'active'}
              onChange={value => setShowArchived(value === 'archived')}
              tabs={[
                { id: 'active', label: '活跃活动' },
                { id: 'archived', label: '已归档' },
              ]}
            />

            <span className="flex-shrink-0 text-xs font-medium text-muted tabular-nums" aria-live="polite">
              {data ? `共 ${data.total} 个制作项目` : '正在读取数量…'}
            </span>
          </div>
        </div>

        {/* Activity Continuous Row List */}
        {(isFetching || searchDraft !== search) && (
          <Spinner size="sm" label={searchDraft !== search ? '正在搜索…' : '正在更新列表…'} className="text-xs" />
        )}
        {error && !data ? null : isLoading ? (
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
            icon={search ? Search : Compass}
            title={
              search
                ? `没有匹配「${search}」的制作项目`
                : showArchived
                  ? '暂无已归档制作项目'
                  : '暂无制作项目'
            }
            description={
              search
                ? '搜索范围包括标题、主题、类型与地点。换一个关键词，或清空搜索查看全部制作项目。'
                : showArchived
                  ? '归档后的制作项目会保留在这里，可随时恢复为活跃项目。'
                  : '支持从创作项目章节直接创建制作版本，或选用角色与模板快速建立独立制作工程。'
            }
            actions={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {search ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setSearchDraft(''); updateList({ q: '', page: 1 }); }}
                  >
                    清空搜索
                  </Button>
                ) : (
                  !showArchived && (
                    <>
                      <Link
                        href="/apps/projects"
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        <span>返回创作项目</span>
                      </Link>
                      <Link
                        href="/apps/activities/new"
                        className={buttonVariants({ variant: 'primary', size: 'sm' })}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        <span>新建制作工程</span>
                      </Link>
                    </>
                  )
                )}
                {showArchived && !search && (
                  <Link
                    href="/apps/activities"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <span>查看活跃制作项目</span>
                  </Link>
                )}
              </div>
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-y border-border-subtle">
            {filtered.map((act) => {
              const updated = formatActivityUpdated(act.updatedAt);
              return (
              <li
                key={act.id}
                className="group -mx-2 flex min-w-0 items-start gap-2.5 rounded-control px-2 py-3 transition-colors hover:bg-surface-hover sm:items-center sm:gap-4 sm:py-4"
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                  <span
                    data-tone={act.type === 'publication' ? 'violet' : 'blue'}
                    className="mt-0.5 hidden h-8 w-8 flex-none items-center justify-center rounded-control bg-tone-soft text-tone-fg transition-transform group-hover:-translate-y-0.5 sm:mt-0 sm:flex"
                  >
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
                      <Badge variant="secondary" className="shrink-0 font-mono tabular-nums">
                        v{act.headVersion}
                      </Badge>
                      <Badge
                        variant={act.type === 'publication' ? 'accent' : 'outline'}
                        className="shrink-0 text-xs"
                      >
                        {act.type === 'publication' ? '配音/画面制作' : act.type || '互动演出'}
                      </Badge>
                      {act.archived && (
                        <Badge variant="stopped" className="shrink-0 text-xs">
                          已归档
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted">
                      <time className="shrink-0" dateTime={act.updatedAt} title={updated.title}>
                        {updated.label}
                      </time>
                      {/* 分隔点与它后面的内容同生同灭，窄屏隐藏内容时不留下孤立的「·」。 */}
                      {act.theme && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{act.theme}</span>
                        </>
                      )}
                      {act.location && (
                        <>
                          <span aria-hidden="true" className="hidden sm:inline">·</span>
                          <span className="hidden truncate sm:inline">{act.location}</span>
                        </>
                      )}
                      {act.rules && (
                        <>
                          <span aria-hidden="true" className="hidden md:inline">·</span>
                          <span className="hidden min-w-0 truncate md:inline">{act.rules}</span>
                        </>
                      )}
                    </div>
                    {act.location && (
                      <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted sm:hidden">
                        <Calendar className="size-3 shrink-0 text-muted" aria-hidden="true" />
                        <span className="truncate">{act.location}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-1 self-center sm:gap-2">
                  <div className="hidden items-center gap-2 md:flex">
                    <Link
                      href={`/apps/activities/${act.id}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      <span>{act.type === 'publication' ? '进入制作台' : '进入工作室'}</span>
                      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </div>
                  <RowActionsMenu label={`管理制作项目 ${act.title}`} items={[
                    { label: '复制副本', icon: <Copy className="size-4" />, onSelect: () => { void handleDuplicate(act.id); } },
                    { label: act.archived ? '恢复制作项目' : '归档制作项目', icon: act.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />, onSelect: () => { void handleToggleArchive(act); } },
                    { label: '删除制作项目', icon: <Trash2 className="size-4" />, tone: 'danger', separatorBefore: true, onSelect: () => setPendingDelete({ id: act.id, title: act.title }) },
                  ]} />
                </div>
              </li>
              );
            })}
          </ul>
        )}

        <Pagination total={data?.total ?? 0} page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} loading={isFetching || searchDraft !== search} onPageChange={page => updateList({page})} onPageSizeChange={pageSize => updateList({pageSize, page: 1})} />
        <ActivityImportModal
          open={importModalOpen}
          onOpenChange={setImportModalOpen}
        />
        <ConfirmDialog
          open={Boolean(pendingDelete)}
          onOpenChange={open => { if (!open) setPendingDelete(null); }}
          title="彻底删除制作项目？"
          description={
            pendingDelete
              ? `《${pendingDelete.title}》的草稿、分镜、生成记录与制作版本都会一并删除，此操作无法撤销。若只是暂时不用，可以改为归档。`
              : undefined
          }
          confirmLabel="彻底删除"
          danger
          onConfirm={async () => {
            if (!pendingDelete) return;
            await handleDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      </PageContainer>
    </div>
  );
}
