'use client';

import { ArrowDown, ArrowUp, BookOpen, Plus, Search, Sparkles, UserPlus } from 'lucide-react';
import type { StoryDocument, StoryProject, StorySearchResponse } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { ScrollFadeContainer } from '@/app/components/ui/scroll-fade-container';
import type { CastMember } from '../hooks/use-story-mention-picker';
import type { EntryRow, NewKind, StoryNavTab } from '../model/story-entry';
import { chapterStatus, chapterWordLabel, entryMatchesSearch, entryTitle, getEntryLabel, groupLabel } from '../model/story-entry';

type BibleGroup = { kind: Exclude<NewKind, 'chapter'>; rows: EntryRow[] };

export function StoryTreePanel({
  project, isReflection, search, onSearchChange, searchLoading, searchResults,
  entries, chapters, filteredChapters, totalWords, bibleCount, bibleGroups, outlineDoc,
  activeId, castList, navTab, onNavTabChange, onChooseEntry, onReorderChapter,
  onCreate, onOpenProjectSettings, onOpenCharacterLibrary,
}: {
  project: StoryProject | undefined;
  isReflection: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  searchLoading: boolean;
  searchResults: StorySearchResponse | undefined;
  entries: EntryRow[];
  chapters: StoryDocument[];
  filteredChapters: StoryDocument[];
  totalWords: number;
  bibleCount: number;
  bibleGroups: BibleGroup[];
  outlineDoc: StoryDocument | undefined;
  activeId: string | undefined;
  castList: CastMember[];
  navTab: StoryNavTab;
  onNavTabChange: (tab: StoryNavTab) => void;
  onChooseEntry: (row: EntryRow) => void;
  onReorderChapter: (chapterId: string, direction: -1 | 1) => void;
  onCreate: (kind: NewKind) => void;
  onOpenProjectSettings: () => void;
  onOpenCharacterLibrary: () => void;
}) {
  return (
    <div className="story-tree-panel flex h-full min-h-0 flex-col bg-surface">
      {/* 顶部搜索与项目概要 */}
      <div className="story-tree-header shrink-0 p-3 border-b border-border-default/60">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input
            aria-label={isReflection ? '搜索纲要或随笔' : '搜索正文或设定'}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-8 text-sm h-9"
            placeholder={isReflection ? '搜索纲要或随笔…' : '搜索正文或设定…'}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-muted font-mono">
            {isReflection
              ? `${chapters.length} 篇随笔 · ${totalWords.toLocaleString('zh-CN')} 字`
              : `${chapters.length} 章节 · ${totalWords.toLocaleString('zh-CN')} 字`}
          </span>
          {project?.workId ? (
            <span className="truncate text-muted" title={isReflection ? '关联主题标签' : '所属作品'}>
              {project.workId}
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onOpenProjectSettings}
              className="h-auto min-h-0 px-0 py-0 text-xs font-normal text-muted underline hover:bg-transparent hover:text-accent sm:min-h-0"
            >
              {isReflection ? '设置主题' : '绑定作品'}
            </Button>
          )}
        </div>

        {/* 核心双模切换：章节正文 vs 故事设定集（仅剧情项目） */}
        {!isReflection && (
          <PageTabs
            variant="local"
            ariaLabel="剧情资料视图"
            className="mt-2.5 w-full [&>[role=tab]]:flex-1"
            value={navTab}
            onChange={(next) => onNavTabChange(next === 'bible' ? 'bible' : 'chapters')}
            tabs={[
              { id: 'chapters', label: <><BookOpen className="size-3.5" aria-hidden="true" />章节目录 ({chapters.length})</> },
              { id: 'bible', label: <><Sparkles className="size-3.5" aria-hidden="true" />设定集 ({bibleCount})</> },
            ]}
          />
        )}
      </div>

      {/* 滚动内容区 */}
      <ScrollFadeContainer
        orientation="vertical"
        fadeSize={20}
        className="min-h-0 flex-1 p-3"
        data-autohide-scroll
      >
        <nav aria-label={isReflection ? '思考与随笔目录' : '正式剧情资料树'}>
        {/* 全文搜索结果 */}
        {search.trim().length >= 2 && (
          <section className="mb-4 border-b border-border-default pb-3">
            <h2 className="mb-2 text-xs font-semibold text-muted">搜索结果</h2>
            {searchLoading && <p className="text-xs text-muted">搜索中…</p>}
            {searchResults?.items.map((result) => {
              const row = entries.find((entry) => entry.item.id === result.id);
              return (
                <button
                  key={`${result.kind}-${result.id}`}
                  type="button"
                  onClick={() => row && onChooseEntry(row)}
                  className="mb-1 block w-full rounded-control px-2 py-2 text-left hover:bg-surface-hover"
                >
                  <span className="block truncate text-sm font-medium">{result.title}</span>
                  <span className="line-clamp-2 text-xs text-muted">
                    {getEntryLabel(result.kind, isReflection)} · {result.excerpt}
                  </span>
                </button>
              );
            })}
            {searchResults?.items.length === 0 && <p className="text-xs text-muted">没有匹配内容。</p>}
          </section>
        )}

        {/* 聚焦模式：感想随笔项目（仅思考纲要 + 感想随笔列表） */}
        {isReflection ? (
          <div className="space-y-4">
            {/* 顶栏：思考纲要 */}
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wide text-muted">思考纲要</h2>
            {!outlineDoc && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="新增思考纲要"
                title="新增思考纲要"
                onClick={() => onCreate('outline')}
                className="size-7 sm:size-7"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Button>
            )}
              </div>
              {outlineDoc ? (
                <div
                  data-selected={(activeId === outlineDoc.id) || undefined}
                  className="ui-choice group flex min-w-0 items-center rounded-control text-muted transition-colors hover:bg-surface-hover"
                >
                  <button
                    type="button"
                    onClick={() => onChooseEntry({ kind: 'document', item: outlineDoc })}
                    aria-current={activeId === outlineDoc.id ? 'true' : undefined}
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className={`truncate text-sm font-medium ${activeId === outlineDoc.id ? 'text-ink' : ''}`}>
                        {outlineDoc.title || '思考纲要'}
                      </span>
                      <span className="shrink-0 text-xs text-muted font-mono">
                        {[...outlineDoc.body.trim()].length}字
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      v{outlineDoc.revision} · 顶层思考与框架梳理
                    </div>
                  </button>
                </div>
              ) : (
                <p className="rounded border border-dashed border-border-default/80 px-2.5 py-2 text-center text-xs text-muted">
                  还没有思考纲要；用上方“新增思考纲要”开始。
                </p>
              )}
            </section>

            {/* 随笔篇目列表 */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wide text-muted">
                  感想随笔 ({chapters.length})
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onCreate('chapter')}
                  className="gap-1 text-xs"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>新建随笔</span>
                </Button>
              </div>

              {filteredChapters.length === 0 ? (
                <div className="rounded-panel border border-dashed border-border-default p-4 text-center">
                  <p className="text-xs text-muted">尚未记录对话感想。</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredChapters.map((chapter) => {
                    const active = activeId === chapter.id;
                    const wordCount = chapter.body.trim().length;
                    const wordLabel = chapterWordLabel(wordCount);

                    return (
                      <div
                        key={chapter.id}
                        data-selected={(active) || undefined}
                        className="ui-choice group flex min-w-0 items-center rounded-control text-muted transition-colors hover:bg-surface-hover"
                      >
                        <button
                          type="button"
                          onClick={() => onChooseEntry({ kind: 'document', item: chapter })}
                          aria-current={active ? 'true' : undefined}
                          className="min-w-0 flex-1 px-2.5 py-2 text-left"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className={`truncate text-sm font-medium ${active ? 'text-ink' : ''}`}>
                              第 {chapter.position + 1} 篇 · {chapter.title}
                            </span>
                            <span className="shrink-0 text-xs text-muted font-mono">
                              {wordLabel}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                            <span>v{chapter.revision}</span>
                            <span className="truncate">更新于 {new Date(chapter.updatedAt).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </button>

                        <span className="mr-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={filteredChapters[0]?.id === chapter.id}
                            aria-label={`上移${chapter.title}`}
                            title="上移篇目"
                            onClick={() => onReorderChapter(chapter.id, -1)}
                            className="size-7 sm:size-7"
                          >
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={filteredChapters.at(-1)?.id === chapter.id}
                            aria-label={`下移${chapter.title}`}
                            title="下移篇目"
                            onClick={() => onReorderChapter(chapter.id, 1)}
                            className="size-7 sm:size-7"
                          >
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* 剧情模式：原有两模切换 */
          <>
            {navTab === 'chapters' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wide text-muted">章节列表</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCreate('chapter')}
                    className="gap-1 text-xs"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    <span>新建章节</span>
                  </Button>
                </div>

                {filteredChapters.length === 0 ? (
                  <div className="rounded-panel border border-dashed border-border-default p-4 text-center">
                    <p className="text-xs text-muted">{search.trim() ? '没有匹配的章节，请调整搜索。' : '尚未创建小说章节。'}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {filteredChapters.map((chapter) => {
                      const active = activeId === chapter.id;
                      const wordCount = chapter.body.trim().length;
                      const wordLabel = chapterWordLabel(wordCount);
                      const statusLabel = chapterStatus(wordCount);

                      return (
                        <div
                          key={chapter.id}
                          data-selected={(active) || undefined}
                          className="ui-choice group flex min-w-0 items-center rounded-control text-muted transition-colors hover:bg-surface-hover"
                        >
                          <button
                            type="button"
                            onClick={() => onChooseEntry({ kind: 'document', item: chapter })}
                            aria-current={active ? 'true' : undefined}
                            className="min-w-0 flex-1 px-2.5 py-2 text-left"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className={`truncate text-sm font-medium ${active ? 'text-ink' : ''}`}>
                                第 {chapter.position + 1} 章 · {chapter.title}
                              </span>
                              <span className="shrink-0 text-xs text-muted font-mono">
                                {wordLabel}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                              <span className="text-xs font-medium text-muted">{statusLabel}</span>
                              <span>v{chapter.revision}</span>
                            </div>
                          </button>

                          <span className="mr-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={filteredChapters[0]?.id === chapter.id}
                              aria-label={`上移${chapter.title}`}
                              title="上移章节"
                              onClick={() => onReorderChapter(chapter.id, -1)}
                              className="size-7 sm:size-7"
                            >
                              <ArrowUp className="size-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={filteredChapters.at(-1)?.id === chapter.id}
                              aria-label={`下移${chapter.title}`}
                              title="下移章节"
                              onClick={() => onReorderChapter(chapter.id, 1)}
                              className="size-7 sm:size-7"
                            >
                              <ArrowDown className="size-3.5" aria-hidden="true" />
                            </Button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {navTab === 'bible' && (
              <div className="space-y-4">
                {bibleGroups.map(({ kind, rows }) => {
                  const visible = rows.filter((row) => entryMatchesSearch(row, search));
                  return (
                    <section key={kind} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-semibold tracking-wide text-muted">
                          {groupLabel[kind]} <span className="font-normal font-mono">({rows.length})</span>
                        </h2>
                        <div className="flex items-center gap-1">
                          {kind === 'character' && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="从角色库引入"
                              title="从已有角色库按作品引入角色"
                              onClick={onOpenCharacterLibrary}
                              className="size-7 sm:size-7"
                            >
                              <UserPlus className="size-3.5" aria-hidden="true" />
                            </Button>
                          )}
                          {(kind !== 'outline' || rows.length === 0) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`新增${groupLabel[kind]}`}
                              title={`新增${groupLabel[kind]}`}
                              onClick={() => onCreate(kind)}
                              className="size-7 sm:size-7"
                            >
                              <Plus className="size-3.5" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {visible.map((row) => {
                        const active = activeId === row.item.id;
                        const isChar = row.kind === 'character';
                        const charInfo = isChar ? castList.find((member) => member.id === row.item.id || member.name === row.item.name) : null;

                        return (
                          <div
                            key={row.item.id}
                            data-selected={(active) || undefined}
                            className="ui-choice group flex min-w-0 items-center rounded-control text-muted transition-colors hover:bg-surface-hover"
                          >
                            <button
                              type="button"
                              onClick={() => onChooseEntry(row)}
                              aria-current={active ? 'true' : undefined}
                              className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isChar && (
                                  <div className="size-6 shrink-0 rounded-full overflow-hidden border border-border-default/80 bg-surface-muted flex items-center justify-center text-xs font-semibold text-muted">
                                    {charInfo?.avatarUrl ? (
                                      <img src={charInfo.avatarUrl} alt="" className="size-full object-cover" />
                                    ) : (
                                      entryTitle(row.item).slice(0, 1)
                                    )}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <span className={`truncate block text-sm font-medium ${active ? 'text-ink' : ''}`}>
                                    {entryTitle(row.item)}
                                  </span>
                                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                                    {isChar && charInfo?.work && (
                                      <span className="truncate text-muted text-xs">
                                        {charInfo.work}
                                      </span>
                                    )}
                                    <span>v{row.item.revision}</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })}

                      {rows.length === 0 && kind === 'outline' && (
                        <p className="rounded border border-dashed border-border-default/80 px-2.5 py-2 text-center text-xs text-muted">
                          还没有项目主线大纲；用上方“新增大纲”开始。
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
        </nav>
      </ScrollFadeContainer>

      {/* 底部全书统计与即时保存状态 */}
      <div className="story-tree-footer shrink-0 border-t border-border-default/60 p-2.5 text-center text-xs text-muted font-mono">
        {isReflection ? '对话感想空间 · 自动即时保存' : '本地私密创作空间 · 自动即时保存'}
      </div>
    </div>
  );
}
