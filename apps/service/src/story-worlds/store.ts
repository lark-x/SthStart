import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  CreateWorldBranchSchema, CreateWorldInterventionSchema, CreateWorldStoryLineSchema,
  WorldActorSchema, WorldActorStateSchema, WorldDefinitionSchema, WorldEventSchema, WorldMemorySchema,
  WorldRunSchema, WorldSourceSchema, type CreateWorldBranch, type CreateWorldIntervention,
  resolveCharacterVersionSelection,
  type CreateWorldStoryLine, type StoryWorld, type WorldActorState, type WorldBranch,
  type WorldBranchDetail, type WorldDefinition, type WorldEvent, type WorldEventPage, type WorldEventQuery,
  type WorldIntervention, type WorldMemory, type WorldOverview, type WorldRun, type WorldStoryLine,
} from '@sthstart/contracts';
import {
  CreateWorldBundleSchema, UpdateWorldBranchSchema, type CreateWorldBundle,
  type UpdateWorldBranch, type WorldBundleResult,
  CreateWorldSetupSchema, UpdateWorldSetupSchema, WorldAuthoringDraftSchema,
  type CreateWorldSetup, type UpdateWorldSetup, type WorldSetup, type WorldSetupResult,
  type WorldAuthoringDraft, type WorldSetupList,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { canonicalWork, upsertCharacterWorkHierarchy } from '../characters/organization.js';
import { mapCharacterVersion } from '../characters/snapshots.js';

type Row = Record<string, unknown>;
type SqlValue = string | number | null;
type WorldActor = WorldDefinition['actors'][number];
type DefinitionSnapshot = {
  revision: number; effectiveTick: number; sourceRevision: number;
  definition: WorldDefinition; createdAt: string;
};
type EventFact = {
  eventId: string; eventTick: number; completedTick: number; participantIds: readonly string[];
  fact: WorldEvent['facts'][number]; normalizedContent: string;
};

const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const clone = <T>(value: T): T => structuredClone(value);
const asNumber = (row: Row, key: string) => Number(row[key]);
const asString = (row: Row, key: string) => String(row[key]);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([name, entry]) => `${JSON.stringify(name)}:${canonicalJson(entry)}`).join(',')}}`;
}

export class StoryWorldError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
    this.name = 'StoryWorldError';
  }
}

function fail(code: string, statusCode: number, message: string): never {
  throw new StoryWorldError(code, statusCode, message);
}

function assertSchema<T>(schema: TSchema, value: unknown, code: string, label: string): asserts value is T {
  if (Value.Check(schema, value)) return;
  const first = [...Value.Errors(schema, value)][0];
  fail(code, 400, `${label} ${first?.path ?? '/'} 格式错误：${first?.message ?? '不符合契约'}`);
}

function unique(values: readonly string[], label: string, code = 'story_definition_invalid') {
  if (new Set(values).size !== values.length) fail(code, 400, `${label}存在重复 ID。`);
}

function requiredText(value: string, label: string, code = 'story_definition_invalid') {
  const trimmed = value.trim();
  if (!trimmed) fail(code, 400, `${label}不能为空。`);
  return trimmed;
}

function isActiveRun(status: WorldRun['status']) {
  return status === 'queued' || status === 'running' || status === 'paused' || status === 'uncertain';
}

function definitionOf(world: StoryWorld): WorldDefinition {
  const { id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = world;
  return clone(definition);
}

function initialActorState(actor: WorldActor, tick = 0): WorldActorState {
  return {
    actorId: actor.id, locationId: actor.locationId, goals: clone(actor.goals), emotion: '',
    relationships: [], updatedTick: tick,
  };
}

type EventCursor = {
  version: 1; scope: string; context: string; tick: number; id: string;
};

function cursorHash(...parts: Array<string | number | null>) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 18);
}

function encodeCursor(cursor: EventCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): EventCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('shape');
    const cursor = parsed as Partial<EventCursor>;
    if (cursor.version !== 1 || !cursor.scope || !cursor.context
      || !Number.isInteger(cursor.tick) || (cursor.tick as number) < 0
      || typeof cursor.id !== 'string' || !cursor.id
      || typeof cursor.scope !== 'string' || typeof cursor.context !== 'string') throw new Error('shape');
    return cursor as EventCursor;
  } catch {
    fail('story_event_cursor_invalid', 400, '事件游标无效，请从第一页重新加载。');
  }
}

function eventFromRow(row: Row): WorldEvent {
  return parse<WorldEvent>(row.data_json);
}

function memoryFromRow(row: Row): WorldMemory {
  return parse<WorldMemory>(row.data_json);
}

function storyLineFromRow(row: Row): WorldStoryLine {
  return parse<WorldStoryLine>(row.data_json);
}

function interventionFromRow(row: Row): WorldIntervention {
  return parse<WorldIntervention>(row.data_json);
}

/**
 * 故事世界数据层。所有写入限定在 sw_* 表，不修改角色库、资料库或已有正文。
 * 读接口返回副本，调用方可安全修改；revision 以列为准并与 data_json 同步。
 */
export class StoryWorldStore {
  private savepointSeed = 0;

  constructor(readonly database: ServiceDatabase) {}

  private get(sql: string, ...args: SqlValue[]): Row | undefined {
    return this.database.connection.prepare(sql).get(...args) as Row | undefined;
  }

  private all(sql: string, ...args: SqlValue[]): Row[] {
    return this.database.connection.prepare(sql).all(...args) as Row[];
  }

  private exec(sql: string, ...args: SqlValue[]) {
    return this.database.connection.prepare(sql).run(...args);
  }

  private atomic<T>(operation: () => T): T {
    if (this.database.connection.isTransaction) {
      const name = `sw_step_${++this.savepointSeed}`;
      this.database.connection.exec(`SAVEPOINT ${name}`);
      try {
        const value = operation();
        this.database.connection.exec(`RELEASE ${name}`);
        return value;
      } catch (error) {
        this.database.connection.exec(`ROLLBACK TO ${name}`);
        this.database.connection.exec(`RELEASE ${name}`);
        throw error;
      }
    }
    return this.database.transaction(operation);
  }

  list(): { items: StoryWorld[] } {
    return { items: this.all('SELECT * FROM sw_worlds ORDER BY updated_at DESC,id').map((row) => this.worldFromRow(row)) };
  }

  create(definition: WorldDefinition): StoryWorld {
    return this.insertWorld(definition, randomUUID(), nowIso());
  }

  private syncWork(definition: WorldDefinition, worldId: string): void {
    const existing = this.get('SELECT work_nature,parent_work FROM character_works WHERE world_id=?', worldId);
    if (!definition.workNature && !existing) return;
    const work = upsertCharacterWorkHierarchy(this.database, {
      name: definition.title, workNature: definition.workNature ?? existing?.work_nature as WorldDefinition['workNature'],
      parentWork: definition.parentWork === undefined ? existing?.parent_work as string | null | undefined : definition.parentWork,
      worldId, summary: definition.summary,
    }, { syncWorldDefinition: false });
    definition.workNature = work.workNature;
    definition.parentWork = work.parentWork;
  }

  private insertWorld(definition: WorldDefinition, id: string, createdAt: string): StoryWorld {
    this.validateDefinition(definition);
    const now = nowIso();
    const world: StoryWorld = {
      ...clone(definition), title: requiredText(definition.title, '世界名称'),
      id, revision: 1, createdAt, updatedAt: now,
    };
    this.atomic(() => {
      this.syncWork(world, id);
      this.exec('INSERT INTO sw_worlds(id,revision,data_json,created_at,updated_at) VALUES (?,?,?,?,?)',
        id, 1, JSON.stringify(world), createdAt, now);
    });
    return clone(world);
  }

  listSetups(): WorldSetupList {
    return { items: this.all('SELECT id,title,draft_json FROM sw_world_setups WHERE completed_branch_id IS NULL ORDER BY updated_at DESC,id')
      .map((row) => {
        const parsed = parse<WorldAuthoringDraft>(row.draft_json);
        return {
          id: asString(row, 'id'),
          title: asString(row, 'title'),
          ...(parsed.definition?.workNature ? { workNature: parsed.definition.workNature } : {}),
          ...(parsed.definition?.parentWork !== undefined ? { parentWork: parsed.definition.parentWork } : {}),
        };
      }) };
  }

  createSetup(input: CreateWorldSetup): { id: string; title: string; workNature?: 'canon' | 'derivative' | 'original'; parentWork?: string | null } {
    assertSchema<CreateWorldSetup>(CreateWorldSetupSchema, input, 'story_setup_invalid', '创建请求');
    const title = requiredText(input.title, '世界名称');
    const request = {
      title, workNature: input.workNature ?? null,
      parentWork: input.workNature === 'derivative' ? canonicalWork(this.database, input.parentWork ?? '') || null : null,
    };
    return this.atomic(() => {
      const previous = this.get('SELECT * FROM sw_world_setups WHERE creation_key=?', input.idempotencyKey);
      if (previous) {
        const prevDraft = parse<WorldAuthoringDraft>(previous.draft_json);
        const completed = previous.completed_branch_id ? this.requireWorld(asString(previous, 'id')) : null;
        const previousDefinition = prevDraft.definition ?? completed;
        const previousRequest = previous.creation_request_json ? parse(previous.creation_request_json) : {
          title: previous.creation_title, workNature: previousDefinition?.workNature ?? null,
          parentWork: previousDefinition?.workNature === 'derivative' ? canonicalWork(this.database, previousDefinition.parentWork ?? '') || null : null,
        };
        const previousIdentity = previousRequest as { title: string; workNature: string | null; parentWork: string | null };
        if (previousIdentity.parentWork) previousIdentity.parentWork = canonicalWork(this.database, previousIdentity.parentWork);
        if (canonicalJson(previousRequest) !== canonicalJson(request)) {
          fail('story_creation_idempotency_conflict', 409, '该创建请求已用于其他作品名称或属性。');
        }
        return {
          id: asString(previous, 'id'),
          title: asString(previous, 'title'),
          ...(previousDefinition?.workNature ? { workNature: previousDefinition.workNature } : {}),
          ...(previousDefinition?.parentWork !== undefined ? { parentWork: previousDefinition.parentWork } : {}),
        };
      }
      const id = randomUUID();
      const now = nowIso();
      const workNature = input.workNature;
      const parentWork = request.parentWork;
      const initialMode = workNature === 'derivative'
        ? 'adaptation'
        : workNature === 'original'
          ? 'alternate'
          : 'canon-gap';
      const draft: WorldAuthoringDraft = {
        definition: {
          title,
          summary: '',
          timeLabel: '故事时间',
          ...(workNature ? { workNature, parentWork } : {}),
          locations: [],
          actors: [],
          sources: [],
          visualReferences: [],
          lockedFacts: [],
          models: { action: null, adjudication: null, narration: null },
          visualStyle: '',
        },
        initialBranch: { title: '主线', mode: initialMode, direction: '' },
      };
      this.syncWork(draft.definition, id);
      this.exec(`INSERT INTO sw_world_setups(id,creation_key,creation_title,title,revision,draft_json,created_at,updated_at,creation_request_json)
        VALUES (?,?,?,?,1,?,?,?,?)`, id, input.idempotencyKey, title, title, JSON.stringify(draft), now, now, canonicalJson(request));
      return {
        id,
        title,
        ...(workNature ? { workNature, parentWork } : {}),
      };
    });
  }

  getSetup(id: string): WorldSetup {
    const row = this.get('SELECT * FROM sw_world_setups WHERE id=? AND completed_branch_id IS NULL', id);
    if (!row) fail('story_setup_not_found', 404, '找不到待配置的世界。');
    return { id, revision: asNumber(row, 'revision'), draft: parse<WorldAuthoringDraft>(row.draft_json) };
  }

  saveSetup(id: string, input: UpdateWorldSetup): WorldSetupResult {
    assertSchema<UpdateWorldSetup>(UpdateWorldSetupSchema, input, 'story_setup_invalid', '世界配置');
    const draft = clone(input.draft);
    draft.definition.title = requiredText(draft.definition.title, '世界名称');
    draft.initialBranch.title = requiredText(draft.initialBranch.title, '分支名称');
    const hash = createHash('sha256').update(canonicalJson({ draft, expectedRevision: input.expectedRevision })).digest('hex');
    return this.atomic(() => {
      const row = this.get('SELECT * FROM sw_world_setups WHERE id=?', id);
      if (!row) fail('story_setup_not_found', 404, '找不到待配置的世界。');
      if (row.completed_branch_id && input.complete && row.completion_hash === hash) {
        return { status: 'ready', world: this.requireWorld(id), branch: this.requireBranch(id, asString(row, 'completed_branch_id')) };
      }
      if (row.completed_branch_id || row.revision !== input.expectedRevision) {
        fail('story_setup_conflict', 409, '世界设定已在别处修改，请先核对最新版本。');
      }
      this.validateDefinition(draft.definition, !input.complete);
      if (input.complete) {
        const world = this.insertWorld(draft.definition, id, asString(row, 'created_at'));
        const branch = this.createBranch(id, { ...draft.initialBranch, expectedRevision: world.revision });
        this.exec("UPDATE sw_world_setups SET completed_branch_id=?, completion_hash=?, title=?, draft_json='{}' WHERE id=?",
          branch.id, hash, world.title, id);
        return { status: 'ready', world, branch };
      }
      this.syncWork(draft.definition, id);
      this.exec('UPDATE sw_world_setups SET title=?, revision=revision+1, draft_json=?, updated_at=? WHERE id=?',
        draft.definition.title, JSON.stringify(draft), nowIso(), id);
      return { status: 'pending', setup: this.getSetup(id) };
    });
  }

  createBundle(input: CreateWorldBundle): WorldBundleResult {
    return this.atomic(() => {
      assertSchema<CreateWorldBundle>(CreateWorldBundleSchema, input, 'story_creation_invalid', '世界创建请求');
      const requestHash = createHash('sha256')
        .update(canonicalJson({ definition: input.definition, initialBranch: input.initialBranch }))
        .digest('hex');
      const existing = this.get(
        'SELECT request_hash,world_id,branch_id FROM sw_creation_requests WHERE idempotency_key=?',
        input.idempotencyKey,
      );
      if (existing) {
        if (asString(existing, 'request_hash') !== requestHash) {
          fail('story_creation_idempotency_conflict', 409, '该幂等键已用于另一组世界创建内容。');
        }
        const worldId = asString(existing, 'world_id');
        const branchId = asString(existing, 'branch_id');
        const world = this.requireWorld(worldId);
        return { world, branch: this.requireBranch(worldId, branchId) };
      }
      const world = this.create(input.definition);
      const branch = this.createBranch(world.id, {
        expectedRevision: world.revision,
        title: input.initialBranch.title,
        mode: input.initialBranch.mode,
        direction: input.initialBranch.direction,
      });
      this.exec(
        'INSERT INTO sw_creation_requests(idempotency_key,request_hash,world_id,branch_id,created_at) VALUES (?,?,?,?,?)',
        input.idempotencyKey, requestHash, world.id, branch.id, nowIso(),
      );
      return { world, branch };
    });
  }

  getWorld(worldId: string): StoryWorld {
    return this.requireWorld(worldId);
  }

  overview(worldId: string): WorldOverview {
    const world = this.requireWorld(worldId);
    const branches = this.all('SELECT * FROM sw_branches WHERE world_id=? ORDER BY created_at,id', worldId)
      .map((row) => this.branchFromRow(row));
    return { world, branches };
  }

  updateWorld(worldId: string, input: { expectedRevision: number; definition: WorldDefinition }): StoryWorld {
    const current = this.requireWorld(worldId);
    this.validateDefinition(input.definition);
    const now = nowIso();
    const world: StoryWorld = {
      ...clone(input.definition), title: requiredText(input.definition.title, '世界名称'),
      id: worldId, revision: input.expectedRevision + 1, createdAt: current.createdAt, updatedAt: now,
    };
    this.atomic(() => {
      this.syncWork(world, worldId);
      const result = this.exec('UPDATE sw_worlds SET revision=?,data_json=?,updated_at=? WHERE id=? AND revision=?',
        world.revision, JSON.stringify(world), now, worldId, input.expectedRevision);
      if (result.changes !== 1) this.conflictWorld(worldId);
    });
    return this.requireWorld(worldId);
  }

  /**
   * 在当前故事时刻显式替换分支 definition（例如配角提升为主角并关联角色库）。
   * 保留当前 tick 与来源版本，写入新定义快照并递增分支 revision；历史快照不变。
   * 有活动运行时拒绝改写，避免角色阵容与正在推进的上下文分离。
   */
  updateDefinitionAtCurrentTick(
    worldId: string, branchId: string, expectedRevision: number, definition: WorldDefinition,
  ): WorldBranch {
    this.validateDefinition(definition);
    return this.atomic(() => {
      const branch = this.requireBranch(worldId, branchId);
      if (branch.revision !== expectedRevision) this.conflictBranch(branchId);
      const active = this.get(`SELECT id FROM sw_runs WHERE branch_id=?
        AND status IN ('queued','running','paused','uncertain') ORDER BY updated_at DESC,id LIMIT 1`, branchId);
      if (active) {
        fail('story_run_conflict', 409, '该分支有活动运行，暂停或结束后才能调整角色阵容。');
      }
      const now = nowIso();
      const next: WorldBranch = { ...branch, revision: expectedRevision + 1, updatedAt: now };
      const result = this.exec(`UPDATE sw_branches SET revision=?,definition_json=?,data_json=?,updated_at=?
        WHERE id=? AND revision=?`, next.revision, JSON.stringify(definition), JSON.stringify(next), now,
      branchId, expectedRevision);
      if (result.changes !== 1) this.conflictBranch(branchId);
      this.insertDefinitionSnapshot(branchId, next.revision, branch.currentTick, branch.sourceRevision, definition, now);
      return next;
    });
  }

  createBranch(worldId: string, input: CreateWorldBranch): WorldBranch {
    assertSchema<CreateWorldBranch>(CreateWorldBranchSchema, input, 'story_branch_invalid', '分支请求');
    const world = this.requireWorld(worldId);
    if (world.revision !== input.expectedRevision) this.conflictWorld(worldId);
    const title = requiredText(input.title, '分支名称', 'story_branch_invalid');
    const parent = input.parentBranchId
      ? this.requireBranch(worldId, input.parentBranchId)
      : null;
    const forkTick = input.forkTick ?? (parent ? parent.currentTick : 0);
    if (!Number.isInteger(forkTick) || forkTick < 0) fail('story_branch_fork_invalid', 400, '分支起点必须是非负整数。');
    if (!parent && forkTick !== 0) fail('story_branch_fork_invalid', 400, '根分支只能从世界起点 0 开始。');
    if (parent && forkTick > parent.currentTick) {
      fail('story_branch_fork_invalid', 400, `分支起点 ${forkTick} 晚于父分支当前时刻 ${parent.currentTick}。`);
    }
    if (parent && forkTick < parent.forkTick) {
      fail('story_branch_fork_invalid', 400, `分支起点 ${forkTick} 早于父分支自身起点 ${parent.forkTick}。`);
    }

    const now = nowIso();
    const id = randomUUID();
    let definition: WorldDefinition;
    if (parent) {
      const parentSnapshot = this.definitionSnapshotAt(worldId, parent.id, forkTick);
      const parentDefinition = parentSnapshot.definition;
      // An event's facts/prose describe its completed outcome. A fork inside its
      // duration cannot inherit that whole outcome before it has happened.
      const inheritedEvents = this.all('SELECT * FROM sw_events WHERE branch_id=? AND tick+duration<=? ORDER BY tick,id', parent.id, forkTick)
        .map((row) => eventFromRow(row));
      const inheritedEventIds = new Set(inheritedEvents.map((event) => event.id));
      const parentMemories = this.all('SELECT * FROM sw_memories WHERE branch_id=? AND learned_at<=? ORDER BY learned_at,id', parent.id, forkTick)
        .map((row) => memoryFromRow(row)).filter((memory) => inheritedEventIds.has(memory.sourceEventId));
      const parentStates = this.all('SELECT * FROM sw_actor_states WHERE branch_id=?', parent.id)
        .map((row) => parse<WorldActorState>(row.data_json));
      const parentStoryLines = this.all('SELECT * FROM sw_story_lines WHERE branch_id=? ORDER BY created_tick,id', parent.id)
        .map((row) => ({ createdTick: asNumber(row, 'created_tick'), line: storyLineFromRow(row) }));
      const seenAt = this.actorAppearanceTicks(inheritedEvents, parentMemories, parentStates, parentStoryLines, forkTick);
      definition = {
        ...clone(parentDefinition),
        actors: clone(parentDefinition.actors.filter((actor) => {
          if (actor.role !== 'supporting') return true;
          const firstSeen = seenAt.get(actor.id);
          return firstSeen === undefined || firstSeen <= forkTick;
        })),
      };
      const states = this.deriveForkStates(definition, parentStates, inheritedEvents, forkTick);
      const inheritedIds = new Set(inheritedEvents.flatMap((event) => event.storyLineIds));
      const inheritedLines = parentStoryLines
        .filter(({ createdTick, line }) => createdTick <= forkTick || inheritedIds.has(line.id))
        .map(({ createdTick, line }) => ({ createdTick, line }));
      const interventions = this.all('SELECT * FROM sw_interventions WHERE branch_id=? AND tick<=? AND consumed=0 ORDER BY tick,id', parent.id, forkTick)
        .map((row) => interventionFromRow(row));
      const branch: WorldBranch = {
        id, worldId, title, mode: input.mode, parentBranchId: parent.id, forkTick,
        currentTick: forkTick, revision: 1, sourceRevision: parentSnapshot.sourceRevision,
        direction: input.direction, createdAt: now, updatedAt: now,
      };
      this.atomic(() => {
        this.insertBranch(branch, definition, now);
        for (const state of states) this.insertState(branch.id, state, now);
        for (const event of inheritedEvents) {
          const copied = { ...clone(event), branchId: id };
          this.insertEvent(copied, now);
        }
        for (const memory of parentMemories) {
          const copied = { ...clone(memory), branchId: id };
          this.insertMemory(copied);
        }
        for (const { createdTick, line } of inheritedLines) {
          const copied = { ...clone(line), branchId: id };
          this.insertStoryLine(copied, createdTick);
        }
        for (const intervention of interventions) {
          const copied = { ...clone(intervention), branchId: id };
          this.insertIntervention(copied);
        }
      });
      return branch;
    }

    definition = definitionOf(world);
    const branch: WorldBranch = {
      id, worldId, title, mode: input.mode, parentBranchId: null, forkTick: 0,
      currentTick: 0, revision: 1, sourceRevision: world.revision,
      direction: input.direction, createdAt: now, updatedAt: now,
    };
    this.atomic(() => {
      this.insertBranch(branch, definition, now);
      for (const actor of definition.actors) this.insertState(id, initialActorState(actor, 0), now);
    });
    return branch;
  }

  updateBranch(worldId: string, branchId: string, input: UpdateWorldBranch): WorldBranch {
    return this.atomic(() => {
      assertSchema<UpdateWorldBranch>(UpdateWorldBranchSchema, input, 'story_branch_invalid', '分支更新请求');
      const branch = this.requireBranch(worldId, branchId);
      if (branch.revision !== input.expectedRevision) this.conflictBranch(branchId);
      const active = this.get(`SELECT id FROM sw_runs WHERE branch_id=?
        AND status IN ('queued','running','paused','uncertain') ORDER BY updated_at DESC,id LIMIT 1`, branchId);
      if (active) {
        fail('story_run_conflict', 409, '该分支有活动运行，暂停或结束后才能修改分支设定。');
      }
      const now = nowIso();
      const next: WorldBranch = {
        ...branch,
        title: requiredText(input.title, '分支名称', 'story_branch_invalid'),
        mode: input.mode,
        direction: input.direction,
        revision: input.expectedRevision + 1,
        updatedAt: now,
      };
      const result = this.exec(
        'UPDATE sw_branches SET revision=?,data_json=?,updated_at=? WHERE id=? AND world_id=? AND revision=?',
        next.revision, JSON.stringify(next), now, branchId, worldId, input.expectedRevision,
      );
      if (result.changes !== 1) this.conflictBranch(branchId);
      return clone(next);
    });
  }

  getBranch(worldId: string, branchId: string): WorldBranch {
    this.requireWorld(worldId);
    return this.requireBranch(worldId, branchId);
  }

  detail(worldId: string, branchId: string): WorldBranchDetail {
    const branch = this.getBranch(worldId, branchId);
    const world = this.requireWorld(worldId);
    const states = this.all('SELECT * FROM sw_actor_states WHERE branch_id=? ORDER BY actor_id', branchId)
      .map((row) => parse<WorldActorState>(row.data_json));
    const storyLines = this.all('SELECT * FROM sw_story_lines WHERE branch_id=? ORDER BY created_tick,id', branchId)
      .map((row) => storyLineFromRow(row));
    const interventions = this.all('SELECT * FROM sw_interventions WHERE branch_id=? ORDER BY tick,id', branchId)
      .map((row) => interventionFromRow(row));
    const images = this.all('SELECT * FROM sw_images WHERE branch_id=? ORDER BY created_at,id', branchId)
      .map((row) => parse<WorldBranchDetail['images'][number]>(row.data_json));
    const runRow = this.get('SELECT * FROM sw_runs WHERE branch_id=? ORDER BY updated_at DESC,id LIMIT 1', branchId);
    const run = runRow ? parse<WorldRun>(runRow.data_json) : null;
    return {
      branch, definition: this.definition(worldId, branchId), states, storyLines, run, interventions, images,
      sourceUpdatesAvailable: world.revision > branch.sourceRevision,
    };
  }

  events(worldId: string, branchId: string, query: WorldEventQuery): WorldEventPage {
    const branch = this.getBranch(worldId, branchId);
    const definition = this.definition(worldId, branchId);
    const from = query.from ?? 0;
    const to = query.to ?? Math.max(branch.currentTick, from);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
      fail('story_event_window_invalid', 400, '事件时间窗口必须满足 0 ≤ from ≤ to。');
    }
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail('story_event_limit_invalid', 400, '每页事件数须在 1–200 之间。');
    if (query.actorId && !definition.actors.some((actor) => actor.id === query.actorId)) {
      fail('story_event_filter_invalid', 400, `未知角色 ${query.actorId} 不能作为事件筛选条件。`);
    }
    if (query.storyLineId && !this.get('SELECT 1 FROM sw_story_lines WHERE branch_id=? AND id=?', branchId, query.storyLineId)) {
      fail('story_event_filter_invalid', 400, `未知故事线 ${query.storyLineId} 不能作为事件筛选条件。`);
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const cursorScope = cursorHash(worldId, branchId);
    const cursorContext = cursorHash(query.actorId ?? null, query.storyLineId ?? null, from, to);
    if (cursor) {
      if (cursor.scope !== cursorScope) {
        fail('story_event_cursor_mismatch', 400, '事件游标不属于当前世界或分支，请从第一页重新加载。');
      }
      if (cursor.context !== cursorContext) {
        fail('story_event_cursor_context', 400, '事件游标与当前时间窗口或筛选条件不一致，请从第一页重新加载。');
      }
      if (cursor.tick < from || cursor.tick > to) {
        fail('story_event_cursor_window', 400, '事件游标不在当前时间窗口内。');
      }
    }
    const filters = ['branch_id=?', 'tick>=?', 'tick<=?'];
    const filterParams: SqlValue[] = [branchId, from, to];
    if (query.actorId) {
      filters.push("EXISTS (SELECT 1 FROM json_each(sw_events.data_json,'$.participantIds') WHERE json_each.value=?)");
      filterParams.push(query.actorId);
    }
    if (query.storyLineId) {
      filters.push("EXISTS (SELECT 1 FROM json_each(sw_events.data_json,'$.storyLineIds') WHERE json_each.value=?)");
      filterParams.push(query.storyLineId);
    }
    const pageFilters = [...filters];
    const pageParams = [...filterParams];
    if (cursor) {
      pageFilters.push('(tick>? OR (tick=? AND id>?))');
      pageParams.push(cursor.tick, cursor.tick, cursor.id);
    }
    const rows = this.all(`SELECT * FROM sw_events WHERE ${pageFilters.join(' AND ')} ORDER BY tick,id LIMIT ?`,
      ...pageParams, limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => eventFromRow(row));
    const totalRow = this.get(`SELECT COUNT(*) AS count FROM sw_events WHERE ${filters.join(' AND ')}`, ...filterParams);
    const bucketSize = Math.max(1, Math.ceil((to - from + 1) / 24));
    const bucketRows = this.all(`SELECT CAST((tick-?)/? AS INTEGER) AS bucket,COUNT(*) AS count
      FROM sw_events WHERE ${filters.join(' AND ')} GROUP BY bucket ORDER BY bucket`, from, bucketSize, ...filterParams);
    const buckets = bucketRows.map((row) => {
      const bucket = asNumber(row, 'bucket');
      const start = from + bucket * bucketSize;
      return { from: start, to: Math.min(start + bucketSize - 1, to), count: asNumber(row, 'count') };
    });
    const last = items.at(-1);
    return {
      items, nextCursor: hasMore && last ? encodeCursor({
        version: 1, scope: cursorScope, context: cursorContext, tick: last.tick, id: last.id,
      }) : null,
      total: asNumber(totalRow ?? {}, 'count'), from, to, buckets,
    };
  }

  memories(worldId: string, branchId: string, actorId?: string): { items: WorldMemory[] } {
    this.getBranch(worldId, branchId);
    if (actorId) {
      const definition = this.definition(worldId, branchId);
      if (!definition.actors.some((actor) => actor.id === actorId)) {
        fail('story_memory_filter_invalid', 400, `未知角色 ${actorId} 不能作为记忆筛选条件。`);
      }
    }
    const items = (actorId
      ? this.all('SELECT * FROM sw_memories WHERE branch_id=? AND actor_id=? ORDER BY learned_at,id', branchId, actorId)
      : this.all('SELECT * FROM sw_memories WHERE branch_id=? ORDER BY learned_at,id', branchId))
      .map((row) => memoryFromRow(row));
    return { items };
  }

  addStoryLine(worldId: string, branchId: string, input: CreateWorldStoryLine): WorldStoryLine {
    assertSchema<CreateWorldStoryLine>(CreateWorldStoryLineSchema, input, 'story_line_invalid', '故事线请求');
    const branch = this.getBranch(worldId, branchId);
    if (branch.revision !== input.expectedRevision) this.conflictBranch(branchId);
    const title = requiredText(input.title, '故事线名称', 'story_line_invalid');
    const definition = this.definition(worldId, branchId);
    const actorIds = [...input.actorIds];
    unique(actorIds, '故事线角色', 'story_line_invalid');
    this.assertActorsExist(definition, actorIds, 'story_line_invalid');
    const line: WorldStoryLine = {
      id: randomUUID(), worldId, branchId, title, description: input.description, actorIds,
      ...(input.arcKind ? { arcKind: input.arcKind } : {}),
      ...(input.chapterCode !== undefined ? { chapterCode: input.chapterCode } : {}),
      ...(input.mcpQueryHint !== undefined ? { mcpQueryHint: input.mcpQueryHint } : {}),
      ...(input.timeWindowLabel !== undefined ? { timeWindowLabel: input.timeWindowLabel } : {}),
      ...(input.regionIds ? { regionIds: [...input.regionIds] } : {}),
      ...(input.locationIds ? { locationIds: [...input.locationIds] } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
      ...(input.chapterIds ? { chapterIds: [...input.chapterIds] } : {}),
    };
    const now = nowIso();
    this.atomic(() => {
      this.insertStoryLine(line, branch.currentTick);
      this.bumpBranch(branchId, input.expectedRevision, now);
    });
    return clone(line);
  }

  intervene(worldId: string, branchId: string, input: CreateWorldIntervention): WorldIntervention {
    assertSchema<CreateWorldIntervention>(CreateWorldInterventionSchema, input, 'story_intervention_invalid', '干预请求');
    const branch = this.getBranch(worldId, branchId);
    if (branch.revision !== input.expectedRevision) this.conflictBranch(branchId);
    if (!Number.isInteger(input.tick) || input.tick < branch.currentTick) {
      fail('story_intervention_invalid', 400, `导演干预不能早于分支当前时刻 ${branch.currentTick}。`);
    }
    const instruction = requiredText(input.instruction, '干预说明', 'story_intervention_invalid');
    const definition = this.definition(worldId, branchId);
    const actorIds = [...input.actorIds];
    unique(actorIds, '干预角色', 'story_intervention_invalid');
    this.assertActorsExist(definition, actorIds, 'story_intervention_invalid');
    const intervention: WorldIntervention = {
      id: randomUUID(), worldId, branchId, tick: input.tick, kind: input.kind, actorIds,
      instruction, consumed: false, createdAt: nowIso(),
    };
    const now = intervention.createdAt;
    this.atomic(() => {
      this.insertIntervention(intervention);
      this.bumpBranch(branchId, input.expectedRevision, now);
    });
    return clone(intervention);
  }

  refreshSources(
    worldId: string,
    branchId: string,
    expectedRevision: number,
    expectedWorldRevision?: number,
  ): WorldBranchDetail {
    const branch = this.getBranch(worldId, branchId);
    if (branch.revision !== expectedRevision) this.conflictBranch(branchId);
    const world = this.requireWorld(worldId);
    if (expectedWorldRevision !== undefined && world.revision !== expectedWorldRevision) {
      this.conflictWorld(worldId);
    }
    const current = this.definition(worldId, branchId);
    const definition = definitionOf(world);
    const worldActorIds = new Set(definition.actors.map((actor) => actor.id));
    const branchOnlyActors = current.actors.filter((actor) => !worldActorIds.has(actor.id));
    definition.actors = [...definition.actors, ...clone(branchOnlyActors)];
    const worldLocationIds = new Set(definition.locations.map((location) => location.id));
    const branchOnlyLocations = current.locations.filter((location) => !worldLocationIds.has(location.id));
    definition.locations = [...definition.locations, ...clone(branchOnlyLocations)];
    this.validateDefinition(definition);
    const now = nowIso();
    this.atomic(() => {
      const liveWorld = this.requireWorld(worldId);
      const liveBranch = this.requireBranch(worldId, branchId);
      if (expectedWorldRevision !== undefined && liveWorld.revision !== expectedWorldRevision) {
        this.conflictWorld(worldId);
      }
      if (liveWorld.revision !== world.revision) this.conflictWorld(worldId);
      if (liveBranch.revision !== expectedRevision) this.conflictBranch(branchId);
      const result = this.exec('UPDATE sw_branches SET revision=?,source_revision=?,definition_json=?,updated_at=? WHERE id=? AND revision=?',
        expectedRevision + 1, liveWorld.revision, JSON.stringify(definition), now, branchId, expectedRevision);
      if (result.changes !== 1) this.conflictBranch(branchId);
      const stateIds = new Set(this.all('SELECT actor_id FROM sw_actor_states WHERE branch_id=?', branchId)
        .map((row) => asString(row, 'actor_id')));
      for (const actor of definition.actors) {
        if (!stateIds.has(actor.id)) this.insertState(branchId, initialActorState(actor, liveBranch.currentTick), now);
      }
      this.insertDefinitionSnapshot(branchId, expectedRevision + 1, liveBranch.currentTick, liveWorld.revision, definition, now);
      const data = this.branchFromRow(this.get('SELECT * FROM sw_branches WHERE id=?', branchId)!);
      this.exec('UPDATE sw_branches SET data_json=? WHERE id=?', JSON.stringify(data), branchId);
    });
    return this.detail(worldId, branchId);
  }

  definition(worldId: string, branchId: string): WorldDefinition {
    const branch = this.getBranch(worldId, branchId);
    return this.definitionSnapshotAt(worldId, branch.id, branch.currentTick).definition;
  }

  /** Historical consumers must use the same snapshot boundary as a fork. */
  definitionAtTick(worldId: string, branchId: string, tick: number): WorldDefinition {
    const branch = this.getBranch(worldId, branchId);
    if (!Number.isFinite(tick) || tick < 0 || tick > branch.currentTick) {
      fail('story_tick_invalid', 400, '历史时刻不在当前分支已发生的范围内。');
    }
    return this.definitionSnapshotAt(worldId, branchId, tick).definition;
  }

  commitStep(
    worldId: string,
    branchId: string,
    expectedRevision: number,
    step: {
      tick: number; events: WorldEvent[]; memories: WorldMemory[]; states: WorldActorState[];
      consumedInterventionIds: string[]; supportingActors?: WorldActor[]; run?: WorldRun;
    },
  ): WorldBranch {
    this.requireWorld(worldId);
    return this.atomic(() => {
      const branch = this.requireBranch(worldId, branchId);
      if (branch.revision !== expectedRevision) {
        if (branch.revision === expectedRevision + 1 && this.stepAlreadyApplied(branchId, branch, step)) return branch;
        this.conflictBranch(branchId);
      }
      if (step.tick === branch.currentTick && this.stepAlreadyApplied(branchId, branch, step)) return branch;
      if (!Number.isInteger(step.tick) || step.tick < branch.currentTick) {
        fail('story_step_time_invalid', 400, `本次提交时刻 ${step.tick} 早于分支当前时刻 ${branch.currentTick}。`);
      }
      const definition = this.definition(worldId, branchId);
      const supporting = step.supportingActors ?? [];
      unique(supporting.map((actor) => actor.id), '新配角', 'story_actor_invalid');
      const knownIds = new Set(definition.actors.map((actor) => actor.id));
      const locationIds = new Set(definition.locations.map((location) => location.id));
      for (const actor of supporting) {
        assertSchema<WorldActor>(WorldActorSchema, actor, 'story_actor_invalid', `配角 ${actor.id}`);
        if (actor.role !== 'supporting') fail('story_actor_invalid', 400, `新加入的 ${actor.name} 必须标记为配角。`);
        if (knownIds.has(actor.id)) fail('story_actor_invalid', 400, `角色 ID ${actor.id} 已存在于本分支。`);
        if (!locationIds.has(actor.locationId)) fail('story_actor_invalid', 400, `配角 ${actor.name} 的地点不存在。`);
        this.assertCharacterSource(actor);
        knownIds.add(actor.id);
      }
      const nextDefinition: WorldDefinition = supporting.length
        ? { ...definition, actors: [...definition.actors, ...clone(supporting)] }
        : definition;
      this.validateDefinition(nextDefinition);

      const priorEvents = this.all('SELECT * FROM sw_events WHERE branch_id=? AND tick<=? ORDER BY tick,id', branchId, step.tick)
        .map((row) => eventFromRow(row));
      const priorMemories = this.all('SELECT * FROM sw_memories WHERE branch_id=? ORDER BY learned_at,id', branchId)
        .map((row) => memoryFromRow(row));
      const priorStoryLines = new Set(this.all('SELECT id FROM sw_story_lines WHERE branch_id=?', branchId).map((row) => asString(row, 'id')));
      const existingEvents = new Map(priorEvents.map((event) => [event.id, event]));
      const eventById = new Map<string, WorldEvent>(existingEvents);
      const newEvents: WorldEvent[] = [];
      const seenEventIds = new Set<string>();
      for (const event of step.events) {
        assertSchema<WorldEvent>(WorldEventSchema, event, 'story_event_invalid', `事件 ${event.id || '(空)'}`);
        if (seenEventIds.has(event.id)) fail('story_event_invalid', 400, `事件 ID ${event.id} 在本步重复。`);
        seenEventIds.add(event.id);
        if (event.worldId !== worldId || event.branchId !== branchId) {
          fail('story_event_invalid', 400, `事件 ${event.id} 的世界或分支不匹配。`);
        }
        if (event.tick < branch.currentTick || event.tick > step.tick) {
          fail('story_event_invalid', 400, `事件 ${event.id} 的时刻 ${event.tick} 不在本步时间范围内。`);
        }
        if (event.tick + event.duration > step.tick) {
          fail('story_event_invalid', 400, `事件 ${event.id} 持续时间超过本次提交时刻，不能提前写入未发生的结果。`);
        }
        if (!locationIds.has(event.locationId)) fail('story_event_invalid', 400, `事件 ${event.id} 的地点不存在。`);
        const existing = existingEvents.get(event.id);
        if (existing) {
          if (!isDeepStrictEqual(existing, event)) fail('story_step_conflict', 409, `事件 ${event.id} 已存在且内容不同。`);
          continue;
        }
        unique(event.participantIds, `事件 ${event.id} 的参与者`, 'story_event_invalid');
        for (const actorId of event.participantIds) {
          if (!knownIds.has(actorId)) fail('story_event_invalid', 400, `事件 ${event.id} 引用了本分支不存在的角色 ${actorId}。`);
        }
        if (!event.participantIds.length) fail('story_event_invalid', 400, `事件 ${event.id} 必须至少有一名参与者。`);
        unique(event.storyLineIds, `事件 ${event.id} 的故事线`, 'story_event_invalid');
        for (const lineId of event.storyLineIds) {
          if (!priorStoryLines.has(lineId)) fail('story_event_invalid', 400, `事件 ${event.id} 引用了不存在的故事线 ${lineId}。`);
        }
        unique(event.facts.map((fact) => fact.id), `事件 ${event.id} 的事实`, 'story_event_invalid');
        for (const fact of event.facts) {
          unique(fact.knownBy, `事件 ${event.id} 事实 ${fact.id} 的知情人`, 'story_event_invalid');
          for (const actorId of fact.knownBy) {
            if (!knownIds.has(actorId)) fail('story_event_invalid', 400, `事实 ${fact.id} 引用了不存在的角色 ${actorId}。`);
          }
        }
        unique(event.perspectives.map((view) => view.actorId), `事件 ${event.id} 的视角`, 'story_event_invalid');
        for (const view of event.perspectives) {
          if (!knownIds.has(view.actorId)) fail('story_event_invalid', 400, `事件 ${event.id} 的视角角色不存在。`);
          if (!event.participantIds.includes(view.actorId)) {
            fail('story_event_invalid', 400, `事件 ${event.id} 的视角只能来自在场角色 ${view.actorId}。`);
          }
        }
        unique(event.stateChanges.map((state) => state.actorId), `事件 ${event.id} 的状态变化`, 'story_event_invalid');
        // 当前事件可以是自身关系变化的来源；后续事件仍不可见，校验失败时不会持久化。
        eventById.set(event.id, event);
        for (const state of event.stateChanges) {
          this.validateState(state, nextDefinition, event.id, step.tick, eventById);
          if (state.updatedTick < event.tick) {
            fail('story_event_invalid', 400, `事件 ${event.id} 的状态变化不能早于事件本身。`);
          }
        }
        newEvents.push(event);
      }

      for (const event of newEvents) {
        unique(event.causeEventIds, `事件 ${event.id} 的原因`, 'story_event_invalid');
        for (const causeId of event.causeEventIds) {
          const cause = eventById.get(causeId);
          if (!cause) fail('story_event_invalid', 400, `事件 ${event.id} 引用了不存在的原因事件 ${causeId}。`);
          if (cause.tick > event.tick) fail('story_event_invalid', 400, `事件 ${event.id} 不能由未来事件 ${causeId} 引起。`);
        }
      }
      this.assertNoCauseCycles([...existingEvents.values(), ...newEvents]);
      const allFacts: EventFact[] = [...eventById.values()].flatMap((event) =>
        event.facts.map((fact) => ({
          eventId: event.id, eventTick: event.tick, completedTick: event.tick + event.duration,
          participantIds: event.participantIds, fact, normalizedContent: this.leakText(fact.content),
        })));

      const memoryById = new Map<string, WorldMemory>(priorMemories.map((memory) => [memory.id, memory]));
      const newMemories: WorldMemory[] = [];
      const seenMemoryIds = new Set<string>();
      for (const memory of step.memories) {
        assertSchema<WorldMemory>(WorldMemorySchema, memory, 'story_memory_invalid', `记忆 ${memory.id || '(空)'}`);
        if (seenMemoryIds.has(memory.id)) fail('story_memory_invalid', 400, `记忆 ID ${memory.id} 在本步重复。`);
        seenMemoryIds.add(memory.id);
        if (memory.worldId !== worldId || memory.branchId !== branchId) {
          fail('story_memory_invalid', 400, `记忆 ${memory.id} 的世界或分支不匹配。`);
        }
        const existing = memoryById.get(memory.id);
        if (existing) {
          if (!isDeepStrictEqual(existing, memory)) fail('story_step_conflict', 409, `记忆 ${memory.id} 已存在且内容不同。`);
          continue;
        }
        if (!knownIds.has(memory.actorId)) fail('story_memory_invalid', 400, `记忆 ${memory.id} 所属角色不在本分支。`);
        const source = eventById.get(memory.sourceEventId);
        if (!source) fail('story_memory_invalid', 400, `记忆 ${memory.id} 的来源事件不存在。`);
        if (memory.learnedAt < source.tick) fail('story_memory_invalid', 400, `记忆 ${memory.id} 不能早于来源事件发生。`);
        if (memory.learnedAt > step.tick) fail('story_memory_invalid', 400, `记忆 ${memory.id} 不能在未来获知。`);
        if (!memory.content.trim()) fail('story_memory_invalid', 400, `记忆 ${memory.id} 的内容不能为空。`);
        if (memory.kind === 'experienced') {
          if (!source.participantIds.includes(memory.actorId)) {
            fail('story_memory_invalid', 400, `角色 ${memory.actorId} 不在事件 ${source.id} 现场，不能拥有亲历记忆。`);
          }
          if (memory.fromActorId) fail('story_memory_invalid', 400, `亲历记忆不能标记转述来源。`);
        } else if (memory.fromActorId) {
          if (memory.fromActorId === memory.actorId) fail('story_memory_invalid', 400, `记忆 ${memory.id} 的转述人不能是自己。`);
          if (!knownIds.has(memory.fromActorId)) fail('story_memory_invalid', 400, `记忆 ${memory.id} 的转述人不在本分支。`);
        } else if (memory.kind === 'heard') {
          fail('story_memory_invalid', 400, `听说记忆 ${memory.id} 必须记录转述人。`);
        }
        newMemories.push(memory);
        memoryById.set(memory.id, memory);
      }

      // 同一提交内的听说链与事实传播先按集合建立，再逐条校验；结果不依赖数组顺序。
      for (const memory of newMemories) {
        const source = eventById.get(memory.sourceEventId)!;
        const otherMemories = [...priorMemories, ...newMemories.filter((item) => item.id !== memory.id)];
        if (memory.kind !== 'experienced' && memory.fromActorId
          && !this.knowsEvent(memory.fromActorId, source.id, memory.learnedAt, eventById, otherMemories)) {
          fail('story_memory_invalid', 400,
            `角色 ${memory.fromActorId} 在 tick ${memory.learnedAt} 尚未获知事件 ${source.id}，不能向 ${memory.actorId} 转述。`);
        }
        this.assertMemoryContentDoesNotLeak(memory, allFacts, otherMemories);
      }

      for (const event of newEvents) {
        for (const fact of event.facts) {
          for (const actorId of fact.knownBy) {
            if (!this.knowsEvent(actorId, event.id, step.tick, eventById, [...priorMemories, ...newMemories])) {
              fail('story_event_invalid', 400, `角色 ${actorId} 在 tick ${step.tick} 尚未获知事件 ${event.id}，不能标记为事实知情人。`);
            }
          }
        }
      }

      const statesById = new Map<string, WorldActorState>();
      for (const state of step.states) {
        assertSchema<WorldActorState>(WorldActorStateSchema, state, 'story_state_invalid', `角色状态 ${state.actorId || '(空)'}`);
        if (!knownIds.has(state.actorId)) fail('story_state_invalid', 400, `状态所属角色 ${state.actorId} 不在本分支。`);
        this.validateState(state, nextDefinition, null, step.tick, eventById);
        const prior = statesById.get(state.actorId);
        if (prior && JSON.stringify(prior) !== JSON.stringify(state)) fail('story_state_invalid', 400, `角色 ${state.actorId} 的状态在本步重复。`);
        statesById.set(state.actorId, state);
      }
      for (const event of newEvents) {
        for (const state of event.stateChanges) {
          const prior = statesById.get(state.actorId);
          if (!prior || state.updatedTick > prior.updatedTick) statesById.set(state.actorId, state);
        }
      }
      const priorStates = new Map(this.all('SELECT * FROM sw_actor_states WHERE branch_id=?', branchId)
        .map((row) => [asString(row, 'actor_id'), parse<WorldActorState>(row.data_json)]));
      for (const [actorId, state] of statesById) {
        const prior = priorStates.get(actorId);
        if (prior && state.updatedTick < prior.updatedTick) {
          fail('story_state_conflict', 409, `角色 ${actorId} 的状态时点早于已保存状态，不能回退。`);
        }
        if (prior && state.updatedTick === prior.updatedTick && !isDeepStrictEqual(prior, state)) {
          fail('story_state_conflict', 409, `角色 ${actorId} 在同一时点出现了不同状态。`);
        }
      }
      for (const actor of supporting) {
        const provided = statesById.get(actor.id);
        // 新配角从本步才进入该分支；把首个状态固定在本步时刻，避免历史 fork 提前继承。
        statesById.set(actor.id, provided
          ? { ...provided, updatedTick: step.tick }
          : initialActorState(actor, step.tick));
      }

      const consumed = [...step.consumedInterventionIds];
      unique(consumed, '已消费干预', 'story_intervention_invalid');
      for (const id of consumed) {
        const row = this.get('SELECT * FROM sw_interventions WHERE branch_id=? AND id=?', branchId, id);
        if (!row) fail('story_intervention_invalid', 400, `导演干预 ${id} 不存在。`);
        if (asNumber(row, 'tick') > step.tick) fail('story_intervention_invalid', 400, `不能消费未来时刻的导演干预 ${id}。`);
      }

      if (step.run) this.validateRunForBranch(step.run, worldId, branchId);

      const now = nowIso();
      for (const event of newEvents) this.insertEvent(event, now);
      for (const memory of newMemories) this.insertMemory(memory);
      for (const [actorId, state] of statesById) {
        this.exec(`INSERT INTO sw_actor_states(branch_id,actor_id,updated_tick,data_json) VALUES (?,?,?,?)
          ON CONFLICT(branch_id,actor_id) DO UPDATE SET updated_tick=excluded.updated_tick,data_json=excluded.data_json
          WHERE excluded.updated_tick>=sw_actor_states.updated_tick`, branchId, actorId, state.updatedTick, JSON.stringify(state));
      }
      for (const id of consumed) {
        const row = this.get('SELECT * FROM sw_interventions WHERE branch_id=? AND id=?', branchId, id)!;
        const intervention = { ...interventionFromRow(row), consumed: true };
        this.exec('UPDATE sw_interventions SET consumed=1,data_json=? WHERE branch_id=? AND id=?', JSON.stringify(intervention), branchId, id);
      }
      if (step.run) this.saveRun(step.run, now);
      const nextBranch: WorldBranch = {
        ...branch, currentTick: step.tick, revision: expectedRevision + 1, updatedAt: now,
      };
      const result = this.exec('UPDATE sw_branches SET current_tick=?,revision=?,definition_json=?,data_json=?,updated_at=? WHERE id=? AND revision=?',
        step.tick, nextBranch.revision, JSON.stringify(nextDefinition), JSON.stringify(nextBranch), now, branchId, expectedRevision);
      if (result.changes !== 1) this.conflictBranch(branchId);
      if (supporting.length) {
        this.insertDefinitionSnapshot(branchId, nextBranch.revision, step.tick, branch.sourceRevision, nextDefinition, now);
      }
      return nextBranch;
    });
  }

  private worldFromRow(row: Row): StoryWorld {
    return {
      ...parse<StoryWorld>(row.data_json), revision: asNumber(row, 'revision'),
      createdAt: asString(row, 'created_at'), updatedAt: asString(row, 'updated_at'),
    };
  }

  private branchFromRow(row: Row): WorldBranch {
    return {
      ...parse<WorldBranch>(row.data_json), id: asString(row, 'id'), worldId: asString(row, 'world_id'),
      forkTick: asNumber(row, 'fork_tick'), currentTick: asNumber(row, 'current_tick'),
      revision: asNumber(row, 'revision'), sourceRevision: asNumber(row, 'source_revision'),
      parentBranchId: row.parent_branch_id === null ? null : String(row.parent_branch_id),
      createdAt: asString(row, 'created_at'), updatedAt: asString(row, 'updated_at'),
    };
  }

  private requireWorld(worldId: string): StoryWorld {
    const row = this.get('SELECT * FROM sw_worlds WHERE id=?', worldId);
    if (!row) fail('story_world_not_found', 404, '故事世界不存在。');
    return this.worldFromRow(row);
  }

  private requireBranch(worldId: string, branchId: string): WorldBranch {
    const row = this.get('SELECT * FROM sw_branches WHERE id=? AND world_id=?', branchId, worldId);
    if (!row) fail('story_branch_not_found', 404, '世界分支不存在。');
    return this.branchFromRow(row);
  }

  private conflictWorld(worldId: string): never {
    const row = this.get('SELECT revision FROM sw_worlds WHERE id=?', worldId);
    fail('story_world_revision_conflict', 409,
      `世界已在其他窗口更新（当前版本 ${row ? asNumber(row, 'revision') : '已删除'}），本地输入保留，请检查后重试。`);
  }

  private conflictBranch(branchId: string): never {
    const row = this.get('SELECT revision FROM sw_branches WHERE id=?', branchId);
    fail('story_branch_revision_conflict', 409,
      `分支已在其他窗口更新（当前版本 ${row ? asNumber(row, 'revision') : '已删除'}），请刷新后重试。`);
  }

  private validateDefinition(definition: WorldDefinition, pending = false) {
    assertSchema<WorldDefinition>(pending ? WorldAuthoringDraftSchema.properties.definition : WorldDefinitionSchema,
      definition, 'story_definition_invalid', '世界定义');
    if (pending) {
      definition.locations.forEach((location) => requiredText(location.name, '地点名称'));
      definition.actors.forEach((actor) => requiredText(actor.name, '人物名称'));
    }
    unique(definition.locations.map((item) => item.id), '地点');
    unique(definition.actors.map((item) => item.id), '角色');
    unique(definition.sources.map((item) => item.id), '资料来源');
    const locationIds = new Set(definition.locations.map((item) => item.id));
    unique((definition.visualReferences ?? []).map((item) => item.id), '画面参考', 'story_definition_invalid');
    for (const reference of definition.visualReferences ?? []) {
      requiredText(reference.name, '画面参考名称', 'story_definition_invalid');
      const locationId = reference.locationId ?? (reference.kind === 'location' ? reference.id : undefined);
      if (locationId && !locationIds.has(locationId)) fail('story_definition_invalid', 400, `画面参考 ${reference.name} 的地点不存在。`);
      unique(reference.referenceArtifactIds, `画面参考 ${reference.name} 的素材`, 'story_definition_invalid');
    }
    for (const actor of definition.actors) {
      if (!locationIds.has(actor.locationId)) fail('story_definition_invalid', 400, `角色 ${actor.name} 的地点不存在。`);
      unique(actor.referenceArtifactIds, `角色 ${actor.name} 的参考图`, 'story_definition_invalid');
      this.assertCharacterSource(actor);
    }
    for (const source of definition.sources) {
      assertSchema(WorldSourceSchema, source, 'story_source_invalid', `资料 ${source.id}`);
      requiredText(source.title, '资料标题', 'story_source_invalid');
      if (!Number.isFinite(Date.parse(source.capturedAt))) fail('story_source_invalid', 400, `资料 ${source.title} 的采集时间无效。`);
      if (source.nature === 'canon' && (!source.sourceVersion.trim() || !source.content.trim())) {
        fail('story_source_invalid', 400, `原作资料 ${source.title} 必须带有可追溯的版本与内容快照。`);
      }
    }
  }

  private assertCharacterSource(actor: WorldActor) {
    if (!actor.characterId) {
      if (actor.characterVersion !== null) fail('story_actor_source_missing', 400, `角色 ${actor.name} 没有来源角色却声明了版本。`);
      if (actor.characterVariantId || actor.characterCostumeAssetId) fail('story_actor_selection_invalid', 400, `角色 ${actor.name} 没有来源角色却声明了形态或皮肤。`);
      return;
    }
    if (actor.characterVersion === null) {
      fail('story_actor_source_missing', 400, `角色 ${actor.name} 必须显式采用一个角色库版本。`);
    }
    const profile = this.get('SELECT 1 FROM character_profiles WHERE id=?', actor.characterId);
    const version = this.get('SELECT * FROM character_versions WHERE character_id=? AND version=?', actor.characterId, actor.characterVersion);
    if (!profile || !version) {
      fail('story_actor_source_missing', 400, `角色 ${actor.name} 引用的角色库版本 ${actor.characterId}@${actor.characterVersion} 不存在。`);
    }
    try {
      resolveCharacterVersionSelection(mapCharacterVersion(version), {
        variantId: actor.characterVariantId, costumeAssetId: actor.characterCostumeAssetId,
      });
    } catch (error) {
      fail('story_actor_selection_invalid', 400, error instanceof Error ? error.message : '角色形态或皮肤不在所选阶段中。');
    }
  }

  private assertActorsExist(definition: WorldDefinition, actorIds: readonly string[], code: string) {
    const known = new Set(definition.actors.map((actor) => actor.id));
    for (const id of actorIds) if (!known.has(id)) fail(code, 400, `角色 ${id} 不在本分支。`);
  }

  private insertBranch(branch: WorldBranch, definition: WorldDefinition, now: string) {
    this.exec(`INSERT INTO sw_branches(id,world_id,parent_branch_id,fork_tick,current_tick,revision,source_revision,definition_json,data_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, branch.id, branch.worldId, branch.parentBranchId, branch.forkTick,
      branch.currentTick, branch.revision, branch.sourceRevision, JSON.stringify(definition), JSON.stringify(branch), now, now);
    this.insertDefinitionSnapshot(branch.id, branch.revision, branch.currentTick, branch.sourceRevision, definition, now);
  }

  private insertDefinitionSnapshot(
    branchId: string, revision: number, effectiveTick: number, sourceRevision: number,
    definition: WorldDefinition, now: string,
  ) {
    this.exec(`INSERT INTO sw_branch_definitions
      (branch_id,revision,effective_tick,source_revision,definition_json,created_at) VALUES (?,?,?,?,?,?)`,
      branchId, revision, effectiveTick, sourceRevision, JSON.stringify(definition), now);
  }

  private definitionSnapshotAt(worldId: string, branchId: string, tick: number): DefinitionSnapshot {
    this.requireBranch(worldId, branchId);
    const row = this.get(`SELECT * FROM sw_branch_definitions WHERE branch_id=? AND effective_tick<=?
      ORDER BY effective_tick DESC,revision DESC LIMIT 1`, branchId, tick);
    if (!row) {
      fail('story_branch_definition_missing', 409,
        `分支 ${branchId} 在 tick ${tick} 没有可用的定义快照，不能按历史节点继续。`);
    }
    return {
      revision: asNumber(row, 'revision'), effectiveTick: asNumber(row, 'effective_tick'),
      sourceRevision: asNumber(row, 'source_revision'),
      definition: parse<WorldDefinition>(row.definition_json), createdAt: asString(row, 'created_at'),
    };
  }

  private insertEvent(event: WorldEvent, now: string) {
    this.exec('INSERT INTO sw_events(id,world_id,branch_id,tick,duration,location_id,data_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
      event.id, event.worldId, event.branchId, event.tick, event.duration, event.locationId, JSON.stringify(event), now);
  }

  private insertMemory(memory: WorldMemory) {
    this.exec('INSERT INTO sw_memories(id,world_id,branch_id,actor_id,source_event_id,learned_at,kind,data_json) VALUES (?,?,?,?,?,?,?,?)',
      memory.id, memory.worldId, memory.branchId, memory.actorId, memory.sourceEventId, memory.learnedAt, memory.kind, JSON.stringify(memory));
  }

  private insertStoryLine(line: WorldStoryLine, createdTick: number) {
    this.exec('INSERT INTO sw_story_lines(id,world_id,branch_id,created_tick,data_json) VALUES (?,?,?,?,?)',
      line.id, line.worldId, line.branchId, createdTick, JSON.stringify(line));
  }

  private insertIntervention(intervention: WorldIntervention) {
    this.exec('INSERT INTO sw_interventions(id,world_id,branch_id,tick,consumed,data_json) VALUES (?,?,?,?,?,?)',
      intervention.id, intervention.worldId, intervention.branchId, intervention.tick, intervention.consumed ? 1 : 0, JSON.stringify(intervention));
  }

  private insertState(branchId: string, state: WorldActorState, now: string) {
    this.exec('INSERT INTO sw_actor_states(branch_id,actor_id,updated_tick,data_json) VALUES (?,?,?,?)',
      branchId, state.actorId, state.updatedTick, JSON.stringify(state));
    void now;
  }

  private bumpBranch(branchId: string, expectedRevision: number, now: string) {
    const row = this.get('SELECT * FROM sw_branches WHERE id=?', branchId);
    if (!row) this.conflictBranch(branchId);
    const data = this.branchFromRow(row);
    const next = { ...data, revision: expectedRevision + 1, updatedAt: now };
    const result = this.exec('UPDATE sw_branches SET revision=?,data_json=?,updated_at=? WHERE id=? AND revision=?',
      next.revision, JSON.stringify(next), now, branchId, expectedRevision);
    if (result.changes !== 1) this.conflictBranch(branchId);
  }

  private actorAppearanceTicks(
    events: WorldEvent[], memories: WorldMemory[], states: WorldActorState[],
    storyLines: Array<{ createdTick: number; line: WorldStoryLine }>, fallbackTick: number,
  ) {
    const seen = new Map<string, number>();
    const note = (id: string, tick: number) => {
      const prior = seen.get(id);
      if (prior === undefined || tick < prior) seen.set(id, tick);
    };
    for (const event of events) {
      for (const id of event.participantIds) note(id, event.tick);
      for (const view of event.perspectives) note(view.actorId, event.tick);
      for (const state of event.stateChanges) note(state.actorId, event.tick);
    }
    for (const memory of memories) {
      note(memory.actorId, memory.learnedAt);
      if (memory.fromActorId) note(memory.fromActorId, memory.learnedAt);
    }
    for (const state of states) note(state.actorId, state.updatedTick);
    for (const { createdTick, line } of storyLines) for (const id of line.actorIds) note(id, createdTick);
    void fallbackTick;
    return seen;
  }

  private deriveForkStates(
    definition: WorldDefinition, parentStates: WorldActorState[], events: WorldEvent[], forkTick: number,
  ): WorldActorState[] {
    const states = new Map(definition.actors.map((actor) => [actor.id, initialActorState(actor, 0)]));
    const apply = (state: WorldActorState) => {
      if (state.updatedTick > forkTick) return;
      const prior = states.get(state.actorId);
      if (!prior || state.updatedTick >= prior.updatedTick) states.set(state.actorId, clone(state));
    };
    for (const state of parentStates) apply(state);
    for (const event of events) for (const state of event.stateChanges) apply(state);
    return [...states.values()];
  }

  private validateState(
    state: WorldActorState, definition: WorldDefinition, eventId: string | null, stepTick: number,
    events: Map<string, WorldEvent>,
  ) {
    if (!definition.actors.some((actor) => actor.id === state.actorId)) {
      fail('story_state_invalid', 400, `角色状态引用了不存在的角色 ${state.actorId}。`);
    }
    if (!Number.isInteger(state.updatedTick) || state.updatedTick < 0 || state.updatedTick > stepTick) {
      fail('story_state_invalid', 400, `角色 ${state.actorId} 的状态时点无效。`);
    }
    if (!definition.locations.some((location) => location.id === state.locationId)) {
      fail('story_state_invalid', 400, `角色 ${state.actorId} 的地点不存在。`);
    }
    for (const relationship of state.relationships) {
      if (!definition.actors.some((actor) => actor.id === relationship.actorId)) {
        fail('story_state_invalid', 400, `角色 ${state.actorId} 的关系对象不存在。`);
      }
      if (relationship.sourceEventId) {
        const source = events.get(relationship.sourceEventId);
        if (!source) fail('story_state_invalid', 400, `角色关系来源事件 ${relationship.sourceEventId} 不存在。`);
        if (source.tick > state.updatedTick) fail('story_state_invalid', 400, `角色关系不能引用晚于状态时点的事件。`);
      }
    }
    void eventId;
  }

  private knowsEvent(
    actorId: string, eventId: string, atTick: number, events: Map<string, WorldEvent>,
    memories: WorldMemory[], seen = new Set<string>(),
  ): boolean {
    const key = `${actorId}\u0000${eventId}\u0000${atTick}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const event = events.get(eventId);
    if (!event) return false;
    if (event.participantIds.includes(actorId)) return true;
    for (const memory of memories) {
      if (memory.actorId !== actorId || memory.sourceEventId !== eventId || memory.learnedAt > atTick) continue;
      if (memory.kind === 'heard' && memory.fromActorId) {
        if (this.knowsEvent(memory.fromActorId, eventId, memory.learnedAt, events, memories, seen)) return true;
      }
    }
    return false;
  }

  private leakText(value: string) {
    return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  }

  private normalizedOverlap(memory: string, fact: string) {
    if (!memory || !fact) return false;
    if (fact.length < 4) return memory === fact;
    return memory.includes(fact) || (memory.length >= 4 && fact.includes(memory));
  }

  private actorKnowsFact(
    actorId: string, eventId: string, normalizedFact: string, knownBy: readonly string[], atTick: number,
    memories: WorldMemory[], seen = new Set<string>(),
  ): boolean {
    if (knownBy.includes(actorId)) return true;
    const key = `${actorId}\u0000${eventId}\u0000${atTick}`;
    if (seen.has(key)) return false;
    seen.add(key);
    for (const memory of memories) {
      if (memory.actorId !== actorId || memory.sourceEventId !== eventId || memory.learnedAt > atTick) continue;
      if (!this.normalizedOverlap(this.leakText(memory.content), normalizedFact)) continue;
      if (memory.kind === 'heard') {
        if (memory.fromActorId && this.actorKnowsFact(memory.fromActorId, eventId, normalizedFact, knownBy,
          memory.learnedAt, memories, seen)) return true;
      } else if (memory.kind === 'experienced') {
        return true;
      }
    }
    return false;
  }

  /**
   * 记忆内容不能借另一个事件的 knownBy 事实绕过知情人限制。这里做保守的文本重叠检查：
   * 角色尚未在时间上获知的事实，若其内容被写进记忆，则拒绝；听说链需要转述人确实知道该事实。
   */
  private assertMemoryContentDoesNotLeak(memory: WorldMemory, facts: EventFact[], memories: WorldMemory[]) {
    const normalizedMemory = this.leakText(memory.content);
    // Identical later reports do not turn earlier knowledge into a future leak.
    // Proof must terminate at an already-completed, same-branch fact witnessed
    // by its knownBy actor, or a traceable heard chain available at that time.
    // The current memory, inferred/mistaken beliefs and mere text overlap never
    // establish this exception. facts/memories are already scoped by commitStep.
    const knowsExact = (actorId: string, candidate: EventFact, atTick: number, seen = new Set<string>()): boolean => {
      if (candidate.completedTick > atTick) return false;
      if (candidate.participantIds.includes(actorId) && candidate.fact.knownBy.includes(actorId)) return true;
      const key = JSON.stringify([actorId, candidate.eventId, candidate.fact.id, atTick]);
      if (seen.has(key)) return false;
      const next = new Set(seen).add(key);
      return memories.some((prior) => prior.actorId === actorId && prior.sourceEventId === candidate.eventId
        && prior.content === candidate.fact.content && prior.kind === 'heard' && prior.fromActorId !== null
        && prior.fromActorId !== actorId && prior.learnedAt >= candidate.completedTick && prior.learnedAt <= atTick
        && knowsExact(prior.fromActorId, candidate, prior.learnedAt, next));
    };
    for (const { eventId, eventTick, fact, normalizedContent } of facts) {
      if (!normalizedContent || !this.normalizedOverlap(normalizedMemory, normalizedContent)) continue;
      if (facts.some((prior) => prior.fact.content === fact.content && (
        knowsExact(memory.actorId, prior, memory.learnedAt)
        || (memory.kind === 'heard' && memory.fromActorId !== null && prior.eventId === memory.sourceEventId
          && knowsExact(memory.fromActorId, prior, memory.learnedAt))
      ))) continue;
      const occurred = eventTick <= memory.learnedAt;
      const knownByActor = occurred && (
        fact.knownBy.includes(memory.actorId)
        || this.actorKnowsFact(memory.actorId, eventId, normalizedContent, fact.knownBy, memory.learnedAt, memories)
      );
      if (knownByActor) continue;
      const knownBySpeaker = occurred && memory.fromActorId && (
        fact.knownBy.includes(memory.fromActorId)
        || this.actorKnowsFact(memory.fromActorId, eventId, normalizedContent, fact.knownBy, memory.learnedAt, memories)
      );
      if (knownBySpeaker) continue;
      fail('story_memory_leak', 400,
        `记忆 ${memory.id} 的内容包含角色 ${memory.actorId} 在 tick ${memory.learnedAt} 尚未获知的事实 ${fact.id}。`);
    }
  }

  private assertNoCauseCycles(events: WorldEvent[]) {
    const byId = new Map(events.map((event) => [event.id, event]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): boolean => {
      if (done.has(id)) return false;
      if (visiting.has(id)) return true;
      const event = byId.get(id);
      if (!event) return false;
      visiting.add(id);
      for (const cause of event.causeEventIds) if (visit(cause)) return true;
      visiting.delete(id);
      done.add(id);
      return false;
    };
    for (const event of events) {
      if (visit(event.id)) fail('story_event_invalid', 400, `事件原因链在 ${event.id} 处形成循环。`);
    }
  }

  private validateRunForBranch(run: WorldRun, worldId: string, branchId: string) {
    assertSchema<WorldRun>(WorldRunSchema, run, 'story_run_invalid', `运行 ${run.id}`);
    if (run.worldId !== worldId || run.branchId !== branchId) fail('story_run_invalid', 400, `运行 ${run.id} 的世界或分支不匹配。`);
    if (isActiveRun(run.status)) {
      const other = this.get("SELECT id FROM sw_runs WHERE branch_id=? AND id<>? AND status IN ('queued','running','paused','uncertain')", branchId, run.id);
      if (other) fail('story_run_conflict', 409, '同一分支同时只能有一个推进任务。');
    }
  }

  private saveRun(run: WorldRun, now: string) {
    const row = this.get('SELECT * FROM sw_runs WHERE id=?', run.id);
    if (row) {
      if (asString(row, 'branch_id') !== run.branchId || asString(row, 'world_id') !== run.worldId) {
        fail('story_run_invalid', 400, `运行 ${run.id} 已属于其他分支。`);
      }
      this.exec('UPDATE sw_runs SET status=?,data_json=?,updated_at=? WHERE id=?', run.status, JSON.stringify(run), now, run.id);
      return;
    }
    this.exec('INSERT INTO sw_runs(id,world_id,branch_id,status,data_json,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      run.id, run.worldId, run.branchId, run.status, JSON.stringify(run), null, run.createdAt || now, now);
  }

  private stepAlreadyApplied(
    branchId: string, branch: WorldBranch,
    step: {
      tick: number; events: WorldEvent[]; memories: WorldMemory[]; states: WorldActorState[];
      consumedInterventionIds: string[]; supportingActors?: WorldActor[]; run?: WorldRun;
    },
  ) {
    if (branch.currentTick !== step.tick) return false;
    if (step.supportingActors?.length) {
      const current = this.definition(branch.worldId, branch.id);
      const known = new Set(current.actors.map((actor) => actor.id));
      if (step.supportingActors.some((actor) => !known.has(actor.id))) return false;
      if (step.supportingActors.some((actor) => {
        const stored = current.actors.find((item) => item.id === actor.id);
        return !stored || !isDeepStrictEqual(stored, actor);
      })) return false;
    }
    for (const event of step.events) {
      const row = this.get('SELECT data_json FROM sw_events WHERE branch_id=? AND id=?', branchId, event.id);
      if (!row || !isDeepStrictEqual(parse<WorldEvent>(row.data_json), event)) return false;
    }
    for (const memory of step.memories) {
      const row = this.get('SELECT data_json FROM sw_memories WHERE branch_id=? AND id=?', branchId, memory.id);
      if (!row || !isDeepStrictEqual(parse<WorldMemory>(row.data_json), memory)) return false;
    }
    for (const state of step.states) {
      const row = this.get('SELECT data_json FROM sw_actor_states WHERE branch_id=? AND actor_id=?', branchId, state.actorId);
      if (!row || !isDeepStrictEqual(parse<WorldActorState>(row.data_json), state)) return false;
    }
    for (const id of step.consumedInterventionIds) {
      const row = this.get('SELECT consumed FROM sw_interventions WHERE branch_id=? AND id=?', branchId, id);
      if (!row || asNumber(row, 'consumed') !== 1) return false;
    }
    if (step.run) {
      const row = this.get('SELECT data_json FROM sw_runs WHERE id=? AND branch_id=?', step.run.id, branchId);
      if (!row || !isDeepStrictEqual(parse<WorldRun>(row.data_json), step.run)) return false;
    }
    return true;
  }
}
