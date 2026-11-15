import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  WorldActorPromotionResultSchema, type CharacterDraftV2, type WorldDefinition, type WorldEvent,
} from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import { StoryWorldActorService } from './actors.js';
import { registerStoryWorldActorRoutes } from './actors-routes.js';
import { StoryWorldError, StoryWorldStore } from './store.js';

const at = '2026-01-01T00:00:00.000Z';

function definition(): WorldDefinition {
  return {
    title: '港口的世界', summary: '配角也会成长。', timeLabel: '出航前',
    locations: [{ id: 'port', name: '港口', description: '' }],
    actors: [
      {
        id: 'actor-a', name: '主角甲', role: 'main', characterId: null, characterVersion: null,
        background: '常年在港口。', personality: '谨慎。', speechStyle: '简短。', appearance: '深色外套。',
        goals: [], locationId: 'port', referenceArtifactIds: [],
      },
      {
        id: 'actor-b', name: '配角乙', role: 'supporting', characterId: null, characterVersion: null,
        background: '在码头帮忙的年轻人。', personality: '热心，容易紧张。', speechStyle: '语速快。',
        appearance: '浅色围巾，手上常拿着货单。', goals: ['成为正式船员'],
        locationId: 'port', referenceArtifactIds: [],
      },
    ],
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  };
}

function fixture() {
  const database = new ServiceDatabase(':memory:');
  const store = new StoryWorldStore(database);
  const world = store.create(definition());
  const branch = store.createBranch(world.id, {
    title: '主线', mode: 'canon-gap', direction: '', expectedRevision: world.revision,
  });
  return { database, store, service: new StoryWorldActorService(store), world, branch };
}

function event(worldId: string, branchId: string, id: string, tick: number): WorldEvent {
  return {
    id, worldId, branchId, tick, duration: 0, title: id, summary: '', locationId: 'port',
    participantIds: ['actor-a'], facts: [], perspectives: [], causeEventIds: [], storyLineIds: [],
    stateChanges: [], createdAt: at,
  };
}

function actorById(store: StoryWorldStore, worldId: string, branchId: string, actorId: string) {
  return store.definition(worldId, branchId).actors.find((actor) => actor.id === actorId)!;
}

function insertExistingCard(database: ServiceDatabase) {
  const id = 'existing-card';
  const draft: CharacterDraftV2 = {
    schemaVersion: 2, displayName: '已有卡', englishName: '', aliases: [], originType: 'original',
    work: '原世界', summary: '已有摘要', personaText: '已有正文', speechText: '', dialogueExamples: [],
    behaviorRules: '', appearance: { baseText: '已有外观', defaultOutfitText: '' },
  };
  database.connection.prepare(`INSERT INTO character_profiles
    (id,slug,display_name,draft_json,tags_json,avatar_asset_id,latest_version,archived,created_at,updated_at,draft_revision,variants_json)
    VALUES (?,?,?,?,?,NULL,1,0,?,?,1,'[]')`).run(id, 'existing-card', '已有卡', JSON.stringify(draft), '[]', at, at);
  database.connection.prepare(`INSERT INTO character_versions
    (character_id,version,data_json,compiled_linshe_prompt,created_at,relationships_json,draft_revision,appearance_snapshot_json,provenance_json,compiler_version)
    VALUES (?,1,?,?,?,'[]',1,?,'{}','old')`).run(
    id, JSON.stringify(draft), 'existing prompt', at,
    JSON.stringify({ description: '已有外观', hair: '', eyes: '', build: '', outfits: [], accessories: [] }),
  );
  return { id, draft };
}

test('promoting a supporting actor only changes the current node and leaves historical forks untouched', () => {
  const f = fixture();
  try {
    const committed = f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 30, events: [event(f.world.id, f.branch.id, 'arrival', 30)],
      memories: [], states: [], consumedInterventionIds: [],
    });
    const before = f.store.createBranch(f.world.id, {
      title: '提升前历史', mode: 'adaptation', direction: '',
      expectedRevision: f.world.revision, parentBranchId: f.branch.id, forkTick: 0,
    });
    assert.equal(actorById(f.store, f.world.id, before.id, 'actor-b').role, 'supporting');

    const result = f.service.promote(f.world.id, f.branch.id, 'actor-b', {
      expectedRevision: committed.revision, promoteToMain: true, addToLibrary: false,
    });
    assert.equal(result.promoted, true);
    assert.equal(result.actor.role, 'main');
    assert.equal(result.character, null);
    assert.equal(result.branch.revision, committed.revision + 1);
    assert.equal(result.branch.currentTick, 30);
    assert.equal(actorById(f.store, f.world.id, f.branch.id, 'actor-b').role, 'main');
    assert.equal(actorById(f.store, f.world.id, before.id, 'actor-b').role, 'supporting');

    const past = f.store.createBranch(f.world.id, {
      title: '提升后回看', mode: 'alternate', direction: '',
      expectedRevision: f.world.revision, parentBranchId: f.branch.id, forkTick: 0,
    });
    const node = f.store.createBranch(f.world.id, {
      title: '提升节点', mode: 'canon-gap', direction: '',
      expectedRevision: f.world.revision, parentBranchId: f.branch.id, forkTick: 30,
    });
    assert.equal(actorById(f.store, f.world.id, past.id, 'actor-b').role, 'supporting');
    assert.equal(actorById(f.store, f.world.id, node.id, 'actor-b').role, 'main');
  } finally { f.database.close(); }
});

