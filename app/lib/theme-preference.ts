export type ColorMode = 'light' | 'dark';
export type ThemeTone = 'paper' | 'zinc' | 'espresso' | 'obsidian';
export type ThemeId = 'light-paper' | 'light-zinc' | 'dark-espresso' | 'dark-obsidian';
export type ThemeMode = 'warm' | 'neutral' | ThemeId;
export type UiSkinId = 'default' | 'genshin' | 'sticker';

export const UI_SKIN_STORAGE_KEY = 'sthstart_ui_skin';

export interface UiSkinConfig {
  id: UiSkinId;
  name: string;
  badge: string;
  accent: string;
  bg: string;
  surface: string;
  description: string;
}

export const UI_SKINS: readonly UiSkinConfig[] = [
  {
    id: 'default',
    name: '经典纸感',
    badge: '默认',
    accent: '#665995',
    bg: '#f3f0e9',
    surface: '#fcfbf8',
    description: '原生轻盈暖纸与克制发丝边',
  },
  {
    id: 'genshin',
    name: '原神 · 轻纪行',
    badge: '纪行',
    accent: '#3b4255',
    bg: '#efeae0',
    surface: '#faf7f0',
    description: '羊皮纪行纸感、微金内环与2px实体微底座',
  },
  {
    id: 'sticker',
    name: '手账贴纸',
    badge: '贴纸',
    accent: '#4c648c',
    bg: '#f3f0e8',
    surface: '#fcfbf8',
    description: '墨水细描边、2px硬边贴纸底座与双层内胆',
  },
] as const;

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  category: '白天' | '黑夜';
  mode: ColorMode;
  tone: ThemeTone;
  accent: string;
  bg: string;
  surface: string;
  description: string;
}

export const THEMES: readonly ThemeConfig[] = [
  {
    id: 'light-paper',
    name: '暖白',
    category: '白天',
    mode: 'light',
    tone: 'paper',
    accent: '#665995',
    bg: '#f3f0e9',
    surface: '#fcfbf8',
    description: '暖灰导航、纸面编辑区与紧凑工具栏',
  },
  {
    id: 'light-zinc',
    name: '云白',
    category: '白天',
    mode: 'light',
    tone: 'zinc',
    accent: '#515f98',
    bg: '#ebedf0',
    surface: '#f8fafc',
    description: '柔和雾灰底、冷灰面板与沉静靛蓝',
  },
  {
    id: 'dark-espresso',
    name: '暖夜',
    category: '黑夜',
    mode: 'dark',
    tone: 'espresso',
    accent: '#aaa0d2',
    bg: '#2a2825',
    surface: '#34312d',
    description: '中等暖灰底、柔和文字与灰紫强调',
  },
  {
    id: 'dark-obsidian',
    name: '深空',
    category: '黑夜',
    mode: 'dark',
    tone: 'obsidian',
    accent: '#a2add6',
    bg: '#242830',
    surface: '#2c323c',
    description: '中等蓝灰底、清晰层次与柔和蓝紫',
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

export function isUiSkinId(val: unknown): val is UiSkinId {
  return val === 'default' || val === 'genshin' || val === 'sticker';
}

export function readUiSkinId(getItem: (key: string) => string | null): UiSkinId {
  const raw = getItem(UI_SKIN_STORAGE_KEY);
  return isUiSkinId(raw) ? raw : 'default';
}

export function applyUiSkin(
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  skinId: UiSkinId,
) {
  if (skinId === 'genshin' || skinId === 'sticker') {
    root.setAttribute('data-ui-skin', skinId);
  } else {
    root.removeAttribute('data-ui-skin');
  }
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

export const ACCENT_STORAGE_KEY = 'sthstart_accent_color';

export function normalizeAccentColor(value: string | null): string | null {
  const hex = value?.trim().replace(/^#/, '');
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex.toUpperCase() : null;
}

/** Keep the chosen color where contrast allows; adjust only towards white or black. */
export function deriveCustomAccent(hex: string, dark: boolean): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255];
  const luminance = (rgb: number[]) => rgb.reduce((sum, component, index) => {
    const c = component / 255;
    return sum + [0.2126, 0.7152, 0.0722][index] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  }, 0);
  // Keep text readable on the existing raised and recessed surfaces in both modes.
  const meetsContrast = (rgb: number[]) => dark ? luminance(rgb) >= 0.37 : luminance(rgb) <= 0.12;
  if (meetsContrast(channels)) return hex;
  const limit = dark ? 255 : 0;
  const mix = (amount: number) => channels.map(channel => Math.round(channel + (limit - channel) * amount));
  let low = 0;
  let high = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    if (meetsContrast(mix(mid))) high = mid;
    else low = mid;
  }
  return '#' + mix(high).map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function applyCustomAccent(root: HTMLElement, hex: string | null) {
  if (hex) {
    root.style.setProperty('--custom-accent-light', deriveCustomAccent(hex, false));
    root.style.setProperty('--custom-accent-dark', deriveCustomAccent(hex, true));
    root.setAttribute('data-custom-accent', hex);
  } else {
    root.removeAttribute('data-custom-accent');
    root.style.removeProperty('--custom-accent-light');
    root.style.removeProperty('--custom-accent-dark');
  }
}

// These standalone functions also run before the first paint, using the same contrast rules.
export const ACCENT_BOOTSTRAP_SCRIPT = `try{const derive=(${deriveCustomAccent.toString()});const hex=(${normalizeAccentColor.toString()})(localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)}));if(hex){const root=document.documentElement;root.style.setProperty('--custom-accent-light',derive(hex,false));root.style.setProperty('--custom-accent-dark',derive(hex,true));root.setAttribute('data-custom-accent',hex)}}catch{}`;

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
  // Mantine 只读取这个属性；由这里统一写入，避免 provider 与首屏脚本争夺首色。
  root.setAttribute('data-mantine-color-scheme', mode);
  if (root.style) {
    root.style.colorScheme = mode;
  }
  if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute('content', mode);
    }
  }
  if (themeId === 'light-paper') {
    root.setAttribute('data-eye-care', 'true');
  } else {
    root.removeAttribute('data-eye-care');
  }
  notifyColorSchemeChange(mode);
}

