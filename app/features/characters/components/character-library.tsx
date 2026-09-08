'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/components/ui/button';
import { CharacterImportDialog } from './character-import-dialog';
import Image from 'next/image';
import { Plus, Search } from 'lucide-react';
import { useCharacters } from '../queries';
import { PageHeader } from '@/app/components/shared/page-header';
import { Input } from '@/app/components/ui/input';
import { Alert } from '@/app/components/ui/alert';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Skeleton } from '@/app/components/ui/skeleton';

export function CharacterLibrary() {
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const router = useRouter();
  const { data, isLoading, error, refetch } = useCharacters();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = data?.items ?? [];
    if (!needle) return items;
    return items.filter((item) =>
      `${item.displayName} ${item.draft.englishName} ${item.draft.work} ${item.draft.world} ${item.tags.join(' ')}`
        .toLowerCase()
        .includes(needle)
    );
  }, [data, query]);

  return (
    <main className="min-h-screen w-full bg-paper text-ink px-4 sm:px-8 md:px-12 py-6">
      <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader
        backHref="/"
        backLabel="返回门户首页"
        eyebrow="SHARED CHARACTER LIBRARY"
        title="角色资料库"
        description="搜索现成角色卡，整理人设与外观，再用于你的活动。"
        actions={
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">搜索 / 导入角色卡</span>
              <span className="sm:hidden">导入卡片</span>
            </Button>
            <Link
              href="/apps/characters/new"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-white hover:bg-accent-dark font-semibold text-sm transition-colors cursor-pointer shadow-xs shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>新建角色</span>
            </Link>
          </div>
        }
      />

      {error && (
        <Alert variant="danger" title="资料库加载失败">
          {error instanceof Error ? error.message : String(error)}
        </Alert>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-2.5 px-4 rounded-[4px_14px_4px_4px] bg-surface border border-[rgb(24_32_29/14%)] shadow-xs">
        <div className="relative w-full sm:max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索角色姓名、作品、世界观或标签…"
            className="pl-9 h-9 bg-transparent border-[rgb(24_32_29/12%)] text-sm"
          />
        </div>
        <span className="text-sm text-muted flex-shrink-0 font-medium">
          共 {filtered.length} 位角色
        </span>
      </div>

      {/* Content Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="flex gap-3.5 p-3.5 rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/12%)] bg-surface"
            >
              <Skeleton className="h-24 w-20 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
          {filtered.map((character) => (
            <Link
              key={character.id}
              href={`/apps/characters/${character.id}`}
              className="group flex gap-3.5 p-3.5 rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/14%)] bg-surface hover:border-accent/50 hover:shadow-md transition-all duration-200"
            >
              <div className="relative h-24 w-20 rounded-[3px_12px_3px_3px] overflow-hidden bg-[#777865] flex items-center justify-center text-paper font-serif text-2xl flex-shrink-0 shadow-inner">
                {character.avatarUrl ? (
                  <Image
                    src={character.avatarUrl}
                    alt={character.displayName}
                    fill
                    unoptimized
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <span>{character.displayName.slice(0, 1) || '角'}</span>
                )}
                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-sm font-mono font-bold text-white">
                  {character.latestVersion ? `v${character.latestVersion}` : '草稿'}
                </span>
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <span className="text-sm uppercase font-bold tracking-wider text-muted block truncate">
                    {character.draft.work || character.draft.world || (character.draft.originType === 'ip' ? '已有作品' : '原创角色')}
                  </span>
                  <h3 className="font-serif text-lg font-medium text-ink truncate group-hover:text-accent transition-colors mt-0.5">
                    {character.displayName}
                  </h3>
                  <p className="text-sm text-muted line-clamp-2 mt-1 leading-relaxed">
                    {character.draft.summary || character.draft.identity || '尚未填写角色简要概述。'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {character.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-sm font-medium bg-[rgb(24_32_29/6%)] text-muted px-2 py-0.5 rounded"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          symbol="角"
          title={query ? '未找到匹配的角色' : '角色资料库空空如也'}
          description={
            query
              ? '请尝试更换搜索词，或新建一位属于此作品的新角色。'
              : '从一个名字、一段描述或现有的 Tavern JSON 角色卡开始建立你的角色体系。'
          }
          actions={
            <Link
              href="/apps/characters/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[3px_14px_3px_3px] bg-accent text-white font-semibold text-sm hover:bg-accent-dark transition-colors shadow-xs"
            >
              <Plus className="h-4 w-4" />
              <span>新建第一个角色</span>
            </Link>
          }
        />
      )}
      </div>
      <CharacterImportDialog open={importOpen} onOpenChange={setImportOpen} initialMode="online" onCommitted={(id) => { void refetch(); router.push(`/apps/characters/${id}`); }} />
    </main>
  );
}
