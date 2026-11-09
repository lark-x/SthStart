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
import { PageContainer } from '@/app/components/shared/page-layout';
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
      <PageContainer>
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <nav
            aria-label="设置中心二级导航"
            className="tpl-panel min-w-0 p-2 lg:sticky lg:top-[calc(var(--shell-sticky-top)_+_1rem)] lg:self-start"
          >
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
              {SETTINGS_TABS.map((tab) => {
                const isActive =
                  pathname === tab.href || pathname.startsWith(`${tab.href}/`);
                const Icon = tab.icon;

                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className="settings-navigation-link flex min-h-10 flex-none items-center gap-2 rounded-control px-3 py-2 text-sm lg:w-full"
                    title={tab.description}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap">{tab.label}</span>

                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className={`${styles.panel} min-w-0`}>
            {children}
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
