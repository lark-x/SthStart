import React, { memo } from 'react';
import type { ActorLane } from '../types';

/** 左侧角色轨道列宽度；时间标尺据此避让，两处必须一致。 */
export const ACTOR_LANE_HEADER_WIDTH = 146;

interface ActorLaneHeaderProps {
  actorLanes: ActorLane[];
  viewport: { x: number; y: number; zoom: number };
  containerHeight: number;
}

export const ActorLaneHeader = memo(function ActorLaneHeader({
  actorLanes,
  viewport,
  containerHeight,
}: ActorLaneHeaderProps) {
  // 计算相邻轨道在屏幕上的物理间距
  const laneSpacing =
    actorLanes.length > 1
      ? (actorLanes[1].y - actorLanes[0].y) * viewport.zoom
      : 130 * viewport.zoom;

  // 动态自适应标头卡片高度，严格保证 badgeHeight <= laneSpacing - 4，彻底消除标头重叠
  const badgeHeight = Math.max(18, Math.min(36, laneSpacing - 4));
  const isCompact = badgeHeight < 28;

  return (
    <div
      aria-label="角色轨道列表"
      className="absolute left-0 top-0 bottom-0 pointer-events-none select-none z-10 overflow-hidden"
      style={{
        width: ACTOR_LANE_HEADER_WIDTH,
        backgroundColor: 'color-mix(in srgb, var(--surface) 94%, transparent)',
        backdropFilter: 'blur(8px)',
        borderRight: '1px solid var(--hairline)',
      }}
    >
      {/* 顶部高度严格对齐 TimeRuler 的 32px 高度 */}
      <div
        className="h-8 px-2.5 flex items-center justify-between text-xs font-semibold tracking-wider text-fg-subtle border-b border-hairline"
        style={{ backgroundColor: 'var(--surface-sunken)' }}
      >
        <span className="truncate">角色 ({actorLanes.length})</span>
        <span className="text-xs font-normal text-fg-muted shrink-0">基准</span>
      </div>

      {/* 轨道标头列表：中心点严格对齐 viewport 坐标系下的 lane.y */}
      <div className="relative w-full h-[calc(100%-32px)] overflow-hidden">
        {actorLanes.map(lane => {
          // 在画布置入区域中，绝对 Y 坐标中心点 = lane.y * zoom + viewport.y
          const screenCenterY = lane.y * viewport.zoom + viewport.y;
          const isVisible = screenCenterY > -50 && screenCenterY < containerHeight + 50;

          if (!isVisible) return null;

          return (
            <div
              key={lane.actor.id}
              className="absolute left-1.5 right-1.5 flex items-center gap-1.5 px-2 rounded-lg border border-hairline shadow-2xs pointer-events-auto transition-transform overflow-hidden"
              style={{
                top: screenCenterY,
                transform: 'translateY(-50%)',
                height: badgeHeight,
                backgroundColor: 'var(--surface-raised)',
                borderLeftWidth: 3,
                borderLeftColor: lane.color,
              }}
              title={`${lane.actor.name} (${lane.actor.role === 'main' ? '主角' : '配角'})`}
            >
              <span
                className="flex items-center justify-center rounded-full text-xs font-semibold text-fg-on-accent shrink-0"
                style={{
                  width: isCompact ? 16 : 20,
                  height: isCompact ? 16 : 20,
                  backgroundColor: lane.color,
                }}
              >
                {lane.actor.name.slice(0, 1)}
              </span>

              <div className="min-w-0 flex-1">
                <div
                  className="font-medium truncate leading-tight"
                  style={{
                    color: 'var(--fg-default)',
                    fontSize: 12,
                  }}
                >
                  {lane.actor.name}
                </div>
                {!isCompact ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <span
                      className="text-xs px-1 rounded font-medium"
                      style={{
                        backgroundColor:
                          lane.actor.role === 'main'
                            ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))'
                            : 'var(--surface-sunken)',
                        color:
                          lane.actor.role === 'main'
                            ? 'var(--accent)'
                            : 'var(--fg-muted)',
                      }}
                    >
                      {lane.actor.role === 'main' ? '主角' : '配角'}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
