'use client';

import { AdoptIntoProject } from '@/app/features/projects/adopt-into-project';
import { MediaLibraryView } from '@/app/features/media-library/media-library-view';
import type { MediaAdoptActionInput } from '@/app/features/media-library/adopt-action';

function renderAdoptAction({ source, disabled }: MediaAdoptActionInput) {
  return <AdoptIntoProject source={source} disabled={disabled} />;
}

export function MediaWorkspace() {
  return <MediaLibraryView adoptAction={renderAdoptAction} />;
}
