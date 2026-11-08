import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';

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
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn(
        'relative flex items-start gap-3 rounded-control border p-4 text-sm leading-relaxed',
        variant === 'success' && 'border-success-border bg-success-bg text-success-fg',
        variant === 'warning' && 'border-warning-border bg-warning-bg text-warning-fg',
        variant === 'danger' && 'border-danger-border bg-danger-bg text-danger-fg',
        variant === 'info' && 'border-info-border bg-info-bg text-info-fg',
        variant === 'default' && 'border-border-default bg-surface text-ink',
        className
      )}
      {...props}
    >
      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold mb-1">{title}</p>}
        <div className="text-sm leading-relaxed">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-9 w-9 shrink-0 items-center justify-center -mr-1 -mt-1 rounded-control opacity-70 hover:opacity-100 hover:bg-surface-hover"
          aria-label="关闭提示"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
