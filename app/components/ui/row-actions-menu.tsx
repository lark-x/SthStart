'use client';

import React, { useState } from 'react';
import { Menu } from '@mantine/core';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/app/lib/cn';
import { IconButton } from './icon-button';
import { useOverlayEscapeLayer, useOverlayPortalTarget, useOverlayTransitionDuration } from './overlay-policy';

export interface RowActionItem {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  hidden?: boolean;
  separatorBefore?: boolean;
}

export function RowActionsMenu({
  label,
  items,
  className,
}: {
  label: string;
  items: RowActionItem[];
  className?: string;
}) {
  const [opened, setOpened] = useState(false);
  const host = useOverlayPortalTarget();
  const visibleItems = items.filter((item) => !item.hidden);

  useOverlayEscapeLayer(opened, () => setOpened(false), 'menu');
  const transitionDuration = useOverlayTransitionDuration(140);

  return (
    <Menu
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      withinPortal
      portalProps={host ? { target: host } : undefined}
      closeOnItemClick
      closeOnEscape={false}
      returnFocus
      transitionProps={{ duration: transitionDuration, transition: 'pop-top-right', timingFunction: 'var(--motion-spring)' }}
      shadow="md"
      radius="md"
    >
      <Menu.Target>
        <IconButton
          icon={MoreHorizontal}
          label={label}
          size="icon"
          variant="ghost"
          className={cn('h-10 w-10 shrink-0 text-muted hover:text-ink sm:h-9 sm:w-9', className)}
        />
      </Menu.Target>
      <Menu.Dropdown aria-label={label} data-sthstart-layer="menu" className="ui-row-menu">
        {visibleItems.map((item, index) => (
          <React.Fragment key={index}>
            {item.separatorBefore && <Menu.Divider />}
            <Menu.Item
              onClick={item.onSelect}
              leftSection={item.icon}
              className={cn(item.tone === 'danger' && 'ui-menu-item-danger')}
            >
              {item.label}
            </Menu.Item>
          </React.Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
