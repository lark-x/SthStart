import type { CreativeArtifact, CreativeScope, WorldEvent } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { creativeHash } from './store.js';
import type { CreativeScene } from './scene-schema.js';

type Row = Record<string, unknown>;
type SqlValue = string | number;
function fail(code: string, message: string, statusCode = 409): never {
  throw Object.assign(new Error(message), { code, statusCode });
}
export function creativeMemoryScope(scope: CreativeScope): string {
  if (scope.worldId && scope.branchId) return `branch:${scope.branchId}`;
  if (scope.projectId) return `project:${scope.projectId}`;
  return fail('creative_memory_scope', '记忆查询需要时间线或项目范围。', 400);
}
export interface CreativeMemoryQuery {
  query?: string; actorId?: string; locationId?: string; storyLineId?: string;
  nature?: 'canon' | 'author' | 'ai' | 'unverified'; offset?: number; limit?: number;
}
export interface CreativeMemoryFact {
  id: string; eventId: string; factId: string; content: string; nature: string; tick: number;
  knownBy: string[]; locationId: string; storyLineIds: string[]; sourceHash: string;
}
export interface CreativeMemoryEntry {
  id: string; kind: 'setting' | 'foreshadowing'; revision: number; status: 'confirmed' | 'open' | 'resolved';
  title: string; content: string; sourceArtifactId: string; sourceHash: string; sourceRefs: string[];
}
const entry = (row: Row): CreativeMemoryEntry => ({
  id: String(row.id), kind: row.kind as CreativeMemoryEntry['kind'], revision: Number(row.revision),
  status: row.status as CreativeMemoryEntry['status'], title: String(row.title), content: String(row.content),
  sourceArtifactId: String(row.source_artifact_id), sourceHash: String(row.source_hash), sourceRefs: JSON.parse(String(row.source_refs_json)),
});

