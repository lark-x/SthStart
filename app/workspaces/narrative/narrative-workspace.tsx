'use client';

import { AdoptIntoProject } from '@/app/features/projects/adopt-into-project';
import { NarrativeWorkspace as NarrativeWorkspaceView } from '@/app/features/narrative/components/narrative-workspace';
import type { NarrativeAdoptActionInput } from '@/app/features/narrative/adopt-action';

function renderAdoptAction({ source, disabled }: NarrativeAdoptActionInput) {
  return <AdoptIntoProject source={source} disabled={disabled} />;
}

export function NarrativeWorkspace() {
  return <NarrativeWorkspaceView adoptAction={renderAdoptAction} />;
}
