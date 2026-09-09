'use client';

import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CharacterBrowseQuery, CharacterBrowseResult } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { browseCharacters } from '../api';

export function useCharacterBrowser(overrides: CharacterBrowseQuery = {}, enabled = true) {
  const [filter, setFilter] = useState<CharacterBrowseQuery>({ page: 1 });
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebouncedQ(filter.q || ''), 250); return () => clearTimeout(timer); }, [filter.q]);
  const request = { ...filter, ...overrides, q: debouncedQ };
  const result = useQuery({ queryKey: ['characters', 'browse', request], queryFn: ({ signal }) => browseCharacters(request, signal), enabled, staleTime: 15_000, placeholderData: keepPreviousData });
  const change = (patch: CharacterBrowseQuery) => setFilter(current => ({ ...current, ...patch, page: patch.page ?? 1 }));
  return { ...result, facets: result.data?.facets, filter, change, reset: () => setFilter({ page: 1 }) };
}
function MultiFilter({ label, values, selected, onChange }: { label: string; values: { value: string; label: string; search?: string }[]; selected: string[]; onChange: (values: string[]) => void }) {
  const [query, setQuery] = useState('');
  return <details className="relative rounded-md border border-[rgb(24_32_29/15%)] bg-surface">
    <summary className="cursor-pointer px-3 py-2 text-sm">{label}{selected.length ? ` (${selected.length})` : ''}</summary>
    <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-[rgb(24_32_29/15%)] bg-surface p-3 shadow-lg">
      <Input aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={query} onChange={e => setQuery(e.target.value)} />
      <div className="mt-2 max-h-48 space-y-1 overflow-auto">
        {values.filter(v => `${v.label} ${v.search || ''}`.toLowerCase().includes(query.toLowerCase())).map(v => <label key={v.value} className="flex cursor-pointer items-center gap-2 py-1 text-sm"><input type="checkbox" checked={selected.includes(v.value)} onChange={e => onChange(e.target.checked ? [...selected, v.value] : selected.filter(s => s !== v.value))} />{v.label}</label>)}
        {!values.length && <p className="text-sm text-muted">暂无可选项</p>}
      </div>
    </div>
  </details>;
}
export function CharacterFilters({ filter, onChange, facets, onReset }: { filter: CharacterBrowseQuery; onChange: (patch: CharacterBrowseQuery) => void; facets?: CharacterBrowseResult['facets']; onReset: () => void }) {
  const select = (label: string, key: keyof CharacterBrowseQuery, options: [string, string][]) => <label className="flex flex-col gap-1 text-sm">{label}<select className="rounded border border-[rgb(24_32_29/15%)] bg-surface px-2 py-2" value={String(filter[key] || '')} onChange={e => onChange({ [key]: e.target.value || undefined })}><option value="">全部</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  return <div className="space-y-3 rounded-lg border border-[rgb(24_32_29/12%)] bg-surface p-3">
    <Input aria-label="搜索角色" placeholder="搜索姓名、英文名、别名、作品或标签…" value={filter.q || ''} onChange={e => onChange({ q: e.target.value })} />
    <div className="flex flex-wrap items-center gap-2">
      <MultiFilter label="作品" values={(facets?.works || []).map(w => ({ value: w.name, label: w.name, search: w.aliases.join(' ') }))} selected={filter.works || []} onChange={works => onChange({ works })} />
      <MultiFilter label="标签" values={[...new Set([...(facets?.tags || []), ...(filter.tags || [])])].map(t => ({ value: t, label: t }))} selected={filter.tags || []} onChange={tags => onChange({ tags })} />
      <MultiFilter label="分组" values={(facets?.groups || []).map(t => ({ value: t, label: t }))} selected={filter.groups || []} onChange={groups => onChange({ groups })} />
      <label className="flex items-center gap-2 px-2 text-sm"><input type="checkbox" checked={filter.favorite || false} onChange={e => onChange({ favorite: e.target.checked })} />仅收藏</label>
      <Button size="sm" variant="ghost" onClick={onReset}>清空筛选</Button>
    </div>
    {(filter.works?.length || filter.tags?.length || filter.groups?.length) ? <div className="flex flex-wrap gap-2">{(['works', 'tags', 'groups'] as const).flatMap(key => (filter[key] || []).map(value => <button type="button" key={`${key}:${value}`} className="rounded bg-accent/10 px-2 py-1 text-sm" onClick={() => onChange({ [key]: filter[key]?.filter(v => v !== value) })}>{value} ×</button>))}</div> : null}
    <details><summary className="cursor-pointer text-sm text-muted">更多筛选与排序</summary><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {select('作品类型', 'mediaType', ['游戏', '动画', '漫画', '小说', '影视', '其他'].map(t => [t, t]))}
      {select('创作类型', 'originType', [['ip', '已有 IP'], ['original', '原创']])}
      {select('外观参考图', 'reference', [['yes', '有可用参考图'], ['no', '无可用参考图']])}
      {select('外观描述', 'appearance', [['yes', '已填写'], ['no', '未填写']])}
      {select('人设演绎', 'interpretation', (facets?.interpretations || []).map(t => [t, t]))}
      {select('导入来源', 'source', (facets?.sources || []).map(t => [t, t === 'local' ? '本地角色卡' : t === 'manual' ? '手动创建' : t]))}
      {select('待整理', 'unclassified', [['work', '未设置作品'], ['tags', '未设置标签']])}
      {select('标签匹配', 'tagMode', [['any', '任一标签'], ['all', '全部标签']])}
      {select('排序', 'sort', [['updated', '最近更新'], ['name', '角色名称']])}
    </div></details>
  </div>;
}
export function CharacterPagination({ data, onPage }: { data?: CharacterBrowseResult; onPage: (page: number) => void }) {
  if (!data) return null;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-muted"><span>共 {data.total} 位 · 第 {data.page} / {pages} 页</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>上一页</Button><Button size="sm" variant="outline" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>下一页</Button></div></div>;
}
