'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
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
  const { data, isLoading, error } = useCharacters();

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
    <main className="min-h-screen bg-[#f4f0e7] text-[#18201d] px-4 sm:px-8 md:px-12 py-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        backHref="/"
        backLabel="返回门户首页"
        eyebrow="SHARED CHARACTER LIBRARY"
        title="角色资料库"
        description="角色不是一段静态提示词，而是一份持续生长的可信资料。在此统一维护设定与外貌，发布后直接供应邻舍与后续互动体验。"
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/apps/characters/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[3px_14px_3px_3px] bg-[#18201d] text-[#f4f0e7] hover:bg-black font-semibold text-sm transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
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
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 rounded-[4px_16px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] shadow-sm">
        <div className="relative w-full sm:max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-3 text-[#68716d]" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索角色姓名、作品、世界观或标签…"
            className="pl-9 bg-transparent border-[rgb(24_32_29/12%)]"
          />
        </div>
        <span className="text-xs text-[#68716d] flex-shrink-0 font-medium">
          共 {filtered.length} 位角色
        </span>
      </div>

      {/* Content Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="flex gap-4 p-4 rounded-[4px_20px_4px_4px] border border-[rgb(24_32_29/12%)] bg-[#fffdf8]"
            >
              <Skeleton className="h-28 w-24 rounded-lg flex-shrink-0" />
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {filtered.map((character) => (
            <Link
              key={character.id}
              href={`/apps/characters/${character.id}`}
              className="group flex gap-4 p-4 rounded-[4px_20px_4px_4px] border border-[rgb(24_32_29/14%)] bg-[#fffdf8] hover:border-[#e45d35]/50 hover:shadow-md transition-all duration-200"
            >
              <div className="relative h-28 w-24 rounded-[3px_14px_3px_3px] overflow-hidden bg-[#777865] flex items-center justify-center text-[#f4f0e7] font-serif text-3xl flex-shrink-0 shadow-inner">
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
                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[9px] font-mono font-bold text-white">
                  {character.latestVersion ? `v${character.latestVersion}` : '草稿'}
                </span>
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#68716d] block truncate">
                    {character.draft.work || character.draft.world || (character.draft.originType === 'ip' ? '已有作品' : '原创角色')}
                  </span>
                  <h3 className="font-serif text-xl font-medium text-[#18201d] truncate group-hover:text-[#e45d35] transition-colors mt-0.5">
                    {character.displayName}
                  </h3>
                  <p className="text-xs text-[#68716d] line-clamp-2 mt-1 leading-relaxed">
                    {character.draft.summary || character.draft.identity || '尚未填写角色简要概述。'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {character.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-[9px] font-medium bg-[rgb(24_32_29/6%)] text-[#68716d] px-2 py-0.5 rounded"
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
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[3px_14px_3px_3px] bg-[#18201d] text-[#f4f0e7] font-medium text-sm hover:bg-black transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>新建第一个角色</span>
            </Link>
          }
        />
      )}
    </main>
  );
}
