import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreativeRun, CreativeScope, WorldDefinition } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { CreativeDomain } from './domain.js';
import { augmentCreativeContext, creativeEvidenceKeywords, mergeCreativeEvidence, readCreativeEvidence } from './retrieval.js';
import { creativeHash } from './store.js';
import { createDefaultCreativeRoles, createDefaultStorySceneWorkflow } from './templates.js';
import type { CreativeScene } from './scene-schema.js';

function fixture() {
  const database = new ServiceDatabase(':memory:'), domain = new CreativeDomain(database);
  const definition: WorldDefinition = { title: '检索世界', summary: '', timeLabel: '', workNature: 'original',
    locations: [{ id: 'old', name: '旧港', description: '' }, { id: 'now', name: '新港', description: '' }],
    actors: ['a', 'b'].map((id) => ({ id, name: id, role: 'main', characterId: null, characterVersion: null,
      background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'now', referenceArtifactIds: [] })),
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '' };
  const world = domain.worlds.create(definition), branch = domain.worlds.createBranch(world.id, { title: '主线', mode: 'alternate', direction: '', expectedRevision: 1 });
  const scope: CreativeScope = { workName: world.title, worldId: world.id, branchId: branch.id, projectId: null };
  database.transaction(() => {
    const insert = database.connection.prepare('INSERT INTO sw_events(id,world_id,branch_id,tick,duration,location_id,data_json,created_at) VALUES (?,?,?,?,?,?,?,?)');
    for (let index = 0; index < 140; index++) {
      const event = { id: 'e-' + index, worldId: world.id, branchId: branch.id, tick: index + 1, duration: 0, title: '事件', summary: '事件',
        locationId: index === 0 ? 'old' : 'now', participantIds: ['a'],
        facts: [{ id: 'f-' + index, content: index === 0 ? '旧港仓库密码是蓝鸟4721' : '普通事项' + index, knownBy: ['a'], nature: 'ai' }],
        perspectives: [], causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: '2026-01-01T00:00:00Z' };
      insert.run(event.id, world.id, branch.id, event.tick, 0, event.locationId, JSON.stringify(event), event.createdAt);
    }
    database.connection.prepare('UPDATE sw_branches SET current_tick=140,revision=revision+1 WHERE id=?').run(branch.id);
  });
  return { database, domain, world, branch, scope };
}

test('short Chinese keywords and exact quotes retrieve older relevant facts without returning other actor secrets', () => {
  const f = fixture();
  try {
    assert.ok(creativeEvidenceKeywords('请让甲回忆旧港仓库密码然后继续。').includes('密码'));
    assert.equal(creativeEvidenceKeywords('调查“蓝鸟4721”这条线索')[0], '蓝鸟4721');
    const context = f.domain.collectScopeContext(f.scope, { actorIds: ['a'] });
    assert.equal(JSON.stringify(context).includes('蓝鸟4721'), false);
    const run = { scope: f.scope, instruction: '请让甲回忆旧港仓库密码然后继续。' } as CreativeRun;
    const augmented = augmentCreativeContext(f.domain, run, context);
    assert.equal(JSON.stringify(augmented).includes('蓝鸟4721'), true);
    assert.notEqual(augmented.contextHash, context.contextHash);
    const { contextHash, ...payload } = augmented;
    assert.equal(creativeHash(payload), contextHash);
    assert.ok(augmented.sources.some((source) => source.id.startsWith('evidence:')));
    assert.deepEqual(f.domain.collectScopeContext(f.scope, { actorIds: ['a'], instruction: run.instruction }), augmented);
    const manual = f.domain.collectScopeContext(f.scope, { actorIds: ['a'], instruction: '继续。', evidenceQueries: ['蓝鸟4721'] });
    assert.equal(JSON.stringify(manual).includes('蓝鸟4721'), true);
    assert.throws(() => f.domain.collectScopeContext(f.scope, { evidenceQueries: ['一', '二', '三', '四'] }), { code: 'creative_evidence_queries' });
    assert.equal(readCreativeEvidence(f.domain, f.scope, { kind: 'facts', query: '密码', actorId: 'b' }).total, 0);
    assert.equal(readCreativeEvidence(f.domain, f.scope, { kind: 'facts', query: '密码', actorId: 'a' }).knowledgeScope, 'actor');
    assert.equal(readCreativeEvidence(f.domain, f.scope, { kind: 'facts', query: '密码' }).knowledgeScope, 'director-world');
    assert.throws(() => readCreativeEvidence(f.domain, f.scope, { kind: 'entries', query: '密码', actorId: 'a' }), { code: 'creative_evidence_knowledge_scope' });
    assert.equal(Number(f.database.connection.prepare('SELECT COUNT(*) count FROM co_artifacts').get()!.count), 0);
  } finally { f.database.close(); }
});

