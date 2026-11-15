'use client';

import { AdoptIntoProject } from '@/app/features/projects/adopt-into-project';
import type {
  WorldImageAdoptAction,
  WorldImageAdoptInput,
} from '@/app/features/story-worlds/reading';

export function renderWorldImageAdoptAction({ artifactId, disabled }: WorldImageAdoptInput) {
  return (
    <AdoptIntoProject
      source={{ kind: 'artifact', id: artifactId }}
      disabled={disabled}
    />
  );
}

export const worldImageAdoptAction: WorldImageAdoptAction = renderWorldImageAdoptAction;
