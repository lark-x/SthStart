'use client';

import React, { useRef } from 'react';
import { cn } from '@/app/lib/cn';
import { useScrollFade } from './use-scroll-fade';

/**
 * ==============================================================================
 * ScrollFadeContainer.tsx
 *
 * 滚动边缘渐隐：7 档非线性 Alpha 遮罩，配合滚动位置在两端羽化。
 * 遮罩与渐变都写在 styles/motion.css（[data-scroll-fade]），本组件只负责
 * 把滚动位置写进 --scroll-fade-* 自定义属性。
 *
 * 这里刻意不使用 React state：滚动每帧 setState 会重渲染整个子树，
 * 属于典型的 INP 负担。改为 rAF 合并后直接写 style，滚动帧内不再进入 React。
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

  useScrollFade(containerRef, orientation, fadeSize);

  return (
    <div
      ref={containerRef}
      data-scroll-fade={orientation === 'both' ? undefined : orientation}
      className={cn('relative min-h-0 overflow-auto', className)}
      style={{ ...style, '--scroll-fade-size': `${fadeSize}px` } as React.CSSProperties}
      {...props}
    >
      {children}
    </div>
  );
};

export default ScrollFadeContainer;
