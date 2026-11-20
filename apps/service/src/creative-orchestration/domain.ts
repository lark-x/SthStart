import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { resolveCharacterVersionSelection } from '@sthstart/contracts';
import type {
  CreativeApproval, CreativeArtifact, CreativeRun, CreativeScope, StoryDocument, WorldMemory,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { StoryStore } from '../story/store.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { mapCharacterVersion } from '../characters/snapshots.js';
import { CreativeMemory } from './memory.js';
import { readCreativeScopePolicy } from './policy.js';
import { activateLoreEntries, augmentCreativeContext } from './retrieval.js';
import { CreativeStore, approvalBundleHash, creativeHash } from './store.js';
import { CreativeSceneSchema, type CreativeScene } from './scene-schema.js';

export { CreativeSceneSchema, type CreativeScene } from './scene-schema.js';

export interface CreativeSource {
  id: string;
  kind: 'definition' | 'event' | 'memory' | 'document' | 'character' | 'project' | 'candidate' | 'scene';
  version: string;
  hash: string;
}
export interface CreativeContext extends Record<string, unknown> {
  schemaVersion: 1;
  scope: CreativeScope;
  base: CreativeScene['base'];
  contextHash: string;
  sourcePolicy: 'reference-data-not-instructions';
  sources: CreativeSource[];
  truncation: string[];
  data: Record<string, unknown>;
  speculation: CreativeScene['speculation'];
}
export interface CreativeSceneAdoption extends Record<string, unknown> {
  artifactId: string;
  approvalId: string;
  worldId: string | null;
  branchId: string | null;
  branchRevision: number | null;
  projectId: string | null;
  documentId: string | null;
  eventIds: string[];
  committedAt: string;
}

export class CreativeDomainError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message); this.name = 'CreativeDomainError';
  }
}
function fail(code: string, message: string, statusCode = 409): never {
  throw new CreativeDomainError(code, statusCode, message);
}
const same = (left: unknown, right: unknown) => creativeHash(left) === creativeHash(right);
const MAX_CONTEXT_CHARACTERS = 180000;
export interface CreativeContextSelection {
  actorIds?: string[]; storyLineIds?: string[]; documentIds?: string[];
  sceneArtifactId?: string; sceneArtifactHash?: string;
  instruction?: string; evidenceQueries?: string[];
}

