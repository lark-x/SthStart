import type { GenerationTaskDescriptor } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';

function codedError(code: string, message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseProgress(value: unknown, status: string) {
  const parsed = parseJsonObject(value);
  const rawValue = parsed.value;
  const numericValue = rawValue === null ? null : Number(rawValue);
  return {
    value: typeof numericValue !== 'number' || !Number.isFinite(numericValue) ? null : Math.min(1, Math.max(0, numericValue)),
    stage: typeof parsed.stage === 'string' && parsed.stage ? parsed.stage : status,
    ...(typeof parsed.message === 'string' ? { message: parsed.message } : {}),
    ...(Number.isFinite(Number(parsed.current)) ? { current: Math.max(0, Number(parsed.current)) } : {}),
    ...(Number.isFinite(Number(parsed.total)) ? { total: Math.max(0, Number(parsed.total)) } : {}),
    ...(typeof parsed.source === 'string' ? { source: parsed.source } : {}),
  };
}

export function resolveWorkflowAndEngine(
  database: ServiceDatabase,
  appId: string,
  options: { purpose?: string | null; workflowId?: string | null; workflowVersion?: number | null; isInternal?: boolean },
) {
  if (!options.isInternal && (options.workflowId || options.workflowVersion != null)) {
    throw codedError('workflow_assignment_managed', '工作流由管理控制台统一分配，客户端不可直接指定 workflowId 或 workflowVersion。');
  }
  const purpose = options.purpose?.trim() || 'default';
  let workflowId: string;
  let version: number;
  let engineId: string;
  if (options.isInternal && options.workflowId) {
    workflowId = options.workflowId;
    const workflow = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?').get(workflowId) as { latest_version: number } | undefined;
    if (!workflow) throw codedError('workflow_not_found', `未找到指定的工作流 ${workflowId}。`);
    version = options.workflowVersion ?? workflow.latest_version;
    const selected = database.connection.prepare(
      'SELECT engine_id FROM generation_workflow_versions WHERE workflow_id = ? AND version = ? AND is_published = 1',
    ).get(workflowId, version) as { engine_id: string | null } | undefined;
    if (!selected) throw codedError('workflow_version_not_found', `未找到工作流 ${workflowId} 的已发布版本 v${version}。`);
    engineId = selected.engine_id || (database.connection.prepare('SELECT id FROM generation_engines WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined)?.id || '';
  } else {
    const assignment = database.connection.prepare(
      'SELECT * FROM app_generation_assignments WHERE app_id = ? AND purpose = ?',
    ).get(appId, purpose) as { workflow_id: string; workflow_version: number; engine_id: string } | undefined;
    if (!assignment) throw codedError('generation_assignment_not_found', `未为应用 ${appId} 配置用途 ${purpose} 的生成工作流绑定。`);
    workflowId = assignment.workflow_id;
    version = assignment.workflow_version;
    engineId = assignment.engine_id;
  }
  const workflow = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?').get(workflowId) as { id: string; name: string; engine_kind: string; category?: string } | undefined;
  if (!workflow) throw codedError('workflow_not_found', `未找到指定的工作流 ${workflowId}。`);
  const workflowVersion = database.connection.prepare(`
    SELECT v.*, m.category AS legacy_category, m.input_capabilities_json AS legacy_input_capabilities_json,
      m.output_media_types_json AS legacy_output_media_types_json, m.output_schema_json AS legacy_output_schema_json
    FROM generation_workflow_versions v
    LEFT JOIN generation_workflow_media_versions m ON m.workflow_id=v.workflow_id AND m.version=v.version
    WHERE v.workflow_id = ? AND v.version = ? AND v.is_published = 1
  `).get(workflowId, version) as Record<string, unknown> | undefined;
  if (!workflowVersion) throw codedError('workflow_version_not_found', `未找到工作流 ${workflowId} 的已发布版本 v${version}。`);
  if (!engineId) throw codedError('generation_engine_unavailable', '未配置可用的生成引擎。');
  const engine = database.connection.prepare('SELECT * FROM generation_engines WHERE id = ? AND enabled = 1').get(engineId) as Record<string, unknown> | undefined;
  if (!engine) throw codedError('generation_engine_unavailable', `生成引擎 ${engineId} 处于禁用或不存在状态。`);
  if (engine.kind !== 'comfyui' && engine.kind !== 'worker') throw codedError('unsupported_engine', `暂不支持引擎类型 "${engine.kind}"。`);
  return {
    workflow: {
      id: workflow.id, name: workflow.name, engineKind: workflow.engine_kind, version,
      category: workflow.category ?? String(workflowVersion.legacy_category ?? 'image'),
      inputSchema: parseJsonObject(workflowVersion.input_schema_json),
      inputCapabilities: Object.keys(parseJsonObject(workflowVersion.input_capabilities_json)).length
        ? parseJsonObject(workflowVersion.input_capabilities_json)
        : parseJsonObject(workflowVersion.legacy_input_capabilities_json),
      nodeBindings: parseJsonObject(workflowVersion.node_bindings_json) as Record<string, string[]>,
      outputDeclarations: parseJsonArray(workflowVersion.output_declarations_json),
      outputMediaTypes: parseJsonArray(workflowVersion.output_media_types_json).length
        ? parseJsonArray(workflowVersion.output_media_types_json)
        : parseJsonArray(workflowVersion.legacy_output_media_types_json),
      outputSchema: Object.keys(parseJsonObject(workflowVersion.output_schema_json)).length
        ? parseJsonObject(workflowVersion.output_schema_json)
        : parseJsonObject(workflowVersion.legacy_output_schema_json),
      definition: parseJsonObject(workflowVersion.definition_json),
    },
    engine: {
      id: String(engine.id), name: String(engine.name), kind: String(engine.kind),
      baseUrl: String(engine.base_url).replace(/\/+$/, ''),
      credentialAccount: engine.credential_account ? String(engine.credential_account) : null,
      concurrencyLimit: Number(engine.concurrency_limit || 1),
    },
  };
}

export function getGenerationTask(database: ServiceDatabase, taskId: string, requestingAppId?: string): GenerationTaskDescriptor | null {
  const task = database.connection.prepare('SELECT * FROM generation_tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!task || (requestingAppId && task.app_id !== requestingAppId)) return null;
  const artifacts = database.connection.prepare(`
    SELECT ta.output_name, ta.sort_order, a.id as artifact_id, a.content_type, a.media_type, a.byte_size, a.sha256, a.thumbnail_artifact_id
    FROM generation_task_artifacts ta JOIN artifacts a ON a.id = ta.artifact_id
    WHERE ta.task_id = ? ORDER BY ta.sort_order ASC
  `).all(taskId) as Array<{ output_name: string; sort_order: number; artifact_id: string; content_type: string | null; media_type: string | null; byte_size: number; sha256: string | null; thumbnail_artifact_id: string | null }>;
  const status = String(task.status);
  const priority = task.priority === 'interactive' || task.priority === 'background' || task.priority === 'normal'
    ? task.priority
    : 'normal';
  return {
    id: String(task.id), appId: String(task.app_id), engineId: String(task.engine_id), workflowId: String(task.workflow_id),
    workflowVersion: Number(task.workflow_version), purpose: String(task.purpose || 'default'),
    idempotencyKey: task.idempotency_key ? String(task.idempotency_key) : null,
    status: task.status as GenerationTaskDescriptor['status'], priority, progress: parseProgress(task.progress_json, status), actualSeed: task.actual_seed != null ? Number(task.actual_seed) : null,
    providerTaskId: task.provider_task_id ? String(task.provider_task_id) : null,
    errorCode: task.error_code ? String(task.error_code) : null, errorMessage: task.error_message ? String(task.error_message) : null,
    upstreamMayContinue: Boolean(task.upstream_may_continue),
    cancellationScope: (task.cancellation_scope ?? 'none') as GenerationTaskDescriptor['cancellationScope'],
    retryOf: task.retry_of ? String(task.retry_of) : null, createdAt: String(task.created_at), updatedAt: String(task.updated_at),
    finishedAt: task.finished_at ? String(task.finished_at) : null,
    artifacts: artifacts.map((item) => ({
      artifactId: item.artifact_id, outputName: item.output_name, sortOrder: item.sort_order,
      url: `/api/v1/artifacts/${item.artifact_id}`, byteSize: Number(item.byte_size), contentType: item.content_type, sha256: item.sha256,
      mediaKind: item.media_type === 'image' || item.media_type === 'video' || item.media_type === 'audio' ? item.media_type : 'file',
      thumbnailArtifactId: item.thumbnail_artifact_id,
    })),
  };
}
