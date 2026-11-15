'use client';

import { useMemo, useState } from 'react';
import { StoryWorkspace, type StoryWorkspaceActions } from '@/app/features/story/story-workspace';
import { CreatePublicationDialog } from './create-publication-dialog';
import { StoryDerivativesDialog } from './story-derivatives-dialog';

/** Cross-domain production actions live above Story's document editing session. */
export function ConnectedStoryWorkspace({ projectId }: { projectId: string }) {
  const [productionOpen, setProductionOpen] = useState(false);
  const [derivativesOpen, setDerivativesOpen] = useState(false);
  const actions = useMemo<StoryWorkspaceActions>(() => ({
    onCreateProduction: () => setProductionOpen(true),
    onOpenDerivatives: () => setDerivativesOpen(true),
  }), []);
  return <StoryWorkspace projectId={projectId} actions={actions} overlay={context => <>
    <CreatePublicationDialog
      open={productionOpen} onOpenChange={setProductionOpen} projectId={projectId}
      chapters={context.chapters} activeId={context.activeEntry?.id} flush={context.flush}
    />
    <StoryDerivativesDialog
      open={derivativesOpen} onOpenChange={setDerivativesOpen} projectId={projectId}
      projectTitle={context.projectTitle} chapterTitle={context.chapterTitle} chapterBody={context.chapterBody}
    />
  </>} />;
}
