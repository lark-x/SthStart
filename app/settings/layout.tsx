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
import styles from './settings-layout.module.css';

interface SettingsTab {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const SETTINGS_TABS: SettingsTab[] = [
  {
    href: '/settings/public-services',
    label: '模型与连接',
    icon: Settings,
    description: '公共模型、服务连接与绑定',
  },
  {
    href: '/settings/generation',
    label: '生成方案',
    icon: SlidersHorizontal,
    description: '生成引擎、工作流与参数方案',
  },
  {
    href: '/settings/control-center',
    label: '运行诊断',
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
    label: '数据备份',
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
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-[calc(var(--shell-settings-max)_+_13rem)] px-3 py-3 sm:px-6 lg:py-8">
        <div className="settings-workspace-grid grid min-w-0 gap-3 sm:gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
          <nav
            aria-label="设置中心二级导航"
            className="settings-workspace-sidebar min-w-0 border-b border-border-subtle pb-2 lg:border-b-0 lg:pb-0 lg:sticky lg:top-[calc(var(--shell-sticky-top)_+_1.5rem)] lg:self-start"
          >
            <div className="mb-4 hidden border-b border-border-subtle pb-4 lg:block">
              <p className="text-xs font-semibold tracking-[0.08em] text-muted">设置中心</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">模型连接、生成方案、运行诊断与数据安全</p>
            </div>
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
              {SETTINGS_TABS.map((tab) => {
                const isActive =
                  pathname === tab.href || pathname.startsWith(`${tab.href}/`);
                const Icon = tab.icon;

                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className="settings-navigation-link flex-none items-center rounded-control px-2.5 py-1.5 text-xs sm:text-sm lg:w-full lg:min-h-14 lg:items-start lg:rounded-none lg:px-3 lg:py-2.5"
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="h-3.5 w-3.5 flex-none lg:mt-0.5 lg:h-4 lg:w-4" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap">{tab.label}</span>
                      <span className="mt-0.5 hidden text-xs font-normal leading-snug text-muted lg:block">
                        {tab.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className={`${styles.panel} settings-workspace-content min-w-0`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