/** Deterministic extraction only; no background model calls and no facts inferred from prose. */
export class CreativeMemory {
  private readonly worlds: StoryWorldStore;
  constructor(readonly database: ServiceDatabase) { this.worlds = new StoryWorldStore(database); }
  private get db() { return this.database.connection; }
  private scopeKey(scope: CreativeScope): string {
    if (Boolean(scope.worldId) !== Boolean(scope.branchId)) fail('creative_memory_scope', '世界与时间线必须同时指定。', 400);
    if (scope.worldId) this.worlds.getBranch(scope.worldId, scope.branchId!);
    if (scope.projectId && !this.db.prepare('SELECT 1 FROM story_projects WHERE id=?').get(scope.projectId)) fail('creative_memory_scope', '创作项目不存在。', 404);
    return creativeMemoryScope(scope);
  }
  readFacts(scope: CreativeScope, query: CreativeMemoryQuery = {}) {
    if (!scope.worldId || !scope.branchId) fail('creative_memory_scope', '事实查询需要世界及时间线。', 400);
    const branch = this.worlds.getBranch(scope.worldId, scope.branchId);
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || (query.query?.length ?? 0) > 300) {
      fail('creative_memory_query', '查询分页须为 1–100 条且页偏移非负，搜索文本最多 300 字符。', 400);
    }
    const definition = this.worlds.definition(scope.worldId, scope.branchId);
    if (query.actorId && !definition.actors.some((actor) => actor.id === query.actorId)) fail('creative_memory_actor', '查询角色不属于当前时间线。', 400);
    const filters = ['f.world_id=?', 'f.branch_id=?', 'f.tick<=?'], values: SqlValue[] = [scope.worldId, scope.branchId, branch.currentTick];
    if (query.actorId) {
      // Heard memories only convey their exact fact text. Inferred/mistaken beliefs never become objective knowledge.
      filters.push(`(EXISTS (SELECT 1 FROM json_each(f.known_by_json) k WHERE k.value=?) OR EXISTS (
        SELECT 1 FROM sw_memories m WHERE m.world_id=f.world_id AND m.branch_id=f.branch_id AND m.source_event_id=f.event_id
          AND m.actor_id=? AND m.learned_at<=? AND m.kind='heard' AND json_extract(m.data_json,'$.content')=f.content))`);
      values.push(query.actorId, query.actorId, branch.currentTick);
    }
    if (query.locationId) { filters.push('f.location_id=?'); values.push(query.locationId); }
    if (query.storyLineId) { filters.push('EXISTS (SELECT 1 FROM json_each(f.storyline_ids_json) s WHERE s.value=?)'); values.push(query.storyLineId); }
    if (query.nature) { filters.push('f.nature=?'); values.push(query.nature); }
    if (query.query?.trim()) { filters.push('instr(lower(f.content),lower(?))>0'); values.push(query.query.trim()); }
    const where = filters.join(' AND ');
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM co_memory_facts f WHERE ${where}`).get(...values)!.count);
    const rows = this.db.prepare(`SELECT f.* FROM co_memory_facts f WHERE ${where} ORDER BY f.tick DESC,f.event_id,f.fact_id LIMIT ? OFFSET ?`).all(...values, limit, offset);
    const items: CreativeMemoryFact[] = rows.map((row) => ({
      id: `fact:${creativeHash([row.event_id, row.fact_id]).slice(0, 24)}`, eventId: String(row.event_id), factId: String(row.fact_id),
      content: String(row.content), nature: String(row.nature), tick: Number(row.tick), knownBy: JSON.parse(String(row.known_by_json)),
      locationId: String(row.location_id), storyLineIds: JSON.parse(String(row.storyline_ids_json)), sourceHash: creativeHash(row),
    }));
    return { items, total, offset, nextOffset: offset + items.length < total ? offset + items.length : null,
      coverage: 'selected-facts-from-complete-index' as const, branchRevision: branch.revision, actorId: query.actorId ?? null };
  }
  recentEvents(scope: CreativeScope, limit = 24): { items: WorldEvent[]; total: number } {
    if (!scope.worldId || !scope.branchId) fail('creative_memory_scope', '事件查询需要时间线。', 400);
    const branch = this.worlds.getBranch(scope.worldId, scope.branchId);
    const rows = this.db.prepare('SELECT data_json FROM sw_events WHERE world_id=? AND branch_id=? AND tick<=? ORDER BY tick DESC,id DESC LIMIT ?')
      .all(scope.worldId, scope.branchId, branch.currentTick, limit);
    const total = Number(this.db.prepare('SELECT COUNT(*) AS count FROM sw_events WHERE world_id=? AND branch_id=? AND tick<=?').get(scope.worldId, scope.branchId, branch.currentTick)!.count);
    return { items: rows.map((row) => JSON.parse(String(row.data_json)) as WorldEvent).reverse(), total };
  }
  readEntries(scope: CreativeScope, options: { kind?: CreativeMemoryEntry['kind']; status?: CreativeMemoryEntry['status']; query?: string; offset?: number; limit?: number } = {}) {
    const key = this.scopeKey(scope), limit = options.limit ?? 50, offset = options.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) fail('creative_memory_query', '记忆条目每页须为 1–100 条。', 400);
    const filters = ['1=1'], values: SqlValue[] = [key, scope.branchId ?? ''];
    if (options.kind) { filters.push('kind=?'); values.push(options.kind); }
    if (options.status) { filters.push('status=?'); values.push(options.status); }
    if (options.query) { filters.push('(instr(title,?)>0 OR instr(content,?)>0)'); values.push(options.query, options.query); }
    const where = filters.join(' AND ');
    const cte = this.entriesCte();
    const total = Number(this.db.prepare(cte + ` SELECT COUNT(*) AS count FROM effective_entries WHERE ${where}`).get(...values)!.count);
    const items = this.db.prepare(cte + ` SELECT * FROM effective_entries WHERE ${where} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).all(...values, limit, offset).map(entry);
    return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
  }
  private entriesCte(): string {
    return `WITH local_entries AS (SELECT * FROM co_memory_entries WHERE scope_key=?), effective_entries AS (
      SELECT * FROM local_entries UNION ALL
      SELECT 'branch:'||s.branch_id AS scope_key,s.id,s.kind,s.revision,
        json_extract(s.entry_json,'$.status') AS status,json_extract(s.entry_json,'$.title') AS title,
        json_extract(s.entry_json,'$.content') AS content,json_extract(s.entry_json,'$.sourceArtifactId') AS source_artifact_id,
        json_extract(s.entry_json,'$.sourceHash') AS source_hash,json_extract(s.entry_json,'$.sourceRefs') AS source_refs_json,
        json_extract(s.entry_json,'$.updatedAt') AS updated_at
      FROM co_memory_branch_snapshots s WHERE s.branch_id=?
        AND NOT EXISTS(SELECT 1 FROM local_entries e WHERE e.kind=s.kind AND e.id=s.id))`;
  }
  private effectiveEntry(scope: CreativeScope, kind: string, id: string): CreativeMemoryEntry | null {
    const row = this.db.prepare(this.entriesCte() + ' SELECT * FROM effective_entries WHERE kind=? AND id=?')
      .get(creativeMemoryScope(scope), scope.branchId ?? '', kind, id);
    return row ? entry(row) : null;
  }
  digests(scope: CreativeScope, limit = 3) {
    const key = this.scopeKey(scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) fail('creative_memory_query', '摘要每页须为 1–20 条。', 400);
    const total = Number(this.db.prepare('SELECT COUNT(*) AS count FROM co_memory_digests WHERE scope_key=?').get(key)!.count);
    const items = this.db.prepare('SELECT batch,content_json,content_hash FROM co_memory_digests WHERE scope_key=? ORDER BY batch DESC LIMIT ?').all(key, limit)
      .map((row) => ({ batch: Number(row.batch), contentHash: String(row.content_hash), content: JSON.parse(String(row.content_json)) as Record<string, unknown> }));
    return { items, total };
  }
  /** Compact catalogue for prompts; full immutable batches remain available through digests(). */
  digestCatalogue(scope: CreativeScope) {
    const key = this.scopeKey(scope);
    const total = Number(this.db.prepare('SELECT COUNT(*) AS count FROM co_memory_digests WHERE scope_key=?').get(key)!.count);
    const rows = this.db.prepare('SELECT batch,content_hash,content_json FROM co_memory_digests WHERE scope_key=? ORDER BY batch DESC LIMIT 3').all(key);
    return { total, representation: 'digest-catalogue', items: rows.map((row) => {
      const content = JSON.parse(String(row.content_json)) as { scenes: Array<{ artifactId: string; sourceHash: string; title: string; events: Array<{ id: string; title: string; summary: string }> }> };
      return { batch: Number(row.batch), contentHash: String(row.content_hash), scenes: content.scenes.map((scene) => ({
        artifactId: scene.artifactId, sourceHash: scene.sourceHash, title: scene.title,
        eventCount: scene.events.length, events: scene.events.slice(0, 3).map((event) => ({
          id: event.id, title: event.title, excerpt: event.summary.slice(0, 160), excerpted: event.summary.length > 160,
        })),
      })) };
    }), fullBatchesAvailable: true };
  }
  validateChanges(scene: CreativeScene, sourceIds: Set<string>, hypotheticalParent?: CreativeScene): void {
    this.scopeKey(scene.scope);
    const seen = new Set<string>();
    const references = (ids: string[]) => {
      if (!ids.length || ids.some((id) => !sourceIds.has(id)) || new Set(ids).size !== ids.length) fail('creative_memory_source', '新增设定与伏笔必须引用当前上下文或本场景的有效来源。', 400);
    };
    for (const setting of scene.newSettings ?? []) {
      if (!setting.title.trim() || !setting.content.trim()) fail('creative_setting_empty', '新增设定需要标题与完整内容。', 400);
      if (seen.has('setting:' + setting.id)) fail('creative_setting_duplicate', '本场景重复定义了同一设定。', 400);
      seen.add('setting:' + setting.id); references(setting.sourceRefs);
      if (this.effectiveEntry(scene.scope, 'setting', setting.id)
        || hypotheticalParent?.newSettings?.some((item) => item.id === setting.id)) fail('creative_setting_exists', '该设定 ID 已确认，请使用新 ID 提交明确的补充设定。');
    }
    for (const thread of scene.foreshadowing ?? []) {
      if (!thread.title.trim() || !thread.detail.trim()) fail('creative_thread_empty', '伏笔需要标题与本次变化的具体内容。', 400);
      if (seen.has('thread:' + thread.id)) fail('creative_thread_duplicate', '同一场景不能重复改变同一伏笔。', 400);
      seen.add('thread:' + thread.id); references(thread.sourceRefs);
      const existing = this.effectiveEntry(scene.scope, 'foreshadowing', thread.id);
      const parent = hypotheticalParent?.foreshadowing?.find((item) => item.id === thread.id);
      const status = parent ? (parent.action === 'resolve' ? 'resolved' : 'open') : existing?.status;
      if (thread.action === 'open' && status) fail('creative_thread_exists', '该伏笔 ID 已存在，请使用推进或收束。');
      if (thread.action !== 'open' && !status) fail('creative_thread_missing', '不能推进或收束当前时间线尚未建立的伏笔。');
      if (thread.action !== 'open' && status === 'resolved') fail('creative_thread_resolved', '该伏笔已经收束；如需新伏笔，请使用新 ID。');
    }
  }
  recordScene(scene: CreativeScene, artifact: CreativeArtifact): void {
    if (!this.db.isTransaction) fail('creative_memory_transaction', '记忆写入必须与正式采用处于同一事务。', 500);
    const key = creativeMemoryScope(scene.scope), now = nowIso();
    const changes = [...(scene.newSettings ?? []).map((item) => ({ ...item, kind: 'setting' as const, status: 'confirmed', text: item.content })),
      ...(scene.foreshadowing ?? []).map((item) => ({ ...item, kind: 'foreshadowing' as const, status: item.action === 'resolve' ? 'resolved' : 'open', text: item.detail }))];
    for (const change of changes) {
      const previous = this.effectiveEntry(scene.scope, change.kind, change.id);
      const revision = Number(previous?.revision ?? 0) + 1;
      this.db.prepare(`INSERT INTO co_memory_entries VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(scope_key,kind,id) DO UPDATE SET revision=excluded.revision,status=excluded.status,title=excluded.title,
        content=excluded.content,source_artifact_id=excluded.source_artifact_id,source_hash=excluded.source_hash,source_refs_json=excluded.source_refs_json,updated_at=excluded.updated_at`)
        .run(key, change.id, change.kind, revision, change.status, change.title, change.text, artifact.id, artifact.contentHash, JSON.stringify(change.sourceRefs), now);
      const payload = { id: change.id, kind: change.kind, status: change.status, title: change.title, content: change.text,
        revision, sourceArtifactId: artifact.id, sourceHash: artifact.contentHash, sourceRefs: change.sourceRefs, updatedAt: now };
      this.db.prepare('INSERT INTO co_memory_entry_versions VALUES (?,?,?,?,?,?,?,?)').run(key, change.id, change.kind, revision, JSON.stringify(payload), creativeHash(payload), scene.simulation?.tick ?? 0, now);
    }
    // co_scene_adoptions is already written by the same transaction. A batch is immutable evidence, never a model interpretation.
    const filter = `FROM co_scene_adoptions d JOIN co_artifacts a ON a.id=d.artifact_id
      WHERE CASE WHEN json_extract(a.content_json,'$.scope.branchId') IS NOT NULL
        THEN 'branch:'||json_extract(a.content_json,'$.scope.branchId') ELSE 'project:'||json_extract(a.content_json,'$.scope.projectId') END=?`;
    const total = Number(this.db.prepare('SELECT COUNT(*) AS count ' + filter).get(key)!.count);
    if (!total || total % 20 !== 0) return;
    const rows = this.db.prepare('SELECT a.id,a.content_json,a.content_hash,d.created_at ' + filter + ' ORDER BY d.rowid DESC LIMIT 20').all(key).reverse();
    const batch = total / 20;
    const scenes = rows.map((row) => {
      const item = JSON.parse(String(row.content_json)) as CreativeScene;
      return { artifactId: String(row.id), sourceHash: String(row.content_hash), title: item.title,
        events: item.simulation?.events.map((event) => ({ id: event.id, title: event.title, summary: event.summary, sourceHash: creativeHash(event),
          facts: event.facts.map((fact) => ({ id: fact.id, sourceHash: creativeHash(fact), nature: fact.nature, knownBy: fact.knownBy })), stateChanges: event.stateChanges.map((state) => ({ actorId: state.actorId, sourceHash: creativeHash(state) })) })) ?? [],
        newSettings: item.newSettings?.map((setting) => ({ id: setting.id, title: setting.title, sourceHash: creativeHash(setting) })) ?? [],
        foreshadowing: item.foreshadowing?.map((thread) => ({ id: thread.id, action: thread.action, title: thread.title, sourceHash: creativeHash(thread) })) ?? [] };
    });
    const content = { schemaVersion: 1, representation: 'extractive-confirmed-scenes', batch, scenes,
      openThreads: (() => {
        const page = this.readEntries(scene.scope, { kind: 'foreshadowing', status: 'open', limit: 100 });
        return { ...page, items: page.items.map((thread) => ({ id: thread.id, revision: thread.revision, title: thread.title, sourceArtifactId: thread.sourceArtifactId, sourceHash: thread.sourceHash })) };
      })(),
      coverage: { adoptedScenes: total, batchScenes: scenes.length, allFactsRetainedInIndex: true } };
    this.db.prepare('INSERT INTO co_memory_digests VALUES (?,?,?,?,?)').run(key, batch, JSON.stringify(content), creativeHash(content), now);
  }

  /** Deterministic open-thread aging & recent pacing summary (no model calls). */
  threadHealthAndPacing(
    scope: CreativeScope,
    options: {
      activeActors?: Array<{ id: string; name: string }>;
      currentTick?: number | null;
      recentEvents?: WorldEvent[];
    } = {},
  ) {
    const key = this.scopeKey(scope);
    const open = this.readEntries(scope, { kind: 'foreshadowing', status: 'open', limit: 50 }).items;
    const actors = options.activeActors ?? [];
    const activeIds = new Set(actors.map((item) => item.id));
    const tick = options.currentTick ?? null;
    const recent = (options.recentEvents ?? []).slice(-6);
    const eventActorsById = new Map<string, string[]>(recent.map((ev) => [ev.id, ev.participantIds ?? []]));

    const openThreads = open.map((thread) => {
      const versionRow = this.db.prepare(
        'SELECT effective_tick FROM co_memory_entry_versions WHERE scope_key=? AND kind=? AND id=? ORDER BY revision ASC LIMIT 1',
      ).get(key, 'foreshadowing', thread.id) as { effective_tick?: number } | undefined;
      const snapshotRow = !versionRow && options.currentTick !== undefined && scope.branchId
        ? (this.db.prepare(
            'SELECT effective_tick FROM co_memory_branch_snapshots WHERE branch_id=? AND kind=? AND id=? LIMIT 1',
          ).get(scope.branchId, 'foreshadowing', thread.id) as { effective_tick?: number } | undefined)
        : undefined;
      const openedTick = typeof versionRow?.effective_tick === 'number'
        ? versionRow.effective_tick
        : (typeof snapshotRow?.effective_tick === 'number' ? snapshotRow.effective_tick : null);
      const ticksOpen = tick !== null && openedTick !== null ? Math.max(0, tick - openedTick) : null;
      const hay = `${thread.title} ${thread.content}`.toLowerCase();
      const relevantToActiveActors = actors.some(
        (actor) => hay.includes(actor.name.toLowerCase()) || hay.includes(actor.id.toLowerCase()),
      ) || thread.sourceRefs.some((ref) => {
        const id = ref.startsWith('event:') ? ref.slice(6) : ref;
        return (eventActorsById.get(id) ?? []).some((actorId) => activeIds.has(actorId));
      });
      const overdue = ticksOpen !== null ? ticksOpen >= 180 : thread.revision === 1;
      return {
        id: thread.id,
        title: thread.title,
        revision: thread.revision,
        openedTick,
        ticksOpen,
        relevantToActiveActors,
        priorityHint: relevantToActiveActors && overdue
          ? 'in_scene_and_overdue'
          : relevantToActiveActors
            ? 'relevant_to_active_actors'
            : overdue
              ? 'long_open_needs_attention'
              : 'open',
      };
    }).sort((a, b) => {
      const score = (item: typeof a) =>
        (item.relevantToActiveActors ? 1000 : 0) + (item.ticksOpen ?? (item.priorityHint === 'long_open_needs_attention' ? 120 : 0));
      return score(b) - score(a);
    });

    const emotionShifts = recent.reduce((acc, ev) => acc + (ev.stateChanges?.length ?? 0), 0);
    const totalDuration = recent.reduce((acc, ev) => acc + (ev.duration ?? 0), 0);
    const pacingSignal = {
      recentEventsCount: recent.length,
      recentStateShifts: emotionShifts,
      totalMinutesCovered: totalDuration,
      suggestion: recent.length === 0
        ? '开篇/新段起步：先确立人物当前动作目标、感官环境与即时冲突，避免大段设定说明。'
        : emotionShifts >= 6
          ? '近期状态变化密集、情绪拉满：本场可适当留白或走克制潜台词，让信息自然沉淀。'
          : '近期节奏偏平稳：适合通过动作阻碍、认知偏差交锋或推进一条相关伏笔制造张力。',
    };

    return {
      openThreadAlerts: openThreads.slice(0, 12),
      overdueCount: openThreads.filter((item) => item.priorityHint === 'in_scene_and_overdue' || item.priorityHint === 'long_open_needs_attention').length,
      pacingSignal,
    };
  }
}
