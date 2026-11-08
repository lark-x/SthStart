'use client';

import { useCallback, useRef } from 'react';

export interface UseCjkImeGuardOptions {
  /**
   * 是否需要按下 Ctrl 或 Cmd 才能触发表单快捷提交
   * @default false (如果为 true，单按 Enter 不提交，必须 Ctrl/Cmd + Enter)
   */
  requireModifierKey?: boolean;
  /** 触发提交的回调 */
  onSubmit?: () => void;
}

/**
 * 纯判断函数：检查按键事件是否发生在 IME 合成中
 */
export function isImeComposingEvent(
  e: {
    nativeEvent?: { isComposing?: boolean };
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  },
  isComposingRefState = false,
): boolean {
  // 1. 原生 nativeEvent isComposing 标志
  if (e.nativeEvent?.isComposing) {
    return true;
  }
  // 2. React 合成事件中的 isComposing
  if (e.isComposing) {
    return true;
  }
  // 3. 浏览器虚拟键盘输入码 229 (IME Process)
  if (e.keyCode === 229 || e.which === 229) {
    return true;
  }
  // 4. ref/外部组字状态
  return isComposingRefState;
}

/**
 * 严格 CJK 输入法合成守卫 Hook
 * 逆向还原自 Claude Desktop: cd5a31703-B4nKQMBN.js
 *
 * 核心特性：
 * 1. 监听 compositionstart / compositionend，维护 isComposing 状态
 * 2. 拦截 keyCode === 229 与 event.nativeEvent.isComposing
 * 3. 杜绝中文/日文/韩文输入法候选词确认回车时的误发送与误保存
 */
export function useCjkImeGuard(options: UseCjkImeGuardOptions = {}) {
  const { requireModifierKey = false, onSubmit } = options;
  const isComposingRef = useRef(false);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
  }, []);

  const isImeComposing = useCallback(
    (e: React.KeyboardEvent | KeyboardEvent): boolean => {
      return isImeComposingEvent(e, isComposingRef.current);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      // 若处于输入法组字状态，绝不触发提交
      if (isImeComposing(e)) {
        return;
      }

      if (e.key === 'Enter') {
        const hasModifier = e.ctrlKey || e.metaKey;
        if (requireModifierKey) {
          if (hasModifier) {
            e.preventDefault();
            onSubmit?.();
          }
        } else {
          // 如果不需要修饰键，但按下了 Shift+Enter，通常是换行，不拦截
          if (!e.shiftKey) {
            e.preventDefault();
            onSubmit?.();
          }
        }
      }
    },
    [isImeComposing, requireModifierKey, onSubmit],
  );

  return {
    isImeComposing,
    handleCompositionStart,
    handleCompositionEnd,
    handleKeyDown,
    imeProps: {
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
      onKeyDown: handleKeyDown,
    },
  };
}
