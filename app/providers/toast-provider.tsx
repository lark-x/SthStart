'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HeadlessMantineProvider, MantineContext, Notification } from '@mantine/core';
import {
  Notifications,
  createNotificationsStore,
  notifications as mantineNotifications,
  type NotificationData,
  type NotificationsStore,
} from '@mantine/notifications';
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
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

export interface ToastMethods {
  show: (options: Omit<ToastItem, 'id'>) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
}

export interface ToastActionsContextType {
  showToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
  toast: ToastMethods;
}

/** 普通通知最多同时展示 3 条，超出丢弃最旧的（§7.4）。 */
export const MAX_VISIBLE_TOASTS = 3;

export const DEFAULT_DURATION: Record<ToastVariant, number> = {
  default: 4000,
  success: 4000,
  info: 4000,
  warning: 8000,
  danger: 8000,
};

export const ToastActionsContext = createContext<ToastActionsContextType | null>(null);
export const ToastListContext = createContext<ToastItem[] | null>(null);
const ToastStoreContext = createContext<NotificationsStore | null>(null);

export interface ToastProviderProps {
  children?: React.ReactNode;
}

const VARIANT_MANTINE_COLOR: Record<ToastVariant, string | undefined> = {
  default: undefined,
  success: 'green',
  danger: 'red',
  warning: 'yellow',
  info: 'blue',
};

function renderVariantIcon(variant: ToastVariant): React.ReactNode {
  switch (variant) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
    case 'danger':
      return <AlertCircle className="h-4 w-4" aria-hidden="true" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
    case 'info':
    case 'default':
    default:
      return <Info className="h-4 w-4" aria-hidden="true" />;
  }
}

function buildNotificationProps(item: ToastItem) {
  const variant: ToastVariant = item.variant ?? 'default';
  return {
    role: variant === 'danger' ? 'alert' : 'status',
    color: VARIANT_MANTINE_COLOR[variant],
    icon: renderVariantIcon(variant),
    title: item.title,
    withBorder: true,
    withCloseButton: true,
    closeButtonProps: { 'aria-label': '关闭通知' },
    'data-toast-variant': variant,
  };
}

function toMantineNotificationData(
  item: ToastItem,
  onDismiss: (id: string) => void,
): NotificationData {
  const duration = item.duration ?? 0;
  return {
    id: item.id,
    ...buildNotificationProps(item),
    message: item.description,
    autoClose: duration > 0 ? duration : false,
    onClose: () => onDismiss(item.id),
  };
}

function withOptionalMantineProvider(
  hasMantine: boolean,
  node: React.ReactElement,
): React.ReactElement {
  if (hasMantine) return node;
  return <HeadlessMantineProvider>{node}</HeadlessMantineProvider>;
}

export function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const hasMantine = Boolean(useContext(MantineContext));
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef(item.duration ?? 0);
  const startedAtRef = useRef(0);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const clearTimer = useCallback(() => {
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

  const pause = useCallback(() => {
    if ((item.duration ?? 0) <= 0 || timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(400, remainingRef.current - (Date.now() - startedAtRef.current));
  }, [item.duration]);

  const resume = useCallback(() => {
    if ((item.duration ?? 0) <= 0 || timerRef.current !== null) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onDismissRef.current(item.id), remainingRef.current);
  }, [item.duration, item.id]);

  const { ...notificationProps } = buildNotificationProps(item);

  return withOptionalMantineProvider(
    hasMantine,
    <Notification
      {...notificationProps}
      onClose={() => onDismiss(item.id)}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className="pointer-events-auto transition-transform duration-200 hover:-translate-y-0.5"
    >
      {item.description}
    </Notification>,
  );
}

export function ToastContainer({
  toasts: propToasts,
  onDismiss: propOnDismiss,
}: {
  toasts?: ToastItem[];
  onDismiss?: (id: string) => void;
} = {}) {
  const hasMantine = Boolean(useContext(MantineContext));
  const store = useContext(ToastStoreContext);
  const contextToasts = useContext(ToastListContext);
  const contextActions = useContext(ToastActionsContext);

  if (propToasts === undefined && store) {
    const canPortal = typeof document !== 'undefined' && Boolean(document.body);
    return withOptionalMantineProvider(
      hasMantine,
      <Notifications
        store={store}
        position="bottom-right"
        containerWidth={384}
        limit={MAX_VISIBLE_TOASTS}
        zIndex={400}
        withinPortal={canPortal}
        pauseResetOnHover="all"
        aria-live="polite"
        aria-atomic="false"
      />,
    );
  }

  const toasts = propToasts ?? contextToasts ?? [];
  const onDismiss = propOnDismiss ?? contextActions?.dismissToast ?? (() => {});

  if (!toasts.length) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-4 sm:left-auto sm:right-4 z-[400] flex w-[min(384px,calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [store] = useState(() => createNotificationsStore());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    mantineNotifications.updateState(store, () =>
      toasts.map((item) => toMantineNotificationData(item, dismissToast)),
    );
  }, [toasts, store, dismissToast]);

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

      return id;
    },
    [],
  );

  const toast = useMemo<ToastMethods>(
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
    [showToast],
  );

  const actionsValue = useMemo<ToastActionsContextType>(
    () => ({
      showToast,
      dismissToast,
      toast,
    }),
    [showToast, dismissToast, toast],
  );

  return (
    <ToastActionsContext.Provider value={actionsValue}>
      <ToastListContext.Provider value={toasts}>
        <ToastStoreContext.Provider value={store}>
          {children}
          <ToastContainer />
        </ToastStoreContext.Provider>
      </ToastListContext.Provider>
    </ToastActionsContext.Provider>
  );
}

export function useToastActions(): ToastActionsContextType {
  const context = useContext(ToastActionsContext);
  if (!context) {
    throw new Error('useToastActions must be used within a ToastProvider or UIProvider');
  }
  return context;
}

export function useToastList(): ToastItem[] {
  const context = useContext(ToastListContext);
  if (!context) {
    throw new Error('useToastList must be used within a ToastProvider or UIProvider');
  }
  return context;
}

export function useToast(): ToastMethods {
  const { toast } = useToastActions();
  return toast;
}
