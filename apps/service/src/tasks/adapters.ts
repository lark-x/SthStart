import { cancelTextJob, retryTextJob } from '../activities/text-jobs.js';
import { ActivityPlanningStore, retryPlanningJob } from '../activities/planning.js';
import { ResearchStore } from '../mcp/research-store.js';
import { cancelGenerationTask, retryGenerationTask } from '../generation.js';
import type {
  TaskDomain,
  TaskSummary,
  TasksResponse,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import {
  cancelMediaBatch,
  getMediaBatch,
  retryFailedBatchItems,
} from '../activities/media-batches.js';
import {
  cancelImageAttempt,
  createImageGenerationAttempt,
  getImageAttempt,
} from '../activities/image-attempts.js';
import { ActivityStore } from '../activities/store.js';
import { KnowledgeCollectionStore } from '../knowledge/collections.js';

export interface ListTasksOptions {
  state?: 'active' | 'recent' | 'all';
  domain?: TaskDomain;
  limit?: number;
}

export function listUnifiedTasks(
  database: ServiceDatabase,
  options?: ListTasksOptions,
): TasksResponse {
  const limit = options?.limit ?? 50;
  const filterState = options?.state ?? 'all';
  const filterDomain = options?.domain;

  const tasks: TaskSummary[] = [];

  // Helper to safely run queries even if a table doesn't exist yet
  function safeQuery<T>(fn: () => T[]): T[] {
    try {
      return fn();
    } catch {
      return [];
    }
  }

  // 1. Activity Media Batches
  if (!filterDomain || filterDomain === 'activity_media_batch') {
    const batchRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT b.id, b.activity_id, a.title as activity_title, b.created_at, b.updated_at, b.stop_requested
           FROM activity_media_batches b
           LEFT JOIN activities a ON a.id = b.activity_id
           ORDER BY b.created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
          id: string;
          activity_id: string;
          activity_title: string | null;
          created_at: string;
          updated_at: string;
          stop_requested: number;
        }>,
    );

    for (const row of batchRows) {
      const batch = getMediaBatch(database, row.activity_id, row.id);
      if (!batch) continue;

      const summary = batch.summary;
      const displayState: TaskSummary['displayState'] =
        summary.displayState === 'preparing' ? 'waiting' : summary.displayState;

      tasks.push({
        domain: 'activity_media_batch',
        taskId: row.id,
        title: `批量生图 (${row.activity_title || row.activity_id})`,
        activityId: row.activity_id,
        displayState,
        rawState: summary.displayState,
        progress: {
          completed: summary.succeeded + summary.failed + summary.skipped,
          total: summary.total,
          unit: '张',
        },
        detail: `总计 ${summary.total} 张 | 成功 ${summary.succeeded} | 失败 ${summary.failed}`,
        targetUrl: `/apps/activities/${row.activity_id}?tab=media&batchId=${row.id}`,
        capabilities: {
          cancel: displayState === 'running' || displayState === 'waiting',
          retry: displayState === 'partial' || displayState === 'failed',
        },
        cancelScope: 'pending_items',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  // 2. Activity Text Jobs
  if (!filterDomain || filterDomain === 'activity_text' || filterDomain === 'export') {
    const textRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT j.id, j.activity_id, a.title as activity_title, j.kind, j.mode, j.status, j.error_message, j.created_at, j.updated_at
           FROM activity_jobs j
           LEFT JOIN activities a ON a.id = j.activity_id
           WHERE j.kind IN ('text','export')
           ORDER BY j.created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
          id: string;
          activity_id: string;
          activity_title: string | null;
          kind: string;
          mode: string;
          status: string;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        }>,
    );

    for (const row of textRows) {
      const domain = row.kind === 'export' ? 'export' : 'activity_text';
      if (filterDomain && filterDomain !== domain) continue;
      let displayState: TaskSummary['displayState'] = 'needs_attention';
      if (['queued', 'preparing', 'submitting'].includes(row.status)) {
        displayState = 'waiting';
      } else if (['running', 'accepted'].includes(row.status)) {
        displayState = 'running';
      } else if (row.status === 'succeeded') {
        displayState = 'succeeded';
      } else if (row.status === 'failed') {
        displayState = 'failed';
      } else if (row.status === 'cancelled') {
        displayState = 'stopped';
      }

      tasks.push({
        domain,
        taskId: row.id,
        title: `${domain === 'export' ? '活动导出' : '文本生成'} (${row.activity_title || row.activity_id})`,
        activityId: row.activity_id,
        displayState,
        rawState: row.status,
        detail: row.error_message || (row.mode === 'whole-text' ? '全篇文本串行生成' : '阶段文本生成'),
        targetUrl: `/apps/activities/${row.activity_id}?tab=records&jobId=${encodeURIComponent(row.id)}`,
        capabilities: {
          cancel: domain === 'activity_text' && ['running', 'queued'].includes(row.status),
          retry: domain === 'activity_text' && ['failed', 'result_unknown'].includes(row.status),
        },
        cancelScope: 'local_tracking',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  // 3. Standalone Image Attempts
  if (!filterDomain || filterDomain === 'generation') {
    const attemptRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT att.id, att.activity_id, a.title as activity_title, att.slot_id, COALESCE(t.status,att.status) as status, COALESCE(t.error_message,att.error_message) as error_message, COALESCE(t.error_code,att.error_code) as error_code, att.created_at, COALESCE(t.updated_at,att.updated_at) as updated_at
           FROM activity_image_attempts att
           LEFT JOIN activities a ON a.id = att.activity_id
           LEFT JOIN generation_tasks t ON t.id=att.task_id
           WHERE att.id NOT IN (SELECT attempt_id FROM activity_media_batch_items WHERE attempt_id IS NOT NULL)
           ORDER BY att.created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
          id: string;
          activity_id: string;
          activity_title: string | null;
          slot_id: string;
          status: string;
          error_message: string | null;
          error_code: string | null;
          created_at: string;
          updated_at: string;
        }>,
    );

    for (const row of attemptRows) {
      let displayState: TaskSummary['displayState'] = 'needs_attention';
      if (row.error_code === 'submission_outcome_unknown') {
        displayState = 'needs_attention';
      } else if (['queued', 'preparing', 'submitting'].includes(row.status)) {
        displayState = 'waiting';
      } else if (['running', 'accepted'].includes(row.status)) {
        displayState = 'running';
      } else if (row.status === 'succeeded') {
        displayState = 'succeeded';
      } else if (row.status === 'failed') {
        displayState = 'failed';
      } else if (row.status === 'cancelled') {
        displayState = 'stopped';
      }

      tasks.push({
        domain: 'generation',
        taskId: row.id,
        title: `单图生成 (${row.activity_title || row.activity_id} - ${row.slot_id})`,
        activityId: row.activity_id,
        displayState,
        rawState: row.status,
        detail: row.error_message || undefined,
        targetUrl: `/apps/activities/${row.activity_id}?tab=media`,
        capabilities: {
          cancel: ['running', 'queued', 'preparing'].includes(row.status),
          retry: row.status === 'failed' && row.error_code !== 'submission_outcome_unknown',
        },
        cancelScope: 'local_tracking',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  // 4. Topic Collection Runs
  if (!filterDomain || filterDomain === 'topic_collection') {
    const topicRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT id, status, progress_label, error_message, created_count, merged_count, failed_count, created_at, updated_at
           FROM topic_collection_runs
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
          id: string;
          status: string;
          progress_label: string | null;
          error_message: string | null;
          created_count: number;
          merged_count: number;
          failed_count: number;
          created_at: string;
          updated_at: string;
        }>,
    );

    for (const row of topicRows) {
      let displayState: TaskSummary['displayState'] = 'needs_attention';
      if (row.status === 'queued') displayState = 'waiting';
      else if (row.status === 'running') displayState = 'running';
      else if (row.status === 'succeeded') displayState = 'succeeded';
      else if (row.status === 'partial') displayState = 'partial';
      else if (row.status === 'failed' || row.status === 'interrupted') displayState = 'failed';

      const totalItems = row.created_count + row.merged_count + row.failed_count;

      tasks.push({
        domain: 'topic_collection',
        taskId: row.id,
        title: '话题素材搜集',
        displayState,
        rawState: row.status,
        progress: totalItems > 0 ? {
          completed: row.created_count + row.merged_count,
          total: totalItems,
          unit: '条',
        } : undefined,
        detail: row.progress_label || row.error_message || undefined,
        targetUrl: '/apps/inspiration',
        capabilities: {
          cancel: false,
          retry: false,
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  // 5. Idea Generation Batches

  // 5b. 资料搜集执行（第二轮）：执行记录进统一任务中心，跳转到资料库的搜集任务页。
  if (!filterDomain || filterDomain === 'knowledge_collection') {
    const knowledgeRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT r.id, r.status, r.progress_label, r.error_message, r.new_count, r.changed_count, r.duplicate_count, r.created_at, r.updated_at, c.name collection_name
           FROM knowledge_collection_runs r
           LEFT JOIN knowledge_collections c ON c.id = r.collection_id
           ORDER BY r.created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
          id: string;
          status: string;
          progress_label: string | null;
          error_message: string | null;
          new_count: number;
          changed_count: number;
          duplicate_count: number;
          created_at: string;
          updated_at: string;
          collection_name: string | null;
        }>,
    );

    for (const row of knowledgeRows) {
      let displayState: TaskSummary['displayState'] = 'needs_attention';
      if (row.status === 'queued') displayState = 'waiting';
      else if (row.status === 'running') displayState = 'running';
      else if (row.status === 'succeeded') displayState = 'succeeded';
      else if (row.status === 'partial') displayState = 'partial';
      else if (row.status === 'cancelled') displayState = 'stopped';
      else if (row.status === 'failed' || row.status === 'interrupted') displayState = 'failed';
      const totalItems = row.new_count + row.changed_count + row.duplicate_count;
      tasks.push({
        domain: 'knowledge_collection',
        taskId: row.id,
        title: '资料搜集：' + (row.collection_name || '未命名任务'),
        displayState,
        rawState: row.status,
        progress: totalItems > 0 ? { completed: row.new_count + row.changed_count, total: totalItems, unit: '条' } : undefined,
        detail: row.progress_label || row.error_message || undefined,
        targetUrl: '/apps/notebook?view=collections',
        capabilities: {
          // 只暴露已经实现的取消能力；重试在搜集任务页内按执行记录发起。
          cancel: row.status === 'queued' || row.status === 'running',
          retry: false,
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  if (!filterDomain || filterDomain === 'backup') {
    const backupRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT r.id, r.plan_name, r.trigger, r.status, r.phase, r.scope, r.progress_label, r.error_message,
                  r.object_count, r.reused_object_count, r.created_at, r.updated_at,
                  (SELECT COALESCE(SUM(t.uploaded_bytes),0) FROM backup_target_runs t WHERE t.run_id=r.id) AS target_uploaded,
                  (SELECT COALESCE(SUM(t.total_bytes),0) FROM backup_target_runs t WHERE t.run_id=r.id) AS target_total
           FROM backup_runs r ORDER BY r.created_at DESC LIMIT 20`,
        )
        .all() as Array<{
          id: string;
          plan_name: string;
          trigger: string;
          status: string;
          phase: string;
          scope: string;
          progress_label: string | null;
          error_message: string | null;
          object_count: number;
          reused_object_count: number;
          target_uploaded: number;
          target_total: number;
          created_at: string;
          updated_at: string;
        }>,
    );

    for (const row of backupRows) {
      let displayState: TaskSummary['displayState'] = 'waiting';
      if (row.status === 'running') displayState = 'running';
      else if (row.status === 'succeeded') displayState = 'succeeded';
      else if (row.status === 'partial') displayState = 'partial';
      else if (row.status === 'cancelled') displayState = 'stopped';
      else if (row.status === 'failed' || row.status === 'interrupted') displayState = 'failed';
      // 等待解锁需要用户处理，单独提示，不算失败也不每轮刷一条错误。
      if (row.status === 'queued' && row.phase === 'waiting_unlock') displayState = 'needs_attention';
      const totalBytes = Number(row.target_total ?? 0);
      tasks.push({
        domain: 'backup',
        taskId: row.id,
        title: '云备份：' + (row.plan_name || '手动备份'),
        displayState,
        rawState: row.status + '/' + row.phase,
        progress: totalBytes > 0 ? { completed: Number(row.target_uploaded ?? 0), total: totalBytes, unit: '字节' } : undefined,
        detail: row.progress_label || row.error_message || undefined,
        targetUrl: '/settings/backups?run=' + row.id,
        capabilities: {
          // 取消只停止安排新的上传，已成功目标与可续传状态都会保留。
          cancel: row.status === 'queued' || row.status === 'running',
          retry: row.status === 'partial' || row.status === 'failed',
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  if (!filterDomain || filterDomain === 'idea_generation') {
    const ideaRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT id, status, requirement, error_message, session_id, activity_id, created_at, updated_at
           FROM activity_idea_batches
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
          id: string;
          status: string;
          requirement: string;
          error_message: string | null;
          session_id: string | null;
          activity_id: string | null;
          created_at: string;
          updated_at: string;
        }>,
    );

    for (const row of ideaRows) {
      let displayState: TaskSummary['displayState'] = 'needs_attention';
      if (row.status === 'queued') displayState = 'waiting';
      else if (row.status === 'running') displayState = 'running';
      else if (row.status === 'succeeded') displayState = 'succeeded';
      else if (row.status === 'failed') displayState = 'failed';

      tasks.push({
        domain: 'idea_generation',
        taskId: row.id,
        title: '活动点子灵感生成',
        activityId: row.activity_id || undefined,
        displayState,
        rawState: row.status,
        detail: row.error_message || (row.requirement ? `需求: ${row.requirement.slice(0, 30)}` : undefined),
        targetUrl: row.session_id ? `/apps/activities/new?session=${encodeURIComponent(row.session_id)}` : '/apps/inspiration',
        capabilities: {
          cancel: false,
          retry: false,
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  // 6. Research Tasks
  if (!filterDomain || filterDomain === 'research') {
    const researchRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT rt.id, rt.session_id, json_extract(s.form_json, '$.title') as session_title, rt.status, rt.progress_label, rt.error_message, rt.used_tool_calls, rt.budget_tool_calls, rt.created_at, rt.updated_at
           FROM planning_research_tasks rt
           LEFT JOIN activity_planning_sessions s ON s.id = rt.session_id
           ORDER BY rt.created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
          id: string;
          session_id: string;
          session_title: string | null;
          status: string;
          progress_label: string | null;
          error_message: string | null;
          used_tool_calls: number;
          budget_tool_calls: number;
          created_at: string;
          updated_at: string;
        }>,
    );

    for (const row of researchRows) {
      let displayState: TaskSummary['displayState'] = 'needs_attention';
      if (row.status === 'queued') displayState = 'waiting';
      else if (row.status === 'running') displayState = 'running';
      else if (row.status === 'partial') displayState = 'partial';
      else if (row.status === 'succeeded') displayState = 'succeeded';
      else if (row.status === 'failed') displayState = 'failed';
      else if (row.status === 'cancelled') displayState = 'stopped';

      tasks.push({
        domain: 'research',
        taskId: row.id,
        title: `背景设定研究 (${row.session_title || row.session_id})`,
        displayState,
        rawState: row.status,
        progress: row.budget_tool_calls > 0 ? {
          completed: row.used_tool_calls,
          total: row.budget_tool_calls,
          unit: '次调用',
        } : undefined,
        detail: row.progress_label || row.error_message || undefined,
        targetUrl: `/apps/activities/new?session=${encodeURIComponent(row.session_id)}`,
        capabilities: {
          cancel: ['running', 'queued'].includes(row.status),
          retry: false,
        },
        cancelScope: 'local_tracking',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  // 7. Planning Jobs
  if (!filterDomain || filterDomain === 'planning') {
    const planningRows = safeQuery(() =>
      database.connection
        .prepare(
          `SELECT pj.id, pj.session_id, json_extract(s.form_json, '$.title') as session_title, pj.status, pj.error_message, pj.created_at, pj.updated_at
           FROM activity_planning_jobs pj
           LEFT JOIN activity_planning_sessions s ON s.id = pj.session_id
           ORDER BY pj.created_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
          id: string;
          session_id: string;
          session_title: string | null;
          status: string;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        }>,
    );

    for (const row of planningRows) {
      let displayState: TaskSummary['displayState'] = 'needs_attention';
      if (row.status === 'queued') displayState = 'waiting';
      else if (row.status === 'running') displayState = 'running';
      else if (row.status === 'succeeded') displayState = 'succeeded';
      else if (row.status === 'failed') displayState = 'failed';
      else if (row.status === 'cancelled') displayState = 'stopped';

      tasks.push({
        domain: 'planning',
        taskId: row.id,
        title: `企划方案生成 (${row.session_title || row.session_id})`,
        displayState,
        rawState: row.status,
        detail: row.error_message || undefined,
        targetUrl: `/apps/activities/new?session=${encodeURIComponent(row.session_id)}`,
        capabilities: {
          cancel: ['running', 'queued'].includes(row.status),
          retry: row.status === 'failed',
        },
        cancelScope: 'local_tracking',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  if (!filterDomain || filterDomain === 'generation') {
    const rows = database.connection.prepare(`SELECT id,app_id,purpose,status,error_code,error_message,created_at,updated_at FROM generation_tasks
      WHERE id NOT IN (SELECT task_id FROM activity_image_attempts WHERE task_id IS NOT NULL)
      ORDER BY created_at DESC LIMIT ?`).all(limit) as Array<{ id: string; app_id: string; purpose: string; status: string; error_code: string; error_message: string; created_at: string; updated_at: string }>;
    for (const row of rows) {
      const active = ['queued','accepted','running','submitting'].includes(row.status);
      tasks.push({ domain: 'generation', taskId: row.id, title: `${row.app_id} · ${row.purpose}`,
        displayState: row.error_code === 'submission_outcome_unknown' || row.status === 'abandoned' ? 'needs_attention' : active ? 'running' : row.status === 'succeeded' ? 'succeeded' : row.status === 'failed' ? 'failed' : row.status === 'cancelled' ? 'stopped' : 'needs_attention',
        rawState: row.status, detail: row.error_message || undefined, targetUrl: '/apps/creative',
        capabilities: { cancel: active, retry: row.status === 'failed' && row.error_code !== 'submission_outcome_unknown' },
        cancelScope: 'local_tracking', createdAt: row.created_at, updatedAt: row.updated_at });
    }
  }

  // Sort all tasks by created_at DESC
  tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Count active tasks
  const activeCount = tasks.filter((t) => t.displayState === 'waiting' || t.displayState === 'running').length;

  // Filter by state if requested
  let filtered = tasks;
  if (filterState === 'active') {
    filtered = tasks.filter((t) => t.displayState === 'waiting' || t.displayState === 'running');
  } else if (filterState === 'recent') {
    filtered = tasks.filter((t) => t.displayState !== 'waiting' && t.displayState !== 'running');
  }

  return {
    items: filtered.slice(0, limit),
    activeCount,
  };
}

export async function cancelUnifiedTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  domain: TaskDomain,
  taskId: string,
  fetcher?: typeof fetch,
): Promise<{ success: boolean; message?: string }> {
  if (domain === 'activity_media_batch') {
    const row = database.connection
      .prepare('SELECT activity_id FROM activity_media_batches WHERE id = ?')
      .get(taskId) as { activity_id: string } | undefined;
    if (!row) throw new Error('batch_not_found');
    await cancelMediaBatch(config, database, secrets, store, row.activity_id, taskId, fetcher);
    return { success: true, message: '已请求终止生图批次' };
  }

  if (domain === 'generation') {
    const row = database.connection
      .prepare('SELECT activity_id FROM activity_image_attempts WHERE id = ?')
      .get(taskId) as { activity_id: string } | undefined;
    if (!row) {
      const task = database.connection.prepare('SELECT app_id FROM generation_tasks WHERE id=?').get(taskId) as { app_id: string } | undefined;
      if (!task) throw new Error('task_not_found');
      await cancelGenerationTask(config, database, secrets, taskId, task.app_id, fetcher);
      return { success: true, message: '已请求取消，远端可能仍在运行' };
    }
    await cancelImageAttempt(config, database, secrets, row.activity_id, taskId, fetcher);
    return { success: true, message: '已取消生图任务' };
  }

  if (domain === 'activity_text') {
    const row = database.connection.prepare("SELECT activity_id FROM activity_jobs WHERE id=? AND kind='text'").get(taskId) as { activity_id: string } | undefined;
    if (!row) throw new Error('task_not_found');
    cancelTextJob(store, row.activity_id, taskId);
    return { success: true, message: '已停止接收文本结果，远端请求可能继续运行' };
  }
  if (domain === 'research') {
    const research = new ResearchStore(database);
    const task = research.getTask(taskId);
    if (!task) throw new Error('task_not_found');
    if (['queued','running'].includes(task.status)) research.updateTask(taskId, { status: 'cancelled' });
    return { success: true, message: '已停止研究' };
  }
  if (domain === 'knowledge_collection') {
    const knowledge = new KnowledgeCollectionStore(database);
    const run = knowledge.getRun(taskId);
    if (!run) throw new Error('task_not_found');
    knowledge.cancelRun(taskId);
    return { success: true, message: '已取消本次搜集；已完成的结果会保留' };
  }
  if (domain === 'planning') {
    const row = database.connection.prepare('SELECT session_id,status FROM activity_planning_jobs WHERE id=?').get(taskId) as { session_id: string; status: string } | undefined;
    if (!row) throw new Error('task_not_found');
    if (['queued','running'].includes(row.status)) new ActivityPlanningStore(database).updateJob(taskId, { status: 'cancelled', errorMessage: '用户手动取消' });
    return { success: true, message: '已停止企划' };
  }

  throw new Error(`domain_not_cancellable: ${domain}`);
}

export async function retryUnifiedTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  store: ActivityStore,
  domain: TaskDomain,
  taskId: string,
  fetcher?: typeof fetch,
): Promise<{ success: boolean; message?: string }> {
  if (domain === 'activity_media_batch') {
    const row = database.connection
      .prepare('SELECT activity_id FROM activity_media_batches WHERE id = ?')
      .get(taskId) as { activity_id: string } | undefined;
    if (!row) throw new Error('batch_not_found');
    await retryFailedBatchItems(config, database, secrets, store, row.activity_id, taskId, fetcher);
    return { success: true, message: '已为失败条目重试生图' };
  }

  if (domain === 'generation') {
    const row = database.connection
      .prepare('SELECT activity_id FROM activity_image_attempts WHERE id = ?')
      .get(taskId) as { activity_id: string } | undefined;
    if (!row) {
      const task = database.connection.prepare('SELECT app_id FROM generation_tasks WHERE id=?').get(taskId) as { app_id: string } | undefined;
      if (!task) throw new Error('task_not_found');
      await retryGenerationTask(config, database, secrets, taskId, task.app_id, 'task_retry_' + taskId, fetcher);
      return { success: true };
    }
    const prev = getImageAttempt(database, row.activity_id, taskId);
    if (!prev) throw new Error('attempt_not_found');
    if (prev.status !== 'failed' || prev.errorCode === 'submission_outcome_unknown') throw new Error('task_not_retryable');
    await createImageGenerationAttempt(
      config,
      database,
      secrets,
      store,
      row.activity_id,
      {
        recipeId: prev.recipeId,
        seed: prev.actualSeed,
        retryOfAttemptId: prev.id,
        idempotencyKey: 'task_retry_' + prev.id,
      },
      fetcher,
    );
    return { success: true, message: '已重试生图任务' };
  }

  if (domain === 'activity_text') {
    const row = database.connection.prepare("SELECT activity_id FROM activity_jobs WHERE id=? AND kind='text'").get(taskId) as { activity_id: string } | undefined;
    if (!row) throw new Error('task_not_found');
    await retryTextJob(database, secrets, store, row.activity_id, taskId, fetcher);
    return { success: true, message: '已继续未完成的文本阶段' };
  }
  if (domain === 'planning') {
    const row = database.connection.prepare('SELECT session_id FROM activity_planning_jobs WHERE id=?').get(taskId) as { session_id: string } | undefined;
    if (!row) throw new Error('task_not_found');
    await retryPlanningJob({ config, database, secrets, store, fetcher }, row.session_id, taskId);
    return { success: true, message: '已重试企划' };
  }
  throw new Error(`domain_not_retryable: ${domain}`);
}
