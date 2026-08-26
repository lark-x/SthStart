import type { Metadata } from 'next';
import './styles/theme.css';
import './globals.css';
import { QueryProvider } from './providers/query-provider';
import { UIProvider } from './providers/ui-provider';
import { GlobalCommandPalette } from './components/shared/command-palette';

export const metadata: Metadata = {
  title: 'SthStart — 本地互动应用门户',
  description: '连接邻舍.EXE 与未来互动体验的本地优先应用门户。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <QueryProvider>
          <UIProvider>
            {children}
            <GlobalCommandPalette />
          </UIProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
