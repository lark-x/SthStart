import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean | string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={Boolean(error) || undefined}
        className={cn(
          /*
           * 多行输入承担的是「主要正文」（活动阶段描述、人设正文、提示词等），
           * 按计划 §11.3 取 16px；笔记正文早已是 16px，这里与之对齐而不是各写一套。
           */
          'flex min-h-[70px] w-full rounded-[var(--radius-control)] border border-border-control bg-surface-raised px-3 py-2 text-base text-ink placeholder:text-muted/60 leading-relaxed',
          'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50 resize-y',
          error && 'border-danger focus-visible:border-danger focus-visible:ring-danger/20',
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
