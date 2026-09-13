import { ApiClientError, getJson, postJson, putJson, deleteJson } from '@/app/lib/api-client';
import type {
  GenerationConnectionTestResult,
  GenerationModelListResponse,
  GenerationNodeListResponse,
  GenerationPreset,
  GenerationPresetListResponse,
  GenerationTestRunDetail,
  GenerationTestRunSummary,
  WorkflowAnalyzeResponse,
} from '@sthstart/contracts';
import type { Assignment, Engine, MediaDiagnostics, Workflow, WorkflowDraft, Worker } from './types';

const GENERATION_BASE_PATH = 'generation';
const WORKERS_PATH = 'workers';
const MEDIA_DIAGNOSTICS_PATH = 'media/diagnostics';
const CREATIVE_ASSIGNMENTS_PATH = 'apps/creative-center/generation-assignments';

export async function fetchGenerationEngines() {
  const response = await getJson<{ items: Engine[] }>(`${GENERATION_BASE_PATH}/engines`);
  return response.items;
}

export async function fetchGenerationWorkers() {
  const response = await getJson<{ items: Worker[] }>(WORKERS_PATH);
  return response.items;
}

export async function fetchGenerationWorkflows() {
  const response = await getJson<{ items: Workflow[] }>(`${GENERATION_BASE_PATH}/workflows`);
  return response.items;
}

export async function fetchGenerationAssignments() {
  const response = await getJson<{ items: Assignment[] }>(`${GENERATION_BASE_PATH}/assignments`);
  return response.items;
}

export async function fetchMediaDiagnostics() {
  return getJson<MediaDiagnostics>(MEDIA_DIAGNOSTICS_PATH);
}

export async function saveGenerationEngine(input: { id: string; name: string; baseUrl: string; secret?: string; concurrencyLimit: number }) {
  await postJson(`${GENERATION_BASE_PATH}/engines`, input);
}

export async function saveWorkerConfig(input: { id: string; name: string; baseUrl: string; token?: string; model: string; temperature: number; ipAllowlist: string[]; diskWarningBytes: number; diskStopBytes: number }) {
  return postJson<{ workerId: string; token?: string }>(WORKERS_PATH, input);
}

export async function createWorkflowConfig(input: { id?: string; name: string; description?: string; engineKind?: 'comfyui' | 'worker' | 'cloud'; category?: 'image' | 'video' | 'audio' | 'transform' }) {
  return postJson<{ id: string }>(`${GENERATION_BASE_PATH}/workflows`, input);
}

export async function publishWorkflowVersion(workflowId: string, body: unknown) {
  return postJson<{ workflowId: string; version: number; configFormatVersion?: number }>(
    `${GENERATION_BASE_PATH}/workflows/${encodeURIComponent(workflowId)}/versions`, body,
  );
}

export async function importWorkflowBundle(payload: unknown) {
  return postJson<{ ok: boolean; id: string; workflowId: string; version: number }>(
    `${GENERATION_BASE_PATH}/workflows/import`,
    payload
  );
}

export async function saveCreativeCenterAssignments(assignments: unknown[]) {
  await putJson(CREATIVE_ASSIGNMENTS_PATH, { assignments });
}

// ── 配置工作台（规划 §12） ──

export async function testGenerationEngine(engineId: string) {
  return postJson<GenerationConnectionTestResult>(`${GENERATION_BASE_PATH}/engines/${encodeURIComponent(engineId)}/test`);
}

export async function fetchEngineModels(engineId: string, query: { type?: string; search?: string; refresh?: boolean } = {}) {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.search) params.set('search', query.search);
  if (query.refresh) params.set('refresh', '1');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return getJson<GenerationModelListResponse>(`${GENERATION_BASE_PATH}/engines/${encodeURIComponent(engineId)}/models${suffix}`);
}

export async function fetchEngineNodes(engineId: string, classTypes: string[]) {
  return getJson<GenerationNodeListResponse>(
    `${GENERATION_BASE_PATH}/engines/${encodeURIComponent(engineId)}/nodes?classTypes=${encodeURIComponent(classTypes.join(','))}`,
  );
}

