import { getJson, postJson, putJson, deleteJson } from '@/app/lib/api-client';
import type {
  Activity,
  ContentDocument,
  ActivityPlanningForm,
  ActivityPlanningFormExtended,
  ActivityPlanningSessionResponse,
  ActivityPlanningJob,
  ActivityPlanningCandidate,
  ActivityPlanningActorResolveInput,
  ActivityPlanningActorResolveResult,
  ActivityPlanningPersonaDraft,
  ResearchTask,
  PlanningSelectionState,
} from '@sthstart/contracts';

// 创建前企划：会话与生成任务独立于正式活动。
export async function createPlanningSession(form: ActivityPlanningForm | ActivityPlanningFormExtended): Promise<ActivityPlanningSessionResponse> {
  return postJson('/api/admin/activity-planning-sessions', { form });
}

export async function fetchPlanningSession(id: string): Promise<ActivityPlanningSessionResponse> {
  return getJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}`);
}

export async function updatePlanningSession(id: string, form: ActivityPlanningForm | ActivityPlanningFormExtended, expectedVersion: number): Promise<ActivityPlanningSessionResponse> {
  return putJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}`, { form, expectedVersion });
}

export async function discardPlanningSession(id: string): Promise<{ ok: boolean }> {
  return deleteJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}`);
}

export async function triggerPlanningJob(id: string, input: { instruction?: string; idempotencyKey?: string; planCount?: number } = {}): Promise<ActivityPlanningJob> {
  return postJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/jobs`, input);
}

export async function fetchPlanningJob(id: string, jobId: string): Promise<{ job: ActivityPlanningJob; candidates: ActivityPlanningCandidate[] }> {
  return getJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelPlanningJob(id: string, jobId: string): Promise<ActivityPlanningJob> {
  return postJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}/cancel`, {});
}

export async function retryPlanningJob(id: string, jobId: string): Promise<ActivityPlanningJob> {
  return postJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}/retry`, {});
}

export async function createActivityFromPlanningSession(id: string, document: ContentDocument, options: { candidateId?: string; idempotencyKey?: string } = {}): Promise<{ activity: Activity; created: boolean }> {
  return postJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/create-activity`, {
    document,
    ...(options.candidateId ? { candidateId: options.candidateId } : {}),
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  });
}

// 待处理人设：匹配已有角色、写入确认后的人设、或从企划中移除。
export async function resolvePlanningActor(
  id: string,
  actorId: string,
  input: ActivityPlanningActorResolveInput,
): Promise<ActivityPlanningActorResolveResult> {
  return postJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/actors/${encodeURIComponent(actorId)}/resolve`, input);
}

export async function fetchPlanningPersonaDraft(id: string, actorId: string): Promise<ActivityPlanningPersonaDraft> {
  return postJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/actors/${encodeURIComponent(actorId)}/persona-draft`, {});
}

// 企划研究：资料检索、候选确认。
export async function startPlanningResearch(id: string, payload: Record<string, unknown>): Promise<ResearchTask> {
  return postJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/research`, payload);
}

export async function fetchPlanningResearch(id: string, taskId: string): Promise<ResearchTask> {
  return getJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/research/${encodeURIComponent(taskId)}`);
}

/** 会话下的研究任务列表（最近在前），用于刷新后恢复候选与选择。 */
export async function fetchPlanningResearchTasks(id: string): Promise<ResearchTask[]> {
  const data = await getJson<{ items: ResearchTask[] }>(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/research`);
  return data.items;
}

export async function cancelPlanningResearch(id: string, taskId: string): Promise<ResearchTask> {
  return postJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/research/${encodeURIComponent(taskId)}/cancel`, {});
}

export async function savePlanningResearchSelection(
  id: string,
  taskId: string,
  payload: {
    characters?: Array<{ id: string; status: 'required' | 'optional' | 'excluded' }>;
    locations?: Array<{ id: string; status: 'required' | 'optional' | 'excluded'; locked?: boolean }>;
    /** 用户自填地点：id 由前端生成（user_loc_ 前缀），重复提交不会重复写入。 */
    addLocations?: Array<{ id: string; name: string; note?: string; status?: 'required' | 'optional' | 'excluded'; locked?: boolean }>;
  }
): Promise<{ task: ResearchTask; selection: PlanningSelectionState }> {
  return putJson(`/api/admin/activity-planning-sessions/${encodeURIComponent(id)}/research/${encodeURIComponent(taskId)}/selection`, payload);
}
