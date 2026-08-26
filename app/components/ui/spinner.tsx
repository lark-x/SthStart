import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function Spinner({
  size = 'md',
  label = '正在加载…',
  className,
  ...props
}: SpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-9 w-9',
  };

  return (
    <div
      role="status"
      className={cn('inline-flex items-center gap-2 text-[#68716d]', className)}
      {...props}
    >
      <Loader2 className={cn('animate-spin text-[#e45d35]', sizeClasses[size])} aria-hidden="true" />
      {label && <span className="text-xs">{label}</span>}
      <span className="sr-only">{label}</span>
    </div>
  );
}

