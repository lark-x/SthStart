import type { ResearchEvidence, ResearchTask } from '@sthstart/contracts';
import type { CandidateStatus, CustomLocation } from './types';

export const TERMINAL_RESEARCH: ResearchTask['status'][] = ['succeeded', 'failed', 'cancelled', 'incomplete'];

export function statusLabel(status: CandidateStatus) {
  return status === 'required' ? '必选' : status === 'excluded' ? '排除' : '可选';
}

export function isTerminalResearch(status: ResearchTask['status']) {
  return TERMINAL_RESEARCH.includes(status);
}

export function normalizedCandidateStatus(status: string): CandidateStatus {
  return (status === 'pending' ? 'optional' : status) as CandidateStatus;
}

export function evidenceFor(research: ResearchTask | null, ids: string[]): ResearchEvidence[] {
  return (research?.evidence ?? []).filter((item) => ids.includes(item.id));
}

/** 状态改动只在生成时写库，避免每次点击都产生请求。 */
export function buildResearchSelectionPayload(task: ResearchTask, customLocations: CustomLocation[]) {
  const unsaved = customLocations.filter((location) => !task.locationCandidates.some((candidate) => candidate.id === location.id));
  return {
    characters: task.characterCandidates.map((candidate) => ({
      id: candidate.id,
      status: normalizedCandidateStatus(candidate.userStatus),
    })),
    locations: [
      ...task.locationCandidates.map((candidate) => ({
        id: candidate.id,
        status: normalizedCandidateStatus(candidate.userStatus),
        locked: Boolean(candidate.locked),
      })),
      ...unsaved.map((location) => ({ id: location.id, status: location.status, locked: location.locked })),
    ],
    addLocations: unsaved.map((location) => ({ id: location.id, name: location.name, note: location.note, status: location.status, locked: location.locked })),
  };
}
