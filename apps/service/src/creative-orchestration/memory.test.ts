import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreativeScope, WorldDefinition } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { CreativeDomain, type CreativeContext, type CreativeScene } from './domain.js';
import { CREATIVE_ORCHESTRATION_STATEMENTS } from './migration.js';
import { CREATIVE_MEMORY_STATEMENTS } from './memory-migration.js';
import { createDefaultCreativeRoles, createDefaultStorySceneWorkflow } from './templates.js';

function fixture() {
  const database = new ServiceDatabase(':memory:');
  for (const sql of [...CREATIVE_ORCHESTRATION_STATEMENTS, ...CREATIVE_MEMORY_STATEMENTS]) database.connection.exec(sql);
  const domain = new CreativeDomain(database), store = domain.creative;
  const definition: WorldDefinition = { title: '记忆港', workNature: 'original', summary: '', timeLabel: '',
    locations: [{ id: 'port', name: '港口', description: '' }],
    actors: ['a', 'b'].map((id) => ({ id, name: id, role: 'main', characterId: null, characterVersion: null,
      background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'port', referenceArtifactIds: [] })),
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '' };
  const world = domain.worlds.create(definition), branch = domain.worlds.createBranch(world.id, { title: '主线', mode: 'alternate', direction: '', expectedRevision: 1 });
  const scope: CreativeScope = { workName: world.title, worldId: world.id, branchId: branch.id, projectId: null };
  const roles = createDefaultCreativeRoles(); for (const role of roles) store.saveRole(role);
  const workflow = store.createWorkflow(createDefaultStorySceneWorkflow()), version = store.publishWorkflow(workflow.id, 1);
  let ordinal = 0;
  const adopt = (changes: Partial<CreativeScene> = {}, otherScope = scope) => {
    const run = store.startRun({ workflowId: workflow.id, workflowVersion: version.version, idempotencyKey: 'memory-test-' + ordinal++, scope: otherScope,
      instruction: '下一场景', budget: { maxTextCalls: 10, maxImages: 0, maxTokens: 10000, maxRevisions: 1 }, input: {} }, roles);
    const context = domain.collectCreativeContext(run);
    const contextNode = store.ensureNode(run.id, 'story_context', 0, {}), contextArtifact = store.putArtifact(contextNode.id, 'context', context, []);
    const content = makeScene(context, 'event-' + ordinal, changes);
    const sceneNode = store.ensureNode(run.id, 'story_writer_scene', 0, {}), artifact = store.putArtifact(sceneNode.id, 'scene', content, [contextArtifact.id]);
    const approvalNode = store.ensureNode(run.id, 'story_approval', 0, {}), pending = store.requestApproval(approvalNode.id, [artifact.id]);
    const approval = store.decideApproval(pending.id, { decision: 'approve', expectedRevision: pending.revision, bundleHash: pending.bundleHash, comment: '' });
    return { result: domain.commitCreativeScene(run, artifact, approval), artifact, context };
  };
  return { database, domain, world, branch, scope, adopt };
}
function makeScene(context: CreativeContext, id: string, changes: Partial<CreativeScene> = {}): CreativeScene {
  const tick = context.base.currentTick! + 1;
  return { schemaVersion: 1, title: '码头', body: '角色在码头等待。', contextHash: context.contextHash, scope: context.scope, base: context.base,
    speculation: null, directionApprovalId: null, sourceRefs: context.sources.map((item) => item.id), newSettings: [], foreshadowing: [],
    simulation: { tick, events: [{ id, worldId: context.scope.worldId!, branchId: context.scope.branchId!, tick, duration: 0, title: '等待', summary: '甲独自在码头等待。',
      locationId: 'port', participantIds: ['a'], facts: [{ id: 'fact-' + id, content: '秘密-' + id, knownBy: ['a'], nature: 'ai' }],
      perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-01-01T00:00:00Z' }],
      states: [], memories: [], supportingActors: [], consumedInterventionIds: [] }, ...changes };
}

test('every confirmed event writer indexes facts, retrieval remains bounded and respects actor and branch knowledge', () => {
  const f = fixture();
  try {
    f.database.transaction(() => {
      const insert = f.database.connection.prepare('INSERT INTO sw_events(id,world_id,branch_id,tick,duration,location_id,data_json,created_at) VALUES (?,?,?,?,?,?,?,?)');
      const context = f.domain.collectScopeContext(f.scope);
      for (let index = 0; index < 5100; index++) {
        const content = makeScene(context, 'bulk-' + index);
        const event = content.simulation!.events[0];
        event.facts[0].nature = index === 0 ? 'canon' : 'ai';
        insert.run(event.id, f.world.id, f.branch.id, 1, 0, 'port', JSON.stringify(event), event.createdAt);
      }
      f.database.connection.prepare('UPDATE sw_branches SET current_tick=1,revision=revision+1 WHERE id=?').run(f.branch.id);
    });
    const facts = f.domain.memory.readFacts(f.scope, { actorId: 'a', limit: 20 });
    assert.equal(facts.total, 5100); assert.equal(facts.items.length, 20); assert.equal(facts.nextOffset, 20);
    assert.equal(f.domain.memory.readFacts(f.scope, { actorId: 'b' }).total, 0);
    assert.equal(f.domain.memory.readFacts(f.scope, { nature: 'canon' }).total, 1);
    const context = f.domain.collectScopeContext(f.scope);
    assert.ok(JSON.stringify(context).length < 180000);
    assert.equal((context.data.world as { longTerm: { coverage: { factsStored: number } } }).longTerm.coverage.factsStored, 5100);
    const other = f.domain.worlds.createBranch(f.world.id, { title: '平行', mode: 'alternate', direction: '', expectedRevision: 1 });
    assert.equal(f.domain.memory.readFacts({ ...f.scope, branchId: other.id }).total, 0);
    const fork = f.domain.worlds.createBranch(f.world.id, { title: '从过去分叉', mode: 'alternate', direction: '', expectedRevision: 1, parentBranchId: f.branch.id, forkTick: 1 });
    assert.equal(f.domain.memory.readFacts({ ...f.scope, branchId: fork.id }, { actorId: 'a' }).total, 5100);
  } finally { f.database.close(); }
});

test('adopted settings and foreshadowing have immutable versions, reject unknown resolutions and stay in their own branch', () => {
  const f = fixture();
  try {
    const refs = f.domain.collectScopeContext(f.scope).sources.map((item) => item.id);
    assert.throws(() => f.adopt({ foreshadowing: [{ id: 'missing', action: 'resolve', title: '未知伏笔', detail: '试图收束未知伏笔。', sourceRefs: refs }] }), { code: 'creative_thread_missing' });
    assert.throws(() => f.adopt({ newSettings: [{ id: 'rule', title: '新规则', content: '内容', sourceRefs: ['outside'] }] }), { code: 'creative_memory_source' });
    const opened = f.adopt({ newSettings: [{ id: 'rule', title: '钟声', content: '每日晨间钟声响起。', sourceRefs: refs }],
      foreshadowing: [{ id: 'letter', action: 'open', title: '未拆的信', detail: '信上有陌生印章。', sourceRefs: refs }] });
    assert.equal(f.domain.memory.readEntries(f.scope, { kind: 'setting' }).items[0].sourceHash, opened.artifact.contentHash);
    assert.equal(f.domain.memory.readEntries(f.scope, { kind: 'foreshadowing' }).items[0].revision, 1);
    const nextRefs = f.domain.collectScopeContext(f.scope).sources.map((item) => item.id);
    f.adopt({ foreshadowing: [{ id: 'letter', action: 'advance', title: '未拆的信', detail: '发现印章属于旧友。', sourceRefs: nextRefs }] });
    const resolutionRefs = f.domain.collectScopeContext(f.scope).sources.map((item) => item.id);
    f.adopt({ foreshadowing: [{ id: 'letter', action: 'resolve', title: '信的答案', detail: '旧友现身解释信件。', sourceRefs: resolutionRefs }] });
    const resolved = f.domain.memory.readEntries(f.scope, { kind: 'foreshadowing' }).items[0];
    assert.equal(resolved.revision, 3); assert.equal(resolved.status, 'resolved');
    assert.equal(Number(f.database.connection.prepare("SELECT COUNT(*) n FROM co_memory_entry_versions WHERE id='letter'").get()!.n), 3);
    assert.throws(() => f.database.connection.exec("UPDATE co_memory_entry_versions SET revision=99 WHERE id='letter'"), /immutable/);
    const branch = f.domain.worlds.createBranch(f.world.id, { title: '平行', mode: 'alternate', direction: '', expectedRevision: 1 });
    const scope = { ...f.scope, branchId: branch.id };
    assert.equal(f.domain.memory.readEntries(scope, { kind: 'foreshadowing' }).total, 0);
    assert.throws(() => f.adopt({ foreshadowing: [{ id: 'letter', action: 'resolve', title: '信', detail: '试图使用其他时间线伏笔。', sourceRefs: f.domain.collectScopeContext(scope).sources.map((item) => item.id) }] }, scope), { code: 'creative_thread_missing' });
  } finally { f.database.close(); }
});

test('every twenty adopted scenes create an immutable extractive batch with source hashes, and failure rolls memory back', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 19; index++) f.adopt();
    assert.equal(f.domain.memory.digests(f.scope).total, 0);
    f.database.connection.exec("CREATE TEMP TRIGGER reject_digest BEFORE INSERT ON co_memory_digests BEGIN SELECT RAISE(ABORT,'fixture digest failure'); END");
    assert.throws(() => f.adopt(), /fixture digest failure/);
    assert.equal(f.domain.memory.readFacts(f.scope).total, 19);
    assert.equal(f.domain.worlds.getBranch(f.world.id, f.branch.id).currentTick, 19);
    f.database.connection.exec('DROP TRIGGER reject_digest');
    f.adopt();
    const page = f.domain.memory.digests(f.scope);
    assert.equal(page.total, 1); assert.equal(page.items[0].batch, 1);
    const digest = page.items[0].content as { scenes: Array<{ artifactId: string; sourceHash: string }>; coverage: { batchScenes: number } };
    assert.equal(digest.scenes.length, 20); assert.equal(digest.coverage.batchScenes, 20);
    assert.ok(digest.scenes.every((item) => item.artifactId && item.sourceHash.length === 64));
    assert.throws(() => f.database.connection.exec("UPDATE co_memory_digests SET content_json='{}'"), /immutable/);
    assert.equal(f.domain.memory.readFacts(f.scope, { actorId: 'a' }).total, 20);
    assert.equal(f.domain.memory.readFacts(f.scope, { actorId: 'b' }).total, 0);
  } finally { f.database.close(); }
});

