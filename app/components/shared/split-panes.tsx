'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * 双栏工作区：两栏各自成为**独立滚动区域**。
 *
 * 核心工程物理学（逆向吸收自 Claude Design System）:
 * 1. 视口自适应测高与独立滚动（保持现有 --split-available 变量注入）；
 * 2. 指针捕获与 Iframe 事件防吞噬护盾 (setPointerCapture + 全局防穿透遮罩)；
 * 3. 4px 移动死区 (Dead-Zone) 过滤点击微颤；
 * 4. Escape 键盘撤销拖拽回退机制；
 * 5. 双击 50/50 平滑吸附复位；
 * 6. 严苛的最小宽度钳制 (Min-Max Clamping)；
 * 7. 移动端/小屏模式优雅回退（保留 from 断点特性，小屏自动堆叠且不渲染手柄）。
 */

const BOTTOM_GUTTER = 24;
const MIN_AVAILABLE = 360;
const DEAD_ZONE = 4;

export type SplitFrom = 'lg' | 'xl';

export interface SplitPanesProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** 栅格定义（含响应式列数与间距），例如 'lg:grid-cols-[minmax(0,1fr)_360px]'。 */
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
  /** 从哪个断点起启用独立滚动与双栏，需与列数断点一致。 */
  from?: SplitFrom;
  /** 可访问性：两栏的区域名。 */
  labels?: { left?: string; right?: string };
  /** 是否启用双栏自由拖拽调节与 50/50 吸附物理学 (默认 false) */
  resizable?: boolean;
  /** 本地缓存键名（传入则自动持久化用户调整的比例） */
  storageKey?: string;
  /** 初始比例 (0.1 ~ 0.9，默认 0.5) */
  defaultSplitRatio?: number;
  /** 左栏最小像素宽度 (默认 260) */
  minLeftWidth?: number;
  /** 右栏最小像素宽度 (默认 260) */
  minRightWidth?: number;
  /** 比例变动回调 */
  onSplitChange?: (ratio: number) => void;
}