test('adding a supporting actor to the library creates one source snapshot and repeated promotion stays idempotent', () => {
  const f = fixture();
  try {
    const committed = f.store.commitStep(f.world.id, f.branch.id, f.branch.revision, {
      tick: 30, events: [event(f.world.id, f.branch.id, 'dockside', 30)],
      memories: [], states: [], consumedInterventionIds: [],
    });
    const first = f.service.promote(f.world.id, f.branch.id, 'actor-b', {
      expectedRevision: committed.revision, promoteToMain: true, addToLibrary: true,
      displayName: '码头少年', tags: ['故事世界', '配角'], summary: '从码头成长起来的少年。',
    });
    assert.equal(first.character?.created, true);
    assert.equal(first.character?.version, 1);
    assert.ok(first.character?.characterId);
    assert.ok(first.character?.sourceSnapshotId);
    assert.equal(first.branch.revision, committed.revision + 1);
    assert.equal(actorById(f.store, f.world.id, f.branch.id, 'actor-b').characterId, first.character!.characterId);
    assert.equal(actorById(f.store, f.world.id, f.branch.id, 'actor-b').characterVersion, 1);

    const profileCount = (f.database.connection.prepare('SELECT COUNT(*) AS count FROM character_profiles').get() as { count: number }).count;
    const versionCount = (f.database.connection.prepare('SELECT COUNT(*) AS count FROM character_versions').get() as { count: number }).count;
    const sourceCount = (f.database.connection.prepare("SELECT COUNT(*) AS count FROM character_sources WHERE provider_id='story-worlds'").get() as { count: number }).count;
    const snapshotCount = (f.database.connection.prepare("SELECT COUNT(*) AS count FROM character_source_snapshots WHERE provider_id='story-worlds'").get() as { count: number }).count;
    assert.equal(profileCount, 1);
    assert.equal(versionCount, 1);
    assert.equal(sourceCount, 1);
    assert.equal(snapshotCount, 1);
    const profile = f.database.connection.prepare('SELECT display_name,draft_json FROM character_profiles WHERE id=?').get(first.character!.characterId) as { display_name: string; draft_json: string };
    assert.equal(profile.display_name, '码头少年');
    assert.equal(JSON.parse(profile.draft_json).displayName, '码头少年');

    const again = f.service.promote(f.world.id, f.branch.id, 'actor-b', {
      expectedRevision: committed.revision, promoteToMain: true, addToLibrary: true, displayName: '不应覆盖已有卡',
    });
    assert.equal(again.character?.characterId, first.character?.characterId);
    assert.equal(again.character?.created, false);
    assert.equal(again.branch.revision, first.branch.revision);
    assert.equal((f.database.connection.prepare('SELECT COUNT(*) AS count FROM character_profiles').get() as { count: number }).count, 1);
    assert.equal((f.database.connection.prepare('SELECT COUNT(*) AS count FROM character_versions').get() as { count: number }).count, 1);
    assert.equal((f.database.connection.prepare('SELECT display_name FROM character_profiles WHERE id=?').get(first.character!.characterId) as { display_name: string }).display_name, '码头少年');

    const past = f.store.createBranch(f.world.id, {
      title: '入卡前', mode: 'alternate', direction: '',
      expectedRevision: f.world.revision, parentBranchId: f.branch.id, forkTick: 0,
    });
    const node = f.store.createBranch(f.world.id, {
      title: '入卡节点', mode: 'canon-gap', direction: '',
      expectedRevision: f.world.revision, parentBranchId: f.branch.id, forkTick: 30,
    });
    assert.equal(actorById(f.store, f.world.id, past.id, 'actor-b').characterId, null);
    assert.equal(actorById(f.store, f.world.id, past.id, 'actor-b').role, 'supporting');
    assert.equal(actorById(f.store, f.world.id, node.id, 'actor-b').characterId, first.character!.characterId);
    assert.equal(actorById(f.store, f.world.id, node.id, 'actor-b').role, 'main');
  } finally { f.database.close(); }
});

