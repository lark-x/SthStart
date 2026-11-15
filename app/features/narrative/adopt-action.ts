import type { ReactNode } from 'react';
import type { AddProjectLink } from '@sthstart/contracts';

export interface NarrativeAdoptActionInput {
  source: AddProjectLink;
  disabled?: boolean;
}

export type NarrativeAdoptAction = (input: NarrativeAdoptActionInput) => ReactNode;
