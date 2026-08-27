import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type {
  GenerationEvent,
  GenerationTaskDescriptor,
} from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { createArtifactReference, mimeToExt, persistArtifact, removeArtifact, streamUploadArtifact } from './artifacts.js';
import type { SecretStore } from './security.js';
import {
  confirmWorkerTask,
  downloadWorkerOutput,
  getWorkerTaskStatus,
  readWorkerSettings,
  submitWorkerTask,
  uploadWorkerInput,
  WORKER_OUTPUT_ID_PATTERN,
} from './worker.js';

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
  inputArtifacts?: GenerationInputArtifact[];
  seed?: number | null;
  retryOf?: string | null;
  isInternal?: boolean;
}

export interface GenerationInputArtifact {
  artifactId: string;
  inputKey: string;
}

export interface ParsedGenerationRequestParams {
  inputs: Record<string, unknown>;
  inputArtifacts: GenerationInputArtifact[];
}

function generationError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function normalizeInputArtifacts(raw: unknown): GenerationInputArtifact[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw generationError('invalid_input_artifacts', '输入媒体引用必须为数组。');
  if (raw.length > 4) throw generationError('too_many_input_artifacts', '单个生成任务最多引用 4 个输入媒体。');

  const seen = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw generationError('invalid_input_artifact', '输入媒体引用格式无效。');
    }
    const value = item as Record<string, unknown>;
    const artifactId = typeof value.artifactId === 'string' ? value.artifactId.trim() : '';
    const inputKey = typeof value.inputKey === 'string' ? value.inputKey.trim() : '';
    if (!artifactId || !inputKey || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(inputKey)) {
      throw generationError('invalid_input_artifact', '输入媒体引用必须包含合法的 artifactId 和 inputKey。');
    }
    if (seen.has(inputKey)) throw generationError('duplicate_input_artifact_key', `输入媒体绑定键 ${inputKey} 重复。`);
    seen.add(inputKey);
    return { artifactId, inputKey };
  });
}

export function parseGenerationRequestParams(raw: unknown): ParsedGenerationRequestParams {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { inputs: {}, inputArtifacts: [] };
  const value = parsed as Record<string, unknown>;
  if (value.inputs && typeof value.inputs === 'object' && !Array.isArray(value.inputs)) {
    return {
      inputs: value.inputs as Record<string, unknown>,
      inputArtifacts: normalizeInputArtifacts(value.inputArtifacts),
    };
  }
  return { inputs: value, inputArtifacts: [] };
}

function validateInputArtifacts(
  database: ServiceDatabase,
  appId: string,
  inputArtifacts: GenerationInputArtifact[],
) {
  for (const input of inputArtifacts) {
    const row = database.connection.prepare(
      'SELECT id, app_id, local_path, content_type, byte_size, file_status FROM artifacts WHERE id = ?',
    ).get(input.artifactId) as { id: string; app_id: string; local_path: string | null; content_type: string | null; byte_size: number; file_status: string } | undefined;
    if (!row) throw generationError('input_artifact_not_found', `输入媒体 ${input.artifactId} 不存在。`);
    if (row.app_id !== appId) throw generationError('input_artifact_access_denied', '输入媒体不属于当前应用。');
    if (row.file_status !== 'ready' || !row.local_path) throw generationError('input_artifact_unavailable', '输入媒体当前不可用。');
    if (!row.content_type?.toLowerCase().startsWith('image/')) throw generationError('input_artifact_invalid_type', '输入媒体必须是图片文件。');
    if (!Number.isFinite(Number(row.byte_size)) || Number(row.byte_size) > 12 * 1024 * 1024) {
      throw generationError('input_artifact_too_large', '输入图片不能超过 12 MiB。');
    }
  }
}