test('an active run blocks cast changes and rolls back any newly created card', () => {
  const f = fixture();
  try {
    f.database.connection.prepare(`INSERT INTO sw_runs
      (id,world_id,branch_id,status,data_json,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('active-run', f.world.id, f.branch.id, 'running', '{}', null, at, at);
    assert.throws(() => f.service.promote(f.world.id, f.branch.id, 'actor-b', {
      expectedRevision: f.branch.revision, promoteToMain: true, addToLibrary: true,
    }), (error: unknown) => error instanceof StoryWorldError
      && error.code === 'story_run_conflict' && error.statusCode === 409);
    assert.equal((f.database.connection.prepare('SELECT COUNT(*) AS count FROM character_profiles').get() as { count: number }).count, 0);
    assert.equal((f.database.connection.prepare("SELECT COUNT(*) AS count FROM character_source_snapshots WHERE provider_id='story-worlds'").get() as { count: number }).count, 0);
    assert.equal(f.store.getBranch(f.world.id, f.branch.id).revision, f.branch.revision);
    assert.equal(actorById(f.store, f.world.id, f.branch.id, 'actor-b').role, 'supporting');
  } finally { f.database.close(); }
});

test('an already linked character is reused without creating or overwriting a second card', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const existing = insertExistingCard(database);
    const store = new StoryWorldStore(database);
    const service = new StoryWorldActorService(store);
    const linked = definition();
    linked.actors[1] = { ...linked.actors[1], characterId: existing.id, characterVersion: 1 };
    const world = store.create(linked);
    const branch = store.createBranch(world.id, {
      title: '已有卡主线', mode: 'canon-gap', direction: '', expectedRevision: world.revision,
    });
    const before = database.connection.prepare('SELECT display_name,draft_json FROM character_profiles WHERE id=?').get(existing.id);
    const result = service.promote(world.id, branch.id, 'actor-b', {
      expectedRevision: branch.revision, promoteToMain: true, addToLibrary: true, displayName: '不该覆盖',
    });
    assert.equal(result.character?.created, false);
    assert.equal(result.character?.characterId, existing.id);
    assert.equal(result.actor.role, 'main');
    assert.equal((database.connection.prepare('SELECT COUNT(*) AS count FROM character_profiles').get() as { count: number }).count, 1);
    assert.equal((database.connection.prepare('SELECT COUNT(*) AS count FROM character_versions').get() as { count: number }).count, 1);
    assert.deepEqual(database.connection.prepare('SELECT display_name,draft_json FROM character_profiles WHERE id=?').get(existing.id), before);
  } finally { database.close(); }
});

test('actor promotion route enforces admin auth, strict body and response schemas', async () => {
  const f = fixture();
  const app = Fastify();
  const token = 'test-admin-token';
  const headers = { 'x-sthstart-admin-token': token };
  registerStoryWorldActorRoutes(app, { adminToken: token } as ServiceConfig, f.store);
  const path = `/api/v1/admin/story-worlds/${f.world.id}/branches/${f.branch.id}/actors/actor-b/promote`;
  const validPayload = { expectedRevision: f.branch.revision, promoteToMain: true, addToLibrary: false };
  try {
    // 1. Without auth header, sending valid body reaches auth guard -> 401
    const unauthenticated = await app.inject({ method: 'POST', url: path, payload: validPayload });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    assert.equal(unauthenticated.json().error, 'unauthorized');

    // 2. With invalid auth token, valid body reaches auth guard -> 401
    const badToken = await app.inject({
      method: 'POST', url: path,
      headers: { 'x-sthstart-admin-token': 'wrong-token' },
      payload: validPayload,
    });
    assert.equal(badToken.statusCode, 401, badToken.body);
    assert.equal(badToken.json().error, 'unauthorized');

    // 3. Schema validation rejects invalid or empty body -> 400
    const emptyBody = await app.inject({ method: 'POST', url: path, headers, payload: {} });
    assert.equal(emptyBody.statusCode, 400, emptyBody.body);

    const invalid = await app.inject({ method: 'POST', url: path, headers,
      payload: { expectedRevision: f.branch.revision, promoteToMain: true } });
    assert.equal(invalid.statusCode, 400, invalid.body);

    // 4. Valid body and auth succeeds
    const created = await app.inject({ method: 'POST', url: path, headers,
      payload: { expectedRevision: f.branch.revision, promoteToMain: true, addToLibrary: true, displayName: '路由建卡' } });
    assert.equal(created.statusCode, 200, created.body);
    assert.ok(Value.Check(WorldActorPromotionResultSchema, created.json()));
    assert.equal(created.json().character.created, true);

    // 5. Business logic error (both promoteToMain and addToLibrary false) -> 400
    const bothFalse = await app.inject({ method: 'POST', url: path, headers,
      payload: { expectedRevision: created.json().branch.revision, promoteToMain: false, addToLibrary: false } });
    assert.equal(bothFalse.statusCode, 400, bothFalse.body);
    assert.equal(bothFalse.json().error, 'story_actor_action_required');

    // 6. Unknown actor -> 404
    const unknown = await app.inject({ method: 'POST',
      url: `/api/v1/admin/story-worlds/${f.world.id}/branches/${f.branch.id}/actors/missing/promote`,
      headers, payload: { expectedRevision: created.json().branch.revision, promoteToMain: true, addToLibrary: false } });
    assert.equal(unknown.statusCode, 404, unknown.body);
  } finally { await app.close(); f.database.close(); }
});
