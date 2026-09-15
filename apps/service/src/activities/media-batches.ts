import { currentReviewValues, valueHash, reviewTarget } from './change-impact.js';
import type { ActivityReviewItem } from '@sthstart/contracts';
import { randomUUID, createHash } from 'node:crypto';
import type {
  ActivityMediaBatch,
  ActivityMediaBatchItem,
  ActivityMediaBatchSummary,
  ContentDocument,
  CreateMediaBatchInput,
  ImageConfigDocument,
  PrepareMediaBatchInput,
  PrepareMediaBatchOutput,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import {
  cancelImageAttempt,
  createImageGenerationAttempt,
  getImageAttempt,
  syncAttemptOutputs,
} from './image-attempts.js';
import { getImageConfigRevision } from './image-configs.js';
import {
  compilePromptRecipe,
  computeSlotFingerprint,
  resolveImageExecutionPlan,
  saveRecipeAndCompilation,
  getPromptRecipe,
} from './image-prompt-compiler.js';
import { getActivityAssetFile, listActivityAssets } from './media.js';
import type { ReferenceInput } from '@sthstart/contracts';
import type { ActivityStore } from './store.js';
import { getActivityPreset } from './presets.js';

const processing = new WeakMap<ServiceDatabase, Set<string>>();
function batchError(code: string, message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { code, statusCode });
}
function compileBatchSlot(database: ServiceDatabase, store: ActivityStore, activityId: string,
  input: PrepareMediaBatchInput, slotId: string) {
  const content = store.getContentRevision(activityId, input.contentRevisionId);
  const config = getImageConfigRevision(database, activityId, input.imageConfigRevisionId);
  if (!content || !config) batchError('revision_not_found', '请先发布活动内容与图像配置。');
  const slot = content.document.mediaSlots.find(s => s.id === slotId);
  if (!slot || slot.kind !== 'image') batchError('invalid_slot', '图片槽位不存在或不属于该内容版本。');
  const current = store.getDraft(activityId)?.document || content.document;
  if (current.editingPolicy?.lockedMediaSlotIds.includes(slotId)) batchError('media_slot_locked', '该图片槽位已锁定。');
  const slotConfig = config.document.slotConfigs?.find(s => s.slotId === slotId);
  const keys = [...new Set(slotConfig?.referenceAssetKeys ?? content.document.actors.filter(a => slot.actorIds.includes(a.id)).flatMap(a => a.appearanceReferenceAssetKeys || []))];
  const plan = resolveImageExecutionPlan(database, keys.length > 0);
  if (!plan) batchError('assignment_missing', '请配置活动文生图/图生图用途。');
  const inputKeys = plan.inputCapabilities ? Object.keys(plan.inputCapabilities).filter(key => plan.nodeBindings[key]) : plan.nodeBindings.sourceImage ? ['sourceImage'] : [];
  if (keys.length > inputKeys.length) batchError('reference_binding_missing', '工作流无法接收全部参考图，请在单图工作台调整参考图配置。');
  const assets = listActivityAssets(database, activityId);
  const references: ReferenceInput[] = keys.map((assetKey, index) => {
    const asset = assets.find(a => a.assetKey === assetKey);
    if (!asset || asset.type !== 'image' || !getActivityAssetFile(database, activityId, assetKey)) batchError('reference_missing', '参考图不可读取：' + assetKey);
    const inputKey = inputKeys[index];
    return { referenceId: `batch_ref_${slotId}_${index}`, assetKey, artifactId: asset.artifactId, sha256: asset.sha256 || '', inputKey, role: plan.inputCapabilities?.[inputKey]?.semantic || 'init_image' };
  });
  return compilePromptRecipe({ activityId, contentRevisionId: content.id, contentDoc: content.document,
    imageConfigRevisionId: config.id, imageConfigDoc: config.document, slotId, executionPlan: plan, references });
}
function isSlotBusy(database: ServiceDatabase, activityId: string, slotId: string): boolean {
  return Boolean(database.connection.prepare(`SELECT 1 FROM activity_media_batch_items i JOIN activity_media_batches b ON b.id=i.batch_id
    LEFT JOIN activity_image_attempts a ON a.id=i.attempt_id LEFT JOIN generation_tasks t ON t.id=a.task_id
    WHERE b.activity_id=? AND i.slot_id=? AND (
      (i.attempt_id IS NULL AND i.state IN ('waiting','preparing')) OR
      COALESCE(t.status,a.status) IN ('preparing','submitting','queued','accepted','running','abandoned','result_unknown') OR
      COALESCE(t.error_code,a.error_code)='submission_outcome_unknown') LIMIT 1`).get(activityId, slotId)) ||
    Boolean(database.connection.prepare(`SELECT 1 FROM activity_image_attempts a LEFT JOIN generation_tasks t ON t.id=a.task_id
      WHERE a.activity_id=? AND a.slot_id=? AND (COALESCE(t.status,a.status) IN ('queued','running','submitting','accepted','abandoned','result_unknown')
      OR COALESCE(t.error_code,a.error_code)='submission_outcome_unknown') LIMIT 1`).get(activityId, slotId));
}

