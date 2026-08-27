import { randomUUID } from 'node:crypto';
import type { GenerationPriority, GenerationProgress, GenerationTaskDescriptor } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { createArtifactReference, persistArtifact, removeArtifact, streamUploadArtifact } from '../artifacts.js';
import type { SecretStore } from '../security.js';
import {
  confirmWorkerTask,
  downloadWorkerOutput,
  getWorkerTaskStatus,
  readWorkerSettings,
  submitWorkerTask,
  WORKER_OUTPUT_ID_PATTERN,
} from '../worker.js';
import { activeGenerationExecutions, generationExecutionsStopped, recordGenerationEvent } from './events.js';
import { generationError, sanitizeErrorMessage } from './errors.js';
import { computeRequestHash, renderWorkflowSnapshot } from './workflows.js';
import { normalizeInputArtifacts, parseGenerationRequestParams, prepareInputArtifacts, validateInputArtifacts } from './inputs.js';
import type { GenerationInputArtifact } from './inputs.js';
import { getGenerationTask, resolveWorkflowAndEngine } from './task-store.js';

export interface CreateTaskOptions {
  appId: string;
  idempotencyKey?: string | null;
  purpose?: string | null;
  workflowId?: string | null;
  workflowVersion?: number | null;
  inputs?: Record<string, unknown>;
  inputArtifacts?: GenerationInputArtifact[];
  seed?: number | null;
  retryOf?: string | null;
  isInternal?: boolean;
  priority?: GenerationPriority;
}

function normalizeProgress(value: unknown, fallbackStage: string): GenerationProgress {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const numericValue = Number(raw.value);
  return {
    value: raw.value === null || !Number.isFinite(numericValue) ? null : Math.min(1, Math.max(0, numericValue)),
    stage: typeof raw.stage === 'string' && raw.stage ? raw.stage : fallbackStage,
    ...(typeof raw.message === 'string' ? { message: raw.message.slice(0, 300) } : {}),
    ...(Number.isFinite(Number(raw.current)) ? { current: Math.max(0, Number(raw.current)) } : {}),
    ...(Number.isFinite(Number(raw.total)) ? { total: Math.max(0, Number(raw.total)) } : {}),
    ...(typeof raw.source === 'string' ? { source: raw.source.slice(0, 80) } : {}),
  };
}

function updateTaskProgress(
  database: ServiceDatabase,
  taskId: string,
  appId: string,
  progress: GenerationProgress,
  emit = true,
) {
  const normalized = normalizeProgress(progress, progress.stage);
  const serialized = JSON.stringify(normalized);
  const existing = database.connection.prepare('SELECT progress_json FROM generation_tasks WHERE id=?').get(taskId) as { progress_json?: string } | undefined;
  if (existing?.progress_json === serialized) return;
  database.connection.prepare('UPDATE generation_tasks SET progress_json=?, updated_at=? WHERE id=?')
    .run(serialized, nowIso(), taskId);
  if (emit) recordGenerationEvent(database, { taskId, appId, eventType: 'progress', payload: normalized as unknown as Record<string, unknown> });
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  try {
    const parsed: unknown = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function workflowMediaInfo(database: ServiceDatabase, taskRow: Record<string, unknown>) {
  const row = database.connection.prepare(`
    SELECT w.category, v.output_media_types_json, m.category AS legacy_category,
      m.output_media_types_json AS legacy_output_media_types_json
    FROM generation_workflows w
    JOIN generation_workflow_versions v ON v.workflow_id=w.id AND v.version=?
    LEFT JOIN generation_workflow_media_versions m ON m.workflow_id=v.workflow_id AND m.version=v.version
    WHERE w.id=?
  `).get(Number(taskRow.workflow_version), String(taskRow.workflow_id)) as Record<string, unknown> | undefined;
  if (!row) return { category: 'image', outputMediaTypes: ['image/png'] };
  const direct = parseJsonArray(row.output_media_types_json);
  const legacy = parseJsonArray(row.legacy_output_media_types_json);
  return {
    category: typeof row.category === 'string' && row.category !== 'image'
      ? row.category
      : typeof row.legacy_category === 'string' ? row.legacy_category : 'image',
    outputMediaTypes: direct.length && !(direct.length === 1 && direct[0] === 'image/png' && legacy.length) ? direct : legacy.length ? legacy : ['image/png'],
  };
}

function generationEngineHeaders(database: ServiceDatabase, engine: Record<string, unknown>, secret: string | null, contentType = false) {
  let configured: Record<string, string> = {};
  try {
    const row = database.connection.prepare('SELECT headers_json FROM generation_engine_options WHERE engine_id=?')
      .get(String(engine.id)) as { headers_json: string } | undefined;
    const parsed = JSON.parse(row?.headers_json ?? '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      configured = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
        .filter(([key, value]) => typeof value === 'string' && !/^(host|content-length|authorization)$/i.test(key))) as Record<string, string>;
    }
  } catch {
    configured = {};
  }
  return {
    ...configured,
    ...(contentType ? { 'content-type': 'application/json' } : {}),
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
  };
}

export async function createGenerationTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  options: CreateTaskOptions,
  fetcher: typeof fetch = fetch,
): Promise<GenerationTaskDescriptor> {
  const inputs = options.inputs ?? {};
  const inputArtifacts = normalizeInputArtifacts(options.inputArtifacts);
  const canonicalPayload = {
    purpose: options.purpose?.trim() || 'default',
    workflowId: options.workflowId?.trim() || null,
    workflowVersion: options.workflowVersion ?? null,
    inputs,
    inputArtifacts,
    seed: options.seed ?? null,
    priority: options.priority ?? 'normal',
  };
  const requestHash = computeRequestHash(canonicalPayload);

  if (options.idempotencyKey) {
    const existing = database.connection.prepare(
      'SELECT * FROM generation_tasks WHERE app_id = ? AND idempotency_key = ?',
    ).get(options.appId, options.idempotencyKey) as Record<string, unknown> | undefined;

    if (existing) {
      if (existing.request_hash === requestHash) {
        return getGenerationTask(database, String(existing.id), options.appId)!;
      }
      const err = new Error('已存在具有相同幂等键但请求参数不同的生成任务。');
      (err as { code?: string }).code = 'idempotency_conflict';
      throw err;
    }
  }

  const resolved = resolveWorkflowAndEngine(database, options.appId, options);
  validateInputArtifacts(database, options.appId, inputArtifacts, resolved.workflow.inputCapabilities);
  for (const input of inputArtifacts) {
    if (!resolved.workflow.nodeBindings[input.inputKey]) {
      throw generationError('input_binding_not_found', `工作流没有为输入 ${input.inputKey} 配置节点绑定。`);
    }
  }
  const actualSeed = options.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const renderInputs = { ...inputs };
  for (const input of inputArtifacts) delete renderInputs[input.inputKey];
  const workflowSnapshot = renderWorkflowSnapshot(
    resolved.workflow.definition,
    resolved.workflow.nodeBindings,
    renderInputs,
    actualSeed,
  );

  const id = randomUUID();
  const now = nowIso();

  database.transaction(() => {
    database.connection.prepare(`
      INSERT INTO generation_tasks (
        id, app_id, engine_id, workflow_id, workflow_version, purpose,
        idempotency_key, request_hash, request_params_json, workflow_snapshot_json,
        actual_seed, status, provider_task_id, error_code, error_message,
        upstream_may_continue, cancellation_scope, retry_of, created_at, updated_at, priority, progress_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, 0, 'none', ?, ?, ?, ?, ?)
    `).run(
      id,
      options.appId,
      resolved.engine.id,
      resolved.workflow.id,
      resolved.workflow.version,
      options.purpose?.trim() || 'default',
      options.idempotencyKey ?? null,
      requestHash,
      JSON.stringify({ inputs, inputArtifacts }),
      JSON.stringify(workflowSnapshot),
      actualSeed,
      options.retryOf ?? null,
      now,
      now,
      options.priority ?? 'normal',
      JSON.stringify({ value: 0, stage: 'queued', source: 'generation' }),
    );
    for (const input of inputArtifacts) {
      createArtifactReference(database, {
        artifactId: input.artifactId,
        appId: options.appId,
        refType: 'generation-input',
        refId: id,
      });
    }
  });

  recordGenerationEvent(database, {
    taskId: id,
    appId: options.appId,
    eventType: 'queued',
    payload: { status: 'queued', actualSeed },
  });

  // Asynchronously trigger scheduling
  const p = (async () => {
    await new Promise((r) => setImmediate(r));
    await processTaskExecution(config, database, secrets, id, fetcher);
  })()
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("database is not open")) {
        console.error(`[generation] task ${id} background error:`, err);
      }
    })
    .finally(() => activeGenerationExecutions.delete(p));
  activeGenerationExecutions.add(p);

  return getGenerationTask(database, id, options.appId)!;
}