export async function analyzeWorkflowInput(input: { definition?: unknown; bundle?: unknown; connectionId?: string }) {
  return postJson<WorkflowAnalyzeResponse>(`${GENERATION_BASE_PATH}/workflows/analyze`, input);
}

export async function fetchWorkflowDraft(workflowId: string) {
  return getJson<WorkflowDraft>(`${GENERATION_BASE_PATH}/workflows/${encodeURIComponent(workflowId)}/draft`);
}

export async function saveWorkflowDraft(workflowId: string, revision: number, draft: unknown) {
  try {
    return await putJson<WorkflowDraft>(
      `${GENERATION_BASE_PATH}/workflows/${encodeURIComponent(workflowId)}/draft`,
      { revision, draft },
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'draft_revision_conflict') {
      return { error: 'draft_revision_conflict', message: error.message, draft: await fetchWorkflowDraft(workflowId) };
    }
    throw error;
  }
}

export async function duplicateWorkflow(workflowId: string, input: { id?: string; name?: string } = {}) {
  return postJson<{ id: string; name: string; latestVersion: number }>(
    `${GENERATION_BASE_PATH}/workflows/${encodeURIComponent(workflowId)}/duplicate`, input,
  );
}

export async function fetchWorkflowExportUrl(workflowId: string, version: number) {
  return `/api/admin/${GENERATION_BASE_PATH}/workflows/${encodeURIComponent(workflowId)}/versions/${version}/export`;
}

export async function createTestRun(workflowId: string, input: { version?: number; values?: Record<string, unknown>; inputArtifacts?: Array<{ artifactId: string; inputKey: string }>; seed?: number | null; idempotencyKey?: string }) {
  return postJson<GenerationTestRunDetail>(
    `${GENERATION_BASE_PATH}/workflows/${encodeURIComponent(workflowId)}/test-runs`, input,
  );
}

export async function fetchTestRuns(workflowId?: string) {
  const suffix = workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : '';
  return getJson<{ items: GenerationTestRunSummary[] }>(`${GENERATION_BASE_PATH}/test-runs${suffix}`);
}

export async function fetchTestRunDetail(taskId: string) {
  return getJson<GenerationTestRunDetail>(`${GENERATION_BASE_PATH}/test-runs/${encodeURIComponent(taskId)}`);
}

export async function fetchGenerationPresets(filter: { appId?: string; purpose?: string; workflowId?: string } = {}) {
  const params = new URLSearchParams();
  if (filter.appId) params.set('appId', filter.appId);
  if (filter.purpose) params.set('purpose', filter.purpose);
  if (filter.workflowId) params.set('workflowId', filter.workflowId);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return getJson<GenerationPresetListResponse>(`${GENERATION_BASE_PATH}/presets${suffix}`);
}

export async function createGenerationPreset(input: {
  appId: string; purpose: string; name: string; description?: string;
  workflowId: string; workflowVersion?: number; engineId?: string | null;
  values?: Record<string, unknown>; enabled?: boolean;
}) {
  return postJson<GenerationPreset>(`${GENERATION_BASE_PATH}/presets`, input);
}

export async function updateGenerationPreset(id: string, input: {
  name?: string; description?: string; values?: Record<string, unknown>; enabled?: boolean;
  workflowId?: string; workflowVersion?: number; engineId?: string | null;
  revision: number; clearDefault?: boolean;
}) {
  return putJson<GenerationPreset>(`${GENERATION_BASE_PATH}/presets/${encodeURIComponent(id)}`, input);
}

export async function deleteGenerationPreset(id: string) {
  return deleteJson<{ ok: boolean }>(`${GENERATION_BASE_PATH}/presets/${encodeURIComponent(id)}`);
}

export async function setDefaultGenerationPreset(id: string) {
  return postJson<GenerationPreset>(`${GENERATION_BASE_PATH}/presets/${encodeURIComponent(id)}/set-default`);
}

export async function copyGenerationPreset(id: string, input: { name?: string; appId?: string; purpose?: string; workflowVersion?: number } = {}) {
  return postJson<GenerationPreset>(`${GENERATION_BASE_PATH}/presets/${encodeURIComponent(id)}/copy`, input);
}
