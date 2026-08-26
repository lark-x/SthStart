import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { enforceRetention } from './artifacts.js';
import { SecretStore, hashToken, issueToken } from './security.js';

function testConfig(overrides: Record<string, string> = {}) {
  return readConfig({
    STHSTART_ADMIN_TOKEN: 'admin-test-token-that-is-long-12345678',
    STHSTART_IMAGE_SIGNING_SECRET: 'image-signing-test-secret-1234567890',
    ...overrides,
  });
}

function seedApp(database: ServiceDatabase, id: string) {
  const token = issueToken('test'); const now = nowIso();
  database.connection.prepare('INSERT INTO managed_apps VALUES (?,?,?,?,1,?,?)')
    .run(id, id, hashToken(token), JSON.stringify(['llm', 'vector', 'image', 'persona']), now, now);
  database.connection.prepare("INSERT INTO storage_policies(app_id,mode) VALUES (?,'keep')").run(id);
  return token;
}

test('admin creates high-entropy app tokens and stores only their hash', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/apps', headers: { 'x-sthstart-admin-token': 'admin-test-token-that-is-long-12345678' }, payload: { id: 'second-app', name: '第二应用' } });
  assert.equal(response.statusCode, 201);
  const token = response.json().token as string;
  assert.match(token, /^sth_app_[A-Za-z0-9_-]{40,}$/);
  const stored = database.connection.prepare('SELECT token_hash FROM managed_apps WHERE id=?').get('second-app') as { token_hash: string };
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.token_hash, hashToken(token));
  await app.close(); database.close();
});

test('vector gateway isolates app namespaces and rejects shared memory', async () => {
  const received: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; received.push(body);
    return Response.json({ chroma_id: body.chroma_id });
  };
  const database = new ServiceDatabase(); const first = seedApp(database, 'first'); const second = seedApp(database, 'second'); const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('vec', 'Vector', 'vector', 'http://vector.test', null, null, now, now);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });
  for (const [token, id] of [[first, 'same-id'], [second, 'same-id']] as const) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/vector/upsert', headers: { authorization: `Bearer ${token}` }, payload: { chroma_id: id, text: 'hello', namespace: 'notes' } });
    assert.equal(response.statusCode, 200);
  }
  assert.equal(received[0].conversation_id, 'app:first:notes:default');
  assert.equal(received[1].conversation_id, 'app:second:notes:default');
  assert.notEqual(received[0].chroma_id, received[1].chroma_id);
  const denied = await app.inject({ method: 'POST', url: '/api/v1/vector/upsert', headers: { authorization: `Bearer ${first}` }, payload: { text: 'memory', namespace: 'shared:world', purpose: 'memory' } });
  assert.equal(denied.statusCode, 403);
  await app.close(); database.close();
});

test('vector gateway strips only namespace prefixes, preserving ordinary story text', async () => {
  const fetcher: typeof fetch = async () => Response.json({
    chroma_id: 'app:first:notes:item-1',
    text: 'The literal app:first:notes: token inside this sentence must remain.',
  });
  const database = new ServiceDatabase(); const token = seedApp(database, 'first'); const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('vec', 'Vector', 'vector', 'http://vector.test', null, null, now, now);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });
  const response = await app.inject({ method: 'POST', url: '/api/v1/vector/search', headers: { authorization: `Bearer ${token}` }, payload: { namespace: 'notes', text: 'x' } });
  assert.equal(response.json().chroma_id, 'item-1');
  assert.match(response.json().text, /app:first:notes:/);
  await app.close(); database.close();
});

test('image cancellation deletes queued prompts but never interrupts a running workflow', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'queued-prompt' });
    if (url.endsWith('/queue') && init?.method === 'POST') return Response.json({});
    if (url.endsWith('/queue')) return Response.json({ queue_pending: [[1, 'queued-prompt']], queue_running: [] });
    return Response.json({});
  };
  const database = new ServiceDatabase(); const token = seedApp(database, 'cancel-app'); const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('img', 'Image', 'image', 'http://image.test', null, null, now, now);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });
  const created = await app.inject({ method: 'POST', url: '/api/v1/images/tasks', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'cancel-request-1' }, payload: { workflow: { one: {} } } });
  const cancelled = await app.inject({ method: 'POST', url: `/api/v1/images/tasks/${created.json().id}/cancel`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(cancelled.json().status, 'cancelled');
  assert.equal(cancelled.json().upstreamMayContinue, false);
  assert.equal(calls.some((call) => call.includes('/interrupt')), false);
  await app.close(); database.close();
});

