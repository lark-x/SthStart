import type { Metadata, Viewport } from 'next';
import './styles/theme.css';
import './globals.css';
import { QueryProvider } from './providers/query-provider';
import { UIProvider } from './providers/ui-provider';
import { GlobalCommandPalette } from './components/shared/command-palette';
import { RoutePreloader } from './components/shared/route-preloader';
import { NotebookSyncManager } from './features/notebook/components/notebook-sync-manager';
import { NotebookOfflineRegistrar } from './features/notebook/components/notebook-offline-registrar';

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
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('sthstart_eye_care_mode')==='true'){document.documentElement.setAttribute('data-eye-care','true');}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <QueryProvider>
          <UIProvider>
            {children}
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
