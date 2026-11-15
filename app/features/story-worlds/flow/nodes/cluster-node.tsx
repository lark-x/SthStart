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
        borderRadius: 'var(--radius-panel, 10px)',
        backgroundColor: 'var(--surface-raised, #ffffff)',
        border: '1.5px dashed var(--border-default, #d8d2c6)',
        boxShadow: 'var(--elev-xs, 0 1px 3px rgba(0,0,0,0.04))',
        padding: '8px 10px',
      }}
    >
      {/* 动态角色连线桩 Handles (支持聚合时段轨迹跨卡片平滑穿流) */}
      {participants.map((p, idx) => {
        const percent =
          participants.length === 1
            ? 50
            : Math.round(((idx + 1) / (participants.length + 1)) * 100);
        const color = actorColors?.[p.id] || 'var(--accent, #665995)';
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
                border: '1.5px solid var(--surface-raised, #ffffff)',
                boxShadow: '0 0 0 1px var(--hairline, rgba(31,30,28,0.1))',
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
                border: '1.5px solid var(--surface-raised, #ffffff)',
                boxShadow: '0 0 0 1px var(--hairline, rgba(31,30,28,0.1))',
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
          backgroundColor: 'var(--border-control, #837c70)',
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
          backgroundColor: 'var(--border-control, #837c70)',
          opacity: participants.length > 0 ? 0 : 1,
        }}
        isConnectable={false}
      />

      {/* 头部：时间区间与高对比度事件总数徽标 */}
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <div
          className="inline-flex items-center font-mono font-medium px-1.5 py-0.5 rounded text-[10px] shrink-0"
          style={{
            backgroundColor: 'var(--surface-sunken, #ebe7df)',
            color: 'var(--fg-muted, #5a564f)',
          }}
        >
          <span>+{fromTick}m~+{toTick}m</span>
        </div>

        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent, #665995) 12%, var(--surface, #fcfbf8))',
            color: 'var(--accent, #665995)',
          }}
        >
          <Layers className="w-3 h-3" />
          <span>{events.length} 个事件</span>
        </span>
      </div>

      {/* 地点与参与角色 */}
      <div className="space-y-1 mb-1.5">
        {locations.length > 0 ? (
          <div className="flex items-center gap-1 text-[10px] truncate" style={{ color: 'var(--fg-muted, #5a564f)' }}>
            <MapPin className="w-2.5 h-2.5 shrink-0 text-fg-subtle" />
            <span className="truncate">{locations.map(l => l.name).join('、')}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-1 text-[10px]">
          <div className="flex items-center gap-1">
            <Users className="w-2.5 h-2.5 text-fg-subtle shrink-0" />
            <div className="flex items-center -space-x-1">
              {participants.slice(0, 4).map(p => {
                const color = actorColors[p.id] || 'var(--accent, #665995)';
                return (
                  <span
                    key={p.id}
                    className="inline-flex items-center justify-center w-3 h-3 rounded-full text-[7px] font-bold text-white ring-1 ring-white"
                    style={{ backgroundColor: color }}
                    title={p.name}
                  >
                    {p.name.slice(0, 1)}
                  </span>
                );
              })}
            </div>
          </div>
          <span className="text-[10px] text-fg-subtle truncate">
            {participants.length} 位角色
          </span>
        </div>
      </div>

      {/* 底部展开动作指引 */}
      <div
        className="flex items-center justify-center gap-1 text-[10px] font-medium py-0.5 rounded transition-colors group-hover:bg-accent-soft group-hover:text-accent"
        style={{
          backgroundColor: 'var(--surface-sunken, #ebe7df)',
          color: 'var(--fg-default, #2b2925)',
        }}
      >
        <ZoomIn className="w-2.5 h-2.5 text-accent" />
        <span>点击展开细化</span>
      </div>
    </div>
  );
});
