'use client';

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Pagination } from '@/app/components/ui/pagination';
import { fetchMediaLibrary } from './api';
import { MediaCard } from './components/media-card';
import { MediaToolbar } from './components/media-toolbar';
import { MediaPreviewDialog } from './components/media-preview-dialog';
import type {
  MediaLibraryItem,
  MediaLibraryKind,
  MediaLibraryResponse,
  MediaLibraryStatus,
} from './types';
import { KNOWN_APP_META } from '@sthstart/contracts';
import { applyMediaListState, MEDIA_DEFAULT_PAGE_SIZE, MEDIA_PAGE_SIZE_OPTIONS, mediaListUrl, parseMediaListState } from './url-state';

export interface MediaLibraryViewProps {
  onChooseArtifact?: (item: MediaLibraryItem) => void;
  className?: string;
}

export function MediaLibraryView({ onChooseArtifact, className = '' }: MediaLibraryViewProps) {
  const searchParams = useSearchParams();
  const [initial] = useState(() => parseMediaListState(searchParams?.toString() ?? ''));

  const [data, setData] = useState<MediaLibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选与分页状态
  const [searchQuery, setSearchQuery] = useState(initial.q);
  const [debouncedSearch, setDebouncedSearch] = useState(initial.q);
  const [selectedKind, setSelectedKind] = useState<MediaLibraryKind | 'all'>(initial.mediaKind);
  const [selectedStatus, setSelectedStatus] = useState<MediaLibraryStatus | 'all'>(initial.status);
  const [selectedApp, setSelectedApp] = useState<string>(initial.appId);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const composingSearchRef = useRef(false);

  // 弹窗预览
  const [previewItem, setPreviewItem] = useState<MediaLibraryItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const restoreFromUrl = useCallback((input: string | URLSearchParams) => {
    const next = parseMediaListState(input);
    setSearchQuery(next.q);
    setDebouncedSearch(next.q);
    setSelectedKind(next.mediaKind);
    setSelectedStatus(next.status);
    setSelectedApp(next.appId);
    setPage(next.page);
    setPageSize(next.pageSize);
  }, []);

  // 浏览器前进/后退恢复页码、搜索和筛选；页面通过 Link 返回时由初始 URL 恢复。
  useEffect(() => {
    const restore = () => restoreFromUrl(window.location.search);
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [restoreFromUrl]);

  // 同一页面内由 Next 更新查询参数时也按新 URL 复位。第一次加载使用上面的初始值。
  const urlSignature = searchParams?.toString() ?? '';
  const appliedUrlSignature = useRef(urlSignature);
  useEffect(() => {
    if (urlSignature === appliedUrlSignature.current) return;
    appliedUrlSignature.current = urlSignature;
    restoreFromUrl(urlSignature);
  }, [restoreFromUrl, urlSignature]);

  // 防抖搜索
  useEffect(() => {
    if (composingSearchRef.current) return;
    const timer = setTimeout(() => {
      if (!composingSearchRef.current) setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 将页码、搜索与筛选同步至浏览器 URL，保留详情等同一路由上的其他参数。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    applyMediaListState(params, {
      q: debouncedSearch,
      mediaKind: selectedKind,
      status: selectedStatus,
      appId: selectedApp,
      page,
      pageSize,
    });
    const nextQs = params.toString();
    const nextUrl = `${window.location.pathname}${nextQs ? `?${nextQs}` : ''}${window.location.hash}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }, [debouncedSearch, selectedKind, selectedStatus, selectedApp, page, pageSize]);

  // 加载数据：带 AbortController 竞态消除，防止后发先至
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    queueMicrotask(() => {
      if (active) {
        setIsLoading(true);
        setError(null);
      }
    });

    const offset = (page - 1) * pageSize;
    fetchMediaLibrary(
      {
        q: debouncedSearch || undefined,
        mediaKind: selectedKind,
        status: selectedStatus,
        appId: selectedApp,
        limit: pageSize,
        offset,
      },
      { signal: controller.signal }
    )
      .then((res) => {
        if (active) {
          const responsePages = Math.max(1, Math.ceil(res.total / Math.max(1, res.limit)));
          if (page > responsePages) {
            setPage(responsePages);
            return;
          }
          setData(res);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (active && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : '加载媒体资产失败');
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [debouncedSearch, selectedKind, selectedStatus, selectedApp, page, pageSize, refreshCounter]);

  const handlePreview = (item: MediaLibraryItem) => {
    setPreviewItem(item);
    setIsPreviewOpen(true);
  };

  const handleClosePreview = () => {
    setIsPreviewOpen(false);
  };

  // 构造 app 选项
  const appOptions = Object.entries(KNOWN_APP_META).map(([id, meta]) => ({
    id,
    name: meta.name,
  }));
  for (const item of data?.items ?? []) if (!appOptions.some(app => app.id === item.appId)) appOptions.push({id:item.appId,name:item.appName});
  if (selectedApp !== 'all' && !appOptions.some(app => app.id === selectedApp)) appOptions.push({id:selectedApp,name:selectedApp});

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentItems = data?.items ?? [];

  // 删除末页内容或外部数据变少后回到最后一个有效页。
  useEffect(() => {
    if (!data || page <= totalPages) return;
    const timer = setTimeout(() => setPage(totalPages), 0);
    return () => clearTimeout(timer);
  }, [data, page, totalPages]);

  const displayedPage = isLoading && data && data.limit > 0
    ? Math.floor(data.offset / data.limit) + 1
    : page;
  const currentListState = {
    q: debouncedSearch,
    mediaKind: selectedKind,
    status: selectedStatus,
    appId: selectedApp,
    page,
    pageSize,
  };
  const pushPageState = (nextPage: number, nextPageSize = pageSize) => {
    if (typeof window === 'undefined') return;
    const next = mediaListUrl(window.location.href, { ...currentListState, page: nextPage, pageSize: nextPageSize });
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.pushState(window.history.state, '', next);
  };
  const changePage = (nextPage: number) => {
    pushPageState(nextPage);
    setPage(nextPage);
  };
  const changePageSize = (nextPageSize: number) => {
    pushPageState(1, nextPageSize);
    setPageSize(nextPageSize);
    setPage(1);
  };

  return (
    <div className={`flex flex-col space-y-4 ${className}`}>
      {/* 顶部工具栏与筛选 */}
      <MediaToolbar
        searchQuery={searchQuery}
        onSearchChange={(value) => {
          setSearchQuery(value);
          if (!composingSearchRef.current) setPage(1);
        }}
        onSearchCompositionStart={() => { composingSearchRef.current = true; }}
        onSearchCompositionEnd={(value) => {
          composingSearchRef.current = false;
          setSearchQuery(value);
          setDebouncedSearch(value);
          setPage(1);
        }}
        selectedKind={selectedKind}
        onKindChange={(val) => {
          setSelectedKind(val);
          setPage(1);
        }}
        selectedStatus={selectedStatus}
        onStatusChange={(val) => {
          setSelectedStatus(val);
          setPage(1);
        }}
        selectedApp={selectedApp}
        onAppChange={(val) => {
          setSelectedApp(val);
          setPage(1);
        }}
        appOptions={appOptions}
        onRefresh={() => setRefreshCounter((c) => c + 1)}
        isLoading={isLoading}
      />

      {/* 错误态 */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-panel border border-danger/20 bg-danger/10 p-4 text-sm text-danger-fg"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setRefreshCounter((c) => c + 1)}>
            <RefreshCw className="h-4 w-4" />
            <span>重试</span>
          </Button>
        </div>
      )}

      {/* 内容展示区 */}
      {error && !data ? null : isLoading && !data ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted">
          <RefreshCw className="h-8 w-8 animate-spin opacity-50 mb-3" />
          <p className="text-sm">正在加载全局媒体素材…</p>
        </div>
      ) : currentItems.length > 0 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4">
            {currentItems.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                onPreview={handlePreview}
                onChooseArtifact={onChooseArtifact}
              />
            ))}
          </div>

        </div>
      ) : error ? null : (
        <EmptyState
          icon={FolderOpen}
          title={debouncedSearch || selectedKind !== 'all' || selectedStatus !== 'all' || selectedApp !== 'all' ? '未找到符合条件的媒体' : '媒体库暂无产物'}
          description={debouncedSearch || selectedKind !== 'all' || selectedStatus !== 'all' || selectedApp !== 'all' ? '尝试调整搜索词或重置筛选条件' : '各业务模块生成的图像、音视频及生成产物将自动汇集于此'}
          actions={
            (debouncedSearch || selectedKind !== 'all' || selectedStatus !== 'all' || selectedApp !== 'all') ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setDebouncedSearch('');
                  setSelectedKind('all');
                  setSelectedStatus('all');
                  setSelectedApp('all');
                  setPageSize(MEDIA_DEFAULT_PAGE_SIZE);
                  setPage(1);
                  composingSearchRef.current = false;
                }}
              >
                重置全部筛选
              </Button>
            ) : undefined
          }
        />
      )}

      {data && !error && (
        <Pagination
          total={total}
          page={displayedPage}
          pageSize={pageSize}
          onPageChange={changePage}
          onPageSizeChange={changePageSize}
          pageSizeOptions={MEDIA_PAGE_SIZE_OPTIONS}
          loading={isLoading}
        />
      )}

      {/* 原图与音视频详情全屏/模态弹窗预览 */}
      <MediaPreviewDialog
        item={previewItem}
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
        onChooseArtifact={onChooseArtifact}
      />
    </div>
  );
}
