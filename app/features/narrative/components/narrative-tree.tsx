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
  const depthMap = React.useMemo(() => {
    const map = new Map<string, number>();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    for (const node of nodes) {
      let d = 0;
      let curr = node.parentId;
      while (curr && d < 8) {
        d += 1;
        curr = nodeMap.get(curr)?.parentId ?? null;
      }
      map.set(node.id, d);
    }
    return map;
  }, [nodes]);

  return (
    <aside className="w-full md:w-64 flex flex-col bg-[#e3ded4] border-r border-[rgb(32_38_49/13%)] min-h-[calc(100dvh-68px)]">
      <div className="p-4 border-b border-[rgb(32_38_49/11%)] space-y-1.5">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#777b7f]">
          当前作品
        </label>
        <Select
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
        {nodes.map((node) => {
          const depth = depthMap.get(node.id) ?? 0;
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
