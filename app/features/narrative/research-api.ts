import { deleteJson, getJson, patchJson, postJson } from '@/app/lib/api-client';
import {
  ResearchProjectsResponseSchema,
  ResearchProjectSchema,
  ResearchProjectDetailSchema,
  ResearchRunDetailSchema,
  ResearchPublishPreviewSchema,
  ResearchPublishResultSchema,
  ResearchProviderStatusSchema,
  ResearchTopicSuggestionResultSchema,
} from '@sthstart/contracts';
import type {
  ResearchProject,
  ResearchProjectDetail,
  ResearchRunDetail,
  ResearchPublishPreview,
  ResearchPublishResult,
  ResearchProviderStatus,
  ResearchScope,
  ResearchTopicSuggestionResult,
} from '@sthstart/contracts';

const base = 'narrative/research';

export async function fetchResearchProvider(): Promise<ResearchProviderStatus> {
  return getJson<ResearchProviderStatus>(`${base}/provider`, undefined, ResearchProviderStatusSchema);
}

export async function fetchResearchProjects(params: { workId?: string; status?: string } = {}): Promise<{ items: ResearchProject[] }> {
  const query = new URLSearchParams();
  if (params.workId) query.set('workId', params.workId);
  if (params.status) query.set('status', params.status);
  const suffix = query.toString();
  return getJson<{ items: ResearchProject[] }>(`${base}/projects${suffix ? `?${suffix}` : ''}`, undefined, ResearchProjectsResponseSchema);
}

export async function fetchResearchProject(id: string): Promise<ResearchProjectDetail> {
  return getJson<ResearchProjectDetail>(`${base}/projects/${id}`, undefined, ResearchProjectDetailSchema);
}

export async function createResearchProject(input: { workId: string; title: string; question?: string; scope?: ResearchScope; origin?: 'ai-suggested' | 'user-defined' }): Promise<ResearchProject> {
  return postJson<ResearchProject>(`${base}/projects`, input, undefined, ResearchProjectSchema);
}

export async function updateResearchProject(id: string, patch: { title?: string; question?: string; scope?: ResearchScope; status?: string; revision?: number }): Promise<ResearchProject> {
  return patchJson<ResearchProject>(`${base}/projects/${id}`, patch, undefined, ResearchProjectSchema);
}

export async function confirmResearchProject(id: string, patch: { title?: string; question?: string; scope?: ResearchScope; revision?: number } = {}): Promise<ResearchProject> {
  return postJson<ResearchProject>(`${base}/projects/${id}/confirm`, patch, undefined, ResearchProjectSchema);
}

export async function archiveResearchProject(id: string): Promise<ResearchProject> {
  return postJson<ResearchProject>(`${base}/projects/${id}/archive`, undefined, undefined, ResearchProjectSchema);
}

/** AI 选题：候选必须带真实种子证据，返回里如实给出扫描范围与丢弃原因。 */
export async function suggestResearchTopics(input: { workId: string; scope?: ResearchScope }): Promise<ResearchTopicSuggestionResult> {
  return postJson<ResearchTopicSuggestionResult>(`${base}/topic-suggestions`, input, undefined, ResearchTopicSuggestionResultSchema);
}

export async function selectTopicSuggestion(id: string, patch: { title?: string; question?: string; scope?: ResearchScope } = {}): Promise<ResearchProject> {
  return postJson<ResearchProject>(`${base}/topic-suggestions/${id}/select`, patch, undefined, ResearchProjectSchema);
}

export async function dismissTopicSuggestion(id: string): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>(`${base}/topic-suggestions/${id}/dismiss`);
}

export async function startResearchRun(projectId: string): Promise<ResearchRunDetail['run']> {
  return postJson<ResearchRunDetail['run']>(`${base}/projects/${projectId}/runs`);
}

export async function fetchResearchRun(runId: string): Promise<ResearchRunDetail> {
  return getJson<ResearchRunDetail>(`${base}/runs/${runId}`, undefined, ResearchRunDetailSchema);
}

export async function cancelResearchRun(runId: string): Promise<ResearchRunDetail['run']> {
  return postJson<ResearchRunDetail['run']>(`${base}/runs/${runId}/cancel`);
}

export async function retryResearchRun(runId: string): Promise<ResearchRunDetail['run']> {
  return postJson<ResearchRunDetail['run']>(`${base}/runs/${runId}/retry`);
}

export async function updateResearchClaim(id: string, patch: { status?: 'pending' | 'accepted' | 'rejected'; title?: string; body?: string; explanation?: string; uncertainty?: string; claimType?: string; revision?: number }): Promise<unknown> {
  return patchJson(`${base}/claims/${id}`, patch);
}

export async function revalidateResearchClaim(id: string): Promise<{ claimId: string; evidence: Array<{ id: string; valid: boolean; message: string | null }> }> {
  return postJson(`${base}/claims/${id}/revalidate`);
}

export async function addResearchEvidence(claimId: string, input: { targetType: string; targetId: string }): Promise<unknown> {
  return postJson(`${base}/claims/${claimId}/evidence`, input);
}

export async function deleteResearchEvidence(id: string): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`${base}/evidence/${id}`);
}

export async function updateResearchDraft(id: string, patch: { title?: string; summary?: string; content?: Record<string, unknown> }): Promise<unknown> {
  return patchJson(`${base}/drafts/${id}`, patch);
}

/** 只用已接受的结论与有效证据重写总稿，不重跑检索。 */
export async function regenerateResearchDraft(projectId: string): Promise<{ ok: boolean; draftId?: string; reason?: string }> {
  return postJson<{ ok: boolean; draftId?: string; reason?: string }>(`${base}/projects/${projectId}/regenerate-draft`);
}

export async function previewResearchPublish(projectId: string): Promise<ResearchPublishPreview> {
  return postJson<ResearchPublishPreview>(`${base}/projects/${projectId}/publish-preview`, undefined, undefined, ResearchPublishPreviewSchema);
}

export async function publishResearch(projectId: string, input: { revision?: number } = {}): Promise<ResearchPublishResult> {
  return postJson<ResearchPublishResult>(`${base}/projects/${projectId}/publish`, input, undefined, ResearchPublishResultSchema);
}