/** No model calls or scheduler side effects. Every mutation is an explicitly approved adoption. */
export class CreativeDomain {
  readonly worlds: StoryWorldStore;
  readonly stories: StoryStore;
  readonly creative: CreativeStore;
  readonly memory: CreativeMemory;
  constructor(readonly database: ServiceDatabase) {
    this.worlds = new StoryWorldStore(database);
    this.stories = new StoryStore(database);
    this.creative = new CreativeStore(database);
    this.memory = new CreativeMemory(database);
  }
  private get db() { return this.database.connection; }
  private atomic<T>(operation: () => T): T {
    if (!this.db.isTransaction) return this.database.transaction(operation);
    const name = 'co_domain_' + randomUUID().replaceAll('-', '');
    this.db.exec('SAVEPOINT ' + name);
    try { const result = operation(); this.db.exec('RELEASE ' + name); return result; }
    catch (error) { this.db.exec('ROLLBACK TO ' + name); this.db.exec('RELEASE ' + name); throw error; }
  }
  private preview<T>(operation: () => T): T {
    const name = 'co_preview_' + randomUUID().replaceAll('-', '');
    this.db.exec('SAVEPOINT ' + name);
    try { return operation(); }
    finally { this.db.exec('ROLLBACK TO ' + name); this.db.exec('RELEASE ' + name); }
  }
  private persistedRun(run: CreativeRun): CreativeRun {
    const current = this.creative.getRun(run.id);
    if (!current || !same(current.scope, run.scope)) {
      fail('creative_scope_mismatch', '创作运行或作品范围已改变，请重新打开当前运行。');
    }
    return current;
  }
  private artifact(id: string): CreativeArtifact {
    const row = this.db.prepare('SELECT * FROM co_artifacts WHERE id=?').get(id);
    if (!row) fail('creative_artifact_missing', `产物 ${id} 不存在，请重新生成。`);
    return {
      id: String(row.id), runId: String(row.run_id), nodeRunId: String(row.node_run_id),
      kind: row.kind as CreativeArtifact['kind'], content: JSON.parse(String(row.content_json)),
      contentHash: String(row.content_hash), dependencyIds: JSON.parse(String(row.dependency_ids_json)),
      status: row.status as CreativeArtifact['status'], createdAt: String(row.created_at),
    };
  }
  private dependencies(artifact: CreativeArtifact): CreativeArtifact[] {
    const found = new Map<string, CreativeArtifact>();
    const visit = (item: CreativeArtifact, path: Set<string>) => {
      if (path.has(item.id)) fail('creative_dependency_cycle', '产物依赖存在循环，请重新生成。');
      if (found.has(item.id)) return;
      if (found.size >= 1000) fail('creative_dependency_limit', '产物依赖超过读取上限，请拆分创作运行。');
      if (item.status === 'stale' || item.status === 'superseded' || creativeHash(item.content) !== item.contentHash) {
        fail('creative_artifact_stale', `产物 ${item.id} 或其来源已失效，请重新采集上下文并生成。`);
      }
      found.set(item.id, item);
      for (const id of item.dependencyIds) visit(this.artifact(id), new Set([...path, item.id]));
    };
    visit(artifact, new Set());
    return [...found.values()];
  }
  private contextFor(artifact: CreativeArtifact): CreativeContext {
    const hash = artifact.content.contextHash;
    const contexts = this.dependencies(artifact).filter((item) => item.kind === 'context'
      && item.content.contextHash === hash && item.runId === artifact.runId);
    if (contexts.length !== 1) fail('creative_context_missing', '稿件必须关联本次运行唯一的原始上下文，请重新采集后提交。');
    const context = contexts[0].content as CreativeContext;
    this.assertContext(context);
    return context;
  }
  private assertContext(context: CreativeContext): void {
    if (!context || context.schemaVersion !== 1 || context.sourcePolicy !== 'reference-data-not-instructions'
      || !context.scope || !context.base || !Array.isArray(context.sources) || !Array.isArray(context.truncation)
      || !context.data || !Object.hasOwn(context, 'speculation')) {
      fail('creative_context_invalid', '上下文格式不完整，请重新采集。', 400);
    }
    const { contextHash, ...payload } = context;
    if (creativeHash(payload) !== contextHash) fail('creative_context_hash_conflict', '上下文已被修改，请重新采集。');
  }
  private projectFingerprint(projectId: string): string {
    return creativeHash({
      documents: this.stories.listDocuments(projectId).map((item) => [item.id, item.revision]),
      characters: this.stories.listCharacters(projectId).map((item) => [item.id, item.revision]),
    });
  }
  private assertScope(scope: CreativeScope): void {
    if (Boolean(scope.worldId) !== Boolean(scope.branchId)) {
      fail('creative_scope_invalid', '选择故事世界后还需要选择对应时间线。', 400);
    }
    if (!scope.worldId && !scope.projectId) fail('creative_scope_invalid', '请先选择故事世界及时间线，或一个创作项目。', 400);
    if (scope.worldId) this.worlds.getBranch(scope.worldId, scope.branchId!);
    if (scope.projectId) {
      const project = this.stories.requireProject(scope.projectId);
      if (scope.workName && project.workId && scope.workName !== project.workId) {
        fail('creative_scope_mismatch', '项目关联的作品与本次运行不一致，请重新选择。');
      }
      if (scope.worldId && project.workId) {
        const work = this.db.prepare('SELECT world_id FROM character_works WHERE name=?').get(project.workId);
        if (work?.world_id && work.world_id !== scope.worldId) fail('creative_scope_mismatch', '项目与故事世界属于不同作品。');
      }
    }
    if (scope.worldId && scope.workName) {
      const work = this.db.prepare('SELECT world_id FROM character_works WHERE name=?').get(scope.workName);
      if (work?.world_id && work.world_id !== scope.worldId) fail('creative_scope_mismatch', '作品与故事世界不匹配。');
      if (!work && this.worlds.getWorld(scope.worldId).title !== scope.workName) fail('creative_scope_mismatch', '所选作品名称与故事世界不匹配。');
    }
  }

