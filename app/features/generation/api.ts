import { getJson, postJson, putJson } from '@/app/lib/api-client';
import type { Assignment, Engine, MediaDiagnostics, Worker, Workflow } from './types';

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

export async function createWorkflowConfig(input: { id: string; name: string; description: string; engineKind: 'comfyui'; category: 'image' | 'video' | 'audio' | 'transform' }) {
  await postJson(`${GENERATION_BASE_PATH}/workflows`, input);
}

export async function publishWorkflowVersion(workflowId: string, body: unknown) {
  await postJson(`${GENERATION_BASE_PATH}/workflows/${encodeURIComponent(workflowId)}/versions`, body);
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
