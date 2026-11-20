'use client';

import React from 'react';
import { Search, RefreshCw } from 'lucide-react';
import type { MediaLibraryKind, MediaLibraryStatus } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';

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
    <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-3">
      {/* 搜索框 */}
      <div className="relative min-w-0 w-full sm:min-w-56 sm:flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted pointer-events-none" />
        <Input
          type="search"
          aria-label="搜索媒体列表"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onCompositionStart={onSearchCompositionStart}
          onCompositionEnd={(e) => onSearchCompositionEnd?.(e.currentTarget.value)}
          placeholder="按文件名、ID 或格式搜索媒体…"
          className="h-9 min-h-0 pl-9 text-sm"
        />
      </div>

      {/* 筛选控制器 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 类型筛选 */}
        <Select
          value={selectedKind}
          onChange={(e) => onKindChange(e.target.value as MediaLibraryKind | 'all')}
          aria-label="按产物类型筛选"
          className="h-9 min-h-0 w-auto text-sm"
        >
          <option value="all">全部类型</option>
          <option value="image">图像 (Image)</option>
          <option value="video">视频 (Video)</option>
          <option value="audio">音频 (Audio)</option>
          <option value="file">文件 (File)</option>
        </Select>

        {/* 来源应用筛选 */}
        <Select
          value={selectedApp}
          onChange={(e) => onAppChange(e.target.value)}
          aria-label="按来源应用筛选"
          className="h-9 min-h-0 w-auto max-w-48 text-sm"
        >
          <option value="all">全部来源</option>
          {appOptions.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </Select>

        {/* 状态筛选 */}
        <Select
          value={selectedStatus}
          onChange={(e) => onStatusChange(e.target.value as MediaLibraryStatus | 'all')}
          aria-label="按可用状态筛选"
          className="h-9 min-h-0 w-auto text-sm"
        >
          <option value="all">全部状态</option>
          <option value="ready">可用</option>
          <option value="missing">文件缺失</option>
          <option value="quarantined">已隔离</option>
        </Select>

        {/* 刷新按钮 */}
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          loading={isLoading}
          aria-label="刷新媒体库"
          className="h-9 min-h-0 px-2.5 text-sm"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">刷新</span>
        </Button>
      </div>
    </div>
  );
}

