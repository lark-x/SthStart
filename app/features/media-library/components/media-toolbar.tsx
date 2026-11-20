'use client';

import React, { useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import type { MediaLibraryKind, MediaLibraryStatus } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { CollectionFilterButton, CollectionFilterChips } from '@/app/components/shared/page-archetypes';
import type { CollectionFilterChip } from '@/app/components/shared/page-archetypes-model';

export interface MediaToolbarProps {
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onSearchCompositionStart?: () => void;
  onSearchCompositionEnd?: (val: string) => void;
  selectedKind: MediaLibraryKind | 'all';
  onKindChange: (val: MediaLibraryKind | 'all') => void;
  selectedStatus: MediaLibraryStatus | 'all';
  onStatusChange: (val: MediaLibraryStatus | 'all') => void;
  selectedApp: string;
  onAppChange: (val: string) => void;
  appOptions: Array<{ id: string; name: string }>;
  onRefresh: () => void;
  isLoading: boolean;
  /** 结果统计，显示在筛选胶囊旁。 */
  summary?: React.ReactNode;
}

const KIND_LABELS: Record<MediaLibraryKind, string> = { image: '图像', video: '视频', audio: '音频', file: '文件' };
const STATUS_LABELS: Record<MediaLibraryStatus, string> = { ready: '可用', missing: '文件缺失', quarantined: '已隔离' };

/** 搜索 + 筛选入口 + 刷新；三个筛选条件收进面板，生效后以可删除的胶囊显示。 */
export function MediaToolbar({
  searchQuery,
  onSearchChange,
  onSearchCompositionStart,
  onSearchCompositionEnd,
  selectedKind,
  onKindChange,
  selectedStatus,
  onStatusChange,
  selectedApp,
  onAppChange,
  appOptions,
  onRefresh,
  isLoading,
  summary,
}: MediaToolbarProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const chips: CollectionFilterChip[] = [];
  if (selectedKind !== 'all') chips.push({ id: 'kind', label: `类型：${KIND_LABELS[selectedKind] ?? selectedKind}`, onRemove: () => onKindChange('all') });
  if (selectedApp !== 'all') chips.push({ id: 'app', label: `来源：${appOptions.find((app) => app.id === selectedApp)?.name ?? selectedApp}`, onRemove: () => onAppChange('all') });
  if (selectedStatus !== 'all') chips.push({ id: 'status', label: `状态：${STATUS_LABELS[selectedStatus] ?? selectedStatus}`, onRemove: () => onStatusChange('all') });
  const clearAll = () => { onKindChange('all'); onAppChange('all'); onStatusChange('all'); };

  return (
    <div className="space-y-2.5 border-b border-border-subtle pb-3">
      <div className="collection-toolbar" data-collection-toolbar>
        <div className="collection-search">
          <Input
            leftIcon={<Search className="h-4 w-4 text-muted" />}
            type="search"
            aria-label="搜索媒体列表"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onCompositionStart={onSearchCompositionStart}
            onCompositionEnd={(e) => onSearchCompositionEnd?.(e.currentTarget.value)}
            placeholder="按文件名、ID 或格式搜索媒体…"
            className="text-base sm:text-sm"
          />
        </div>
        <CollectionFilterButton activeCount={chips.length} expanded={panelOpen} onClick={() => setPanelOpen(true)} />
        <div className="collection-toolbar-end">
          <Button size="sm" variant="outline" onClick={onRefresh} loading={isLoading} aria-label="刷新媒体库">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>刷新</span>
          </Button>
        </div>
      </div>

      <CollectionFilterChips chips={chips} onClearAll={clearAll} summary={summary} />

      <ResponsiveEditOverlay
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title="筛选媒体"
        description="按类型、来源与可用状态筛选；更改会立即更新列表。"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" onClick={clearAll} disabled={chips.length === 0}>重置筛选</Button>
            <Button type="button" variant="primary" onClick={() => setPanelOpen(false)}>完成</Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-ink">
            <span>类型</span>
            <Select value={selectedKind} onChange={(e) => onKindChange(e.target.value as MediaLibraryKind | 'all')} aria-label="按产物类型筛选">
              <option value="all">全部类型</option>
              <option value="image">图像</option>
              <option value="video">视频</option>
              <option value="audio">音频</option>
              <option value="file">文件</option>
            </Select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-ink">
            <span>来源</span>
            <Select value={selectedApp} onChange={(e) => onAppChange(e.target.value)} aria-label="按来源应用筛选">
              <option value="all">全部来源</option>
              {appOptions.map((app) => (
                <option key={app.id} value={app.id}>{app.name}</option>
              ))}
            </Select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-ink">
            <span>状态</span>
            <Select value={selectedStatus} onChange={(e) => onStatusChange(e.target.value as MediaLibraryStatus | 'all')} aria-label="按可用状态筛选">
              <option value="all">全部状态</option>
              <option value="ready">可用</option>
              <option value="missing">文件缺失</option>
              <option value="quarantined">已隔离</option>
            </Select>
          </label>
        </div>
      </ResponsiveEditOverlay>
    </div>
  );
}
