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
} from 'lucide-react';
import { useActivities } from '@/app/features/activities/queries';
import {
  useDeleteActivity,
  useDuplicateActivity,
  useUpdateActivity,
} from '@/app/features/activities/mutations';
import { PageHeader } from '@/app/components/shared/page-header';
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
    <main className="min-h-screen w-full bg-paper text-ink px-4 sm:px-8 md:px-12 py-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          backHref="/"
          backLabel="返回门户首页"
          eyebrow="ACTIVITY STUDIO"
          title="活动工作室"
          description="独立活动聊天与动态内容创作平台。设定情节阶段、AI 驱动多角色互动、编排拟真设备回放，导出可离线渲染的 HyperFrames 视频工程。"
          actions={
            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[3px_12px_3px_3px] border-[rgb(24_32_29/20%)] bg-surface hover:bg-stone-100 text-xs font-semibold"
              >
                <FolderDown className="h-4 w-4 text-muted" />
                <span>导入活动</span>
              </Button>

              <Link
                href="/apps/activities/new"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[3px_12px_3px_3px] bg-accent text-white hover:bg-accent-dark font-semibold text-xs tracking-wide transition-colors cursor-pointer shadow-xs"
              >
                <Plus className="h-4 w-4" />
                <span>新建活动</span>
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
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-2.5 px-4 rounded-[4px_14px_4px_4px] bg-surface border border-[rgb(24_32_29/14%)] shadow-xs">
          <div className="relative w-full sm:max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索活动标题、主题、类型或地点…"
              className="pl-9 h-9 bg-transparent border-[rgb(24_32_29/12%)] text-xs"
            />
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-1 bg-stone-100 p-0.5 rounded-[4px_10px_4px_4px]">
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                className={`px-3 py-1 text-xs font-semibold rounded-[3px_8px_3px_3px] transition-colors cursor-pointer ${
                  !showArchived ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
                }`}
              >
                活跃活动
              </button>
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className={`px-3 py-1 text-xs font-semibold rounded-[3px_8px_3px_3px] transition-colors cursor-pointer ${
                  showArchived ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="p-5 rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/12%)] bg-surface space-y-3"
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
            description="点击上方“新建活动”设定主题与初始阶段，或“导入活动”载入已有的工程包。"
            actions={
              !showArchived && (
                <Link
                  href="/apps/activities/new"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[3px_12px_3px_3px] bg-accent text-white hover:bg-accent-dark font-semibold text-xs transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  新建活动
                </Link>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((act) => (
              <div
                key={act.id}
                className="group flex flex-col justify-between p-5 rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/14%)] bg-surface hover:border-accent/60 hover:shadow-md transition-all duration-200"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/apps/activities/${act.id}`}
                      className="text-base font-bold text-ink group-hover:text-accent transition-colors line-clamp-1"
                    >
                      {act.title}
                    </Link>
                    <Badge
                      variant="outline"
                      className="text-xs font-mono flex-shrink-0 bg-stone-100 text-stone-700"
                    >
                      v{act.headVersion}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {act.type && (
                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-200">
                        {act.type}
                      </Badge>
                    )}
                    {act.theme && (
                      <Badge variant="outline" className="text-xs bg-stone-100 text-stone-700 border-stone-200">
                        {act.theme}
                      </Badge>
                    )}
                    {act.archived ? (
                      <Badge variant="outline" className="text-xs bg-stone-200 text-stone-600">
                        已归档
                      </Badge>
                    ) : null}
                  </div>

                  {act.rules && (
                    <p className="text-xs text-muted line-clamp-2 leading-relaxed">
                      {act.rules}
                    </p>
                  )}
                </div>

                {/* Footer and Actions */}
                <div className="pt-4 mt-4 border-t border-[rgb(24_32_29/8%)] flex items-center justify-between text-xs text-muted">
                  <span className="text-xs font-mono">
                    {new Date(act.updatedAt).toLocaleDateString('zh-CN')}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDuplicate(act.id)}
                      title="复制活动副本"
                      className="h-7 w-7 p-0 text-stone-500 hover:text-stone-800"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleArchive(act)}
                      title={act.archived ? '取消归档' : '归档活动'}
                      className="h-7 w-7 p-0 text-stone-500 hover:text-stone-800"
                    >
                      {act.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(act.id, act.title)}
                      title="删除活动"
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>

                    <Link
                      href={`/apps/activities/${act.id}`}
                      className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-[3px_8px_3px_3px] bg-accent/10 text-accent hover:bg-accent hover:text-white font-semibold text-xs transition-colors"
                    >
                      <span>进入</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
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
      </div>
    </main>
  );
}
