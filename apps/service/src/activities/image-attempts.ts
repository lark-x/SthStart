import { createHash, randomUUID } from 'node:crypto';
import type {
  ActivityAsset,
  AttemptOutput,
  ExecutionSnapshot,
  GenerationAttempt,
  GenerationAttemptStatus,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { createArtifactReference } from '../artifacts.js';
import {
  cancelGenerationTask,
  createGenerationTask,
  getGenerationTask,
  resolveWorkflowAndEngine,
} from '../generation.js';
import { getPromptRecipe, resolveImageExecutionPlan } from './image-prompt-compiler.js';
import { recordAssetLineage } from './image-lineage.js';
import type { ActivityStore } from './store.js';

export interface CreateImageAttemptParams {
  recipeId: string;
  compilationId?: string;
  executionPlanHash?: string;
  expectedHeadVersion?: number;
  seed?: number | null;
  idempotencyKey?: string | null;
  retryOfAttemptId?: string | null;
  customInputs?: Record<string, unknown>;
  purpose?: string;
}

export function computeBusinessRequestHash(params: {
  activityId: string;
  slotId: string;
  recipeHash: string;
  executionPlanHash: string;
  seed: number | null;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(params))
    .digest('hex');
}

export async function createImageGenerationAttempt(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  activityId: string,
  params: CreateImageAttemptParams,
  fetcher: typeof fetch = fetch,
): Promise<GenerationAttempt> {
  const activity = store.getActivity(activityId);
  if (!activity) {
    throw new Error('activity_not_found');
  }



  const recipeAndComp = getPromptRecipe(database, activityId, params.recipeId);
  if (!recipeAndComp) {
    throw new Error(`recipe_not_found: recipeId '${params.recipeId}' not found for activity '${activityId}'`);
  }
  const { recipe, compilation } = recipeAndComp;

  if (params.customInputs && Object.keys(params.customInputs).length) {
    throw new Error('prepare_required: 修改输入后请重新准备提示词，不可覆盖已编译输入');
  }
  if (params.seed != null && (!Number.isSafeInteger(params.seed) || params.seed < 0)) throw new Error('invalid_seed');
  const resolvedSeed = typeof params.seed === 'number'
    ? params.seed
    : Math.floor(Math.random() * 1_000_000_000);

  const businessRequestHash = computeBusinessRequestHash({
    activityId,
    slotId: recipe.slotId,
    recipeHash: recipe.recipeHash,
    executionPlanHash: compilation.executionPlanHash,
    seed: params.seed ?? null,
  });

  // Idempotency check in activity namespace
  if (params.idempotencyKey) {
    const existingRow = database.connection.prepare(`
      SELECT * FROM activity_image_attempts WHERE activity_id = ? AND idempotency_key = ?
    `).get(activityId, params.idempotencyKey) as Record<string, unknown> | undefined;

    if (existingRow) {
      if (existingRow.business_request_hash === businessRequestHash) {
        return getImageAttempt(database, activityId, String(existingRow.id))!;
      }
      const err = new Error('已存在相同幂等键但请求参数不同的生成尝试。');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'idempotency_conflict';
      throw err;
    }
  }


  if (params.expectedHeadVersion !== undefined && activity.headVersion !== params.expectedHeadVersion) {
    const err = new Error('活动版本发生变更，请刷新后重试');
    (err as unknown as { statusCode: number; code: string }).statusCode = 409;
    (err as unknown as { code: string }).code = 'head_conflict';
    throw err;
  }

  const currentPlan = resolveImageExecutionPlan(database, recipe.references.length > 0);
  if (!currentPlan) throw Object.assign(new Error('assignment_missing: 请配置活动生图工作流'), { code: 'assignment_missing' });
  if (!compilation.executionPlan || JSON.stringify(currentPlan) !== JSON.stringify(compilation.executionPlan)
      || (params.compilationId && params.compilationId !== compilation.id)
      || (params.executionPlanHash && params.executionPlanHash !== compilation.executionPlanHash)
      || (params.purpose && params.purpose !== currentPlan.purpose)) {
    throw Object.assign(new Error('execution_plan_conflict: 工作流配置已变化或配方未冻结，请重新准备'), { code: 'execution_plan_conflict' });
  }
  const targetPurpose = currentPlan.purpose;

  const attemptId = `attempt_${randomUUID().replace(/-/g, '')}`;
  const now = nowIso();

  const inputs: Record<string, unknown> = {
    ...compilation.channels,
    ...compilation.effectiveParams,
    ...params.customInputs,
  };

  const inputArtifacts = recipe.references.map((r) => ({
    artifactId: r.artifactId,
    inputKey: r.inputKey,
  }));

  const scopedIdempotencyKey = params.idempotencyKey
    ? `act_${activityId}_${params.idempotencyKey}`
    : `act_${activityId}_${attemptId}`;

  // Call createGenerationTask with atomic onInsertTask callback
  const genTask = await createGenerationTask(
    config,
    database,
    secrets,
    {
      appId: 'activities',
      purpose: targetPurpose,
      inputs,
      inputArtifacts,
      seed: resolvedSeed,
      idempotencyKey: scopedIdempotencyKey,
      onInsertTask: (txParams) => {
        // Atomic insertion in same transaction!
        database.connection.prepare(`
          INSERT INTO activity_image_attempts (
            id, activity_id, base_content_revision_id, image_config_revision_id,
            slot_id, slot_fingerprint, recipe_id, compilation_id, recipe_hash,
            execution_plan_hash, task_id, status, actual_seed, retry_of_attempt_id,
            parent_attempt_ids_json, idempotency_key, business_request_hash,
            error_code, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        `).run(
          attemptId,
          activityId,
          recipe.contentRevisionId,
          recipe.imageConfigRevisionId,
          recipe.slotId,
          recipe.slotFingerprint,
          recipe.id,
          compilation.id,
          recipe.recipeHash,
          compilation.executionPlanHash,
          txParams.taskId,
          txParams.actualSeed,
          params.retryOfAttemptId || null,
          JSON.stringify(recipe.references.map((r) => r.parentAttemptId).filter(Boolean)),
          params.idempotencyKey || null,
          businessRequestHash,
          now,
          now,
        );

        // Snapshot prepared inputs
        database.connection.prepare(`
          INSERT INTO activity_image_execution_snapshots (
            attempt_id, phase, actual_inputs_json, uploaded_file_mappings_json, request_summary_json, created_at
          ) VALUES (?, 'prepared', ?, '{}', ?, ?)
        `).run(
          attemptId,
          JSON.stringify(txParams.workflowSnapshot),
          JSON.stringify({
            engineId: txParams.resolvedEngine.id,
            engineName: txParams.resolvedEngine.name,
            workflowId: txParams.resolvedWorkflow.id,
            workflowVersion: txParams.resolvedWorkflow.version,
          }),
          now,
        );

        // Record link
        database.connection.prepare(`
          INSERT INTO activity_media_job_links (
            task_id, activity_id, content_revision_id, slot_id, slot_fingerprint, attempt_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(task_id, slot_id) DO NOTHING
        `).run(
          txParams.taskId,
          activityId,
          recipe.contentRevisionId,
          recipe.slotId,
          recipe.slotFingerprint,
          attemptId,
          now,
        );
      },
    },
    fetcher,
  );

  return getImageAttempt(database, activityId, attemptId)!;
}

export function syncImageExecutionSnapshots(database: ServiceDatabase, activityId: string): void {
  const rows = database.connection.prepare(`SELECT a.id AS attempt_id, e.payload_json, e.created_at
    FROM activity_image_attempts a JOIN generation_events e ON e.task_id = a.task_id AND e.app_id = 'activities'
    WHERE a.activity_id = ? AND e.event_type = 'execution_dispatch_snapshot' ORDER BY e.id`)
    .all(activityId) as Array<{ attempt_id: string; payload_json: string; created_at: string }>;
  for (const row of rows) {
    const snapshot = JSON.parse(row.payload_json);
    database.connection.prepare(`INSERT INTO activity_image_execution_snapshots
      (attempt_id, phase, actual_inputs_json, uploaded_file_mappings_json, request_summary_json, created_at)
      VALUES (?, 'dispatched', ?, ?, ?, ?) ON CONFLICT(attempt_id, phase) DO NOTHING`)
      .run(row.attempt_id, JSON.stringify(snapshot.actualInputs), JSON.stringify(snapshot.uploadedFileMappings), JSON.stringify(snapshot.requestSummary), row.created_at);
  }
}

export function syncAttemptOutputs(
  database: ServiceDatabase,
  activityId: string,
  attemptId: string,
): GenerationAttempt | null {
  const attemptRow = database.connection.prepare(`
    SELECT * FROM activity_image_attempts WHERE activity_id = ? AND id = ?
  `).get(activityId, attemptId) as Record<string, unknown> | undefined;

  if (!attemptRow) return null;

  syncImageExecutionSnapshots(database, activityId);
  const taskId = String(attemptRow.task_id);
  const genTask = getGenerationTask(database, taskId, 'activities');
  if (!genTask) return null;

  const now = nowIso();

  // If task status changed
  if (genTask.status !== attemptRow.status || genTask.status === 'succeeded') {
    database.transaction(() => {
      database.connection.prepare(`
        UPDATE activity_image_attempts
        SET status = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(
        genTask.status,
        genTask.errorCode || null,
        genTask.errorMessage || null,
        now,
        attemptId,
      );

      if (genTask.status === 'succeeded') {
        const taskArtifacts = database.connection.prepare(`
          SELECT gta.artifact_id, gta.output_name, gta.sort_order,
                 art.media_type, art.byte_size, art.sha256, art.width, art.height
          FROM generation_task_artifacts gta
          JOIN artifacts art ON art.id = gta.artifact_id
          WHERE gta.task_id = ?
          ORDER BY gta.sort_order ASC
        `).all(taskId) as Array<{
          artifact_id: string;
          output_name: string;
          sort_order: number;
          media_type: string | null;
          byte_size: number;
          sha256: string;
          width: number | null;
          height: number | null;
        }>;

        for (const out of taskArtifacts) {
          // Check if already registered in activity_assets
          let assetKey: string;
          const existingAsset = database.connection.prepare(`
            SELECT asset_key FROM activity_assets WHERE activity_id = ? AND artifact_id = ?
          `).get(activityId, out.artifact_id) as { asset_key: string } | undefined;

          if (existingAsset) {
            assetKey = existingAsset.asset_key;
          } else {
            assetKey = `slot_${String(attemptRow.slot_id).slice(0, 8)}_${out.sort_order + 1}_${randomUUID().replace(/-/g, '').slice(0, 6)}`;
            database.connection.prepare(`
              INSERT INTO activity_assets (
                activity_id, asset_key, artifact_id, source, type, width, height, duration_ms, hash, created_at
              ) VALUES (?, ?, ?, 'generation', ?, ?, ?, NULL, ?, ?)
            `).run(
              activityId,
              assetKey,
              out.artifact_id,
              out.media_type ?? 'image',
              out.width,
              out.height,
              out.sha256,
              now,
            );

            createArtifactReference(database, {
              artifactId: out.artifact_id,
              appId: 'activities',
              refType: 'activity_asset',
              refId: assetKey,
            });
          }

          // Register in activity_image_attempt_outputs
          database.connection.prepare(`
            INSERT INTO activity_image_attempt_outputs (
              attempt_id, artifact_id, asset_key, output_name, sort_order, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(attempt_id, artifact_id) DO NOTHING
          `).run(
            attemptId,
            out.artifact_id,
            assetKey,
            out.output_name,
            out.sort_order,
            now,
          );

          // Record lineage if recipe had parent references
          const recipeRow = database.connection.prepare(`
            SELECT references_json FROM activity_prompt_recipes WHERE id = ?
          `).get(String(attemptRow.recipe_id)) as { references_json: string } | undefined;

          if (recipeRow) {
            try {
              const refs = JSON.parse(recipeRow.references_json) as Array<{ assetKey: string; role: string; transform?: unknown }>;
              for (const ref of refs) {
                if (ref.assetKey && ref.assetKey !== assetKey) {
                  try {
                    recordAssetLineage(database, {
                      activityId,
                      childAssetKey: assetKey,
                      parentAssetKey: ref.assetKey,
                      attemptId,
                      role: ref.role || 'init_image',
                      transformParams: ref.transform as Record<string, unknown>,
                    });
                  } catch {
                    // ignore if cycle or already linked
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        }
      }
    });
  }

  return getImageAttempt(database, activityId, attemptId);
}

export function getImageAttempt(
  database: ServiceDatabase,
  activityId: string,
  attemptId: string,
): GenerationAttempt | null {
  const row = database.connection.prepare(`
    SELECT * FROM activity_image_attempts WHERE activity_id = ? AND id = ?
  `).get(activityId, attemptId) as Record<string, unknown> | undefined;

  if (!row) return null;

  const outputs = (database.connection.prepare(`
    SELECT aio.output_name, aio.sort_order, aio.artifact_id, aio.asset_key,
           art.media_type, art.byte_size, art.sha256, art.width, art.height
    FROM activity_image_attempt_outputs aio
    JOIN artifacts art ON art.id = aio.artifact_id
    WHERE aio.attempt_id = ?
    ORDER BY aio.sort_order ASC
  `).all(attemptId) as Array<{
    output_name: string;
    sort_order: number;
    artifact_id: string;
    asset_key: string;
    media_type: string | null;
    byte_size: number;
    sha256: string;
    width: number | null;
    height: number | null;
  }>).map((o) => ({
    outputName: o.output_name,
    sortOrder: o.sort_order,
    artifactId: o.artifact_id,
    assetKey: o.asset_key,
    mediaType: o.media_type ?? 'image',
    byteSize: o.byte_size,
    sha256: o.sha256,
    width: o.width ?? undefined,
    height: o.height ?? undefined,
  }));

  return {
    id: String(row.id),
    activityId: String(row.activity_id),
    baseContentRevisionId: String(row.base_content_revision_id),
    imageConfigRevisionId: String(row.image_config_revision_id),
    slotId: String(row.slot_id),
    slotFingerprint: String(row.slot_fingerprint),
    recipeId: String(row.recipe_id),
    compilationId: String(row.compilation_id),
    recipeHash: String(row.recipe_hash),
    executionPlanHash: String(row.execution_plan_hash),
    taskId: String(row.task_id),
    status: row.status as GenerationAttemptStatus,
    actualSeed: Number(row.actual_seed),
    retryOfAttemptId: row.retry_of_attempt_id ? String(row.retry_of_attempt_id) : null,
    parentAttemptIds: JSON.parse(String(row.parent_attempt_ids_json || '[]')),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    businessRequestHash: String(row.business_request_hash),
    outputs,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listImageAttempts(
  database: ServiceDatabase,
  activityId: string,
  slotId?: string,
  limit = 50,
): GenerationAttempt[] {
  let query = 'SELECT id FROM activity_image_attempts WHERE activity_id = ?';
  const params: (string | number)[] = [activityId];

  if (slotId) {
    query += ' AND slot_id = ?';
    params.push(slotId);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = database.connection.prepare(query).all(...params) as Array<{ id: string }>;
  return rows.map((r) => getImageAttempt(database, activityId, r.id)!).filter(Boolean);
}

export async function cancelImageAttempt(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  activityId: string,
  attemptId: string,
  fetcher: typeof fetch = fetch,
): Promise<GenerationAttempt | null> {
  const attempt = getImageAttempt(database, activityId, attemptId);
  if (!attempt) return null;

  await cancelGenerationTask(config, database, secrets, attempt.taskId, 'activities', fetcher);
  return syncAttemptOutputs(database, activityId, attemptId);
}

export function resolveImageCapabilityDescriptor(
  database: ServiceDatabase,
  primaryPurpose: string,
  fallbackPurpose?: string,
): {
  purpose: string;
  configured: boolean;
  workflowValid: boolean;
  readiness: 'ready' | 'unreachable' | 'incompatible' | 'unknown';
  reasonCode?: string;
  workflowId?: string;
  workflowVersion?: number;
  engineId?: string;
  engineKind?: string;
  supportedInputs: string[];
  supportedParameters: string[];
  maxInputArtifacts: number;
} {
  let assignment = database.connection.prepare(
    'SELECT workflow_id, workflow_version, engine_id FROM app_generation_assignments WHERE app_id = ? AND purpose = ?'
  ).get('activities', primaryPurpose) as { workflow_id: string; workflow_version: number; engine_id: string } | undefined;

  let effectivePurpose = primaryPurpose;
  if (!assignment && fallbackPurpose) {
    assignment = database.connection.prepare(
      'SELECT workflow_id, workflow_version, engine_id FROM app_generation_assignments WHERE app_id = ? AND purpose = ?'
    ).get('activities', fallbackPurpose) as { workflow_id: string; workflow_version: number; engine_id: string } | undefined;
    if (assignment) effectivePurpose = fallbackPurpose;
  }

  if (!assignment) {
    return {
      purpose: primaryPurpose,
      configured: false,
      workflowValid: false,
      readiness: 'incompatible',
      reasonCode: 'not_configured',
      supportedInputs: [],
      supportedParameters: [],
      maxInputArtifacts: 0,
    };
  }

  const engine = database.connection.prepare(
    'SELECT id, name, kind, enabled, base_url FROM generation_engines WHERE id = ?'
  ).get(assignment.engine_id) as { id: string; name: string; kind: string; enabled: number; base_url: string } | undefined;

  if (!engine || !engine.enabled) {
    return {
      purpose: effectivePurpose,
      configured: true,
      workflowValid: false,
      readiness: 'unreachable',
      reasonCode: 'engine_disabled_or_missing',
      engineId: assignment.engine_id,
      engineKind: engine?.kind,
      supportedInputs: [],
      supportedParameters: [],
      maxInputArtifacts: 4,
    };
  }

  const versionRow = database.connection.prepare(`
    SELECT v.node_bindings_json, v.input_schema_json, v.input_capabilities_json
    FROM generation_workflow_versions v
    WHERE v.workflow_id = ? AND v.version = ?
  `).get(assignment.workflow_id, assignment.workflow_version) as {
    node_bindings_json: string;
    input_schema_json: string;
    input_capabilities_json: string;
  } | undefined;

  if (!versionRow) {
    return {
      purpose: effectivePurpose,
      configured: true,
      workflowValid: false,
      readiness: 'incompatible',
      reasonCode: 'workflow_version_missing',
      engineId: engine.id,
      engineKind: engine.kind,
      supportedInputs: [],
      supportedParameters: [],
      maxInputArtifacts: 4,
    };
  }

  let nodeBindings: Record<string, string[]> = {};
  try {
    nodeBindings = JSON.parse(versionRow.node_bindings_json);
  } catch {
    nodeBindings = {};
  }

  const supportedInputs = Object.keys(nodeBindings);
  const supportedParameters = supportedInputs.filter((k) => !['sourceImage', 'mask', 'init_image'].includes(k));

  return {
    purpose: effectivePurpose,
    configured: true,
    workflowValid: true,
    readiness: 'ready',
    workflowId: assignment.workflow_id,
    workflowVersion: assignment.workflow_version,
    engineId: engine.id,
    engineKind: engine.kind,
    supportedInputs,
    supportedParameters,
    maxInputArtifacts: 4,
  };
}
