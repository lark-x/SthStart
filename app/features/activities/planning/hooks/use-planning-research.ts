'use client';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import type { ActivityPlanningSessionResponse, PlanningSelectionState, ResearchCharacterCandidate, ResearchTask } from '@sthstart/contracts';
import { cancelPlanningResearch, fetchPlanningResearch, fetchPlanningSession, startPlanningResearch } from '@/app/features/activities/api/planning';
import { pollPlanning } from '../polling';
import { isTerminalResearch, normalizedCandidateStatus } from '../research-model';
import { validateStartResearch } from '../steps';
import type { CandidateStatus, CustomLocation, IntakeForm } from '../types';

export function usePlanningResearch({
  intake,
  session,
  syncSession,
  applySession,
  setStep,
  setBusy,
  setError,
  setNotice,
  mountedRef,
}: {
  intake: IntakeForm;
  session: ActivityPlanningSessionResponse | null;
  syncSession: (selection: PlanningSelectionState | null, researchRevisionId: string | null, sessionIdOverride?: string) => Promise<ActivityPlanningSessionResponse>;
  applySession: (next: ActivityPlanningSessionResponse | null) => void;
  setStep: (step: 0 | 1 | 2 | 3) => void;
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  mountedRef: React.MutableRefObject<boolean>;
}) {
  const [research, setResearch] = useState<ResearchTask | null>(null);
  const [researching, setResearching] = useState(false);
  const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);
  const [customForm, setCustomForm] = useState({ name: '', note: '' });

  const pollResearch = useCallback(async (id: string, taskId: string) => pollPlanning({
    read: () => fetchPlanningResearch(id, taskId),
    onValue: setResearch,
    done: (task) => isTerminalResearch(task.status),
    isMounted: () => mountedRef.current,
  }), [mountedRef]);

  const startResearch = async () => {
    setError(null); setNotice(null);
    const invalid = validateStartResearch(intake);
    if (invalid) { setError(invalid); return; }
    setResearching(true);
    try {
      const current = await syncSession(session?.session.form.selection ?? null, session?.session.researchRevisionId ?? null);
      const task = await startPlanningResearch(current.session.id, {
        sourceIds: intake.sourceIds,
        userRequest: intake.instruction,
        crossoverWorks: intake.crossoverWorks,
        storyScopeNote: intake.storyScopeNote,
      });
      setResearch(task);
      const finished = await pollResearch(current.session.id, task.id);
      const refreshed = await fetchPlanningSession(current.session.id);
      applySession(refreshed);
      if (finished?.status === 'succeeded' || finished?.status === 'incomplete') setStep(1);
      else if (finished?.status === 'cancelled') setNotice('已取消本次资料检索，可以跳过检索直接构思。');
      else if (finished?.status === 'failed') setError(finished.errorMessage || '资料检索失败，可以跳过检索直接构思。');
      else setNotice('资料检索仍在后台运行，稍后可在「人物与地点」查看结果。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '资料检索失败。');
    } finally {
      setResearching(false);
    }
  };

  const skipResearch = async () => {
    setError(null); setNotice(null);
    if (!intake.cast.length) { setError('请先选择至少一位参与角色。'); return; }
    setBusy(true);
    try {
      await syncSession(null, null);
      setResearch(null);
      setCustomLocations([]);
      setStep(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '建立企划会话失败。');
    } finally {
      setBusy(false);
    }
  };

  const cancelResearch = async () => {
    if (!session?.session.id || !research) return;
    setBusy(true);
    try {
      const task = await cancelPlanningResearch(session.session.id, research.id);
      setResearch(task);
      setNotice('已取消本次资料检索。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '取消失败。');
    } finally {
      setBusy(false);
    }
  };

  const setCandidateStatus = (candidateId: string, status: CandidateStatus) => {
    setResearch((current) => current ? {
      ...current,
      characterCandidates: current.characterCandidates.map((candidate) => candidate.id === candidateId ? { ...candidate, userStatus: status } : candidate),
    } : current);
  };

  const setLocationStatus = (candidateId: string, status: CandidateStatus) => {
    setResearch((current) => current ? {
      ...current,
      locationCandidates: current.locationCandidates.map((candidate) => candidate.id === candidateId ? { ...candidate, userStatus: status } : candidate),
    } : current);
  };

  const lockLocation = (candidateId: string) => {
    if (customLocations.some((location) => location.id === candidateId)) {
      setCustomLocations((current) => current.map((location) => ({ ...location, locked: location.id === candidateId ? !location.locked : false })));
      return;
    }
    setResearch((current) => current ? {
      ...current,
      locationCandidates: current.locationCandidates.map((candidate) => ({ ...candidate, locked: candidate.id === candidateId ? !candidate.locked : false })),
    } : current);
  };

  const lockedLocationName = useMemo(() => {
    const id = research?.locationCandidates.find((candidate) => candidate.locked)?.id ?? customLocations.find((location) => location.locked)?.id ?? null;
    if (!id) return null;
    return research?.locationCandidates.find((candidate) => candidate.id === id)?.name ?? customLocations.find((location) => location.id === id)?.name ?? null;
  }, [research, customLocations]);

  const candidateStatus = (candidate: Pick<ResearchCharacterCandidate, 'userStatus'>) => normalizedCandidateStatus(candidate.userStatus);

  return {
    research,
    setResearch,
    researching,
    setResearching,
    customLocations,
    setCustomLocations,
    customForm,
    setCustomForm,
    pollResearch,
    startResearch,
    skipResearch,
    cancelResearch,
    setCandidateStatus,
    setLocationStatus,
    lockLocation,
    lockedLocationName,
    candidateStatus,
  };
}
