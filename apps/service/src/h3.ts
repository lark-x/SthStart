import { stat } from 'node:fs/promises';

export interface H3Settings {
  enabled: boolean;
  workerUrl: string | null;
  modelPath: string | null;
  maxWidth: number;
  maxHeight: number;
  maxDurationSeconds: number;
  concurrencyLimit: number;
}

export interface H3Constraints {
  maxWidth: number;
  maxHeight: number;
  maxDurationSeconds: number;
  concurrencyLimit: number;
}

export type H3Capability = 'h3-t2v' | 'h3-i2v' | 'h3-fl2va';

export interface H3WorkflowReadiness {
  published?: boolean;
  category?: string | null;
  bindingValid?: boolean;
  outputValid?: boolean;
}

export interface H3StatusOptions {
  constraints?: Partial<H3Constraints>;
  workflow?: H3WorkflowReadiness;
}

const DEFAULT_H3_CONSTRAINTS: H3Constraints = {
  maxWidth: 854,
  maxHeight: 480,
  maxDurationSeconds: 4,
  concurrencyLimit: 1,
};

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export function readH3Settings(environment: Readonly<Record<string, string | undefined>> = process.env): H3Settings {
  return {
    enabled: environment.STHSTART_H3_ENABLED === 'true',
    workerUrl: environment.STHSTART_H3_WORKER_URL?.trim().replace(/\/+$/, '') || null,
    modelPath: environment.STHSTART_H3_MODEL_PATH?.trim() || null,
    maxWidth: positiveInteger(environment.STHSTART_H3_MAX_WIDTH, DEFAULT_H3_CONSTRAINTS.maxWidth, 16_384),
    maxHeight: positiveInteger(environment.STHSTART_H3_MAX_HEIGHT, DEFAULT_H3_CONSTRAINTS.maxHeight, 16_384),
    maxDurationSeconds: positiveInteger(environment.STHSTART_H3_MAX_DURATION_SECONDS, DEFAULT_H3_CONSTRAINTS.maxDurationSeconds, 86_400),
    concurrencyLimit: positiveInteger(environment.STHSTART_H3_CONCURRENCY_LIMIT, DEFAULT_H3_CONSTRAINTS.concurrencyLimit, 64),
  };
}

export interface H3ExperimentStatus {
  id: 'h3-t2v' | 'h3-i2v' | 'h3-fl2va';
  enabled: boolean;
  available: boolean;
  ready: boolean;
  constraints: H3Constraints;
  reason: 'disabled' | 'worker_not_configured' | 'model_missing' | 'worker_unreachable' | 'worker_http_error'
    | 'worker_not_ready' | 'comfyui_unreachable' | 'workflow_missing' | 'custom_node_missing'
    | 'binding_invalid' | 'output_invalid' | 'capability_missing' | 'ready';
}

function resolveConstraints(settings: H3Settings, options?: H3StatusOptions): H3Constraints {
  const supplied = options?.constraints ?? {};
  const positive = (value: unknown, fallback: number, maximum: number) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
  };
  return {
    maxWidth: positive(supplied.maxWidth, settings.maxWidth, 16_384),
    maxHeight: positive(supplied.maxHeight, settings.maxHeight, 16_384),
    maxDurationSeconds: positive(supplied.maxDurationSeconds, settings.maxDurationSeconds, 86_400),
    concurrencyLimit: positive(supplied.concurrencyLimit, settings.concurrencyLimit, 64),
  };
}

function workflowReason(workflow?: H3WorkflowReadiness): H3ExperimentStatus['reason'] | null {
  if (!workflow) return null;
  if (workflow.published === false) return 'workflow_missing';
  if (workflow.category !== undefined && workflow.category !== null && workflow.category !== 'video') return 'workflow_missing';
  if (workflow.bindingValid === false) return 'binding_invalid';
  if (workflow.outputValid === false) return 'output_invalid';
  return null;
}

function healthComfyReady(payload: Record<string, unknown>) {
  if (payload.comfyuiReady === false || payload.comfyReady === false) return false;
  for (const key of ['comfyui', 'comfyUI', 'comfy']) {
    const value = payload[key];
    if (value === false) return false;
    if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).ready === false) return false;
  }
  return true;
}

function capabilityList(payload: Record<string, unknown>) {
  return Array.isArray(payload.capabilities)
    ? payload.capabilities.filter((value): value is string => typeof value === 'string')
    : [];
}

export async function getH3Status(
  fetcher: typeof fetch = fetch,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workerToken: string | null = null,
  requiredCapability: H3Capability = 'h3-fl2va',
  options?: H3StatusOptions,
): Promise<H3ExperimentStatus> {
  const settings = readH3Settings(environment);
  const constraints = resolveConstraints(settings, options);
  if (!settings.enabled) return { id: requiredCapability, enabled: false, available: false, ready: false, constraints, reason: 'disabled' };
  const preflightReason = workflowReason(options?.workflow);
  if (preflightReason) return { id: requiredCapability, enabled: true, available: false, ready: false, constraints, reason: preflightReason };
  if (!settings.workerUrl) {
    if (settings.modelPath) {
      const modelExists = await stat(settings.modelPath).then((value) => value.isFile()).catch(() => false);
      return { id: requiredCapability, enabled: true, available: false, ready: false, constraints, reason: modelExists ? 'worker_not_configured' : 'model_missing' };
    }
    return { id: requiredCapability, enabled: true, available: false, ready: false, constraints, reason: 'worker_not_configured' };
  }
  if (settings.modelPath) {
    const modelExists = await stat(settings.modelPath).then((value) => value.isFile()).catch(() => false);
    if (!modelExists) return { id: requiredCapability, enabled: true, available: false, ready: false, constraints, reason: 'model_missing' };
  }

  try {
    const response = await fetcher(`${settings.workerUrl}/health`, {
      headers: { accept: 'application/json', ...(workerToken ? { authorization: `Bearer ${workerToken}` } : {}) },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { id: requiredCapability, enabled: true, available: false, ready: false, constraints, reason: 'worker_http_error' };
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (payload.modelDirectoryReady === false || payload.modelReady === false) {
      return { id: requiredCapability, enabled: true, available: true, ready: false, constraints, reason: 'model_missing' };
    }
    if (!capabilityList(payload).includes(requiredCapability)) {
      return { id: requiredCapability, enabled: true, available: true, ready: false, constraints, reason: 'capability_missing' };
    }
    if (!healthComfyReady(payload)) {
      return { id: requiredCapability, enabled: true, available: true, ready: false, constraints, reason: 'comfyui_unreachable' };
    }
    if (payload.customNodeReady === false || payload.customNodesReady === false) {
      return { id: requiredCapability, enabled: true, available: true, ready: false, constraints, reason: 'custom_node_missing' };
    }
    if (payload.ready === true) return { id: requiredCapability, enabled: true, available: true, ready: true, constraints, reason: 'ready' };
    return { id: requiredCapability, enabled: true, available: true, ready: false, constraints, reason: 'worker_not_ready' };
  } catch {
    return { id: requiredCapability, enabled: true, available: false, ready: false, constraints, reason: 'worker_unreachable' };
  }
}