test('evidence pages remain bounded, scoped, versioned and tamper-evident', () => {
  const f = fixture();
  try {
    const context = f.domain.collectScopeContext(f.scope), evidence = readCreativeEvidence(f.domain, f.scope, { kind: 'facts', query: '普通事项', actorId: 'a' });
    assert.equal(evidence.items.length, 20); assert.equal(evidence.total, 139); assert.equal(evidence.nextOffset, 20);
    assert.ok(JSON.stringify(evidence).length < 24000);
    const merged = mergeCreativeEvidence(context, evidence);
    assert.deepEqual(mergeCreativeEvidence(merged, evidence), merged);
    assert.throws(() => mergeCreativeEvidence(context, { ...evidence, total: 1000 }), { code: 'creative_evidence_hash' });
    const other = f.domain.worlds.createBranch(f.world.id, { title: '平行线', mode: 'alternate', direction: '', expectedRevision: 1 });
    const otherScope = { ...f.scope, branchId: other.id };
    const foreign = readCreativeEvidence(f.domain, otherScope, { kind: 'facts', query: '普通事项' });
    assert.equal(foreign.total, 0);
    assert.throws(() => mergeCreativeEvidence(context, foreign), { code: 'creative_evidence_scope' });
    f.domain.worlds.commitStep(f.world.id, f.branch.id, context.base.branchRevision!, { tick: 141, events: [], states: [], memories: [], consumedInterventionIds: [] });
    const updated = readCreativeEvidence(f.domain, f.scope, { kind: 'facts', query: '普通事项' });
    assert.throws(() => mergeCreativeEvidence(context, updated), { code: 'creative_evidence_revision' });
  } finally { f.database.close(); }
});

test('deterministic augmentation returns no more than twenty facts and never writes a run or source row', () => {
  const f = fixture();
  try {
    const context = f.domain.collectScopeContext(f.scope), run = { scope: f.scope, instruction: '查找“普通事项”和“旧港”' } as CreativeRun;
    const result = augmentCreativeContext(f.domain, run, context);
    const evidence = result.data.retrievedEvidence as Array<{ items: unknown[] }>;
    assert.equal(evidence.reduce((sum, item) => sum + item.items.length, 0), 20);
    assert.deepEqual(augmentCreativeContext(f.domain, run, context), result);
    assert.equal(Number(f.database.connection.prepare('SELECT COUNT(*) count FROM co_runs').get()!.count), 0);
    assert.equal(Number(f.database.connection.prepare('SELECT COUNT(*) count FROM sw_events').get()!.count), 140);
  } finally { f.database.close(); }
});

test('a persisted run freezes retrieved evidence as original context and adopts a scene citing that evidence', () => {
  const f = fixture();
  try {
    const roles = createDefaultCreativeRoles();
    for (const role of roles) f.domain.creative.saveRole(role);
    const workflow = f.domain.creative.createWorkflow(createDefaultStorySceneWorkflow());
    const version = f.domain.creative.publishWorkflow(workflow.id, workflow.revision);
    const run = f.domain.creative.startRun({ workflowId: workflow.id, workflowVersion: version.version, idempotencyKey: 'retrieval-adoption',
      scope: f.scope, instruction: '请让甲回忆旧港仓库密码然后继续。', input: { contextSelection: { actorIds: ['a'] } },
      budget: { maxTextCalls: 10, maxImages: 0, maxTokens: 100000, maxRevisions: 1 } }, roles);
    const context = f.domain.collectCreativeContext(run);
    assert.equal(JSON.stringify(context).includes('蓝鸟4721'), true);
    assert.deepEqual(context, f.domain.collectScopeContext(run.scope, { actorIds: ['a'], instruction: run.instruction }));
    const contextNode = f.domain.creative.ensureNode(run.id, 'story_context', 0, {});
    const contextArtifact = f.domain.creative.putArtifact(contextNode.id, 'context', context, []);
    const source = context.sources.find((item) => item.id.startsWith('evidence:'))!;
    const scene: CreativeScene = { schemaVersion: 1, title: '回忆密码', body: '甲想起旧港仓库密码是蓝鸟4721，决定前往仓库。',
      scope: run.scope, base: context.base, contextHash: context.contextHash, sourceRefs: [source.id], speculation: null, directionApprovalId: null,
      simulation: { tick: 141, events: [{ id: 'recalled', worldId: f.world.id, branchId: f.branch.id, tick: 141, duration: 0,
        title: '想起密码', summary: '甲回忆自己已知的密码。', locationId: 'now', participantIds: ['a'], facts: [], perspectives: [],
        causeEventIds: ['e-0'], storyLineIds: [], stateChanges: [], createdAt: '2026-01-01T00:00:00Z' }],
        states: [], memories: [], supportingActors: [], consumedInterventionIds: [] } };
    const sceneNode = f.domain.creative.ensureNode(run.id, 'story_writer_scene', 0, {});
    const artifact = f.domain.creative.putArtifact(sceneNode.id, 'scene', scene, [contextArtifact.id]);
    const approvalNode = f.domain.creative.ensureNode(run.id, 'story_approval', 0, {});
    const pending = f.domain.creative.requestApproval(approvalNode.id, [artifact.id]);
    const approval = f.domain.creative.decideApproval(pending.id, { decision: 'approve', expectedRevision: pending.revision, bundleHash: pending.bundleHash, comment: '' });
    const result = f.domain.commitCreativeScene(run, artifact, approval);
    assert.deepEqual(result.eventIds, ['recalled']);
    assert.equal(f.domain.worlds.getBranch(f.world.id, f.branch.id).currentTick, 141);
  } finally { f.database.close(); }
});
