import type { ReactNode } from 'react';
import type { AddProjectLink } from '@sthstart/contracts';

export interface MediaAdoptActionInput {
  source: AddProjectLink;
  disabled?: boolean;
}

export type MediaAdoptAction = (input: MediaAdoptActionInput) => ReactNode;
