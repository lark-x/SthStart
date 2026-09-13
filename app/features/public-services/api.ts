import { getJson, postJson, putJson, deleteJson } from '@/app/lib/api-client';
import {
  AppLlmAssignmentSchema,
  AppLlmStatusResponseSchema,
  CreatedAppSchema,
  ModelDiscoveryResponseSchema,
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
