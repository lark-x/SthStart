'use client';

import React, { useContext, useMemo } from 'react';
import {
  ThemeProvider,
  useTheme,
  useEyeCare,
  ThemeContext,
  toneFromThemeId,
  modeFromThemeId,
  type ThemeContextType,
  type ThemeProviderProps,
} from './theme-provider';
import {
  ToastProvider,
  ToastContainer,
  ToastCard,
  useToast,
  useToastActions,
  useToastList,
  ToastActionsContext,
  ToastListContext,
  MAX_VISIBLE_TOASTS,
  DEFAULT_DURATION,
  type ToastVariant,
  type ToastItem,
  type ToastMethods,
  type ToastActionsContextType,
  type ToastProviderProps,
} from './toast-provider';
import { MantineThemeBridge } from './mantine-provider';

export type {
  ToastVariant,
  ToastItem,
  ToastMethods,
  ToastActionsContextType,
  ToastProviderProps,
  ThemeContextType,
  ThemeProviderProps,
};

export {
  ThemeProvider,
  ToastProvider,
  ToastContainer,
  ToastCard,
  useTheme,
  useToast,
  useEyeCare,
  useToastActions,
  useToastList,
  toneFromThemeId,
  modeFromThemeId,
  MAX_VISIBLE_TOASTS,
  DEFAULT_DURATION,
};

export interface UIContextType extends ThemeContextType, ToastActionsContextType {
  toasts: ToastItem[];
}

export function UIProvider({ children }: { children?: React.ReactNode }) {
  return (
    <ThemeProvider>
      <MantineThemeBridge>
        <ToastProvider>{children}</ToastProvider>
      </MantineThemeBridge>
    </ThemeProvider>
  );
}

export function useUI(): UIContextType {
  const theme = useContext(ThemeContext);
  const toastActions = useContext(ToastActionsContext);
  const toasts = useContext(ToastListContext);

  if (!theme || !toastActions || !toasts) {
    throw new Error('useUI must be used within a UIProvider');
  }

  return useMemo(
    () => ({
      ...theme,
      ...toastActions,
      toasts,
    }),
    [theme, toastActions, toasts]
  );
}
