import React, { memo, useMemo } from 'react';
import type { TimeGap } from '../types';
import { ACTOR_LANE_HEADER_WIDTH } from './actor-lane-header';

/** 刻度标签与角色轨道列之间的最小间隙。 */
const LABEL_LANE_GAP = 4;
/** 10px 等宽字每字约 6px，加左右内边距 12px；按半宽估算标签左缘，避免被角色列盖住。 */
const estimateLabelHalfWidth = (label: string) => label.length * 3 + 6;

interface TimeRulerProps {
  viewport: { x: number; y: number; zoom: number };
  containerWidth: number;
  tickToX: (tick: number) => number;
  xToTick: (x: number) => number;
  gaps: TimeGap[];
  from: number;
  to: number;
  onJumpToTick?(tick: number): void;
}

export const TimeRuler = memo(function TimeRuler({
  viewport,
  containerWidth,
  tickToX,
  xToTick,
  gaps,
  from,
  to,
  onJumpToTick,
}: TimeRulerProps) {
  // 计算当前视口左右边界对应的分钟刻度
  const visibleMinTick = Math.max(0, Math.floor(xToTick(-viewport.x / Math.max(0.01, viewport.zoom))));
  const visibleMaxTick = Math.ceil(xToTick((-viewport.x + containerWidth) / Math.max(0.01, viewport.zoom)));

  // 基于屏幕物理像素间距动态决定刻度步长，确保在任意缩放级别下刻度文字永不重叠碰撞
  const step = useMemo(() => {
    const minPixelSpacing = 115; // 刻度标签在屏幕上的最小安全像素间距（文字宽度约 75px + 留白）
    const effectiveZoom = Math.max(0.1, viewport.zoom);
    // 默认 pixelsPerMinute 为 2.8，屏幕每分钟物理像素 = 2.8 * effectiveZoom
    const screenPxPerMinute = 2.8 * effectiveZoom;
    const minMinutes = minPixelSpacing / screenPxPerMinute;

    const canonicalSteps = [15, 30, 60, 120, 180, 240, 360, 720, 1440];
    for (const s of canonicalSteps) {
      if (s >= minMinutes) return s;
    }
    return 1440;
  }, [viewport.zoom]);

  // 生成可见范围内的刻度点，并附带像素间距硬防撞保护
  const marks = useMemo(() => {
    const list: Array<{ tick: number; x: number; isMajor: boolean; label: string }> = [];
    const start = Math.floor(visibleMinTick / step) * step;
    const end = Math.ceil(visibleMaxTick / step) * step;

    let lastScreenX = -999;
    for (let t = start; t <= end; t += step) {
      if (t < 0) continue;
      const worldX = tickToX(t);
      const screenX = worldX * viewport.zoom + viewport.x;

      const hours = Math.floor(t / 60);
      const mins = t % 60;
      const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      const label = `+${t}m (${timeStr})`;
      // 标签居中于刻度：整段标签都要落在角色轨道列右侧，且与上一个刻度保持安全间距
      const labelLeft = screenX - estimateLabelHalfWidth(label);
      if (labelLeft >= ACTOR_LANE_HEADER_WIDTH + LABEL_LANE_GAP && screenX <= containerWidth + 60) {
        if (screenX - lastScreenX >= 95) {
          lastScreenX = screenX;
          list.push({
            tick: t,
            x: screenX,
            isMajor: t % 60 === 0,
            label,
          });
        }
      }
    }
    return list;
  }, [visibleMinTick, visibleMaxTick, step, tickToX, viewport.zoom, viewport.x, containerWidth]);

  return (
    <div
      role="region"
      aria-label="相对时间标尺"
      className="absolute top-0 left-0 right-0 h-8 select-none z-10 pointer-events-none overflow-hidden"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--surface) 94%, transparent)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      {/* 刻度线与时间标签 */}
      <div className="relative w-full h-full">
        {marks.map(m => (
          <div
            key={m.tick}
            className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-auto cursor-pointer group"
            style={{ left: m.x, transform: 'translateX(-50%)' }}
            onClick={() => onJumpToTick?.(m.tick)}
            title={`点击跳转至相对第 ${m.tick} 分钟`}
          >
            <div
              className="text-xs font-mono font-medium px-1.5 py-0.5 rounded transition-colors whitespace-nowrap group-hover:bg-accent-soft group-hover:text-accent"
              style={{
                color: m.isMajor ? 'var(--fg-default)' : 'var(--fg-subtle)',
                fontWeight: m.isMajor ? 600 : 400,
              }}
            >
              {m.label}
            </div>
            <div
              className="w-px flex-1 mt-auto transition-colors group-hover:bg-accent"
              style={{
                height: m.isMajor ? 8 : 4,
                backgroundColor: m.isMajor ? 'var(--border-strong)' : 'var(--border-subtle)',
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