/**
 * 广播当前配色，供 Mantine 的 colorSchemeManager 订阅。
 * 纯 DOM 环境（例如测试或非浏览器宿主）没有 window 时静默跳过。
 */
function notifyColorSchemeChange(mode: ColorMode) {
  try {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    if (typeof CustomEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('sthstart:color-scheme', { detail: mode }));
  } catch {
    // 主题属性已写入；广播失败不应影响页面渲染。
  }
}

export function applyThemeMode(
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void; style?: { colorScheme?: string } },
  mode: ThemeMode,
) {
  if (mode === 'warm' || mode === 'neutral') {
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-color-mode', 'light');
    root.setAttribute('data-mantine-color-scheme', 'light');
    if (root.style) {
      root.style.colorScheme = 'light';
    }
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) {
        meta.setAttribute('content', 'light');
      }
    }
    if (mode === 'warm') {
      root.setAttribute('data-eye-care', 'true');
    } else {
      root.removeAttribute('data-eye-care');
    }
    notifyColorSchemeChange('light');
    return;
  }
  applyThemeId(root, mode);
}

/**
 * Runs before first paint so CSS and the hydrated provider use the same migration rule.
 * `data-mantine-color-scheme` 与 `data-color-mode` 同源写入：Mantine 的首屏样式
 * 依赖该属性，不能等到 React 挂载后再补。
 */
export const THEME_BOOTSTRAP_SCRIPT = `try{var i=localStorage.getItem('sthstart_theme_id')||localStorage.getItem('sthstart_theme');var e=localStorage.getItem('sthstart_eye_care_mode');var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var t='light-paper';if(i==='light-paper'||i==='light-zinc'||i==='dark-espresso'||i==='dark-obsidian'){t=i}else if(i==='warm'){t='light-paper'}else if(i==='neutral'){t='light-zinc'}else if(e==='true'){t='light-paper'}else if(e==='false'){t='light-zinc'}else if(d){t='dark-espresso'}var m=t.indexOf('dark')===0?'dark':'light';document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-color-mode',m);document.documentElement.setAttribute('data-mantine-color-scheme',m);document.documentElement.style.colorScheme=m;var mc=document.querySelector('meta[name="color-scheme"]');if(mc){mc.setAttribute('content',m);}if(t==='light-paper'){document.documentElement.setAttribute('data-eye-care','true')}else{document.documentElement.removeAttribute('data-eye-care')}var s=localStorage.getItem('sthstart_ui_skin');if(s==='genshin'||s==='sticker'){document.documentElement.setAttribute('data-ui-skin',s)}else{document.documentElement.removeAttribute('data-ui-skin')}}catch(e){document.documentElement.setAttribute('data-theme','light-paper');document.documentElement.setAttribute('data-color-mode','light');document.documentElement.setAttribute('data-mantine-color-scheme','light');document.documentElement.style.colorScheme='light';var mc=document.querySelector('meta[name="color-scheme"]');if(mc){mc.setAttribute('content','light');}document.documentElement.setAttribute('data-eye-care','true')}`;
