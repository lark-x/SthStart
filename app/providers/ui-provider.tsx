'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { cn } from '../lib/cn';
import { generateId } from '../lib/uuid';

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** 毫秒；0 表示常驻直到手动关闭。未指定时成功/默认 4 秒，警告/错误 8 秒（§7.4）。 */
  duration?: number;
  /** 相同 key 的通知合并更新而不是堆叠。缺省用 variant+title。 */
  key?: string;
}

interface UIContextType {
  toasts: ToastItem[];
  eyeCare: boolean;
  toggleEyeCare: (enabled?: boolean) => void;
  showToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  toast: {
    show: (options: Omit<ToastItem, 'id'>) => string;
    success: (title: string, description?: string) => string;
    error: (title: string, description?: string) => string;
    warning: (title: string, description?: string) => string;
    info: (title: string, description?: string) => string;
  };
}

const UIContext = createContext<UIContextType | null>(null);

/** 普通通知最多同时展示 3 条，超出丢弃最旧的（§7.4）。 */
const MAX_VISIBLE_TOASTS = 3;

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  default: 4000,
  success: 4000,
  info: 4000,
  warning: 8000,
  danger: 8000,
};

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 初始值必须与 SSR 渲染一致（false）：localStorage 在挂载后再同步，
  // 否则客户端首帧与服务端 HTML 不匹配，触发 React 水合失配。
  const [eyeCare, setEyeCare] = useState(false);

  useEffect(() => {
    setEyeCare(localStorage.getItem('sthstart_eye_care_mode') === 'true');
  }, []);

  const toggleEyeCare = useCallback((enabled?: boolean) => {
    setEyeCare((prev) => {
      const next = typeof enabled === 'boolean' ? enabled : !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('sthstart_eye_care_mode', String(next));
        if (next) {
          document.documentElement.setAttribute('data-eye-care', 'true');
        } else {
          document.documentElement.removeAttribute('data-eye-care');
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (eyeCare) {
      document.documentElement.setAttribute('data-eye-care', 'true');
    } else {
      document.documentElement.removeAttribute('data-eye-care');
    }
  }, [eyeCare]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    ({ title, description, variant = 'default', duration, key }: Omit<ToastItem, 'id'>) => {
      const id = generateId();
      const effectiveDuration = duration ?? DEFAULT_DURATION[variant];
      const mergeKey = key ?? `${variant}::${title}`;
      const newToast: ToastItem = { id, title, description, variant, duration: effectiveDuration, key: mergeKey };

      setToasts((current) => {
        const merged = current.filter((item) => item.key !== mergeKey);
        return [...merged, newToast].slice(-MAX_VISIBLE_TOASTS);
      });

      // 计时由 ToastCard 负责：支持悬停暂停，合并更新时整体重新计时。
      return id;
    },
    []
  );

  const toast = useMemo(
    () => ({
      show: (options: Omit<ToastItem, 'id'>) => showToast(options),
      success: (title: string, description?: string) =>
        showToast({ title, description, variant: 'success' }),
      error: (title: string, description?: string) =>
        showToast({ title, description, variant: 'danger' }),
      warning: (title: string, description?: string) =>
        showToast({ title, description, variant: 'warning' }),
      info: (title: string, description?: string) =>
        showToast({ title, description, variant: 'info' }),
    }),
    [showToast]
  );

  const value = useMemo(
    () => ({
      toasts,
      eyeCare,
      toggleEyeCare,
      showToast,
      dismissToast,
      toast,
    }),
    [toasts, eyeCare, toggleEyeCare, showToast, dismissToast, toast]
  );

  return (
    <UIContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </UIContext.Provider>
  );
}

export function useUI() {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
}

export function useToast() {
  const { toast } = useUI();
  return toast;
}

export function useEyeCare() {
  const { eyeCare, toggleEyeCare } = useUI();
  return { eyeCare, toggleEyeCare };
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef(item.duration ?? 0);
  const startedAtRef = useRef(0);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const duration = item.duration ?? 0;
    if (duration <= 0) return;
    remainingRef.current = duration;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onDismissRef.current(item.id), duration);
    return clearTimer;
  }, [item.id, item.duration, clearTimer]);

  const pause = React.useCallback(() => {
    if ((item.duration ?? 0) <= 0 || timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(400, remainingRef.current - (Date.now() - startedAtRef.current));
  }, [item.duration]);

  const resume = React.useCallback(() => {
    if ((item.duration ?? 0) <= 0 || timerRef.current !== null) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onDismissRef.current(item.id), remainingRef.current);
  }, [item.duration, item.id]);

  return (
    <div
      role={item.variant === 'danger' ? 'alert' : 'status'}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface-raised p-4 text-ink shadow-floating transition-colors animate-in fade-in slide-in-from-bottom-2',
        item.variant === 'success' && 'border-success-border',
        item.variant === 'danger' && 'border-danger-border',
        item.variant === 'warning' && 'border-warning-border',
        item.variant === 'info' && 'border-info-border',
        (!item.variant || item.variant === 'default') && 'border-border-default'
      )}
    >
      <div className="flex-shrink-0 pt-0.5">
        {item.variant === 'success' && (
          <CheckCircle2 className="h-5 w-5 text-success-fg" aria-hidden="true" />
        )}
        {item.variant === 'danger' && (
          <AlertCircle className="h-5 w-5 text-danger-fg" aria-hidden="true" />
        )}
        {item.variant === 'warning' && (
          <AlertTriangle className="h-5 w-5 text-warning-fg" aria-hidden="true" />
        )}
        {item.variant === 'info' && (
          <Info className="h-5 w-5 text-info-fg" aria-hidden="true" />
        )}
        {(!item.variant || item.variant === 'default') && (
          <Info className="h-5 w-5 text-muted" aria-hidden="true" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold tracking-tight">{item.title}</h4>
        {item.description && (
          <p className="mt-1 text-[13px] text-muted leading-relaxed">
            {item.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="flex-shrink-0 -mr-1 -mt-1 p-1 text-muted hover:text-ink rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="关闭通知"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-4 sm:left-auto sm:right-4 z-[60] flex w-[min(384px,calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
