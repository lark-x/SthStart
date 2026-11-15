import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import { StoryWorldSchema, WorldBranchDetailSchema, WorldSetupSchema, WorldSetupListSchema, WorldSetupResultSchema, type WorldDefinition } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import { StoryWorldStore } from './store.js';
import { registerStoryWorldRoutes, type WorldRouteServices } from './routes.js';

const definition: WorldDefinition = {
  title: '交织的港口', summary: '', timeLabel: '归航之日',
  locations: [{ id: 'port', name: '港口', description: '' }],
  actors: [{ id: 'alice', name: '行者', role: 'main', characterId: null, characterVersion: null, background: '',
    personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'port', referenceArtifactIds: [] }],
  sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
};
const root = '/api/v1/admin/story-worlds';
const headers = { 'x-sthstart-admin-token': 'world-route-test-secret' };

test('pending setup routes validate authentication, partial saves, revision conflicts and completion responses', async () => {
  const database = new ServiceDatabase();
  const app = Fastify();
  const store = new StoryWorldStore(database);
  const unused = () => { throw new Error('Not invoked in this route test'); };
  registerStoryWorldRoutes(app, { adminToken: headers['x-sthstart-admin-token'] } as ServiceConfig, {
    store, runtime: { start: unused, pause: unused, resume: unused }, images: { plan: unused, submit: unused }, adopt: unused,
  });
  try {
    const url = root + '/setups';
    const input = { title: '待配置的港口', idempotencyKey: 'route-setup-1' };
    assert.equal((await app.inject({ method: 'POST', url, payload: input })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { title: input.title } })).statusCode, 400);
    const created = await app.inject({ method: 'POST', url, headers, payload: input });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id;
    const path = `${url}/${id}`;
    const response = await app.inject({ url: path, headers });
    assert.ok(Value.Check(WorldSetupSchema, response.json()), response.body);
    const setup = response.json();
    assert.equal((await app.inject({ url: path })).statusCode, 401);
    const partial = await app.inject({ method: 'PUT', url: path, headers, payload: {
      expectedRevision: setup.revision, draft: setup.draft, complete: false,
    } });
    assert.equal(partial.statusCode, 200, partial.body);
    assert.ok(Value.Check(WorldSetupResultSchema, partial.json()), partial.body);
    assert.equal(partial.json().status, 'pending');
    assert.equal(partial.json().setup.revision, setup.revision + 1);
    const update = { expectedRevision: partial.json().setup.revision, draft: {
      definition, initialBranch: setup.draft.initialBranch,
    }, complete: true };
    const conflict = await app.inject({ method: 'PUT', url: path, headers, payload: { ...update, expectedRevision: setup.revision } });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error, 'story_setup_conflict');
    const completed = await app.inject({ method: 'PUT', url: path, headers, payload: update });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.ok(Value.Check(WorldSetupResultSchema, completed.json()), completed.body);
    assert.equal(completed.json().status, 'ready');
    assert.equal(completed.json().world.id, id);
    assert.equal(completed.json().branch.worldId, id);
    const replay = await app.inject({ method: 'PUT', url: path, headers, payload: update });
    assert.equal(replay.json().branch.id, completed.json().branch.id);
    assert.equal((await app.inject({ url: path, headers })).statusCode, 404);
    const list = await app.inject({ url, headers });
    assert.ok(Value.Check(WorldSetupListSchema, list.json()));
    assert.deepEqual(list.json().items, []);
  } finally { await app.close(); database.close(); }
});

test('world HTTP validates auth and schemas and round-trips branch metadata without serializer loss', async () => {
  const database = new ServiceDatabase();
  const app = Fastify();
  const store = new StoryWorldStore(database);
  const unused = () => { throw new Error('Not invoked in this route test'); };
  const services: WorldRouteServices = { store,
    runtime: { start: unused, pause: unused, resume: unused },
    images: { plan: unused, submit: unused }, adopt: unused,
  };
  registerStoryWorldRoutes(app, { adminToken: headers['x-sthstart-admin-token'] } as ServiceConfig, services);
  try {
    assert.equal((await app.inject({ method: 'GET', url: root })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: root, headers, payload: { ...definition, actors: [] } })).statusCode, 400);
    const created = await app.inject({ method: 'POST', url: root, headers, payload: definition });
    assert.equal(created.statusCode, 201, created.body);
    const world = created.json();
    assert.ok(Value.Check(StoryWorldSchema, world));
    const branchResponse = await app.inject({ method: 'POST', url: root + '/' + world.id + '/branches', headers,
      payload: { expectedRevision: world.revision, title: '原作留白', mode: 'canon-gap', direction: '安静的一天' } });
    assert.equal(branchResponse.statusCode, 201, branchResponse.body);
    const branch = branchResponse.json();
    const path = root + '/' + world.id + '/branches/' + branch.id;
    const detail = await app.inject({ url: path, headers });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.ok(Value.Check(WorldBranchDetailSchema, detail.json()));
    assert.equal(detail.json().definition.actors[0].name, '行者');
    assert.equal((await app.inject({ url: root + '/wrong-world/branches/' + branch.id, headers })).statusCode, 404);
    assert.equal((await app.inject({ url: path + '/events?limit=201', headers })).statusCode, 400);
    const conflict = await app.inject({ method: 'PUT', url: root + '/' + world.id, headers,
      payload: { expectedRevision: 999, definition } });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error, 'story_world_revision_conflict');
    const line = await app.inject({ method: 'POST', url: path + '/story-lines', headers,
      payload: { expectedRevision: branch.revision, title: '归港', description: '', actorIds: ['alice'] } });
    assert.equal(line.statusCode, 201, line.body);
    const current = store.getBranch(world.id, branch.id);
    assert.equal(current.revision, branch.revision + 1);
    const intervention = await app.inject({ method: 'POST', url: path + '/interventions', headers,
      payload: { expectedRevision: current.revision, tick: 60, kind: 'goal', actorIds: ['alice'], instruction: '去市场看看' } });
    assert.equal(intervention.statusCode, 201, intervention.body);
  } finally { await app.close(); database.close(); }
});

