'use client';

import { useCallback, useState } from 'react';
import type { StudioSettingsTab } from '../model/studio-view';

export function useStudioOverlays({ prepareContent }: { prepareContent: () => Promise<boolean> }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<StudioSettingsTab>('basics');
  const [settingsFocusId, setSettingsFocusId] = useState<string | null>(null);
  const [playbackOpen, setPlaybackOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [candidateJobId, setCandidateJobId] = useState<string | null>(null);
  const [artOpen, setArtOpen] = useState(false);

  const openPlayback = useCallback(() => {
    setExportOpen(false);
    setPlaybackOpen(true);
    void prepareContent();
  }, [prepareContent]);
  const openExport = useCallback(() => {
    setPlaybackOpen(false);
    setExportOpen(true);
    void prepareContent();
  }, [prepareContent]);

  return {
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    settingsFocusId,
    setSettingsFocusId,
    playbackOpen,
    setPlaybackOpen,
    exportOpen,
    setExportOpen,
    reworkOpen,
    setReworkOpen,
    candidateJobId,
    setCandidateJobId,
    artOpen,
    setArtOpen,
    openPlayback,
    openExport,
  };
}
