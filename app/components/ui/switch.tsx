'use client';

import React, { forwardRef } from 'react';
import { Switch as MantineSwitch } from '@mantine/core';
import { cn } from '../../lib/cn';

const classes = {
  root: 'ui-mantine-switch-root',
  body: 'ui-mantine-switch-body',
  labelWrapper: 'ui-mantine-switch-label-wrapper',
  input: 'ui-mantine-switch-input',
  track: 'ui-mantine-switch-track',
  thumb: 'ui-mantine-switch-thumb',
  label: 'ui-mantine-switch-label',
  description: 'ui-mantine-switch-description',
  error: 'ui-mantine-switch-error',
} as const;

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
  help?: string;
  error?: boolean | string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
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
      'aria-label': ariaLabel,
      'aria-describedby': describedBy,
      'aria-invalid': ariaInvalid,
      ...props
    },
    ref
  ) => (
    <MantineSwitch
      ref={ref}
      id={id}
      label={label}
      labelPosition="left"
      withThumbIndicator={false}
      description={description ?? help}
      error={typeof error === 'string' && error ? <span role="alert">{error}</span> : error ? true : undefined}
      checked={checked}
      defaultChecked={defaultChecked}
      onChange={onChange}
      disabled={disabled}
      aria-label={!label ? (ariaLabel ?? description) : ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={Boolean(error) || Boolean(ariaInvalid) || undefined}
      classNames={{
        root: classes.root,
        body: classes.body,
        labelWrapper: classes.labelWrapper,
        input: classes.input,
        track: cn(classes.track, className),
        thumb: classes.thumb,
        label: classes.label,
        description: classes.description,
        error: classes.error,
      }}
      styles={style ? { input: style } : undefined}
      size={size === undefined ? undefined : typeof size === 'number' ? `${size}px` : String(size)}
      {...props}
    />
  )
);

Switch.displayName = 'Switch';

