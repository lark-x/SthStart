'use client';

import React from 'react';
import { Search, RefreshCw } from 'lucide-react';
import type { MediaLibraryKind, MediaLibraryStatus } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';

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
}

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
}: MediaToolbarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-border-subtle bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      {/* 搜索框 */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onCompositionStart={onSearchCompositionStart}
          onCompositionEnd={(e) => onSearchCompositionEnd?.(e.currentTarget.value)}
          placeholder="按文件名、ID 或格式搜索媒体…"
          className="w-full rounded-control border border-border-subtle bg-surface-subtle py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-muted transition-colors focus:border-border focus:bg-surface focus:outline-none"
        />
      </div>

      {/* 筛选控制器 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 类型筛选 */}
        <select
          value={selectedKind}
          onChange={(e) => onKindChange(e.target.value as MediaLibraryKind | 'all')}
          aria-label="按产物类型筛选"
          className="rounded-control border border-border-subtle bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-border focus:outline-none cursor-pointer"
        >
          <option value="all">全部类型</option>
          <option value="image">图像 (Image)</option>
          <option value="video">视频 (Video)</option>
          <option value="audio">音频 (Audio)</option>
          <option value="file">文件 (File)</option>
        </select>

        {/* 来源应用筛选 */}
        <select
          value={selectedApp}
          onChange={(e) => onAppChange(e.target.value)}
          aria-label="按来源应用筛选"
          className="rounded-control border border-border-subtle bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-border focus:outline-none cursor-pointer"
        >
          <option value="all">全部来源</option>
          {appOptions.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </select>

        {/* 状态筛选 */}
        <select
          value={selectedStatus}
          onChange={(e) => onStatusChange(e.target.value as MediaLibraryStatus | 'all')}
          aria-label="按可用状态筛选"
          className="rounded-control border border-border-subtle bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-border focus:outline-none cursor-pointer"
        >
          <option value="all">全部状态</option>
          <option value="ready">可用</option>
          <option value="missing">文件缺失</option>
          <option value="quarantined">已隔离</option>
        </select>

        {/* 刷新按钮 */}
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          loading={isLoading}
          aria-label="刷新媒体库"
          className="px-2.5 py-1.5 h-auto text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">刷新</span>
        </Button>
      </div>
    </div>
  );
}

