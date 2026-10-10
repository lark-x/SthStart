export type ColorMode = 'light' | 'dark';
export type ThemeTone = 'paper' | 'zinc' | 'espresso' | 'obsidian';
export type ThemeId = 'light-paper' | 'light-zinc' | 'dark-espresso' | 'dark-obsidian';
export type ThemeMode = 'warm' | 'neutral' | ThemeId;

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  category: '白天' | '黑夜';
  mode: ColorMode;
  tone: ThemeTone;
  accent: string;
  bg: string;
  description: string;
}

export const THEMES: readonly ThemeConfig[] = [
  {
    id: 'light-paper',
    name: 'Claude 暖白纸意',
    category: '白天',
    mode: 'light',
    tone: 'paper',
    accent: '#c2410c',
    bg: '#faf9f5',
    description: '纸张温润、人文沉静、陶土赤金',
  },
  {
    id: 'light-zinc',
    name: 'Codex 纯净冷白',
    category: '白天',
    mode: 'light',
    tone: 'zinc',
    accent: '#2563eb',
    bg: '#f4f4f5',
    description: '纯净冷白、科技理性、电光蓝靛',
  },
  {
    id: 'dark-espresso',
    name: 'Claude 暖黑深咖',
    category: '黑夜',
    mode: 'dark',
    tone: 'espresso',
    accent: '#ea580c',
    bg: '#1b1a18',
    description: '纸墨沉降、低对比温和、温润暖阳',
  },
  {
    id: 'dark-obsidian',
    name: 'Codex 曜石冷黑',
    category: '黑夜',
    mode: 'dark',
    tone: 'obsidian',
    accent: '#6366f1',
    bg: '#09090b',
    description: '纯粹深空、曜石冷峻、电光紫靛',
  },
] as const;

export function isThemeId(val: unknown): val is ThemeId {
  return typeof val === 'string' && (
    val === 'light-paper' ||
    val === 'light-zinc' ||
    val === 'dark-espresso' ||
    val === 'dark-obsidian'
  );
}

export function getThemeConfig(id: ThemeId): ThemeConfig {
  const found = THEMES.find((t) => t.id === id);
  return found ?? THEMES[0];
}

/**
 * 优先读取全新四维主题 ID，兼容读取既有暖杏/中性与护眼布尔值；
 * 若未设置偏好，则尊重系统 dark 模式偏好。
 */
export function readThemeId(
  getItem: (key: string) => string | null,
  systemPrefersDark = false,
): ThemeId {
  const currentId = getItem('sthstart_theme_id');
  if (isThemeId(currentId)) return currentId;

  const currentTheme = getItem('sthstart_theme');
  if (isThemeId(currentTheme)) return currentTheme;
  if (currentTheme === 'warm') return 'light-paper';
  if (currentTheme === 'neutral') return 'light-zinc';

  const legacyEye = getItem('sthstart_eye_care_mode');
  if (legacyEye === 'true') return 'light-paper';
  if (legacyEye === 'false') return 'light-zinc';

  if (systemPrefersDark) {
    return 'dark-espresso';
  }
  return 'light-paper';
}

/** 兼容旧版 readThemeMode，返回值保留 'warm' | 'neutral' 契约 */
export function readThemeMode(getItem: (key: string) => string | null): ThemeMode {
  const current = getItem('sthstart_theme');
  if (current === 'warm' || current === 'neutral') return current;
  if (current === 'light-paper') return 'warm';
  if (current === 'light-zinc') return 'neutral';

  const legacy = getItem('sthstart_eye_care_mode');
  if (legacy === 'true') return 'warm';
  if (legacy === 'false') return 'neutral';
  return 'warm';
}

export function applyThemeId(
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void; style?: { colorScheme?: string } },
  themeId: ThemeId,
) {
  const mode: ColorMode = themeId.startsWith('dark') ? 'dark' : 'light';
  root.setAttribute('data-theme', themeId);
  root.setAttribute('data-color-mode', mode);
  if (root.style) {
    root.style.colorScheme = mode;
  }
  if (themeId === 'light-paper') {
    root.setAttribute('data-eye-care', 'true');
  } else {
    root.removeAttribute('data-eye-care');
  }
}

export function applyThemeMode(
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void; style?: { colorScheme?: string } },
  mode: ThemeMode,
) {
  if (mode === 'warm' || mode === 'neutral') {
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-color-mode', 'light');
    if (root.style) {
      root.style.colorScheme = 'light';
    }
    if (mode === 'warm') {
      root.setAttribute('data-eye-care', 'true');
    } else {
      root.removeAttribute('data-eye-care');
    }
    return;
  }
  applyThemeId(root, mode);
}

/** Runs before first paint so CSS and the hydrated provider use the same migration rule. */
export const THEME_BOOTSTRAP_SCRIPT = `try{var i=localStorage.getItem('sthstart_theme_id')||localStorage.getItem('sthstart_theme');var e=localStorage.getItem('sthstart_eye_care_mode');var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var t='light-paper';if(i==='light-paper'||i==='light-zinc'||i==='dark-espresso'||i==='dark-obsidian'){t=i}else if(i==='warm'){t='light-paper'}else if(i==='neutral'){t='light-zinc'}else if(e==='true'){t='light-paper'}else if(e==='false'){t='light-zinc'}else if(d){t='dark-espresso'}var m=t.indexOf('dark')===0?'dark':'light';document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-color-mode',m);document.documentElement.style.colorScheme=m;if(t==='light-paper'){document.documentElement.setAttribute('data-eye-care','true')}else{document.documentElement.removeAttribute('data-eye-care')}}catch(e){document.documentElement.setAttribute('data-theme','light-paper');document.documentElement.setAttribute('data-color-mode','light');document.documentElement.style.colorScheme='light';document.documentElement.setAttribute('data-eye-care','true')}`;
