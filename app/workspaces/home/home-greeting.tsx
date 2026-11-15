'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { PageHeader } from '@/app/components/shared/page-header';

const subscribe = () => () => {};

function greetingFor(hour: number) {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function readGreeting() {
  const now = new Date();
  const date = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  return `${greetingFor(now.getHours())}|${date}`;
}

/** 首页问候：服务端渲染先给中性文案，水合后按本机时间替换，避免时区差导致的水合不一致。 */
export function HomeGreeting({ actions }: { actions?: ReactNode }) {
  const value = useSyncExternalStore(subscribe, readGreeting, () => '');
  const [greeting, date] = value ? value.split('|') : ['', ''];

  return (
    <PageHeader
      compact
      title="工作台"
      actions={actions}
      navigation={
        date ? (
          <div className="flex flex-wrap items-center gap-2.5" data-visual-dynamic="true">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-0.5 text-xs font-medium text-ink shadow-2xs">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              <span>{greeting}</span>
            </span>
            <span className="text-xs font-medium text-muted tabular-nums">{date} · 本地优先创作空间</span>
          </div>
        ) : undefined
      }
    />
  );
}