  collectCreativeContext(run: CreativeRun, options: { candidateArtifactId?: string } = {}): CreativeContext {
    return this.atomic(() => {
      const current = this.persistedRun(run);
      this.assertScope(current.scope);
      const candidateId = options.candidateArtifactId ?? (typeof current.input.candidateArtifactId === 'string'
        ? current.input.candidateArtifactId : undefined);
      if (candidateId) return this.speculativeContext(current, candidateId);
      const selection = this.contextSelection(current.input.contextSelection);
      selection.instruction = current.instruction;
      if (current.input.evidenceQueries !== undefined) selection.evidenceQueries = current.input.evidenceQueries as string[];
      if (current.input.sceneArtifactId !== undefined || current.input.sceneArtifactHash !== undefined) {
        Object.assign(selection, { sceneArtifactId: current.input.sceneArtifactId, sceneArtifactHash: current.input.sceneArtifactHash });
      }
      return this.collectFormalContext(current.scope, this.contextSelection(selection));
    });
  }
  /** Read-only tool entry point. It neither creates runs nor reserves speculative slots. */
  collectScopeContext(scope: CreativeScope, selection: CreativeContextSelection = {}): CreativeContext {
    return this.atomic(() => {
      this.assertScope(scope);
      return this.collectFormalContext(scope, this.contextSelection(selection));
    });
  }
  private contextSelection(value: unknown): CreativeContextSelection {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('creative_context_selection', '上下文选择必须包含角色、故事线或文档 ID 列表。', 400);
    const selection = value as Record<string, unknown>;
    for (const [key, ids] of Object.entries(selection)) {
      if (key === 'instruction') {
        if (typeof ids !== 'string' || ids.length > 20000) fail('creative_context_selection', '检索指令最多 20000 字符。', 400);
        continue;
      }
      if (key === 'evidenceQueries') {
        if (!Array.isArray(ids) || ids.length > 3 || ids.some((query) => typeof query !== 'string' || !query.trim() || query.length > 100)) {
          fail('creative_evidence_queries', '手动检索最多 3 个关键词，每个关键词为 1–100 字符。', 400);
        }
        continue;
      }
      if (key === 'sceneArtifactId' || key === 'sceneArtifactHash') {
        if (typeof ids !== 'string' || !ids || (key === 'sceneArtifactHash' && !/^[a-f0-9]{64}$/.test(ids))) {
          fail('creative_context_selection', '配图场景 ID 或哈希无效。', 400);
        }
        continue;
      }
      if (!['actorIds', 'storyLineIds', 'documentIds'].includes(key) || !Array.isArray(ids)
        || ids.length > 100 || ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
        fail('creative_context_selection', '上下文选择中的角色、故事线或文档 ID 无效。', 400);
      }
    }
    if (Boolean(selection.sceneArtifactId) !== Boolean(selection.sceneArtifactHash)) fail('creative_context_selection', '配图场景必须同时提供已采用产物 ID 与哈希。', 400);
    return structuredClone(selection) as CreativeContextSelection;
  }
  private collectFormalContext(scope: CreativeScope, selection: CreativeContextSelection = {}): CreativeContext {
    const sources: CreativeSource[] = [], truncation: string[] = [];
    const data: Record<string, unknown> = {};
    const base: CreativeScene['base'] = { branchRevision: null, currentTick: null, projectRevision: null, projectContentHash: null };
    const source = (id: string, kind: CreativeSource['kind'], version: string, value: unknown) => {
      sources.push({ id, kind, version, hash: creativeHash(value) });
    };
    // Clip only old prose. Persona, world rules, objective facts and knowledge never lose their trailing qualifiers.
    const excerpt = (body: string, path: string) => {
      if (body.length <= 2400) return body;
      truncation.push(path); return body.slice(0, 2400) + '\n[旧场景正文节选，非完整来源；事实与角色知识以结构化记录为准]';
    };
    if (scope.worldId && scope.branchId) {
      const detail = this.worlds.detail(scope.worldId, scope.branchId);
      base.branchRevision = detail.branch.revision; base.currentTick = detail.branch.currentTick;
      const activeLines = detail.storyLines.filter((line) => selection.storyLineIds?.includes(line.id));
      if (selection.storyLineIds?.some((id) => !detail.storyLines.some((line) => line.id === id))) fail('creative_context_selection', '所选故事线不属于当前时间线。', 400);
      const activeIds = new Set(selection.actorIds ?? (activeLines.length ? activeLines.flatMap((line) => line.actorIds)
        : detail.definition.actors.filter((actor) => actor.role === 'main').map((actor) => actor.id)));
      if ([...activeIds].some((id) => !detail.definition.actors.some((actor) => actor.id === id))) fail('creative_context_selection', '所选角色不属于当前时间线。', 400);
      const recent = this.memory.recentEvents(scope), events = recent.items;
      const memories: WorldMemory[] = [];
      const activeActors = detail.definition.actors.filter((actor) => activeIds.has(actor.id));
      const snapshots = activeActors.map((actor) => {
        if (!actor.characterId || !actor.characterVersion) return { actorId: actor.id, sourceSnapshot: null };
        const row = this.db.prepare('SELECT * FROM character_versions WHERE character_id=? AND version=?').get(actor.characterId, actor.characterVersion);
        if (!row) fail('creative_character_source_missing', `角色 ${actor.name} 的冻结人设版本不存在，请重新配置角色来源。`);
        const snapshot = resolveCharacterVersionSelection(mapCharacterVersion(row), { variantId: actor.characterVariantId, costumeAssetId: actor.characterCostumeAssetId }).draft;
        source(`character:${actor.characterId}:version:${actor.characterVersion}:actor:${actor.id}`, 'character', String(actor.characterVersion), snapshot);
        return { actorId: actor.id, characterId: actor.characterId, characterVersion: actor.characterVersion, sourceSnapshot: snapshot };
      });
      // A director may see world facts; each actor receives only their legally known facts and explicitly subjective beliefs.
      const knowledge = activeActors.map((actor) => {
        const facts = this.memory.readFacts(scope, { actorId: actor.id, limit: 100 });
        const rows = this.db.prepare(`SELECT data_json FROM sw_memories WHERE world_id=? AND branch_id=? AND actor_id=? AND learned_at<=?
          ORDER BY learned_at DESC,id LIMIT 40`).all(scope.worldId!, scope.branchId!, actor.id, detail.branch.currentTick);
        const personal = rows.map((row) => JSON.parse(String(row.data_json)) as WorldMemory);
        memories.push(...personal);
        source(`knowledge:${scope.branchId}:actor:${actor.id}`, 'memory', String(detail.branch.revision), { facts, personal });
        return { actorId: actor.id, facts: facts.items, factCoverage: { total: facts.total, included: facts.items.length, nextOffset: facts.nextOffset },
          memories: personal.filter((item) => item.kind === 'experienced' || item.kind === 'heard'),
          beliefs: personal.filter((item) => item.kind === 'inferred' || item.kind === 'mistaken'),
          retrieval: { tool: 'creative.memory.facts', actorId: actor.id, scope } };
      });
      source(`world:${scope.worldId}:branch:${scope.branchId}`, 'definition', `${detail.branch.revision}/${detail.branch.sourceRevision}`, {
        branch: detail.branch, definition: detail.definition, states: detail.states,
        storyLines: detail.storyLines, interventions: detail.interventions,
      });
      const canon = this.memory.readFacts(scope, { nature: 'canon', limit: 100 });
      const author = this.memory.readFacts(scope, { nature: 'author', limit: 100 });
      const relevant = new Map<string, ReturnType<CreativeMemory['readFacts']>>();
      for (const lineId of selection.storyLineIds ?? []) relevant.set(`line:${lineId}`, this.memory.readFacts(scope, { storyLineId: lineId, limit: 50 }));
      for (const locationId of new Set(activeActors.map((actor) => detail.states.find((state) => state.actorId === actor.id)?.locationId ?? actor.locationId))) {
        relevant.set(`location:${locationId}`, this.memory.readFacts(scope, { locationId, limit: 50 }));
      }
      const factIndex = this.memory.readFacts(scope, { limit: 1 });
      const digests = this.memory.digestCatalogue(scope);
      const openThreads = this.memory.readEntries(scope, { kind: 'foreshadowing', status: 'open', limit: 50 });
      const settings = this.memory.readEntries(scope, { kind: 'setting', limit: 50 });
      const threadHealth = this.memory.threadHealthAndPacing(scope, {
        activeActors: activeActors.map((actor) => ({ id: actor.id, name: actor.name })),
        currentTick: detail.branch.currentTick,
        recentEvents: events,
      });
      const cueText = [
        selection.instruction ?? '',
        ...activeActors.map((actor) => actor.name),
        ...activeActors.map((actor) => {
          const locId = detail.states.find((state) => state.actorId === actor.id)?.locationId ?? actor.locationId;
          return detail.definition.locations.find((loc) => loc.id === locId)?.name ?? '';
        }),
      ].join(' ');
      const loreActivation = activateLoreEntries([...openThreads.items, ...settings.items], cueText);
      const longTerm = { canonicalFacts: canon, authorFacts: author, relevantFacts: Object.fromEntries(relevant), digests, openThreads, settings, threadHealth, loreActivation,
        coverage: { factsStored: factIndex.total, allFactsRetained: true, returnedFactsAreSelection: true },
        retrieval: { facts: 'creative.memory.facts', entries: 'creative.memory.entries', scope } };
      source(`history:${scope.branchId}:through:${detail.branch.currentTick}`, 'event', String(detail.branch.revision), { total: recent.total, events });
      source(`memory-index:${scope.branchId}`, 'memory', String(detail.branch.revision), longTerm);
      for (const item of events) source(`event:${item.id}`, 'event', String(item.tick), item);
      if (recent.total > events.length) truncation.push(`history:${recent.total - events.length}:older-events-available-in-fact-index-and-digests`);
      data.world = {
        branch: detail.branch, definition: { ...detail.definition, actors: activeActors },
        actorDirectory: detail.definition.actors.map((actor) => ({ id: actor.id, name: actor.name, role: actor.role, locationId: actor.locationId })),
        activeActorIds: [...activeIds], selectedStoryLineIds: selection.storyLineIds ?? [], characterSnapshots: snapshots, actorKnowledge: knowledge,
        states: detail.states, storyLines: detail.storyLines,
        interventions: detail.interventions.filter((item) => !item.consumed || item.kind === 'constraint'),
        history: { events, memories, window: { from: events[0]?.tick ?? 0, to: detail.branch.currentTick }, totalEventsInWindow: recent.total },
        longTerm,
      };
    }
    if (scope.projectId) {
      const project = this.stories.requireProject(scope.projectId);
      const allDocuments = this.stories.listDocuments(project.id);
      if (selection.documentIds?.some((id) => !allDocuments.some((item) => item.id === id))) fail('creative_context_selection', '所选文档不属于当前项目。', 400);
      const documents = selection.documentIds ? allDocuments.filter((item) => selection.documentIds!.includes(item.id))
        : [...allDocuments.filter((item) => item.kind === 'outline' || item.kind === 'world'),
          ...allDocuments.filter((item) => item.kind === 'scene' || item.kind === 'chapter').slice(-6)];
      const allCharacters = this.stories.listCharacters(project.id);
      if (selection.actorIds?.some((id) => !scope.worldId && !allCharacters.some((item) => item.id === id))) fail('creative_context_selection', '所选角色不属于当前项目。', 400);
      const activeWorldCharacterIds = scope.worldId
        ? new Set((data.world as { characterSnapshots: Array<{ characterId?: string }> }).characterSnapshots.map((item) => item.characterId).filter(Boolean)) : null;
      const characters = activeWorldCharacterIds ? allCharacters.filter((item) => item.sourceCharacterId && activeWorldCharacterIds.has(item.sourceCharacterId))
        : selection.actorIds ? allCharacters.filter((item) => selection.actorIds!.includes(item.id)) : allCharacters;
      base.projectRevision = project.revision; base.projectContentHash = this.projectFingerprint(project.id);
      source(`project:${project.id}`, 'project', String(project.revision), project);
      for (const item of documents) source(`document:${item.id}`, 'document', String(item.revision), item);
      for (const item of characters) source(`character:${item.id}`, 'character', String(item.revision), item);
      if (documents.length < allDocuments.length) truncation.push(`documents:included:${documents.length}:total:${allDocuments.length}`);
      if (characters.length < allCharacters.length) truncation.push(`characters:included:${characters.length}:total:${allCharacters.length}`);
      const recentProse = new Set(documents.filter((item) => item.kind === 'scene' || item.kind === 'chapter').slice(-2).map((item) => item.id));
      const projectOpenThreads = this.memory.readEntries(scope, { kind: 'foreshadowing', status: 'open', limit: 50 });
      const projectSettings = this.memory.readEntries(scope, { kind: 'setting', limit: 50 });
      const projectThreadHealth = this.memory.threadHealthAndPacing(scope, {
        activeActors: characters.map((item) => ({ id: item.id, name: item.name })),
      });
      const projectLoreActivation = activateLoreEntries(
        [...projectOpenThreads.items, ...projectSettings.items],
        [selection.instruction ?? '', ...characters.map((item) => item.name)].join(' '),
      );
      data.project = {
        project, documents: documents.map((item) => item.kind === 'outline' || item.kind === 'world' || recentProse.has(item.id)
          ? item : { ...item, body: excerpt(item.body, `project/document:${item.id}/body`), representation: 'prose-excerpt' }),
        characters: characters.map((item) => ({ ...item, sourceSnapshot: this.stories.getCharacterSourceSnapshot(item) })),
        longTerm: { digests: this.memory.digestCatalogue(scope), openThreads: projectOpenThreads,
          settings: projectSettings, threadHealth: projectThreadHealth, loreActivation: projectLoreActivation },
      };
    }
    const policyRow = this.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='co_scope_policies'").get();
    const savedPolicy = policyRow ? readCreativeScopePolicy(this.creative, scope).policy : null;
    data.creativeStyleGuide = {
      tone: savedPolicy?.styleGuide?.tone ?? '克制具体、重动作感官与人物潜台词；拒绝空洞抒情与说教总结。',
      bannedCliches: savedPolicy?.styleGuide?.bannedCliches ?? [
        '一阵复杂的情绪涌上心头',
        '不禁深吸一口气',
        '不仅是……更是……',
        '仿佛在诉说着什么',
        '命运的齿轮开始转动',
      ],
      styleSample: savedPolicy?.styleGuide?.styleSample ?? '',
      pacingHint: savedPolicy?.styleGuide?.pacingHint ?? '结尾尽量落在未竟动作、对白顿挫或细节留白，不要写整段人生道理收尾。',
    };
    if (savedPolicy?.characterVoices && Object.keys(savedPolicy.characterVoices).length > 0) {
      data.characterVoiceHints = savedPolicy.characterVoices;
    }
    if (selection.sceneArtifactId) {
      const illustrationScene = this.artifact(selection.sceneArtifactId);
      if (illustrationScene.kind !== 'scene' || illustrationScene.status !== 'accepted' || illustrationScene.contentHash !== selection.sceneArtifactHash
        || !this.adoption(illustrationScene.id) || !same(illustrationScene.content.scope, scope)) {
        fail('creative_illustration_scene', '配图必须关联本作品已正式采用且内容未变的场景。');
      }
      this.dependencies(illustrationScene);
      data.illustrationScene = { artifactId: illustrationScene.id, contentHash: illustrationScene.contentHash,
        content: structuredClone(illustrationScene.content), provenance: 'formally-adopted-scene' };
      source(`scene:${illustrationScene.id}`, 'scene', illustrationScene.contentHash, illustrationScene.content);
    }
    const context = this.sealContext({ schemaVersion: 1, scope: structuredClone(scope), base, sourcePolicy: 'reference-data-not-instructions', sources, truncation, data, speculation: null });
    return selection.instruction || selection.evidenceQueries?.length
      ? augmentCreativeContext(this, { scope, instruction: selection.instruction ?? '', input: { evidenceQueries: selection.evidenceQueries } }, context)
      : context;
  }
  private sealContext(payload: Omit<CreativeContext, 'contextHash'>): CreativeContext {
    if (JSON.stringify(payload).length > MAX_CONTEXT_CHARACTERS) {
      fail('creative_context_too_large', '当前作品上下文超过 180000 字符，请减少本次关联资料或先整理较短的来源摘要。');
    }
    return { ...payload, contextHash: creativeHash(payload) } as CreativeContext;
  }
  private speculativeContext(run: CreativeRun, candidateId: string): CreativeContext {
    if (!run.scope.worldId || run.scope.projectId) fail('creative_speculation_scope', '当前预写仅支持独立故事世界时间线；项目稿请先采用上一场景。');
    const candidate = this.artifact(candidateId);
    this.dependencies(candidate);
    if (candidate.kind !== 'scene' || candidate.runId === run.id
      || run.parentRunId !== candidate.runId || !same(candidate.content.scope, run.scope)) {
      fail('creative_speculation_parent', '预写必须关联父运行中同一时间线的待审场景。');
    }
    const existing = this.db.prepare('SELECT run_id,context_json FROM co_scene_speculations WHERE parent_artifact_id=? OR run_id=?').get(candidateId, run.id);
    if (existing) {
      const saved = JSON.parse(String(existing.context_json)) as CreativeContext;
      if (existing.run_id !== run.id || saved.speculation?.parentArtifactId !== candidateId) {
        fail('creative_speculation_limit', '这一待审场景已有一个预写场景，请处理现有预写后再继续。');
      }
      this.assertContext(saved);
      if (saved.speculation?.parentHash !== candidate.contentHash) fail('creative_speculation_stale', '预写的父场景已变化，请重新生成。');
      const adopted = this.adoption(candidate.id);
      if (adopted) this.assertBase(saved.base, run.scope);
      else this.validateCreativeScene(candidate.content, this.contextFor(candidate));
      return saved;
    }
    if (candidate.status !== 'candidate') fail('creative_speculation_parent', '上一场景已经采用，请按正式历史继续创建下一场景。');
    const parentScene = this.validateCreativeScene(candidate.content, this.contextFor(candidate));
    if (parentScene.speculation) fail('creative_speculation_depth', '最多预写下一场景；请先采用当前待审场景后再继续。');
    this.assertBase(parentScene.base, run.scope);
    const formal = this.collectFormalContext(run.scope, this.contextSelection({
      ...this.contextSelection(run.input.contextSelection), instruction: run.instruction,
      ...(run.input.evidenceQueries !== undefined ? { evidenceQueries: run.input.evidenceQueries } : {}),
    }));
    const payload = { ...formal } as Partial<CreativeContext>;
    delete payload.contextHash;
    const context = this.sealContext({
      ...payload as Omit<CreativeContext, 'contextHash'>,
      base: { ...formal.base, branchRevision: formal.base.branchRevision! + 1, currentTick: parentScene.simulation!.tick },
      speculation: { parentArtifactId: candidate.id, parentHash: candidate.contentHash },
      sources: [...formal.sources, { id: `candidate:${candidate.id}`, kind: 'candidate', version: candidate.contentHash, hash: candidate.contentHash }],
      data: { ...formal.data, candidate: { status: 'unaccepted-hypothesis', artifactId: candidate.id, content: parentScene } },
    });
    this.db.prepare('INSERT INTO co_scene_speculations(parent_artifact_id,run_id,context_json,created_at) VALUES (?,?,?,?)')
      .run(candidate.id, run.id, JSON.stringify(context), nowIso());
    return context;
  }
  private assertBase(base: CreativeScene['base'], scope: CreativeScope): void {
    this.assertScope(scope);
    if (scope.worldId) {
      const branch = this.worlds.getBranch(scope.worldId, scope.branchId!);
      if (branch.revision !== base.branchRevision || branch.currentTick !== base.currentTick) {
        fail('creative_history_conflict', `时间线已从稿件依据的版本 ${base.branchRevision} 变为 ${branch.revision}。请重新采集上下文并返修，原稿已保留。`);
      }
    }
    if (scope.projectId) {
      const project = this.stories.requireProject(scope.projectId);
      if (project.revision !== base.projectRevision || this.projectFingerprint(project.id) !== base.projectContentHash) {
        fail('creative_project_conflict', '项目或其文档、角色资料已变化，请重新采集上下文并返修，原稿已保留。');
      }
    }
  }

