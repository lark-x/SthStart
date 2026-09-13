'use client';

import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { NarrativeSearchResult } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';

/**
 * 原文检索详情栏（§8.9）：按需打开，宽屏为右栏、窄屏在主区之后单独展开。
 * 输入使用 300ms 防抖后才上抛，避免中文 IME 组合期间逐键打爆检索接口。
 */
export function NarrativeInspector({
  query,
  onQueryChange,
  results,
  onSelectResult,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: NarrativeSearchResult[];
  onSelectResult: (res: NarrativeSearchResult) => void;
}) {
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    if (draft === query) return;
    const timer = setTimeout(() => onQueryChange(draft), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // 父组件可能绕过输入框直接修改 query（如程序化重置）；此时在渲染期把
  // draft 同步回外部值。用“记录上一次 query”的方式比较，而不是在 effect 里
  // setState：后者会多渲染一帧，也被 react-hooks/set-state-in-effect 禁止。
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setDraft(query);
  }

  return (
    <aside className="flex max-h-[50dvh] w-full flex-col bg-surface-muted md:max-h-none md:h-full md:w-72 md:flex-none md:border-l md:border-border-subtle">
      <div className="shrink-0 border-b border-border-subtle p-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="搜索当前作品原文…"
            aria-label="搜索当前作品原文"
            className="h-9 bg-surface pl-9 text-sm"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {query ? (
          <div className="space-y-2">
            <p className="text-xs text-fg-subtle">检索结果 · {results.length} 条</p>
            {results.map((r) => (
              <button
                key={`${r.kind}-${r.refId}`}
                type="button"
                onClick={() => onSelectResult(r)}
                className="w-full space-y-1 rounded-[var(--radius-control)] border border-border-subtle bg-surface p-2.5 text-left transition-colors hover:bg-surface-hover"
              >
                <strong className="block text-sm font-semibold text-ink">
                  {r.title || r.kind}
                </strong>
                <p className="line-clamp-2 text-sm leading-relaxed text-muted">
                  {r.excerpt.replace(/<\/?mark>/g, '')}
                </p>
              </button>
            ))}
            {results.length === 0 && (
              <p className="py-6 text-center text-sm text-fg-subtle">未找到相关原文片段</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="tpl-section-title text-base">来源与关联</h3>
            <p className="text-sm leading-relaxed text-muted">
              输入关键词可检索当前作品的原文片段，选中结果会跳回对应剧情节点。
            </p>
            <dl className="space-y-2 border-t border-border-subtle pt-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">原始资料</dt>
                <dd className="font-medium text-ink">只读出处</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">AI 提取</dt>
                <dd className="font-medium text-ink">需人工复核</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">笔记引用</dt>
                <dd className="font-medium text-ink">保留快照</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </aside>
  );
}