test('image task idempotency returns one accepted upstream task', async () => {
  let submissions = 0;
  const fetcher: typeof fetch = async () => { submissions += 1; return Response.json({ prompt_id: 'provider-task' }); };
  const database = new ServiceDatabase(); const token = seedApp(database, 'image-app'); const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('img', 'Image', 'image', 'http://image.test', null, null, now, now);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });
  const request = { method: 'POST' as const, url: '/api/v1/images/tasks', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'stable-request-1' }, payload: { workflow: { 1: { class_type: 'Test' } } } };
  const first = await app.inject(request); const repeated = await app.inject(request);
  assert.equal(first.statusCode, 202); assert.equal(repeated.statusCode, 200);
  assert.equal(first.json().id, repeated.json().id); assert.equal(submissions, 1);
  await app.close(); database.close();
});

test('LLM gateway supports OpenAI-compatible JSON and streaming responses', async () => {
  const seen: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; seen.push(body);
    if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return Response.json({ id: 'chat-1', choices: [{ message: { role: 'assistant', content: 'Hi' } }] });
  };
  const database = new ServiceDatabase(); const token = seedApp(database, 'llm-app'); const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('llm', 'LLM', 'llm', 'http://llm.test/v1', 'test-model', null, now, now);
  database.connection.prepare("INSERT INTO provider_profile_options(profile_id,capabilities_json) VALUES ('llm','[\"text\"]')").run();
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('llm-app','text','llm',?)").run(now);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });
  const headers = { authorization: `Bearer ${token}` };
  const regular = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: { messages: [{ role: 'user', content: 'hello' }] } });
  assert.equal(regular.statusCode, 200); assert.equal(regular.json().choices[0].message.content, 'Hi'); assert.equal(seen[0].model, 'test-model');
  const stream = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: { stream: true, messages: [{ role: 'user', content: 'hello' }] } });
  assert.equal(stream.statusCode, 200); assert.match(stream.body, /data:.*Hi/);
  await app.close(); database.close();
});

test('LLM gateway routes text and image messages to per-app models and rejects missing assignments', async () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  };
  const database = new ServiceDatabase(); const token = seedApp(database, 'role-app'); const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('text-model', 'Text', 'llm', 'http://text.test/v1', 'text-upstream', null, now, now);
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('vision-model', 'Vision', 'llm', 'http://vision.test/v1', 'vision-upstream', null, now, now);
  database.connection.prepare("INSERT INTO provider_profile_options(profile_id,capabilities_json) VALUES ('text-model','[\"text\"]')").run();
  database.connection.prepare("INSERT INTO provider_profile_options(profile_id,capabilities_json) VALUES ('vision-model','[\"text\",\"multimodal\"]')").run();
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('role-app','text','text-model',?)").run(now);
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });
  const headers = { authorization: `Bearer ${token}` };
  const textResponse = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: { model: 'client-model', messages: [{ role: 'user', content: 'hello' }] } });
  assert.equal(textResponse.statusCode, 200); assert.equal(seen[0].body.model, 'text-upstream'); assert.match(seen[0].url, /text\.test/);
  const missingVision = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] }] } });
  assert.equal(missingVision.statusCode, 503); assert.equal(missingVision.json().error, 'llm_profile_not_assigned'); assert.equal(missingVision.json().role, 'multimodal');
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('role-app','multimodal','vision-model',?)").run(now);
  const visionResponse = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { ...headers, 'x-sthstart-model-role': 'multimodal' }, payload: { model: 'wrong', messages: [{ role: 'user', content: 'inspect' }] } });
  assert.equal(visionResponse.statusCode, 200); assert.equal(seen[1].body.model, 'vision-upstream'); assert.match(seen[1].url, /vision\.test/);
  const models = await app.inject({ method: 'GET', url: '/v1/models', headers });
  assert.deepEqual(models.json().data.map((item: { id: string }) => item.id).sort(), ['text-upstream', 'vision-upstream']);
  await app.close(); database.close();
});

