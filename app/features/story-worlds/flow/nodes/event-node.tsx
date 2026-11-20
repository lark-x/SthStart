import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Clock, MapPin, Users, Sparkles } from 'lucide-react';
import type { EventNodeData } from '../types';

export const EventNode = memo(function EventNode({ data }: NodeProps) {
  const nodeData = data as unknown as EventNodeData;
  const { event, location, participants, isSelected, onSelect, actorColors, isShared } = nodeData;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(event.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(event.id);
    }
  };

  const participantCount = participants.length;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`事件节点：${event.title}，相对时间：第 ${event.tick} 分钟，地点：${location?.name || '未知地点'}`}
      aria-selected={isSelected}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`story-flow-event-node group relative transition-all duration-150 select-none outline-none ${
        isSelected ? 'is-selected' : ''
      } ${isShared ? 'is-shared' : ''}`}
      style={{
        width: 230,
        height: 116,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-panel)',
        backgroundColor: 'var(--surface)',
        borderWidth: isSelected ? '1.5px' : '1px',
        borderStyle: 'solid',
        borderColor: isSelected ? 'var(--accent)' : 'var(--hairline)',
        boxShadow: isSelected
          ? '0 0 0 3px var(--accent-ring), var(--elev-md)'
          : 'var(--elev-xs)',
        padding: '8px 12px',
      }}
    >
      {/* 动态角色连线桩 Handles (每个参与角色分配独立的左入/右出桩，杜绝连线重叠) */}
      {participants.map((p, idx) => {
        const percent = participantCount === 1 ? 50 : Math.round(((idx + 1) / (participantCount + 1)) * 100);
        const color = actorColors[p.id] || 'var(--accent)';
        return (
          <React.Fragment key={p.id}>
            <Handle
              type="target"
              position={Position.Left}
              id={`actor-in-${p.id}`}
              style={{
                top: `${percent}%`,
                left: -5,
                width: 9,
                height: 9,
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
                right: -5,
                width: 9,
                height: 9,
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

      {/* 顶部元信息栏：时间刻度与地点徽标 */}
      <div className="flex items-center justify-between text-xs mb-1.5 gap-1.5">
        <div
          className="inline-flex items-center gap-1 font-mono font-medium px-1.5 py-0.5 rounded text-xs"
          style={{
            backgroundColor: 'var(--surface-sunken)',
            color: 'var(--fg-muted)',
          }}
        >
          <Clock className="w-3 h-3 text-fg-subtle" />
          <span>+{event.tick}m</span>
        </div>

        {location ? (
          <div
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs truncate max-w-27.5"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--tone-blue) 10%, var(--surface))',
              color: 'var(--tone-blue)',
            }}
            title={location.name}
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{location.name}</span>
          </div>
        ) : null}
      </div>

      {/* 标题 */}
      <div
        className="font-semibold text-sm leading-snug line-clamp-1 mb-1 tracking-tight"
        style={{ color: 'var(--fg-default)' }}
        title={event.title}
      >
        {event.title}
      </div>

      {/* 概要简述 */}
      {event.summary ? (
        <div
          className="text-xs leading-relaxed line-clamp-2 mb-2"
          style={{ color: 'var(--fg-muted)' }}
        >
          {event.summary}
        </div>
      ) : null}

      {/* 底部角色徽章与事实计数 */}
      <div className="flex items-center justify-between pt-1 border-t border-hairline mt-auto">
        <div className="flex items-center gap-1 overflow-hidden" title="参与角色">
          <Users className="w-3 h-3 text-fg-subtle shrink-0" />
          <div className="flex items-center -space-x-1.5">
            {participants.map(p => {
              const color = actorColors[p.id] || 'var(--accent)';
              return (
                <span
                  key={p.id}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-semibold text-fg-on-accent shadow-xs ring-1 ring-surface-raised"
                  style={{ backgroundColor: color }}
                  title={`${p.name} (${p.role === 'main' ? '主角' : '配角'})`}
                >
                  {p.name.slice(0, 1)}
                </span>
              );
            })}
          </div>
          {participants.length > 0 ? (
            <span
              className="text-xs truncate max-w-20"
              style={{ color: 'var(--fg-subtle)' }}
            >
              {participants.map(p => p.name).join('、')}
            </span>
          ) : null}
        </div>

        {event.facts && event.facts.length > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-xs font-medium px-1 py-0.5 rounded"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--tone-green) 10%, var(--surface))',
              color: 'var(--tone-green)',
            }}
            title={`${event.facts.length} 条已核实事实`}
          >
            <Sparkles className="w-2.5 h-2.5" />
            <span>{event.facts.length}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
});
