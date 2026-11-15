'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyThemeId,
  ACCENT_STORAGE_KEY,
  UI_SKIN_STORAGE_KEY,
  applyCustomAccent,
  applyUiSkin,
  normalizeAccentColor,
  readThemeId,
  readUiSkinId,
  type ColorMode,
  type ThemeId,
  type ThemeTone,
  type UiSkinId,
} from '../lib/theme-preference';

export function toneFromThemeId(id: ThemeId): ThemeTone {
  if (id === 'light-paper') return 'paper';
  if (id === 'light-zinc') return 'zinc';
  if (id === 'dark-espresso') return 'espresso';
  return 'obsidian';
}

export function modeFromThemeId(id: ThemeId): ColorMode {
  return id.startsWith('dark') ? 'dark' : 'light';
}

export interface ThemeContextType {
  themeId: ThemeId;
  colorMode: ColorMode;
  themeTone: ThemeTone;
  uiSkin: UiSkinId;
  setUiSkin: (skinId: UiSkinId) => void;
  accentColor: string | null;
  setAccentColor: (value: string | null) => void;
  setThemeId: (themeId: ThemeId) => void;
  toggleColorMode: () => void;
  eyeCare: boolean;
  toggleEyeCare: (enabled?: boolean) => void;
}

export const ThemeContext = createContext<ThemeContextType | null>(null);

export interface ThemeProviderProps {
  children?: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // 初始值必须与 SSR 渲染一致（light-paper / default）：localStorage 在挂载后再同步
  const [themeId, setThemeIdState] = useState<ThemeId>('light-paper');
  const [uiSkin, setUiSkinState] = useState<UiSkinId>('default');
  const [accentColor, setAccentState] = useState<string | null>(null);

  useEffect(() => {
    let initial: ThemeId = 'light-paper';
    try {
      const darkQuery = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      initial = readThemeId((key) => localStorage.getItem(key), darkQuery);
    } catch {
      /* 存储不可用时沿用默认 */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR 初始值必须保持 light-paper，挂载后单次同步本地持久化偏好
    setThemeIdState(initial);
    applyThemeId(document.documentElement, initial);
    const readSkin = () => {
      let savedSkin: UiSkinId = 'default';
      try {
        savedSkin = readUiSkinId((key) => localStorage.getItem(key));
      } catch {
        return;
      }
      setUiSkinState(savedSkin);
      applyUiSkin(document.documentElement, savedSkin);
    };
    readSkin();
    const readAccent = () => {
      let saved: string | null;
      try {
        saved = normalizeAccentColor(localStorage.getItem(ACCENT_STORAGE_KEY));
      } catch {
        return;
      }
      setAccentState(saved);
      applyCustomAccent(document.documentElement, saved);
    };
    readAccent();
    const syncAccent = (event: StorageEvent) => {
      if (event.key === ACCENT_STORAGE_KEY || event.key === null) readAccent();
      if (event.key === UI_SKIN_STORAGE_KEY || event.key === null) readSkin();
    };
    window.addEventListener('storage', syncAccent);
    return () => window.removeEventListener('storage', syncAccent);
  }, []);

  const setUiSkin = useCallback((nextSkin: UiSkinId) => {
    setUiSkinState(nextSkin);
    if (typeof window !== 'undefined') {
      try {
        if (nextSkin === 'default') localStorage.removeItem(UI_SKIN_STORAGE_KEY);
        else localStorage.setItem(UI_SKIN_STORAGE_KEY, nextSkin);
      } catch {
        /* ignore */
      }
      applyUiSkin(document.documentElement, nextSkin);
    }
  }, []);

  const setAccentColor = useCallback((value: string | null) => {
    const color = normalizeAccentColor(value);
    if (value !== null && color === null) return;
    setAccentState(color);
    applyCustomAccent(document.documentElement, color);
    try {
      if (color) localStorage.setItem(ACCENT_STORAGE_KEY, color);
      else localStorage.removeItem(ACCENT_STORAGE_KEY);
    } catch {
      // The selected color still works for this session.
    }
  }, []);

  const setThemeId = useCallback((nextId: ThemeId) => {
    setThemeIdState(nextId);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('sthstart_theme_id', nextId);
        localStorage.setItem('sthstart_theme', nextId);
        localStorage.setItem('sthstart_eye_care_mode', nextId === 'light-paper' ? 'true' : 'false');
      } catch {
        /* ignore */
      }
      applyThemeId(document.documentElement, nextId);
    }
  }, []);

  const toggleColorMode = useCallback(() => {
    setThemeIdState((curr) => {
      let next: ThemeId;
      if (curr === 'light-paper') next = 'dark-espresso';
      else if (curr === 'light-zinc') next = 'dark-obsidian';
      else if (curr === 'dark-espresso') next = 'light-paper';
      else next = 'light-zinc';

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('sthstart_theme_id', next);
          localStorage.setItem('sthstart_theme', next);
          localStorage.setItem('sthstart_eye_care_mode', next === 'light-paper' ? 'true' : 'false');
        } catch {
          /* ignore */
        }
        applyThemeId(document.documentElement, next);
      }
      return next;
    });
  }, []);

  const eyeCare = themeId === 'light-paper';

  const toggleEyeCare = useCallback((enabled?: boolean) => {
    setThemeIdState((prev) => {
      const shouldEnable = typeof enabled === 'boolean' ? enabled : prev !== 'light-paper';
      const next: ThemeId = shouldEnable ? 'light-paper' : 'light-zinc';
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('sthstart_theme_id', next);
          localStorage.setItem('sthstart_theme', next);
          localStorage.setItem('sthstart_eye_care_mode', shouldEnable ? 'true' : 'false');
        } catch {
          /* ignore */
        }
        applyThemeId(document.documentElement, next);
      }
      return next;
    });
  }, []);

  const colorMode = useMemo(() => modeFromThemeId(themeId), [themeId]);
  const themeTone = useMemo(() => toneFromThemeId(themeId), [themeId]);

  const value = useMemo<ThemeContextType>(
    () => ({
      themeId,
      colorMode,
      themeTone,
      uiSkin,
      setUiSkin,
      accentColor,
      setAccentColor,
      setThemeId,
      toggleColorMode,
      eyeCare,
      toggleEyeCare,
    }),
    [themeId, colorMode, themeTone, uiSkin, setUiSkin, accentColor, setAccentColor, setThemeId, toggleColorMode, eyeCare, toggleEyeCare]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider or UIProvider');
  }
  return context;
}

export function useEyeCare(): { eyeCare: boolean; toggleEyeCare: (enabled?: boolean) => void } {
  const { eyeCare, toggleEyeCare } = useTheme();
  return { eyeCare, toggleEyeCare };
}
