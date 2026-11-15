'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Presentation slots supplied by the application. Shared headers know no business queries. */
export interface HeaderSlots {
  pageTools?: ReactNode;
  workspaceTools?: ReactNode;
  pageIcon?: ReactNode;
  compactPageIcon?: ReactNode;
}

export const HeaderSlotsContext = createContext<HeaderSlots>({});

export function HeaderSlot({ name }: { name: keyof HeaderSlots }) {
  return useContext(HeaderSlotsContext)[name] ?? null;
}
