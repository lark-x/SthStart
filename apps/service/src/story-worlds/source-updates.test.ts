import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import type { WorldDefinition, WorldEvent } from '@sthstart/contracts';
import { WorldSourceUpdatePreviewSchema } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import { registerStoryWorldRoutes, type WorldRouteServices } from './routes.js';
import { diffWorldDefinitions, StoryWorldSourceUpdates } from './source-updates.js';
import { StoryWorldError, StoryWorldStore } from './store.js';

const at = '2026-01-01T00:00:00.000Z';
const root = '/api/v1/admin/story-worlds';
const headers = { 'x-sthstart-admin-token': 'world-route-test-secret' };

function definition(): WorldDefinition {
  return {
    title: '港口旧事',
    summary: '新版资料到来前的来源测试。',
    timeLabel: '入冬',
    locations: [
      { id: 'loc-harbor', name: '港口', description: '潮声不断。' },
      { id: 'loc-tea', name: '茶室', description: '午后安静。' },
    ],
    actors: [
      {
        id: 'actor-a', name: '甲', role: 'main', characterId: 'char-1', characterVersion: 2,
        background: '旧背景。', personality: '谨慎。', speechStyle: '简短。', appearance: '深色外套。',
        goals: ['照看港口'], locationId: 'loc-harbor', referenceArtifactIds: [],
      },
      {
        id: 'actor-b', name: '乙', role: 'supporting', characterId: null, characterVersion: null,
        background: '旧人物。', personality: '直率。', speechStyle: '语速快。', appearance: '浅色围巾。',
        goals: ['拜访旧友'], locationId: 'loc-tea', referenceArtifactIds: [],
      },
    ],
    sources: [
      {
        id: 'source-canon', title: '原作港口描写', nature: 'canon', content: '第一版资料。',
        sourceUrl: '', sourceVersion: '1.0', capturedAt: at,
      },
      {
        id: 'source-author', title: '作者补记', nature: 'author', content: '作者补记。',
        sourceUrl: 'https://example.test/author', sourceVersion: '1.0', capturedAt: at,
      },
      {
        id: 'source-stable', title: '稳定链接资料', nature: 'canon', content: '链接稳定。',
        sourceUrl: 'https://example.test/stable', sourceVersion: '1.0', capturedAt: at,
      },
    ],
    lockedFacts: [],
    models: { action: null, adjudication: null, narration: null },
    visualStyle: '水墨。',
  };
}

