'use client';

import React, { forwardRef } from 'react';
import { Input, InputProps } from './input';
import { useCjkImeGuard } from '@/app/lib/hooks/use-cjk-ime-guard';

export interface CjkInputProps extends InputProps {
  /**
   * 按下提交键时的回调（在中文/日文/韩文输入法选词回车期间被严格拦截，防止误触发）
   */
  onSubmitShortcut?: () => void;
  /**
   * 是否必须按下 Ctrl/Cmd + Enter 才能触发提交（默认为 false，即单独 Enter 即可触发）
   */
  requireModifierKey?: boolean;
}

/**
 * 带有严格 CJK 输入法合成守卫的单行输入框
 * 杜绝拼音候选词确认回车时的误提交或误保存
 */
export const CjkInput = forwardRef<HTMLInputElement, CjkInputProps>(
  (
    {
      onSubmitShortcut,
      requireModifierKey = false,
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
      <Input
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

CjkInput.displayName = 'CjkInput';

export default CjkInput;
