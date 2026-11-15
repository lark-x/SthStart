'use client';

import React from 'react';
import { ThemeSwitcher } from '@/app/shell/theme-switcher';

/**
 * 兼容旧入口，沿用侧栏的日间 / 夜间快捷切换。
 */
export function EyeCareToggle({ className }: { className?: string }) {
  return <ThemeSwitcher className={className} />;
}
