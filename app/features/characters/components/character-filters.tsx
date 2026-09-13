'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CharacterBrowseQuery, CharacterBrowseResult } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { browseCharacters } from '../api';

export { CHARACTER_FILTER_URL_PARAM, parseCharacterFilterParam } from '../filter-url';
import { CHARACTER_FILTER_URL_PARAM } from '../filter-url';

/**
 * 角色浏览的统一实现：角色库与活动选人共用同一套条件与分页。
 * persist=true 时把条件写入 URL，从角色详情返回后可以恢复。
 */
export function useCharacterBrowser(overrides: CharacterBrowseQuery = {}, enabled = true, options: { persist?: boolean; initialFilter?: CharacterBrowseQuery | null } = {}) {
  const persist = options.persist === true;
  const [filter, setFilter] = useState<CharacterBrowseQuery>(() => options.initialFilter || { page: 1 });
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filter.q || ''), 250);
    return () => clearTimeout(timer);
  }, [filter.q]);

  useEffect(() => {
    if (!persist || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set(CHARACTER_FILTER_URL_PARAM, JSON.stringify(filter));
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [filter, persist]);

  const request = { ...filter, ...overrides, q: debouncedQ };
  const result = useQuery({
    queryKey: ['characters', 'browse', request],
    queryFn: ({ signal }) => browseCharacters(request, signal),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const change = useCallback((patch: CharacterBrowseQuery) => setFilter((current) => ({ ...current, ...patch, page: patch.page ?? 1 })), []);
  return {
    ...result,
    facets: result.data?.facets,
    filter,
    change,
    // 关键词还在防抖窗口内时提示结果即将更新。
    isSearchPending: (filter.q || '') !== debouncedQ,
    reset: () => setFilter({ page: 1 }),
  };
}

interface MultiFilterOption { value: string; label: string; search?: string }

function MultiFilter({ label, values, selected, onChange }: { label: string; values: MultiFilterOption[]; selected: string[]; onChange: (values: string[]) => void }) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.open) { ref.current.open = false; }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = needle ? values.filter((item) => `${item.label} ${item.search || ''}`.toLowerCase().includes(needle)) : values;

  return <details ref={ref} className="relative rounded-md border border-ink/15 bg-surface">
    <summary className="cursor-pointer px-3 py-2 text-sm">{label}{selected.length ? ` (${selected.length})` : ''}</summary>
    <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-ink/15 bg-surface p-3 shadow-lg">
      <Input aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="mt-2 max-h-48 space-y-1 overflow-auto">
        {matches.map((item) => (
          <label key={item.value} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(item.value)}
              onChange={(event) => onChange(event.target.checked ? [...selected, item.value] : selected.filter((value) => value !== item.value))}
            />
            {item.label}
          </label>
        ))}
        {!values.length && <p className="text-sm text-muted">暂无可选项</p>}
        {!!values.length && !matches.length && <p className="text-sm text-muted">没有匹配“{query.trim()}”的选项</p>}
      </div>
    </div>
  </details>;
}

interface Chip { key: string; label: string; clear: () => CharacterBrowseQuery; }

function activeChips(filter: CharacterBrowseQuery): Chip[] {
  const chips: Chip[] = [];
  for (const [key, label] of [['works', '作品'], ['tags', '标签'], ['groups', '分组']] as const) {
    for (const value of filter[key] || []) {
      chips.push({ key: `${key}:${value}`, label: `${label}：${value}`, clear: () => ({ [key]: (filter[key] || []).filter((item) => item !== value) }) });
    }
  }
  if (filter.tags?.length && filter.tagMode === 'all') chips.push({ key: 'tagMode', label: '标签：全部匹配', clear: () => ({ tagMode: undefined }) });
  if (filter.q) chips.push({ key: 'q', label: `搜索：${filter.q}`, clear: () => ({ q: '' }) });
  if (filter.favorite) chips.push({ key: 'favorite', label: '仅收藏', clear: () => ({ favorite: undefined }) });
  const selects: Array<[keyof CharacterBrowseQuery, string, (value: string) => string]> = [
    ['mediaType', '作品类型', (value) => value],
    ['originType', '创作类型', (value) => (value === 'ip' ? '已有 IP' : '原创')],
    ['reference', '外观参考图', (value) => (value === 'yes' ? '有可用参考图' : '无可用参考图')],
    ['appearance', '外观描述', (value) => (value === 'yes' ? '已填写外观' : '未填写外观')],
    ['interpretation', '人设演绎', (value) => value],
    ['source', '导入来源', (value) => (value === 'local' ? '本地角色卡' : value === 'manual' ? '手动创建' : value)],
    ['unclassified', '待整理', (value) => (value === 'work' ? '未设置作品' : '未设置标签')],
    ['birthdayStatus', '生日', (value) => (value === 'known' ? '生日已知' : value === 'needs_confirmation' ? '生日待确认' : '未填写生日')],
    ['birthdayMonth', '生日月份', (value) => `${value} 月生日`],
  ];
  for (const [key, label, format] of selects) {
    const value = filter[key];
    if (value === undefined || value === null || value === '') continue;
    chips.push({ key: `${String(key)}`, label: `${label}：${format(String(value))}`, clear: () => ({ [key]: undefined }) });
  }
  return chips;
}

