'use client';

import type { ReactNode } from 'react';
import { HeaderSlotsContext, type HeaderSlots } from '@/app/components/shared/header-slots';
import { PageGlobalActions } from './page-global-actions';
import { PageHeaderIcon } from './page-header-icon';
import { WorkspaceGlobalActions } from './workspace-global-actions';

const slots: HeaderSlots = {
  pageTools: <PageGlobalActions />,
  workspaceTools: <WorkspaceGlobalActions />,
  pageIcon: <PageHeaderIcon />,
  compactPageIcon: <PageHeaderIcon compact />,
};

export function ShellHeaderSlots({ children }: { children: ReactNode }) {
  return <HeaderSlotsContext.Provider value={slots}>{children}</HeaderSlotsContext.Provider>;
}
