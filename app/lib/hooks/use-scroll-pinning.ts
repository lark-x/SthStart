'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseScrollPinningOptions {
  /** 判定接近底部的容差像素（默认 40px） */
  bottomTolerance?: number;
  /** 用户主动输入（滚轮、按键、触摸）后的锁定冷却时间（默认 150ms） */
  cooldownMs?: number;
  /** 初始是否锁定在底部（默认 true） */
  initialPinned?: boolean;
}

/**
 * 流式大文本与日志视口图钉锁定 Hook
 * 逆向还原自 Claude Desktop: ca2ef848d-Dz47ULRM.js
 *
 * 核心机制：
 * 1. 150ms 用户主动操作冷却时间戳（performance.now() - lastUserInputAt > 150）
 * 2. 40px 底部容差图钉锁定（若在 40px 内则持续吸附最新输出）
 * 3. 瞬时滚动对齐（behavior: 'auto'）杜绝平滑滚动堆积抖动
 */
export function useScrollPinning<T extends HTMLElement = HTMLDivElement>(
  dependencies: unknown[] = [],
  options: UseScrollPinningOptions = {},
) {
  const { bottomTolerance = 40, cooldownMs = 150, initialPinned = true } = options;
  const containerRef = useRef<T>(null);
  const [isPinned, setIsPinned] = useState(initialPinned);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const lastUserInputAt = useRef(0);
  const programmaticScroll = useRef(false);

  // 用户主动输入时，标记时间戳并释放图钉锁定
  const markUserInput = useCallback(() => {
    lastUserInputAt.current = performance.now();
    setIsPinned(false);
    setShowJumpToBottom(true);
  }, []);

  // 滚动事件处理
  const handleScroll = useCallback(() => {
    if (programmaticScroll.current) {
      programmaticScroll.current = false;
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const atBottom = distanceFromBottom <= bottomTolerance;

    // 如果刚在 150ms 内进行了用户输入，不自动锁定
    if (performance.now() - lastUserInputAt.current < cooldownMs) {
      setIsPinned(false);
      setShowJumpToBottom(!atBottom);
      return;
    }

    setIsPinned(atBottom);
    setShowJumpToBottom(!atBottom);
  }, [bottomTolerance, cooldownMs]);

  // 立即平滑或瞬时滚动到底部
  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    programmaticScroll.current = true;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
    setIsPinned(true);
    setShowJumpToBottom(false);
  }, []);

  // 监听容器主动输入事件
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = () => markUserInput();
    const onTouch = () => markUserInput();
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        markUserInput();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchmove', onTouch, { passive: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', onTouch);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('scroll', handleScroll);
    };
  }, [markUserInput, handleScroll]);

  // 依赖项变更时（如流式新增 Token、列表项更新），若仍锁定则自动瞬时贴底
  useEffect(() => {
    if (!isPinned) return;
    const el = containerRef.current;
    if (!el) return;

    programmaticScroll.current = true;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'auto',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return {
    containerRef,
    isPinned,
    showJumpToBottom,
    scrollToBottom,
    markUserInput,
  };
}