function computeBatchRequestHash(params: {
  activityId: string;
  contentRevisionId: string;
  imageConfigRevisionId: string;
  productionPresetId?: string;
  items: Array<{ slotId: string; candidateCount: number }>;
}): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex');
}

export function prepareMediaBatch(
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  input: PrepareMediaBatchInput,
): PrepareMediaBatchOutput {
  const activity = store.getActivity(activityId);
  if (!activity) {
    throw new Error('activity_not_found');
  }

  const contentRev = store.getContentRevision(activityId, input.contentRevisionId);
  if (!contentRev) {
    throw new Error(`content_revision_not_found: ${input.contentRevisionId}`);
  }
  const contentDoc: ContentDocument = contentRev.document;

  const imageConfigRev = getImageConfigRevision(database, activityId, input.imageConfigRevisionId);
  if (!imageConfigRev) {
    throw new Error(`image_config_revision_not_found: ${input.imageConfigRevisionId}`);
  }

  const slotMap = new Map((contentDoc.mediaSlots || []).map((s) => [s.id, s]));
  const readyItems: PrepareMediaBatchOutput['readyItems'] = [];
  const unreadyItems: PrepareMediaBatchOutput['unreadyItems'] = [];

  for (const slotId of input.slotIds) {
    const slot = slotMap.get(slotId);
    if (!slot) {
      unreadyItems.push({
        slotId,
        slotCaption: '未知槽位',
        reason: '槽位在指定内容版本中不存在',
      });
      continue;
    }

    if (slot.kind !== 'image') {
      unreadyItems.push({
        slotId,
        slotCaption: slot.caption || slot.id,
        reason: `槽位类型为 ${slot.kind}，批量生图仅支持图片槽位`,
      });
      continue;
    }

    try {
      if (isSlotBusy(database, activityId, slotId)) batchError('slot_busy', '该槽位已有在途或待核对的任务。');
      const { compilation } = compileBatchSlot(database, store, activityId, input, slotId);
      readyItems.push({ slotId, slotCaption: slot.caption, workflowPurpose: compilation.executionPlan!.purpose, ready: true,
        reason: '用途与输入配置已校验，具体引擎依赖仍需执行时检查。' });
    } catch (error) {
      unreadyItems.push({ slotId, slotCaption: slot.caption, reason: (error as Error).message });
    }
  }

  return {
    readyItems,
    unreadyItems,
    allReady: unreadyItems.length === 0 && readyItems.length > 0,
  };
}

