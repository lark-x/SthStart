import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WORLD_RUN_SETTINGS, type WorldDefinition } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import { SecretStore } from '../security.js';
import { createAiCallRecord, updateAiCallRecord } from '../ai-call-trace.js';
import { PublicWorldModelAdapter, type WorldModelRequest } from './model.js';
import { StoryWorldStore } from './store.js';
import { StoryWorldRuntime } from './runtime.js';
import { STORY_WORLD_MIGRATION_STATEMENTS } from './migration.js';
import { WORLD_RUNTIME_MIGRATION_STATEMENTS } from './runtime-migration.js';

function setup(fetcher?: typeof fetch) {
  const database = new ServiceDatabase();
  for (const sql of [...STORY_WORLD_MIGRATION_STATEMENTS, ...WORLD_RUNTIME_MIGRATION_STATEMENTS]) database.connection.exec(sql);
  const config = {} as ServiceConfig; const secrets = new SecretStore({});
  database.connection.prepare("INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('story-worlds','故事世界','test-hash','[]',1,'','')").run();
  for (const purpose of ['action', 'adjudication', 'narration']) {
    database.connection.prepare("INSERT INTO service_connections(id,name,kind,base_url,created_at,updated_at) VALUES (?,?, 'openai-compatible-text',?,'','')")
      .run('conn-' + purpose, purpose, 'https://' + purpose + '.example.test/v1');
    database.connection.prepare("INSERT INTO model_profiles(id,connection_id,name,model_id,created_at,updated_at) VALUES (?,?,?,?,'','')")
      .run('model-' + purpose, 'conn-' + purpose, purpose, 'provider-neutral-' + purpose);
    database.connection.prepare("INSERT INTO purpose_bindings(id,app_id,purpose_key,target_type,target_id,updated_at) VALUES (?,'story-worlds',?,'model',?,'')")
      .run('binding-' + purpose, purpose, 'model-' + purpose);
  }
  const options = { database, config, secrets, fetcher };
  const adapter = new PublicWorldModelAdapter(options);
  const request = (id = 'call', purpose: 'action' | 'adjudication' | 'narration' = 'action'): WorldModelRequest => ({ callId: id, runId: 'run', stepId: 'step', worldId: 'world', branchId: 'branch', stage: purpose, purpose, profileId: null, system: '输出JSON', input: { task: 'test' } });
  return { ...options, adapter, request };
}

test('three public purpose bindings resolve independently and execute through common LLM with audit', async () => {
  const received: Array<{ url: string; body: any }> = [];
  const f = setup(async (input, init) => {
    received.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"approved":true,"issues":[]}' } }], usage: { total_tokens: 10 } }), { status: 200 });
  });
  try {
    for (const purpose of ['action', 'adjudication', 'narration'] as const) {
      const request = f.request(purpose, purpose); const prepared = await f.adapter.prepare(request);
      assert.equal(prepared.profileId, 'model-' + purpose);
      const result = await f.adapter.execute({ ...request, profileId: prepared.profileId });
      assert.ok(result.aiCallId); assert.match(result.text, /approved/);
    }
    assert.deepEqual(received.map((r) => r.body.model), ['provider-neutral-action', 'provider-neutral-adjudication', 'provider-neutral-narration']);
    assert.ok(received.every((r) => r.url.endsWith('/v1/chat/completions') && r.body.response_format.type === 'json_object'));
    const rows = f.database.connection.prepare("SELECT application_id,status,trace_id FROM ai_call_records WHERE application_id='story-worlds'").all();
    assert.equal(rows.length, 3); assert.ok(rows.every((r) => r.status === 'succeeded'));
    assert.equal((await f.adapter.reconcile(f.request('action'))).status, 'succeeded');
  } finally { f.database.close(); }
});

test('only not dispatched and explicit HTTP rejection are definite failures; failed transport stays unknown', async () => {
  const f = setup();
  try {
    for (const [trace, status, errorCode, expected] of [
      ['transport', 'failed', 'upstream_unavailable', 'unknown'], ['abandoned', 'abandoned', 'upstream_unavailable', 'unknown'],
      ['unclassified', 'failed', null, 'unknown'], ['server-error', 'failed', 'http_500', 'unknown'],
      ['http-timeout', 'failed', 'http_408', 'unknown'], ['http-conflict', 'failed', 'http_409', 'unknown'],
      ['rejected', 'failed', 'http_429', 'failed'], ['not-sent', 'not_dispatched', null, 'failed'],
    ] as const) {
      const id = createAiCallRecord(f.database, { applicationId: 'story-worlds', feature: 'action', businessEvent: 'test', callType: 'llm', traceId: trace });
      updateAiCallRecord(f.database, id, { status, errorCode });
      assert.equal((await f.adapter.reconcile(f.request(trace))).status, expected, trace);
    }
  } finally { f.database.close(); }
});