function addCharacter(database: ServiceDatabase) {
  database.connection.prepare(`INSERT INTO character_profiles
    (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'char-1', 'char-1', '来源角色', '{"name":"来源角色"}', '[]', null, 2, 0, at, at,
  );
  database.connection.prepare(`INSERT INTO character_versions
    (character_id,version,data_json,compiled_linshe_prompt,relationships_json,created_at)
    VALUES (?,?,?,?,?,?)`).run('char-1', 2, '{"name":"来源角色"}', 'prompt-v2', '[]', at);
}

function fixture() {
  const database = new ServiceDatabase();
  addCharacter(database);
  const store = new StoryWorldStore(database);
  const initial = definition();
  const world = store.create(initial);
  const branch = store.createBranch(world.id, {
    title: '主线', mode: 'canon-gap', direction: '', expectedRevision: world.revision,
  });
  const side = store.createBranch(world.id, {
    title: '另一分支', mode: 'alternate', direction: '', expectedRevision: world.revision,
  });
  return { database, store, initial, world, branch, side };
}

function beforeUpdateEvent(worldId: string, branchId: string): WorldEvent {
  return {
    id: 'event-before-update', worldId, branchId, tick: 15, duration: 0,
    title: '更新前的事件', summary: '这次事件必须原样保留。', locationId: 'loc-harbor',
    participantIds: ['actor-a', 'actor-b'], facts: [], perspectives: [],
    causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: at,
  };
}

test('preview compares actors, sources and locations, preserves history and reports only importable character versions', () => {
  const f = fixture();
  try {
    const event = beforeUpdateEvent(f.world.id, f.branch.id);
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 15, events: [event], memories: [], states: [], consumedInterventionIds: [],
    });

    f.database.connection.prepare(`INSERT INTO character_versions
      (character_id,version,data_json,compiled_linshe_prompt,relationships_json,created_at)
      VALUES (?,?,?,?,?,?)`).run('char-1', 3, '{"name":"来源角色","locked":2}', 'prompt-v3', '[]', at);
    f.database.connection.prepare('UPDATE character_profiles SET latest_version=3 WHERE id=?').run('char-1');

    const next = structuredClone(f.initial);
    next.locations = [
      { id: 'loc-harbor', name: '旧港口', description: '潮声不断。' },
      { id: 'loc-new', name: '新码头', description: '刚修好的码头。' },
    ];
    next.actors = [
      {
        ...f.initial.actors[0], background: '更新后的背景。',
      },
      {
        id: 'actor-c', name: '丙', role: 'main', characterId: null, characterVersion: null,
        background: '新人物。', personality: '沉稳。', speechStyle: '缓慢。', appearance: '灰色长衣。',
        goals: ['熟悉新码头'], locationId: 'loc-new', referenceArtifactIds: [],
      },
    ];
    next.sources = [
      {
        ...f.initial.sources[0], content: '第二版资料。', sourceVersion: '1.1',
      },
      {
        id: 'source-new', title: '新补记', nature: 'unverified', content: '待核实的新资料。',
        sourceUrl: '', sourceVersion: '0.1', capturedAt: at,
      },
      f.initial.sources[2],
    ];
    next.title = '港口旧事（新版）';
    next.summary = '更新后的世界摘要。';
    next.timeLabel = '深冬';
    next.lockedFacts = ['新的锁定设定。'];
    next.models = { action: 'model-action', adjudication: 'model-adjudication', narration: 'model-narration' };
    next.visualStyle = '新版水墨。';
    f.store.updateWorld(f.world.id, { expectedRevision: f.world.revision, definition: next });

    const beforePreview = f.store.definition(f.world.id, f.branch.id);
    const service = new StoryWorldSourceUpdates(f.store);
    const preview = service.preview(f.world.id, f.branch.id);
    assert.ok(Value.Check(WorldSourceUpdatePreviewSchema, preview));
    assert.equal(preview.historyPreserved, true);
    assert.equal(preview.currentBranchPending, true);
    assert.deepEqual(preview.counts, { added: 3, modified: 4, removed: 3 });
    assert.equal(preview.changes.length, 10);

    const findChange = (kind: string, id: string, change: string) => preview.changes.find(
      (item) => item.kind === kind && item.id === id && item.change === change,
    );
    const actorA = findChange('actor', 'actor-a', 'modified');
    assert.ok(actorA);
    assert.equal(actorA.fields.find((field) => field.field === 'background')?.after, '更新后的背景。');
    assert.match(findChange('actor', 'actor-b', 'removed')?.note ?? '', /分支独有角色会保留/);
    assert.match(findChange('location', 'loc-tea', 'removed')?.note ?? '', /分支独有地点会保留/);
    assert.match(findChange('source', 'source-author', 'removed')?.note ?? '', /来源列表移除/);
    assert.equal(findChange('source', 'source-canon', 'modified')?.fields.find((field) => field.field === 'content')?.after, '第二版资料。');
    const worldChange = findChange('world', 'world', 'modified');
    assert.ok(worldChange);
    assert.deepEqual(
      worldChange.fields.map((item) => item.field).sort(),
      ['lockedFacts', 'models', 'summary', 'timeLabel', 'title', 'visualStyle'].sort(),
    );
    assert.equal(worldChange.fields.find((field) => field.field === 'lockedFacts')?.after, '新的锁定设定。');
    assert.match(worldChange.note, /既有事件、正文、记忆和人物状态不改写/);

    assert.deepEqual(preview.affectedBranches.map((item) => item.branchId).sort(), [f.branch.id, f.side.id].sort());
    assert.equal(preview.affectedBranches.find((item) => item.branchId === f.branch.id)?.isCurrent, true);
    for (const branch of preview.affectedBranches) {
      assert.deepEqual(branch.counts, { added: 3, modified: 4, removed: 3 });
    }

    assert.equal(preview.characterVersionUpdates.length, 1);
    assert.equal(preview.characterVersionUpdates[0].fromVersion, 2);
    assert.equal(preview.characterVersionUpdates[0].latestVersion, 3);
    assert.equal(preview.characterVersionUpdates[0].canImport, true);
    assert.match(preview.characterVersionUpdates[0].note, /不会自动覆盖/);
    assert.equal(f.store.getWorld(f.world.id).actors.find((actor) => actor.id === 'actor-a')?.characterVersion, 2);
    assert.deepEqual(f.store.definition(f.world.id, f.branch.id), beforePreview, 'preview must not mutate the branch');

    assert.equal(preview.sourceSnapshotNotices.length, 2);
    assert.ok(preview.sourceSnapshotNotices.every((notice) => notice.reason === 'no-stable-link'));
    assert.equal(preview.sourceSnapshotNotices.some((notice) => notice.sourceId === 'source-stable'), false);
    assert.ok(preview.sourceSnapshotNotices.every((notice) => /不能据此确认原文已刷新/.test(notice.note)));

    const refreshed = f.store.refreshSources(f.world.id, f.branch.id, preview.branchRevision, preview.worldRevision);
    assert.equal(refreshed.sourceUpdatesAvailable, false);
    assert.equal(refreshed.definition.sources.some((source) => source.id === 'source-author'), false);
    assert.equal(refreshed.definition.sources.some((source) => source.id === 'source-new'), true);
    assert.equal(refreshed.definition.actors.some((actor) => actor.id === 'actor-b'), true, 'branch-only actor is retained');
    assert.equal(refreshed.definition.actors.find((actor) => actor.id === 'actor-a')?.background, '更新后的背景。');
    assert.equal(refreshed.definition.title, '港口旧事（新版）');
    assert.equal(refreshed.definition.summary, '更新后的世界摘要。');
    assert.deepEqual(refreshed.definition.lockedFacts, ['新的锁定设定。']);
    assert.deepEqual(refreshed.definition.models, next.models);
    assert.equal(refreshed.definition.visualStyle, '新版水墨。');
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).items[0].summary, event.summary);
    assert.equal(f.store.getWorld(f.world.id).actors.find((actor) => actor.id === 'actor-a')?.characterVersion, 2);
  } finally {
    f.database.close();
  }
});

test('refresh rejects a world updated after preview and leaves the branch unchanged', () => {
  const f = fixture();
  try {
    const event = beforeUpdateEvent(f.world.id, f.branch.id);
    f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 15, events: [event], memories: [], states: [], consumedInterventionIds: [],
    });
    const service = new StoryWorldSourceUpdates(f.store);
    const preview = service.preview(f.world.id, f.branch.id);
    const branchBefore = f.store.getBranch(f.world.id, f.branch.id);
    const definitionBefore = f.store.definition(f.world.id, f.branch.id);

    const next = structuredClone(f.initial);
    next.startMinuteOfDay = 420;
    next.visualReferences = [{
      id: 'ref-night-harbor', name: '夜色码头', kind: 'location', locationId: 'loc-harbor',
      description: '预览之后才加入的场景参考。', referenceArtifactIds: [],
    }];
    const updatedWorld = f.store.updateWorld(f.world.id, {
      expectedRevision: f.world.revision,
      definition: next,
    });
    assert.throws(
      () => f.store.refreshSources(f.world.id, f.branch.id, preview.branchRevision, preview.worldRevision),
      (error: unknown) => error instanceof StoryWorldError
        && error.statusCode === 409
        && error.code === 'story_world_revision_conflict',
    );

    const branchAfter = f.store.getBranch(f.world.id, f.branch.id);
    assert.deepEqual(branchAfter, branchBefore);
    assert.equal(branchAfter.sourceRevision, preview.branchSourceRevision);
    assert.deepEqual(f.store.definition(f.world.id, f.branch.id), definitionBefore);
    assert.equal(f.store.events(f.world.id, f.branch.id, {}).items[0].summary, event.summary);

    const refreshed = f.store.refreshSources(f.world.id, f.branch.id, preview.branchRevision);
    assert.equal(refreshed.branch.sourceRevision, updatedWorld.revision);
    assert.equal(refreshed.definition.startMinuteOfDay, 420);
    assert.equal(refreshed.definition.visualReferences?.[0]?.name, '夜色码头');
  } finally {
    f.database.close();
  }
});

test('a world settings-only update is visible instead of reporting zero changes', () => {
  const f = fixture();
  try {
    const next = structuredClone(f.initial);
    next.lockedFacts = ['只有锁定设定发生变化。'];
    next.models = { action: 'model-only-action', adjudication: null, narration: null };
    next.startMinuteOfDay = 390;
    f.store.updateWorld(f.world.id, { expectedRevision: f.world.revision, definition: next });

    const preview = new StoryWorldSourceUpdates(f.store).preview(f.world.id, f.branch.id);
    assert.deepEqual(preview.counts, { added: 0, modified: 1, removed: 0 });
    assert.equal(preview.changes.length, 1);
    const [worldChange] = preview.changes;
    assert.equal(worldChange.kind, 'world');
    assert.deepEqual(
      worldChange.fields.map((item) => item.field).sort(),
      ['lockedFacts', 'models', 'startMinuteOfDay'],
    );
    assert.equal(worldChange.fields.find((item) => item.field === 'lockedFacts')?.after, '只有锁定设定发生变化。');
    const startMinute = worldChange.fields.find((item) => item.field === 'startMinuteOfDay');
    assert.equal(startMinute?.label, '世界起点的日内分钟');
    assert.equal(startMinute?.before, '（未定义）');
    assert.equal(startMinute?.after, '390 分钟（06:30）');
  } finally {
    f.database.close();
  }
});

test('visual references are preserved as preview differences', () => {
  const before: WorldDefinition = {
    ...definition(),
    visualReferences: [{
      id: 'scene-1', name: '旧场景参考', kind: 'location', locationId: 'loc-harbor',
      description: '旧描述。', referenceArtifactIds: [],
    }],
  };
  const after: WorldDefinition = {
    ...definition(),
    visualReferences: [{
      id: 'scene-1', name: '新场景参考', kind: 'location', locationId: 'loc-harbor',
      description: '新描述。', referenceArtifactIds: [],
    }],
  };

  const changes = diffWorldDefinitions(before, after);
  const worldChange = changes.find((change) => change.kind === 'world');
  assert.ok(worldChange);
  assert.deepEqual(worldChange.fields.map((item) => item.field), ['visualReferences']);
  assert.equal(worldChange.fields[0].label, '场景与道具参考');
  assert.match(worldChange.fields[0].after, /新场景参考/);
});

test('source update preview route validates auth, world scope and response schema', async () => {
  const f = fixture();
  const app = Fastify();
  const unused = () => { throw new Error('Not invoked in this route test'); };
  const services: WorldRouteServices = {
    store: f.store,
    runtime: { start: unused, pause: unused, resume: unused },
    images: { plan: unused, submit: unused },
    adopt: unused,
  };
  registerStoryWorldRoutes(app, { adminToken: headers['x-sthstart-admin-token'] } as ServiceConfig, services);
  try {
    const path = `${root}/${f.world.id}/branches/${f.branch.id}/sources/preview`;
    assert.equal((await app.inject({ url: path })).statusCode, 401);
    const response = await app.inject({ url: path, headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(Value.Check(WorldSourceUpdatePreviewSchema, response.json()));
    const preview = response.json();
    assert.equal(preview.branchId, f.branch.id);

    const refreshPath = `${root}/${f.world.id}/branches/${f.branch.id}/sources/refresh`;
    const next = structuredClone(f.initial);
    next.summary = '路由预览之后更新的摘要。';
    const updatedWorld = f.store.updateWorld(f.world.id, {
      expectedRevision: f.world.revision,
      definition: next,
    });
    const staleRefresh = await app.inject({
      method: 'POST',
      url: refreshPath,
      headers,
      payload: {
        expectedRevision: preview.branchRevision,
        expectedWorldRevision: preview.worldRevision,
      },
    });
    assert.equal(staleRefresh.statusCode, 409, staleRefresh.body);
    assert.equal(staleRefresh.json().error, 'story_world_revision_conflict');
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).revision, preview.branchRevision);

    const legacyRefresh = await app.inject({
      method: 'POST',
      url: refreshPath,
      headers,
      payload: { expectedRevision: preview.branchRevision },
    });
    assert.equal(legacyRefresh.statusCode, 200, legacyRefresh.body);
    assert.equal(legacyRefresh.json().branch.sourceRevision, updatedWorld.revision);

    assert.equal((await app.inject({
      url: `${root}/missing-world/branches/${f.branch.id}/sources/preview`,
      headers,
    })).statusCode, 404);
    assert.equal((await app.inject({
      url: `${root}/${f.world.id}/branches/missing-branch/sources/preview`,
      headers,
    })).statusCode, 404);
  } finally {
    await app.close();
    f.database.close();
  }
});