function applyWorkflowInput(
  workflowSnapshot: Record<string, unknown>,
  nodeBindings: Record<string, string[]>,
  inputKey: string,
  value: string,
) {
  const pathSegments = nodeBindings[inputKey];
  if (!pathSegments || pathSegments.length !== 3 || pathSegments[1] !== 'inputs') {
    throw generationError('input_binding_not_found', `工作流没有为输入 ${inputKey} 配置节点绑定。`);
  }
  const [nodeId, , parameter] = pathSegments;
  const node = workflowSnapshot[nodeId];
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw generationError('input_binding_not_found', `输入 ${inputKey} 的目标节点不存在。`);
  }
  const nodeInputs = (node as Record<string, unknown>).inputs;
  if (!nodeInputs || typeof nodeInputs !== 'object' || Array.isArray(nodeInputs)) {
    throw generationError('input_binding_not_found', `输入 ${inputKey} 的目标节点缺少 inputs。`);
  }
  (nodeInputs as Record<string, unknown>)[parameter] = value;
}

async function prepareInputArtifacts(
  config: ServiceConfig,
  database: ServiceDatabase,
  taskRow: Record<string, unknown>,
  workflowSnapshot: Record<string, unknown>,
  secret: string | null,
  engineKind: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const parsedRequest = parseGenerationRequestParams(taskRow.request_params_json);
  if (!parsedRequest.inputArtifacts.length) return workflowSnapshot;

  const version = database.connection.prepare(
    'SELECT node_bindings_json FROM generation_workflow_versions WHERE workflow_id = ? AND version = ?',
  ).get(String(taskRow.workflow_id), Number(taskRow.workflow_version)) as { node_bindings_json: string } | undefined;
  if (!version) throw generationError('workflow_version_not_found', '生成工作流版本不存在。');
  let nodeBindings: Record<string, string[]>;
  try {
    nodeBindings = JSON.parse(version.node_bindings_json) as Record<string, string[]>;
  } catch {
    throw generationError('invalid_node_bindings', '生成工作流节点绑定不可用。');
  }

  const prepared = JSON.parse(JSON.stringify(workflowSnapshot)) as Record<string, unknown>;
  const engineRow = database.connection.prepare('SELECT base_url FROM generation_engines WHERE id = ?').get(String(taskRow.engine_id)) as { base_url: string } | undefined;
  if (!engineRow) throw generationError('generation_engine_unavailable', '生成引擎不可用。');
  const engineBaseUrl = String(engineRow.base_url).replace(/\/+$/, '');

  for (const input of parsedRequest.inputArtifacts) {
    const artifact = database.connection.prepare(
      'SELECT id, local_path, content_type, original_name, sha256, file_status FROM artifacts WHERE id = ? AND app_id = ?',
    ).get(input.artifactId, String(taskRow.app_id)) as { id: string; local_path: string | null; content_type: string | null; original_name: string | null; sha256: string | null; file_status: string } | undefined;
    if (!artifact || artifact.file_status !== 'ready' || !artifact.local_path) {
      throw generationError('input_artifact_unavailable', '输入媒体当前不可用。');
    }
    let fileStats;
    try {
      fileStats = await stat(artifact.local_path);
    } catch {
      throw generationError('input_artifact_missing_file', '输入媒体文件已不存在。');
    }
    if (!fileStats.isFile()) throw generationError('input_artifact_missing_file', '输入媒体文件不是普通文件。');
    if (fileStats.size > 12 * 1024 * 1024) throw generationError('input_artifact_too_large', '输入图片不能超过 12 MiB。');

    const contentType = artifact.content_type?.split(';')[0].trim().toLowerCase() || 'image/png';
    if (!contentType.startsWith('image/')) throw generationError('input_artifact_invalid_type', '输入媒体必须是图片文件。');
    const originalExtension = artifact.original_name ? extname(artifact.original_name).toLowerCase() : '';
    const extension = /^\.(png|jpe?g|webp|gif|avif)$/.test(originalExtension) ? originalExtension : mimeToExt(contentType);
    const controlledFilename = `${artifact.id}${extension}`;
    const blob = await openAsBlob(artifact.local_path, { type: contentType });

    if (engineKind === 'worker') {
      if (!secret) throw generationError('worker_token_missing', 'Windows Worker 凭据未配置。');
      let uploadResponse: { fileName?: string };
      try {
        uploadResponse = await uploadWorkerInput({
          baseUrl: engineBaseUrl,
          token: secret,
          taskId: String(taskRow.id),
          uploadId: artifact.id,
          body: blob,
          filename: controlledFilename,
          contentType,
          contentLength: fileStats.size,
          sha256: artifact.sha256 || '',
          fetcher,
        });
      } catch (error) {
        const detail = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 240);
        throw generationError('worker_input_upload_failed', `输入图片上传到 Windows Worker 失败：${detail}`);
      }
      const uploadedName = typeof uploadResponse.fileName === 'string' ? uploadResponse.fileName : '';
      if (!uploadedName || uploadedName.includes('/') || uploadedName.includes('\\')) {
        throw generationError('worker_input_upload_failed', 'Windows Worker 未返回可用的受控文件名。');
      }
      applyWorkflowInput(prepared, nodeBindings, input.inputKey, uploadedName);
      continue;
    }

    const form = new FormData();
    form.set('image', new File([blob], controlledFilename, { type: contentType }));
    form.set('overwrite', 'false');
    form.set('type', 'input');

    let uploadResponse: Response;
    try {
      uploadResponse = await fetcher(`${engineBaseUrl}/upload/image`, {
        method: 'POST',
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const detail = sanitizeErrorMessage(error instanceof Error ? error.message : String(error)).slice(0, 240);
      throw generationError('input_upload_failed', `输入图片上传到生成引擎失败：${detail}`);
    }
    const payload = await uploadResponse.json().catch(() => null) as { name?: unknown; filename?: unknown } | null;
    if (!uploadResponse.ok) {
      const detail = payload && typeof payload === 'object' ? String(payload.name ?? payload.filename ?? `HTTP ${uploadResponse.status}`) : `HTTP ${uploadResponse.status}`;
      throw generationError('input_upload_failed', `输入图片上传到生成引擎失败：${sanitizeErrorMessage(detail).slice(0, 240)}`);
    }
    const uploadedName = typeof payload?.name === 'string' ? payload.name : typeof payload?.filename === 'string' ? payload.filename : '';
    if (!uploadedName || uploadedName.includes('/') || uploadedName.includes('\\')) {
      throw generationError('input_upload_failed', '生成引擎未返回可用的受控文件名。');
    }
    applyWorkflowInput(prepared, nodeBindings, input.inputKey, uploadedName);
  }

  return prepared;
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

  if (engine.kind !== 'comfyui' && engine.kind !== 'worker') {
    const err = new Error(`暂不支持引擎类型 "${engine.kind}"。`);
    (err as { code?: string }).code = 'unsupported_engine';
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
  const inputArtifacts = normalizeInputArtifacts(options.inputArtifacts);
  const canonicalPayload = {
    purpose: options.purpose?.trim() || 'default',
    workflowId: options.workflowId?.trim() || null,
    workflowVersion: options.workflowVersion ?? null,
    inputs,
    inputArtifacts,
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
  validateInputArtifacts(database, options.appId, inputArtifacts);
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
      JSON.stringify({ inputs, inputArtifacts }),
      JSON.stringify(workflowSnapshot),
      actualSeed,
      options.retryOf ?? null,
      now,
      now,
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
      SET status = 'submitting', lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(leaseOwner, leaseExpiresAt, now, taskId);

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
      config,
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
    let workerSubmission;
    try {
      workerSubmission = await submitWorkerTask({
        baseUrl: engineBaseUrl,
        token: secret ?? '',
        taskId,
        workflow: workflowSnapshot,
        outputDeclarations,
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
      "UPDATE generation_tasks SET status = 'accepted', provider_task_id = ?, updated_at = ? WHERE id = ?",
    ).run(workerTaskId, nowAccepted, taskId);
    recordGenerationEvent(database, {
      taskId,
      appId,
      eventType: 'accepted',
      payload: { status: 'accepted', providerTaskId: workerTaskId, source: 'windows-worker' },
    });
    await pollAndCompleteTask(config, database, secrets, taskId, fetcher);
    return;
  }

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

  while (Date.now() < pollDeadline) {
    const currentTask = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
    if (!currentTask || ["succeeded", "failed", "cancelled", "abandoned"].includes(currentTask.status)) return;

    try {
      const workerStatus = await getWorkerTaskStatus(engineBaseUrl, secret, workerTaskId, fetcher);
      const status = workerStatus.status;

      if (status === 'failed' || status === 'abandoned' || status === 'cancelled') {
        const nowDone = nowIso();
        const errorCode = String(workerStatus.errorCode || `worker_${status}`);
        const safeMessage = sanitizeErrorMessage(String(workerStatus.errorMessage || `Windows Worker 任务${status}。`)).slice(0, 300);
        const terminalStatus = status;
        database.connection.prepare(
          "UPDATE generation_tasks SET status = ?, error_code = ?, error_message = ?, upstream_may_continue = ?, cancellation_scope = ?, updated_at = ?, finished_at = ? WHERE id = ?",
        ).run(terminalStatus, errorCode, safeMessage, status === 'abandoned' ? 1 : 0, status === 'abandoned' ? 'local-tracking' : 'none', nowDone, nowDone, taskId);
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
        database.connection.prepare("UPDATE generation_tasks SET status = 'running', updated_at = ? WHERE id = ?").run(nowRunning, taskId);
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
              "UPDATE generation_tasks SET status = 'succeeded', error_code = NULL, error_message = NULL, updated_at = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ?",
            ).run(nowDone, nowDone, taskId);
            break;
          }
        }
        const outputs = Array.isArray(workerStatus.outputs) ? workerStatus.outputs : [];
        if (!outputs.length) {
          const nowDone = nowIso();
          database.connection.prepare(
            "UPDATE generation_tasks SET status = 'failed', error_code = 'worker_outputs_missing', error_message = 'Windows Worker 未返回产物', updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(nowDone, nowDone, taskId);
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
            "UPDATE generation_tasks SET status = 'abandoned', error_code = 'worker_output_failed', error_message = ?, upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(safeMessage, nowDone, nowDone, taskId);
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
            "UPDATE generation_tasks SET status = 'succeeded', error_code = NULL, error_message = NULL, updated_at = ?, finished_at = ? WHERE id = ?",
          ).run(nowDone, nowDone, taskId);
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

  const finalCheck = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
  if (finalCheck && ["submitting", "accepted", "running"].includes(finalCheck.status)) {
    const nowDone = nowIso();
    database.connection.prepare(
      "UPDATE generation_tasks SET status = 'abandoned', error_code = 'worker_poll_timeout', error_message = 'Windows Worker 轮询超时，上游可能仍在运行', upstream_may_continue = 1, cancellation_scope = 'local-tracking', updated_at = ?, finished_at = ? WHERE id = ?",
    ).run(nowDone, nowDone, taskId);
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
  while (Date.now() < pollDeadline) {
    const currentTask = database.connection.prepare("SELECT status FROM generation_tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
    if (!currentTask || ["succeeded", "failed", "cancelled", "abandoned"].includes(currentTask.status)) return;

    try {
      const historyRes = await fetcher(`${engineBaseUrl}/history/${providerTaskId}`, {
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
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
          const allImages: Array<{ filename: string; subfolder: string; type: string; outputName: string }> = [];
          for (const [outputName, output] of Object.entries(outputs)) {
            if (declaredOutputs && !declaredOutputs.has(outputName)) continue;
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
                    refType: "generation-output",
                    refId: taskId,
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

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

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
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
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
              headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
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
    "SELECT id FROM generation_tasks WHERE status = 'queued' ORDER BY created_at ASC",
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
