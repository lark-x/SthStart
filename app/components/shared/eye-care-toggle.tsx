'use client';

import React from 'react';
import { ThemeSwitcher } from './theme-switcher';

/**
 * 兼容旧版 EyeCareToggle 组件入口，底层已升级为对标 Claude / Codex 的四维主题切换器。
 */
export function EyeCareToggle({ className }: { className?: string }) {
  return <ThemeSwitcher className={className} />;
}
