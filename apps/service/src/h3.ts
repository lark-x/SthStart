import { stat } from 'node:fs/promises';

export interface H3Settings {
  enabled: boolean;
  workerUrl: string | null;
  modelPath: string | null;
  maxWidth: 854;
  maxHeight: 480;
  maxDurationSeconds: 4;
  concurrencyLimit: 1;
}

export function readH3Settings(environment: Readonly<Record<string, string | undefined>> = process.env): H3Settings {
  return {
    enabled: environment.STHSTART_H3_ENABLED === 'true',
    workerUrl: environment.STHSTART_H3_WORKER_URL?.trim().replace(/\/+$/, '') || null,
    modelPath: environment.STHSTART_H3_MODEL_PATH?.trim() || null,
    maxWidth: 854,
    maxHeight: 480,
    maxDurationSeconds: 4,
    concurrencyLimit: 1,
  };
}

export interface H3ExperimentStatus {
  id: 'h3-fl2va';
  enabled: boolean;
  available: boolean;
  ready: boolean;
  constraints: {
    maxWidth: 854;
    maxHeight: 480;
    maxDurationSeconds: 4;
    concurrencyLimit: 1;
  };
  reason: 'disabled' | 'worker_not_configured' | 'model_missing' | 'worker_unreachable' | 'worker_http_error' | 'worker_not_ready' | 'ready';
}

export async function getH3Status(
  fetcher: typeof fetch = fetch,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<H3ExperimentStatus> {
  const settings = readH3Settings(environment);
  const constraints = {
    maxWidth: settings.maxWidth,
    maxHeight: settings.maxHeight,
    maxDurationSeconds: settings.maxDurationSeconds,
    concurrencyLimit: settings.concurrencyLimit,
  } as const;
  if (!settings.enabled) return { id: 'h3-fl2va', enabled: false, available: false, ready: false, constraints, reason: 'disabled' };
  if (!settings.workerUrl) {
    if (settings.modelPath) {
      const modelExists = await stat(settings.modelPath).then((value) => value.isFile()).catch(() => false);
      return { id: 'h3-fl2va', enabled: true, available: false, ready: false, constraints, reason: modelExists ? 'worker_not_configured' : 'model_missing' };
    }
    return { id: 'h3-fl2va', enabled: true, available: false, ready: false, constraints, reason: 'worker_not_configured' };
  }

  try {
    const response = await fetcher(`${settings.workerUrl}/health`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return { id: 'h3-fl2va', enabled: true, available: false, ready: false, constraints, reason: 'worker_http_error' };
    const payload = await response.json().catch(() => ({})) as { ready?: unknown; capabilities?: unknown };
    const capabilityReady = Array.isArray(payload.capabilities) && payload.capabilities.includes('h3-fl2va');
    if (payload.ready === true && capabilityReady) return { id: 'h3-fl2va', enabled: true, available: true, ready: true, constraints, reason: 'ready' };
    return { id: 'h3-fl2va', enabled: true, available: true, ready: false, constraints, reason: 'worker_not_ready' };
  } catch {
    return { id: 'h3-fl2va', enabled: true, available: false, ready: false, constraints, reason: 'worker_unreachable' };
  }
}