export async function executeQueuedTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  taskId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (generationExecutionsStopped(database)) return;
  const taskRow = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  if (!taskRow || taskRow.status !== "queued") return;

  const appId = String(taskRow.app_id);
  const engineId = String(taskRow.engine_id);
  const engineRow = database.connection.prepare("SELECT * FROM generation_engines WHERE id = ?").get(engineId) as Record<string, unknown> | undefined;
  if (!engineRow || !engineRow.enabled) {
    const nowErr = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'failed', error_code = 'generation_engine_unavailable', error_message = '生成引擎不可用', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(nowErr, nowErr, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: "failed",
      payload: { errorCode: "generation_engine_unavailable", errorMessage: "生成引擎不可用" },
    });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return;
  }

  if (engineRow.kind !== "comfyui" && engineRow.kind !== "worker") {
    const nowErr = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'failed', error_code = 'unsupported_engine', error_message = '暂不支持该类型的生成引擎', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(nowErr, nowErr, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: "failed",
      payload: { errorCode: "unsupported_engine", errorMessage: "暂不支持该类型的生成引擎" },
    });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return;
  }

  const concurrencyLimit = engineRow.kind === 'worker' ? 1 : Math.max(1, Number(engineRow.concurrency_limit || 1));
  const leaseOwner = randomUUID();
  const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const now = nowIso();

  let claimed = false;
  database.transaction(() => {
    const activeCount = (database.connection.prepare(
      "SELECT COUNT(*) as count FROM generation_tasks WHERE engine_id = ? AND status IN ('submitting', 'accepted', 'running') AND id != ?",
    ).get(engineId, taskId) as { count: number }).count;

    if (activeCount >= concurrencyLimit) {
      return;
    }

    const claimResult = database.connection.prepare(`
      UPDATE generation_tasks
      SET status = 'submitting', lease_owner = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?), progress_json = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(leaseOwner, leaseExpiresAt, now, JSON.stringify({ value: null, stage: 'submitting', source: 'generation' }), now, taskId);

    if (claimResult.changes > 0) {
      claimed = true;
    }
  });

  if (!claimed) {
    return;
  }

  recordGenerationEvent(database, { taskId, appId, eventType: "submitting", payload: { status: "submitting" } });

  const engineBaseUrl = String(engineRow.base_url).replace(/\/+$/, "");
  const credentialAccount = engineRow.credential_account ? String(engineRow.credential_account) : null;
  let secret: string | null = null;
  if (credentialAccount) {
    try {
      const credential = await secrets.get(credentialAccount);
      secret = credential.value;
    } catch (secErr) {
      const nowErr = nowIso();
      const safeMsg = sanitizeErrorMessage(secErr instanceof Error ? secErr.message : String(secErr)).slice(0, 300);
      database.connection.prepare(
        "UPDATE generation_tasks SET status = 'failed', error_code = 'keyring_unavailable', error_message = ?, updated_at = ?, finished_at = ? WHERE id = ?",
      ).run(`凭据库读取失败：${safeMsg}`, nowErr, nowErr, taskId);
      recordGenerationEvent(database, {
        taskId,
        appId,
        eventType: "failed",
        payload: { errorCode: "keyring_unavailable", errorMessage: `凭据库读取失败：${safeMsg}` },
      });
      setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
      return;
    }
  }

  let workflowSnapshot: Record<string, unknown>;
  try {
    workflowSnapshot = await prepareInputArtifacts(
      database,
      taskRow,
      JSON.parse(String(taskRow.workflow_snapshot_json)) as Record<string, unknown>,
      secret,
      String(engineRow.kind),
      fetcher,
    );
  } catch (error) {
    const rawCode = (error as { code?: string })?.code;
    const errorCode = rawCode || 'input_artifact_failed';
    const safeMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 300);
    const nowErr = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(errorCode, safeMessage, nowErr, nowErr, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: 'failed',
      payload: { errorCode, errorMessage: safeMessage },
    });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return;
  }
  if (engineRow.kind === 'worker') {
    let outputDeclarations: string[] = [];
    try {
      const version = database.connection.prepare(
        'SELECT output_declarations_json FROM generation_workflow_versions WHERE workflow_id = ? AND version = ?',
      ).get(String(taskRow.workflow_id), Number(taskRow.workflow_version)) as { output_declarations_json: string } | undefined;
      const parsed = version ? JSON.parse(version.output_declarations_json) as unknown : [];
      if (Array.isArray(parsed)) outputDeclarations = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    } catch {
      outputDeclarations = [];
    }

    const settings = readWorkerSettings(database, engineId);
    const mediaInfo = workflowMediaInfo(database, taskRow);
    let workerSubmission;
    try {
      workerSubmission = await submitWorkerTask({
        baseUrl: engineBaseUrl,
        token: secret ?? '',
        taskId,
        workflow: workflowSnapshot,
        outputDeclarations,
        outputMediaTypes: mediaInfo.outputMediaTypes,
        category: mediaInfo.category,
        capability: String(taskRow.purpose),
        settings,
        fetcher,
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const safeMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 300);
      const nowErr = nowIso();
      if (code === 'worker_unavailable') {
        database.connection.prepare(
          "UPDATE generation_tasks SET status = 'abandoned', error_code = 'submission_outcome_unknown', error_message = ?, upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
        ).run(`Windows Worker 提交状态不确定：${safeMessage}`, nowErr, nowErr, taskId);
        recordGenerationEvent(database, {
          taskId,
          appId,
          eventType: 'abandoned',
          payload: { errorCode: 'submission_outcome_unknown', errorMessage: `Windows Worker 提交状态不确定：${safeMessage}` },
        });
      } else {
        database.connection.prepare(
          "UPDATE generation_tasks SET status = 'failed', error_code = 'worker_request_failed', error_message = ?, updated_at = ?, finished_at = ? WHERE id = ?",
        ).run(safeMessage, nowErr, nowErr, taskId);
        recordGenerationEvent(database, {
          taskId,
          appId,
          eventType: 'failed',
          payload: { errorCode: 'worker_request_failed', errorMessage: safeMessage },
        });
      }
      setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
      return;
    }

    const workerStatus = String(workerSubmission.status || 'accepted');
    if (workerStatus === 'failed' || workerStatus === 'abandoned' || workerStatus === 'cancelled') {
      const nowErr = nowIso();
      const errorCode = String(workerSubmission.errorCode || `worker_${workerStatus}`);
      const safeMessage = sanitizeErrorMessage(String(workerSubmission.errorMessage || `Windows Worker 任务${workerStatus}。`)).slice(0, 300);
      const terminalStatus = workerStatus === 'abandoned' ? 'abandoned' : workerStatus;
      database.connection.prepare(
        `UPDATE generation_tasks SET status = ?, error_code = ?, error_message = ?, upstream_may_continue = ?, cancellation_scope = ?, updated_at = ?, finished_at = ? WHERE id = ?`,
      ).run(terminalStatus, errorCode, safeMessage, terminalStatus === 'abandoned' ? 1 : 0, terminalStatus === 'abandoned' ? 'local-tracking' : 'none', nowErr, nowErr, taskId);
      recordGenerationEvent(database, {
        taskId,
        appId,
        eventType: terminalStatus,
        payload: { errorCode, errorMessage: safeMessage },
      });
      setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
      return;
    }

    const workerTaskId = typeof workerSubmission.taskId === 'string' && workerSubmission.taskId
      ? workerSubmission.taskId
      : typeof workerSubmission.providerTaskId === 'string' && workerSubmission.providerTaskId
        ? workerSubmission.providerTaskId
        : taskId;
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(workerTaskId)) {
      const nowErr = nowIso();
      database.connection.prepare(
        "UPDATE generation_tasks SET status = 'failed', error_code = 'worker_protocol_error', error_message = 'Windows Worker 未返回有效任务 ID', updated_at = ?, finished_at = ? WHERE id = ?",
      ).run(nowErr, nowErr, taskId);
      recordGenerationEvent(database, {
        taskId,
        appId,
        eventType: 'failed',
        payload: { errorCode: 'worker_protocol_error', errorMessage: 'Windows Worker 未返回有效任务 ID' },
      });
      setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
      return;
    }

    const nowAccepted = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'accepted', provider_task_id = ?, progress_json = ?, updated_at = ? WHERE id = ?",
    ).run(workerTaskId, JSON.stringify({ value: 0, stage: 'accepted', source: 'windows-worker' }), nowAccepted, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: 'accepted',
      payload: { status: 'accepted', providerTaskId: workerTaskId, source: 'windows-worker' },
    });
    await pollAndCompleteTask(config, database, secrets, taskId, fetcher);
    return;
  }

  const headers = generationEngineHeaders(database, engineRow, secret, true);

  let promptRes: Response;
  try {
    promptRes = await fetcher(`${engineBaseUrl}/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: workflowSnapshot, client_id: taskId }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // Submission outcome unknown: do NOT re-submit!
    const nowErr = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'abandoned', error_code = 'submission_outcome_unknown', error_message = '提交状态不确定，禁止自动重复提交', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(nowErr, nowErr, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: "abandoned",
      payload: { errorCode: "submission_outcome_unknown", errorMessage: "提交状态不确定，禁止自动重复提交" },
    });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return;
  }

  if (!promptRes.ok) {
    const errPayload = await promptRes.json().catch(() => null) as { error?: unknown; message?: string } | null;
    const rawMsg = errPayload ? String(errPayload.message ?? errPayload.error ?? `HTTP ${promptRes.status}`) : `HTTP ${promptRes.status}`;
    const safeMsg = sanitizeErrorMessage(rawMsg).slice(0, 300);
    const nowErr = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'failed', error_code = 'upstream_rejected', error_message = ?, updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(safeMsg, nowErr, nowErr, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: "failed",
      payload: { errorCode: "upstream_rejected", errorMessage: safeMsg },
    });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return;
  }

  const promptData = await promptRes.json().catch(() => ({})) as { prompt_id?: string; task_id?: string };
  const providerTaskId = promptData.prompt_id || promptData.task_id || "";
  if (!providerTaskId) {
    const nowErr = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'failed', error_code = 'image_missing_task_id', error_message = '引擎未返回任务 ID', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(nowErr, nowErr, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: "failed",
      payload: { errorCode: "image_missing_task_id", errorMessage: "引擎未返回任务 ID" },
    });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return;
  }

  const nowAccepted = nowIso();
  database.connection.prepare(
    "UPDATE generation_tasks SET status = 'accepted', provider_task_id = ?, progress_json = ?, updated_at = ? WHERE id = ?",
  ).run(providerTaskId, JSON.stringify({ value: 0, stage: 'accepted', source: 'comfyui' }), nowAccepted, taskId);
  recordGenerationEvent(database, {
    taskId,
    appId,
    eventType: "accepted",
    payload: { status: "accepted", providerTaskId },
  });

  await pollAndCompleteTask(config, database, secrets, taskId, fetcher);
}

async function pollAndCompleteWorkerTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  taskId: string,
  fetcher: typeof fetch,
  options?: { pollTimeoutMs?: number; pollIntervalMs?: number },
): Promise<void> {
  const taskRow = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  if (!taskRow) return;
  const appId = String(taskRow.app_id);
  const workerTaskId = taskRow.provider_task_id ? String(taskRow.provider_task_id) : taskId;
  const engineRow = database.connection.prepare("SELECT * FROM generation_engines WHERE id = ?").get(String(taskRow.engine_id)) as Record<string, unknown> | undefined;
  if (!engineRow || String(engineRow.kind) !== 'worker') return;

  const engineBaseUrl = String(engineRow.base_url).replace(/\/+$/, '');
  const credentialAccount = engineRow.credential_account ? String(engineRow.credential_account) : null;
  let secret: string | null = null;
  if (credentialAccount) {
    try {
      const credential = await secrets.get(credentialAccount);
      secret = credential.value;
    } catch {}
  }
  if (!secret) {
    const nowErr = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'failed', error_code = 'worker_token_missing', error_message = 'Windows Worker 凭据未配置', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(nowErr, nowErr, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: 'failed',
      payload: { errorCode: 'worker_token_missing', errorMessage: 'Windows Worker 凭据未配置' },
    });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return;
  }

  const pollTimeoutMs = options?.pollTimeoutMs ?? 600_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 500;
  const pollDeadline = Date.now() + pollTimeoutMs;

  while (Date.now() < pollDeadline && !generationExecutionsStopped(database)) {
    const currentTask = database.connection.prepare("SELECT status, progress_json FROM generation_tasks WHERE id = ?").get(taskId) as { status: string; progress_json?: string } | undefined;
    if (!currentTask || ["succeeded", "failed", "cancelled", "abandoned"].includes(currentTask.status)) return;

    try {
      const workerStatus = await getWorkerTaskStatus(engineBaseUrl, secret, workerTaskId, fetcher);
      const status = workerStatus.status;

      if (workerStatus.progress && typeof workerStatus.progress === 'object') {
        updateTaskProgress(database, taskId, appId, {
          ...workerStatus.progress,
          source: workerStatus.progress.source || 'windows-worker',
        });
      }

      if (status === 'failed' || status === 'abandoned' || status === 'cancelled') {
        const nowDone = nowIso();
        const errorCode = String(workerStatus.errorCode || `worker_${status}`);
        const safeMessage = sanitizeErrorMessage(String(workerStatus.errorMessage || `Windows Worker 任务${status}。`)).slice(0, 300);
        const terminalStatus = status;
          database.connection.prepare(
          "UPDATE generation_tasks SET status = ?, error_code = ?, error_message = ?, progress_json = ?, upstream_may_continue = ?, cancellation_scope = ?, updated_at = ?, finished_at = ? WHERE id = ?",
        ).run(terminalStatus, errorCode, safeMessage, JSON.stringify({ value: null, stage: status, message: safeMessage, source: 'windows-worker' }), status === 'abandoned' ? 1 : 0, status === 'abandoned' ? 'local-tracking' : 'none', nowDone, nowDone, taskId);
        recordGenerationEvent(database, {
          taskId,
          appId,
          eventType: terminalStatus,
          payload: { errorCode, errorMessage: safeMessage },
        });
        break;
      }

      if (status === 'running' && currentTask.status !== 'running') {
        const nowRunning = nowIso();
        database.connection.prepare("UPDATE generation_tasks SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").run(nowRunning, nowRunning, taskId);
        if (!workerStatus.progress) updateTaskProgress(database, taskId, appId, { value: null, stage: 'running', source: 'windows-worker' });
        recordGenerationEvent(database, {
          taskId,
          appId,
          eventType: 'running',
          payload: { status: 'running', source: 'windows-worker' },
        });
      }

      if (status === 'succeeded' || status === 'confirmed') {
        if (status === 'confirmed') {
          const linked = database.connection.prepare('SELECT COUNT(*) as count FROM generation_task_artifacts WHERE task_id=?').get(taskId) as { count: number };
          if (Number(linked.count) > 0) {
            const nowDone = nowIso();
            database.connection.prepare(
              "UPDATE generation_tasks SET status = 'succeeded', error_code = NULL, error_message = NULL, progress_json = ?, updated_at = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ?",
            ).run(JSON.stringify({ value: 1, stage: 'completed', current: 1, total: 1, source: 'windows-worker' }), nowDone, nowDone, taskId);
            break;
          }
        }
        const outputs = Array.isArray(workerStatus.outputs) ? workerStatus.outputs : [];
        if (!outputs.length) {
          const nowDone = nowIso();
          database.connection.prepare(
            "UPDATE generation_tasks SET status = 'failed', error_code = 'worker_outputs_missing', error_message = 'Windows Worker 未返回产物', progress_json = ?, updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(JSON.stringify({ value: null, stage: 'error', message: 'Windows Worker 未返回产物', source: 'windows-worker' }), nowDone, nowDone, taskId);
          recordGenerationEvent(database, {
            taskId,
            appId,
            eventType: 'failed',
            payload: { errorCode: 'worker_outputs_missing', errorMessage: 'Windows Worker 未返回产物' },
          });
          break;
        }

        const persisted: Array<{ artifactId: string; outputName: string; sortOrder: number }> = [];
        let persistError: string | null = null;
        for (let index = 0; index < outputs.length; index++) {
          const output = outputs[index];
          if (!output || !WORKER_OUTPUT_ID_PATTERN.test(String(output.outputId || '')) || !String(output.outputName || '').trim() || !String(output.filename || '').trim()) {
            persistError = 'Windows Worker 返回了无效的产物描述。';
            break;
          }
          try {
            const response = await downloadWorkerOutput(engineBaseUrl, secret, workerTaskId, String(output.outputId), fetcher);
            const outputStream = response.body;
            if (!outputStream) throw new Error('Windows Worker 未返回产物内容。');
            const headerLength = Number.parseInt(response.headers.get('content-length') || '', 10);
            const expectedLength = Number.isFinite(headerLength) && headerLength >= 0 ? headerLength : null;
            const descriptor = await streamUploadArtifact(config, database, {
              appId,
              taskId,
              stream: outputStream,
              contentType: String(output.contentType || response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream',
              contentLength: expectedLength,
              originalName: String(output.filename),
              refType: 'generation-output',
              refId: taskId,
              metadata: {
                source: 'windows-worker',
                workerTaskId,
                outputId: String(output.outputId),
                outputName: String(output.outputName),
                declaredSha256: output.sha256 || null,
              },
            });
            if (output.sha256 && descriptor.sha256 !== output.sha256) {
              await removeArtifact(database, descriptor.id, appId, true).catch(() => undefined);
              throw new Error('Windows Worker 产物校验失败：SHA-256 不匹配。');
            }
            if (Number.isFinite(Number(output.byteSize)) && Number(output.byteSize) !== descriptor.byteSize) {
              await removeArtifact(database, descriptor.id, appId, true).catch(() => undefined);
              throw new Error('Windows Worker 产物校验失败：文件大小不匹配。');
            }
            persisted.push({ artifactId: descriptor.id, outputName: String(output.outputName), sortOrder: index });
          } catch (error) {
            persistError = error instanceof Error ? error.message : String(error);
            break;
          }
        }

        if (persistError || persisted.length !== outputs.length) {
          for (const item of persisted) await removeArtifact(database, item.artifactId, appId, true).catch(() => undefined);
          const nowDone = nowIso();
          const safeMessage = sanitizeErrorMessage(persistError || 'Windows Worker 产物保存失败。').slice(0, 300);
          database.connection.prepare(
            "UPDATE generation_tasks SET status = 'abandoned', error_code = 'worker_output_failed', error_message = ?, progress_json = ?, upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(safeMessage, JSON.stringify({ value: null, stage: 'error', message: safeMessage, source: 'windows-worker' }), nowDone, nowDone, taskId);
          recordGenerationEvent(database, {
            taskId,
            appId,
            eventType: 'abandoned',
            payload: { errorCode: 'worker_output_failed', errorMessage: safeMessage },
          });
          break;
        }

        const nowDone = nowIso();
        database.transaction(() => {
          for (const item of persisted) {
            database.connection.prepare(`
              INSERT INTO generation_task_artifacts (task_id, artifact_id, output_name, sort_order, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(task_id, artifact_id) DO NOTHING
            `).run(taskId, item.artifactId, item.outputName, item.sortOrder, nowDone);
          }
          database.connection.prepare(
            "UPDATE generation_tasks SET status = 'succeeded', error_code = NULL, error_message = NULL, progress_json = ?, updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(JSON.stringify({ value: 1, stage: 'completed', current: 1, total: 1, source: 'windows-worker' }), nowDone, nowDone, taskId);
        });
        recordGenerationEvent(database, {
          taskId,
          appId,
          eventType: 'succeeded',
          payload: { status: 'succeeded', count: persisted.length, source: 'windows-worker', confirmed: false },
        });

        try {
          await confirmWorkerTask(engineBaseUrl, secret, workerTaskId, outputs.map((output) => String(output.outputId)), fetcher);
          recordGenerationEvent(database, {
            taskId,
            appId,
            eventType: 'worker_confirmed',
            payload: { status: 'confirmed', source: 'windows-worker' },
          });
        } catch (error) {
          const safeMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 300);
          recordGenerationEvent(database, {
            taskId,
            appId,
            eventType: 'worker_confirm_failed',
            payload: { errorCode: 'worker_confirm_failed', errorMessage: safeMessage },
          });
        }
        break;
      }
    } catch {
      // The Worker may be restarting or briefly unavailable. Keep the task single-submission and continue polling.
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (generationExecutionsStopped(database)) return;
  const finalCheck = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
  if (finalCheck && ["submitting", "accepted", "running"].includes(finalCheck.status)) {
    const nowDone = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'abandoned', error_code = 'worker_poll_timeout', error_message = 'Windows Worker 轮询超时，上游可能仍在运行', progress_json = ?, upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(JSON.stringify({ value: null, stage: 'timeout', message: 'Windows Worker 轮询超时，上游可能仍在运行', source: 'windows-worker' }), nowDone, nowDone, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: 'abandoned',
      payload: { errorCode: 'worker_poll_timeout', errorMessage: 'Windows Worker 轮询超时，上游可能仍在运行' },
    });
  }

  setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
}

export async function pollAndCompleteTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  taskId: string,
  fetcher: typeof fetch = fetch,
  options?: { pollTimeoutMs?: number; pollIntervalMs?: number },
): Promise<void> {
  const taskRow = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  if (!taskRow) return;
  const appId = String(taskRow.app_id);
  const providerTaskId = taskRow.provider_task_id ? String(taskRow.provider_task_id) : null;
  if (!providerTaskId) return;

  const engineId = String(taskRow.engine_id);
  const engineRow = database.connection.prepare("SELECT * FROM generation_engines WHERE id = ?").get(engineId) as Record<string, unknown> | undefined;
  if (!engineRow) return;

  if (engineRow.kind === 'worker') {
    await pollAndCompleteWorkerTask(config, database, secrets, taskId, fetcher, options);
    return;
  }
  if (engineRow.kind !== 'comfyui') return;

  const engineBaseUrl = String(engineRow.base_url).replace(/\/+$/, "");
  const credentialAccount = engineRow.credential_account ? String(engineRow.credential_account) : null;
  let secret: string | null = null;
  if (credentialAccount) {
    try {
      const credential = await secrets.get(credentialAccount);
      secret = credential.value;
    } catch {}
  }

  const pollTimeoutMs = options?.pollTimeoutMs ?? 600_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 500;
  const pollDeadline = Date.now() + pollTimeoutMs;
  while (Date.now() < pollDeadline && !generationExecutionsStopped(database)) {
    const currentTask = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
    if (!currentTask || ["succeeded", "failed", "cancelled", "abandoned"].includes(currentTask.status)) return;

    try {
      const historyRes = await fetcher(`${engineBaseUrl}/history/${providerTaskId}`, {
        headers: generationEngineHeaders(database, engineRow, secret),
        signal: AbortSignal.timeout(15_000),
      });

      if (historyRes.status === 404) {
        const nowDone = nowIso();
        database.connection.prepare(
          "UPDATE generation_tasks SET status = 'abandoned', error_code = 'upstream_not_found', error_message = '上游未找到该任务历史记录', upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
        ).run(nowDone, nowDone, taskId);
        recordGenerationEvent(database, {
          taskId,
          appId,
          eventType: "abandoned",
          payload: { errorCode: "upstream_not_found", errorMessage: "上游未找到该任务历史记录" },
        });
        break;
      }

      if (!historyRes.ok && historyRes.status >= 400 && historyRes.status < 500) {
        const nowDone = nowIso();
        const safeMsg = `上游返回客户端错误 (HTTP ${historyRes.status})`;
        database.connection.prepare(
          "UPDATE generation_tasks SET status = 'failed', error_code = 'upstream_client_error', error_message = ?, updated_at = ?, finished_at = ? WHERE id = ?",
        ).run(safeMsg, nowDone, nowDone, taskId);
        recordGenerationEvent(database, {
          taskId,
          appId,
          eventType: "failed",
          payload: { errorCode: "upstream_client_error", errorMessage: safeMsg },
        });
        break;
      }

      if (historyRes.ok) {
        const historyData = await historyRes.json().catch(() => ({})) as Record<string, unknown>;
          const taskHistory = historyData[providerTaskId] as {
            status?: { status_str?: string; messages?: unknown[] };
            outputs?: Record<string, {
              images?: Array<{ filename?: string; subfolder?: string; type?: string; content_type?: string }>;
              videos?: Array<{ filename?: string; subfolder?: string; type?: string; content_type?: string }>;
              audio?: Array<{ filename?: string; subfolder?: string; type?: string; content_type?: string }>;
              files?: Array<{ filename?: string; subfolder?: string; type?: string; content_type?: string }>;
            }>;
        } | undefined;

        if (taskHistory) {
          const statusObj = taskHistory.status;
          const isError = statusObj?.status_str === "error" || (Array.isArray(statusObj?.messages) && statusObj.messages.some((m) => Array.isArray(m) && m[0] === "execution_error"));

          if (isError) {
            const nowFailed = nowIso();
            let detail = "";
            if (Array.isArray(statusObj?.messages)) {
              const errItem = statusObj.messages.find((m) => Array.isArray(m) && m[0] === "execution_error");
              if (errItem && Array.isArray(errItem) && errItem[1] && typeof errItem[1] === "object") {
                detail = String((errItem[1] as Record<string, unknown>).exception_message ?? "");
              }
            }
            const safeErrMsg = sanitizeErrorMessage(detail || statusObj?.status_str || "执行错误").slice(0, 300);
            database.connection.prepare(
              "UPDATE generation_tasks SET status = 'failed', error_code = 'execution_error', error_message = ?, progress_json = ?, updated_at = ?, finished_at = ? WHERE id = ?",
            ).run(safeErrMsg, JSON.stringify({ value: null, stage: 'error', message: safeErrMsg, source: 'comfyui' }), nowFailed, nowFailed, taskId);
            recordGenerationEvent(database, {
              taskId,
              appId,
              eventType: "failed",
              payload: { errorCode: "execution_error", errorMessage: safeErrMsg },
            });
            break;
          }

          const outputs = taskHistory.outputs || {};
          const outputDeclarationRow = database.connection.prepare(
            'SELECT output_declarations_json FROM generation_workflow_versions WHERE workflow_id = ? AND version = ?',
          ).get(String(taskRow.workflow_id), Number(taskRow.workflow_version)) as { output_declarations_json: string } | undefined;
          let declaredOutputs: Set<string> | null = null;
          if (outputDeclarationRow) {
            try {
              const declarations = JSON.parse(outputDeclarationRow.output_declarations_json) as unknown;
              if (Array.isArray(declarations) && declarations.length > 0) declaredOutputs = new Set(declarations.filter((item): item is string => typeof item === 'string'));
            } catch {
              declaredOutputs = null;
            }
          }
          const allMedia: Array<{ filename: string; subfolder: string; type: string; outputName: string; contentType: string }> = [];
          const safeRelativePart = (value: string, allowNested: boolean) => {
            if (!value) return allowNested;
            if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
            if (!allowNested && value.includes('/')) return false;
            return value.split('/').every((part) => part && part !== '.' && part !== '..');
          };
          for (const [outputName, output] of Object.entries(outputs)) {
            if (declaredOutputs && !declaredOutputs.has(outputName)) continue;
            const fields: Array<{ key: 'images' | 'videos' | 'audio' | 'files'; fallbackType: string }> = [
              { key: 'images', fallbackType: 'image/png' },
              { key: 'videos', fallbackType: 'video/mp4' },
              { key: 'audio', fallbackType: 'audio/wav' },
              { key: 'files', fallbackType: 'application/octet-stream' },
            ];
            for (const field of fields) {
              const entries = Array.isArray(output?.[field.key]) ? output[field.key] as unknown[] : [];
              for (const rawItem of entries) {
                const item = typeof rawItem === 'string' ? { filename: rawItem } : rawItem && typeof rawItem === 'object' ? rawItem as Record<string, unknown> : null;
                const filename = typeof item?.filename === 'string' ? item.filename : '';
                const subfolder = typeof item?.subfolder === 'string' ? item.subfolder.replaceAll('\\', '/') : '';
                const type = typeof item?.type === 'string' && ['output', 'input', 'temp'].includes(item.type) ? item.type : 'output';
                if (!safeRelativePart(filename, false) || !safeRelativePart(subfolder, true)) continue;
                const suppliedType = typeof item?.content_type === 'string' && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(item.content_type)
                  ? item.content_type.toLowerCase()
                  : field.fallbackType;
                allMedia.push({ filename, subfolder, type, outputName, contentType: suppliedType });
              }
            }
          }

          if (allMedia.length > 0) {
            let downloadFailed = false;
            let downloadErrMsg = "";
            const persistedArtifactIds: Array<{ artifactId: string; outputName: string; sortOrder: number }> = [];

            for (let i = 0; i < allMedia.length; i++) {
              const media = allMedia[i];
              const qParam = new URLSearchParams({ filename: media.filename, subfolder: media.subfolder, type: media.type });
              const srcUrl = `${engineBaseUrl}/view?${qParam}`;
              try {
                const artId = await persistArtifact(
                  config,
                  database,
                  {
                    appId,
                    taskId,
                    sourceUrl: srcUrl,
                    trustedBaseUrl: engineBaseUrl,
                    requestHeaders: generationEngineHeaders(database, engineRow, secret),
                    contentType: media.contentType,
                    refType: String(taskRow.purpose) === 'legacy-image' ? 'image-task-output' : 'generation-output',
                    refId: taskId,
                    metadata: {
                      source: 'comfyui',
                      providerTaskId,
                      outputName: media.outputName,
                      contentType: media.contentType,
                    },
                  },
                  fetcher,
                );
                persistedArtifactIds.push({ artifactId: artId, outputName: media.outputName, sortOrder: i });
              } catch (dlErr) {
                downloadFailed = true;
                downloadErrMsg = dlErr instanceof Error ? dlErr.message : String(dlErr);
                break;
              }
            }

            const nowDone = nowIso();
            if (downloadFailed) {
              const safeMsg = sanitizeErrorMessage(downloadErrMsg).slice(0, 300);
              database.connection.prepare(
                "UPDATE generation_tasks SET status = 'failed', error_code = 'artifact_download_failed', error_message = ?, updated_at = ?, finished_at = ? WHERE id = ?",
              ).run(`产物下载失败：${safeMsg}`, nowDone, nowDone, taskId);
              recordGenerationEvent(database, {
                taskId,
                appId,
                eventType: "failed",
                payload: { errorCode: "artifact_download_failed", errorMessage: `产物下载失败：${safeMsg}` },
              });
            } else {
              database.transaction(() => {
                for (const p of persistedArtifactIds) {
                  database.connection.prepare(`
                    INSERT INTO generation_task_artifacts (task_id, artifact_id, output_name, sort_order, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(task_id, artifact_id) DO NOTHING
                  `).run(taskId, p.artifactId, p.outputName, p.sortOrder, nowDone);
                }
                database.connection.prepare(
                  "UPDATE generation_tasks SET status = 'succeeded', error_code = NULL, error_message = NULL, progress_json = ?, updated_at = ?, finished_at = ? WHERE id = ?",
                ).run(JSON.stringify({ value: 1, stage: 'completed', current: 1, total: 1, source: 'comfyui' }), nowDone, nowDone, taskId);
              });

              recordGenerationEvent(database, {
                taskId,
                appId,
                eventType: "succeeded",
                payload: { status: "succeeded", count: persistedArtifactIds.length },
              });
            }
            break;
          }
        }
      }

      // Check queue status
      const queueRes = await fetcher(`${engineBaseUrl}/queue`, {
        headers: generationEngineHeaders(database, engineRow, secret),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null);
      if (queueRes && queueRes.ok) {
        const qData = await queueRes.json().catch(() => ({})) as { queue_running?: unknown[] };
        const runningSet = new Set(Array.isArray(qData.queue_running) ? qData.queue_running.map((item) => Array.isArray(item) ? String(item[1] ?? "") : "").filter(Boolean) : []);
        if (runningSet.has(providerTaskId) && currentTask.status !== "running") {
          const nowRunning = nowIso();
          database.connection.prepare("UPDATE generation_tasks SET status = 'running', started_at = COALESCE(started_at, ?), progress_json = ?, updated_at = ? WHERE id = ?").run(nowRunning, JSON.stringify({ value: null, stage: 'running', source: 'comfyui' }), nowRunning, taskId);
          recordGenerationEvent(database, {
            taskId,
            appId,
            eventType: "running",
            payload: { status: "running" },
          });
        }
      }
    } catch {
      // transient poll failure
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  if (generationExecutionsStopped(database)) return;
  const finalCheck = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
  if (finalCheck && ["submitting", "accepted", "running"].includes(finalCheck.status)) {
    const nowDone = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'abandoned', error_code = 'poll_timeout', error_message = '任务轮询超时，上游可能仍在运行', upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(nowDone, nowDone, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: "abandoned",
      payload: { errorCode: "poll_timeout", errorMessage: "任务轮询超时，上游可能仍在运行" },
    });
  }

  setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
}

export async function processTaskExecution(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  taskId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (generationExecutionsStopped(database)) return;
  try {
    const taskRow = database.connection.prepare("SELECT status, provider_task_id FROM generation_tasks WHERE id = ?").get(taskId) as { status: string; provider_task_id: string | null } | undefined;
    if (!taskRow) return;

    if (taskRow.status === "queued") {
      await executeQueuedTask(config, database, secrets, taskId, fetcher);
    } else if (["accepted", "running"].includes(taskRow.status) || (taskRow.status === "submitting" && taskRow.provider_task_id)) {
      await pollAndCompleteTask(config, database, secrets, taskId, fetcher);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("database is not open")) return;
    throw err;
  }
}

export async function cancelGenerationTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  taskId: string,
  appId: string,
  fetcher: typeof fetch = fetch,
): Promise<GenerationTaskDescriptor> {
  const task = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ? AND app_id = ?").get(taskId, appId) as Record<string, unknown> | undefined;
  if (!task) {
    const err = new Error("not_found");
    (err as { code?: string }).code = "not_found";
    throw err;
  }

  const status = String(task.status);
  if (["succeeded", "failed", "cancelled", "abandoned"].includes(status)) {
    const err = new Error("not_cancellable");
    (err as { code?: string }).code = "not_cancellable";
    throw err;
  }

  const now = nowIso();
  if (status === "queued") {
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'cancelled', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(now, now, taskId);
    recordGenerationEvent(database, { taskId, appId, eventType: "cancelled", payload: { status: "cancelled" } });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return getGenerationTask(database, taskId, appId)!;
  }

  const engine = database.connection.prepare("SELECT * FROM generation_engines WHERE id = ?").get(String(task.engine_id)) as Record<string, unknown> | undefined;
  const providerTaskId = task.provider_task_id ? String(task.provider_task_id) : null;

  if (engine?.kind === 'worker') {
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'abandoned', error_code = 'worker_cancel_not_supported', error_message = 'Windows Worker 任务已停止本地跟踪；远端任务可能仍在运行', upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(now, now, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: 'abandoned',
      payload: { errorCode: 'worker_cancel_not_supported', errorMessage: 'Windows Worker 任务已停止本地跟踪；远端任务可能仍在运行', scope: 'local-tracking' },
    });
    setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
    return getGenerationTask(database, taskId, appId)!;
  }

  if (engine && providerTaskId) {
    const engineBaseUrl = String(engine.base_url).replace(/\/+$/, "");
    const credentialAccount = engine.credential_account ? String(engine.credential_account) : null;
    let secret: string | null = null;
    if (credentialAccount) {
      try {
        const credential = await secrets.get(credentialAccount);
        secret = credential.value;
      } catch {}
    }

    try {
      const qRes = await fetcher(`${engineBaseUrl}/queue`, {
        headers: generationEngineHeaders(database, engine, secret),
        signal: AbortSignal.timeout(5_000),
      });
      if (qRes.ok) {
        const qData = await qRes.json().catch(() => ({})) as { queue_pending?: unknown[]; queue_running?: unknown[] };
        const pendingSet = new Set(Array.isArray(qData.queue_pending) ? qData.queue_pending.map((item) => Array.isArray(item) ? String(item[1] ?? "") : "").filter(Boolean) : []);
        const runningSet = new Set(Array.isArray(qData.queue_running) ? qData.queue_running.map((item) => Array.isArray(item) ? String(item[1] ?? "") : "").filter(Boolean) : []);

        if (pendingSet.has(providerTaskId)) {
          let deleteSuccess = false;
          try {
            const delRes = await fetcher(`${engineBaseUrl}/queue`, {
              method: "POST",
              headers: generationEngineHeaders(database, engine, secret, true),
              body: JSON.stringify({ delete: [providerTaskId] }),
              signal: AbortSignal.timeout(10_000),
            });
            if (delRes.ok) {
              deleteSuccess = true;
            }
          } catch {}

          if (deleteSuccess) {
            database.connection.prepare(
              "UPDATE generation_tasks SET status = 'cancelled', upstream_may_continue = 0, cancellation_scope = 'queued', updated_at = ?, finished_at = ? WHERE id = ?",
            ).run(now, now, taskId);
            recordGenerationEvent(database, { taskId, appId, eventType: "cancelled", payload: { status: "cancelled", scope: "queued" } });
            setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
            return getGenerationTask(database, taskId, appId)!;
          } else {
            database.connection.prepare(
              "UPDATE generation_tasks SET status = 'abandoned', error_code = 'cancellation_upstream_failed', error_message = '上游队列项删除失败', upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
            ).run(now, now, taskId);
            recordGenerationEvent(database, { taskId, appId, eventType: "abandoned", payload: { errorCode: "cancellation_upstream_failed", errorMessage: "上游队列项删除失败", scope: "local-tracking" } });
            setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
            return getGenerationTask(database, taskId, appId)!;
          }
        }

        if (runningSet.has(providerTaskId)) {
          database.connection.prepare(
            "UPDATE generation_tasks SET status = 'abandoned', upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(now, now, taskId);
          recordGenerationEvent(database, { taskId, appId, eventType: "abandoned", payload: { status: "abandoned", scope: "local-tracking" } });
          setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
          return getGenerationTask(database, taskId, appId)!;
        }
      }
    } catch {
      // queue unreachable
    }
  }

  database.connection.prepare(
    "UPDATE generation_tasks SET status = 'abandoned', upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
  ).run(now, now, taskId);
  recordGenerationEvent(database, { taskId, appId, eventType: "abandoned", payload: { status: "abandoned", scope: "local-tracking" } });
  setImmediate(() => void scheduleQueuedTasks(config, database, secrets, fetcher));
  return getGenerationTask(database, taskId, appId)!;
}

export async function retryGenerationTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  taskId: string,
  appId: string,
  newIdempotencyKey?: string | null,
  fetcher: typeof fetch = fetch,
): Promise<GenerationTaskDescriptor> {
  const original = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ? AND app_id = ?").get(taskId, appId) as Record<string, unknown> | undefined;
  if (!original) {
    const err = new Error("not_found");
    (err as { code?: string }).code = "not_found";
    throw err;
  }

  const originalStatus = String(original.status);
  if (!["failed", "abandoned", "cancelled"].includes(originalStatus)) {
    const err = new Error("只有处于失败、已放弃或已取消终态的任务才可重试。");
    (err as { code?: string }).code = "not_retryable";
    throw err;
  }

  const parsedRequest = parseGenerationRequestParams(original.request_params_json ?? '{}');
  return createGenerationTask(
    config,
    database,
    secrets,
    {
      appId,
      idempotencyKey: newIdempotencyKey,
      purpose: String(original.purpose),
      workflowId: String(original.workflow_id),
      workflowVersion: Number(original.workflow_version),
      inputs: parsedRequest.inputs,
      inputArtifacts: parsedRequest.inputArtifacts,
      seed: original.actual_seed != null ? Number(original.actual_seed) : null,
      retryOf: taskId,
      isInternal: true,
      priority: original.priority === 'interactive' || original.priority === 'background' ? original.priority : 'normal',
    },
    fetcher,
  );
}

export async function scheduleQueuedTasks(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  try {
  const queuedTasks = database.connection.prepare(
    "SELECT id FROM generation_tasks WHERE status = 'queued' ORDER BY CASE priority WHEN 'interactive' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at ASC",
  ).all() as Array<{ id: string }>;

  for (const row of queuedTasks) {
    const p = (async () => {
      await processTaskExecution(config, database, secrets, row.id, fetcher);
    })()
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("database is not open") && !msg.includes("closed")) {
          console.error(`[generation] scheduled task ${row.id} error:`, err);
        }
      })
      .finally(() => activeGenerationExecutions.delete(p));
    activeGenerationExecutions.add(p);
  }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("database is not open") || msg.includes("closed")) return;
    throw err;
  }
}

