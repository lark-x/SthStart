import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { GenerationAnalyzedInput } from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import type { SecretStore } from './security.js';
import { getGenerationTask } from './generation/task-store.js';
import { createGenerationTask } from './generation/execution.js';
import { assertNoWorkflowSecrets } from './generation/workflows.js';
import {
  analyzeComfyApiJson,
  analyzeConfigPackage,
  buildSuggestedDraft,
  parseEditorConfig,
  parseInputSchema,
  validateModelSelection,
  validateValuesAgainstSchema,
  type InputSchemaMap,
} from './generation/configuration.js';
import {
  deletePreset,
  getWorkflowDraft,
  getPreset,
  listPresets,
  createPreset,
  saveWorkflowDraft,
  setDefaultPreset,
  updatePreset,
} from './generation/configuration-store.js';
import { cachedModels, getNodeDefinitions, listModels, loadObjectInfo, testConnection, type EngineTarget } from './generation/comfy-discovery.js';

/** 新管理路由（规划 §12）：按项目约定抽成独立模块，由 management.ts 挂载到管理鉴权之下。 */

const CREATIVE_APP_ID = 'creative-center';
const CONFIGURATION_TEST_PURPOSE = 'configuration-test';
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_NODES = 300;
const MAX_IMPORT_DEPTH = 12;

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function jsonDepth(value: unknown, depth = 0): number {
  if (depth > MAX_IMPORT_DEPTH) return depth;
  if (Array.isArray(value)) {
    let max = depth;
    for (const item of value) max = Math.max(max, jsonDepth(item, depth + 1));
    return max;
  }
  if (isRecord(value)) {
    let max = depth;
    for (const item of Object.values(value)) max = Math.max(max, jsonDepth(item, depth + 1));
    return max;
  }
  return depth;
}

function assertImportLimits(definition: unknown) {
  const serialized = JSON.stringify(definition ?? null);
  if (serialized.length > MAX_IMPORT_BYTES) throw codedError('import_too_large', '导入的工作流 JSON 超过大小限制（4 MiB）。');
  if (!isRecord(definition)) throw codedError('invalid_workflow_format', '工作流定义必须是 JSON 对象。');
  const nodeCount = Object.keys(definition).length;
  if (nodeCount > MAX_IMPORT_NODES) throw codedError('import_too_many_nodes', `工作流节点数 ${nodeCount} 超过限制（${MAX_IMPORT_NODES}）。`);
  if (jsonDepth(definition) > MAX_IMPORT_DEPTH) throw codedError('import_too_deep', `工作流 JSON 嵌套深度超过限制（${MAX_IMPORT_DEPTH}）。`);
}

function errorStatus(code: string) {
  if (['workflow_not_found', 'preset_not_found', 'workflow_version_not_found', 'app_not_found', 'engine_not_found', 'test_run_not_found'].includes(code)) return 404;
  if (['draft_revision_conflict', 'preset_revision_conflict', 'preset_is_default', 'preset_disabled', 'engine_in_use', 'workflow_archived', 'idempotency_conflict', 'preset_not_available'].includes(code)) return 409;
  if (['engine_unreachable', 'model_discovery_failed', 'upstream_rejected'].includes(code)) return 502;
  if (['generation_engine_unavailable', 'keyring_unavailable'].includes(code)) return 503;
  return 400;
}

function sendConfigError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  const code = (error as { code?: string })?.code || 'generation_config_failed';
  const safeCode = /^[a-z][a-z0-9_]{2,80}$/.test(code) ? code : 'generation_config_failed';
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(errorStatus(safeCode)).send({ error: safeCode, message: message.slice(0, 300) });
}

