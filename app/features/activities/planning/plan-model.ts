import type {
  ActivityPlanningCandidate,
  ActivityPlanningJob,
  ActivityPlanningOutput,
  PlanningKnowledgeReference,
} from '@sthstart/contracts';

export interface PlanOverride {
  candidateId: string;
  payload: ActivityPlanningOutput;
}

export function activePlanPayload(
  plans: ActivityPlanningCandidate[],
  selectedPlanId: string | null,
  override: PlanOverride | null,
): ActivityPlanningOutput | null {
  const selected = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  if (!selected) return null;
  return override && override.candidateId === selected.id ? override.payload : selected.payload;
}

export function selectedActorIds(payload: ActivityPlanningOutput | null): Set<string> {
  return new Set([
    ...(payload?.actorRoles.map((role) => role.actorId) ?? []),
    ...(payload?.stages.flatMap((stage) => stage.actorIds) ?? []),
  ]);
}

export function basisFor(payload: ActivityPlanningOutput, references: PlanningKnowledgeReference[]) {
  const ids = new Set<string>([
    ...(payload.activity.referenceIds ?? []),
    ...payload.actorRoles.flatMap((role) => role.referenceIds ?? []),
    ...payload.stages.flatMap((stage) => stage.referenceIds ?? []),
  ]);
  return references.filter((item) => ids.has(item.id));
}

export function mergeGeneratedPlans({
  plans,
  generated,
  keepExisting,
}: {
  plans: ActivityPlanningCandidate[];
  generated: ActivityPlanningCandidate[];
  keepExisting: boolean;
}) {
  const merged = keepExisting ? [...generated, ...plans] : generated;
  return [...new Map(merged.map((plan) => [plan.id, plan])).values()];
}

export function isRunningJob(job: ActivityPlanningJob | null) {
  return job?.status === 'queued' || job?.status === 'running';
}
