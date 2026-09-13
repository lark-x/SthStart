'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import type { NarrativeStoryNode, NarrativeWork } from '@sthstart/contracts';
import { Select } from '@/app/components/ui/select';
import { Button } from '@/app/components/ui/button';
import { cn } from '@/app/lib/cn';

/**
 * 目录树（§8.9）：作品选择 + 章节/任务目录 + 导入入口。
 *
 * 宽屏由工作区渲染为常驻左栏；窄屏默认收起，由页头「目录」按钮单独打开，
 * 避免树、正文与详情顺序堆成极长页面。
 */
export function NarrativeTree({
  works,
  selectedWorkId,
  onSelectWork,
  nodes,
  selectedNodeId,
  onSelectNode,
  onOpenImport,
}: {
  works: NarrativeWork[];
  selectedWorkId: string;
  onSelectWork: (workId: string) => void;
  nodes: NarrativeStoryNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onOpenImport: () => void;
}) {
  // 服务端按全局 sort_order,title 返回平铺列表，而导入数据的 order 是
  // “同一父节点内”的序号；直接渲染会把子节点插到别的章节下面。这里按
  // 父子关系重建 DFS 先序，保证缩进与层级一致。
  const orderedNodes = React.useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const childrenMap = new Map<string | null, NarrativeStoryNode[]>();
    for (const node of nodes) {
      const parentKey = node.parentId && nodeMap.has(node.parentId) ? node.parentId : null;
      const bucket = childrenMap.get(parentKey);
      if (bucket) bucket.push(node);
      else childrenMap.set(parentKey, [node]);
    }
    const byOrder = (a: NarrativeStoryNode, b: NarrativeStoryNode) =>
      a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'zh-Hans-CN');
    for (const bucket of childrenMap.values()) bucket.sort(byOrder);
    const result: Array<{ node: NarrativeStoryNode; depth: number }> = [];
    const visit = (parentKey: string | null, depth: number) => {
      for (const node of childrenMap.get(parentKey) ?? []) {
        result.push({ node, depth });
        visit(node.id, depth + 1);
      }
    };
    visit(null, 0);
    // 深度上限 8 层，超出按 8 层缩进；出现环导致漏掉的节点兜底追加。
    const seen = new Set<string>();
    for (const entry of result) {
      entry.depth = Math.min(entry.depth, 8);
      seen.add(entry.node.id);
    }
    for (const node of nodes) {
      if (!seen.has(node.id)) result.push({ node, depth: 0 });
    }
    return result;
  }, [nodes]);

  return (
    <aside className="flex max-h-[45dvh] w-full flex-col bg-surface-muted md:max-h-none md:h-full md:w-64 md:flex-none md:border-r md:border-border-subtle">
      <div className="shrink-0 space-y-1.5 border-b border-border-subtle p-3">
        <label
          htmlFor="narrative-work-select"
          className="block text-xs font-semibold text-fg-subtle"
        >
          当前作品
        </label>
        <Select
          id="narrative-work-select"
          value={selectedWorkId}
          onChange={(e) => onSelectWork(e.target.value)}
          className="h-9 bg-surface text-sm"
        >
          <option value="">尚未选择作品</option>
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </Select>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="剧情目录">
        {orderedNodes.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-fg-subtle">这部作品还没有导入章节。</p>
        )}
        {orderedNodes.map(({ node, depth }) => {
          const isActive = node.id === selectedNodeId;

          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              style={{ paddingLeft: `${12 + depth * 14}px` }}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 border-l-2 py-1.5 pr-3 text-left transition-colors',
                isActive
                  ? 'border-accent bg-surface'
                  : 'border-transparent hover:bg-surface-hover',
              )}
            >
              <span className="text-xs text-fg-subtle">{node.kind}</span>
              <span className={cn('w-full truncate text-sm', isActive ? 'font-semibold text-ink' : 'text-muted')}>
                {node.title}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-border-subtle p-3">
        <Button variant="outline" size="sm" className="w-full justify-center" onClick={onOpenImport}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>导入任务链</span>
        </Button>
      </div>
    </aside>
  );
}
