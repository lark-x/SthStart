'use client';

import React from 'react';
import { Menu } from '@mantine/core';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { useOverlayPortalTarget } from '@/app/components/ui/overlay-policy';
import { cn } from '@/app/lib/cn';

interface StudioMenuProps {
  label: string;
  summaryContent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** 工作台内的上下文菜单：由 Mantine Menu 统一托管 Esc、外点关闭与焦点回焦。 */
export function StudioMenu({ label, summaryContent, children, className = '' }: StudioMenuProps) {
  const portalHost = useOverlayPortalTarget();

  return (
    <Menu
      position="bottom-end"
      withinPortal
      portalProps={portalHost ? { target: portalHost } : undefined}
      closeOnItemClick
      returnFocus
      transitionProps={{ duration: 100 }}
      shadow="md"
      radius="md"
    >
      <Menu.Target>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          title={label}
          className="h-9 min-h-0 px-2 text-sm font-normal text-muted hover:text-ink"
        >
          {summaryContent ?? <MoreHorizontal className="size-4" aria-hidden="true" />}
        </Button>
      </Menu.Target>
      <Menu.Dropdown aria-label={label} className={cn('ui-row-menu w-52', className)}>
        {children}
      </Menu.Dropdown>
    </Menu>
  );
}

interface StudioMenuItemProps {
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}

export function StudioMenuItem({ children, onSelect, danger = false, disabled = false, className = '' }: StudioMenuItemProps) {
  return (
    <Menu.Item
      disabled={disabled}
      onClick={onSelect}
      className={cn(danger && 'ui-menu-item-danger', className)}
    >
      {children}
    </Menu.Item>
  );
}
