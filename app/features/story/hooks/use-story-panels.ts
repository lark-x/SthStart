'use client';

import { useCallback, useState } from 'react';
import type { ReviewTab } from '../model/story-entry';

/** Independent workspace panels. Opening one panel does not close another. */
export function useStoryPanels() {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState<ReviewTab>('proposals');
  const [projectToolsOpen, setProjectToolsOpen] = useState(false);
  const [agentConnectOpen, setAgentConnectOpen] = useState(false);
  const [workCastOpen, setWorkCastOpen] = useState(false);

  const openReview = useCallback((tab: ReviewTab) => { setReviewTab(tab); setReviewOpen(true); }, []);

  return {
    reviewOpen, setReviewOpen, reviewTab, setReviewTab, openReview,
    projectToolsOpen, setProjectToolsOpen,
    agentConnectOpen, setAgentConnectOpen,
    workCastOpen, setWorkCastOpen,
  };
}
