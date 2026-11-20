'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Globe2, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/app/components/ui/button';
import { StoryWorkspace, type StoryWorkspaceActions } from '@/app/features/story/story-workspace';
import { useWorldProjectBinding } from '@/app/features/story-worlds/queries';
import { CreatePublicationDialog } from './create-publication-dialog';
import { StoryDerivativesDialog } from './story-derivatives-dialog';

/** Cross-domain production actions live above Story's document editing session. */
export function ConnectedStoryWorkspace({ projectId }: { projectId: string }) {
  const [productionOpen, setProductionOpen] = useState(false);
  const [derivativesOpen, setDerivativesOpen] = useState(false);
  const bindingQuery = useWorldProjectBinding(projectId);
  const binding = bindingQuery.data?.binding ?? null;

  const actions = useMemo<StoryWorkspaceActions>(() => ({
    onCreateProduction: () => setProductionOpen(true),
    onOpenDerivatives: () => setDerivativesOpen(true),
    extraHeaderActions: binding ? (
      <div className="flex items-center gap-1.5">
        <Link
          href={`/apps/story-worlds?world=${encodeURIComponent(binding.worldId)}&branch=${encodeURIComponent(binding.branchId)}&view=chapters`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
          所属作品
        </Link>
        <Link
          href={`/apps/story-worlds?world=${encodeURIComponent(binding.worldId)}&branch=${encodeURIComponent(binding.branchId)}&view=chapters`}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          AI 续写
        </Link>
      </div>
    ) : undefined,
  }), [binding]);

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