test('bundle and branch update routes return validated results and stable error codes', async () => {
  const database = new ServiceDatabase();
  const app = Fastify();
  const store = new StoryWorldStore(database);
  const unused = () => { throw new Error('Not invoked in this route test'); };
  let bindingArguments: unknown[] = [];
  const services: WorldRouteServices = { store,
    runtime: { start: unused, pause: unused, resume: unused },
    images: { plan: unused, submit: unused }, adopt: unused,
    bindProject: (...args) => {
      bindingArguments = args;
      return { projectId: String(args[0]), worldId: String(args[1]), branchId: String(args[2]), sourceRevision: Number(args[3]) };
    },
  };
  registerStoryWorldRoutes(app, { adminToken: headers['x-sthstart-admin-token'] } as ServiceConfig, services);
  try {
    const bundle = {
      idempotencyKey: 'route-bundle-1',
      definition,
      initialBranch: { title: '首次航行', mode: 'canon-gap', direction: '从港口出发。' },
    };
    const created = await app.inject({ method: 'POST', url: root + '/create-bundle', headers, payload: bundle });
    assert.equal(created.statusCode, 201, created.body);
    const result = created.json();
    assert.equal(result.world.title, '交织的港口');
    assert.equal(result.branch.title, '首次航行');

    const repeated = await app.inject({ method: 'POST', url: root + '/create-bundle', headers, payload: bundle });
    assert.equal(repeated.statusCode, 201, repeated.body);
    assert.equal(repeated.json().world.id, result.world.id);
    assert.equal(repeated.json().branch.id, result.branch.id);

    const conflict = await app.inject({
      method: 'POST', url: root + '/create-bundle', headers,
      payload: { ...bundle, initialBranch: { ...bundle.initialBranch, mode: 'alternate' } },
    });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error, 'story_creation_idempotency_conflict');

    const invalid = await app.inject({
      method: 'POST', url: root + '/create-bundle', headers,
      payload: { ...bundle, idempotencyKey: 'route-bundle-invalid', initialBranch: { ...bundle.initialBranch, title: '' } },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);

    const path = root + '/' + result.world.id + '/branches/' + result.branch.id;
    const updated = await app.inject({
      method: 'PUT', url: path, headers,
      payload: {
        expectedRevision: result.branch.revision, title: '航行改稿',
        mode: 'adaptation', direction: '先靠岸再出发。',
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().title, '航行改稿');
    assert.equal(updated.json().revision, result.branch.revision + 1);

    const stale = await app.inject({
      method: 'PUT', url: path, headers,
      payload: { expectedRevision: result.branch.revision, title: '过期写入', mode: 'alternate', direction: '' },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().error, 'story_branch_revision_conflict');

    const missing = await app.inject({
      method: 'PUT', url: root + '/' + result.world.id + '/branches/missing', headers,
      payload: { expectedRevision: 1, title: '不存在', mode: 'alternate', direction: '' },
    });
    assert.equal(missing.statusCode, 404, missing.body);

    const binding = await app.inject({
      method: 'POST', url: path + '/project-binding', headers,
      payload: { projectId: 'project-1', expectedRevision: updated.json().revision, expectedBinding: null },
    });
    assert.equal(binding.statusCode, 200, binding.body);
    assert.equal(bindingArguments.length, 5);
    assert.equal(bindingArguments[4], null);
    assert.equal((await app.inject({ method: 'POST', url: root + '/create-bundle', payload: bundle })).statusCode, 401);
  } finally { await app.close(); database.close(); }
});
