'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * 双栏工作区：两栏各自成为**独立滚动区域**。
 *
 * 背景：Grid 的 align-items 默认是 stretch，并排两列会被拉成同高。
 * 右侧内容一长，左侧空面板就跟着长出一大片空白，且左侧内容会被拽出视口。
 * 这里用 align-items: start 让两栏各自决定高度，再给两栏同样的
 * max-height + overflow-y: auto，于是：
 *   - 内容短的一栏（通常是左侧）保持自然高度，不出现滚动条；
 *   - 内容长的一栏在自身区域内滚动，不影响另一栏，也不把页面撑长。
 *
 * 高度边界不是写死的数字：组件测量自己在文档中的纵向位置，
 * 用「视口高度 − 自身顶部偏移 − 底部留白」算出可用高度写入 CSS 变量。
 * 这样页头或工具栏换行、字号变化时都能自动跟上。
 * 窄屏（单栏堆叠）下不启用，避免在手机上切出两个小滚动区。
 */

/** 两栏下方保留的呼吸空间。 */
const BOTTOM_GUTTER = 24;
/** 低于这个高度就不再压缩，避免在小视口里挤成一条缝。 */
const MIN_AVAILABLE = 360;

export type SplitFrom = 'lg' | 'xl';

export function SplitPanes({
  left,
  right,
  className,
  leftClassName,
  rightClassName,
  from = 'lg',
  labels,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  /** 栅格定义（含响应式列数与间距），例如 'lg:grid-cols-[minmax(0,1fr)_360px]'。 */
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
  /** 从哪个断点起启用独立滚动，需与 className 里的列数断点一致。 */
  from?: SplitFrom;
  /** 可访问性：两栏的区域名。 */
  labels?: { left?: string; right?: string };
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastTop = Number.NaN;

    const update = () => {
      // 用文档坐标：页面滚动时 rect.top 会变，但文档位置不变，数值才稳定。
      const top = el.getBoundingClientRect().top + window.scrollY;
      if (Math.abs(top - lastTop) < 1) return;
      lastTop = top;
      const available = Math.max(MIN_AVAILABLE, window.innerHeight - top - BOTTOM_GUTTER);
      el.style.setProperty('--split-available', `${Math.round(available)}px`);
    };

    update();
    window.addEventListener('resize', update);
    // 页头、工具栏换行会改变本组件的纵向位置，需要重新测量。
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn('split-panes min-w-0 grid grid-cols-1 gap-4', className)}
      data-from={from}
    >
      <div className={cn('min-w-0', leftClassName)} aria-label={labels?.left}>
        {left}
      </div>
      <div className={cn('min-w-0', rightClassName)} aria-label={labels?.right}>
        {right}
      </div>
    </div>
  );
}

export default SplitPanes;

