'use client';

import React, { useId } from 'react';
import { cn } from '../../lib/cn';

export interface FormFieldProps {
  label: string;
  /** 控件 id；未提供时自动取子控件的 id，再退回到自动生成的 id。 */
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  /** 字符串错误会显示为错误说明；布尔值只标记错误态（§7.2）。 */
  error?: boolean | string;
  children: React.ReactNode;
  className?: string;
}

type WithCommonControlProps = {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  required?: boolean;
  'aria-required'?: boolean;
};

/**
 * 表单字段骨架（§7.2）：统一 label、必填标记、提示与错误的 DOM 结构和 aria 关联，
 * 减少每个页面手写校验结构；保存/提交状态不在此组件职责内。
 */
export function FormField({ label, htmlFor, required, hint, error, children, className }: FormFieldProps) {
  const autoId = useId();
  const hintId = `${autoId}-hint`;
  const errorId = `${autoId}-error`;
  const errorText = typeof error === 'string' && error.trim().length > 0 ? error : undefined;
  const isElement = React.isValidElement(children);
  const childProps = isElement ? (children.props as WithCommonControlProps) : undefined;
  const controlId = htmlFor ?? childProps?.id ?? (isElement ? autoId : undefined);
  const describedBy = [
    childProps?.['aria-describedby'],
    errorText ? errorId : null,
    hint ? hintId : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  let control: React.ReactNode = children;
  if (isElement) {
    control = React.cloneElement(children as React.ReactElement<WithCommonControlProps>, {
      id: controlId,
      'aria-invalid': Boolean(error) || undefined,
      'aria-describedby': describedBy,
      required: childProps?.required ?? (required || undefined),
      'aria-required': childProps?.['aria-required'] ?? (required || undefined),
    });
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <label htmlFor={controlId} className="text-sm font-medium tracking-[0.01em] text-ink">
        {label}
        {required && (
          <>
            <span className="text-danger-fg" aria-hidden="true">
              {' '}*
            </span>
            <span className="sr-only">（必填）</span>
          </>
        )}
      </label>
      {control}
      {errorText && (
        <p id={errorId} role="alert" className="text-xs leading-relaxed text-danger-fg">
          {errorText}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
