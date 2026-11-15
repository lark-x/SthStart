import { createHash, randomUUID } from 'node:crypto';
import type {
  GenerationTaskDescriptor,
  PlanWorldImages,
  SubmitWorldImage,
  WorldActor,
  WorldDefinition,
  WorldEvent,
  WorldImage,
  WorldRun,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { createGenerationTask } from '../generation/execution.js';
import { getGenerationTask } from '../generation/task-store.js';
import { createArtifactGrant, hasArtifactAccess } from '../artifacts.js';
import type { SecretStore } from '../security.js';
import { StoryWorldError, StoryWorldStore } from './store.js';
import { composeReferenceArtifactIds, summarizeEventVisualReferences } from './visual-references.js';
import { ensureEnglishImagePrompt } from './image-prompt-language.js';
import { resolveActivityImagePromptPolicy } from '../activities/image-prompt-policies.js';

export interface StoryWorldImagesContext {
  database: ServiceDatabase;
  config: ServiceConfig;
  secrets: SecretStore;
  fetcher?: typeof fetch;
  store?: StoryWorldStore;
}

const STORY_WORLDS_APP_ID = 'story-worlds';
const MANUAL_MAX_IMAGES_BUDGET = 12;
const REFERENCE_GRANT_TTL_SECONDS = 24 * 60 * 60;
const SUBMISSION_LEASE_REF_TYPE = 'story-world-image-lease';

function mapTaskStatus(status: string, upstreamMayContinue = false): WorldImage['status'] {
  // 规划与协作要求：upstreamMayContinue 不管底层处于 failed、cancelled 还是 abandoned，都必须判定为 uncertain
  if (upstreamMayContinue) {
    return 'uncertain';
  }
  switch (status) {
    case 'queued':
    case 'submitting':
      return 'queued';
    case 'accepted':
    case 'running':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'cancelled':
      return 'stale';
    case 'abandoned':
      return 'uncertain';
    case 'failed':
    default:
      return 'failed';
  }
}

function hasColumn(database: ServiceDatabase, table: string, column: string): boolean {
  try {
    const columns = database.connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    return columns.some((col) => col.name === column);
  } catch {
    return false;
  }
}

function ensureSubmissionsTable(database: ServiceDatabase): void {
  database.connection.exec(`
    CREATE TABLE IF NOT EXISTS sw_image_submissions (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      run_id TEXT,
      status TEXT NOT NULL,
      task_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(branch_id, idempotency_key)
    )
  `);
}

function resolveWorkflowForEngine(
  database: ServiceDatabase,
  engineId: string,
  engineKind: string,
): { id: string; version: number } | null {
  const byEngine = database.connection.prepare(`
    SELECT w.id, v.version
    FROM generation_workflows w
    JOIN generation_workflow_versions v ON v.workflow_id=w.id
    WHERE v.engine_id=? AND v.is_published=1 AND w.archived_at IS NULL AND (w.category IS NULL OR w.category='image')
    ORDER BY v.version DESC LIMIT 1
  `).get(engineId) as { id: string; version: number } | undefined;
  if (byEngine) return byEngine;

  const byKind = database.connection.prepare(`
    SELECT w.id, v.version
    FROM generation_workflows w
    JOIN generation_workflow_versions v ON v.workflow_id=w.id
    WHERE w.engine_kind=? AND v.is_published=1 AND w.archived_at IS NULL AND (w.category IS NULL OR w.category='image')
    ORDER BY v.version DESC LIMIT 1
  `).get(engineKind) as { id: string; version: number } | undefined;
  return byKind ?? null;
}

export class StoryWorldImages {
  readonly database: ServiceDatabase;
  readonly config: ServiceConfig;
  readonly secrets: SecretStore;
  readonly fetcher: typeof fetch;
  readonly store: StoryWorldStore;

  private readonly hasRunIdCol: boolean;
  private startupRecoveryCompleted = false;

  constructor(context: StoryWorldImagesContext) {
    this.database = context.database;
    this.config = context.config;
    this.secrets = context.secrets;
    this.fetcher = context.fetcher ?? fetch;
    this.store = context.store ?? new StoryWorldStore(context.database);
    this.hasRunIdCol = hasColumn(this.database, 'sw_images', 'run_id');
    ensureSubmissionsTable(this.database);
  }

  private saveImageRow(image: WorldImage): void {
    const now = nowIso();
    if (this.hasRunIdCol) {
      this.database.connection.prepare(`
        INSERT INTO sw_images(id, world_id, branch_id, event_id, status, run_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          run_id = excluded.run_id,
          data_json = excluded.data_json,
          updated_at = excluded.updated_at
      `).run(
        image.id,
        image.worldId,
        image.branchId,
        image.eventId,
        image.status,
        image.runId,
        JSON.stringify(image),
        image.createdAt || now,
        now,
      );
    } else {
      this.database.connection.prepare(`
        INSERT INTO sw_images(id, world_id, branch_id, event_id, status, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          data_json = excluded.data_json,
          updated_at = excluded.updated_at
      `).run(
        image.id,
        image.worldId,
        image.branchId,
        image.eventId,
        image.status,
        JSON.stringify(image),
        image.createdAt || now,
        now,
      );
    }
  }

  private createSubmissionLeases(artifactIds: string[], submissionId: string): void {
    const now = nowIso();
    for (const artifactId of artifactIds) {
      this.database.connection.prepare(`
        INSERT INTO artifact_references(id, artifact_id, app_id, ref_type, ref_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        artifactId,
        STORY_WORLDS_APP_ID,
        SUBMISSION_LEASE_REF_TYPE,
        submissionId,
        now,
      );
    }
  }

  private deleteSubmissionLeases(submissionId: string): void {
    this.database.connection.prepare(
      'DELETE FROM artifact_references WHERE app_id=? AND ref_type=? AND ref_id=?',
    ).run(STORY_WORLDS_APP_ID, SUBMISSION_LEASE_REF_TYPE, submissionId);
  }

  private applyRecoveredTaskToImage(branchId: string, imageId: string, task: GenerationTaskDescriptor): void {
    const row = this.database.connection.prepare(
      'SELECT data_json FROM sw_images WHERE branch_id=? AND id=?',
    ).get(branchId, imageId) as { data_json?: string } | undefined;
    if (!row) return;
    const image = this.parseImageRow(row);
    image.generationTaskId = task.id;
    image.status = mapTaskStatus(task.status, task.upstreamMayContinue);
    image.error = task.errorMessage || '';
    if (task.status === 'succeeded' && task.artifacts.length > 0) {
      image.artifactId = task.artifacts[0].artifactId;
      image.imageUrl = task.artifacts[0].url;
    }
    this.saveImageRow(image);
  }

  private markRecoveredImageFailed(branchId: string, imageId: string, error: string): void {
    const row = this.database.connection.prepare(
      'SELECT data_json FROM sw_images WHERE branch_id=? AND id=?',
    ).get(branchId, imageId) as { data_json?: string } | undefined;
    if (!row) return;
    const image = this.parseImageRow(row);
    image.status = 'failed';
    image.error = error;
    this.saveImageRow(image);
  }

  private releaseRunImageReservation(branchId: string, runId: string | null, now: string): void {
    if (!runId) return;
    const row = this.database.connection.prepare(
      'SELECT data_json FROM sw_runs WHERE id=? AND branch_id=?',
    ).get(runId, branchId) as { data_json?: string } | undefined;
    if (!row) return;
    const run = JSON.parse(String(row.data_json)) as WorldRun;
    if (run.imagesSubmitted <= 0) return;
    run.imagesSubmitted -= 1;
    run.updatedAt = now;
    this.database.connection.prepare(
      'UPDATE sw_runs SET data_json=?, updated_at=? WHERE id=? AND branch_id=?',
    ).run(JSON.stringify(run), now, runId, branchId);
  }

  recoverInterruptedSubmissions(): {
    leasesRemoved: number;
    submissionsReconciled: number;
    submissionsFailed: number;
  } {
    if (this.startupRecoveryCompleted) {
      return { leasesRemoved: 0, submissionsReconciled: 0, submissionsFailed: 0 };
    }
    const result = this.database.transaction(() => {
      const now = nowIso();
      const reservedRows = this.database.connection.prepare(
        "SELECT id, branch_id, image_id, idempotency_key, run_id FROM sw_image_submissions WHERE status='reserved'",
      ).all() as Array<{
        id: string; branch_id: string; image_id: string;
        idempotency_key: string; run_id: string | null;
      }>;
      let submissionsReconciled = 0;
      let submissionsFailed = 0;
      for (const submission of reservedRows) {
        const taskRow = this.database.connection.prepare(
          'SELECT id FROM generation_tasks WHERE app_id=? AND idempotency_key=?',
        ).get(STORY_WORLDS_APP_ID, submission.idempotency_key) as { id: string } | undefined;
        const task = taskRow ? getGenerationTask(this.database, taskRow.id, STORY_WORLDS_APP_ID) : null;
        if (task) {
          this.database.connection.prepare(`
            UPDATE sw_image_submissions
            SET status='submitted', task_id=?, error=NULL, updated_at=?
            WHERE id=?
          `).run(task.id, now, submission.id);
          this.applyRecoveredTaskToImage(submission.branch_id, submission.image_id, task);
          submissionsReconciled += 1;
        } else {
          const message = '服务重启时未发现已落库的生成任务，已释放预约额度；原幂等记录保留，请使用新的幂等键重试。';
          this.database.connection.prepare(`
            UPDATE sw_image_submissions
            SET status='failed', error=?, updated_at=?
            WHERE id=?
          `).run(message, now, submission.id);
          this.markRecoveredImageFailed(submission.branch_id, submission.image_id, message);
          this.releaseRunImageReservation(submission.branch_id, submission.run_id, now);
          submissionsFailed += 1;
        }
      }
      const leaseResult = this.database.connection.prepare(
        'DELETE FROM artifact_references WHERE app_id=? AND ref_type=?',
      ).run(STORY_WORLDS_APP_ID, SUBMISSION_LEASE_REF_TYPE);
      return {
        leasesRemoved: Number(leaseResult.changes),
        submissionsReconciled,
        submissionsFailed,
      };
    });
    this.startupRecoveryCompleted = true;
    return result;
  }

  private parseImageRow(row: { data_json?: unknown } | undefined): WorldImage {
    return JSON.parse(String(row?.data_json ?? '{}')) as WorldImage;
  }

  private getActiveRun(branchId: string): WorldRun | null {
    const row = this.database.connection.prepare(`
      SELECT data_json FROM sw_runs
      WHERE branch_id=? AND status IN ('queued','running','paused','uncertain')
      ORDER BY updated_at DESC LIMIT 1
    `).get(branchId) as { data_json?: string } | undefined;
    return row ? (JSON.parse(String(row.data_json)) as WorldRun) : null;
  }

  /**
   * 获取指定时刻（tick）的历史世界定义快照。
   * 通过数据层的历史快照接口读取，避免后续修改污染事件配图。
   */
  private getDefinitionAtTick(worldId: string, branchId: string, tick: number): WorldDefinition {
    return this.store.definitionAtTick(worldId, branchId, tick);
  }

  /**
   * 基于事件的建立/行动/结果画面规划。
   * 固定人物外观、地点与道具参考，幂等保留已有阶段规划。
   */
  plan(worldId: string, branchId: string, input: PlanWorldImages): { items: WorldImage[] } {
    const branch = this.store.getBranch(worldId, branchId);
    if (branch.revision !== input.expectedRevision) {
      throw new StoryWorldError(
        'story_branch_revision_conflict',
        409,
        `分支已在其他窗口更新（当前版本 ${branch.revision}），请刷新后重试。`,
      );
    }

    if (!input.eventIds || input.eventIds.length === 0) {
      throw new StoryWorldError('story_image_plan_invalid', 400, '规划配图至少须指定一个事件。');
    }
    if (input.eventIds.length > 12) {
      throw new StoryWorldError('story_image_plan_invalid', 400, '单次最多规划 12 个事件的配图。');
    }

    const results: WorldImage[] = [];

    this.database.transaction(() => {
      for (const eventId of input.eventIds) {
        const eventRow = this.database.connection.prepare(
          'SELECT data_json FROM sw_events WHERE branch_id=? AND id=?',
        ).get(branchId, eventId) as { data_json?: string } | undefined;

        if (!eventRow) {
          throw new StoryWorldError('story_event_not_found', 400, `事件 ${eventId} 不存在于当前分支。`);
        }
        const event = JSON.parse(String(eventRow.data_json)) as WorldEvent;

        // 收集已有该事件的画面规划，实现阶段级幂等
        const existingRows = this.database.connection.prepare(
          'SELECT data_json FROM sw_images WHERE branch_id=? AND event_id=?',
        ).all(branchId, eventId) as Array<{ data_json: string }>;
        const existingByPhase = new Map<string, WorldImage>();
        for (const row of existingRows) {
          const img = this.parseImageRow(row);
          existingByPhase.set(img.phase, img);
        }

        // 基于事件发生时刻（event.tick）的历史定义快照，防止角色外貌/地点后续变更污染历史分镜
        const historicalDef = this.getDefinitionAtTick(worldId, branchId, event.tick);
        const locationMap = new Map(historicalDef.locations.map((loc) => [loc.id, loc]));
        const actorMap = new Map(historicalDef.actors.map((actor) => [actor.id, actor]));
        const visualStyle = historicalDef.visualStyle?.trim() || '';

        const location = locationMap.get(event.locationId);
        const locName = location?.name || '场景';
        const locDesc = location?.description || '';

        const participants: WorldActor[] = [];
        for (const pid of event.participantIds) {
          const actor = actorMap.get(pid);
          if (actor) participants.push(actor);
        }

        const visualReferences = summarizeEventVisualReferences(historicalDef, event);
        const refArtifactIds = composeReferenceArtifactIds(
          visualReferences.matches,
          participants.flatMap((a) => a.referenceArtifactIds || []),
        );
        const participantSummary = participants
          .map((a) => `${a.name}${a.appearance ? `（${a.appearance}）` : ''}`)
          .join('、') || '现场角色';

        const factsSummary = event.facts?.length
          ? event.facts.map((f) => f.content).join('；')
          : '';

        const cleanPeriod = (text: string): string => {
          const t = text.trim();
          if (!t) return '';
          return /[。！？.!?]$/.test(t) ? t : `${t}。`;
        };

        const formattedLocDesc = locDesc ? `环境描述：${cleanPeriod(locDesc)}` : '';
        const formattedSummary = cleanPeriod(event.summary);
        const formattedFacts = factsSummary ? `涉及关键事实与道具设定：${cleanPeriod(factsSummary)}` : '';
        const formattedFactsAction = factsSummary ? `动作相关关键事实与道具：${cleanPeriod(factsSummary)}` : '';
        const formattedFactsResult = cleanPeriod(factsSummary || event.summary);

        const actorsWithRefs = participants.filter(
          (a) => (a.referenceArtifactIds ?? []).length > 0,
        ).length;
        const referenceParts = [
          visualReferences.sceneCount ? `场景锚点 ${visualReferences.sceneCount} 组` : '',
          visualReferences.propCount ? `道具参考 ${visualReferences.propCount} 组` : '',
          actorsWithRefs ? `人物外观 ${actorsWithRefs} 位` : '',
        ].filter(Boolean);
        const consistencyNote = refArtifactIds.length > 0
          ? `已纳入${referenceParts.join('、')}；提交时按工作流能力绑定参考图。云端多图路径当前实际仅发送首张参考图，参考顺序已按场景锚点优先排列。`
          : referenceParts.length > 0
            ? `已纳入${referenceParts.join('、')}的文字设定；尚未绑定可用参考素材，画面一致性由提示词约束。`
            : '未配置场景、道具与人物参考素材，画面一致性由地点、道具与人物外观的文字设定约束。';

        const stateChangesSummary = event.stateChanges?.length > 0
          ? `人物状态变化：${event.stateChanges
              .map((s) => {
                const a = actorMap.get(s.actorId);
                const parts: string[] = [];
                if (s.emotion) parts.push(`情绪呈现${s.emotion}`);
                return `${a?.name || s.actorId}${parts.length ? `（${parts.join('，')}）` : ''}`;
              })
              .join('；')}。`
          : '';

        const phases: Array<{
          phase: 'establishing' | 'action' | 'result';
          caption: string;
          prompt: string;
        }> = [
          {
            phase: 'establishing',
            caption: `${event.title} - 场景建立`,
            prompt: [
              visualStyle ? `【视觉风格】${visualStyle}。` : '',
              `【场景建立/初始前奏全景】地点：${locName}。${formattedLocDesc}`,
              visualReferences.promptSection,
              `现场出场人物（保持固定出场与外观）：${cleanPeriod(participantSummary)}`,
              `【事件背景与关联物品】背景情节：${formattedSummary}${formattedFacts ? ` ${formattedFacts}` : ''}`,
              '【画面时态与内容要求】展现事件发生前的初始空间环境、现场既有陈设道具与人物起始状态；确立起始光影与自然氛围，作为事件前奏切入；尚未展开具体动作与最终结果，严禁提前绘制后续行动或最终结果。',
              '【环境与道具一致性】画面严格保持同一时空环境与既定布景，严禁产生时空穿越、场景突变或未经提及的突兀现代物品及全新主要道具。',
            ].filter(Boolean).join(' '),
          },
          {
            phase: 'action',
            caption: `${event.title} - 关键行动`,
            prompt: [
              visualStyle ? `【视觉风格】${visualStyle}。` : '',
              `【关键行动/核心过程动态中景】地点：${locName}。${formattedLocDesc}`,
              visualReferences.promptSection,
              `主要行动人物（保持固定出场与外观）：${cleanPeriod(participantSummary)}`,
              `【核心事件动作】行动过程：${formattedSummary}${formattedFactsAction ? ` ${formattedFactsAction}` : ''}`,
              '【画面时态与动作要求】生动展现人物正在进行的具体动作交互、专注姿态与神情互动；忠实还原事件实际动作过程（允许日常平静生活、专注劳作、协作交谈等和平场景，严禁擅自凭空添加冲突对抗或夸张戏剧性）。',
              '【环境与道具一致性】画面严格延续同一时空布景、固定人物外观与现场道具，严禁出现时空错乱、环境突变或未经提及的额外新道具。',
            ].filter(Boolean).join(' '),
          },
          {
            phase: 'result',
            caption: `${event.title} - 结果变化`,
            prompt: [
              visualStyle ? `【视觉风格】${visualStyle}。` : '',
              `【结果变化/终态事实中景】地点：${locName}。${formattedLocDesc}`,
              visualReferences.promptSection,
              `在场见证人物（保持同一批固定人物与外观）：${cleanPeriod(participantSummary)}`,
              `【最终事实与落地成果】实际落定事实：${formattedFactsResult}`,
              `后续状态与影响：${formattedSummary}`,
              stateChangesSummary,
              '【画面时态与收束要求】展现动作完成后的实际确定事实与收束定格，呈现道具最终状态与人物余韵神态；延续相同的固定人物外貌与着装，严禁篡改角色外观或时空环境。',
              '【环境与道具一致性】画面严格保持同一时空环境，严禁突变异象、时空穿越或引入未经提及的突兀现代物品及新主要道具。',
            ].filter(Boolean).join(' '),
          },
        ];

        for (const item of phases) {
          const existing = existingByPhase.get(item.phase);
          if (existing) {
            results.push(existing);
          } else {
            const now = nowIso();
            const newImage: WorldImage = {
              id: randomUUID(),
              worldId,
              branchId,
              eventId: event.id,
              runId: null,
              phase: item.phase,
              caption: item.caption,
              prompt: item.prompt,
              negativePrompt: '模糊, 畸变, 粗糙, 低画质, 缺失细节, 变形, 多余肢体, 文字水印, 突兀现代物品, 未经提及的新主要道具, 时空穿越, 场景剧烈突变, 擅自添加的冲突打斗, blurry, deformed, low quality, anachronism, unmentioned props, time travel, invented conflict',
              status: 'planned',
              generationTaskId: null,
              artifactId: null,
              imageUrl: null,
              error: '',
              referenceArtifactIds: refArtifactIds,
              consistencyNote,
              createdAt: now,
            };
            this.saveImageRow(newImage);
            results.push(newImage);
          }
        }
      }
    });

    return { items: results };
  }

  /**
   * 提交配图生成任务。
   * 支持 ComfyUI 与 GPT Image，严格单图单任务；
   * 在事务中通过 sw_image_submissions 先行预留锁与消费额度；
   * 错误同一 key 不重复扣费，不同 payload 重复 key 抛出 409；
   * upstreamMayContinue 严格映射为 uncertain 并阻断新 key 提交。
   */
  async submit(
    worldId: string,
    branchId: string,
    imageId: string,
    input: SubmitWorldImage,
  ): Promise<WorldImage> {
    const branch = this.store.getBranch(worldId, branchId);
    if (branch.revision !== input.expectedRevision) {
      throw new StoryWorldError(
        'story_branch_revision_conflict',
        409,
        `分支已在其他窗口更新（当前版本 ${branch.revision}），请刷新后重试。`,
      );
    }

    const row = this.database.connection.prepare(
      'SELECT data_json FROM sw_images WHERE id=? AND branch_id=?',
    ).get(imageId, branchId) as { data_json?: string } | undefined;

    if (!row) {
      throw new StoryWorldError('story_image_not_found', 404, '配图规划不存在。');
    }
    const image = this.parseImageRow(row);

    // 解析目标运行与引擎
    const activeRun = this.getActiveRun(branchId);
    const targetRunId = input.runId || image.runId || activeRun?.id || null;

    // 计算请求哈希（覆盖图片目标、引擎、工作流、模型及目标 runId）
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          imageId,
          engineId: input.engineId,
          workflowId: input.workflowId ?? null,
          model: input.model ?? null,
          runId: targetRunId,
        }),
      )
      .digest('hex');

    const engineRow = this.database.connection.prepare(
      'SELECT id, kind, enabled, name FROM generation_engines WHERE id=? AND enabled=1',
    ).get(input.engineId) as { id: string; kind: string; enabled: number; name?: string } | undefined;

    if (!engineRow) {
      throw new StoryWorldError(
        'generation_engine_unavailable',
        400,
        `生成引擎 ${input.engineId} 不可用或不存在。`,
      );
    }
    const engineKind = String(engineRow.kind);

    let isReplay = false;
    let existingTaskId: string | null = null;
    const submissionId = randomUUID();

    // 核心事务：排它性检查幂等键、核对并消费额度、写入 submission 预留记录
    this.database.transaction(() => {
      const subRow = this.database.connection.prepare(
        'SELECT * FROM sw_image_submissions WHERE branch_id=? AND idempotency_key=?',
      ).get(branchId, input.idempotencyKey) as
        | { id: string; request_hash: string; task_id: string | null; status: string; error: string | null }
        | undefined;

      if (subRow) {
        if (subRow.request_hash !== requestHash) {
          throw new StoryWorldError(
            'story_idempotency_conflict',
            409,
            '同一幂等键不能提交不同的配图参数。',
          );
        }
        // 发现相同幂等键：无需重复扣除额度
        isReplay = true;
        existingTaskId = subRow.task_id;
        return;
      }

      // 上游状态核对：如果图片已存在任务且 upstreamMayContinue，必须为 uncertain，禁止新 key 提交
      if (image.generationTaskId) {
        const priorTask = getGenerationTask(this.database, image.generationTaskId);
        if (priorTask?.upstreamMayContinue) {
          image.status = 'uncertain';
          this.saveImageRow(image);
          throw new StoryWorldError(
            'story_image_busy',
            409,
            '该配图上游执行结果不明，公共队列正在核对，禁止提交新任务。',
          );
        }
      }
      if (image.status === 'uncertain') {
        throw new StoryWorldError(
          'story_image_busy',
          409,
          '该配图上游执行结果不明，公共队列正在核对，禁止重复提交。',
        );
      }
      if (image.status === 'queued' || image.status === 'running' || image.status === 'succeeded') {
        throw new StoryWorldError(
          'story_image_busy',
          409,
          '该配图已在队列中或已生成完成，不能以不同幂等键重复提交。',
        );
      }

      // 额度核对与消费
      if (targetRunId) {
        const runRow = this.database.connection.prepare(
          'SELECT data_json FROM sw_runs WHERE id=? AND branch_id=?',
        ).get(targetRunId, branchId) as { data_json?: string } | undefined;

        if (!runRow) {
          throw new StoryWorldError('story_run_not_found', 404, '指定的运行记录不存在。');
        }
        const run = JSON.parse(String(runRow.data_json)) as WorldRun;

        if (run.imagesSubmitted >= run.settings.maxImages) {
          throw new StoryWorldError(
            'story_run_image_quota_exceeded',
            400,
            `本次运行配图提交额度已用尽（最多 ${run.settings.maxImages} 幅）。`,
          );
        }

        // 无论后续执行成功与否，提交动作即计入 run 提交额度
        run.imagesSubmitted += 1;
        run.updatedAt = nowIso();
        this.database.connection.prepare(
          'UPDATE sw_runs SET data_json=?, updated_at=? WHERE id=?',
        ).run(JSON.stringify(run), run.updatedAt, targetRunId);
      } else {
        // 无 run 运行不可绕过 12 图预算：按分支统计非失败的手动配图预算
        const manualCountRow = this.database.connection.prepare(`
          SELECT COUNT(*) as count FROM sw_image_submissions
          WHERE branch_id=? AND run_id IS NULL AND status IN ('reserved','submitted')
        `).get(branchId) as { count?: number } | undefined;

        if (Number(manualCountRow?.count ?? 0) >= MANUAL_MAX_IMAGES_BUDGET) {
          throw new StoryWorldError(
            'story_image_budget_exceeded',
            400,
            `分支手动配图在途任务已达到 ${MANUAL_MAX_IMAGES_BUDGET} 幅安全上限，请等待当前批次完成或启动仿真运行任务以获得持久化额度。`,
          );
        }
      }

      // 写入预留状态的 submission 锁，防止并发重入
      const now = nowIso();
      this.database.connection.prepare(`
        INSERT INTO sw_image_submissions (
          id, branch_id, image_id, idempotency_key, request_hash, run_id, status, task_id, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', NULL, NULL, ?, ?)
      `).run(submissionId, branchId, imageId, input.idempotencyKey, requestHash, targetRunId, now, now);
    });

    if (isReplay) {
      if (existingTaskId) {
        return this.syncTask(worldId, branchId, imageId);
      }
      return this.get(worldId, branchId, imageId);
    }

    // 工作流、模型与 Schema 绑定解析
    let workflowId: string | null = input.workflowId ?? null;
    let workflowVersion: number | null = null;
    let inputSchema: Record<string, { type?: string; semantic?: string; default?: unknown }> = {};
    let nodeBindings: Record<string, unknown> = {};
    let definition: Record<string, unknown> = {};
    let editorConfigJson: string | null = null;
    let consistencyNote = image.consistencyNote;

    try {
      if (workflowId) {
        const wfRow = this.database.connection.prepare(
          'SELECT latest_version FROM generation_workflows WHERE id=? AND archived_at IS NULL',
        ).get(workflowId) as { latest_version?: number } | undefined;
        if (!wfRow) {
          throw new StoryWorldError('workflow_not_found', 400, `未找到指定工作流 ${workflowId}。`);
        }
        workflowVersion = wfRow.latest_version ?? 1;

        const verRow = this.database.connection.prepare(
          'SELECT input_schema_json, node_bindings_json, definition_json, editor_config_json FROM generation_workflow_versions WHERE workflow_id=? AND version=?',
        ).get(workflowId, workflowVersion) as
          | { input_schema_json?: string; node_bindings_json?: string; definition_json?: string; editor_config_json?: string | null }
          | undefined;
        editorConfigJson = verRow?.editor_config_json ?? null;

        if (verRow?.input_schema_json) {
          try {
            inputSchema = JSON.parse(verRow.input_schema_json) as typeof inputSchema;
          } catch {}
        }
        if (verRow?.node_bindings_json) {
          try {
            nodeBindings = JSON.parse(verRow.node_bindings_json) as Record<string, unknown>;
          } catch {}
        }
        if (verRow?.definition_json) {
          try {
            definition = JSON.parse(verRow.definition_json) as Record<string, unknown>;
          } catch {}
        }
      } else {
        const resolved = resolveWorkflowForEngine(this.database, input.engineId, engineKind);
        if (resolved) {
          workflowId = resolved.id;
          workflowVersion = resolved.version;

          const verRow = this.database.connection.prepare(
            'SELECT input_schema_json, node_bindings_json, definition_json, editor_config_json FROM generation_workflow_versions WHERE workflow_id=? AND version=?',
          ).get(workflowId, workflowVersion) as
            | { input_schema_json?: string; node_bindings_json?: string; definition_json?: string; editor_config_json?: string | null }
            | undefined;
          editorConfigJson = verRow?.editor_config_json ?? null;

          if (verRow?.input_schema_json) {
            try {
              inputSchema = JSON.parse(verRow.input_schema_json) as typeof inputSchema;
            } catch {}
          }
          if (verRow?.node_bindings_json) {
            try {
              nodeBindings = JSON.parse(verRow.node_bindings_json) as Record<string, unknown>;
            } catch {}
          }
          if (verRow?.definition_json) {
            try {
              definition = JSON.parse(verRow.definition_json) as Record<string, unknown>;
            } catch {}
          }
        }
      }

      // 保留不可变配方默认模型；仅当工作流支持覆盖时允许显式 model 覆盖
      const recipeDefaultModel = String(definition.modelId || definition.model || '').trim();
      const supportsModelOverride =
        'model' in inputSchema ||
        'modelId' in inputSchema ||
        'model' in nodeBindings ||
        definition.allowModelOverride === true;

      let effectiveModel: string | undefined = undefined;
      if (input.model && supportsModelOverride) {
        effectiveModel = input.model.trim();
      } else {
        effectiveModel = recipeDefaultModel || (input.model?.trim() || undefined);
      }

      // 严格根据工作流 inputSchema 与 nodeBindings 映射入参，杜绝向 ComfyUI/Cloud 注入未知字段
      const inputs: Record<string, unknown> = {};

      // Anima 等英文训练模型收到中文长描述会退化为草图；工作流声明英文时先改写，
      // 作者保存的中文描述与事件事实保持原样，仅改变本次提交的提示词语言。
      let effectivePrompt = image.prompt;
      let effectiveNegativePrompt = image.negativePrompt;
      if (engineKind === 'comfyui' && editorConfigJson) {
        let requiresEnglish = false;
        try {
          requiresEnglish = (JSON.parse(editorConfigJson) as { promptLanguage?: unknown }).promptLanguage === 'en';
        } catch {}
        if (requiresEnglish) {
          // 画风由工作流策略决定：把已保存的画师串与质量词作为既定风格交给改写模型，
          // 避免每次改写自行发明画师，或把二次元场景写成写实照片。
          // 走到这里说明已解析到具体工作流版本，editorConfigJson 来自该版本。
          const stylePolicy = resolveActivityImagePromptPolicy(this.database, workflowId!, workflowVersion!);
          const styleHints = [stylePolicy.qualityPrompt.trim(), stylePolicy.artistString.trim()].filter(Boolean).join(', ');
          const rewritten = await ensureEnglishImagePrompt({
            database: this.database, secrets: this.secrets, appId: STORY_WORLDS_APP_ID,
            prompt: image.prompt, negativePrompt: image.negativePrompt,
            styleHints,
            workflowId, workflowVersion, fetcher: this.fetcher,
          });
          effectivePrompt = rewritten.prompt;
          if (rewritten.negativePrompt) effectiveNegativePrompt = rewritten.negativePrompt;
        }
      }

      // prompt 字段匹配
      const promptKey =
        Object.keys(inputSchema).find((k) => k === 'prompt' || inputSchema[k]?.semantic === 'prompt') ||
        Object.keys(nodeBindings).find((k) => k === 'prompt') ||
        'prompt';
      inputs[promptKey] = effectivePrompt;

      // negative prompt 字段匹配（优先检查 camelCase negativePrompt 与 snake_case negative_prompt）
      const negativeKey =
        Object.keys(inputSchema).find(
          (k) =>
            k === 'negativePrompt' ||
            k === 'negative_prompt' ||
            k === 'negative' ||
            inputSchema[k]?.semantic === 'negative_prompt' ||
            inputSchema[k]?.semantic === 'negativePrompt',
        ) ||
        Object.keys(nodeBindings).find(
          (k) => k === 'negativePrompt' || k === 'negative_prompt' || k === 'negative',
        ) ||
        (engineKind === 'cloud' && Object.keys(inputSchema).length === 0 ? 'negativePrompt' : undefined);

      if (negativeKey) {
        inputs[negativeKey] = effectiveNegativePrompt;
      }

      // 故事配图没有尺寸/质量覆盖入口；沿用字段默认，未声明时让生成核心
      // 保留配方或节点自身的值，不能偷偷改成固定正方形/standard。
      for (const key of ['size', 'quality']) {
        const value = inputSchema[key]?.default;
        if (typeof value === 'string' && value.trim()) inputs[key] = value;
      }
      if ('n' in inputSchema || 'n' in nodeBindings) {
        inputs['n'] = 1;
      }
      if ('model' in inputSchema || 'model' in nodeBindings) {
        if (effectiveModel) inputs['model'] = effectiveModel;
      } else if ('modelId' in inputSchema) {
        if (effectiveModel) inputs['modelId'] = effectiveModel;
      }

      // 参考图媒介绑定与求真的一致性说明（真实反映路径能力，绝不一刀切断言 GPT 不支持参考图）
      let inputArtifacts: Array<{ artifactId: string; inputKey: string }> = [];
      consistencyNote = image.consistencyNote;

      if (engineKind === 'cloud') {
        // 云端引擎：支持 image-to-image 兼容工作流通过云端适配器（/images/edits）使用参考图
        const isCloudI2I =
          definition.operation === 'image-to-image' ||
          'referenceImage' in inputSchema ||
          'image' in inputSchema;

        if (isCloudI2I && image.referenceArtifactIds.length > 0) {
          const refId = image.referenceArtifactIds[0];
          const artRow = this.database.connection.prepare(
            'SELECT id, app_id, content_type, file_status, local_path FROM artifacts WHERE id=?',
          ).get(refId) as {
            id: string; app_id: string; content_type: string | null;
            file_status: string; local_path: string | null;
          } | undefined;

          if (!artRow || artRow.file_status !== 'ready' || !artRow.local_path) {
            throw new StoryWorldError(
              'story_image_reference_unavailable',
              409,
              `参考素材 ${refId} 当前未就绪或文件不存在，不能作为配图参考。`,
            );
          }
          if (!artRow.content_type?.startsWith('image/')) {
            throw new StoryWorldError(
              'story_image_reference_invalid',
              400,
              `参考素材 ${refId} 不是图片，不能作为配图参考。`,
            );
          }
          const refKey =
            'referenceImage' in inputSchema
              ? 'referenceImage'
              : 'image' in inputSchema
                ? 'image'
                : 'referenceImage';
          inputArtifacts = [{ artifactId: refId, inputKey: refKey }];
          const extraRefs = image.referenceArtifactIds.length - 1;
          consistencyNote = extraRefs > 0
            ? `已连接云端图生图（image-to-image）生成路径并绑定首张参考图；当前路径实际仅发送这一张（按规划顺序，场景锚点优先），另有 ${extraRefs} 张参考图未发送。`
            : '已连接云端图生图（image-to-image）生成路径并绑定首张参考图。';
        } else if (image.referenceArtifactIds.length > 0) {
          consistencyNote =
            '当前生成路径（文本生图 / text-to-image）不支持参考图（场景锚点、道具或人物外观）与 LoRA 绑定，画面一致性依赖提示词描述。';
        } else {
          consistencyNote = '使用云端标准文本生成路径，画面一致性由提示词及模型约束。';
        }
      } else if (engineKind === 'comfyui') {
        const refBindingKey = Object.keys(nodeBindings).find((k) =>
          /^(reference_image|image|input_image|ref)$/i.test(k),
        );
        if (image.referenceArtifactIds.length > 0 && refBindingKey) {
          const refId = image.referenceArtifactIds[0];
          const artRow = this.database.connection.prepare(
            'SELECT id, app_id, content_type, file_status, local_path FROM artifacts WHERE id=?',
          ).get(refId) as {
            id: string; app_id: string; content_type: string | null;
            file_status: string; local_path: string | null;
          } | undefined;

          if (!artRow || artRow.file_status !== 'ready' || !artRow.local_path) {
            throw new StoryWorldError(
              'story_image_reference_unavailable',
              409,
              `参考素材 ${refId} 当前未就绪或文件不存在，不能作为配图参考。`,
            );
          }
          if (!artRow.content_type?.startsWith('image/')) {
            throw new StoryWorldError(
              'story_image_reference_invalid',
              400,
              `参考素材 ${refId} 不是图片，不能作为配图参考。`,
            );
          }
          inputArtifacts = [{ artifactId: refId, inputKey: refBindingKey }];
          const extraRefs = image.referenceArtifactIds.length - 1;
          consistencyNote = extraRefs > 0
            ? `已连接 ComfyUI 工作流并绑定首张参考图；当前工作流仅绑定一张（另有 ${extraRefs} 张参考图未发送），画面一致性由提示词补充。`
            : '已连接 ComfyUI 工作流并绑定首张参考图，画面一致性由工作流与提示词共同约束。';
        } else if (image.referenceArtifactIds.length > 0 && !refBindingKey) {
          consistencyNote = '当前 ComfyUI 工作流未配置参考图输入绑定，画面一致性由提示词及模型约束。';
        } else {
          consistencyNote = '已连接 ComfyUI 工作流，人物外观由提示词及工作流模型约束。';
        }
      } else {
        consistencyNote = '使用通用生成工作流推进。';
      }

      const newlyGrantedReferences: Array<{
        grantId: string;
        artifactId: string;
        grantedExpiresAt: string | null;
        previousExpiresAt: string | null;
        restoredExisting: boolean;
      }> = [];
      let taskDesc: Awaited<ReturnType<typeof createGenerationTask>> | undefined;
      let taskError: unknown;
      let taskFailed = false;
      try {
        const validatedArtifacts = inputArtifacts.map((artifactInput) => {
          const artifact = this.database.connection.prepare(
            'SELECT id, app_id, content_type, file_status, local_path FROM artifacts WHERE id=?',
          ).get(artifactInput.artifactId) as {
            id: string; app_id: string; content_type: string | null;
            file_status: string; local_path: string | null;
          } | undefined;
          if (!artifact) {
            throw new StoryWorldError(
              'story_image_reference_missing',
              404,
              `参考素材 ${artifactInput.artifactId} 不存在。`,
            );
          }
          if (artifact.file_status !== 'ready' || !artifact.local_path) {
            throw new StoryWorldError(
              'story_image_reference_unavailable',
              409,
              `参考素材 ${artifactInput.artifactId} 当前未就绪，不能作为配图参考。`,
            );
          }
          if (!artifact.content_type?.startsWith('image/')) {
            throw new StoryWorldError(
              'story_image_reference_invalid',
              400,
              `参考素材 ${artifactInput.artifactId} 不是图片，不能作为配图参考。`,
            );
          }
          return artifact;
        });
        this.database.transaction(() => {
          for (const artifact of validatedArtifacts) {
            if (artifact.app_id === STORY_WORLDS_APP_ID
              || hasArtifactAccess(this.database, artifact.id, STORY_WORLDS_APP_ID, 'reference')) {
              continue;
            }
            const existing = this.database.connection.prepare(
              "SELECT id, expires_at FROM artifact_grants WHERE artifact_id=? AND grantee_app_id=? AND access='reference'",
            ).get(artifact.id, STORY_WORLDS_APP_ID) as { id: string; expires_at: string | null } | undefined;
            createArtifactGrant(this.database, {
                artifactId: artifact.id,
                ownerAppId: artifact.app_id,
                granteeAppId: STORY_WORLDS_APP_ID,
                access: 'reference',
                expiresInSeconds: REFERENCE_GRANT_TTL_SECONDS,
            });
            const granted = this.database.connection.prepare(
              "SELECT id, expires_at FROM artifact_grants WHERE artifact_id=? AND grantee_app_id=? AND access='reference'",
            ).get(artifact.id, STORY_WORLDS_APP_ID) as { id: string; expires_at: string | null };
            newlyGrantedReferences.push({
              grantId: String(granted.id),
              artifactId: artifact.id,
              grantedExpiresAt: granted.expires_at,
              previousExpiresAt: existing?.expires_at ?? null,
              restoredExisting: Boolean(existing),
            });
          }
          this.createSubmissionLeases(
            validatedArtifacts.map((artifact) => artifact.id),
            submissionId,
          );
        });
        taskDesc = await createGenerationTask(
          this.config,
          this.database,
          this.secrets,
          {
            appId: STORY_WORLDS_APP_ID,
            purpose: 'story_world_image',
            isInternal: true,
            engineId: input.engineId,
            workflowId,
            workflowVersion,
            inputs,
            inputArtifacts,
            idempotencyKey: input.idempotencyKey,
            priority: 'normal',
            audit: {
              feature: 'story-worlds',
              businessEvent: 'story_world_image.submit',
              objectType: 'story_world_image',
              objectId: imageId,
              positivePrompt: image.prompt,
              negativePrompt: image.negativePrompt,
            },
          },
          this.fetcher,
        );
      } catch (error) {
        taskFailed = true;
        taskError = error;
      } finally {
        this.deleteSubmissionLeases(submissionId);
      }
      if (taskFailed) {
        if (newlyGrantedReferences.length > 0) {
          this.database.transaction(() => {
            for (const reference of newlyGrantedReferences) {
              const used = this.database.connection.prepare(
                'SELECT 1 FROM artifact_references WHERE artifact_id=? LIMIT 1',
              ).get(reference.artifactId);
              if (used) continue;
              if (reference.restoredExisting) {
                this.database.connection.prepare(
                  'UPDATE artifact_grants SET expires_at=? WHERE id=? AND grantee_app_id=? AND access=? AND expires_at IS ?',
                ).run(
                  reference.previousExpiresAt, reference.grantId, STORY_WORLDS_APP_ID,
                  'reference', reference.grantedExpiresAt,
                );
              } else {
                this.database.connection.prepare(
                  'DELETE FROM artifact_grants WHERE id=? AND grantee_app_id=? AND access=? AND expires_at IS ?',
                ).run(reference.grantId, STORY_WORLDS_APP_ID, 'reference', reference.grantedExpiresAt);
              }
            }
          });
        }
        throw taskError;
      }
      if (!taskDesc) {
        throw new StoryWorldError('story_image_task_missing', 500, '生成任务未能创建。');
      }

      image.generationTaskId = taskDesc.id;
      image.status = mapTaskStatus(taskDesc.status, taskDesc.upstreamMayContinue);
      image.runId = targetRunId;
      image.consistencyNote = consistencyNote;
      image.error = taskDesc.errorMessage || '';

      if (taskDesc.status === 'succeeded' && taskDesc.artifacts.length > 0) {
        image.artifactId = taskDesc.artifacts[0].artifactId;
        image.imageUrl = taskDesc.artifacts[0].url;
      }

      // 更新 submission 为已提交
      const now = nowIso();
      this.database.connection.prepare(`
        UPDATE sw_image_submissions
        SET status = 'submitted', task_id = ?, updated_at = ?
        WHERE id = ?
      `).run(taskDesc.id, now, submissionId);
    } catch (err: unknown) {
      // 任务创建失败：状态置为 failed，额度依然已扣除，同一 key 记录失败，不可重复扣费
      const errMsg = err instanceof Error ? err.message : String(err);
      image.status = 'failed';
      image.runId = targetRunId;
      image.consistencyNote = consistencyNote;
      image.error = errMsg;

      const now = nowIso();
      this.database.connection.prepare(`
        UPDATE sw_image_submissions
        SET status = 'failed', error = ?, updated_at = ?
        WHERE id = ?
      `).run(errMsg, now, submissionId);
    }

    this.saveImageRow(image);
    return image;
  }

  /**
   * 获取单幅配图，若处于进行中或不明状态，自动从底层公共生成任务同步最新状态。
   */
  get(worldId: string, branchId: string, imageId: string): WorldImage {
    this.store.getBranch(worldId, branchId);
    const row = this.database.connection.prepare(
      'SELECT data_json FROM sw_images WHERE id=? AND branch_id=?',
    ).get(imageId, branchId) as { data_json?: string } | undefined;

    if (!row) {
      throw new StoryWorldError('story_image_not_found', 404, '配图规划不存在。');
    }
    const image = this.parseImageRow(row);

    if (image.generationTaskId && (image.status === 'queued' || image.status === 'running' || image.status === 'uncertain')) {
      const task = getGenerationTask(this.database, image.generationTaskId);
      if (task) {
        const mapped = mapTaskStatus(task.status, task.upstreamMayContinue);
        let changed = false;
        if (image.status !== mapped) {
          image.status = mapped;
          changed = true;
        }
        if (task.errorMessage && image.error !== task.errorMessage) {
          image.error = task.errorMessage;
          changed = true;
        }
        if (task.status === 'succeeded' && task.artifacts.length > 0 && !image.imageUrl) {
          image.artifactId = task.artifacts[0].artifactId;
          image.imageUrl = task.artifacts[0].url;
          changed = true;
        }
        if (task.status === 'succeeded' || task.status === 'failed' || task.upstreamMayContinue) {
          const subStatus = task.upstreamMayContinue ? 'uncertain' : task.status;
          this.database.connection.prepare(`
            UPDATE sw_image_submissions SET status=?, updated_at=? WHERE task_id=?
          `).run(subStatus, nowIso(), task.id);
        }
        if (changed) this.saveImageRow(image);
      }
    }

    return image;
  }

  /**
   * 显式从底层任务同步配图状态与结果产物 URL。
   */
  async syncTask(worldId: string, branchId: string, imageId: string): Promise<WorldImage> {
    const image = this.get(worldId, branchId, imageId);
    if (!image.generationTaskId) return image;

    const task = getGenerationTask(this.database, image.generationTaskId);
    if (!task) return image;

    image.status = mapTaskStatus(task.status, task.upstreamMayContinue);
    image.error = task.errorMessage || task.errorCode || '';

    if (task.status === 'succeeded' && task.artifacts.length > 0) {
      image.artifactId = task.artifacts[0].artifactId;
      image.imageUrl = task.artifacts[0].url;
    }

    if (task.status === 'succeeded' || task.status === 'failed' || task.upstreamMayContinue) {
      const subStatus = task.upstreamMayContinue ? 'uncertain' : task.status;
      this.database.connection.prepare(`
        UPDATE sw_image_submissions SET status=?, updated_at=? WHERE task_id=?
      `).run(subStatus, nowIso(), task.id);
    }

    this.saveImageRow(image);
    return image;
  }

  /**
   * 批量同步分支上所有进行中或待复核的配图任务，供 HTTP branch detail 刷新使用。
   */
  async sync(worldId: string, branchId: string): Promise<{ items: WorldImage[] }> {
    this.store.getBranch(worldId, branchId);
    const rows = this.database.connection.prepare(
      "SELECT data_json FROM sw_images WHERE branch_id=? AND status IN ('queued','running','uncertain')",
    ).all(branchId) as Array<{ data_json: string }>;

    for (const r of rows) {
      const img = this.parseImageRow(r);
      if (img.generationTaskId) {
        const task = getGenerationTask(this.database, img.generationTaskId);
        if (task) {
          const mapped = mapTaskStatus(task.status, task.upstreamMayContinue);
          let changed = false;
          if (img.status !== mapped) {
            img.status = mapped;
            changed = true;
          }
          if (task.errorMessage && img.error !== task.errorMessage) {
            img.error = task.errorMessage;
            changed = true;
          }
          if (task.status === 'succeeded' && task.artifacts.length > 0 && !img.imageUrl) {
            img.artifactId = task.artifacts[0].artifactId;
            img.imageUrl = task.artifacts[0].url;
            changed = true;
          }
          if (task.status === 'succeeded' || task.status === 'failed' || task.upstreamMayContinue) {
            const subStatus = task.upstreamMayContinue ? 'uncertain' : task.status;
            this.database.connection.prepare(`
              UPDATE sw_image_submissions SET status=?, updated_at=? WHERE task_id=?
            `).run(subStatus, nowIso(), task.id);
          }
          if (changed) this.saveImageRow(img);
        }
      }
    }

    return this.list(worldId, branchId);
  }

  /**
   * 模拟推进自动配图（可供 runtime afterStep 调用）。
   * 严格使用 run.settings.imageConfig，配置缺失时仅保留 planned 提示，不扣预算，不选默认。
   * 仅处理本 run.startTick 之后且 <= completedTick 的事件，支持 eventIds 精确指定，
   * 分批规划不遗漏，重启重复处理幂等，捕获错误不吞状态。
   */
  async processRun(
    worldId: string,
    branchId: string,
    run: WorldRun,
    eventIds?: string[],
  ): Promise<{ planned: WorldImage[]; submitted: WorldImage[] }> {
    if (!run.settings.autoImages) {
      return { planned: [], submitted: [] };
    }

    const branch = this.store.getBranch(worldId, branchId);

    // 1. 严格基于事件过滤：
    // 限本 run.startTick 之后且 <= completedTick 的事件；不要把旧分支事件/别的 run 遗留计划计入新 run。
    let candidateEventIds: string[] = [];
    const tickFilter = run.startTick === 0 ? 'e.tick >= ?' : 'e.tick > ?';

    if (eventIds && eventIds.length > 0) {
      const placeholders = eventIds.map(() => '?').join(',');
      const rows = this.database.connection.prepare(`
        SELECT e.id FROM sw_events e
        WHERE e.branch_id=? AND e.id IN (${placeholders})
          AND ${tickFilter} AND e.tick <= ?
          AND NOT EXISTS (
            SELECT 1 FROM sw_images i WHERE i.branch_id=e.branch_id AND i.event_id=e.id
          )
        ORDER BY e.tick ASC, e.id ASC
      `).all(branchId, ...eventIds, run.startTick, run.completedTick) as Array<{ id: string }>;
      candidateEventIds = rows.map((r) => r.id);
    } else {
      const rows = this.database.connection.prepare(`
        SELECT e.id FROM sw_events e
        WHERE e.branch_id=?
          AND ${tickFilter} AND e.tick <= ?
          AND NOT EXISTS (
            SELECT 1 FROM sw_images i WHERE i.branch_id=e.branch_id AND i.event_id=e.id
          )
        ORDER BY e.tick ASC, e.id ASC
      `).all(branchId, run.startTick, run.completedTick) as Array<{ id: string }>;
      candidateEventIds = rows.map((r) => r.id);
    }

    // 2. 自动计划：按 12 个一批分批规划，不要截取 12 后永久遗漏其余事件
    const planned: WorldImage[] = [];
    for (let i = 0; i < candidateEventIds.length; i += 12) {
      const chunk = candidateEventIds.slice(i, i + 12);
      const planRes = this.plan(worldId, branchId, {
        expectedRevision: this.store.getBranch(worldId, branchId).revision,
        eventIds: chunk,
      });
      // 标记新规划的图片明确归属于本 run
      for (const img of planRes.items) {
        if (img.status === 'planned' && !img.runId) {
          img.runId = run.id;
          this.saveImageRow(img);
        }
      }
      planned.push(...planRes.items);
    }

    // 3. 严格核对 run.settings.imageConfig，不能随意选择第一个 enabled 引擎
    // 缺失配置仅保留 planned 提示，不扣预算，不选默认
    const imageConfig = run.settings.imageConfig;
    if (!imageConfig?.engineId) {
      for (const img of planned) {
        img.consistencyNote = '未配置生图引擎 (run.settings.imageConfig)，画面保留为待配图规划。';
        this.saveImageRow(img);
      }
      return { planned, submitted: [] };
    }

    const engineRow = this.database.connection.prepare(
      'SELECT id, kind, enabled FROM generation_engines WHERE id=? AND enabled=1',
    ).get(imageConfig.engineId) as { id: string; kind: string; enabled: number } | undefined;

    if (!engineRow) {
      for (const img of planned) {
        img.consistencyNote = `指定的生图引擎 ${imageConfig.engineId} 不可用或已停用，画面保留为待配图规划。`;
        this.saveImageRow(img);
      }
      return { planned, submitted: [] };
    }

    // 4. 额度计算与待提交队列：
    // 只选取归属于本 run 且处于 planned 状态的图片，严禁将其他 run 或旧分支遗留计划计入
    const pendingImages = this.list(worldId, branchId, { status: 'planned', runId: run.id }).items;
    const currentRun = this.database.connection.prepare(
      'SELECT data_json FROM sw_runs WHERE id=?',
    ).get(run.id) as { data_json: string } | undefined;
    const freshRun = currentRun ? (JSON.parse(currentRun.data_json) as WorldRun) : run;

    const budgetRemaining = Math.max(0, freshRun.settings.maxImages - freshRun.imagesSubmitted);
    const submitted: WorldImage[] = [];

    // 若预算不足或已用尽：明确在图片中展示提示，严禁吞掉状态
    if (budgetRemaining <= 0) {
      for (const img of pendingImages) {
        img.consistencyNote = `运行配图额度已用尽（已提交 ${freshRun.imagesSubmitted} / 上限 ${freshRun.settings.maxImages}），画面保留为待配图规划。`;
        this.saveImageRow(img);
      }
      return { planned, submitted: [] };
    }

    const toSubmit = pendingImages.slice(0, budgetRemaining);
    const beyondBudget = pendingImages.slice(budgetRemaining);
    for (const img of beyondBudget) {
      img.consistencyNote = `超出本轮剩余配图额度（当前剩余 ${budgetRemaining}），画面保留为待配图规划。`;
      this.saveImageRow(img);
    }

    // 5. 逐图提交：
    // 幂等 key 格式 auto-run-${run.id}-img-${img.id}，重启重复处理幂等，且提交进公共队列即返不堵塞调用。
    // 严禁吞掉错误不展示：捕获错误并保存至 img.error 与 img.status='failed'
    for (const img of toSubmit) {
      try {
        const sub = await this.submit(worldId, branchId, img.id, {
          expectedRevision: this.store.getBranch(worldId, branchId).revision,
          idempotencyKey: `auto-run-${run.id}-img-${img.id}`,
          engineId: imageConfig.engineId,
          workflowId: imageConfig.workflowId,
          model: imageConfig.model,
          runId: run.id,
        });
        submitted.push(sub);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        img.status = 'failed';
        img.error = errMsg;
        this.saveImageRow(img);
      }
    }

    return { planned, submitted };
  }

  /**
   * 分支配图列表。
   */
  list(
    worldId: string,
    branchId: string,
    options?: { eventId?: string; runId?: string; status?: WorldImage['status'] },
  ): { items: WorldImage[] } {
    this.store.getBranch(worldId, branchId);
    const filters = ['branch_id=?'];
    const params: Array<string | number> = [branchId];

    if (options?.eventId) {
      filters.push('event_id=?');
      params.push(options.eventId);
    }
    if (options?.status) {
      filters.push('status=?');
      params.push(options.status);
    }

    const rows = this.database.connection.prepare(
      `SELECT data_json FROM sw_images WHERE ${filters.join(' AND ')} ORDER BY created_at, id`,
    ).all(...params) as Array<{ data_json: string }>;

    let items = rows.map((r) => this.parseImageRow(r));
    if (options?.runId) {
      items = items.filter((img) => img.runId === options.runId);
    }

    return { items };
  }
}
