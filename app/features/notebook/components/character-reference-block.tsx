'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { NoteBlock } from '@sthstart/contracts';
import { useCharacterDetail } from '@/app/features/characters/queries';
import { useCharacterBrowser } from '@/app/features/characters/public';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Pagination } from '@/app/components/ui/pagination';
import { Textarea } from '@/app/components/ui/textarea';

type CharacterReferenceBlockModel = Extract<NoteBlock, { type: 'character-reference' }>;

/** 角色引用使用服务端分页搜索；已选角色的详情独立于当前搜索结果。 */
export function CharacterReferenceBlock({
  block,
  onChange,
}: {
  block: CharacterReferenceBlockModel;
  onChange: (patch: Partial<CharacterReferenceBlockModel>) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const composingRef = useRef(false);
  const browser = useCharacterBrowser({}, pickerOpen);
  const selected = useCharacterDetail(block.characterId || undefined);
  const isPageTransition = browser.isFetching && browser.isPlaceholderData;
  const items = browser.data?.items ?? [];

  return (
    <div className="space-y-2 mt-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">角色资料</span>
        <div className="flex items-center gap-1.5">
          {block.characterId && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ characterId: '' })}>清除引用</Button>
          )}
          <Button size="sm" variant="outline" data-block-entry aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
            {block.characterId ? '更换角色' : '选择角色'}
          </Button>
        </div>
      </div>

      {pickerOpen && (
        <div className="space-y-2 rounded-control border border-border-default bg-surface p-2.5">
          <Input
            aria-label="搜索可引用角色"
            placeholder="搜索姓名、作品或标签…"
            value={searchText}
            onChange={(event) => {
              const value = event.target.value;
              setSearchText(value);
              if (!composingRef.current) browser.change({ q: value });
            }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const value = event.currentTarget.value;
              setSearchText(value);
              browser.change({ q: value });
            }}
            className="h-9 text-sm"
          />

          {browser.isError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-danger/20 bg-danger/10 px-2.5 py-2 text-xs text-danger-fg">
              <span>{browser.error instanceof Error ? browser.error.message : '角色搜索失败'}</span>
              <Button size="sm" variant="outline" onClick={() => void browser.refetch()}>重试</Button>
            </div>
          )}
          {isPageTransition && <p role="status" className="text-xs text-muted">搜索条件已更新，当前仍显示上一次结果…</p>}
          {browser.isLoading ? (
            <p role="status" className="py-3 text-center text-xs text-muted">正在读取角色…</p>
          ) : items.length ? (
            <ul className="max-h-48 divide-y divide-border-subtle overflow-y-auto border-y border-border-subtle">
              {items.map((character) => (
                <li key={character.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm hover:bg-surface-hover"
                    onClick={() => {
                      onChange({ characterId: character.id });
                      setPickerOpen(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{character.displayName}</span>
                      <span className="block truncate text-xs text-muted">
                        {character.draft.work || '未分类'}{character.tags.length ? ' · ' + character.tags.slice(0, 2).join('、') : ''}
                      </span>
                    </span>
                    {character.id === block.characterId && <span className="shrink-0 text-xs text-accent">当前</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : !browser.isError ? (
            <p className="py-3 text-center text-xs text-muted">没有匹配角色，请调整搜索条件。</p>
          ) : null}

          {browser.data && (
            <Pagination
              total={browser.data.total}
              page={browser.data.page}
              pageSize={browser.data.pageSize}
              onPageChange={(page) => browser.change({ page })}
              onPageSizeChange={(pageSize) => browser.change({ pageSize, page: 1 })}
              pageSizeOptions={[20, 50, 100]}
              loading={isPageTransition}
              compact
            />
          )}
        </div>
      )}

      {block.characterId ? (
        <div className="p-2.5 rounded bg-surface-raised/80 border border-border-subtle text-sm space-y-1">
          {selected.isLoading ? (
            <p role="status" className="text-xs text-muted">正在读取已选角色…</p>
          ) : selected.isError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-xs text-danger-fg">
              <span>{selected.error instanceof Error ? selected.error.message : '已选角色详情读取失败'}</span>
              <Button size="sm" variant="outline" onClick={() => void selected.refetch()}>重试</Button>
            </div>
          ) : selected.data ? (
            <>
              <strong className="text-sm font-semibold text-ink block">{selected.data.displayName}</strong>
              <p className="text-xs text-muted">
                {selected.data.draft.work || '未分类'}
              </p>
              <p className="text-muted line-clamp-2 text-sm">
                {selected.data.draft.summary || '尚未填写摘要'}
              </p>
              <Link
                href={'/apps/characters/' + selected.data.id}
                className="inline-block text-accent-dark font-medium hover:underline pt-0.5 text-sm"
              >
                前往角色资料库 →
              </Link>
            </>
          ) : (
            <p className="text-xs text-muted">角色资料当前不可用，仍保留引用 ID。</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">尚未选择角色。</p>
      )}

      <Textarea
        aria-label="与角色的关系"
        rows={2}
        value={block.note}
        onChange={(event) => onChange({ note: event.target.value })}
        placeholder="这条笔记与该角色的关系（可选）"
        className="text-sm"
      />
    </div>
  );
}
