import React, { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { TrajectoryEdgeData } from '../types';

export const ActorTrajectoryEdge = memo(function ActorTrajectoryEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = data as unknown as TrajectoryEdgeData | undefined;
  const isSelected = Boolean(edgeData?.isSelected);
  const color = edgeData?.color || 'var(--border-default)';

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  });

  return (
    <>
      {/* 底部微阴影层或选中光晕 */}
      {isSelected ? (
        <path
          d={edgePath}
          fill="none"
          stroke="var(--accent-ring)"
          strokeWidth={8}
          strokeLinecap="round"
          className="pointer-events-none transition-all"
        />
      ) : null}

      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: color,
          strokeWidth: isSelected ? 3 : 2,
          strokeDasharray: isSelected ? '6 4' : undefined,
          opacity: isSelected ? 1 : 0.85,
          transition: 'stroke 0.2s, stroke-width 0.2s, opacity 0.2s',
        }}
      />

      {/* 连线中点角色身份提示胶囊（仅在被选中或悬停时显示） */}
      {isSelected && edgeData?.actorName ? (
        <foreignObject
          width={80}
          height={24}
          x={labelX - 40}
          y={labelY - 12}
          className="pointer-events-none"
        >
          <div
            className="flex items-center justify-center h-full px-2 py-0.5 rounded-full text-xs font-semibold text-fg-on-accent shadow-xs select-none"
            style={{ backgroundColor: color }}
          >
            <span className="truncate">{edgeData.actorName}</span>
          </div>
        </foreignObject>
      ) : null}
    </>
  );
});