export function CharacterFilters({ filter, onChange, facets, onReset, actions }: { actions?: ReactNode; filter: CharacterBrowseQuery; onChange: (patch: CharacterBrowseQuery) => void; facets?: CharacterBrowseResult['facets']; onReset: () => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const select = (label: string, key: keyof CharacterBrowseQuery, options: [string, string][]) => (
    <label className="flex flex-col gap-1 text-sm">{label}
      <select className="rounded border border-ink/15 bg-surface px-2 py-2" value={String(filter[key] || '')} onChange={(event) => onChange({ [key]: event.target.value || undefined })}>
        <option value="">全部</option>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  );
  const chips = activeChips(filter);
  const clearChip = (chip: Chip) => onChange(chip.clear());

  return <div className="space-y-3 rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
    <div className="flex flex-wrap items-center gap-2">
    <Input className="w-full sm:w-[320px] xl:w-[360px]" aria-label="搜索角色" placeholder="搜索姓名、英文名、别名、作品或标签…" value={filter.q || ''} onChange={(event) => onChange({ q: event.target.value })} />
    <div className="flex flex-wrap items-center gap-2">
      <MultiFilter label="作品" values={(facets?.works || []).map((work) => ({ value: work.name, label: work.name, search: work.aliases.join(' ') }))} selected={filter.works || []} onChange={(works) => onChange({ works })} />
      <MultiFilter label="标签" values={[...new Set([...(facets?.tags || []), ...(filter.tags || [])])].map((tag) => ({ value: tag, label: tag }))} selected={filter.tags || []} onChange={(tags) => onChange({ tags })} />
      <MultiFilter label="分组" values={(facets?.groups || []).map((group) => ({ value: group, label: group }))} selected={filter.groups || []} onChange={(groups) => onChange({ groups })} />
      <label className="flex items-center gap-2 px-2 text-sm"><input type="checkbox" checked={filter.favorite || false} onChange={(event) => onChange({ favorite: event.target.checked })} />仅收藏</label>
      {!!chips.length && <Button size="sm" variant="ghost" onClick={onReset}>清空</Button>}
    </div>

    <Button size="sm" variant="ghost" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>更多筛选与排序</Button>
    {actions && <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">{actions}</div>}
    </div>
    {advancedOpen && <div className="grid grid-cols-2 gap-3 border-t border-border-subtle pt-3 sm:grid-cols-3 xl:grid-cols-6">
        {select('作品类型', 'mediaType', ['游戏', '动画', '漫画', '小说', '影视', '其他'].map((type) => [type, type]))}
        {select('创作类型', 'originType', [['ip', '已有 IP'], ['original', '原创']])}
        {select('外观参考图', 'reference', [['yes', '有可用参考图'], ['no', '无可用参考图']])}
        {select('外观描述', 'appearance', [['yes', '已填写'], ['no', '未填写']])}
        {select('人设演绎', 'interpretation', (facets?.interpretations || []).map((item) => [item, item]))}
        {select('导入来源', 'source', (facets?.sources || []).map((item) => [item, item === 'local' ? '本地角色卡' : item === 'manual' ? '手动创建' : item]))}
        {select('待整理', 'unclassified', [['work', '未设置作品'], ['tags', '未设置标签']])}
        {select('生日状态', 'birthdayStatus', [['known', '生日已知'], ['needs_confirmation', '生日待确认'], ['unset', '未填写生日']])}
        {select('生日月份', 'birthdayMonth', (facets?.birthdayMonths || []).map((month) => [String(month), `${month} 月`]))}
        {select('标签匹配', 'tagMode', [['any', '任一标签'], ['all', '全部标签']])}
        {select('排序', 'sort', [['updated', '最近更新'], ['name', '角色名称']])}
    </div>}
    {!!chips.length && <div className="flex w-full flex-wrap gap-2">
      {chips.map((chip) => (
        <button type="button" key={chip.key} className="rounded bg-accent/10 px-2 py-1 text-sm" onClick={() => clearChip(chip)}>{chip.label} ×</button>
      ))}
    </div>}

  </div>;
}

export function CharacterPagination({ data, onPage }: { data?: CharacterBrowseResult; onPage: (page: number) => void }) {
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // 数据减少导致页码越界时回到最后一个有效页，避免停在空页面。
  useEffect(() => {
    if (data && data.page > pages) onPage(pages);
  }, [data, pages, onPage]);
  if (!data) return null;
  return <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-muted">
    <span>共 {data.total} 位 · 第 {data.page} / {pages} 页</span>
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>上一页</Button>
      <Button size="sm" variant="outline" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>下一页</Button>
    </div>
  </div>;
}
