'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/app/lib/cn';

const apps = [
  ['/', '门户'],
  ['/apps/activities', '活动工作室'],
  ['/apps/creative', '创作中心'],
  ['/apps/characters', '角色资料库'],
  ['/apps/notebook', '创作笔记'],
  ['/apps/narrative', '叙事档案'],
  ['/settings/control-center', '控制中心'],
  ['/settings/public-services', '公共服务'],
  ['/settings/generation', '生成配置'],
];

export function AppSwitcher({ className }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const selected = apps.find(([path]) => path !== '/' && pathname.startsWith(path))?.[0] ?? '/';

  return (
    <select
      aria-label="切换应用"
      value={selected}
      onChange={(event) => router.push(event.target.value)}
      className={cn(
        'inline-flex items-center h-8 px-2 sm:px-2.5 text-sm font-medium rounded-md cursor-pointer select-none shrink-0',
        'bg-surface hover:bg-white text-ink border border-[rgb(24_32_29/14%)] shadow-2xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
        'w-auto max-w-[110px] sm:max-w-40 truncate',
        className
      )}
    >
      {apps.map(([path, title]) => (
        <option key={path} value={path} className="bg-surface text-ink py-1">
          {title}
        </option>
      ))}
    </select>
  );
}

