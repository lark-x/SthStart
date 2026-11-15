import type { IntakeForm } from './types';

export function stepsDone({
  index,
  sessionId,
  planCount,
  selectedPlanId,
}: {
  index: number;
  sessionId: string | null;
  planCount: number;
  selectedPlanId: string | null;
}) {
  return index === 0 ? Boolean(sessionId) : index === 1 ? planCount > 0 : index === 2 ? Boolean(selectedPlanId) : false;
}

export function validateStartResearch(intake: IntakeForm): string | null {
  if (!intake.cast.length) return '请先选择至少一位参与角色。';
  if (!intake.sourceIds.length) return '请至少选择一个资料源，或改用「跳过检索，直接构思」。';
  return null;
}

export function validateGeneratePlans(intake: IntakeForm): string | null {
  return intake.cast.length ? null : '请至少选择一位参与角色。';
}

export function validateBlankActivity(actorCount: number): string | null {
  return actorCount ? null : '请先选择至少一位参与角色，或添加自定义参与者。';
}

export function canSubmitActivity(selectedCandidate: unknown, pendingActorCount: number) {
  return Boolean(selectedCandidate) && pendingActorCount === 0;
}

export function allStepsComplete(state: Parameters<typeof stepsDone>[0]) {
  return [0, 1, 2].every((index) => stepsDone({ ...state, index }));
}