test('historical forks freeze settings and unresolved threads at fork tick, then evolve independently', () => {
  const f = fixture();
  try {
    const refs = f.domain.collectScopeContext(f.scope).sources.map((item) => item.id);
    f.adopt({ newSettings: [{ id: 'bell', title: '晨钟', content: '旧钟每天响起。', sourceRefs: refs }],
      foreshadowing: [{ id: 'letter', action: 'open', title: '密信', detail: '尚不清楚寄信人。', sourceRefs: refs }] });
    const first = f.domain.worlds.createBranch(f.world.id, { title: '分叉', mode: 'alternate', direction: '', expectedRevision: 1, parentBranchId: f.branch.id, forkTick: 1 });
    const firstScope = { ...f.scope, branchId: first.id };
    assert.equal(f.domain.memory.readEntries(firstScope, { kind: 'setting' }).items[0].id, 'bell');
    const frozen = f.domain.memory.readEntries(firstScope, { kind: 'foreshadowing' }).items[0];
    assert.equal(frozen.status, 'open'); assert.equal(frozen.revision, 1);
    f.adopt({ foreshadowing: [{ id: 'letter', action: 'resolve', title: '密信答案', detail: '父线已确认寄信人。', sourceRefs: f.domain.collectScopeContext(f.scope).sources.map((item) => item.id) }] });
    assert.deepEqual(f.domain.memory.readEntries(firstScope, { kind: 'foreshadowing' }).items[0], frozen);
    const past = f.domain.worlds.createBranch(f.world.id, { title: '事后从旧时刻分叉', mode: 'alternate', direction: '', expectedRevision: 1, parentBranchId: f.branch.id, forkTick: 1 });
    assert.equal(f.domain.memory.readEntries({ ...f.scope, branchId: past.id }, { kind: 'foreshadowing' }).items[0].status, 'open');
    f.adopt({ foreshadowing: [{ id: 'letter', action: 'advance', title: '密信新线索', detail: '子线只发现一枚指纹。', sourceRefs: f.domain.collectScopeContext(firstScope).sources.map((item) => item.id) }] }, firstScope);
    const advanced = f.domain.memory.readEntries(firstScope, { kind: 'foreshadowing' }).items[0];
    assert.equal(advanced.status, 'open'); assert.equal(advanced.revision, 2); assert.ok(advanced.content.includes('指纹'));
    assert.equal(f.domain.memory.readEntries(f.scope, { kind: 'foreshadowing' }).items[0].status, 'resolved');
    const nested = f.domain.worlds.createBranch(f.world.id, { title: '子线再分叉', mode: 'alternate', direction: '', expectedRevision: 1, parentBranchId: first.id, forkTick: 2 });
    assert.deepEqual(f.domain.memory.readEntries({ ...f.scope, branchId: nested.id }, { kind: 'foreshadowing' }).items[0], advanced);
    assert.throws(() => f.database.connection.exec("UPDATE co_memory_branch_snapshots SET revision=9"), /immutable/);
  } finally { f.database.close(); }
});

test('memory migration backfills existing confirmed events without changing their source rows', () => {
  const f = fixture();
  try {
    f.adopt();
    const before = f.database.connection.prepare('SELECT data_json FROM sw_events').get()!.data_json;
    // Recreate only the derived index in an isolated in-memory database to exercise the upgrade path.
    f.database.connection.exec('DROP TRIGGER co_memory_index_event');
    f.database.connection.exec('DROP TABLE co_memory_facts');
    for (const sql of CREATIVE_MEMORY_STATEMENTS) f.database.connection.exec(sql);
    assert.equal(f.domain.memory.readFacts(f.scope, { actorId: 'a' }).total, 1);
    assert.equal(f.domain.memory.readFacts(f.scope, { actorId: 'b' }).total, 0);
    assert.equal(f.database.connection.prepare('SELECT data_json FROM sw_events').get()!.data_json, before);
    assert.deepEqual(f.database.connection.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.database.close(); }
});
