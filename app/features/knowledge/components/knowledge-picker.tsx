'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, FileText, Search } from 'lucide-react';
import type { KnowledgeSearchItem, PlanningReferenceSelection, PlanningReferenceUsage } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { useKnowledgeSearch } from '@/app/features/notebook/queries';
import { authorshipLabels, natureLabels, usageLabels } from '@/app/features/notebook/schemas';

/**
 * 参考资料选择器：这里只搜索、选择与预览实际引用内容。
 * 自动推荐在第三轮由「推荐」按钮触发，本组件不自动联网。
 */
export function KnowledgePicker({ open, onOpenChange, onAdd, initialKeyword, initialKinds }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (selections: Array<{ item: KnowledgeSearchItem; usage: PlanningReferenceUsage }>) => void;
  initialKeyword?: string;
  initialKinds?: Array<'note' | 'narrative'>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加参考资料"
      description="从创作资料库与本地叙事档案里挑选这次企划的参考内容。不会触发联网搜集。"
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
  initialKinds?: Array<'note' | 'narrative'>;
}) {
  const [tab, setTab] = useState<'all' | 'note' | 'narrative'>(initialKinds?.length === 1 ? initialKinds[0] : 'all');
  const [keyword, setKeyword] = useState(initialKeyword ?? '');
  const [debounced, setDebounced] = useState(initialKeyword ?? '');
  const [usage, setUsage] = useState<PlanningReferenceUsage>('background');
  const [picked, setPicked] = useState<Record<string, KnowledgeSearchItem>>({});

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword), 250);
    return () => clearTimeout(timer);
  }, [keyword]);

  const params = useMemo(() => ({
    ...(debounced.trim() ? { q: debounced.trim() } : {}),
    ...(tab === 'all' ? {} : { kinds: [tab] as Array<'note' | 'narrative'> }),
    limit: 40,
  }), [debounced, tab]);
  const results = useKnowledgeSearch(params);

  const items = results.data?.items ?? [];
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
          <Input aria-label="搜索资料" value={keyword} placeholder="搜索资料标题、正文、作品或角色" className="h-9 text-sm" onChange={(event) => setKeyword(event.target.value)} />
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
        onChange={(value) => setTab(value as typeof tab)}
        tabs={[
          { id: 'all', label: '全部' },
          { id: 'note', label: '资料' },
          { id: 'narrative', label: '叙事档案' },
        ]}
      />

      {results.isLoading && <Spinner size="sm" label="正在检索…" />}
      {results.isError && <Alert variant="warning" title="检索失败">{results.error instanceof Error ? results.error.message : '请稍后重试'}。没有资料也可以继续企划。</Alert>}
      {!results.isLoading && !items.length && (
        <Alert variant="info" title="资料库中暂未找到">
          {debounced.trim() ? '换个关键词，或直接把要求写在补充要求里。' : '还没有标记为「可参考」的资料；可以在创作资料库里把资料改成可参考，或先用「仅本次使用」挑选。'}
        </Alert>
      )}

      <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
        {items.map((item) => {
          const key = item.kind + ':' + item.id;
          const selected = Boolean(picked[key]);
          return (
            <li key={key} className={'space-y-1.5 rounded-lg border p-3 ' + (selected ? 'border-accent bg-accent/5' : 'border-border-subtle')}>
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" aria-label={'选择 ' + item.title} checked={selected} onChange={() => toggle(item)} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.kind === 'note' ? <FileText className="h-3.5 w-3.5 text-accent" /> : <BookOpen className="h-3.5 w-3.5 text-info" />}
                    <strong className="truncate text-sm font-semibold text-ink">{item.title}</strong>
                    {!!item.work && <span className="text-xs text-muted">《{item.work}》</span>}
                    <Badge variant="outline" className="text-xs">{item.kind === 'note' ? '资料' : '叙事档案'}</Badge>
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <span className="text-xs text-muted">
          <Search className="mr-1 inline h-3 w-3" />已选 {Object.keys(picked).length} 条
          {results.data?.truncated ? ' · 结果过多已截取' : ''}
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
