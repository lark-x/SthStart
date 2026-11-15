'use client';

import React from 'react';
import { MantineProvider } from '@mantine/core';
import { useTheme } from './theme-provider';
import {
  STHSTART_COLOR_SCHEME_MANAGER,
  STHSTART_MANTINE_THEME,
} from './mantine-theme';

/**
 * Mantine 与项目四主题之间的唯一连接点。
 *
 * 刻意不使用 `forceColorScheme`：Mantine 的挂载 effect 会先写入
 * `manager.get()` 再写入 force 值；若 force 来自尚未同步的 React state，
 * 暗色首屏会被短暂改回浅色。这里改由 colorSchemeManager 读取首屏脚本已经写入
 * 的 `data-mantine-color-scheme`，并订阅 `applyThemeId` 广播的变更，
 * 因此该属性只有一个写入者，切换主题不会出现闪色。
 *
 * CSS 变量由 `app/styles/mantine-bridge.css` 以项目 token 静态声明，
 * 关闭 provider 的运行时变量生成，避免首屏重复输出默认色板。
 */
export function MantineThemeBridge({ children }: { children?: React.ReactNode }) {
  const { colorMode } = useTheme();

  return (
    <MantineProvider
      theme={STHSTART_MANTINE_THEME}
      defaultColorScheme={colorMode}
      colorSchemeManager={STHSTART_COLOR_SCHEME_MANAGER}
      withCssVariables={false}
      withGlobalClasses={false}
      getRootElement={() => (typeof document === 'undefined' ? undefined : document.documentElement)}
    >
      {children}
    </MantineProvider>
  );
}
