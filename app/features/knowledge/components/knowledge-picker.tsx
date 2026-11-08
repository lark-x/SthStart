'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, Search } from 'lucide-react';
import type { KnowledgeSearchItem, KnowledgeSearchKind, PlanningReferenceSelection, PlanningReferenceUsage } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Pagination } from '@/app/components/ui/pagination';
import { useKnowledgeSearch } from '@/app/features/notebook/queries';
import { authorshipLabels, natureLabels, usageLabels } from '@/app/features/notebook/schemas';

const PAGE_SIZES = [20, 50, 100] as const;
const kindLabels: Record<KnowledgeSearchKind, string> = { note: '资料', narrative: '叙事档案', topic: '灵感素材', collection: '搜集结果' };

/**
 * 参考资料选择器：这里只搜索、选择与预览实际引用内容。
 * 自动推荐在第三轮由「推荐」按钮触发，本组件不自动联网。
 */
export function KnowledgePicker({ open, onOpenChange, onAdd, initialKeyword, initialKinds }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (selections: Array<{ item: KnowledgeSearchItem; usage: PlanningReferenceUsage }>) => void;
  initialKeyword?: string;
  initialKinds?: KnowledgeSearchKind[];
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加参考资料"
      description="从资料库与本地原作文本中挑选参考内容，保留来源性质和采用时的内容。"
      className="max-w-4xl"
    >
      {open && <PickerBody onAdd={onAdd} onClose={() => onOpenChange(false)} initialKeyword={initialKeyword} initialKinds={initialKinds} />}
    </Dialog>
  );
}

function PickerBody({ onAdd, onClose, initialKeyword, initialKinds }: {
  onAdd: (selections: Array<{ item: KnowledgeSearchItem; usage: PlanningReferenceUsage }>) => void;
  onClose: () => void;
  initialKeyword?: string;
  initialKinds?: KnowledgeSearchKind[];
}) {
  const [tab, setTab] = useState<'all' | KnowledgeSearchKind>(initialKinds?.length === 1 ? initialKinds[0] : 'all');
  const [keyword, setKeyword] = useState(initialKeyword ?? '');
  const [debounced, setDebounced] = useState(initialKeyword ?? '');
  const [composing, setComposing] = useState(false);
  const [usage, setUsage] = useState<PlanningReferenceUsage>('background');
  const [picked, setPicked] = useState<Record<string, KnowledgeSearchItem>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (composing || keyword.trim() === debounced.trim()) return;
    const timer = setTimeout(() => { setDebounced(keyword.trim()); setPage(1); listRef.current?.scrollTo({ top: 0 }); }, 250);
    return () => clearTimeout(timer);
  }, [keyword, debounced, composing]);

  const params = useMemo(() => ({
    ...(debounced.trim() ? { q: debounced.trim() } : {}),
    ...(tab === 'all' ? {} : { kinds: [tab] }),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  }), [debounced, tab, page, pageSize]);
  const results = useKnowledgeSearch(params);

  const items = results.data?.items ?? [];
  const searchPending = composing || keyword.trim() !== debounced.trim();
  const loading = results.isFetching || searchPending;
  const changePage = (next: number) => { setPage(next); listRef.current?.scrollTo({ top: 0 }); };
  const toggle = (item: KnowledgeSearchItem) => {
    const key = item.kind + ':' + item.id;
    setPicked((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = item;
      return next;
    });
  };

  const confirm = () => {
    const selections = Object.values(picked).map((item) => ({ item, usage }));
    if (!selections.length) return;
    onAdd(selections);
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 space-y-1">
          <span className="text-xs text-muted">关键词</span>
          <Input aria-label="搜索资料" value={keyword} placeholder="搜索资料标题、正文、作品或角色" className="h-9 text-sm" onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={(event) => setKeyword(event.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">用途</span>
          <Select aria-label="引用用途" value={usage} className="h-9 text-sm" onChange={(event) => setUsage(event.target.value as PlanningReferenceUsage)}>
            <option value="background">背景参考</option>
            <option value="requirement">本次要求</option>
          </Select>
        </label>
      </div>
      <PageTabs
        ariaLabel="资料与叙事"
        value={tab}
        onChange={(value) => { setTab(value as typeof tab); changePage(1); }}
        tabs={[
          { id: 'all', label: '全部' },
          { id: 'note', label: '资料' },
          { id: 'narrative', label: '叙事档案' },
          { id: 'topic', label: '灵感素材' },
          { id: 'collection', label: '搜集结果' },
        ]}
      />

      {loading && <Spinner size="sm" label="正在检索…" />}
      {results.isError && <Alert variant="warning" title="检索失败">{results.error instanceof Error ? results.error.message : '请稍后重试'}。已选资料仍然保留。<Button variant="ghost" size="sm" onClick={() => void results.refetch()}>重试</Button></Alert>}
      {!results.isFetching && !results.isError && !searchPending && !items.length && (
        <Alert variant="info" title="资料库中暂未找到">
          {debounced.trim() ? '没有匹配内容，请尝试其他关键词。' : '还没有可参考资料。请在资料库打开笔记，将「资料属性」中的使用状态设为「可参考」；也可以直接从笔记的「加入项目」按钮选用。'}
        </Alert>
      )}

      <ul ref={listRef} aria-busy={loading} className="max-h-[45vh] space-y-2 overflow-y-auto">
        {items.map((item) => {
          const key = item.kind + ':' + item.id;
          const selected = Boolean(picked[key]);
          return (
            <li key={key} className={'space-y-1.5 rounded-lg border p-3 ' + (selected ? 'border-accent bg-accent/5' : 'border-border-subtle')}>
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" aria-label={'选择 ' + item.title} checked={selected} disabled={loading} onChange={() => toggle(item)} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.kind === 'note' ? <FileText className="h-3.5 w-3.5 text-accent" /> : <BookOpen className="h-3.5 w-3.5 text-info" />}
                    <strong className="truncate text-sm font-semibold text-ink">{item.title}</strong>
                    {!!item.work && <span className="text-xs text-muted">《{item.work}》</span>}
                    <Badge variant="outline" className="text-xs">{kindLabels[item.kind]}</Badge>
                    {item.usage && <Badge variant={item.usage === 'reference' ? 'online' : 'stopped'} className="text-xs">{usageLabels[item.usage as keyof typeof usageLabels] ?? item.usage}</Badge>}
                    {item.nature && <Badge variant="secondary" className="text-xs">{natureLabels[item.nature as keyof typeof natureLabels] ?? item.nature}</Badge>}
                    {item.authorship && <span className="text-xs text-muted">{authorshipLabels[item.authorship as keyof typeof authorshipLabels] ?? item.authorship}</span>}
                  </div>
                  <p className="text-sm text-muted">{item.excerpt}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {results.data && !results.isError && <Pagination total={results.data.total} page={page} pageSize={pageSize} compact loading={loading} pageSizeOptions={PAGE_SIZES} onPageChange={changePage} onPageSizeChange={(size) => { setPageSize(size); changePage(1); }} />}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <span className="text-xs text-muted">
          <Search className="mr-1 inline h-3 w-3" />已选 {Object.keys(picked).length} 条
          {Object.keys(picked).length > 0 ? ' · 已选项跨页保留' : ''}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!Object.keys(picked).length} onClick={confirm}>添加所选项</Button>
        </div>
      </div>
    </div>
  );
}

export type { PlanningReferenceSelection };
