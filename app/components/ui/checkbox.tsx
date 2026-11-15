'use client';

import React, { forwardRef } from 'react';
import { Checkbox as MantineCheckbox } from '@mantine/core';
import { cn } from '../../lib/cn';

const classes = {
  root: 'ui-mantine-checkbox-root inline-flex min-w-0 text-sm text-ink',
  body: 'ui-mantine-checkbox-body flex min-w-0 gap-2',
  inner: 'ui-mantine-checkbox-inner shrink-0',
  labelWrapper: 'ui-mantine-checkbox-label-wrapper min-w-0 flex-1 select-none leading-snug',
  input:
    'ui-mantine-checkbox-input h-full w-full cursor-pointer rounded-[var(--radius-xs)] border border-border-control bg-surface-input accent-[var(--action-primary)] focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 checked:border-action-primary checked:bg-action-primary checked:hover:bg-action-primary-hover data-[indeterminate]:border-action-primary data-[indeterminate]:bg-action-primary disabled:cursor-not-allowed disabled:opacity-50',
  icon: 'ui-mantine-checkbox-icon m-auto text-action-on-primary',
  label: 'ui-mantine-checkbox-label cursor-pointer text-sm font-medium text-ink',
  description: 'ui-mantine-checkbox-description mt-1 text-sm text-muted',
  error: 'ui-mantine-checkbox-error mt-1 text-sm text-danger-fg',
} as const;

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
  help?: string;
  error?: boolean | string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      label,
      description,
      help,
      error,
      id,
      disabled,
      checked,
      defaultChecked,
      onChange,
      style,
      size,
      'aria-describedby': describedBy,
      'aria-invalid': ariaInvalid,
      ...props
    },
    ref
  ) => (
    <MantineCheckbox
      ref={ref}
      id={id}
      label={label}
      description={description ?? help}
      error={typeof error === 'string' && error ? <span role="alert">{error}</span> : error ? true : undefined}
      checked={checked}
      defaultChecked={defaultChecked}
      onChange={onChange}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={Boolean(error) || Boolean(ariaInvalid) || undefined}
      classNames={{
        root: classes.root,
        body: cn(classes.body, description || help ? 'items-start' : 'items-center'),
        inner: cn(classes.inner, (description || help) && 'mt-0.5 self-start'),
        labelWrapper: classes.labelWrapper,
        input: cn(classes.input, className),
        icon: classes.icon,
        label: classes.label,
        description: classes.description,
        error: classes.error,
      }}
      styles={style ? { input: style } : undefined}
      size={size === undefined ? '16px' : typeof size === 'number' ? `${size}px` : String(size)}
      {...props}
    />
  )
);

Checkbox.displayName = 'Checkbox';