async function engineTarget(database: ServiceDatabase, secrets: SecretStore, engineId: string): Promise<{ target: EngineTarget; secret: string | null }> {
  const row = database.connection.prepare('SELECT id, kind, base_url, credential_account, enabled FROM generation_engines WHERE id = ?')
    .get(engineId) as { id: string; kind: string; base_url: string; credential_account: string | null; enabled: number } | undefined;
  if (!row) throw codedError('engine_not_found', `未找到连接 ${engineId}。`);
  let secret: string | null = null;
  if (row.credential_account) {
    try {
      secret = (await secrets.get(row.credential_account)).value;
    } catch (error) {
      throw codedError('keyring_unavailable', `凭据库读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { target: { id: row.id, kind: row.kind, baseUrl: row.base_url, credentialAccount: row.credential_account }, secret };
}

function workflowRow(database: ServiceDatabase, workflowId: string) {
  const row = database.connection.prepare('SELECT * FROM generation_workflows WHERE id = ?')
    .get(workflowId) as Record<string, unknown> | undefined;
  if (!row) throw codedError('workflow_not_found', `未找到工作流 ${workflowId}。`);
  return row;
}

function versionRow(database: ServiceDatabase, workflowId: string, version: number) {
  const row = database.connection.prepare(
    'SELECT * FROM generation_workflow_versions WHERE workflow_id = ? AND version = ?',
  ).get(workflowId, version) as Record<string, unknown> | undefined;
  if (!row) throw codedError('workflow_version_not_found', `未找到工作流 ${workflowId} 的版本 v${version}。`);
  return row;
}

/** 旧配置（无草稿）投影成新编辑器草稿：可识别字段显示控件，其余保留高级区。 */
function projectDraftFromVersion(database: ServiceDatabase, workflowId: string) {
  const workflow = workflowRow(database, workflowId);
  const latestVersion = Number(workflow.latest_version ?? 0);
  if (latestVersion < 1) return null;
  const version = versionRow(database, workflowId, latestVersion);
  const definition = JSON.parse(String(version.definition_json ?? '{}')) as Record<string, unknown>;
  const inputSchema = parseInputSchema(version.input_schema_json);
  const nodeBindings = JSON.parse(String(version.node_bindings_json ?? '{}')) as Record<string, string[]>;
  const outputDeclarations = JSON.parse(String(version.output_declarations_json ?? '[]')) as string[];
  let editorConfig = parseEditorConfig(version.editor_config_json);
  if (!editorConfig) {
    const analysis = analyzeComfyApiJson(definition);
    const suggested = buildSuggestedDraft(definition, analysis, {
      inputSchema,
      nodeBindings,
      outputDeclarations,
      formatVersion: 1,
    });
    editorConfig = parseEditorConfig(suggested.editorConfig);
  }
  return {
    workflowId,
    baseVersion: latestVersion,
    revision: 1,
    draft: {
      formatVersion: Number(version.config_format_version ?? 1) >= 2 ? 2 : 1,
      name: String(workflow.name),
      description: String(workflow.description ?? ''),
      category: (workflow.category as 'image' | 'video' | 'audio' | 'transform' | undefined) ?? 'image',
      engineId: (version.engine_id as string | null) ?? null,
      definition,
      inputSchema: inputSchema as unknown as Record<string, unknown>,
      inputCapabilities: JSON.parse(String(version.input_capabilities_json ?? '{}')) as Record<string, unknown>,
      nodeBindings,
      outputDeclarations,
      outputMediaTypes: JSON.parse(String(version.output_media_types_json ?? '["image/png"]')) as string[],
      outputSchema: JSON.parse(String(version.output_schema_json ?? '{}')) as Record<string, unknown>,
      editorConfig,
    },
    updatedAt: String(version.created_at),
  };
}

export function registerGenerationConfigRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  fetcher: typeof fetch = fetch,
) {
  // ── 连接发现 ──

  app.post<{ Params: { id: string } }>('/api/v1/admin/generation/engines/:id/test', async (request, reply) => {
    try {
      const { target, secret } = await engineTarget(database, secrets, request.params.id);
      const result = await testConnection(target, secret, fetcher);
      return result;
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { type?: string; search?: string; limit?: string; offset?: string; refresh?: string } }>(
    '/api/v1/admin/generation/engines/:id/models',
    async (request, reply) => {
      try {
        const { target, secret } = await engineTarget(database, secrets, request.params.id);
        const result = await listModels(target, secret, {
          category: request.query.type,
          search: request.query.search,
          limit: Number(request.query.limit) || 200,
          offset: Number(request.query.offset) || 0,
          refresh: request.query.refresh === '1' || request.query.refresh === 'true',
        }, fetcher);
        return result;
      } catch (error) {
        return sendConfigError(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { classTypes?: string } }>('/api/v1/admin/generation/engines/:id/nodes', async (request, reply) => {
    try {
      const { target, secret } = await engineTarget(database, secrets, request.params.id);
      const classTypes = (request.query.classTypes ?? '').split(',').map((item) => item.trim()).filter(Boolean);
      return await getNodeDefinitions(target, secret, classTypes, fetcher);
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  // ── 导入分析 ──

  app.post<{ Body: { definition?: unknown; bundle?: unknown; connectionId?: string } }>('/api/v1/admin/generation/workflows/analyze', async (request, reply) => {
    try {
      const body = request.body ?? {};
      if (!isRecord(body)) throw codedError('invalid_import_payload', '导入内容必须为 JSON 对象。');
      assertNoWorkflowSecrets(body);

      let objectInfo: Record<string, unknown> | undefined;
      let objectInfoError: string | null = null;
      if (typeof body.connectionId === 'string' && body.connectionId.trim()) {
        const { target, secret } = await engineTarget(database, secrets, body.connectionId.trim());
        if (target.kind === 'comfyui') {
          const loaded = await loadObjectInfo(target, secret, fetcher);
          objectInfo = loaded.objectInfo ?? undefined;
          objectInfoError = loaded.error;
        } else {
          objectInfoError = 'Worker 连接的节点枚举请升级 Worker 后使用发现接口获取。';
        }
      }

      if (isRecord(body.bundle)) {
        const { analysis, packageInfo, suggestedDraft } = analyzeConfigPackage(body.bundle, objectInfo);
        assertImportLimits(body.bundle.definition ?? body.bundle.version);
        if (objectInfoError) analysis.warnings.push(`未能读取连接的节点枚举：${objectInfoError}`);
        return {
          source: 'config-package',
          nodeCount: analysis.nodeCount,
          inputs: analysis.inputs,
          outputCandidates: analysis.outputCandidates,
          packageInfo,
          warnings: analysis.warnings,
          suggestedDraft,
        };
      }

      const definition = body.definition;
      assertImportLimits(definition);
      const analysis = analyzeComfyApiJson(definition, objectInfo);
      if (objectInfoError) analysis.warnings.push(`未能读取连接的节点枚举：${objectInfoError}`);
      const suggestedDraft = buildSuggestedDraft(definition, analysis);
      return {
        source: 'api-json',
        nodeCount: analysis.nodeCount,
        inputs: analysis.inputs,
        outputCandidates: analysis.outputCandidates,
        warnings: analysis.warnings,
        suggestedDraft,
      } as {
        source: 'api-json';
        nodeCount: number;
        inputs: GenerationAnalyzedInput[];
        outputCandidates: string[];
        warnings: string[];
        suggestedDraft: Record<string, unknown>;
      };
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  // ── 草稿 ──

  app.get<{ Params: { id: string } }>('/api/v1/admin/generation/workflows/:id/draft', async (request, reply) => {
    try {
      const existing = getWorkflowDraft(database, request.params.id);
      if (existing) return existing;
      const projected = projectDraftFromVersion(database, request.params.id);
      if (!projected) throw codedError('workflow_not_found', `未找到工作流 ${request.params.id}，或它还没有任何版本。`);
      return projected;
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.put<{ Params: { id: string }; Body: { revision?: number; draft?: unknown } }>('/api/v1/admin/generation/workflows/:id/draft', async (request, reply) => {
    try {
      if (!isRecord(request.body) || !Number.isInteger(Number(request.body.revision))) {
        throw codedError('invalid_draft', '保存草稿需要提供整数 revision。');
      }
      const result = saveWorkflowDraft(database, request.params.id, { revision: Number(request.body.revision), draft: request.body.draft });
      if (result.conflict) {
        return reply.code(409).send({
          error: 'draft_revision_conflict',
          message: '草稿已被其他窗口修改；请以服务端返回的草稿为准合并后再保存。',
          draft: result.draft,
        });
      }
      return result.draft;
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  // ── 复制 / 导出 ──

  app.post<{ Params: { id: string }; Body: { id?: string; name?: string } }>('/api/v1/admin/generation/workflows/:id/duplicate', async (request, reply) => {
    try {
      const source = workflowRow(database, request.params.id);
      const rawId = request.body?.id?.trim();
      const newId = rawId || `${request.params.id}-copy-${Date.now().toString(36)}`;
      if (!/^[a-z][a-z0-9-]{1,62}$/.test(newId)) throw codedError('invalid_workflow_id', '工作流 ID 必须由小写字母开头，由小写字母、数字和连字符组成。');
      if (database.connection.prepare('SELECT 1 FROM generation_workflows WHERE id = ?').get(newId)) {
        throw codedError('workflow_exists', `工作流 ID ${newId} 已存在。`);
      }
      const name = request.body?.name?.trim() || `${String(source.name)} 副本`;
      const now = nowIso();
      database.transaction(() => {
        database.connection.prepare(`
          INSERT INTO generation_workflows (id, name, description, engine_kind, category, latest_version, created_at, updated_at, archived_at)
          SELECT ?, ?, description, engine_kind, category, latest_version, ?, ?, archived_at FROM generation_workflows WHERE id = ?
        `).run(newId, name, now, now, request.params.id);
        database.connection.prepare(`
          INSERT INTO generation_workflow_versions (
            workflow_id, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json,
            definition_json, input_capabilities_json, output_media_types_json, output_schema_json,
            config_format_version, editor_config_json, is_published, created_at
          ) SELECT ?, version, engine_id, input_schema_json, node_bindings_json, output_declarations_json,
            definition_json, input_capabilities_json, output_media_types_json, output_schema_json,
            config_format_version, editor_config_json, is_published, ? FROM generation_workflow_versions WHERE workflow_id = ?
        `).run(newId, now, request.params.id);
        database.connection.prepare(`
          INSERT INTO generation_workflow_media_versions (workflow_id, version, category, input_capabilities_json, output_media_types_json, output_schema_json, updated_at)
          SELECT ?, version, category, input_capabilities_json, output_media_types_json, output_schema_json, ? FROM generation_workflow_media_versions WHERE workflow_id = ?
        `).run(newId, now, request.params.id);
        const sourceDraft = getWorkflowDraft(database, request.params.id);
        if (sourceDraft) {
          database.connection.prepare(`
            INSERT INTO generation_workflow_drafts (workflow_id, base_version, revision, draft_json, updated_at)
            VALUES (?, ?, 1, ?, ?)
          `).run(newId, sourceDraft.baseVersion, JSON.stringify(sourceDraft.draft), now);
        }
      });
      return reply.code(201).send({ id: newId, name, latestVersion: Number(source.latest_version) });
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.get<{ Params: { id: string; version: string } }>('/api/v1/admin/generation/workflows/:id/versions/:version/export', async (request, reply) => {
    try {
      const workflow = workflowRow(database, request.params.id);
      const version = Number(request.params.version);
      if (!Number.isInteger(version)) throw codedError('invalid_version', '版本号必须是整数。');
      const row = versionRow(database, request.params.id, version);
      const definition = JSON.parse(String(row.definition_json ?? '{}'));
      assertNoWorkflowSecrets(definition);
      const presets = listPresets(database, { workflowId: request.params.id })
        .filter((preset) => preset.workflowVersion === version);
      const payload = {
        format: 'sthstart-generation-config@1',
        exportedAt: nowIso(),
        workflow: {
          id: String(workflow.id),
          name: String(workflow.name),
          description: String(workflow.description ?? ''),
          engineKind: String(workflow.engine_kind),
          category: (workflow.category as string | undefined) ?? 'image',
        },
        version: {
          version,
          engineId: (row.engine_id as string | null) ?? null,
          definition,
          inputSchema: JSON.parse(String(row.input_schema_json ?? '{}')),
          inputCapabilities: JSON.parse(String(row.input_capabilities_json ?? '{}')),
          nodeBindings: JSON.parse(String(row.node_bindings_json ?? '{}')),
          outputDeclarations: JSON.parse(String(row.output_declarations_json ?? '[]')),
          outputMediaTypes: JSON.parse(String(row.output_media_types_json ?? '[]')),
          outputSchema: JSON.parse(String(row.output_schema_json ?? '{}')),
          configFormatVersion: Number(row.config_format_version ?? 1),
          editorConfig: row.editor_config_json ? JSON.parse(String(row.editor_config_json)) : null,
        },
        presets: presets.map((preset) => ({
          name: preset.name,
          description: preset.description,
          purpose: preset.purpose,
          values: preset.values,
        })),
      };
      reply.header('content-disposition', `attachment; filename="${request.params.id}-v${version}.json"`);
      return payload;
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  // ── 试运行 ──

  app.post<{
    Params: { id: string };
    Body: {
      version?: number;
      values?: Record<string, unknown>;
      inputArtifacts?: Array<{ artifactId: string; inputKey: string }>;
      seed?: number | null;
      idempotencyKey?: string;
    };
  }>('/api/v1/admin/generation/workflows/:id/test-runs', async (request, reply) => {
    try {
      const workflow = workflowRow(database, request.params.id);
      const version = Number(request.body?.version) || Number(workflow.latest_version);
      const target = versionRow(database, request.params.id, version);
      if (!target.is_published) throw codedError('workflow_version_not_found', `版本 v${version} 尚未保存为不可变版本，无法试运行。`);
      const body = request.body ?? {};
      const values = isRecord(body.values) ? body.values : {};
      // 校验在共享生成入口执行：strict 模式在 V2 版本上拒绝未知参数与固定字段覆盖；
      // 模型选择必须落在允许列表内（库存为空时跳过库存核对，由刷新后再确认）。
      const inputSchema = parseInputSchema(target.input_schema_json);
      const editorConfig = parseEditorConfig(target.editor_config_json);
      const configFormatVersion = Number(target.config_format_version ?? 1);
      if (configFormatVersion >= 2) {
        validateValuesAgainstSchema(inputSchema, editorConfig, values, { mode: 'strict', context: 'request' });
        const engineRow = target.engine_id
          ? database.connection.prepare('SELECT id, kind, base_url, credential_account FROM generation_engines WHERE id = ?').get(String(target.engine_id)) as { id: string; kind: string; base_url: string; credential_account: string | null } | undefined
          : undefined;
        const cached = engineRow ? cachedModels({ id: engineRow.id, kind: engineRow.kind, baseUrl: engineRow.base_url, credentialAccount: engineRow.credential_account }) : null;
        validateModelSelection(editorConfig, values, cached?.items.map((item) => item.name) ?? []);
      }
      const task = await createGenerationTask(config, database, secrets, {
        appId: CREATIVE_APP_ID,
        purpose: CONFIGURATION_TEST_PURPOSE,
        workflowId: request.params.id,
        workflowVersion: version,
        isInternal: true,
        inputs: values,
        inputArtifacts: Array.isArray(body.inputArtifacts) ? body.inputArtifacts : [],
        seed: body.seed ?? null,
        testMode: true,
        validationMode: 'strict',
        priority: 'interactive',
        idempotencyKey: typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length >= 8 ? body.idempotencyKey.trim() : null,
      }, fetcher);
      return reply.code(202).send({
        ...task,
        artifacts: task.artifacts.map((artifact) => ({ ...artifact, url: `/api/v1/admin/creative/artifacts/${artifact.artifactId}` })),
      });
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.get<{ Querystring: { workflowId?: string; limit?: string } }>('/api/v1/admin/generation/test-runs', async (request, reply) => {
    try {
      const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 50);
      const clauses = ["app_id = ?", "purpose = ?"];
      const params: string[] = [CREATIVE_APP_ID, CONFIGURATION_TEST_PURPOSE];
      if (request.query.workflowId) { clauses.push('workflow_id = ?'); params.push(request.query.workflowId); }
      const rows = database.connection.prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM generation_task_artifacts ta WHERE ta.task_id = t.id) AS artifact_count
         FROM generation_tasks t WHERE ${clauses.join(' AND ')}
         ORDER BY t.created_at DESC LIMIT ?`,
      ).all(...params, limit) as Array<Record<string, unknown>>;
      return {
        items: rows.map((row) => ({
          id: String(row.id),
          workflowId: String(row.workflow_id),
          workflowVersion: Number(row.workflow_version),
          status: String(row.status),
          progress: row.progress_json ? JSON.parse(String(row.progress_json)) : undefined,
          actualSeed: row.actual_seed == null ? null : Number(row.actual_seed),
          errorCode: (row.error_code as string | null) ?? null,
          errorMessage: (row.error_message as string | null) ?? null,
          artifactCount: Number(row.artifact_count ?? 0),
          artifactIds: [] as string[],
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          finishedAt: (row.finished_at as string | null) ?? null,
        })),
      };
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/generation/test-runs/:id', async (request, reply) => {
    try {
      const row = database.connection.prepare(
        "SELECT id FROM generation_tasks WHERE id = ? AND app_id = ? AND purpose = ?",
      ).get(request.params.id, CREATIVE_APP_ID, CONFIGURATION_TEST_PURPOSE) as { id: string } | undefined;
      if (!row) throw codedError('workflow_not_found', '未找到该测试任务。');
      const task = getGenerationTask(database, request.params.id, CREATIVE_APP_ID);
      if (!task) throw codedError('workflow_not_found', '未找到该测试任务。');
      const raw = database.connection.prepare('SELECT request_params_json FROM generation_tasks WHERE id = ?')
        .get(request.params.id) as { request_params_json: string };
      let selection: Record<string, unknown> | null = null;
      let requestInputs: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(raw.request_params_json) as Record<string, unknown>;
        if (isRecord(parsed.selection)) selection = parsed.selection;
        if (isRecord(parsed.inputs)) requestInputs = parsed.inputs;
      } catch { /* keep defaults */ }
      return {
        ...task,
        artifacts: task.artifacts.map((artifact) => ({ ...artifact, url: `/api/v1/admin/creative/artifacts/${artifact.artifactId}` })),
        selection,
        requestInputs,
        artifactUrls: task.artifacts.map((artifact) => `/api/v1/admin/creative/artifacts/${artifact.artifactId}`),
      };
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  // ── 预设 ──

  app.get<{ Querystring: { appId?: string; purpose?: string; workflowId?: string } }>('/api/v1/admin/generation/presets', async (request) => ({
    items: listPresets(database, {
      appId: request.query.appId,
      purpose: request.query.purpose,
      workflowId: request.query.workflowId,
    }),
  }));

  app.post<{ Body: {
    appId?: string; purpose?: string; name?: string; description?: string;
    workflowId?: string; workflowVersion?: number; engineId?: string | null;
    values?: Record<string, unknown>; enabled?: boolean;
  } }>('/api/v1/admin/generation/presets', async (request, reply) => {
    try {
      const body = request.body ?? {};
      const preset = createPreset(database, {
        appId: String(body.appId ?? '').trim(),
        purpose: String(body.purpose ?? '').trim(),
        name: String(body.name ?? ''),
        description: body.description,
        workflowId: String(body.workflowId ?? '').trim(),
        workflowVersion: body.workflowVersion,
        engineId: body.engineId ?? null,
        values: isRecord(body.values) ? body.values : {},
        enabled: body.enabled,
      });
      return reply.code(201).send(preset);
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.put<{ Params: { id: string }; Body: {
    name?: string; description?: string; values?: Record<string, unknown>; enabled?: boolean;
    workflowId?: string; workflowVersion?: number; engineId?: string | null;
    revision?: number; clearDefault?: boolean;
  } }>('/api/v1/admin/generation/presets/:id', async (request, reply) => {
    try {
      const body = request.body ?? {};
      if (!Number.isInteger(Number(body.revision))) throw codedError('preset_revision_conflict', '编辑预设必须提供当前 revision。');
      const preset = updatePreset(database, request.params.id, {
        name: body.name,
        description: body.description,
        values: body.values,
        enabled: body.enabled,
        workflowId: body.workflowId,
        workflowVersion: body.workflowVersion,
        engineId: body.engineId,
        revision: Number(body.revision),
        clearDefault: body.clearDefault === true,
      });
      return preset;
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/generation/presets/:id', async (request, reply) => {
    try {
      deletePreset(database, request.params.id);
      return { ok: true };
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/generation/presets/:id/set-default', async (request, reply) => {
    try {
      return setDefaultPreset(database, request.params.id);
    } catch (error) {
      return sendConfigError(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: { name?: string; appId?: string; purpose?: string; workflowVersion?: number } }>(
    '/api/v1/admin/generation/presets/:id/copy',
    async (request, reply) => {
      try {
        const source = getPreset(database, request.params.id);
        if (!source) throw codedError('preset_not_found', '未找到指定预设。');
        const body = request.body ?? {};
        const preset = createPreset(database, {
          appId: body.appId?.trim() || source.appId,
          purpose: body.purpose?.trim() || source.purpose,
          name: body.name?.trim() || `${source.name} 副本`,
          description: source.description,
          workflowId: source.workflowId,
          workflowVersion: body.workflowVersion ?? source.workflowVersion,
          engineId: source.engineId,
          values: source.values,
          enabled: false,
        });
        return reply.code(201).send(preset);
      } catch (error) {
        return sendConfigError(reply, error);
      }
    },
  );
}
