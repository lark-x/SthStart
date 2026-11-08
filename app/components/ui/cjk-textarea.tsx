'use client';

import React, { forwardRef } from 'react';
import { Textarea, TextareaProps } from './textarea';
import { useCjkImeGuard } from '@/app/lib/hooks/use-cjk-ime-guard';

export interface CjkTextareaProps extends TextareaProps {
  /**
   * 按下提交键时的回调（在中文/日文/韩文输入法选词回车期间被严格拦截，防止误触发）
   */
  onSubmitShortcut?: () => void;
  /**
   * 多行输入默认必须按下 Ctrl/Cmd + Enter 才能触发提交（避免普通回车换行被截断）
   * @default true
   */
  requireModifierKey?: boolean;
}

/**
 * 带有严格 CJK 输入法合成守卫的多行文本输入框
 * 杜绝拼音候选词确认回车时的误提交或意外保存；普通 Enter 正常换行，Ctrl/Cmd + Enter 触发提交
 */
export const CjkTextarea = forwardRef<HTMLTextAreaElement, CjkTextareaProps>(
  (
    {
      onSubmitShortcut,
      requireModifierKey = true,
      onCompositionStart,
      onCompositionEnd,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const { imeProps } = useCjkImeGuard({
      requireModifierKey,
      onSubmit: onSubmitShortcut,
    });

    return (
      <Textarea
        ref={ref}
        onCompositionStart={(e) => {
          imeProps.onCompositionStart();
          onCompositionStart?.(e);
        }}
        onCompositionEnd={(e) => {
          imeProps.onCompositionEnd();
          onCompositionEnd?.(e);
        }}
        onKeyDown={(e) => {
          imeProps.onKeyDown(e);
          if (!e.defaultPrevented) {
            onKeyDown?.(e);
          }
        }}
        {...props}
      />
    );
  },
);

CjkTextarea.displayName = 'CjkTextarea';

export default CjkTextarea;
