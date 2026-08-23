import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SthStart — 本地互动应用门户',
  description: '连接邻舍.EXE 与未来互动体验的本地优先应用门户。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
