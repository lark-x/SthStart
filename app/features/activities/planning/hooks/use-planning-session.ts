'use client';
import { useCallback, useRef, useState } from 'react';
import type { ActivityPlanningSessionResponse, PlanningSelectionState } from '@sthstart/contracts';
import { createPlanningSession, fetchPlanningSession, updatePlanningSession } from '@/app/features/activities/api/planning';
import { buildPlanningFormPayload, templateActorMappingsFor, type PlanningTemplatePreset } from '../intake-model';
import type { IntakeForm, ReferenceDraft } from '../types';

interface ParamsLike {
  get(name: string): string | null;
  toString(): string;
}

interface RouterLike {
  replace(url: string): void;
}

export function usePlanningSession({
  params,
  router,
  intake,
  references,
  userTemplate,
}: {
  params: ParamsLike;
  router: RouterLike;
  intake: IntakeForm;
  references: ReferenceDraft[];
  userTemplate?: PlanningTemplatePreset;
}) {
  const [session, setSession] = useState<ActivityPlanningSessionResponse | null>(null);
  /** state 更新是异步的，同一串 await 里必须读这个引用里的最新版本，避免乐观锁 409。 */
  const sessionRef = useRef<ActivityPlanningSessionResponse | null>(null);
  /** 已经恢复过（或由本页创建）的会话 id：避免创建会话后又被当成“恢复现场”。 */
  const resumeRef = useRef(false);

  const rememberSession = useCallback((id: string) => {
    resumeRef.current = true;
    const next = new URLSearchParams(params.toString());
    next.set('session', id);
    next.delete('characters');
    router.replace('/apps/activities/new?' + next.toString());
  }, [params, router]);

  const applySession = useCallback((next: ActivityPlanningSessionResponse | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const formPayload = useCallback((selection: PlanningSelectionState | null, researchRevisionId: string | null) => (
    buildPlanningFormPayload({
      intake,
      references,
      templateActorMappings: templateActorMappingsFor(intake, userTemplate),
      inspiration: session?.session.form.inspiration,
      selection,
      researchRevisionId,
    })
  ), [intake, references, session, userTemplate]);

  /** 表单变化即同步会话：研究输入与生成依据都以服务端会话为准。 */
  const syncSession = useCallback(async (
    selection: PlanningSelectionState | null,
    researchRevisionId: string | null,
    sessionIdOverride?: string,
  ) => {
    const payload = formPayload(selection, researchRevisionId);
    const targetId = sessionIdOverride ?? sessionRef.current?.session.id;
    if (!targetId) {
      const created = await createPlanningSession(payload);
      applySession(created);
      rememberSession(created.session.id);
      return created;
    }
    const updated = await updatePlanningSession(targetId, payload, sessionRef.current?.session.version ?? 1);
    applySession(updated);
    return updated;
  }, [applySession, formPayload, rememberSession]);

  const refreshSession = useCallback(async () => {
    if (!sessionRef.current) return null;
    const fresh = await fetchPlanningSession(sessionRef.current.session.id);
    applySession(fresh);
    return fresh;
  }, [applySession]);

  return {
    session,
    sessionId: session?.session.id ?? null,
    resumeRef,
    applySession,
    syncSession,
    refreshSession,
  };
}