  validateCreativeScene(content: unknown, context: CreativeContext): CreativeScene {
    this.assertContext(context);
    if (!Value.Check(CreativeSceneSchema, content)) {
      const first = Value.Errors(CreativeSceneSchema, content).First();
      fail('creative_scene_invalid', `场景格式错误 ${first?.path ?? '/'}：${first?.message ?? '需正文与结构化事件草案'}`, 400);
    }
    const scene = structuredClone(content as CreativeScene);
    if (!scene.title.trim() || !scene.body.trim()) fail('creative_scene_invalid', '场景标题与正文不能为空。', 400);
    if (scene.contextHash !== context.contextHash || !same(scene.scope, context.scope)
      || !same(scene.base, context.base) || !same(scene.speculation, context.speculation)) {
      fail('creative_context_mismatch', '稿件的上下文、版本或作品范围与原始依据不一致，请重新生成。');
    }
    const knownSources = new Set(context.sources.map((item) => item.id));
    if (scene.sourceRefs.some((id) => !knownSources.has(id))) fail('creative_source_mismatch', '稿件引用了本次上下文以外的来源，请重新采集并审核。');
    if (Boolean(scene.simulation) !== Boolean(scene.scope.worldId)) {
      fail('creative_scene_scope', '世界场景必须包含事件草案；独立项目场景不能携带世界事件。', 400);
    }
    if (scene.speculation && !scene.sourceRefs.includes(`candidate:${scene.speculation.parentArtifactId}`)) {
      fail('creative_speculation_source', '预写稿必须明确引用上一待审场景的来源标识。');
    }
    const memorySourceIds = new Set([...knownSources, ...scene.simulation?.events.flatMap((event) =>
      [event.id, `event:${event.id}`, ...event.facts.flatMap((fact) => [fact.id, `fact:${fact.id}`])]) ?? []]);
    const parentScene = scene.speculation && !this.adoption(scene.speculation.parentArtifactId)
      ? this.artifact(scene.speculation.parentArtifactId).content as CreativeScene : undefined;
    this.memory.validateChanges(scene, memorySourceIds, parentScene);
    if (scene.simulation) {
      const result = scene.simulation;
      if (result.tick <= (scene.base.currentTick ?? -1) || result.tick - scene.base.currentTick! > 1440) {
        fail('creative_scene_time', '单场景必须推进时间，且最多推进 1440 分钟；请拆分较长场景。', 400);
      }
      // Exercise the real causal, knowledge, participant and state constraints without writing history.
      this.preview(() => {
        if (scene.speculation) this.prepareSpeculativeValidation(scene);
        this.assertBase(scene.base, scene.scope);
        this.worlds.commitStep(scene.scope.worldId!, scene.scope.branchId!, scene.base.branchRevision!, result);
      });
    } else this.assertBase(scene.base, scene.scope);
    return scene;
  }
  private adoption(id: string): CreativeSceneAdoption | null {
    const row = this.db.prepare('SELECT result_json FROM co_scene_adoptions WHERE artifact_id=?').get(id);
    return row ? JSON.parse(String(row.result_json)) as CreativeSceneAdoption : null;
  }
  private prepareSpeculativeValidation(scene: CreativeScene): void {
    const parent = this.artifact(scene.speculation!.parentArtifactId);
    this.dependencies(parent);
    if (parent.contentHash !== scene.speculation!.parentHash || !same(parent.content.scope, scene.scope)) {
      fail('creative_speculation_stale', '预写依据的上一场景已变化，请重新预写。');
    }
    const adopted = this.adoption(parent.id);
    if (adopted) {
      if (adopted.branchRevision !== scene.base.branchRevision) fail('creative_speculation_stale', '上一场景采用后的版本与预写依据不一致，请重新生成。');
      return;
    }
    const parentScene = this.validateCreativeScene(parent.content, this.contextFor(parent));
    if (parentScene.speculation || !parentScene.simulation) fail('creative_speculation_depth', '只能基于一个尚未采用的场景预写。');
    this.worlds.commitStep(scene.scope.worldId!, scene.scope.branchId!, parentScene.base.branchRevision!, parentScene.simulation);
  }

