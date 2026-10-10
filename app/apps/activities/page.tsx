'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  FolderDown,
  Copy,
  Archive,
  ArchiveRestore,
  Trash2,
  Calendar,
  Layers,
  Users,
  Compass,
  Sparkles,
  ExternalLink,
  CalendarDays,
  Lightbulb,
  MoreHorizontal,
  ArrowRight,
} from 'lucide-react';
import { useActivities } from '@/app/features/activities/queries';
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
import { EmptyState } from '@/app/components/ui/empty-state';
import { ActivityImportModal } from '@/app/features/activities/components/activity-import-modal';
import type { Activity } from '@sthstart/contracts';

export default function ActivitiesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const { data, isLoading, error } = useActivities({
    archived: showArchived,
  });

  const deleteMutation = useDeleteActivity();
  const duplicateMutation = useDuplicateActivity();
  const updateMutation = useUpdateActivity();

  const activities = data?.items ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return activities;
    return activities.filter((act) =>
      `${act.title} ${act.theme || ''} ${act.type || ''} ${act.location || ''}`
        .toLowerCase()
        .includes(needle)
    );
  }, [activities, search]);

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`确定要彻底删除活动《${title}》吗？此操作无法撤销。`)) return;
    setActionError(null);
    try {
      await deleteMutation.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除活动失败');
    }
  };

  const handleDuplicate = async (id: string) => {
    setActionError(null);
    try {
      const res = await duplicateMutation.mutateAsync({ id });
      router.push(`/apps/activities/${res.activity.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '复制活动失败');
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
      <PageContainer className="space-y-4">
        <PageHeader
          title="活动工作室"
          description="设定情节阶段、AI 驱动多角色互动，导出可离线渲染的 HyperFrames 视频工程。"
          actions={
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportModalOpen(true)}
              >
                <FolderDown className="h-3.5 w-3.5 text-muted" />
                <span className="hidden sm:inline">导入活动</span>
                <span className="sm:hidden">导入</span>
              </Button>

              <Link
                href="/apps/activities/new"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-white hover:bg-accent-dark font-semibold text-sm transition-colors cursor-pointer shadow-xs shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新建活动</span>
              </Link>
              <Link
                href="/apps/inspiration"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border-default bg-surface font-medium text-sm transition-colors cursor-pointer shrink-0"
                title="先选题材再让模型给出活动点子"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">从话题找灵感</span>
              </Link>
              <Link
                href="/apps/calendar"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border-default bg-surface font-medium text-sm transition-colors cursor-pointer shrink-0"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">角色日历</span>
              </Link>
            </div>
          }
        />

        {error && (
          <Alert variant="danger" title="活动列表加载失败">
            {error instanceof Error ? error.message : String(error)}
          </Alert>
        )}

        {actionError && (
          <Alert variant="danger" title="操作失败">
            {actionError}
          </Alert>
        )}

        {/* Filter Toolbar */}
        <div className="activity-toolbar flex flex-col sm:flex-row items-center justify-between gap-3 py-3 px-4 rounded-[var(--radius-panel)] bg-surface shadow-[var(--shadow-panel)]">
          <div className="relative w-full sm:max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索活动标题、主题、类型或地点…"
              className="pl-9 h-9 border-border-control text-sm"
            />
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-1 bg-surface-muted p-0.5 rounded-[var(--radius-control)]">
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-[var(--radius-control)] transition-colors cursor-pointer ${
                  !showArchived ? 'bg-surface-raised text-ink shadow-xs' : 'text-muted hover:text-ink'
                }`}
              >
                活跃活动
              </button>
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-[var(--radius-control)] transition-colors cursor-pointer ${
                  showArchived ? 'bg-surface-raised text-ink shadow-xs' : 'text-muted hover:text-ink'
                }`}
              >
                已归档
              </button>
            </div>

            <span className="text-xs text-muted font-medium flex-shrink-0">
              共 {filtered.length} 场活动
            </span>
          </div>
        </div>

        {/* Activity Grid */}
        {isLoading ? (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="activity-card-skeleton p-5 rounded-[var(--radius-panel)] bg-surface space-y-3 shadow-[var(--shadow-panel)]"
              >
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Compass}
            title={showArchived ? '暂无已归档活动' : '暂无活动记录'}
            description="选择起步模板快速生成分镜漫剧，或创建全新空白活动工程。"
            actions={
              !showArchived && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/apps/activities/new"
                    className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border-default/80 bg-surface px-4 py-2 text-xs font-semibold text-ink shadow-xs transition-colors hover:border-accent hover:text-accent"
                  >
                    <Sparkles className="size-3.5 text-accent" />
                    <span>四幕分镜漫剧模板</span>
                  </Link>
                  <Link
                    href="/apps/activities/new"
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-accent-dark"
                  >
                    <Plus className="size-3.5" />
                    <span>新建空白活动</span>
                  </Link>
                </div>
              )
            }
          />
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]">
            {filtered.map((act) => (
              <div
                key={act.id}
                onClick={() => router.push(`/apps/activities/${act.id}`)}
                className="activity-card group relative flex min-h-[200px] cursor-pointer flex-col justify-between rounded-[var(--radius-panel)] border border-border-default/60 bg-surface p-5 transition-all duration-150 hover:border-border-default hover:shadow-xs"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/apps/activities/${act.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="line-clamp-2 text-base font-bold text-ink transition-colors group-hover:text-accent"
                    >
                      {act.title}
                    </Link>

                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge variant="secondary" className="font-mono text-xs">
                        v{act.headVersion}
                      </Badge>
                      <div className="relative">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`管理活动 ${act.title}`}
                          className="h-7 w-7 p-0 text-muted hover:text-ink"
                          onClick={() => setActiveMenuId(activeMenuId === act.id ? null : act.id)}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                        {activeMenuId === act.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setActiveMenuId(null)}
                            />
                            <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-[var(--radius-control)] border border-border-default bg-surface p-1 shadow-lg">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-surface-sunken"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void handleDuplicate(act.id);
                                }}
                              >
                                <Copy className="size-3.5 text-muted" />
                                <span>复制副本</span>
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-surface-sunken"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void handleToggleArchive(act);
                                }}
                              >
                                {act.archived ? (
                                  <>
                                    <ArchiveRestore className="size-3.5 text-muted" />
                                    <span>恢复活动</span>
                                  </>
                                ) : (
                                  <>
                                    <Archive className="size-3.5 text-muted" />
                                    <span>归档活动</span>
                                  </>
                                )}
                              </button>
                              <div className="my-1 h-px bg-border-subtle" />
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-danger-fg transition-colors hover:bg-danger/10"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void handleDelete(act.id, act.title);
                                }}
                              >
                                <Trash2 className="size-3.5 text-danger-fg" />
                                <span>删除活动</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {act.type && (
                      <Badge variant="warning" className="text-xs">
                        {act.type}
                      </Badge>
                    )}
                    {act.theme && (
                      <Badge variant="secondary" className="text-xs">
                        {act.theme}
                      </Badge>
                    )}
                    {act.archived ? (
                      <Badge variant="stopped" className="text-xs">
                        已归档
                      </Badge>
                    ) : null}
                  </div>

                  {act.location && (
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <Calendar className="size-3.5 shrink-0 text-accent" />
                      <span>{act.location}</span>
                    </p>
                  )}
                  {act.rules && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted">
                      {act.rules}
                    </p>
                  )}
                </div>

                {/* Footer */}
                <div className="mt-4 flex items-center justify-between border-t border-border-subtle/60 pt-3 text-xs text-muted">
                  <span>更新于 {new Date(act.updatedAt).toLocaleDateString('zh-CN')}</span>
                  <div className="flex items-center gap-1 font-medium text-muted transition-colors group-hover:text-accent">
                    <span>进入工作室</span>
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <ActivityImportModal
          open={importModalOpen}
          onOpenChange={setImportModalOpen}
        />
      </PageContainer>
    </div>
  );
}
