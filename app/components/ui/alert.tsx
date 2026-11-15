import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Alert as MantineAlert } from '@mantine/core';
import { mantineControlClasses } from './mantine-controls';

export interface AlertProps extends React.ComponentPropsWithRef<'div'> {
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'default';
  title?: string;
  onDismiss?: () => void;
}

/** 页面内持久提示（§7.4）：关键错误必须留在页面内，Toast 只作补充。 */
export function Alert({
  variant = 'default',
  title,
  onDismiss,
  className,
  children,
  ...props
}: AlertProps) {
  const Icon =
    variant === 'success'
      ? CheckCircle2
      : variant === 'warning'
      ? AlertTriangle
      : variant === 'danger'
      ? AlertCircle
      : Info;

  return (
    <MantineAlert
      role={variant === 'danger' ? 'alert' : 'status'}
      variant="transparent"
      data-alert-variant={variant}
      className={className}
      classNames={{
        root: mantineControlClasses.alertRoot,
        wrapper: mantineControlClasses.alertWrapper,
        icon: mantineControlClasses.alertIcon,
        body: mantineControlClasses.alertBody,
        title: mantineControlClasses.alertTitle,
        message: mantineControlClasses.alertMessage,
        closeButton: mantineControlClasses.alertClose,
      }}
      icon={<Icon className="h-4 w-4" aria-hidden="true" />}
      title={title}
      withCloseButton={Boolean(onDismiss)}
      onClose={onDismiss}
      closeButtonLabel="关闭提示"
      {...props}
    >
      {children}
    </MantineAlert>
  );
}
