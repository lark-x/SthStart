'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import type { NarrativeStoryNode, NarrativeWork } from '@sthstart/contracts';
import { Select } from '@/app/components/ui/select';
import { Button } from '@/app/components/ui/button';

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
    <aside className="w-full md:w-64 flex flex-col bg-[#e3ded4] border-r border-[rgb(32_38_49/13%)] max-h-[45dvh] md:max-h-none md:min-h-[calc(100dvh-68px)]">
      <div className="p-4 border-b border-[rgb(32_38_49/11%)] space-y-1.5">
        <label
          htmlFor="narrative-work-select"
          className="block text-[10px] font-bold uppercase tracking-wider text-[#777b7f]"
        >
          当前作品
        </label>
        <Select
          id="narrative-work-select"
          value={selectedWorkId}
          onChange={(e) => onSelectWork(e.target.value)}
          className="bg-[#f5f1e8] text-xs h-9"
        >
          <option value="">尚未选择作品</option>
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </Select>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {orderedNodes.map(({ node, depth }) => {
          const isActive = node.id === selectedNodeId;

          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              style={{ paddingLeft: `${12 + depth * 14}px` }}
              className={`flex flex-col w-full text-left py-2 pr-3 border-l-3 transition-colors cursor-pointer ${
                isActive
                  ? 'border-[#b08a4b] bg-[#f5f1e8]/90 text-[#18201d] font-semibold'
                  : 'border-transparent text-[#343a43] hover:bg-[#f5f1e8]/50'
              }`}
            >
              <span className="text-[9px] uppercase font-bold tracking-widest text-[#898b8d]">
                {node.kind}
              </span>
              <span className="text-xs truncate">{node.title}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[rgb(32_38_49/11%)]">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center bg-transparent border-[rgb(32_38_49/18%)]"
          onClick={onOpenImport}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>导入任务链</span>
        </Button>
      </div>
    </aside>
  );
}