  /** Runtime must independently bind its review verdicts. This verifies human approval again inside the write transaction. */
  commitCreativeScene(run: CreativeRun, artifact: CreativeArtifact, approval: CreativeApproval): CreativeSceneAdoption {
    return this.atomic(() => {
      const current = this.persistedRun(run), saved = this.artifact(artifact.id);
      if (saved.runId !== current.id || saved.kind !== 'scene' || saved.contentHash !== artifact.contentHash
        || !same(saved.content, artifact.content)) fail('creative_artifact_mismatch', '采用的稿件不属于当前运行或内容已变化。');
      const recorded = this.adoption(saved.id);
      // Only a recorded atomic adoption is replayable; an 'accepted' status alone grants no write authority.
      if (recorded) return recorded;
      if (['cancelled', 'failed', 'uncertain'].includes(current.status)) fail('creative_run_inactive', '运行已停止或结果不确定，请先恢复或核对运行。');
      const dependencies = this.dependencies(saved);
      const authorized = this.creative.getApproval(approval.id);
      if (!authorized || authorized.runId !== current.id || authorized.status !== 'approved' || !authorized.decidedAt
        || authorized.revision !== approval.revision || authorized.bundleHash !== approval.bundleHash
        || !authorized.artifactIds.includes(saved.id)) {
        fail('creative_approval_required', '当前稿件没有有效的人工批准，请刷新审核卡并确认。');
      }
      const bundle = authorized.artifactIds.map((id) => this.artifact(id));
      for (const item of bundle) this.dependencies(item);
      if (bundle.some((item) => item.runId !== current.id) || approvalBundleHash(bundle) !== authorized.bundleHash) {
        fail('creative_approval_stale', '人工批准绑定的交付包已失效，请重新审核。');
      }
      const context = this.contextFor(saved);
      const scene = this.validateCreativeScene(saved.content, context);
      if (!same(scene.scope, current.scope)) fail('creative_scope_mismatch', '稿件和运行不属于同一作品范围。');
      this.assertDirectionApproval(scene, saved, dependencies, current.input.criticalChange === true);
      if (scene.speculation) {
        const slot = this.db.prepare('SELECT context_json FROM co_scene_speculations WHERE parent_artifact_id=? AND run_id=?')
          .get(scene.speculation.parentArtifactId, current.id);
        const parent = dependencies.find((entry) => entry.id === scene.speculation!.parentArtifactId);
        if (!slot || !parent || parent.contentHash !== scene.speculation.parentHash || !this.adoption(parent.id)) {
          fail('creative_speculation_waiting', '请先采用预写所依据的上一场景；上一稿件变化时需要重新预写。');
        }
        const occupied = this.db.prepare('SELECT artifact_id FROM co_scene_adoptions WHERE run_id=?').get(current.id);
        if (occupied) fail('creative_speculation_limit', '一次预写只能采用一个下一场景。');
      }
      this.assertBase(scene.base, scene.scope);
      const branch = scene.simulation ? this.worlds.commitStep(scene.scope.worldId!, scene.scope.branchId!, scene.base.branchRevision!, scene.simulation) : null;
      let document: StoryDocument | null = null;
      if (scene.scope.projectId) document = this.stories.createDocument(scene.scope.projectId, { kind: 'scene', title: scene.title, body: scene.body });
      const result: CreativeSceneAdoption = {
        artifactId: saved.id, approvalId: authorized.id, worldId: scene.scope.worldId, branchId: scene.scope.branchId,
        branchRevision: branch?.revision ?? null, projectId: scene.scope.projectId, documentId: document?.id ?? null,
        eventIds: scene.simulation?.events.map((item) => item.id) ?? [], committedAt: nowIso(),
      };
      this.db.prepare('INSERT INTO co_scene_adoptions(artifact_id,run_id,approval_id,result_json,created_at) VALUES (?,?,?,?,?)')
        .run(saved.id, current.id, authorized.id, JSON.stringify(result), result.committedAt);
      this.memory.recordScene(scene, saved);
      this.creative.setArtifactStatus(saved.id, 'accepted');
      return result;
    });
  }
  private assertDirectionApproval(scene: CreativeScene, artifact: CreativeArtifact, dependencies: CreativeArtifact[], trustedCritical: boolean): void {
    const allPlans = dependencies.filter((item) => item.kind === 'plan' && item.runId === artifact.runId);
    // Joins may forward a plan unchanged; approving its originating immutable artifact is sufficient.
    const required = allPlans.filter((item) => item.content.requiresDirectionApproval === true);
    if (!required.length && !trustedCritical && !scene.directionApprovalId) return;
    const decision = scene.directionApprovalId ? this.creative.getApproval(scene.directionApprovalId) : null;
    if (!decision || decision.status !== 'approved' || decision.runId !== artifact.runId || !decision.decidedAt
      || decision.decidedAt >= artifact.createdAt || !allPlans.length
      || !allPlans.some((item) => decision.artifactIds.includes(item.id))
      || !required.every((item) => allPlans.some((approved) => decision.artifactIds.includes(approved.id) && approved.contentHash === item.contentHash))) {
      fail('creative_direction_approval_required', '不可逆剧情方向需要先经人工批准，再扩写场景；请回到导演计划确认方向。');
    }
    const node = this.db.prepare('SELECT node_id FROM co_node_runs WHERE id=? AND run_id=?').get(decision.nodeRunId, artifact.runId);
    const run = this.creative.getRun(artifact.runId)!;
    const workflow = this.creative.getVersion(run.workflowId, run.workflowVersion);
    const gate = workflow?.document.nodes.find((item) => item.id === node?.node_id);
    if (gate?.kind !== 'approval' || gate.config.parameters?.directionGate !== true) {
      fail('creative_direction_approval_required', '重大方向必须由工作流的方向确认步骤批准。');
    }
    const bundle = decision.artifactIds.map((id) => this.artifact(id));
    for (const item of bundle) this.dependencies(item);
    if (bundle.some((item) => item.runId !== artifact.runId) || approvalBundleHash(bundle) !== decision.bundleHash) {
      fail('creative_direction_approval_stale', '方向批准的计划已变化，请重新确认后扩写。');
    }
  }
}

export const collectCreativeContext = (database: ServiceDatabase, run: CreativeRun, options?: { candidateArtifactId?: string }) =>
  new CreativeDomain(database).collectCreativeContext(run, options);
export const validateCreativeScene = (database: ServiceDatabase, content: unknown, context: CreativeContext) =>
  new CreativeDomain(database).validateCreativeScene(content, context);
export const commitCreativeScene = (database: ServiceDatabase, run: CreativeRun, artifact: CreativeArtifact, approval: CreativeApproval) =>
  new CreativeDomain(database).commitCreativeScene(run, artifact, approval);
