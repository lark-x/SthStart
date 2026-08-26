import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'default';
  title?: string;
  onDismiss?: () => void;
}

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
        'relative flex items-start gap-3 rounded-md border p-4 text-sm leading-relaxed',
        variant === 'success' && 'border-[#4e9b6b]/30 bg-[#4e9b6b]/9 text-[#335c3f]',
        variant === 'warning' && 'border-[#d0a731]/40 bg-[#d0a731]/10 text-[#856515]',
        variant === 'danger' && 'border-[#c9674a]/40 bg-[#c9674a]/10 text-[#a83a1b]',
        variant === 'info' && 'border-[#4d6684]/30 bg-[#4d6684]/10 text-[#304b69]',
        variant === 'default' && 'border-[rgb(24_32_29/18%)] bg-[#fffdf8] text-[#18201d]',
        className
      )}
      {...props}
    >
      <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <h5 className="font-semibold mb-1">{title}</h5>}
        <div className="text-xs leading-relaxed">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 p-1 -mr-1 -mt-1 opacity-70 hover:opacity-100 rounded focus-visible:outline-none focus-visible:ring-2"
          aria-label="关闭提示"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

