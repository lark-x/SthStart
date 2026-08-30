'use client';

import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { NarrativeSearchResult } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';

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
  // 搜索直接驱动网络请求，逐键请求会打爆 FTS 查询（中文 IME 组合期间
  // 尤甚）；本地持有输入文本，300ms 防抖后才上抛。
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    if (draft === query) return;
    const timer = setTimeout(() => onQueryChange(draft), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <aside className="w-full md:w-72 bg-[#e3ded4] border-l border-[rgb(32_38_49/13%)] p-5 space-y-6">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-3 text-[#777b7f]" aria-hidden="true" />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="搜索当前作品原文…"
          className="pl-9 bg-[#f5f1e8] text-xs h-9 border-[rgb(32_38_49/15%)]"
        />
      </div>

      {query ? (
        <div className="space-y-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#85888c] block">
            SEARCH RESULTS · {results.length}
          </span>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {results.map((r) => (
              <button
                key={`${r.kind}-${r.refId}`}
                type="button"
                onClick={() => onSelectResult(r)}
                className="w-full text-left p-2.5 rounded bg-[#f5f1e8] hover:bg-white transition-colors border-b border-[rgb(32_38_49/10%)] cursor-pointer space-y-1"
              >
                <strong className="text-xs font-semibold text-[#18201d] block">
                  {r.title || r.kind}
                </strong>
                <p className="text-[11px] text-[#6d7278] line-clamp-2 leading-relaxed">
                  {r.excerpt.replace(/<\/?mark>/g, '')}
                </p>
              </button>
            ))}
            {results.length === 0 && (
              <p className="text-xs text-[#777b7f] text-center py-6">未找到相关原文片段</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8a6a35] block">
              CONTEXT
            </span>
            <h3 className="font-serif text-xl font-medium text-[#202631] mt-1">研究侧栏</h3>
            <p className="text-xs text-[#70747a] leading-relaxed mt-1">
              实体、事件和已确认结论将在这里随当前场景联动。
            </p>
          </div>

          <div className="pt-3 border-t border-[rgb(32_38_49/10%)] space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[rgb(32_38_49/8%)]">
              <span className="text-[#70747a]">原始资料</span>
              <strong className="text-[#7e5e30]">只读出处</strong>
            </div>
            <div className="flex justify-between py-1 border-b border-[rgb(32_38_49/8%)]">
              <span className="text-[#70747a]">AI 提取</span>
              <strong className="text-[#7e5e30]">需人工复核</strong>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#70747a]">笔记引用</span>
              <strong className="text-[#7e5e30]">保留快照</strong>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