export function SplitPanes({
  left,
  right,
  className,
  leftClassName,
  rightClassName,
  from = 'lg',
  labels,
  resizable = false,
  storageKey,
  defaultSplitRatio = 0.5,
  minLeftWidth = 260,
  minRightWidth = 260,
  onSplitChange,
}: SplitPanesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    if (typeof window !== 'undefined' && storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = parseFloat(saved);
          if (!Number.isNaN(parsed) && parsed >= 0.1 && parsed <= 0.9) {
            return parsed;
          }
        }
      } catch {}
    }
    return defaultSplitRatio;
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const activePointerRef = useRef<{ id: number; target: HTMLElement } | null>(null);

  const pointerStartRef = useRef<{
    x: number;
    ratio: number;
    hasExceededDeadZone: boolean;
  } | null>(null);
  const previousRatioRef = useRef<number>(splitRatio);

  // 1. 响应式断点侦测：仅在屏幕宽度满足 from 时启用大屏双栏与拖拽
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(from === 'xl' ? '(min-width: 1280px)' : '(min-width: 1024px)');
    const updateWide = () => setIsWide(mediaQuery.matches);
    updateWide();
    mediaQuery.addEventListener('change', updateWide);
    return () => mediaQuery.removeEventListener('change', updateWide);
  }, [from]);

  // 2. 测量文档坐标与可用高度
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastAvailable = Number.NaN;

    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const available = Math.max(0, window.innerHeight - top - BOTTOM_GUTTER);
      el.dataset.short = String(available < MIN_AVAILABLE);
      if (Math.abs(available - lastAvailable) < 1) return;
      lastAvailable = available;
      el.style.setProperty('--split-available', `${Math.round(available)}px`);
    };

    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, []);

  // 3. 双击分割手柄：复位至 50/50 基准
  const handleDoubleClick = useCallback(() => {
    if (!resizable || !isWide) return;
    setSplitRatio(0.5);
    onSplitChange?.(0.5);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, '0.5');
      } catch {}
    }
  }, [resizable, isWide, storageKey, onSplitChange]);

  // 4. 指针按下 (Pointer Down)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!resizable || !isWide || e.button !== 0) return;
    e.preventDefault();

    pointerStartRef.current = {
      x: e.clientX,
      ratio: splitRatio,
      hasExceededDeadZone: false,
    };
    previousRatioRef.current = splitRatio;
    activePointerRef.current = { id: e.pointerId, target: e.target as HTMLElement };

    // 捕获全局指针，防止光标滑出手柄导致事件丢失
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  // 5. 指针移动 (Pointer Move)：包含 4px 死区与 Min-Max 边界钳制
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointerStartRef.current || !containerRef.current) return;

      const deltaX = e.clientX - pointerStartRef.current.x;

      // 4px 死区检测，过滤手抖与误触点击
      if (!pointerStartRef.current.hasExceededDeadZone) {
        if (Math.abs(deltaX) < DEAD_ZONE) {
          return;
        }
        pointerStartRef.current.hasExceededDeadZone = true;
        setIsDragging(true);
      }

      const containerWidth = containerRef.current.offsetWidth;
      if (containerWidth <= 0) return;

      let rawRatio = pointerStartRef.current.ratio + deltaX / containerWidth;
      if (Math.abs(rawRatio - 0.5) <= 0.015) {
        rawRatio = 0.5;
      }

      let minRatio = minLeftWidth / containerWidth;
      let maxRatio = (containerWidth - minRightWidth) / containerWidth;
      if (minRatio > maxRatio) {
        minRatio = 0.5;
        maxRatio = 0.5;
      }

      const clampedRatio = Math.max(minRatio, Math.min(maxRatio, rawRatio));
      setSplitRatio(clampedRatio);
      onSplitChange?.(clampedRatio);
    },
    [minLeftWidth, minRightWidth, onSplitChange],
  );

  // 6. 指针松开与取消 (Pointer Up / Cancel)
  const handlePointerRelease = useCallback(
    (e: React.PointerEvent) => {
      if (pointerStartRef.current) {
        if (isDragging && storageKey) {
          try {
            localStorage.setItem(storageKey, String(splitRatio));
          } catch {}
        }
        setIsDragging(false);
        pointerStartRef.current = null;
      }
      if (activePointerRef.current) {
        try {
          activePointerRef.current.target.releasePointerCapture(activePointerRef.current.id);
        } catch {}
        activePointerRef.current = null;
      }
    },
    [isDragging, splitRatio, storageKey],
  );

  // 7. Escape 键回滚
  useEffect(() => {
    if (!isDragging) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDragging(false);
        setSplitRatio(previousRatioRef.current);
        onSplitChange?.(previousRatioRef.current);
        pointerStartRef.current = null;
        if (activePointerRef.current) {
          try {
            activePointerRef.current.target.releasePointerCapture(activePointerRef.current.id);
          } catch {}
          activePointerRef.current = null;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDragging, onSplitChange]);

  // 8. 键盘辅助：左右方向键微调比例，Home/Enter 归位 50/50
  const handleHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!resizable || !isWide) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 0.05 : 0.02;
        const delta = e.key === 'ArrowLeft' ? -step : step;
        setSplitRatio((prev) => {
          const containerWidth = containerRef.current?.offsetWidth || 1000;
          let minRatio = minLeftWidth / containerWidth;
          let maxRatio = (containerWidth - minRightWidth) / containerWidth;
          if (minRatio > maxRatio) { minRatio = 0.5; maxRatio = 0.5; }
          const next = Math.max(minRatio, Math.min(maxRatio, prev + delta));
          onSplitChange?.(next);
          if (storageKey) {
            try { localStorage.setItem(storageKey, String(next)); } catch {}
          }
          return next;
        });
      } else if (e.key === 'Home' || e.key === 'Enter') {
        e.preventDefault();
        handleDoubleClick();
      }
    },
    [resizable, isWide, minLeftWidth, minRightWidth, onSplitChange, storageKey, handleDoubleClick],
  );

  const showResizableSplit = resizable && isWide;

  return (
    <div
      ref={containerRef}
      onPointerMove={showResizableSplit ? handlePointerMove : undefined}
      onPointerUp={showResizableSplit ? handlePointerRelease : undefined}
      onPointerCancel={showResizableSplit ? handlePointerRelease : undefined}
      data-from={from}
      data-pane-dragging={isDragging ? 'true' : undefined}
      className={cn(
        'split-panes min-w-0 relative',
        showResizableSplit
          ? 'flex flex-row items-start gap-0'
          : cn('grid grid-cols-1 gap-4', className),
      )}
    >
      {/* 拖拽期间全局激活的 Iframe / 画布防吞噬透明护盾 */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto bg-transparent"
          style={{ cursor: 'col-resize' }}
        />
      )}

      {/* 左栏 */}
      <div
        className={cn('min-w-0 relative transition-[width] duration-75', leftClassName)}
        style={showResizableSplit ? { width: `${splitRatio * 100}%`, flexShrink: 0 } : undefined}
        aria-label={labels?.left}
      >
        {isDragging && <div className="absolute inset-0 z-40 pointer-events-none bg-transparent" />}
        {left}
      </div>

      {/* 居中弹性拖拽分割手柄 (仅在大屏且启用 resizable 时展现) */}
      {showResizableSplit && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuenow={Math.round(splitRatio * 100)}
          aria-label="拖拽调整左右分栏宽度，双击归位 50/50，按 Escape 还原"
          onPointerDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleHandleKeyDown}
          className={cn(
            'split-pane-handle group relative z-30 flex items-center justify-center w-3 -mx-1.5 cursor-col-resize select-none outline-none touch-none transition-colors self-stretch',
            isDragging ? 'bg-accent/20' : 'hover:bg-accent/10',
          )}
        >
          {/* 1px 发丝线 */}
          <div
            className={cn(
              'w-[1px] h-full transition-colors',
              isDragging ? 'bg-accent' : 'bg-border-subtle group-hover:bg-accent',
            )}
          />

          {/* 居中微手柄胶囊 */}
          <div
            className={cn(
              'absolute size-4 rounded-full flex items-center justify-center bg-surface border border-border-default shadow-xs transition-transform',
              isDragging ? 'scale-110 border-accent' : 'group-hover:scale-105',
            )}
          >
            <div className="flex gap-0.5">
              <span className="w-0.5 h-1.5 rounded-full bg-fg-muted/60" />
              <span className="w-0.5 h-1.5 rounded-full bg-fg-muted/60" />
            </div>
          </div>
        </div>
      )}

      {/* 右栏 */}
      <div
        className={cn('min-w-0 relative transition-[width] duration-75', rightClassName)}
        style={showResizableSplit ? { width: `${(1 - splitRatio) * 100}%`, flexGrow: 1 } : undefined}
        aria-label={labels?.right}
      >
        {isDragging && <div className="absolute inset-0 z-40 pointer-events-none bg-transparent" />}
        {right}
      </div>
    </div>
  );
}

export default SplitPanes;
