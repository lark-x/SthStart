'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/app/lib/cn';

/**
 * ==============================================================================
 * ScrollFadeContainer.tsx
 *
 * 逆向还原自官方 Claude Desktop / Web 边缘平滑渐变遮罩系统:
 * - 7 档非线性 Alpha 渐变遮罩 (7-Stop Non-Linear Alpha Mask)
 * - 数据紧密贴合 y ≈ x^1.5 幂律感知平滑曲线，配合 mask-image 实现物理级温润边缘消隐
 * - 动态滚动位置传感器：触顶时顶端羽化归零恢复清晰，触底时底端羽化归零
 * ==============================================================================
 */

export interface ScrollFadeContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  orientation?: 'vertical' | 'horizontal' | 'both';
  fadeSize?: number; // 默认 28px
  className?: string;
  style?: React.CSSProperties;
}

export const ScrollFadeContainer: React.FC<ScrollFadeContainerProps> = ({
  children,
  orientation = 'vertical',
  fadeSize = 28,
  className = '',
  style = {},
  ...props
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const [fadeTop, setFadeTop] = useState(0);
  const [fadeBottom, setFadeBottom] = useState(fadeSize);
  const [fadeLeft, setFadeLeft] = useState(0);
  const [fadeRight, setFadeRight] = useState(fadeSize);

  // 滚动边界检测
  const updateScrollFades = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (orientation === 'vertical' || orientation === 'both') {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const isAtTop = scrollTop <= 2;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 2;

      setFadeTop(isAtTop ? 0 : fadeSize);
      setFadeBottom(isAtBottom ? 0 : fadeSize);
    }

    if (orientation === 'horizontal' || orientation === 'both') {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const isAtLeft = scrollLeft <= 2;
      const isAtRight = scrollLeft + clientWidth >= scrollWidth - 2;

      setFadeLeft(isAtLeft ? 0 : fadeSize);
      setFadeRight(isAtRight ? 0 : fadeSize);
    }
  }, [orientation, fadeSize]);

  useEffect(() => {
    updateScrollFades();
    const el = containerRef.current;
    if (!el) return;

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScrollFades) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [updateScrollFades]);

  // 构建 7-Stop 幂律渐变 Mask
  const maskStyle = useMemo(() => {
    if (orientation === 'vertical') {
      const gradient = `linear-gradient(to bottom,
        transparent,
        rgba(0, 0, 0, 0.05) calc(var(--scroll-fade-top) * 0.15),
        rgba(0, 0, 0, 0.15) calc(var(--scroll-fade-top) * 0.3),
        rgba(0, 0, 0, 0.30) calc(var(--scroll-fade-top) * 0.45),
        rgba(0, 0, 0, 0.50) calc(var(--scroll-fade-top) * 0.6),
        rgba(0, 0, 0, 0.70) calc(var(--scroll-fade-top) * 0.75),
        rgba(0, 0, 0, 0.85) calc(var(--scroll-fade-top) * 0.87),
        #000 var(--scroll-fade-top),
        #000 calc(100% - var(--scroll-fade-bottom)),
        rgba(0, 0, 0, 0.85) calc(100% - var(--scroll-fade-bottom) * 0.87),
        rgba(0, 0, 0, 0.70) calc(100% - var(--scroll-fade-bottom) * 0.75),
        rgba(0, 0, 0, 0.50) calc(100% - var(--scroll-fade-bottom) * 0.6),
        rgba(0, 0, 0, 0.30) calc(100% - var(--scroll-fade-bottom) * 0.45),
        rgba(0, 0, 0, 0.15) calc(100% - var(--scroll-fade-bottom) * 0.3),
        rgba(0, 0, 0, 0.05) calc(100% - var(--scroll-fade-bottom) * 0.15),
        transparent)`;

      return {
        maskImage: gradient,
        WebkitMaskImage: gradient,
      };
    }

    if (orientation === 'horizontal') {
      const gradient = `linear-gradient(to right,
        transparent,
        #000 var(--scroll-fade-left),
        #000 calc(100% - var(--scroll-fade-right)),
        transparent)`;

      return {
        maskImage: gradient,
        WebkitMaskImage: gradient,
      };
    }

    return {};
  }, [orientation]);

  return (
    <div
      ref={containerRef}
      onScroll={updateScrollFades}
      className={cn('relative min-h-0 overflow-auto transition-[mask-image] duration-150', className)}
      style={
        {
          ...style,
          ...maskStyle,
          '--scroll-fade-size': `${fadeSize}px`,
          '--scroll-fade-top': `${fadeTop}px`,
          '--scroll-fade-bottom': `${fadeBottom}px`,
          '--scroll-fade-left': `${fadeLeft}px`,
          '--scroll-fade-right': `${fadeRight}px`,
        } as unknown as React.CSSProperties
      }
      {...props}
    >
      {children}
    </div>
  );
};

export default ScrollFadeContainer;
