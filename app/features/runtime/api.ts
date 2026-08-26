import { getJson, postJson, putJson } from '@/app/lib/api-client';
import { LogListResponseSchema, LogPolicySchema, RuntimeOverviewSchema, RuntimeSettingsSchema } from '@sthstart/contracts';
import type {
  LogEvent,
  LogPolicy,
  RuntimeOverview,
  RuntimeSettings,
} from '@sthstart/contracts';

export type Tab = 'overview' | 'runtime' | 'creative' | 'models' | 'logs';

export type ImportPreview = {
  launcher: {
    available: boolean;
    path: string | null;
    settings: Partial<RuntimeSettings> | null;
  };
  business: Record<string, unknown> | null;
  businessError: string | null;
};

export async function fetchRuntimeOverview(): Promise<RuntimeOverview> {
  return getJson<RuntimeOverview>('runtime/overview', undefined, RuntimeOverviewSchema);
}

export async function startRuntimeService(id: string): Promise<Record<string, unknown>> {
  return postJson(`runtime/services/${id}/start`);
}

export async function stopRuntimeService(id: string): Promise<Record<string, unknown>> {
  return postJson(`runtime/services/${id}/stop`);
}

export async function restartRuntimeService(id: string): Promise<Record<string, unknown>> {
  return postJson(`runtime/services/${id}/restart`);
}

export async function updateRuntimeSettings(settings: Partial<RuntimeSettings>): Promise<RuntimeSettings> {
  return putJson<RuntimeSettings>('runtime/settings', settings, undefined, RuntimeSettingsSchema);
}

export async function updateCreativeSettings(creative: Record<string, unknown>): Promise<Record<string, unknown>> {
  return putJson('runtime/creative', creative, undefined, RuntimeSettingsSchema);
}

export async function updateLogPolicy(policy: Partial<LogPolicy>): Promise<LogPolicy> {
  return putJson<LogPolicy>('runtime/logs/policy', policy, undefined, LogPolicySchema);
}

export async function fetchLogs(limit = 500): Promise<{ items: LogEvent[] }> {
  return getJson<{ items: LogEvent[] }>(`logs?limit=${limit}`, undefined, LogListResponseSchema);
}

export async function previewLauncherImport(): Promise<ImportPreview> {
  return getJson<ImportPreview>('runtime/import/launcher/preview');
}

export async function commitLauncherImport(): Promise<Record<string, unknown>> {
  return postJson('runtime/import/launcher/commit');
}

export async function syncPublicLlmModel(): Promise<Record<string, unknown>> {
  return postJson('runtime/creative/sync-public-model');
}

export async function fetchLinsheLaunchUrl(): Promise<string> {
  try {
    const response = await fetch('/api/apps/linshe', { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (response.ok) {
      const payload = (await response.json()) as { launchUrl?: unknown };
      if (typeof payload.launchUrl === 'string' && payload.launchUrl.trim()) return payload.launchUrl;
    }
  } catch {
    // fallback
  }
  return typeof window !== 'undefined' ? new URL('/apps/linshe', window.location.href).toString() : '/apps/linshe';
}
