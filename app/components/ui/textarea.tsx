'use client';

import React, { forwardRef } from 'react';
import { Textarea as MantineTextarea } from '@mantine/core';
import { useImeSafeHandlers } from './use-ime-safe-handlers';
import { cn } from '../../lib/cn';
import { mantineControlClasses } from './mantine-controls';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean | string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, rows = 3, onKeyDown, onCompositionStart, onCompositionEnd, style, 'aria-invalid': ariaInvalid, ...props }, ref) => {
    const imeHandlers = useImeSafeHandlers({ onKeyDown, onCompositionStart, onCompositionEnd });
    return (
      <MantineTextarea
          ref={ref}
          rows={rows}
          resize="vertical"
          error={error || (ariaInvalid ? true : undefined)}
          classNames={{
            wrapper: mantineControlClasses.inputWrapper,
            input: cn('ui-control', className),
          }}
          aria-invalid={Boolean(error) || Boolean(ariaInvalid) || undefined}
          styles={style ? { input: style } : undefined}
          {...props}
          {...imeHandlers}
        />
    );
  }
);

Textarea.displayName = 'Textarea';