test('persona imports remain immutable snapshots after a template upgrade', async () => {
  const database = new ServiceDatabase(); const token = seedApp(database, 'persona-app');
  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
  const adminHeaders = { 'x-sthstart-admin-token': 'admin-test-token-that-is-long-12345678' };
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/personas', headers: adminHeaders, payload: { id: 'alice', displayName: 'Alice', personaPrompt: 'v1 prompt' } });
  assert.equal(created.statusCode, 201);
  const imported = await app.inject({ method: 'POST', url: '/api/v1/personas/alice/import', headers: { authorization: `Bearer ${token}` }, payload: { localId: 'alice-local' } });
  assert.equal(imported.statusCode, 201);
  await app.inject({ method: 'POST', url: '/api/v1/admin/personas/alice/versions', headers: adminHeaders, payload: { personaPrompt: 'v2 prompt' } });
  const local = database.connection.prepare('SELECT source_version,snapshot_json FROM app_personas WHERE app_id=? AND local_id=?').get('persona-app', 'alice-local') as { source_version: number; snapshot_json: string };
  assert.equal(local.source_version, 1); assert.match(local.snapshot_json, /v1 prompt/); assert.doesNotMatch(local.snapshot_json, /v2 prompt/);
  await app.close(); database.close();
});

test('quota retention removes oldest unpinned artifacts and preserves pinned files', async () => {
  const database = new ServiceDatabase(); seedApp(database, 'retention-app');
  const directory = await mkdtemp(resolve(tmpdir(), 'sthstart-retention-'));
  const oldest = resolve(directory, 'old.png'); const pinned = resolve(directory, 'pinned.png');
  await writeFile(oldest, Buffer.alloc(10)); await writeFile(pinned, Buffer.alloc(10));
  database.connection.prepare("UPDATE storage_policies SET mode='quota',max_bytes=10 WHERE app_id='retention-app'").run();
  database.connection.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?)').run('old', 'retention-app', null, null, oldest, 'image/png', 10, 0, '2026-01-01T00:00:00.000Z');
  database.connection.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?)').run('pin', 'retention-app', null, null, pinned, 'image/png', 10, 1, '2026-01-02T00:00:00.000Z');
  assert.equal(await enforceRetention(database, 'retention-app'), 1);
  const remaining = database.connection.prepare('SELECT id,pinned FROM artifacts ORDER BY id').all() as { id: string; pinned: number }[];
  assert.equal(remaining.length, 1); assert.equal(remaining[0].id, 'pin'); assert.equal(remaining[0].pinned, 1);
  database.close();
});

test('secret store never selects the plaintext file backend', async () => {
  const status = await new SecretStore({}).status();
  assert.notEqual(status.backend, 'file');
});

test('notebook CRUD persists searchable structured notes', async () => {
  const database = new ServiceDatabase(); const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-notes-'));
  const { app } = await createService({ config: testConfig({ STHSTART_ARTIFACT_DIR: artifactDir }), database, secrets: new SecretStore({}) });
  const headers = { 'x-sthstart-admin-token': 'admin-test-token-that-is-long-12345678' };
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/notebook/notes', headers, payload: {
    title: '雨夜车站', kind: 'idea', stage: 'story-candidate', tags: ['场景', '开场'],
    content: [{ id: 'block-1', type: 'text', text: '角色在末班车到站前收到一封信。' }],
  } });
  assert.equal(created.statusCode, 201); const note = created.json();
  const searched = await app.inject({ method: 'GET', url: '/api/v1/admin/notebook/notes?q=末班车', headers });
  assert.equal(searched.statusCode, 200); assert.equal(searched.json().items[0].id, note.id);
  const updated = await app.inject({ method: 'PUT', url: `/api/v1/admin/notebook/notes/${note.id}`, headers, payload: { ...note, title: '雨夜的末班车' } });
  assert.equal(updated.json().title, '雨夜的末班车');
  const uploaded = await app.inject({ method: 'POST', url: '/api/v1/admin/notebook/assets', headers, payload: {
    noteId: note.id, filename: 'station.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  } });
  assert.equal(uploaded.statusCode, 201); const assetId = uploaded.json().id;
  const image = await app.inject({ method: 'GET', url: `/api/v1/admin/notebook/assets/${assetId}`, headers });
  assert.equal(image.statusCode, 200); assert.equal(image.headers['content-type'], 'image/png');
  const removed = await app.inject({ method: 'DELETE', url: `/api/v1/admin/notebook/notes/${note.id}`, headers });
  assert.equal(removed.statusCode, 200);
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS count FROM note_assets').get()!.count, 0);
  await app.close(); database.close();
});
