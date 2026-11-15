'use client';

import { useCallback } from 'react';
import type { ActivityScene, ContentDocument, SceneBeat, StageDefinition } from '@sthstart/contracts';
import type { StudioDraftController } from '../model/draft-controller';

export function useStudioCandidateAdoption({
  draft,
  activeStage,
  activeScene,
  selectedBeat,
  refetchActivity,
  refetchDraft,
}: {
  draft: StudioDraftController;
  activeStage: StageDefinition | null;
  activeScene: ActivityScene | null;
  selectedBeat: SceneBeat | null;
  refetchActivity: () => Promise<unknown>;
  refetchDraft: () => Promise<unknown>;
}) {
  const handleAdopted = useCallback((nextDocument: ContentDocument, draftVersion: number) => {
    if (!activeStage || !activeScene || !selectedBeat) return;
    void draft.adoptBeatMedia(
      { document: nextDocument, draftVersion },
      { stageId: activeStage.id, sceneId: activeScene.id, beatId: selectedBeat.id },
    );
    void refetchActivity();
  }, [activeScene, activeStage, draft, refetchActivity, selectedBeat]);

  const handleCandidateApplied = useCallback(() => {
    void refetchActivity();
    void refetchDraft();
  }, [refetchActivity, refetchDraft]);

  return { handleAdopted, handleCandidateApplied };
}
