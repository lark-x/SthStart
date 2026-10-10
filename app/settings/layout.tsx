'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Settings,
  SlidersHorizontal,
  Server,
  Activity,
  CloudUpload,
} from 'lucide-react';
import { cn } from '@/app/lib/cn';

interface SettingsTab {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const SETTINGS_TABS: SettingsTab[] = [
  {
    href: '/settings/public-services',
    label: '模型与服务',
    icon: Settings,
    description: '公共模型、服务连接与绑定',
  },
  {
    href: '/settings/generation',
    label: '生成配置',
    icon: SlidersHorizontal,
    description: '生成引擎、工作流与参数',
  },
  {
    href: '/settings/control-center',
    label: '运行控制',
    icon: Server,
    description: '邻舍后端栈、服务监控与日志',
  },
  {
    href: '/settings/ai-logs',
    label: '调用记录',
    icon: Activity,
    description: '业务模型与工作流调用审计',
  },
  {
    href: '/settings/backups',
    label: '云端备份',
    icon: CloudUpload,
    description: '工作区加密备份与恢复',
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-full flex flex-col">
      {/* Secondary Settings Tab Navigation Bar */}
      <nav
        aria-label="设置中心二级导航"
        className="sticky top-12 z-20 border-b border-border-subtle bg-surface/90 backdrop-blur-md transition-colors"
      >
        <div className="tpl-container py-2 flex items-center justify-between gap-4 overflow-x-auto">
          <div className="flex items-center gap-1.5 min-w-max">
            {SETTINGS_TABS.map((tab) => {
              const isActive =
                pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              const Icon = tab.icon;

              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors select-none',
                    isActive
                      ? 'bg-accent/10 text-accent font-semibold shadow-xs'
                      : 'text-muted hover:text-ink hover:bg-surface-hover'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                  title={tab.description}
                >
                  <Icon className="h-3.5 w-3.5 flex-none" />
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Settings Sub-page Content */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
