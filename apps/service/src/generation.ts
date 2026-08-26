import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  GenerationEvent,
  GenerationTaskDescriptor,
} from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { persistArtifact } from './artifacts.js';
import type { SecretStore } from './security.js';

export const generationEventBus = new EventEmitter();
export const activeGenerationExecutions = new Set<Promise<void>>();

export function sanitizeErrorMessage(input: string): string {
  return input
    .replace(/(authorization|api[-_ ]?key|token|secret|password)(["'\s:=]+)([^\s,"'}]+)/gi, '$1$2[REDACTED]')
    .replace(/\b(?:sk|sth|Bearer)[-_][A-Za-z0-9._-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/([?&](?:key|token|secret|signature)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\/\/[^:]+:[^@]+@/g, '//[REDACTED_AUTH]@')
    .replace(/(?:[A-Za-z]:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+)/g, '[USER_HOME]');
}

export function validateComfyApiJson(definition: unknown): Record<string, unknown> {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error('invalid_workflow_format');
  }
  const raw = definition as Record<string, unknown>;
  if (Array.isArray(raw.nodes) || 'last_node_id' in raw || Array.isArray(raw.links)) {
    const err = new Error('工作流必须为 ComfyUI API 格式 JSON（不得使用 UI 导出的含 nodes 数组的 GUI 格式）。');
    (err as { code?: string }).code = 'invalid_workflow_format_gui_rejected';
    throw err;
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    throw new Error('empty_workflow_definition');
  }
  for (const key of keys) {
    const node = raw[key];
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('invalid_node_structure');
    }
    const n = node as Record<string, unknown>;
    if (typeof n.class_type !== 'string' || !n.class_type.trim()) {
      throw new Error('missing_node_class_type');
    }
    if (!n.inputs || typeof n.inputs !== 'object' || Array.isArray(n.inputs)) {
      throw new Error('missing_node_inputs');
    }
  }
  return raw;
}

export function validateWorkflowVersionStructure(
  definition: unknown,
  inputSchema: unknown,
  nodeBindings: unknown,
  outputDeclarations: unknown,
): {
  validatedDefinition: Record<string, unknown>;
  validatedInputSchema: Record<string, unknown>;
  validatedNodeBindings: Record<string, string[]>;
  validatedOutputDeclarations: string[];
} {
  const validatedDefinition = validateComfyApiJson(definition);

  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    const err = new Error('输入结构 inputSchema 必须为合法的 JSON 对象。');
    (err as { code?: string }).code = 'invalid_input_schema';
    throw err;
  }

  if (!nodeBindings || typeof nodeBindings !== 'object' || Array.isArray(nodeBindings)) {
    const err = new Error('节点绑定 nodeBindings 必须为合法的 JSON 对象。');
    (err as { code?: string }).code = 'invalid_node_bindings';
    throw err;
  }

  const validatedNodeBindings: Record<string, string[]> = {};
  for (const [key, pathSegments] of Object.entries(nodeBindings)) {
    if (!Array.isArray(pathSegments) || pathSegments.length !== 3 || pathSegments[1] !== 'inputs' || typeof pathSegments[0] !== 'string' || typeof pathSegments[2] !== 'string') {
      const err = new Error(`节点绑定 "${key}" 的目标路径必须为 [nodeId, "inputs", paramName] 格式。`);
      (err as { code?: string }).code = 'invalid_node_binding_path';
      throw err;
    }
    const [nodeId, , paramName] = pathSegments;
    const targetNode = validatedDefinition[nodeId];
    if (!targetNode || typeof targetNode !== 'object' || Array.isArray(targetNode)) {
      const err = new Error(`节点绑定 "${key}" 引用的节点 ID "${nodeId}" 在工作流定义中不存在。`);
      (err as { code?: string }).code = 'binding_node_not_found';
      throw err;
    }
    const inputsObj = (targetNode as Record<string, unknown>).inputs;
    if (!inputsObj || typeof inputsObj !== 'object' || Array.isArray(inputsObj)) {
      const err = new Error(`节点绑定 "${key}" 引用的节点 "${nodeId}" 缺少有效的 inputs 属性。`);
      (err as { code?: string }).code = 'binding_node_inputs_invalid';
      throw err;
    }
    validatedNodeBindings[key] = [nodeId, 'inputs', paramName];
  }

  if (!Array.isArray(outputDeclarations) || outputDeclarations.length === 0) {
    const err = new Error('输出声明 outputDeclarations 必须为非空数组。');
    (err as { code?: string }).code = 'output_declarations_required';
    throw err;
  }

  const validatedOutputDeclarations: string[] = [];
  for (const outId of outputDeclarations) {
    if (typeof outId !== 'string' || !outId.trim()) {
      const err = new Error('输出声明中的节点 ID 必须为有效字符串。');
      (err as { code?: string }).code = 'invalid_output_declaration';
      throw err;
    }
    const trimmed = outId.trim();
    if (!validatedDefinition[trimmed]) {
      const err = new Error(`输出声明引用的节点 ID "${trimmed}" 在工作流定义中不存在。`);
      (err as { code?: string }).code = 'output_node_not_found';
      throw err;
    }
    validatedOutputDeclarations.push(trimmed);
  }

  return {
    validatedDefinition,
    validatedInputSchema: inputSchema as Record<string, unknown>,
    validatedNodeBindings,
    validatedOutputDeclarations,
  };
}

export function renderWorkflowSnapshot(
  definition: Record<string, unknown>,
  nodeBindings: Record<string, string[]>,
  inputs: Record<string, unknown>,
  actualSeed?: number | null,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(definition)) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

  for (const [inputKey, pathSegments] of Object.entries(nodeBindings)) {
    if (inputs[inputKey] === undefined) continue;
    const value = inputs[inputKey];
    if (pathSegments.length === 3) {
      const [nodeId, category, paramName] = pathSegments;
      if (cloned[nodeId] && category === 'inputs' && cloned[nodeId].inputs) {
        cloned[nodeId].inputs[paramName] = value;
      }
    }
  }

  if (actualSeed !== undefined && actualSeed !== null) {
    for (const key of Object.keys(cloned)) {
      const node = cloned[key];
      if (node && node.inputs && 'seed' in node.inputs) {
        node.inputs.seed = actualSeed;
      }
      if (node && node.inputs && 'noise_seed' in node.inputs) {
        node.inputs.noise_seed = actualSeed;
      }
    }
  }

  return cloned;
}

export function computeRequestHash(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function recordGenerationEvent(
  database: ServiceDatabase,
  input: { taskId: string; appId: string; eventType: string; payload: Record<string, unknown> },
): GenerationEvent {
  const now = nowIso();
  const result = database.connection.prepare(
    'INSERT INTO generation_events(task_id, app_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(input.taskId, input.appId, input.eventType, JSON.stringify(input.payload), now);

  const event: GenerationEvent = {
    id: Number(result.lastInsertRowid),
    taskId: input.taskId,
    appId: input.appId,
    eventType: input.eventType,
    payload: input.payload,
    createdAt: now,
  };

  generationEventBus.emit(`event:${input.appId}`, event);
  return event;
}

export function subscribeGenerationEvents(
  database: ServiceDatabase,
  appId: string,
  listener: (event: GenerationEvent) => void,
  afterId?: number | null,
): () => void {
  const seenIds = new Set<number>();
  const handler = (event: GenerationEvent) => {
    if (!seenIds.has(event.id)) {
      seenIds.add(event.id);
      listener(event);
    }
  };
  generationEventBus.on(`event:${appId}`, handler);

  if (afterId != null && Number.isFinite(afterId)) {
    const rows = database.connection.prepare(
      'SELECT * FROM generation_events WHERE app_id = ? AND id > ? ORDER BY id ASC',
    ).all(appId, afterId) as Array<{ id: number; task_id: string; app_id: string; event_type: string; payload_json: string; created_at: string }>;
    for (const row of rows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        listener({
          id: row.id,
          taskId: row.task_id,
          appId: row.app_id,
          eventType: row.event_type,
          payload: JSON.parse(row.payload_json),
          createdAt: row.created_at,
        });
      }
    }
  }

  return () => {
    generationEventBus.off(`event:${appId}`, handler);
  };
}

export interface CreateTaskOptions {
  appId: string;
  idempotencyKey?: string | null;
  purpose?: string | null;
  workflowId?: string | null;
  workflowVersion?: number | null;
  inputs?: Record<string, unknown>;
  seed?: number | null;
  retryOf?: string | null;
  isInternal?: boolean;
}

export function resolveWorkflowAndEngine(
  database: ServiceDatabase,
  appId: string,
  options: { purpose?: string | null; workflowId?: string | null; workflowVersion?: number | null; isInternal?: boolean },
) {
  if (!options.isInternal) {
    if (options.workflowId || options.workflowVersion != null) {
      const err = new Error('工作流由管理控制台统一分配，客户端不可直接指定 workflowId 或 workflowVersion。');
      (err as { code?: string }).code = 'workflow_assignment_managed';
      throw err;
    }
  }

  const purpose = options.purpose?.trim() || 'default';
  let workflowId: string;
  let version: number;
  let engineId: string;

  if (options.isInternal && options.workflowId) {
    workflowId = options.workflowId;
    const wf = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?').get(workflowId) as { id: string; name: string; engine_kind: string; latest_version: number } | undefined;
    if (!wf) {
      const err = new Error(`未找到指定的工作流 ${workflowId}。`);
      (err as { code?: string }).code = 'workflow_not_found';
      throw err;
    }
    version = options.workflowVersion ?? wf.latest_version;
    const ver = database.connection.prepare(
      'SELECT engine_id FROM generation_workflow_versions WHERE workflow_id = ? AND version = ? AND is_published = 1',
    ).get(workflowId, version) as { engine_id: string | null } | undefined;
    if (!ver) {
      const err = new Error(`未找到工作流 ${workflowId} 的已发布版本 v${version}。`);
      (err as { code?: string }).code = 'workflow_version_not_found';
      throw err;
    }
    engineId = ver.engine_id || (database.connection.prepare("SELECT id FROM generation_engines WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined)?.id || '';
  } else {
    const assignment = database.connection.prepare(
      'SELECT * FROM app_generation_assignments WHERE app_id = ? AND purpose = ?',
    ).get(appId, purpose) as { workflow_id: string; workflow_version: number; engine_id: string } | undefined;
    if (!assignment) {
      const err = new Error(`未为应用 ${appId} 配置用途 ${purpose} 的生成工作流绑定。`);
      (err as { code?: string }).code = 'generation_assignment_not_found';
      throw err;
    }
    workflowId = assignment.workflow_id;
    version = assignment.workflow_version;
    engineId = assignment.engine_id;
  }

  const wf = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?').get(workflowId) as { id: string; name: string; engine_kind: string; latest_version: number } | undefined;
  if (!wf) {
    const err = new Error(`未找到指定的工作流 ${workflowId}。`);
    (err as { code?: string }).code = 'workflow_not_found';
    throw err;
  }

  const ver = database.connection.prepare(
    'SELECT * FROM generation_workflow_versions WHERE workflow_id = ? AND version = ? AND is_published = 1',
  ).get(workflowId, version) as Record<string, unknown> | undefined;
  if (!ver) {
    const err = new Error(`未找到工作流 ${workflowId} 的已发布版本 v${version}。`);
    (err as { code?: string }).code = 'workflow_version_not_found';
    throw err;
  }

  if (!engineId) {
    const err = new Error('未配置可用的生成引擎。');
    (err as { code?: string }).code = 'generation_engine_unavailable';
    throw err;
  }

  const engine = database.connection.prepare('SELECT * FROM generation_engines WHERE id = ? AND enabled = 1').get(engineId) as Record<string, unknown> | undefined;
  if (!engine) {
    const err = new Error(`生成引擎 ${engineId} 处于禁用或不存在状态。`);
    (err as { code?: string }).code = 'generation_engine_unavailable';
    throw err;
  }

  return {
    workflow: {
      id: wf.id,
      name: wf.name,
      engineKind: wf.engine_kind,
      version,
      inputSchema: JSON.parse(String(ver.input_schema_json ?? '{}')) as Record<string, unknown>,
      nodeBindings: JSON.parse(String(ver.node_bindings_json ?? '{}')) as Record<string, string[]>,
      outputDeclarations: JSON.parse(String(ver.output_declarations_json ?? '[]')) as string[],
      definition: JSON.parse(String(ver.definition_json)) as Record<string, unknown>,
    },
    engine: {
      id: String(engine.id),
      name: String(engine.name),
      kind: String(engine.kind),
      baseUrl: String(engine.base_url).replace(/\/+$/, ''),
      credentialAccount: engine.credential_account ? String(engine.credential_account) : null,
      concurrencyLimit: Number(engine.concurrency_limit || 1),
    },
  };
}

export function getGenerationTask(
  database: ServiceDatabase,
  taskId: string,
  requestingAppId?: string,
): GenerationTaskDescriptor | null {
  const task = database.connection.prepare('SELECT * FROM generation_tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!task) return null;
  if (requestingAppId && task.app_id !== requestingAppId) return null;

  const artifacts = database.connection.prepare(`
    SELECT ta.output_name, ta.sort_order, a.id as artifact_id, a.content_type, a.byte_size, a.sha256
    FROM generation_task_artifacts ta
    JOIN artifacts a ON a.id = ta.artifact_id
    WHERE ta.task_id = ?
    ORDER BY ta.sort_order ASC
  `).all(taskId) as Array<{ output_name: string; sort_order: number; artifact_id: string; content_type: string | null; byte_size: number; sha256: string | null }>;

  return {
    id: String(task.id),
    appId: String(task.app_id),
    engineId: String(task.engine_id),
    workflowId: String(task.workflow_id),
    workflowVersion: Number(task.workflow_version),
    purpose: String(task.purpose || 'default'),
    idempotencyKey: task.idempotency_key ? String(task.idempotency_key) : null,
    status: task.status as GenerationTaskDescriptor['status'],
    actualSeed: task.actual_seed != null ? Number(task.actual_seed) : null,
    providerTaskId: task.provider_task_id ? String(task.provider_task_id) : null,
    errorCode: task.error_code ? String(task.error_code) : null,
    errorMessage: task.error_message ? String(task.error_message) : null,
    upstreamMayContinue: Boolean(task.upstream_may_continue),
    cancellationScope: (task.cancellation_scope ?? 'none') as GenerationTaskDescriptor['cancellationScope'],
    retryOf: task.retry_of ? String(task.retry_of) : null,
    createdAt: String(task.created_at),
    updatedAt: String(task.updated_at),
    finishedAt: task.finished_at ? String(task.finished_at) : null,
    artifacts: artifacts.map((item) => ({
      artifactId: item.artifact_id,
      outputName: item.output_name,
      sortOrder: item.sort_order,
      url: `/api/v1/artifacts/${item.artifact_id}`,
      byteSize: Number(item.byte_size),
      contentType: item.content_type,
      sha256: item.sha256,
    })),
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
  const canonicalPayload = {
    purpose: options.purpose?.trim() || 'default',
    workflowId: options.workflowId?.trim() || null,
    workflowVersion: options.workflowVersion ?? null,
    inputs,
    seed: options.seed ?? null,
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
  const actualSeed = options.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const workflowSnapshot = renderWorkflowSnapshot(
    resolved.workflow.definition,
    resolved.workflow.nodeBindings,
    inputs,
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
        upstream_may_continue, cancellation_scope, retry_of, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, 0, 'none', ?, ?, ?)
    `).run(
      id,
      options.appId,
      resolved.engine.id,
      resolved.workflow.id,
      resolved.workflow.version,
      options.purpose?.trim() || 'default',
      options.idempotencyKey ?? null,
      requestHash,
      JSON.stringify(inputs),
      JSON.stringify(workflowSnapshot),
      actualSeed,
      options.retryOf ?? null,
      now,
      now,
    );
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
  const leaseOwner = randomUUID();
  const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const now = nowIso();

  // Atomic claim: only succeed if task is currently queued
  const claimResult = database.connection.prepare(`
    UPDATE generation_tasks
    SET status = 'submitting', lease_owner = ?, lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'queued'
  `).run(leaseOwner, leaseExpiresAt, now, taskId);

  if (claimResult.changes === 0) {
    return;
  }

  const taskRow = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  if (!taskRow) return;

  const appId = String(taskRow.app_id);
  recordGenerationEvent(database, { taskId, appId, eventType: "submitting", payload: { status: "submitting" } });

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
    return;
  }

  const engineBaseUrl = String(engineRow.base_url).replace(/\/+$/, "");
  const credentialAccount = engineRow.credential_account ? String(engineRow.credential_account) : null;
  const credential = credentialAccount ? await secrets.get(credentialAccount) : { value: null };
  const secret = credential.value;

  const workflowSnapshot = JSON.parse(String(taskRow.workflow_snapshot_json));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;

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
    return;
  }

  const nowAccepted = nowIso();
  database.connection.prepare(
    "UPDATE generation_tasks SET status = 'accepted', provider_task_id = ?, updated_at = ? WHERE id = ?",
  ).run(providerTaskId, nowAccepted, taskId);
  recordGenerationEvent(database, {
    taskId,
    appId,
    eventType: "accepted",
    payload: { status: "accepted", providerTaskId },
  });

  await pollAndCompleteTask(config, database, secrets, taskId, fetcher);
}

export async function pollAndCompleteTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  taskId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const taskRow = database.connection.prepare("SELECT * FROM generation_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  if (!taskRow) return;
  const appId = String(taskRow.app_id);
  const providerTaskId = taskRow.provider_task_id ? String(taskRow.provider_task_id) : null;
  if (!providerTaskId) return;

  const engineId = String(taskRow.engine_id);
  const engineRow = database.connection.prepare("SELECT * FROM generation_engines WHERE id = ?").get(engineId) as Record<string, unknown> | undefined;
  if (!engineRow) return;

  const engineBaseUrl = String(engineRow.base_url).replace(/\/+$/, "");
  const credentialAccount = engineRow.credential_account ? String(engineRow.credential_account) : null;
  const credential = credentialAccount ? await secrets.get(credentialAccount) : { value: null };
  const secret = credential.value;

  const pollDeadline = Date.now() + 600_000;
  while (Date.now() < pollDeadline) {
    const currentTask = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
    if (!currentTask || ["succeeded", "failed", "cancelled", "abandoned"].includes(currentTask.status)) return;

    try {
      const historyRes = await fetcher(`${engineBaseUrl}/history/${providerTaskId}`, {
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(15_000),
      });

      if (historyRes.ok) {
        const historyData = await historyRes.json().catch(() => ({})) as Record<string, unknown>;
        const taskHistory = historyData[providerTaskId] as {
          status?: { status_str?: string; messages?: unknown[] };
          outputs?: Record<string, { images?: Array<{ filename?: string; subfolder?: string; type?: string }> }>;
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
              "UPDATE generation_tasks SET status = 'failed', error_code = 'execution_error', error_message = ?, updated_at = ?, finished_at = ? WHERE id = ?",
            ).run(safeErrMsg, nowFailed, nowFailed, taskId);
            recordGenerationEvent(database, {
              taskId,
              appId,
              eventType: "failed",
              payload: { errorCode: "execution_error", errorMessage: safeErrMsg },
            });
            break;
          }

          const outputs = taskHistory.outputs || {};
          const allImages: Array<{ filename: string; subfolder: string; type: string; outputName: string }> = [];
          for (const [outputName, output] of Object.entries(outputs)) {
            if (Array.isArray(output.images)) {
              for (const img of output.images) {
                if (img.filename) {
                  allImages.push({
                    filename: img.filename,
                    subfolder: img.subfolder || "",
                    type: img.type || "output",
                    outputName,
                  });
                }
              }
            }
          }

          if (allImages.length > 0) {
            let downloadFailed = false;
            let downloadErrMsg = "";
            const persistedArtifactIds: Array<{ artifactId: string; outputName: string; sortOrder: number }> = [];

            for (let i = 0; i < allImages.length; i++) {
              const img = allImages[i];
              const qParam = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
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
                    contentType: "image/png",
                  },
                  fetcher,
                );
                persistedArtifactIds.push({ artifactId: artId, outputName: img.outputName, sortOrder: i });
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
                  "UPDATE generation_tasks SET status = 'succeeded', error_code = NULL, error_message = NULL, updated_at = ?, finished_at = ? WHERE id = ?",
                ).run(nowDone, nowDone, taskId);
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
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null);
      if (queueRes && queueRes.ok) {
        const qData = await queueRes.json().catch(() => ({})) as { queue_running?: unknown[] };
        const runningSet = new Set(Array.isArray(qData.queue_running) ? qData.queue_running.map((item) => Array.isArray(item) ? String(item[1] ?? "") : "").filter(Boolean) : []);
        if (runningSet.has(providerTaskId) && currentTask.status !== "running") {
          const nowRunning = nowIso();
          database.connection.prepare("UPDATE generation_tasks SET status = 'running', updated_at = ? WHERE id = ?").run(nowRunning, taskId);
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

    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function processTaskExecution(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  taskId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
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
    return getGenerationTask(database, taskId, appId)!;
  }

  const engine = database.connection.prepare("SELECT * FROM generation_engines WHERE id = ?").get(String(task.engine_id)) as Record<string, unknown> | undefined;
  const providerTaskId = task.provider_task_id ? String(task.provider_task_id) : null;

  if (engine && providerTaskId) {
    const engineBaseUrl = String(engine.base_url).replace(/\/+$/, "");
    const credentialAccount = engine.credential_account ? String(engine.credential_account) : null;
    const credential = credentialAccount ? await secrets.get(credentialAccount) : { value: null };
    const secret = credential.value;

    try {
      const qRes = await fetcher(`${engineBaseUrl}/queue`, {
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      if (qRes.ok) {
        const qData = await qRes.json().catch(() => ({})) as { queue_pending?: unknown[]; queue_running?: unknown[] };
        const pendingSet = new Set(Array.isArray(qData.queue_pending) ? qData.queue_pending.map((item) => Array.isArray(item) ? String(item[1] ?? "") : "").filter(Boolean) : []);
        const runningSet = new Set(Array.isArray(qData.queue_running) ? qData.queue_running.map((item) => Array.isArray(item) ? String(item[1] ?? "") : "").filter(Boolean) : []);

        if (pendingSet.has(providerTaskId)) {
          await fetcher(`${engineBaseUrl}/queue`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
            body: JSON.stringify({ delete: [providerTaskId] }),
            signal: AbortSignal.timeout(10_000),
          });
          database.connection.prepare(
            "UPDATE generation_tasks SET status = 'cancelled', upstream_may_continue = 0, cancellation_scope = 'queued', updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(now, now, taskId);
          recordGenerationEvent(database, { taskId, appId, eventType: "cancelled", payload: { status: "cancelled", scope: "queued" } });
          return getGenerationTask(database, taskId, appId)!;
        }

        if (runningSet.has(providerTaskId)) {
          database.connection.prepare(
            "UPDATE generation_tasks SET status = 'abandoned', upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(now, now, taskId);
          recordGenerationEvent(database, { taskId, appId, eventType: "abandoned", payload: { status: "abandoned", scope: "local-tracking" } });
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

  const inputs = JSON.parse(String(original.request_params_json ?? "{}"));
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
      inputs,
      seed: original.actual_seed != null ? Number(original.actual_seed) : null,
      retryOf: taskId,
      isInternal: true,
    },
    fetcher,
  );
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
