import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { ServiceDatabase } from '../database.js';

/**
 * Public image generation is a single shared queue across connections and
 * modules. Engine rows still exist, but image work is grouped by provider
 * family so a second API endpoint cannot buy a second ComfyUI or GPT Image
 * slot.
 */
export const PUBLIC_IMAGE_QUEUE_LIMITS = Object.freeze({
  comfyui: 1,
  gptImage: 1,
  worker: 1,
  total: 2,
});

export type PublicImageQueueGroup = 'comfyui' | 'gpt-image' | 'worker';

export type QueueClaimReason =
  | 'claimed'
  | 'not_queued'
  | 'resume_required'
  | 'engine_unavailable'
  | 'group_full'
  | 'total_full'
  | 'queue_order';

export interface QueueClaimResult {
  claimed: boolean;
  reason: QueueClaimReason;
  image: boolean;
  group: PublicImageQueueGroup | null;
}

const IMAGE_CATEGORY_SQL = `COALESCE(
  NULLIF(w.category, ''),
  NULLIF((SELECT m.category FROM generation_workflow_media_versions m WHERE m.workflow_id=t.workflow_id AND m.version=t.workflow_version), ''),
  'image'
)`;

const QUEUE_GROUP_SQL = `CASE e.kind WHEN 'comfyui' THEN 'comfyui' WHEN 'cloud' THEN 'gpt-image' ELSE 'worker' END`;

type QueueStateKey = string | object;

// Two ServiceDatabase handles can point at the same file. Queue state must be
// shared by database location so a second connection cannot bypass the
// restart gate or the migrated-column detection.
function queueStateKey(database: ServiceDatabase): QueueStateKey {
  return database.path === ':memory:' ? database : resolve(database.path);
}

const slotSupport = new Map<QueueStateKey, boolean>();
const reconciled = new Set<QueueStateKey>();
const schedulerStarted = new Set<QueueStateKey>();

/** Runtime guard so the early scheduler ticks cannot dispatch before restart reconciliation. */
export function generationQueueReconciled(database: ServiceDatabase): boolean {
  const key = queueStateKey(database);
  // Direct library/test callers that never start the scheduler keep the old
  // immediate dispatch behavior; the server always registers the scheduler.
  return !schedulerStarted.has(key) || reconciled.has(key);
}

export function markGenerationQueueSchedulerStarted(database: ServiceDatabase): void {
  schedulerStarted.add(queueStateKey(database));
}

export function markGenerationQueueReconciled(database: ServiceDatabase): void {
  reconciled.add(queueStateKey(database));
}

/** Test-only reset for processes that reuse a database handle after a simulated crash. */
export function resetGenerationQueueReconciliation(database: ServiceDatabase): void {
  reconciled.delete(queueStateKey(database));
}

export function generationQueueSlotHeldSupported(database: ServiceDatabase): boolean {
  const key = queueStateKey(database);
  const cached = slotSupport.get(key);
  // A negative result is not cached: tests and staged deployments may apply
  // the migration after the ServiceDatabase handle was created.
  if (cached === true) return true;
  const columns = database.connection.prepare('PRAGMA table_info(generation_tasks)').all() as Array<{ name?: string }>;
  const supported = columns.some((column) => column.name === 'queue_slot_held');
  if (supported) slotSupport.set(key, true);
  return supported;
}

export function imageQueueGroup(engineKind: string): PublicImageQueueGroup | null {
  if (engineKind === 'comfyui') return 'comfyui';
  if (engineKind === 'cloud') return 'gpt-image';
  if (engineKind === 'worker') return 'worker';
  return null;
}

export function generationTaskMediaCategory(
  database: ServiceDatabase,
  workflowId: string,
  workflowVersion: number,
): string {
  const row = database.connection.prepare(`
    SELECT COALESCE(
      NULLIF(w.category, ''),
      NULLIF(v.category, ''),
      'image'
    ) AS category
    FROM generation_workflows w
    LEFT JOIN generation_workflow_media_versions v ON v.workflow_id=w.id AND v.version=?
    WHERE w.id=?
  `).get(workflowVersion, workflowId) as { category?: string } | undefined;
  return row?.category || 'image';
}

