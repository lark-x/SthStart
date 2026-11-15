'use client';

import { Menu, Search, ListTodo } from 'lucide-react';
import { IconButton } from '@/app/components/ui/icon-button';
import { openCommandPalette } from '@/app/shell/command-palette-events';

/** Compact global tools travel with a page header, never consume a second row. */
export function PageGlobalActions() {
  /* `page-global-actions` / `page-global-nav` stay the sizing hooks; the shared
   * IconButton supplies focus ring, disabled state and the Mantine button shell. */
  return <div className="page-global-actions" role="group" aria-label="全局工具">
    {/* 事件带上真实触发器：WebKit 点击不聚焦按钮，抽屉关闭时靠它把焦点还回来。 */}
    <IconButton className="page-global-nav" icon={Menu} label="打开全站导航" title="全站导航" onClick={(event) => window.dispatchEvent(new CustomEvent('sthstart:open-nav-drawer', { detail: { trigger: event.currentTarget } }))} />
    <IconButton icon={Search} label="搜索与命令" title="搜索与命令 (Ctrl/Cmd+K)" onClick={(event) => openCommandPalette(event.currentTarget)} />
    <IconButton icon={ListTodo} label="打开全局任务抽屉" title="任务" onClick={() => window.dispatchEvent(new CustomEvent('sthstart:open-task-drawer'))} />
  </div>;
}
