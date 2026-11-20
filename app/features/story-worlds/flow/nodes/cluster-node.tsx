import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layers, ZoomIn, MapPin, Users } from 'lucide-react';
import type { ClusterNodeData } from '../types';

export const ClusterNode = memo(function ClusterNode({ data }: NodeProps) {
  const nodeData = data as unknown as ClusterNodeData;
  const { fromTick, toTick, events, locations, participants, onExpand, actorColors } = nodeData;

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExpand(fromTick, toTick);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onExpand(fromTick, toTick);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`聚合时段：包含 ${events.length} 个事件，时间区间：第 ${fromTick} 至 ${toTick} 分钟。点击或按回车展开`}
      onClick={handleExpand}
      onKeyDown={handleKeyDown}
      className="story-flow-cluster-node group relative transition-all duration-150 select-none outline-none cursor-pointer hover:shadow-sm"
      style={{
        width: 196,
        height: 92,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-panel)',
        backgroundColor: 'var(--surface-raised)',
        border: '1.5px dashed var(--border-default)',
        boxShadow: 'var(--elev-xs)',
        padding: '8px 10px',
      }}
    >
      {/* 动态角色连线桩 Handles (支持聚合时段轨迹跨卡片平滑穿流) */}
      {participants.map((p, idx) => {
        const percent =
          participants.length === 1
            ? 50
            : Math.round(((idx + 1) / (participants.length + 1)) * 100);
        const color = actorColors?.[p.id] || 'var(--accent)';
        return (
          <React.Fragment key={p.id}>
            <Handle
              type="target"
              position={Position.Left}
              id={`actor-in-${p.id}`}
              style={{
                top: `${percent}%`,
                left: -4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: color,
                border: '1.5px solid var(--surface-raised)',
                boxShadow: '0 0 0 1px var(--hairline)',
              }}
              isConnectable={false}
            />
            <Handle
              type="source"
              position={Position.Right}
              id={`actor-out-${p.id}`}
              style={{
                top: `${percent}%`,
                right: -4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: color,
                border: '1.5px solid var(--surface-raised)',
                boxShadow: '0 0 0 1px var(--hairline)',
              }}
              isConnectable={false}
            />
          </React.Fragment>
        );
      })}

      {/* 通用聚合桩（保底） */}
      <Handle
        type="target"
        position={Position.Left}
        id="cluster-in"
        style={{
          width: 7,
          height: 7,
          backgroundColor: 'var(--border-control)',
          opacity: participants.length > 0 ? 0 : 1,
        }}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="cluster-out"
        style={{
          width: 7,
          height: 7,
          backgroundColor: 'var(--border-control)',
          opacity: participants.length > 0 ? 0 : 1,
        }}
        isConnectable={false}
      />

      {/* 头部：时间区间与高对比度事件总数徽标 */}
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <div
          className="inline-flex items-center font-mono font-medium px-1.5 py-0.5 rounded text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface-sunken)',
            color: 'var(--fg-muted)',
          }}
        >
          <span>+{fromTick}m~+{toTick}m</span>
        </div>

        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold shrink-0"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
            color: 'var(--accent)',
          }}
        >
          <Layers className="w-3 h-3" />
          <span>{events.length} 个事件</span>
        </span>
      </div>

      {/* 地点与参与角色 */}
      <div className="space-y-1 mb-1.5">
        {locations.length > 0 ? (
          <div className="flex items-center gap-1 text-xs truncate" style={{ color: 'var(--fg-muted)' }}>
            <MapPin className="w-2.5 h-2.5 shrink-0 text-fg-subtle" />
            <span className="truncate">{locations.map(l => l.name).join('、')}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-1 text-xs">
          <div className="flex items-center gap-1">
            <Users className="w-2.5 h-2.5 text-fg-subtle shrink-0" />
            <div className="flex items-center -space-x-1">
              {participants.slice(0, 4).map(p => {
                const color = actorColors[p.id] || 'var(--accent)';
                return (
                  <span
                    key={p.id}
                    className="inline-block w-3 h-3 rounded-full ring-1 ring-surface-raised"
                    style={{ backgroundColor: color }}
                    title={p.name}
                  >
                  </span>
                );
              })}
            </div>
          </div>
          <span className="text-xs text-fg-subtle truncate">
            {participants.length} 位角色
          </span>
        </div>
      </div>

      {/* 底部展开动作指引 */}
      <div
        className="flex items-center justify-center gap-1 text-xs font-medium py-0.5 rounded transition-colors group-hover:bg-accent-soft group-hover:text-accent"
        style={{
          backgroundColor: 'var(--surface-sunken)',
          color: 'var(--fg-default)',
        }}
      >
        <ZoomIn className="w-2.5 h-2.5 text-accent" />
        <span>点击展开细化</span>
      </div>
    </div>
  );
});
