'use client';

import { Menu, ListTodo, Search, Sparkles } from 'lucide-react';
import type React from 'react';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { useGlobalTasks } from '@/app/features/tasks/queries';
import { openCommandPalette } from './command-palette-events';

export function WorkspaceGlobalActions() {
  const { data: globalTasksData } = useGlobalTasks({ state: 'active' });
  const activeTasksCount = globalTasksData?.activeCount ?? 0;

  const handleOpenNav = (event: React.MouseEvent<HTMLButtonElement>) => {
    window.dispatchEvent(new CustomEvent('sthstart:open-nav-drawer', { detail: { trigger: event.currentTarget } }));
  };

  const handleOpenTasks = () => {
    window.dispatchEvent(new CustomEvent('sthstart:open-task-drawer'));
  };

  /* Header tools are ordinary navigation and search actions: shared Button /
   * IconButton own size, focus ring and disabled state; only the label
   * breakpoint and the active-task dot stay local. */
  return <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleOpenNav}
          className="h-10 w-10 justify-center px-0 font-medium sm:h-9 sm:w-auto sm:px-2.5"
          title="全站导航"
          aria-label="打开全站导航"
        >
          {/* Mantine puts children in a borderless label box; the inner flex
              restores the icon/label spacing the native button had. */}
          <span className="inline-flex items-center gap-1.5">
            <Menu className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            <span className="hidden xl:inline">导航</span>
          </span>
        </Button>

        <IconButton
          icon={Sparkles}
          label="打开 AI 创作助手"
          title="AI 创作助手 (Ctrl/Cmd+J)"
          iconClassName="h-3.5 w-3.5 text-muted"
          onClick={() => window.dispatchEvent(new CustomEvent('sthstart:open-ai-drawer'))}
        />

        <IconButton
          icon={Search}
          label="搜索与命令"
          title="搜索与命令 (Ctrl/Cmd+K)"
          iconClassName="h-3.5 w-3.5 text-muted"
          onClick={(event) => openCommandPalette(event.currentTarget)}
        />

        {/* The active-task dot sits outside the button so Mantine's clipped label
            box cannot crop it, and the button keeps a single accessible name. */}
        <span className="relative inline-flex shrink-0">
          <IconButton
            icon={ListTodo}
            label="打开全局任务抽屉"
            title="全局任务抽屉"
            iconClassName="h-3.5 w-3.5 text-muted"
            onClick={handleOpenTasks}
          />
          {activeTasksCount > 0 && (
            <span aria-hidden="true" className="pointer-events-none absolute -top-1 -right-1 flex h-2 w-2">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
            </span>
          )}
        </span>
  </>;
}
