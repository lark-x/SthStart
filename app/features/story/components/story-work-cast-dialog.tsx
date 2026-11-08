'use client';

import { useState, useMemo } from 'react';
import { Search, UserPlus, Check, Sparkles, Filter } from 'lucide-react';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { fetchCharacterDetail } from '@/app/features/characters/api';
import type { CharacterProfile } from '@sthstart/contracts';
import { toCharacterRuntime } from '@sthstart/contracts';
import { storyApi } from '../api';
import { CharacterPagination, useCharacterBrowser } from '@/app/features/characters/components/character-filters';

interface StoryWorkCastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultWorkId?: string | null;
  existingSources: Set<string>;
  onCharacterAdded: () => void;
}

export function StoryWorkCastDialog({
  open,
  onOpenChange,
  projectId,
  defaultWorkId,
  existingSources,
  onCharacterAdded,
}: StoryWorkCastDialogProps) {
  const [search, setSearch] = useState('');
  const [selectedWork, setSelectedWork] = useState<string>(defaultWorkId || 'ALL');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const charactersQuery = useCharacterBrowser({}, open, {initialFilter: {page: 1, pageSize: 20, ...(defaultWorkId ? {works: [defaultWorkId]} : {})}});

  const allCharacters = charactersQuery.data?.items ?? [];

  // 提取所有作品列表
  const works = useMemo(() => {
    return (charactersQuery.facets?.works ?? []).map(item => item.name);
  }, [charactersQuery.facets]);

  // The server searches the entire library before paging.
  const filteredCharacters = allCharacters;

  const handleImport = async (char: CharacterProfile) => {
    const name = char.displayName || char.draft?.displayName;
    if (!name) return;

    setImportingId(char.id);
    setError('');
    try {
      if (!char.latestVersion) throw new Error('请先在角色库发布一个版本。');
      const detail = await fetchCharacterDetail(char.id);
      const version = detail.versions.find(v => v.version === char.latestVersion);
      if (!version) throw new Error('来源版本不存在，请刷新角色库。');
      const runtime = toCharacterRuntime(version.data);
      // 构筑角色设定正文
      const lines: string[] = [];
      if (runtime.work) {
        lines.push(`- **所属作品**：${runtime.work}`);
      }
      if (runtime.originType) {
        lines.push(`- **创作类型**：${runtime.originType === 'ip' ? '原作角色' : '原创角色'}`);
      }
      if (char.tags && char.tags.length > 0) {
        lines.push(`- **标签**：${char.tags.join('、')}`);
      }
      if (runtime.summary) {
        lines.push(`- **简介**：${runtime.summary}`);
      }
      if (runtime.personaText) {
        lines.push(`\n### 人设与性格\n${runtime.personaText}`);
      }
      if (runtime.speechText) {
        lines.push(`\n### 语气与对话风格\n${runtime.speechText}`);
      }
      if (runtime.dialogueExamples && runtime.dialogueExamples.length > 0) {
        lines.push(`\n### 对话示例\n${runtime.dialogueExamples.join('\n\n')}`);
      }

      const notes = lines.join('\n');
      await storyApi.createCharacter(projectId, {
        name,
        notes,
        sourceCharacterId: char.id,
        sourceVersion: version.version,
      });

      onCharacterAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入角色失败');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="从角色库引入登场角色"
      description="按来源作品筛选，并采用角色库中已发布的版本。项目内修改独立保存。"
      size="lg"
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <div className="space-y-4">
        {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
        {/* 顶部搜索与作品过滤栏 */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
            <Input
              value={search}
              aria-label="搜索角色"
              onChange={(e) => { setSearch(e.target.value); charactersQuery.change({q: e.target.value, page: 1}); }}
              placeholder="搜索角色名、标签或特征…"
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <Filter className="size-3.5 shrink-0 text-muted" />
            <button
              type="button"
              onClick={() => {setSelectedWork('ALL'); charactersQuery.change({works: [], page: 1});}}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedWork === 'ALL'
                  ? 'bg-accent text-accent-fg'
                  : 'bg-surface-muted text-muted hover:text-ink'
              }`}
            >
              全部作品
            </button>
            {works.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => {setSelectedWork(w); charactersQuery.change({works: [w], page: 1});}}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedWork === w
                    ? 'bg-accent text-accent-fg'
                    : 'bg-surface-muted text-muted hover:text-ink'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* 角色卡列表 */}
        {charactersQuery.isError && <div role="alert">角色读取失败。<Button disabled={charactersQuery.isFetching} onClick={() => void charactersQuery.refetch()}>重新读取角色</Button></div>}
        {(charactersQuery.isFetching || charactersQuery.isSearchPending) && <p role="status">正在更新角色列表…</p>}
        <div className="max-h-[50vh] min-h-[16rem] overflow-y-auto rounded-control border border-border-default bg-surface-muted/30 p-2" data-autohide-scroll>
          {charactersQuery.isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted">
              正在加载角色库…
            </div>
          ) : charactersQuery.isError ? null : filteredCharacters.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-muted">
              <Sparkles className="size-6 text-muted/60" />
              <p className="mt-2">未找到匹配的角色</p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {filteredCharacters.map((char) => {
                const name = char.displayName || char.draft?.displayName || '未命名';
                const work = char.draft?.work || '原创世界';
                const isExisting = existingSources.has(char.id + ':' + char.latestVersion);
                const isBusy = importingId === char.id;

                return (
                  <div
                    key={char.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-default/60 bg-surface p-2.5 transition-colors hover:border-border-default"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {char.avatarUrl ? (
                        <img
                          src={char.avatarUrl}
                          alt={name}
                          className="size-9 shrink-0 rounded-full object-cover ring-1 ring-border-default"
                        />
                      ) : (
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                          {name.slice(0, 1)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-ink">{name}</span>
                          <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted">
                            {work}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted">
                          {char.tags && char.tags.length > 0
                            ? char.tags.slice(0, 3).join(' · ')
                            : '无标签'}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isExisting ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <Check className="size-3.5" />
                          已引入
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2.5 text-xs hover:border-accent hover:text-accent"
                          disabled={Boolean(importingId) || charactersQuery.isFetching || charactersQuery.isSearchPending || !char.latestVersion}
                          onClick={() => void handleImport(char)}
                        >
                          <UserPlus className="size-3" />
                          {isBusy ? '引入中…' : !char.latestVersion ? '尚未发布' : '引入 v' + char.latestVersion}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <CharacterPagination data={charactersQuery.data} loading={charactersQuery.isFetching || charactersQuery.isSearchPending} onPage={page => charactersQuery.change({page})} onPageSizeChange={pageSize => charactersQuery.change({pageSize, page: 1})} />
        <p className="text-xs text-muted">
          提示：引入角色会将人设信息作为草稿复制到本项目，修改后不会影响角色库原有母本。
        </p>
      </div>
    </Dialog>
  );
}
