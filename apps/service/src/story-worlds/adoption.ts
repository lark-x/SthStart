import { createHash, randomUUID } from 'node:crypto';
import type {
  WorldAdoption,
  WorldAdoptionResult,
  WorldEvent,
  WorldProjectBinding,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { StoryStore } from '../story/store.js';
import { StoryWorldError, StoryWorldStore } from './store.js';

const ADOPTION_TITLE_MAX = 120;
const ADOPTION_BODY_MAX = 100_000;

export interface StoryWorldAdoptionsContext {
  database: ServiceDatabase;
  config: ServiceConfig;
  secrets: SecretStore;
  fetcher?: typeof fetch;
  store?: StoryWorldStore;
}

export interface WorldAdoptionRecord {
  id: string;
  worldId: string;
  branchId: string;
  projectId: string;
  documentId: string;
  sourceBranchId: string;
  sourceRevision: number;
  eventIds: string[];
  actorId: string | null;
  title: string;
  requestHash?: string;
  adoptedAt: string;
}

function sameBinding(
  left: WorldProjectBinding | null,
  right: WorldProjectBinding | null,
) {
  if (left === null || right === null) return left === right;
  return left.projectId === right.projectId
    && left.worldId === right.worldId
    && left.branchId === right.branchId
    && left.sourceRevision === right.sourceRevision;
}

function composeChapterBody(
  worldId: string,
  branchId: string,
  branchRevision: number,
  actorId: string | null,
  events: WorldEvent[],
  actorNames: Map<string, string>,
) {
  const sections: string[] = [];
  for (const event of events) {
    let narrative = '';
    if (actorId) {
      const perspective = event.perspectives.find((item) => item.actorId === actorId);
      narrative = perspective!.text.trim();
    } else {
      narrative = event.summary;
      if (event.perspectives.length > 0) {
        const views = event.perspectives.map((perspective) => {
          const actorName = actorNames.get(perspective.actorId) ?? perspective.actorId;
          return `> **${actorName}**：${perspective.text}`;
        });
        narrative += '\n\n' + views.join('\n\n');
      }
    }
    sections.push(`### ${event.title}\n\n${narrative}`);
  }

  return [
    `<!-- 采纳自故事世界：世界ID=${worldId} 分支ID=${branchId} 基准版本=${branchRevision} 视角=${actorId || '导演视角'} -->`,
    ...sections,
  ].join('\n\n');
}

export class StoryWorldAdoptions {
  readonly database: ServiceDatabase;
  readonly config: ServiceConfig;
  readonly secrets: SecretStore;
  readonly fetcher: typeof fetch;
  readonly store: StoryWorldStore;
  readonly storyStore: StoryStore;

  constructor(context: StoryWorldAdoptionsContext) {
    this.database = context.database;
    this.config = context.config;
    this.secrets = context.secrets;
    this.fetcher = context.fetcher ?? fetch;
    this.store = context.store ?? new StoryWorldStore(context.database);
    this.storyStore = new StoryStore(context.database);
    this.ensureTables();
  }

  private ensureTables(): void {
    this.database.connection.exec(`
      CREATE TABLE IF NOT EXISTS sw_project_bindings (
        project_id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        source_revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sw_project_bindings_branch ON sw_project_bindings(branch_id);
    `);
  }

  /**
   * 将选定事件与视角采纳进正式创作项目，形成新章节。
   * 幂等校验 request hash 并在版本校验之前识别重复请求；
   * 幂等命中前校验 world 与 branch 归属，杜绝跨世界返回缓存；
   * 自动去重 eventIds 防止重复正文，角色视角不参与事件时直接拒绝；
   * 复用 StoryStore.createDocument 及其已有 callback 同一事务原子写入采纳记录，
   * 严禁覆盖用户已有正文，防止崩溃产生孤立章节。
   */
  adopt(worldId: string, branchId: string, input: WorldAdoption): WorldAdoptionResult {
    // 0. 验证分支及其所属世界真实存在
    const branch = this.store.getBranch(worldId, branchId);
    const title = input.title.trim();

    // 1. 去重事件 ID，防止重复传入导致重复内容写入
    if (!input.eventIds || input.eventIds.length === 0) {
      throw new StoryWorldError('story_adoption_invalid', 400, '采纳至少须选择一个事件。');
    }
    if (input.eventIds.length > 100) {
      throw new StoryWorldError('story_adoption_invalid', 400, '单次采纳不能超过 100 个事件。');
    }

    const uniqueEventIds: string[] = [];
    const seenEventIds = new Set<string>();
    for (const eid of input.eventIds) {
      if (!seenEventIds.has(eid)) {
        seenEventIds.add(eid);
        uniqueEventIds.push(eid);
      }
    }

    // 2. 计算规范化请求哈希（覆盖 events 排序、actor 视角、title 与 project）
    const sortedEventIds = [...uniqueEventIds].sort();
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          events: sortedEventIds,
          actor: input.actorId ?? null,
          title,
          project: input.projectId,
        }),
      )
      .digest('hex');

    // 3. 幂等校验在版本校验之前执行：重放即使分支版本已推移，亦能安全返回已有结果
    // 必须首先校验 world_id 与 branch_id，严禁跨世界/跨分支命中缓存
    const existingRow = this.database.connection.prepare(
      'SELECT world_id, branch_id, data_json FROM sw_adoptions WHERE idempotency_key=?',
    ).get(input.idempotencyKey) as
      | { world_id: string; branch_id: string; data_json: string }
      | undefined;

    if (existingRow) {
      if (existingRow.world_id !== worldId || existingRow.branch_id !== branchId) {
        throw new StoryWorldError(
          'story_adoption_idempotency_conflict',
          409,
          '同一幂等键不能跨世界或跨分支复用。',
        );
      }

      const existing = JSON.parse(String(existingRow.data_json)) as WorldAdoptionRecord;
      if (existing.worldId !== worldId || existing.branchId !== branchId) {
        throw new StoryWorldError(
          'story_adoption_idempotency_conflict',
          409,
          '同一幂等键不能跨世界或跨分支复用。',
        );
      }
      if (existing.requestHash && existing.requestHash !== requestHash) {
        throw new StoryWorldError(
          'story_adoption_idempotency_conflict',
          409,
          '同一幂等键不能提交不同的采纳内容。',
        );
      }
      if (existing.projectId !== input.projectId) {
        throw new StoryWorldError(
          'story_adoption_idempotency_conflict',
          409,
          '同一幂等键不能提交到不同项目。',
        );
      }
      return {
        projectId: existing.projectId,
        documentId: existing.documentId,
        sourceBranchId: existing.sourceBranchId,
        sourceRevision: existing.sourceRevision,
      };
    }

    // 新请求才校验标题：旧记录允许 300 字符契约，重放不能因新上限而失败
    if (!title) {
      throw new StoryWorldError('story_adoption_title_required', 400, '采纳标题不能为空。');
    }
    if (title.length > ADOPTION_TITLE_MAX) {
      throw new StoryWorldError(
        'story_adoption_title_too_long',
        400,
        `采纳标题不能超过 ${ADOPTION_TITLE_MAX} 个字符（当前 ${title.length} 个）。请缩短标题后重试。`,
      );
    }

    // 4. 仅当新请求时核对分支版本
    if (branch.revision !== input.expectedRevision) {
      throw new StoryWorldError(
        'story_branch_revision_conflict',
        409,
        `分支已在其他窗口更新（当前版本 ${branch.revision}），请刷新后重试。`,
      );
    }

    // 5. 校验目标项目存在
    this.storyStore.requireProject(input.projectId);

    const definition = this.store.definition(worldId, branchId);
    const actorMap = new Map(definition.actors.map((a) => [a.id, a]));

    if (input.actorId && !actorMap.has(input.actorId)) {
      throw new StoryWorldError('story_actor_not_found', 400, `指定的视角角色 ${input.actorId} 不存在于该分支。`);
    }
    const perspectiveActor = input.actorId ? actorMap.get(input.actorId) : null;

    // 读取并按时间升序排列所选事件
    const events: WorldEvent[] = [];
    for (const eventId of uniqueEventIds) {
      const eventRow = this.database.connection.prepare(
        'SELECT data_json FROM sw_events WHERE branch_id=? AND id=?',
      ).get(branchId, eventId) as { data_json?: string } | undefined;

      if (!eventRow) {
        throw new StoryWorldError('story_event_not_found', 400, `事件 ${eventId} 不属于当前分支。`);
      }
      events.push(JSON.parse(String(eventRow.data_json)) as WorldEvent);
    }
    events.sort((a, b) => (a.tick === b.tick ? a.id.localeCompare(b.id) : a.tick - b.tick));

    if (input.actorId) {
      for (const event of events) {
        if (!event.participantIds.includes(input.actorId)) {
          throw new StoryWorldError(
            'story_actor_not_participant',
            400,
            `角色“${perspectiveActor?.name || input.actorId}”未参与事件“${event.title}”，无法作为该事件的主观视角。请选择该角色参与的事件或使用客观视角采纳。`,
          );
        }

        const perspective = event.perspectives.find((p) => p.actorId === input.actorId);
        if (!perspective || !perspective.text.trim()) {
          throw new StoryWorldError(
            'story_actor_perspective_missing',
            400,
            `角色“${perspectiveActor?.name || input.actorId}”虽参与了事件“${event.title}”，但缺少其个人视角正文（直接回退全知概括可能泄露该角色不知情的事实）。请切换为客观视角采纳，或先为该角色补充个人视角正文后重试。`,
          );
        }
      }
    }

    const actorNames = new Map(definition.actors.map((actor) => [actor.id, actor.name]));
    const chapterBody = composeChapterBody(
      worldId,
      branchId,
      branch.revision,
      input.actorId ?? null,
      events,
      actorNames,
    );
    if (chapterBody.length > ADOPTION_BODY_MAX) {
      throw new StoryWorldError(
        'story_adoption_body_too_large',
        400,
        `采纳正文共 ${chapterBody.length} 个字符，超过单章 ${ADOPTION_BODY_MAX} 字符上限。请减少所选事件或缩短事件正文后重试。`,
      );
    }

    let result: WorldAdoptionResult | null = null;

    this.storyStore.createDocument(
      input.projectId,
      {
        kind: 'chapter',
        title,
        body: chapterBody,
      },
      (createdDoc) => {
        const now = nowIso();
        const adoptionId = randomUUID();
        const record: WorldAdoptionRecord = {
          id: adoptionId,
          worldId,
          branchId,
          projectId: input.projectId,
          documentId: createdDoc.id,
          sourceBranchId: branchId,
          sourceRevision: branch.revision,
          eventIds: uniqueEventIds,
          actorId: input.actorId ?? null,
          title,
          requestHash,
          adoptedAt: now,
        };

        this.database.connection.prepare(`
          INSERT INTO sw_adoptions (id, world_id, branch_id, project_id, idempotency_key, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          adoptionId,
          worldId,
          branchId,
          input.projectId,
          input.idempotencyKey,
          JSON.stringify(record),
          now,
        );

        result = {
          projectId: input.projectId,
          documentId: createdDoc.id,
          sourceBranchId: branchId,
          sourceRevision: branch.revision,
        };
      },
    );

    return result!;
  }

  /**
   * 将项目绑定至指定分支，核对真实分支版本并持久化到 sw_project_bindings 表。
   */
  bindProject(
    projectId: string,
    worldId: string,
    branchId: string,
    expectedRevision: number,
    expectedBinding?: WorldProjectBinding | null,
  ): WorldProjectBinding {
    this.ensureTables();
    this.storyStore.requireProject(projectId);
    const now = nowIso();
    return this.database.transaction(() => {
      const branch = this.store.getBranch(worldId, branchId);
      if (branch.revision !== expectedRevision) {
        throw new StoryWorldError(
          'story_branch_revision_conflict',
          409,
          `分支已在其他窗口更新（当前版本 ${branch.revision}），请刷新后重试。`,
        );
      }
      const current = this.readProjectBinding(projectId);
      if (expectedBinding !== undefined) {
        if (!sameBinding(current, expectedBinding)) {
          const detail = current
            ? expectedBinding
              ? '项目绑定已在其他窗口更新，请刷新后重试。'
              : '项目已经有故事世界绑定，请刷新后确认。'
            : '项目当前没有故事世界绑定，请刷新后重试。';
          throw new StoryWorldError('story_project_binding_conflict', 409, detail);
        }
      } else if (current && (current.worldId !== worldId || current.branchId !== branchId)) {
        throw new StoryWorldError(
          'story_project_binding_conflict',
          409,
          '项目已绑定到另一条世界分支；旧版请求不能覆盖现有绑定，请刷新页面确认。',
        );
      }

      this.database.connection.prepare(`
        INSERT INTO sw_project_bindings (project_id, world_id, branch_id, source_revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          world_id = excluded.world_id,
          branch_id = excluded.branch_id,
          source_revision = excluded.source_revision,
          updated_at = excluded.updated_at
      `).run(projectId, worldId, branchId, branch.revision, now, now);

      return {
        projectId,
        worldId,
        branchId,
        sourceRevision: branch.revision,
      };
    });
  }

  private readProjectBinding(projectId: string): WorldProjectBinding | null {
    const row = this.database.connection.prepare(`
      SELECT project_id, world_id, branch_id, source_revision
      FROM sw_project_bindings
      WHERE project_id=?
    `).get(projectId) as
      | { project_id: string; world_id: string; branch_id: string; source_revision: number }
      | undefined;

    if (!row) return null;
    return {
      projectId: row.project_id,
      worldId: row.world_id,
      branchId: row.branch_id,
      sourceRevision: row.source_revision,
    };
  }

  /**
   * 查询项目绑定的故事世界分支。直接读取独立的 sw_project_bindings 表。
   */
  getProjectBinding(projectId: string): WorldProjectBinding | null {
    this.ensureTables();
    this.storyStore.requireProject(projectId);
    return this.readProjectBinding(projectId);
  }

  /**
   * 查询项目的历史采纳记录。
   */
  listProjectAdoptions(projectId: string): WorldAdoptionRecord[] {
    this.storyStore.requireProject(projectId);
    const rows = this.database.connection.prepare(`
      SELECT data_json FROM sw_adoptions
      WHERE project_id=?
      ORDER BY created_at DESC
    `).all(projectId) as Array<{ data_json: string }>;

    return rows
      .map((r) => JSON.parse(r.data_json) as WorldAdoptionRecord)
      .filter((rec) => Boolean(rec.documentId));
  }
}