test('common LLM transport timeout remains unknown after a fresh adapter inspects its audit', async () => {
  let dispatched = 0;
  const f = setup(async () => { dispatched++; throw new Error('simulated upstream timeout'); });
  try {
    const request = f.request('timeout'); await f.adapter.prepare(request);
    await assert.rejects(f.adapter.execute(request), /timeout/);
    const restarted = new PublicWorldModelAdapter(f);
    assert.equal((await restarted.reconcile(request)).status, 'unknown'); assert.equal(dispatched, 1);
    const row = f.database.connection.prepare('SELECT status,error_code FROM ai_call_records WHERE trace_id=?').get('timeout');
    assert.equal(row?.status, 'abandoned'); assert.equal(row?.error_code, 'upstream_unavailable');
  } finally { f.database.close(); }
});

test('a new transport timeout on an explicitly retried identity cannot reuse an earlier HTTP 429 rejection', async () => {
  let dispatched = 0;
  const f = setup(async () => {
    if (++dispatched === 1) return Response.json({ error: { code: 'gateway_concurrency_limit', message: 'gateway_concurrency_limit' } }, { status: 429 });
    throw new Error('retried request transport timeout');
  });
  try {
    const request = f.request('rejected-then-unknown');
    await assert.rejects(f.adapter.execute(request));
    const rejected = new PublicWorldModelAdapter(f);
    assert.equal((await rejected.reconcile(request)).status, 'failed');
    await assert.rejects(rejected.execute(request), /timeout/);
    const restarted = new PublicWorldModelAdapter(f);
    assert.equal((await restarted.reconcile(request)).status, 'unknown');
    assert.equal(dispatched, 2);
    const audits = f.database.connection.prepare('SELECT status,error_code FROM ai_call_records WHERE trace_id=? ORDER BY rowid').all(request.callId);
    assert.equal(audits.length, 2);
    assert.equal(audits[0].status, 'failed'); assert.equal(audits[0].error_code, 'http_429');
    assert.equal(audits[1].status, 'abandoned'); assert.equal(audits[1].error_code, 'upstream_unavailable');
  } finally { f.database.close(); }
});

test('invalid purpose config prevents run creation before any network dispatch or budget charge', async () => {
  let dispatched = 0;
  const f = setup(async () => { dispatched++; throw new Error('must not call'); });
  const store = new StoryWorldStore(f.database);
  const definition: WorldDefinition = { title: 'test', summary: '', timeLabel: '', actors: [{ id: 'a', name: 'a', role: 'main', characterId: null, characterVersion: null,
    background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'port', referenceArtifactIds: [] }], locations: [{ id: 'port', name: 'port', description: '' }],
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '' };
  const world = store.create(definition); const branch = store.createBranch(world.id, { expectedRevision: world.revision, title: 'b', mode: 'canon-gap', direction: '' });
  const runtime = new StoryWorldRuntime({ ...f, store });
  try {
    f.database.connection.prepare("UPDATE model_profiles SET enabled=0 WHERE id='model-narration'").run();
    await assert.rejects(runtime.start(world.id, branch.id, { expectedRevision: branch.revision, idempotencyKey: 'x', settings: DEFAULT_WORLD_RUN_SETTINGS }));
    assert.equal(dispatched, 0); assert.equal(f.database.connection.prepare('SELECT count(*) AS n FROM sw_runs').get()?.n, 0);
    assert.equal(store.getBranch(world.id, branch.id).revision, branch.revision);
    f.database.connection.prepare("UPDATE model_profiles SET enabled=1,capabilities_json='[\"multimodal\"]' WHERE id='model-narration'").run();
    await assert.rejects(f.adapter.prepare(f.request('x', 'narration')), /capability/);
  } finally { await runtime.stop(); f.database.close(); }
});
