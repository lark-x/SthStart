'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { cn } from '../lib/cn';
import { generateId } from '../lib/uuid';

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
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

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [eyeCare, setEyeCare] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sthstart_eye_care_mode') === 'true';
    }
    return false;
  });

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
    ({ title, description, variant = 'default', duration = 4000 }: Omit<ToastItem, 'id'>) => {
      const id = generateId();
      const newToast: ToastItem = { id, title, description, variant, duration };

      setToasts((current) => [...current, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, duration);
      }

      return id;
    },
    [dismissToast]
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
      className="fixed bottom-5 left-4 right-4 sm:left-auto z-50 flex max-w-sm w-full flex-col gap-2 pointer-events-none sm:p-4"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          role={item.variant === 'danger' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg transition-all duration-200 animate-in fade-in slide-in-from-bottom-2',
            item.variant === 'success' &&
              'bg-[#fffdf8] border-[#4e9b6b]/30 text-[#18201d]',
            item.variant === 'danger' &&
              'bg-[#fffdf8] border-[#c9674a]/40 text-[#18201d]',
            item.variant === 'warning' &&
              'bg-[#fffdf8] border-[#d0a731]/40 text-[#18201d]',
            item.variant === 'info' &&
              'bg-[#fffdf8] border-[#4d6684]/30 text-[#18201d]',
            (!item.variant || item.variant === 'default') &&
              'bg-[#fffdf8] border-[rgb(24_32_29/18%)] text-[#18201d]'
          )}
        >
          <div className="flex-shrink-0 pt-0.5">
            {item.variant === 'success' && (
              <CheckCircle2 className="h-5 w-5 text-[#4e9b6b]" aria-hidden="true" />
            )}
            {item.variant === 'danger' && (
              <AlertCircle className="h-5 w-5 text-[#c9674a]" aria-hidden="true" />
            )}
            {item.variant === 'warning' && (
              <AlertTriangle className="h-5 w-5 text-[#d0a731]" aria-hidden="true" />
            )}
            {item.variant === 'info' && (
              <Info className="h-5 w-5 text-[#4d6684]" aria-hidden="true" />
            )}
            {(!item.variant || item.variant === 'default') && (
              <Info className="h-5 w-5 text-[#68716d]" aria-hidden="true" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold tracking-tight">{item.title}</h4>
            {item.description && (
              <p className="mt-1 text-xs text-[#68716d] leading-relaxed">
                {item.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(item.id)}
            className="flex-shrink-0 -mr-1 -mt-1 p-1 text-[#68716d] hover:text-[#18201d] rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e45d35]"
            aria-label="关闭通知"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
