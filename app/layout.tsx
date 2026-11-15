import type { Metadata, Viewport } from 'next';
import './globals.css';
import './styles/shell.css';
import './styles/workspace-unified.css';
import './styles/anchored-popover.css';
import './styles/pagination.css';
import { QueryProvider } from './providers/query-provider';
import { UIProvider } from './providers/ui-provider';
import { ShellHeaderSlots } from './shell/header-slots-provider';
import { AppShell } from '@/app/shell/app-shell';
import { GlobalCommandPalette } from '@/app/shell/command-palette';
import { RoutePreloader } from '@/app/shell/route-preloader';
import { NotebookSyncManager } from './features/notebook/components/notebook-sync-manager';
import { NotebookOfflineRegistrar } from './features/notebook/components/notebook-offline-registrar';
import { ACCENT_BOOTSTRAP_SCRIPT, THEME_BOOTSTRAP_SCRIPT } from './lib/theme-preference';
import { SIDEBAR_BOOTSTRAP_SCRIPT } from './shell/sidebar-preference';

export const metadata: Metadata = {
  title: 'SthStart — 本地互动应用门户',
  description: '连接邻舍.EXE 与未来互动体验的本地优先应用门户。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // `data-mantine-color-scheme` 的 SSR 默认值与 Mantine 的 `mantineHtmlProps` 一致：
  // 首屏脚本会在绘制前按本地偏好改写它，静态值只用于无脚本兜底，
  // 不会与客户端主题产生第二份状态。
  return (
    <html
      lang="zh-CN"
      data-theme="light-paper"
      data-color-mode="light"
      data-mantine-color-scheme="light"
      data-nav-collapsed="true"
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOTSTRAP_SCRIPT + ';' + ACCENT_BOOTSTRAP_SCRIPT + ';' + SIDEBAR_BOOTSTRAP_SCRIPT,
          }}
        />
      </head>
      <body>
        <QueryProvider>
          <UIProvider>
            <ShellHeaderSlots><AppShell>{children}</AppShell></ShellHeaderSlots>
            <NotebookSyncManager />
            <NotebookOfflineRegistrar />
            <RoutePreloader />
            <GlobalCommandPalette />
          </UIProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
