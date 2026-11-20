'use client';

import React, { forwardRef } from 'react';
import { Input as MantineInput } from '@mantine/core';
import { useImeSafeHandlers } from './use-ime-safe-handlers';
import { cn } from '../../lib/cn';
import { mantineControlClasses } from './mantine-controls';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean | string;
  variant?: 'default' | 'inline';
  /**
   * 输入框左侧的装饰图标（如搜索放大镜）。放进 Mantine `leftSection`：不接收指针事件、
   * 对读屏隐藏，并默认预留 `pl-9` 文字起点；调用方可用自己的 `pl-*` 覆盖。
   * 不要在 Input 前面用绝对定位叠图标：Mantine 包裹层是定位元素，会把图标盖住。
   */
  leftIcon?: React.ReactNode;
}

/** 左侧图标槽宽度；默认文字起点 `pl-9`（36px）与之对齐。 */
const LEFT_ICON_SECTION_WIDTH = 36;

/** 与 Button/Select 同规范：高 40px、语义圆角、统一错误态（计划 §3.3/§7.1）。 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, variant = 'default', leftIcon, type = 'text', onKeyDown, onCompositionStart, onCompositionEnd, size, style, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...props }, ref) => {
    const imeHandlers = useImeSafeHandlers({ onKeyDown, onCompositionStart, onCompositionEnd });
    const invalid = Boolean(error) || Boolean(ariaInvalid) || undefined;
    const hasLeftIcon = leftIcon !== undefined && leftIcon !== null && leftIcon !== false;
    return (
      <MantineInput
          data-ui-variant={variant === 'inline' ? 'inline' : undefined}
          type={type}
          ref={ref}
          error={error || (ariaInvalid ? true : undefined)}
          inputSize={size !== undefined ? String(size) : undefined}
          classNames={{
            wrapper: mantineControlClasses.inputWrapper,
            input: cn('ui-control', hasLeftIcon && 'pl-9', className),
          }}
          leftSection={hasLeftIcon ? leftIcon : undefined}
          leftSectionWidth={hasLeftIcon ? LEFT_ICON_SECTION_WIDTH : undefined}
          leftSectionPointerEvents="none"
          leftSectionProps={hasLeftIcon ? { 'aria-hidden': true } : undefined}
          withAria
          attributes={ariaDescribedBy !== undefined || invalid ? {
            input: {
              ...(ariaDescribedBy !== undefined ? { 'aria-describedby': ariaDescribedBy } : {}),
              ...(invalid ? { 'aria-invalid': true } : {}),
            },
          } : undefined}
          styles={style ? { input: style } : undefined}
          {...props}
          {...imeHandlers}
        />
    );
  }
);

Input.displayName = 'Input';
