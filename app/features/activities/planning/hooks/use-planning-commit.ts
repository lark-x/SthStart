'use client';
import { useRef, useState, type RefObject } from 'react';
import type { ActivityPlanningOutput, ActivityPlanningSessionResponse, ActorSnapshot } from '@sthstart/contracts';
import { applyPlanningOutput } from '@sthstart/contracts';
import { createActivityFromPlanningSession } from '@/app/features/activities/api/planning';
import { useCreateActivity } from '@/app/features/activities/mutations/activities';
import { activityKeys } from '@/app/lib/query-keys';
import type { QueryClient } from '@tanstack/react-query';
import { buildBlankActors, buildBlankActivityDocument } from '../intake-model';
import { validateBlankActivity } from '../steps';
import type { ActivityPlanningCandidate } from '@sthstart/contracts';
import type { CustomCastMember, IntakeForm } from '../types';

interface RouterLike { push(url: string): void }

export function usePlanningCommit({
  intake,
  customCast,
  castSnapshotsRef,
  session,
  activePayload,
  selectedCandidate,
  selectedActorIds,
  setBusy,
  setError,
  setNotice,
  router,
  client,
}: {
  intake: IntakeForm;
  customCast: CustomCastMember[];
  castSnapshotsRef: RefObject<Map<string, ActorSnapshot>>;
  session: ActivityPlanningSessionResponse | null;
  activePayload: ActivityPlanningOutput | null;
  selectedCandidate: ActivityPlanningCandidate | null;
  selectedActorIds: Set<string>;
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  router: RouterLike;
  client: QueryClient;
}) {
  const createActivityMutation = useCreateActivity();
  const [creatingBlank, setCreatingBlank] = useState(false);
  const submittingRef = useRef(false);

  const createActivity = async () => {
    if (submittingRef.current || !session || !selectedCandidate || !activePayload) return;
    submittingRef.current = true;
    setBusy(true); setError(null);
    try {
      const selectedDocument = {
        ...session.session.document,
        actors: session.session.document.actors.filter((actor) => !actor.candidateRefId || selectedActorIds.has(actor.id)),
      };
      const finalDocument = applyPlanningOutput(selectedDocument, activePayload);
      const result = await createActivityFromPlanningSession(session.session.id, finalDocument, {
        candidateId: selectedCandidate.id,
        idempotencyKey: 'create_' + session.session.id,
      });
      void client.invalidateQueries({ queryKey: activityKeys.all });
      router.push('/apps/activities/' + result.activity.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建活动失败。');
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  /** 从空白开始：跳过检索与方案生成，直接用当前模板与参与者建立活动。 */
  const createBlankActivity = async () => {
    if (submittingRef.current) return;
    setError(null); setNotice(null);
    const actors = buildBlankActors({ intake, customCast, snapshots: castSnapshotsRef.current });
    const invalid = validateBlankActivity(actors.length);
    if (invalid) { setError(invalid); return; }
    submittingRef.current = true;
    setCreatingBlank(true);
    try {
      const { document } = buildBlankActivityDocument(intake, actors);
      const result = await createActivityMutation.mutateAsync({ document });
      router.push('/apps/activities/' + result.activity.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建活动失败。');
    } finally {
      submittingRef.current = false;
      setCreatingBlank(false);
    }
  };

  return { creatingBlank, createActivity, createBlankActivity };
}