export function getMediaBatch(
  database: ServiceDatabase,
  activityId: string,
  batchId: string,
): ActivityMediaBatch | null {
  const batchRow = database.connection.prepare(`
    SELECT id, activity_id, content_revision_id, image_config_revision_id,
           request_hash, idempotency_key, stop_requested, options_json,
           created_at, updated_at
    FROM activity_media_batches
    WHERE activity_id = ? AND id = ?
  `).get(activityId, batchId) as {
    id: string;
    activity_id: string;
    content_revision_id: string;
    image_config_revision_id: string;
    request_hash: string;
    idempotency_key: string | null;
    stop_requested: number;
    options_json: string;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!batchRow) return null;

  const itemRows = database.connection.prepare(`
    SELECT id, batch_id, slot_id, candidate_index, slot_fingerprint,
           input_snapshot_json, recipe_id, compilation_id, attempt_id,
           generation_task_id, state, error_json, retry_of_item_id,
           created_at, updated_at
    FROM activity_media_batch_items
    WHERE batch_id = ?
    ORDER BY slot_id ASC, candidate_index ASC
  `).all(batchId) as Array<{
    id: string;
    batch_id: string;
    slot_id: string;
    candidate_index: number;
    slot_fingerprint: string;
    input_snapshot_json: string;
    recipe_id: string | null;
    compilation_id: string | null;
    attempt_id: string | null;
    generation_task_id: string | null;
    state: string;
    error_json: string;
    retry_of_item_id: string | null;
    created_at: string;
    updated_at: string;
  }>;

  let waitingCount = 0;
  let preparingCount = 0;
  let runningCount = 0;
  let succeededCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let needsAttention = false;

  const items: ActivityMediaBatchItem[] = itemRows.map((row) => {
    let effectiveState = row.state as ActivityMediaBatchItem['state'];
    const attempt = row.attempt_id ? (syncAttemptOutputs(database, activityId, row.attempt_id) || getImageAttempt(database, activityId, row.attempt_id)) : undefined;

    // If item has attempt, inspect attempt status
    if (attempt) {
      if (attempt.errorCode === 'submission_outcome_unknown' || attempt.status === 'abandoned' || attempt.status === 'result_unknown') {
        needsAttention = true;
        effectiveState = 'preparing';
      } else if (attempt.status === 'succeeded') {
        effectiveState = 'linked';
        if (row.state !== 'linked') {
          database.connection.prepare(
            'UPDATE activity_media_batch_items SET state = ?, updated_at = ? WHERE id = ?'
          ).run('linked', nowIso(), row.id);
        }
      } else if (attempt.status === 'failed') {
        effectiveState = 'failed';
        if (row.state !== 'failed') {
          database.connection.prepare(
            'UPDATE activity_media_batch_items SET state = ?, error_json = ?, updated_at = ? WHERE id = ?'
          ).run('failed', JSON.stringify({ message: attempt.errorMessage || '生图任务失败' }), nowIso(), row.id);
        }
      } else if (attempt.status === 'cancelled') {
        effectiveState = 'skipped';
        if (row.state !== 'skipped') {
          database.connection.prepare(
            'UPDATE activity_media_batch_items SET state = ?, updated_at = ? WHERE id = ?'
          ).run('skipped', nowIso(), row.id);
        }
      } else if (['running','queued','accepted','submitting','preparing'].includes(attempt.status)) {
        effectiveState = 'preparing';
        runningCount++;
      }
    }

    if (effectiveState === 'waiting') waitingCount++;
    else if (effectiveState === 'preparing' && !attempt) preparingCount++;
    else if (effectiveState === 'linked') succeededCount++;
    else if (effectiveState === 'failed') failedCount++;
    else if (effectiveState === 'skipped') skippedCount++;

    return {
      id: row.id,
      batchId: row.batch_id,
      slotId: row.slot_id,
      candidateIndex: row.candidate_index,
      slotFingerprint: row.slot_fingerprint,
      inputSnapshot: JSON.parse(row.input_snapshot_json || '{}'),
      recipeId: row.recipe_id || undefined,
      compilationId: row.compilation_id || undefined,
      attemptId: row.attempt_id || undefined,
      generationTaskId: row.generation_task_id || undefined,
      state: effectiveState,
      error: row.error_json ? JSON.parse(row.error_json) : undefined,
      retryOfItemId: row.retry_of_item_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attemptOutputs: attempt?.outputs,
      actualSeed: attempt?.actualSeed,
    };
  });

  const total = items.length;
  let displayState: ActivityMediaBatchSummary['displayState'] = 'preparing';
  if (needsAttention) {
    displayState = 'needs_attention';
  } else if (Boolean(batchRow.stop_requested) && runningCount === 0 && preparingCount === 0) {
    displayState = 'stopped';
  } else if (runningCount > 0 || preparingCount > 0) {
    displayState = 'running';
  } else if (succeededCount === total && total > 0) {
    displayState = 'succeeded';
  } else if (failedCount > 0 && succeededCount > 0 && waitingCount === 0) {
    displayState = 'partial';
  } else if (failedCount > 0 && succeededCount === 0 && waitingCount === 0) {
    displayState = 'failed';
  } else if (waitingCount > 0) {
    displayState = 'preparing';
  }

  const summary: ActivityMediaBatchSummary = {
    total,
    waiting: waitingCount,
    preparing: preparingCount,
    running: runningCount,
    succeeded: succeededCount,
    failed: failedCount,
    skipped: skippedCount,
    displayState,
  };

  return {
    id: batchRow.id,
    activityId: batchRow.activity_id,
    contentRevisionId: batchRow.content_revision_id,
    imageConfigRevisionId: batchRow.image_config_revision_id,
    requestHash: batchRow.request_hash,
    idempotencyKey: batchRow.idempotency_key || undefined,
    stopRequested: Boolean(batchRow.stop_requested),
    options: JSON.parse(batchRow.options_json || '{}'),
    items,
    summary,
    createdAt: batchRow.created_at,
    updatedAt: batchRow.updated_at,
  };
}