export function cleanupGenerationEvents(
  database: ServiceDatabase,
  options?: { maxRetentionDays?: number; maxEvents?: number },
): { deletedCount: number } {
  try {
  const maxDays = options?.maxRetentionDays ?? 7;
  const maxEvents = options?.maxEvents ?? 10_000;

  let totalDeleted = 0;
  database.transaction(() => {
    const res1 = database.connection.prepare(`
      DELETE FROM generation_events
      WHERE created_at < datetime('now', '-' || ? || ' days')
      AND task_id IN (
        SELECT id FROM generation_tasks WHERE status IN ('succeeded', 'failed', 'cancelled', 'abandoned')
      )
    `).run(maxDays);
    totalDeleted += Number(res1.changes || 0);

    const res2 = database.connection.prepare(`
      DELETE FROM generation_events
      WHERE id NOT IN (
        SELECT id FROM generation_events ORDER BY id DESC LIMIT ?
      )
      AND task_id IN (
        SELECT id FROM generation_tasks WHERE status IN ('succeeded', 'failed', 'cancelled', 'abandoned')
      )
    `).run(maxEvents);
    totalDeleted += Number(res2.changes || 0);
  });

  return { deletedCount: totalDeleted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("database is not open") || msg.includes("closed")) return { deletedCount: 0 };
    throw err;
  }
}

