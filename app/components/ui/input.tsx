'use client';

import React, { forwardRef } from 'react';
import { Input as MantineInput } from '@mantine/core';
import { useImeSafeHandlers } from './use-ime-safe-handlers';
import { cn } from '../../lib/cn';
import { mantineControlClasses } from './mantine-controls';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean | string;
  variant?: 'default' | 'inline';
}

/** 与 Button/Select 同规范：高 40px、语义圆角、统一错误态（计划 §3.3/§7.1）。 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, variant = 'default', type = 'text', onKeyDown, onCompositionStart, onCompositionEnd, size, style, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...props }, ref) => {
    const imeHandlers = useImeSafeHandlers({ onKeyDown, onCompositionStart, onCompositionEnd });
    const invalid = Boolean(error) || Boolean(ariaInvalid) || undefined;
    return (
      <MantineInput
          data-ui-variant={variant === 'inline' ? 'inline' : undefined}
          type={type}
          ref={ref}
          error={error || (ariaInvalid ? true : undefined)}
          inputSize={size !== undefined ? String(size) : undefined}
          classNames={{
            wrapper: mantineControlClasses.inputWrapper,
            input: cn('ui-control', className),
          }}
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
