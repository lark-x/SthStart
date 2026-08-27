import type { ServiceDatabase } from './database.js';

export const WORKER_TASK_ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
export const WORKER_UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
export const WORKER_OUTPUT_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

export interface WorkerSettings {
  model: string;
  temperature: number;
  ipAllowlist: string[];
  diskWarningBytes: number;
  diskStopBytes: number;
  maxTempBytes: number;
}

export interface WorkerStatusOutput {
  outputId: string;
  outputName: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  mediaKind?: 'image' | 'video' | 'audio' | 'file';
}

export interface WorkerTaskStatus {
  taskId: string;
  status: 'staging' | 'queued' | 'accepted' | 'running' | 'succeeded' | 'failed' | 'abandoned' | 'cancelled' | 'confirmed';
  providerTaskId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  progress?: {
    value: number | null;
    stage: string;
    message?: string;
    current?: number;
    total?: number;
    source?: string;
  };
  outputs?: WorkerStatusOutput[];
}

export function defaultWorkerSettings(): WorkerSettings {
  return {
    model: '',
    temperature: 0.7,
    ipAllowlist: [],
    diskWarningBytes: 10 * 1024 * 1024 * 1024,
    diskStopBytes: 2 * 1024 * 1024 * 1024,
    maxTempBytes: 100 * 1024 * 1024 * 1024,
  };
}

export function readWorkerSettings(database: ServiceDatabase, engineId: string): WorkerSettings {
  const fallback = defaultWorkerSettings();
  const row = database.connection.prepare('SELECT model,temperature,ip_allowlist_json,disk_warning_bytes,disk_stop_bytes FROM generation_workers WHERE engine_id=?').get(engineId) as {
    model: string; temperature: number; ip_allowlist_json: string; disk_warning_bytes: number; disk_stop_bytes: number;
  } | undefined;
  if (!row) return fallback;
  let ipAllowlist: string[] = [];
  try {
    const parsed = JSON.parse(row.ip_allowlist_json);
    if (Array.isArray(parsed)) ipAllowlist = parsed.filter((item): item is string => typeof item === 'string');
  } catch { /* use empty allowlist */ }
  return {
    model: String(row.model ?? ''),
    temperature: Number.isFinite(Number(row.temperature)) ? Number(row.temperature) : fallback.temperature,
    ipAllowlist,
    diskWarningBytes: Number(row.disk_warning_bytes) || fallback.diskWarningBytes,
    diskStopBytes: Number(row.disk_stop_bytes) || fallback.diskStopBytes,
    maxTempBytes: fallback.maxTempBytes,
  };
}

function workerEndpoint(baseUrl: string, suffix: string) {
  return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

function workerError(code: string, message: string, status?: number) {
  const error = new Error(message) as Error & { code: string; status?: number };
  error.code = code;
  if (status !== undefined) error.status = status;
  return error;
}

function authHeaders(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function responseMessage(response: Response) {
  const text = await response.text().catch(() => '');
  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
    return String(payload.message ?? payload.error ?? `HTTP ${response.status}`).slice(0, 300);
  } catch {
    return text.slice(0, 300) || `HTTP ${response.status}`;
  }
}

async function requestJson<T>(
  baseUrl: string,
  token: string,
  suffix: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(workerEndpoint(baseUrl, suffix), {
      ...init,
      headers: authHeaders(token, (init.headers ?? {}) as Record<string, string>),
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw workerError('worker_unavailable', `Windows Worker 不可达：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw workerError('worker_request_failed', await responseMessage(response), response.status);
  return response.json() as Promise<T>;
}

export async function workerHealth(baseUrl: string, token: string, fetcher: typeof fetch = fetch) {
  return requestJson<Record<string, unknown>>(baseUrl, token, '/health', { method: 'GET' }, fetcher);
}

export async function submitWorkerTask(input: {
  baseUrl: string; token: string; taskId: string; workflow: Record<string, unknown>;
  outputDeclarations: string[]; outputMediaTypes?: string[]; category?: string; capability?: string; settings?: Partial<WorkerSettings>; fetcher?: typeof fetch;
}) {
  if (!WORKER_TASK_ID_PATTERN.test(input.taskId)) throw workerError('worker_protocol_error', 'Worker task ID 格式无效。');
  return requestJson<WorkerTaskStatus>(input.baseUrl, input.token, '/v1/worker/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      taskId: input.taskId,
      workflow: input.workflow,
      outputDeclarations: input.outputDeclarations,
      outputMediaTypes: input.outputMediaTypes,
      category: input.category,
      capability: input.capability,
      model: input.settings?.model || undefined,
      temperature: input.settings?.temperature,
    }),
  }, input.fetcher ?? fetch);
}

export async function uploadWorkerInput(input: {
  baseUrl: string; token: string; taskId: string; uploadId: string; body: Blob;
  filename: string; contentType: string; contentLength: number; sha256: string; fetcher?: typeof fetch;
}) {
  if (!WORKER_TASK_ID_PATTERN.test(input.taskId) || !WORKER_UPLOAD_ID_PATTERN.test(input.uploadId)) throw workerError('worker_protocol_error', 'Worker 输入上传 ID 格式无效。');
  return requestJson<{ taskId: string; uploadId: string; fileName: string; relativePath: string; sha256: string }>(
    input.baseUrl,
    input.token,
    `/v1/worker/tasks/${encodeURIComponent(input.taskId)}/input/${encodeURIComponent(input.uploadId)}`,
    {
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.contentLength),
        'x-worker-file-name': input.filename,
        'x-artifact-sha256': input.sha256,
      },
      body: input.body,
    },
    input.fetcher ?? fetch,
  );
}

export async function getWorkerTaskStatus(baseUrl: string, token: string, taskId: string, fetcher: typeof fetch = fetch) {
  if (!WORKER_TASK_ID_PATTERN.test(taskId)) throw workerError('worker_protocol_error', 'Worker task ID 格式无效。');
  return requestJson<WorkerTaskStatus>(baseUrl, token, `/v1/worker/tasks/${encodeURIComponent(taskId)}/status`, { method: 'GET' }, fetcher);
}

export async function downloadWorkerOutput(baseUrl: string, token: string, taskId: string, outputId: string, fetcher: typeof fetch = fetch) {
  if (!WORKER_TASK_ID_PATTERN.test(taskId) || !WORKER_OUTPUT_ID_PATTERN.test(outputId)) throw workerError('worker_protocol_error', 'Worker 产物 ID 格式无效。');
  let response: Response;
  try {
    response = await fetcher(workerEndpoint(baseUrl, `/v1/worker/tasks/${encodeURIComponent(taskId)}/output/${encodeURIComponent(outputId)}`), {
      method: 'GET', headers: authHeaders(token), signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw workerError('worker_unavailable', `Windows Worker 产物不可达：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw workerError('worker_output_failed', await responseMessage(response), response.status);
  if (!response.body) throw workerError('worker_output_failed', 'Windows Worker 未返回产物内容。');
  return response;
}

export async function confirmWorkerTask(baseUrl: string, token: string, taskId: string, outputIds: string[], fetcher: typeof fetch = fetch) {
  return requestJson<{ taskId: string; status: string }>(baseUrl, token, `/v1/worker/tasks/${encodeURIComponent(taskId)}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outputIds }),
  }, fetcher);
}
