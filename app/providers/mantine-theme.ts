import {
  createTheme,
  defaultVariantColorsResolver,
  type MantineColorScheme,
  type MantineColorSchemeManager,
  type MantineColorsTuple,
  type MantineThemeOverride,
  type VariantColorsResolver,
} from '@mantine/core';

/**
 * Mantine 主题桥接（A1）
 *
 * 单一主题来源仍是 `app/styles/theme.css`。Mantine 的 CSS 变量改由
 * `app/styles/mantine-bridge.css` 以项目 token 静态声明（provider 关闭
 * withCssVariables），因此首屏不再生成约 27 KB 的默认色板；本文件只保留
 * 主题对象、变体解析与配色归属。
 */

/** 项目强调色作为 Mantine 主色名，避免与语义色 `blue`（信息）混淆。 */
export const STHSTART_PRIMARY_COLOR = 'sthstart';

/**
 * 主色色阶全部指向 `var(--accent)`：Mantine 只把它写进 CSS 变量，
 * 实际取值由 theme.css 按当前主题与自定义强调色决定。
 */
const PRIMARY_COLOR_TUPLE: MantineColorsTuple = [
  'var(--accent)',
  'var(--accent)',
  'var(--accent)',
  'var(--accent)',
  'var(--accent)',
  'var(--accent)',
  'var(--accent)',
  'var(--accent)',
  'var(--accent)',
  'var(--accent)',
];

interface StatusPalette {
  solid: string;
  onSolid: string;
  soft: string;
  softHover: string;
  fg: string;
}

const STATUS_COLORS: Record<string, StatusPalette> = {
  red: {
    solid: 'var(--danger-solid)',
    onSolid: 'var(--danger-on-solid)',
    soft: 'var(--danger-bg)',
    softHover: 'color-mix(in srgb, var(--danger) 16%, var(--surface))',
    fg: 'var(--danger-fg)',
  },
  green: {
    solid: 'var(--success-solid)',
    onSolid: 'var(--success-on-solid)',
    soft: 'var(--success-bg)',
    softHover: 'color-mix(in srgb, var(--success) 16%, var(--surface))',
    fg: 'var(--success-fg)',
  },
  yellow: {
    solid: 'var(--warning-solid)',
    onSolid: 'var(--warning-on-solid)',
    soft: 'var(--warning-bg)',
    softHover: 'color-mix(in srgb, var(--warning) 18%, var(--surface))',
    fg: 'var(--warning-fg)',
  },
  blue: {
    solid: 'var(--info-solid)',
    onSolid: 'var(--info-on-solid)',
    soft: 'var(--info-bg)',
    softHover: 'color-mix(in srgb, var(--info) 16%, var(--surface))',
    fg: 'var(--info-fg)',
  },
};

/**
 * 变体解析：主色与语义色都返回项目 token，显式 `color` 不会落到 Mantine 的
 * 静态色阶。其余颜色（例如 `color="grape"`）仍交给官方解析器。
 */
export const sthstartVariantColorsResolver: VariantColorsResolver = (input) => {
  const color = input.color;
  const isPrimary = !color || color === STHSTART_PRIMARY_COLOR;
  const status = !isPrimary && color ? STATUS_COLORS[color] : undefined;

  if (!isPrimary && !status) {
    return defaultVariantColorsResolver(input);
  }

  const filled: StatusPalette = isPrimary
    ? {
        solid: 'var(--accent)',
        onSolid: 'var(--fg-on-accent)',
        soft: 'var(--accent-soft)',
        softHover: 'color-mix(in srgb, var(--accent) 18%, var(--surface))',
        fg: 'var(--accent-dark)',
      }
    : status!;

  switch (input.variant) {
    case 'filled':
      return {
        background: filled.solid,
        hover: isPrimary ? 'var(--accent-dark)' : filled.softHover,
        color: filled.onSolid,
        hoverColor: filled.onSolid,
        border: '1px solid transparent',
      };
    case 'light':
      return {
        background: filled.soft,
        hover: filled.softHover,
        color: filled.fg,
        border: '1px solid transparent',
      };
    case 'outline':
      return {
        background: 'transparent',
        hover: filled.soft,
        color: filled.fg,
        border: `1px solid ${filled.fg}`,
      };
    case 'subtle':
    case 'transparent':
      return {
        background: 'transparent',
        hover: filled.soft,
        color: filled.fg,
        border: '1px solid transparent',
      };
    case 'default':
      return {
        background: 'var(--surface-raised)',
        hover: 'var(--surface-hover)',
        color: 'var(--fg-default)',
        border: '1px solid var(--border-default)',
      };
    case 'white':
      return {
        background: 'var(--surface-raised)',
        hover: 'var(--surface-hover)',
        color: filled.fg,
        border: '1px solid transparent',
      };
    default:
      return defaultVariantColorsResolver(input);
  }
};

export const STHSTART_MANTINE_THEME: MantineThemeOverride = createTheme({
  colors: { [STHSTART_PRIMARY_COLOR]: PRIMARY_COLOR_TUPLE },
  primaryColor: STHSTART_PRIMARY_COLOR,
  primaryShade: { light: 6, dark: 6 },
  defaultRadius: 'md',
  respectReducedMotion: true,
  cursorType: 'pointer',
  focusRing: 'auto',
  fontSmoothing: false,
  variantColorResolver: sthstartVariantColorsResolver,
  headings: {
    fontFamily: 'var(--font-sans)',
    fontWeight: '600',
    textWrap: 'balance',
  },
});

/**
 * 主题事件的唯一通道：`applyThemeId` 改写 `html` 属性后广播当前 mode，
 * Mantine 通过官方 colorSchemeManager 订阅，不再自行持久化。
 */
export const THEME_CHANGE_EVENT = 'sthstart:color-scheme';

const schemeListeners = new Set<(scheme: MantineColorScheme) => void>();
let subscribedWindow: unknown = null;

function readDocumentScheme(): 'light' | 'dark' | null {
  if (typeof document === 'undefined') return null;
  const value = document.documentElement?.getAttribute('data-mantine-color-scheme');
  return value === 'light' || value === 'dark' ? value : null;
}

function handleThemeChange(event: Event) {
  const detail = (event as CustomEvent<MantineColorScheme>).detail;
  if (detail !== 'light' && detail !== 'dark') return;
  schemeListeners.forEach((listener) => listener(detail));
}

/**
 * 不读也不写 localStorage。首屏由内联脚本写入的属性就是权威值，因此
 * Mantine 的挂载 effect 会把同一值写回，不产生浅色/深色闪烁。
 */
export const STHSTART_COLOR_SCHEME_MANAGER: MantineColorSchemeManager = {
  get: (defaultValue) => readDocumentScheme() ?? defaultValue,
  set: (value) => {
    if (typeof document === 'undefined') return;
    if (value === 'light' || value === 'dark') {
      document.documentElement?.setAttribute('data-mantine-color-scheme', value);
    }
  },
  subscribe: (onUpdate) => {
    schemeListeners.add(onUpdate);
    // 以 window 实例为键：测试/HMR 替换全局对象后仍能重新订阅。
    if (
      subscribedWindow !== window &&
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      subscribedWindow = window;
      window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    }
  },
  unsubscribe: () => {
    schemeListeners.clear();
  },
  clear: () => {},
};