export function listMediaBatches(
  database: ServiceDatabase,
  activityId: string,
): ActivityMediaBatch[] {
  const rows = database.connection.prepare(`
    SELECT id FROM activity_media_batches WHERE activity_id = ? ORDER BY created_at DESC
  `).all(activityId) as Array<{ id: string }>;

  return rows
    .map((r) => getMediaBatch(database, activityId, r.id))
    .filter((b): b is ActivityMediaBatch => b !== null);
}

export async function createMediaBatch(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  activityId: string,
  input: CreateMediaBatchInput,
  fetcher?: typeof fetch,
): Promise<ActivityMediaBatch> {
  const activity = store.getActivity(activityId);
  if (!activity) {
    throw new Error('activity_not_found');
  }

  if (!input.items?.length || input.items.length > 100 || new Set(input.items.map(i => i.slotId)).size !== input.items.length || input.items.some(i => ![1,2,3].includes(i.candidateCount))) {
    batchError('invalid_items', '请选择不重复的槽位，每项生成 1～3 张。');
  }
  const requestHash = computeBatchRequestHash({ activityId, contentRevisionId: input.contentRevisionId,
    imageConfigRevisionId: input.imageConfigRevisionId, productionPresetId: input.productionPresetId, items: input.items });
  if (input.idempotencyKey) {
    const existing = database.connection.prepare('SELECT id,request_hash FROM activity_media_batches WHERE activity_id=? AND idempotency_key=?')
      .get(activityId, input.idempotencyKey) as { id: string; request_hash: string } | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) batchError('idempotency_conflict', '相同幂等键对应不同请求。', 409);
      return getMediaBatch(database, activityId, existing.id)!;
    }
  }
  if (activity.headVersion !== input.expectedHeadVersion || activity.currentContentRevisionId !== input.contentRevisionId) {
    batchError('head_version_conflict', '活动版本已变化，请确认当前内容后重试。', 409);
  }
  const contentRev = store.getContentRevision(activityId, input.contentRevisionId);
  if (!contentRev) {
    throw new Error(`content_revision_not_found: ${input.contentRevisionId}`);
  }
  const contentDoc: ContentDocument = contentRev.document;

  const imageConfigRev = getImageConfigRevision(database, activityId, input.imageConfigRevisionId);
  if (!imageConfigRev) {
    throw new Error(`image_config_revision_not_found: ${input.imageConfigRevisionId}`);
  }
  const imageConfigDoc: ImageConfigDocument = imageConfigRev.document;

  const preset = input.productionPresetId ? getActivityPreset(database, input.productionPresetId) : null;
  if (input.productionPresetId && (!preset || preset.kind !== 'production_preset')) batchError('preset_not_found', '生产预设不存在，请重新选择。');
  const slotMap = new Map((contentDoc.mediaSlots || []).map((s) => [s.id, s]));
  const batchId = randomUUID();
  const now = nowIso();

  database.transaction(() => {
    const prepared = new Map(input.items.map(item => {
      if (isSlotBusy(database, activityId, item.slotId)) batchError('slot_busy', '该槽位已有未完成任务：' + item.slotId, 409);
      return [item.slotId, compileBatchSlot(database, store, activityId, { ...input, slotIds: [item.slotId] }, item.slotId)];
    }));
    database.connection.prepare(`
      INSERT INTO activity_media_batches (
        id, activity_id, content_revision_id, image_config_revision_id,
        request_hash, idempotency_key, stop_requested, options_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      batchId,
      activityId,
      input.contentRevisionId,
      input.imageConfigRevisionId,
      requestHash,
      input.idempotencyKey || null,
      JSON.stringify({ productionPresetId: input.productionPresetId || null, productionPresetSnapshot: preset ? { id: preset.id, name: preset.name, version: preset.version, payload: preset.payload } : null }),
      now,
      now,
    );

    const reviews=database.connection.prepare("SELECT id,data_json FROM activity_review_items WHERE activity_id=? AND target_kind='image' AND decision='rework'").all(activityId) as Array<{id:string;data_json:string}>;
    for(const row of reviews){const item=JSON.parse(row.data_json) as ActivityReviewItem;
      if(input.items.some(i=>i.slotId===item.targetId)&&valueHash(currentReviewValues(database.connection,activityId,contentDoc,item))===item.sourceHash&&valueHash(reviewTarget(contentDoc,'image',item.targetId))===item.targetHash)
        database.connection.prepare('UPDATE activity_review_items SET execution_json=?,updated_at=? WHERE id=?').run(JSON.stringify({kind:'image',id:batchId}),now,row.id);
    }
    for (const itemInput of input.items) {
      const slot = slotMap.get(itemInput.slotId);
      if (!slot) batchError('invalid_slot', '槽位不存在。');
      const compiled = prepared.get(itemInput.slotId)!;
      saveRecipeAndCompilation(database, compiled.recipe, compiled.compilation, true);

      const slotFingerprint = computeSlotFingerprint(slot, contentDoc);
      const count = Math.min(3, Math.max(1, itemInput.candidateCount));

      for (let idx = 0; idx < count; idx++) {
        const itemId = randomUUID();
        database.connection.prepare(`
          INSERT INTO activity_media_batch_items (
            id, batch_id, slot_id, candidate_index, slot_fingerprint,
            input_snapshot_json, recipe_id, compilation_id, attempt_id,
            generation_task_id, state, error_json, retry_of_item_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'waiting', '{}', NULL, ?, ?)
        `).run(
          itemId,
          batchId,
          itemInput.slotId,
          idx,
          slotFingerprint,
          JSON.stringify({ seed: Math.floor(Math.random() * 1_000_000_000), recipeId: compiled.recipe.id, compilationId: compiled.compilation.id, executionPlanHash: compiled.compilation.executionPlanHash }),
          now,
          now,
        );
      }
    }
  });

  // Launch execution asynchronously
  setImmediate(() => {
    void processMediaBatch(config, database, secrets, store, activityId, batchId, fetcher).catch(() => {});
  });

  return getMediaBatch(database, activityId, batchId)!;
}

export async function processMediaBatch(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  activityId: string,
  batchId: string,
  fetcher?: typeof fetch,
): Promise<void> {
  let active = processing.get(database);
  if (!active) { active = new Set(); processing.set(database, active); }
  if (active.has(batchId)) return;
  active.add(batchId);
  try {
    const batch = database.connection.prepare(`
      SELECT content_revision_id, image_config_revision_id, stop_requested
      FROM activity_media_batches WHERE id = ?
    `).get(batchId) as {
      content_revision_id: string;
      image_config_revision_id: string;
      stop_requested: number;
    } | undefined;

    if (!batch || Boolean(batch.stop_requested)) return;

    const contentRev = store.getContentRevision(activityId, batch.content_revision_id);
    const imageConfigRev = getImageConfigRevision(database, activityId, batch.image_config_revision_id);
    if (!contentRev || !imageConfigRev) return;

    const contentDoc: ContentDocument = contentRev.document;
    const imageConfigDoc: ImageConfigDocument = imageConfigRev.document;
    const slotMap = new Map((contentDoc.mediaSlots || []).map((s) => [s.id, s]));

    const waitingItems = database.connection.prepare(`
      SELECT id, slot_id, candidate_index, input_snapshot_json FROM activity_media_batch_items
      WHERE batch_id = ? AND state IN ('waiting', 'preparing') AND attempt_id IS NULL
      ORDER BY slot_id ASC, candidate_index ASC
    `).all(batchId) as Array<{ id: string; slot_id: string; candidate_index: number; input_snapshot_json: string }>;

    for (const item of waitingItems) {
      // Check cancellation
      const currentBatch = database.connection.prepare(
        'SELECT stop_requested FROM activity_media_batches WHERE id = ?'
      ).get(batchId) as { stop_requested: number } | undefined;

      if (Boolean(currentBatch?.stop_requested)) {
        database.connection.prepare(
          "UPDATE activity_media_batch_items SET state = 'skipped', updated_at = ? WHERE batch_id = ? AND state = 'waiting'"
        ).run(nowIso(), batchId);
        break;
      }

      const slot = slotMap.get(item.slot_id);
      if (!slot) {
        database.connection.prepare(
          "UPDATE activity_media_batch_items SET state = 'failed', error_json = ?, updated_at = ? WHERE id = ?"
        ).run(JSON.stringify({ message: '槽位不存在' }), nowIso(), item.id);
        continue;
      }

      database.connection.prepare(
        "UPDATE activity_media_batch_items SET state = 'preparing', updated_at = ? WHERE id = ?"
      ).run(nowIso(), item.id);

      try {
        const idempotencyKey = `batch_item_${item.id}`;
        const existing = database.connection.prepare('SELECT id FROM activity_image_attempts WHERE activity_id=? AND idempotency_key=?')
          .get(activityId, idempotencyKey) as { id: string } | undefined;
        let snapshot = JSON.parse(item.input_snapshot_json || '{}');
        let compiled = snapshot.recipeId ? getPromptRecipe(database, activityId, snapshot.recipeId) : null;
        if (!compiled?.compilation.executionPlan) {
          compiled = compileBatchSlot(database, store, activityId, { contentRevisionId: batch.content_revision_id,
            imageConfigRevisionId: batch.image_config_revision_id, slotIds: [item.slot_id] }, item.slot_id);
          saveRecipeAndCompilation(database, compiled.recipe, compiled.compilation);
          snapshot = { seed: snapshot.seed ?? Math.floor(Math.random() * 1_000_000_000), recipeId: compiled.recipe.id,
            compilationId: compiled.compilation.id, executionPlanHash: compiled.compilation.executionPlanHash };
        }
        const { recipe, compilation } = compiled;
        database.connection.prepare('UPDATE activity_media_batch_items SET recipe_id=?,compilation_id=?,input_snapshot_json=? WHERE id=?')
          .run(recipe.id, compilation.id, JSON.stringify(snapshot), item.id);
        const attempt = existing ? getImageAttempt(database, activityId, existing.id)! : await createImageGenerationAttempt(
          config, database, secrets, store, activityId,
          { recipeId: recipe.id, compilationId: compilation.id, executionPlanHash: compilation.executionPlanHash,
            seed: snapshot.seed, idempotencyKey }, fetcher);
        const isSucceeded = attempt.status === 'succeeded';
        const isFailed = attempt.status === 'failed';
        const newState = isSucceeded ? 'linked' : isFailed ? 'failed' : 'preparing';
        const errorJson = isFailed ? JSON.stringify({ message: attempt.errorMessage || '生图失败' }) : '{}';

        database.connection.prepare(`
          UPDATE activity_media_batch_items
          SET recipe_id = ?, compilation_id = ?, attempt_id = ?, generation_task_id = ?,
              state = ?, error_json = ?, updated_at = ?
          WHERE id = ?
        `).run(
          recipe.id,
          compilation.id,
          attempt.id,
          attempt.taskId || null,
          newState,
          errorJson,
          nowIso(),
          item.id,
        );
        if (database.connection.prepare('SELECT stop_requested FROM activity_media_batches WHERE id=?').get(batchId)?.stop_requested) {
          await cancelImageAttempt(config, database, secrets, activityId, attempt.id, fetcher);
          break;
        }
      } catch (err) {
        if (String(err).includes('database is not open')) return;
        const msg = err instanceof Error ? err.message : String(err);
        database.connection.prepare(
          "UPDATE activity_media_batch_items SET state = 'failed', error_json = ?, updated_at = ? WHERE id = ?"
        ).run(JSON.stringify({ message: msg }), nowIso(), item.id);
      }
    }

    database.connection.prepare(
      'UPDATE activity_media_batches SET updated_at = ? WHERE id = ?'
    ).run(nowIso(), batchId);
  } catch (err) {
    if (String(err).includes('database is not open')) return;
    throw err;
  } finally { active.delete(batchId); }
}

export async function cancelMediaBatch(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  activityId: string,
  batchId: string,
  fetcher?: typeof fetch,
): Promise<ActivityMediaBatch> {
  const batch = getMediaBatch(database, activityId, batchId);
  if (!batch) {
    throw new Error('batch_not_found');
  }

  const now = nowIso();
  database.transaction(() => {
    database.connection.prepare(
      'UPDATE activity_media_batches SET stop_requested = 1, updated_at = ? WHERE id = ?'
    ).run(now, batchId);

    database.connection.prepare(
      "UPDATE activity_media_batch_items SET state = 'skipped', updated_at = ? WHERE batch_id = ? AND state IN ('waiting', 'preparing') AND attempt_id IS NULL"
    ).run(now, batchId);
  });

  // Cancel any active attempts
  for (const item of batch.items) {
    if (item.attemptId && (item.state === 'waiting' || item.state === 'preparing')) {
      try {
        await cancelImageAttempt(config, database, secrets, activityId, item.attemptId, fetcher);
      } catch {
        // ignore attempt cancel errors
      }
    }
  }

  return getMediaBatch(database, activityId, batchId)!;
}

export async function retryFailedBatchItems(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  activityId: string,
  batchId: string,
  fetcher?: typeof fetch,
): Promise<ActivityMediaBatch> {
  const batch = getMediaBatch(database, activityId, batchId);
  if (!batch) {
    throw new Error('batch_not_found');
  }

  const failed = batch.items.filter(item => item.state === 'failed');
  if (!failed.length) batchError('nothing_to_retry', '没有可直接重试的失败项。');
  const previous = database.connection.prepare("SELECT id FROM activity_media_batches WHERE activity_id=? AND json_extract(options_json,'$.retryOfBatchId')=? ORDER BY created_at DESC LIMIT 1")
    .get(activityId, batchId) as { id: string } | undefined;
  if (previous) return getMediaBatch(database, activityId, previous.id)!;
  const id = randomUUID(), now = nowIso();
  database.transaction(() => {
    for (const item of failed) if (isSlotBusy(database, activityId, item.slotId)) batchError('slot_busy', '槽位仍有在途任务。', 409);
    database.connection.prepare(`INSERT INTO activity_media_batches
      (id,activity_id,content_revision_id,image_config_revision_id,request_hash,stop_requested,options_json,created_at,updated_at)
      VALUES (?,?,?,?,?,0,?,?,?)`).run(id, activityId, batch.contentRevisionId, batch.imageConfigRevisionId, batch.requestHash,
        JSON.stringify({ ...batch.options, retryOfBatchId: batchId }), now, now);
    for (const item of failed) database.connection.prepare(`INSERT INTO activity_media_batch_items
      (id,batch_id,slot_id,candidate_index,slot_fingerprint,input_snapshot_json,recipe_id,compilation_id,state,error_json,retry_of_item_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'waiting','{}',?,?,?)`).run(randomUUID(), id, item.slotId, item.candidateIndex, item.slotFingerprint,
        JSON.stringify(item.inputSnapshot), item.recipeId || null, item.compilationId || null, item.id, now, now);
  });
  setImmediate(() => void processMediaBatch(config, database, secrets, store, activityId, id, fetcher).catch(() => {}));
  return getMediaBatch(database, activityId, id)!;
}

export function reconcileMediaBatchesOnStartup(database: ServiceDatabase, config?: ServiceConfig, secrets?: SecretStore, store?: ActivityStore, fetcher?: typeof fetch): number {
  const rows = database.connection.prepare(`SELECT DISTINCT b.id,b.activity_id FROM activity_media_batches b JOIN activity_media_batch_items i ON i.batch_id=b.id
    WHERE b.stop_requested=0 AND i.state IN ('waiting','preparing') AND i.attempt_id IS NULL`).all() as Array<{ id: string; activity_id: string }>;
  if (config && secrets && store) for (const row of rows) {
    setImmediate(() => void processMediaBatch(config, database, secrets, store, row.activity_id, row.id, fetcher).catch(() => {}));
  }
  return rows.length;
}