export function startGenerationScheduler(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  intervalMs = 2000,
  fetcher: typeof fetch = fetch,
): { stop: () => void } {
  const timer = setInterval(() => {
    void scheduleQueuedTasks(config, database, secrets, fetcher).catch(() => {});
    try {
      cleanupGenerationEvents(database);
    } catch {}
  }, intervalMs);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
  };
}

export async function reconcileGenerationTasks(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  fetcher: typeof fetch = fetch,
): Promise<{ recoveredCount: number }> {
  const openTasks = database.connection.prepare(
    "SELECT * FROM generation_tasks WHERE status IN ('queued', 'submitting', 'accepted', 'running')",
  ).all() as Array<Record<string, unknown>>;

  let recoveredCount = 0;
  for (const task of openTasks) {
    const taskId = String(task.id);
    const appId = String(task.app_id);
    const status = String(task.status);

    if (status === "queued") {
      const p = (async () => {
        await processTaskExecution(config, database, secrets, taskId, fetcher);
      })()
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("database is not open")) {
            console.error(`[generation] reconcile queued task ${taskId} error:`, err);
          }
        })
        .finally(() => activeGenerationExecutions.delete(p));
      activeGenerationExecutions.add(p);
      recoveredCount++;
    } else if (status === "submitting" && !task.provider_task_id) {
      const now = nowIso();
      database.connection.prepare(
        "UPDATE generation_tasks SET status = 'abandoned', error_code = 'submission_outcome_unknown', error_message = '服务重启导致提交中断，状态未知，禁止自动重试', updated_at = ?, finished_at = ? WHERE id = ?",
      ).run(now, now, taskId);
      recordGenerationEvent(database, {
        taskId,
        appId,
        eventType: "abandoned",
        payload: { errorCode: "submission_outcome_unknown", errorMessage: "服务重启导致提交中断，状态未知，禁止自动重试" },
      });
      recoveredCount++;
    } else if (task.provider_task_id) {
      const p = (async () => {
        await pollAndCompleteTask(config, database, secrets, taskId, fetcher);
      })()
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("database is not open")) {
            console.error(`[generation] reconcile poll task ${taskId} error:`, err);
          }
        })
        .finally(() => activeGenerationExecutions.delete(p));
      activeGenerationExecutions.add(p);
      recoveredCount++;
    }
  }
  return { recoveredCount };
}
