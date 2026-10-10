import type { Metadata, Viewport } from 'next';
import './globals.css';
import './styles/shell.css';
import { QueryProvider } from './providers/query-provider';
import { UIProvider } from './providers/ui-provider';
import { AppShell } from './components/shared/app-shell';
import { GlobalCommandPalette } from './components/shared/command-palette';
import { RoutePreloader } from './components/shared/route-preloader';
import { NotebookSyncManager } from './features/notebook/components/notebook-sync-manager';
import { NotebookOfflineRegistrar } from './features/notebook/components/notebook-offline-registrar';
import { THEME_BOOTSTRAP_SCRIPT } from './lib/theme-preference';

export const metadata: Metadata = {
  title: 'SthStart — 本地互动应用门户',
  description: '连接邻舍.EXE 与未来互动体验的本地优先应用门户。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="light-paper" data-color-mode="light" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOTSTRAP_SCRIPT,
          }}
        />
      </head>
      <body>
        <QueryProvider>
          <UIProvider>
            <AppShell>{children}</AppShell>
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
