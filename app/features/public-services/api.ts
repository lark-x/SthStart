import { getJson, postJson, putJson, deleteJson } from '@/app/lib/api-client';
import {
  AppLlmAssignmentSchema,
  AppLlmStatusResponseSchema,
  CreatedAppSchema,
  ModelDiscoveryResponseSchema,
  ModelRouteListSchema,
  ModelRouteSchema,
  PublicServiceOverviewSchema,
  SavedProfileResponseSchema,
} from '@sthstart/contracts';
import type {
  AppLlmAssignment,
  AppLlmStatusResponse,
  CreatedApp,
  LlmModelCapability,
  ProviderProfile,
  PublicServiceOverview,
  SavedProfileResponse,
  ServiceConnection,
  ServiceConnectionKind,
  ConnectionTestResult,
  DiscoveredModelList,
  ModelProfile,
  ModelRoute,
  ModelInferenceTestResult,
  PurposeBinding,
  SaveModelProfile,
} from '@sthstart/contracts';

export type LlmDraft = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  secret: string;
  thinkingMode: ProviderProfile['thinkingMode'];
  headers: string;
  extraBody: string;
  capabilities: LlmModelCapability[];
  enabled: boolean;
};

export const EMPTY_LLM: LlmDraft = {
  id: '',
  name: '',
  baseUrl: '',
  model: '',
  secret: '',
  thinkingMode: 'omit',
  headers: '{}',
  extraBody: '{}',
  capabilities: ['text'],
  enabled: true,
};

export async function fetchPublicOverview(): Promise<PublicServiceOverview> {
  return getJson<PublicServiceOverview>('overview', undefined, PublicServiceOverviewSchema);
}

export async function createProviderProfile(payload: unknown): Promise<SavedProfileResponse> {
  return postJson<SavedProfileResponse>('profiles', payload, undefined, SavedProfileResponseSchema);
}

export async function cloneProviderProfile(
  sourceId: string,
  payload: unknown
): Promise<SavedProfileResponse> {
  return postJson<SavedProfileResponse>(`profiles/${sourceId}/clone`, payload, undefined, SavedProfileResponseSchema);
}

export async function deleteProviderProfile(id: string): Promise<Record<string, unknown>> {
  return deleteJson(`profiles/${id}`);
}

export async function discoverModels(payload: {
  profileId?: string;
  baseUrl: string;
  secret?: string;
  headers?: Record<string, string>;
}): Promise<{ models: string[] }> {
  return postJson<{ models: string[] }>('llm/models/discover', payload, undefined, ModelDiscoveryResponseSchema);
}

export async function createAppToken(payload: {
  id: string;
  name: string;
  capabilities?: string[];
}): Promise<CreatedApp> {
  return postJson<CreatedApp>('apps', payload, undefined, CreatedAppSchema);
}

export async function updateLlmAssignments(
  appId: string,
  payload: { textProfileId: string | null; multimodalProfileId: string | null }
): Promise<AppLlmAssignment> {
  return putJson<AppLlmAssignment>(
    `apps/${appId}/llm-assignments`,
    payload,
    undefined,
    AppLlmAssignmentSchema
  );
}

export async function fetchAppLlmStatus(appId: string): Promise<AppLlmStatusResponse> {
  return getJson<AppLlmStatusResponse>(`apps/${appId}/llm-status`, undefined, AppLlmStatusResponseSchema);
}

// ── 服务连接 (Service Connections) ──

export async function fetchConnections(): Promise<ServiceConnection[]> {
  const res = await getJson<{ items: ServiceConnection[] }>('connections');
  return res.items;
}

export async function saveConnection(payload: {
  id?: string;
  name: string;
  kind: ServiceConnectionKind;
  baseUrl: string;
  secret?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
  enabled?: boolean;
}): Promise<{ id: string; secretStored: boolean; warning: string | null }> {
  return postJson<{ id: string; secretStored: boolean; warning: string | null }>('connections', payload);
}

export async function deleteConnection(id: string): Promise<void> {
  await deleteJson(`connections/${encodeURIComponent(id)}`);
}

export async function testConnectionProbe(payload: {
  connectionId?: string;
  baseUrl?: string;
  secret?: string;
  kind?: ServiceConnectionKind;
  headers?: Record<string, string>;
}): Promise<ConnectionTestResult> {
  return postJson<ConnectionTestResult>('connections/test', payload);
}

export async function discoverConnectionModels(payload: {
  connectionId?: string;
  baseUrl?: string;
  secret?: string;
  headers?: Record<string, string>;
}): Promise<DiscoveredModelList> {
  return postJson<DiscoveredModelList>('connections/discover-models', payload);
}

// ── 模型配置 (Model Profiles) ──

export async function fetchModelProfiles(): Promise<ModelProfile[]> {
  const res = await getJson<{ items: ModelProfile[] }>('models');
  return res.items;
}

export async function saveModelProfile(payload: SaveModelProfile): Promise<ModelProfile> {
  return postJson<ModelProfile>('models', payload);
}

export async function fetchModelRoutes(): Promise<ModelRoute[]> {
  const res = await getJson<{ items: ModelRoute[] }>('model-routes', undefined, ModelRouteListSchema);
  return res.items;
}

export async function saveModelRoute(payload: import('@sthstart/contracts').SaveModelRoute): Promise<ModelRoute> {
  return putJson<ModelRoute>('model-routes', payload, undefined, ModelRouteSchema);
}

export async function deleteAppModelRoute(appId: string, capability: 'text' | 'multimodal'): Promise<{ ok: boolean; inherited: boolean }> {
  return deleteJson(`model-routes/apps/${encodeURIComponent(appId)}/${capability}`);
}

export async function applyPublicModelRoute(capability: 'text' | 'multimodal'): Promise<{ ok: boolean; removed: number }> {
  return postJson(`model-routes/apply-public`, { capability });
}

export async function deleteModelProfile(id: string): Promise<void> {
  await deleteJson(`models/${encodeURIComponent(id)}`);
}

export async function testModelInference(
  id: string,
  prompt?: string,
  type: 'text' | 'json' | 'vision' = 'text',
): Promise<ModelInferenceTestResult> {
  return postJson<ModelInferenceTestResult>(`models/${encodeURIComponent(id)}/test`, { prompt, type });
}

// ── 用途绑定 (Purpose Bindings) ──

export async function fetchPurposeBindings(): Promise<PurposeBinding[]> {
  const res = await getJson<{ items: PurposeBinding[] }>('purposes');
  return res.items;
}

export async function savePurposeBinding(appId: string, purpose: string, payload: {
  targetType: 'model' | 'preset';
  targetId: string;
  inheritAppDefault?: boolean;
}): Promise<PurposeBinding> {
  return putJson<PurposeBinding>(`purposes/${encodeURIComponent(appId)}/${encodeURIComponent(purpose)}`, payload);
}

export async function deletePurposeBinding(appId: string, purpose: string): Promise<void> {
  await deleteJson(`purposes/${encodeURIComponent(appId)}/${encodeURIComponent(purpose)}`);
}


export function createImageModelWorkflow(id: string, operation: 'text-to-image' | 'image-to-image') {
  return postJson<{workflowId: string; engineId: string}>(`models/${encodeURIComponent(id)}/image-workflow`, {operation});
}