export function generationTaskIsImage(
  database: ServiceDatabase,
  task: { workflow_id?: unknown; workflow_version?: unknown },
): boolean {
  return generationTaskMediaCategory(database, String(task.workflow_id), Number(task.workflow_version)) === 'image';
}

function activeImagePredicate(): string {
  const open = "t.status IN ('submitting','accepted','running')";
  // `upstream_may_continue` is the durable truth: timeout, restart uncertainty
  // and unconfirmed cancellation keep the slot even if the row left an open
  // status. Only a confirmed terminal outcome clears it in
  // releaseGenerationQueueSlot().
  return `(${open} OR (t.upstream_may_continue = 1 AND t.status IN ('abandoned','failed','cancelled')))`;
}

function activeImageCounts(database: ServiceDatabase, excludeTaskId: string) {
  const row = database.connection.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN e.kind = 'comfyui' THEN 1 ELSE 0 END) AS comfyui,
      SUM(CASE WHEN e.kind = 'cloud' THEN 1 ELSE 0 END) AS gpt_image,
      SUM(CASE WHEN e.kind = 'worker' THEN 1 ELSE 0 END) AS worker
    FROM generation_tasks t
    JOIN generation_engines e ON e.id=t.engine_id
    LEFT JOIN generation_workflows w ON w.id=t.workflow_id
    WHERE t.id != ? AND ${IMAGE_CATEGORY_SQL} = 'image'
      AND (${activeImagePredicate()})
  `).get(excludeTaskId) as { total?: number; comfyui?: number; gpt_image?: number; worker?: number } | undefined;
  return {
    total: Number(row?.total ?? 0),
    comfyui: Number(row?.comfyui ?? 0),
    gptImage: Number(row?.gpt_image ?? 0),
    worker: Number(row?.worker ?? 0),
  };
}

function hasEarlierQueuedImageTask(
  database: ServiceDatabase,
  task: Record<string, unknown>,
  group: PublicImageQueueGroup,
): boolean {
  const earlier = database.connection.prepare(`
    SELECT 1
    FROM generation_tasks t
    JOIN generation_engines e ON e.id=t.engine_id
    LEFT JOIN generation_workflows w ON w.id=t.workflow_id
    WHERE t.id != ? AND t.status = 'queued'
      AND COALESCE(t.error_code, '') != 'studio_resume_required'
      AND e.enabled = 1
      AND ${IMAGE_CATEGORY_SQL} = 'image'
      AND ${QUEUE_GROUP_SQL} = ?
      AND (
        CASE t.priority WHEN 'interactive' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END
          < CASE ? WHEN 'interactive' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END
        OR (
          CASE t.priority WHEN 'interactive' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END
            = CASE ? WHEN 'interactive' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END
          AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
        )
      )
    LIMIT 1
  `).get(
    String(task.id),
    group,
    String(task.priority ?? 'normal'),
    String(task.priority ?? 'normal'),
    String(task.created_at),
    String(task.created_at),
    String(task.id),
  );
  return Boolean(earlier);
}

function groupCount(counts: ReturnType<typeof activeImageCounts>, group: PublicImageQueueGroup): number {
  if (group === 'comfyui') return counts.comfyui;
  if (group === 'gpt-image') return counts.gptImage;
  return counts.worker;
}

function groupLimit(group: PublicImageQueueGroup): number {
  if (group === 'gpt-image') return PUBLIC_IMAGE_QUEUE_LIMITS.gptImage;
  if (group === 'worker') return PUBLIC_IMAGE_QUEUE_LIMITS.worker;
  return PUBLIC_IMAGE_QUEUE_LIMITS.comfyui;
}

/**
 * Claim one queued task in a single write transaction. Capacity, fairness and
 * the submitting transition are evaluated together so two connections cannot
 * both observe a free slot.
 */
export function claimQueuedTaskForDispatch(database: ServiceDatabase, taskId: string): QueueClaimResult {
  const task = database.connection.prepare('SELECT * FROM generation_tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!task || task.status !== 'queued') {
    return { claimed: false, reason: 'not_queued', image: false, group: null };
  }
  if (String(task.error_code ?? '') === 'studio_resume_required') {
    return { claimed: false, reason: 'resume_required', image: false, group: null };
  }
  const engine = database.connection.prepare('SELECT * FROM generation_engines WHERE id = ?').get(String(task.engine_id)) as Record<string, unknown> | undefined;
  if (!engine) {
    return { claimed: false, reason: 'engine_unavailable', image: false, group: null };
  }

  const group = imageQueueGroup(String(engine.kind));
  const image = Boolean(group) && generationTaskIsImage(database, task);
  const slotHeld = generationQueueSlotHeldSupported(database);
  const leaseOwner = randomUUID();
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  let result: QueueClaimResult = { claimed: false, reason: 'not_queued', image, group };

  database.transaction(() => {
    if (image && group) {
      if (hasEarlierQueuedImageTask(database, task, group)) {
        result = { claimed: false, reason: 'queue_order', image, group };
        return;
      }
      const counts = activeImageCounts(database, taskId);
      if (counts.total >= PUBLIC_IMAGE_QUEUE_LIMITS.total) {
        result = { claimed: false, reason: 'total_full', image, group };
        return;
      }
      if (groupCount(counts, group) >= groupLimit(group)) {
        result = { claimed: false, reason: 'group_full', image, group };
        return;
      }
    } else {
      const limit = String(engine.kind) === 'worker'
        ? 1
        : Math.max(1, Number(engine.concurrency_limit || (String(engine.kind) === 'cloud' ? 2 : 1)));
      const active = database.connection.prepare(
        "SELECT COUNT(*) AS count FROM generation_tasks WHERE engine_id = ? AND status IN ('submitting','accepted','running') AND id != ?",
      ).get(String(task.engine_id), taskId) as { count?: number } | undefined;
      if (Number(active?.count ?? 0) >= limit) {
        result = { claimed: false, reason: 'group_full', image, group };
        return;
      }
    }

    const update = database.connection.prepare(`
      UPDATE generation_tasks
      SET status = 'submitting', lease_owner = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?),
        progress_json = ?, updated_at = ?${slotHeld ? ', queue_slot_held = 1' : ''}
      WHERE id = ? AND status = 'queued' AND COALESCE(error_code,'') != 'studio_resume_required'
    `).run(
      leaseOwner,
      leaseExpiresAt,
      now,
      JSON.stringify({ value: null, stage: 'submitting', source: 'generation' }),
      now,
      taskId,
    );
    result = Number(update.changes) > 0
      ? { claimed: true, reason: 'claimed', image, group }
      : { claimed: false, reason: 'not_queued', image, group };
  });

  return result;
}

/** Backfill in-flight tasks after restart so their slot survives an uncertain outcome. */
export function backfillGenerationQueueSlots(database: ServiceDatabase): void {
  if (!generationQueueSlotHeldSupported(database)) return;
  database.connection.prepare("UPDATE generation_tasks SET queue_slot_held = 1 WHERE status IN ('submitting','accepted','running') AND queue_slot_held = 0").run();
}

export function holdGenerationQueueSlot(database: ServiceDatabase, taskId: string): void {
  database.connection.prepare(
    `UPDATE generation_tasks SET upstream_may_continue = 1${generationQueueSlotHeldSupported(database) ? ', queue_slot_held = 1' : ''} WHERE id = ?`,
  ).run(taskId);
}

/** Release only after a confirmed terminal outcome, never merely because a lease expired. */
export function releaseGenerationQueueSlot(database: ServiceDatabase, taskId: string): void {
  database.connection.prepare(
    `UPDATE generation_tasks SET upstream_may_continue = 0${generationQueueSlotHeldSupported(database) ? ', queue_slot_held = 0' : ''} WHERE id = ?`,
  ).run(taskId);
}
