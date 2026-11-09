'use client';

import { Menu, Search, ListTodo } from 'lucide-react';
import { openCommandPalette } from './command-palette-events';

/** Compact global tools travel with a page header, never consume a second row. */
export function PageGlobalActions() {
  return <div className="page-global-actions" aria-label="全局工具">
    <button type="button" className="page-global-nav" aria-label="打开全站导航" title="全站导航" onClick={() => window.dispatchEvent(new CustomEvent('sthstart:open-nav-drawer'))}><Menu aria-hidden="true" /></button>
    <button type="button" aria-label="搜索与命令" title="搜索与命令 (Ctrl/Cmd+K)" onClick={openCommandPalette}><Search aria-hidden="true" /></button>
    <button type="button" aria-label="打开全局任务抽屉" title="任务" onClick={() => window.dispatchEvent(new CustomEvent('sthstart:open-task-drawer'))}><ListTodo aria-hidden="true" /></button>
  </div>;
}
