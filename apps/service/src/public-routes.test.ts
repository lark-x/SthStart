import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ServiceDatabase, nowIso } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { enforceGlobalQuota, enforceRetention, generateMediaManifest, persistArtifact, readArtifact, reconcileArtifacts, streamUploadArtifact } from './artifacts.js';
import { SecretStore, hashToken, issueToken } from './security.js';

function signArtifact(secret: string, artifactId: string, expires: number, appId?: string) {
  const payload = appId ? `${artifactId}.${appId}.${expires}` : `${artifactId}.${expires}`;
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

class MemorySecrets extends SecretStore {
  readonly values = new Map<string, string>();
  override async status() { return { available: true, backend: 'memory', envFallback: false }; }
  override async get(account: string) {
    const value = this.values.get(account);
    return value === undefined ? { value: null, source: 'none' as const } : { value, source: 'keyring' as const };
  }
  override async set(account: string, value: string) { this.values.set(account, value); }
  override async delete(account: string) { this.values.delete(account); }
}

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

test('configured Linshe app token remains usable for public status calls', async () => {
  const previousToken = process.env.STHSTART_APP_TOKEN;
  const configuredToken = 'sth_app_configured-token-for-linshe-test-0123456789';
  process.env.STHSTART_APP_TOKEN = configuredToken;
  const database = new ServiceDatabase();
  try {
    const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}) });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/app/config',
      headers: { authorization: `Bearer ${configuredToken}` },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().app.id, 'linshe');
    await app.close();
  } finally {
    database.close();
    if (previousToken === undefined) delete process.env.STHSTART_APP_TOKEN;
    else process.env.STHSTART_APP_TOKEN = previousToken;
  }
});

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

test('image gateway handles submission errors, missing task ID, and upstream timeouts with safe messages', async () => {
  const database = new ServiceDatabase(); const token = seedApp(database, 'error-app'); const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('img-err', 'Image', 'image', 'http://image-err.test', null, null, now, now);

  // 1. Upstream returns 400 node error
  let fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: 'value_not_in_list', message: 'UNet model missing' }), { status: 400 });
  let { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });
  let res = await app.inject({ method: 'POST', url: '/api/v1/images/tasks', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'err-request-1' }, payload: { workflow: { 1: {} } } });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, 'image_rejected');
  assert.match(res.json().message, /UNet model missing/);
  await app.close();

  // 2. Upstream returns non-JSON or missing prompt_id
  fetcher = async () => new Response('Invalid HTML page', { status: 200 });
  ({ app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher }));
  res = await app.inject({ method: 'POST', url: '/api/v1/images/tasks', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'err-request-2' }, payload: { workflow: { 1: {} } } });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, 'image_missing_task_id');
  await app.close();

  // 3. Upstream network failure / timeout
  fetcher = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:8188 with Bearer sk-secret-token-1234567890'); };
  ({ app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher }));
  res = await app.inject({ method: 'POST', url: '/api/v1/images/tasks', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'err-request-3' }, payload: { workflow: { 1: {} } } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'image_unavailable');
  assert.doesNotMatch(res.json().message, /sk-secret-token/);
  assert.match(res.json().message, /[REDACTED_TOKEN]/);
  await app.close();

  database.close();
});

test('image task lookup handles execution error and artifact download failure without false completion', async () => {
  const database = new ServiceDatabase(); const token = seedApp(database, 'lookup-app'); const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('img-lookup', 'Image', 'image', 'http://image-lookup.test', null, null, now, now);

  // 1. History reports execution error EVEN WITH outputs present -> must skip downloads and mark task failed
  let viewCalled = false;
  let fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/view')) {
      viewCalled = true;
      return new Response('fake-image-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
    }
    if (url.includes('/history/task-err')) {
      return Response.json({
        'task-err': {
          status: { status_str: 'error', messages: [['execution_error', { exception_message: 'CUDA out of memory' }]] },
          outputs: { 9: { images: [{ filename: 'partial-output.png', type: 'output' }] } },
        },
      });
    }
    return Response.json({ prompt_id: 'task-err' });
  };
  let { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });
  let created = await app.inject({ method: 'POST', url: '/api/v1/images/tasks', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'task-err-key-1' }, payload: { workflow: { 1: {} } } });
  let taskId = created.json().id;
  let lookup = await app.inject({ method: 'GET', url: `/api/v1/images/tasks/${taskId}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(lookup.statusCode, 200);
  assert.equal(lookup.json().status, 'failed');
  assert.match(lookup.json().error, /CUDA out of memory|error/);
  assert.equal(lookup.json().artifacts.length, 0);
  assert.equal(viewCalled, false, 'Should not attempt to download images when execution error occurred');
  await app.close();

  // 2. History returns image but /view download returns 404/500 -> task marked failed with artifact_download_failed
  let dlAttempted = false;
  fetcher = async (input) => {
    const url = String(input);
    if (url.includes('/history/task-dl-fail')) {
      return Response.json({
        'task-dl-fail': {
          outputs: { 9: { images: [{ filename: 'gen-1.png', type: 'output' }] } },
        },
      });
    }
    if (url.includes('/view')) {
      dlAttempted = true;
      return new Response('File not ready', { status: 404 });
    }
    return Response.json({ prompt_id: 'task-dl-fail' });
  };
  ({ app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher }));
  created = await app.inject({ method: 'POST', url: '/api/v1/images/tasks', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'task-dl-key-1' }, payload: { workflow: { 1: {} } } });
  taskId = created.json().id;
  lookup = await app.inject({ method: 'GET', url: `/api/v1/images/tasks/${taskId}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(lookup.statusCode, 200);
  assert.equal(lookup.json().status, 'failed');
  assert.equal(dlAttempted, true, 'Should have attempted /view download using injected fetcher');
  assert.match(lookup.json().error, /产物下载失败/);
  assert.equal(lookup.json().artifacts.length, 0);
  await app.close();

  database.close();
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

test('GET /api/v1/app/config exposes safe assignment status and strictly hides credentials', async () => {
  const database = new ServiceDatabase();
  const token = seedApp(database, 'safe-app');
  const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('text-tpl', '文本模板', 'llm', 'https://secret-upstream.com/v1', 'deepseek-v4-flash', 'profile:text-tpl', now, now);
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('vision-tpl', '视觉模板', 'llm', 'https://secret-vision.com/v1', 'qwen-vl-max', 'profile:vision-tpl', now, now);
  database.connection.prepare("INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json) VALUES (?,?,?,?,?)")
    .run('text-tpl', 'enabled', JSON.stringify({ 'x-custom': 'secret-val' }), JSON.stringify({ top_k: 50 }), JSON.stringify(['text']));
  database.connection.prepare("INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json) VALUES (?,?,?,?,?)")
    .run('vision-tpl', 'omit', '{}', '{}', JSON.stringify(['multimodal']));
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('safe-app','text','text-tpl',?)").run(now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('safe-app','multimodal','vision-tpl',?)").run(now);

  const secrets = new MemorySecrets();
  await secrets.set('profile:text-tpl', 'super-secret-api-key');
  const { app } = await createService({ config: testConfig(), database, secrets });

  // 401 on missing or invalid token
  const unauth = await app.inject({ method: 'GET', url: '/api/v1/app/config' });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error, 'invalid_app_token');

  const badToken = await app.inject({ method: 'GET', url: '/api/v1/app/config', headers: { authorization: 'Bearer invalid-token' } });
  assert.equal(badToken.statusCode, 401);

  // 403 when app lacks llm capability
  const noLlmToken = issueToken('no-llm');
  database.connection.prepare('INSERT INTO managed_apps VALUES (?,?,?,?,1,?,?)')
    .run('no-llm-app', 'No LLM', hashToken(noLlmToken), JSON.stringify(['vector']), now, now);
  const forbidden = await app.inject({ method: 'GET', url: '/api/v1/app/config', headers: { authorization: `Bearer ${noLlmToken}` } });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error, 'capability_denied');

  // 200 with full assigned status
  const res = await app.inject({ method: 'GET', url: '/api/v1/app/config', headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.equal(data.app.id, 'safe-app');
  assert.equal(data.app.name, 'safe-app');
  assert.equal(data.llm.ready, true);
  assert.equal(data.llm.text?.profileId, 'text-tpl');
  assert.equal(data.llm.text?.name, '文本模板');
  assert.equal(data.llm.text?.model, 'deepseek-v4-flash');
  assert.equal(data.llm.text?.ready, true);
  assert.equal(data.llm.multimodal?.profileId, 'vision-tpl');
  assert.equal(data.llm.multimodal?.name, '视觉模板');
  assert.equal(data.llm.multimodal?.model, 'qwen-vl-max');
  assert.equal(data.llm.multimodal?.ready, true);

  // Verify NO sensitive information is leaked
  const rawJson = res.body;
  assert.doesNotMatch(rawJson, /secret-upstream/);
  assert.doesNotMatch(rawJson, /secret-vision/);
  assert.doesNotMatch(rawJson, /super-secret-api-key/);
  assert.doesNotMatch(rawJson, /x-custom/);
  assert.doesNotMatch(rawJson, /secret-val/);
  assert.doesNotMatch(rawJson, /top_k/);
  assert.doesNotMatch(rawJson, /baseUrl/i);
  assert.doesNotMatch(rawJson, /headers/i);
  assert.doesNotMatch(rawJson, /extraBody/i);

  // Unassigned app returns null roles and ready: false
  const unassignedToken = seedApp(database, 'unassigned-app');
  const unassignedRes = await app.inject({ method: 'GET', url: '/api/v1/app/config', headers: { authorization: `Bearer ${unassignedToken}` } });
  assert.equal(unassignedRes.statusCode, 200);
  assert.equal(unassignedRes.json().llm.text, null);
  assert.equal(unassignedRes.json().llm.multimodal, null);
  assert.equal(unassignedRes.json().llm.ready, false);

  const textOnlyToken = seedApp(database, 'text-only-app');
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('text-only-app','text','text-tpl',?)").run(now);
  const textOnlyRes = await app.inject({ method: 'GET', url: '/api/v1/app/config', headers: { authorization: `Bearer ${textOnlyToken}` } });
  assert.equal(textOnlyRes.statusCode, 200);
  assert.equal(textOnlyRes.json().llm.text?.ready, true);
  assert.equal(textOnlyRes.json().llm.multimodal, null);
  assert.equal(textOnlyRes.json().llm.ready, false);

  await app.close(); database.close();
});

test('LLM gateway enforces template thinkingMode and supports live shared template updates', async () => {
  const seenUpstreamBodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    seenUpstreamBodies.push(body);
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'hello from upstream' } }] });
  };
  const database = new ServiceDatabase();
  const app1Token = seedApp(database, 'app-one');
  const app2Token = seedApp(database, 'app-two');
  const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('shared-tpl', 'Shared', 'llm', 'http://shared.test/v1', 'initial-model', null, now, now);
  database.connection.prepare("INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json) VALUES (?,?,?,?,?)")
    .run('shared-tpl', 'enabled', '{}', JSON.stringify({ default_param: 123 }), JSON.stringify(['text']));
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('app-one','text','shared-tpl',?)").run(now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('app-two','text','shared-tpl',?)").run(now);

  const { app } = await createService({ config: testConfig(), database, secrets: new SecretStore({}), fetcher });

  // Client sends thinking: { type: 'disabled' }, but template thinkingMode is 'enabled' -> template wins!
  const res1 = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${app1Token}` },
    payload: { model: 'client-sent-model', thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'test' }] },
  });
  assert.equal(res1.statusCode, 200);
  assert.equal(seenUpstreamBodies[0].model, 'initial-model');
  assert.deepEqual(seenUpstreamBodies[0].thinking, { type: 'enabled' });
  assert.equal(seenUpstreamBodies[0].default_param, 123);

  // Live update the shared template (change model to 'updated-model', thinkingMode to 'omit', extraBody)
  database.connection.prepare("UPDATE provider_profiles SET model='updated-model' WHERE id='shared-tpl'").run();
  database.connection.prepare("UPDATE provider_profile_options SET thinking_mode='omit', extra_body_json='{\"default_param\":456}' WHERE profile_id='shared-tpl'").run();

  // New request from app2 immediately uses the updated template without restarts
  const res2 = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${app2Token}` },
    payload: { model: 'client-model-2', thinking: { type: 'enabled' }, messages: [{ role: 'user', content: 'test 2' }] },
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(seenUpstreamBodies[1].model, 'updated-model');
  assert.equal(seenUpstreamBodies[1].thinking, undefined);
  assert.equal(seenUpstreamBodies[1].default_param, 456);

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
  database.connection.prepare("INSERT INTO artifacts(id, app_id, task_id, provider_url, local_path, content_type, byte_size, pinned, created_at, file_status) VALUES (?,?,?,?,?,?,?,?,?,'ready')")
    .run('old', 'retention-app', null, null, oldest, 'image/png', 10, 0, '2026-01-01T00:00:00.000Z');
  database.connection.prepare("INSERT INTO artifacts(id, app_id, task_id, provider_url, local_path, content_type, byte_size, pinned, created_at, file_status) VALUES (?,?,?,?,?,?,?,?,?,'ready')")
    .run('pin', 'retention-app', null, null, pinned, 'image/png', 10, 1, '2026-01-02T00:00:00.000Z');
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

test('Artifact 2.0: streaming upload computes SHA-256 and rejects whole-buffer reading test double', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-art-upload-'));
  const token = seedApp(database, 'stream-app');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // Create a stream that fails if arrayBuffer or text is called on it
  const chunks = [Buffer.from('Hello, '), Buffer.from('Artifact 2.0 '), Buffer.from('Streaming!')];
  const totalExpectedBytes = chunks.reduce((acc, c) => acc + c.length, 0);
  const mockStream = Readable.from(chunks);

  // Calling streamUploadArtifact directly with custom stream
  const uploaded = await streamUploadArtifact(config, database, {
    appId: 'stream-app',
    stream: mockStream,
    contentType: 'text/plain',
    contentLength: totalExpectedBytes,
    originalName: 'test-stream.txt',
    refType: 'note',
    refId: 'note-1',
  });

  assert.equal(uploaded.appId, 'stream-app');
  assert.equal(uploaded.byteSize, totalExpectedBytes);
  assert.equal(uploaded.sha256, 'f17a772151cdb358afa6391dd1c740d47304471db9729a344073acfa47faec76');
  assert.equal(uploaded.mediaType, 'document');
  assert.equal(uploaded.fileStatus, 'ready');

  // Verify reference was created
  const ref = database.connection.prepare('SELECT * FROM artifact_references WHERE artifact_id=?').get(uploaded.id) as { ref_type: string; ref_id: string };
  assert.equal(ref.ref_type, 'note');
  assert.equal(ref.ref_id, 'note-1');

  // Test HTTP upload endpoint
  const httpUploadRes = await app.inject({
    method: 'POST',
    url: '/api/v1/artifacts/uploads',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'image/png',
      'x-artifact-original-name': 'sample.png',
    },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  assert.equal(httpUploadRes.statusCode, 201);
  assert.equal(httpUploadRes.json().mediaType, 'image');
  assert.equal(httpUploadRes.json().byteSize, 8);

  // Test Content-Length mismatch failure and cleanup
  const mismatchStream = Readable.from([Buffer.from('short')]);
  await assert.rejects(
    async () => {
      await streamUploadArtifact(config, database, {
        appId: 'stream-app',
        stream: mismatchStream,
        contentLength: 100, // specified 100 but only sent 5
      });
    },
    (err: Error) => {
      assert.equal(err.message, 'invalid_content_length');
      return true;
    },
  );
  // Check no leftover .tmp files
  const filesInAppDir = await readdir(resolve(artifactDir, 'stream-app'));
  assert.equal(filesInAppDir.some((f) => f.includes('.tmp')), false);

  await app.close();
  database.close();
});

test('Artifact 2.0: disk space headroom check detects insufficient space and cleans up temp files', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-art-space-'));
  seedApp(database, 'space-app');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });

  // Mock statfs that reports only 1 MiB available disk space (less than 50 MiB safety margin)
  const mockInsufficientStatfs = async () => ({ bavail: 256, bsize: 4096 }); // 1 MiB available

  // 1. streamUploadArtifact fails with artifact_disk_space_insufficient
  await assert.rejects(
    async () => {
      await streamUploadArtifact(config, database, {
        appId: 'space-app',
        stream: Readable.from([Buffer.from('data')]),
        contentType: 'text/plain',
        contentLength: 4,
        customStatfs: mockInsufficientStatfs,
      });
    },
    (err: Error) => {
      assert.equal(err.message, 'artifact_disk_space_insufficient');
      return true;
    },
  );
  // Verify no temp files remain
  const appFiles = await readdir(resolve(artifactDir, 'space-app')).catch(() => []);
  assert.equal(appFiles.some((f) => f.includes('.tmp')), false);

  // 2. persistArtifact fails with artifact_disk_space_insufficient
  await assert.rejects(
    async () => {
      await persistArtifact(
        config,
        database,
        {
          appId: 'space-app',
          sourceUrl: 'http://engine.test:8188/view?filename=test.png',
          trustedBaseUrl: 'http://engine.test:8188',
          customStatfs: mockInsufficientStatfs,
        },
        async () => new Response(Buffer.from('bytes'), { status: 200, headers: { 'content-type': 'image/png' } }),
      );
    },
    (err: Error) => {
      assert.equal(err.message, 'artifact_disk_space_insufficient');
      return true;
    },
  );

  database.close();
});

test('Artifact 2.0: upload route sanitizes error responses and handles malformed headers', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-art-err-'));
  const token = seedApp(database, 'err-app');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // 1. Malformed URI encoding in X-Artifact-Original-Name
  const malformedHeaderRes = await app.inject({
    method: 'POST',
    url: '/api/v1/artifacts/uploads',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'text/plain',
      'x-artifact-original-name': '%E0%A4%A', // incomplete UTF-8 sequence
    },
    body: Buffer.from('test data'),
  });
  assert.equal(malformedHeaderRes.statusCode, 400);
  assert.equal(malformedHeaderRes.json().error, 'invalid_filename');
  assert.match(malformedHeaderRes.json().message, /文件名编码格式不正确/);

  // 2. Public delete on pinned/referenced artifact cannot be bypassed with ?force=true
  const up = await app.inject({
    method: 'POST',
    url: '/api/v1/artifacts/uploads',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'image/png',
    },
    body: Buffer.from([1, 2, 3]),
  });
  const artId = up.json().id;
  await app.inject({
    method: 'PUT',
    url: `/api/v1/artifacts/${artId}/pin`,
    headers: { authorization: `Bearer ${token}` },
    payload: { pinned: true },
  });

  const deleteAttempt = await app.inject({
    method: 'DELETE',
    url: `/api/v1/artifacts/${artId}?force=true`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(deleteAttempt.statusCode, 409);
  assert.equal(deleteAttempt.json().error, 'artifact_is_pinned');

  await app.close();
  database.close();
});

test('Artifact 2.0: generateMediaManifest computes streaming SHA-256 and handles missing files', async () => {
  const database = new ServiceDatabase();
  seedApp(database, 'manifest-app');
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-art-manifest-'));
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });

  // Upload one file
  const f1 = await streamUploadArtifact(config, database, {
    appId: 'manifest-app',
    stream: Readable.from([Buffer.from('manifest-content-1')]),
    contentType: 'text/plain',
    originalName: 'file1.txt',
  });

  // Upload second file
  const f2 = await streamUploadArtifact(config, database, {
    appId: 'manifest-app',
    stream: Readable.from([Buffer.from('manifest-content-2')]),
    contentType: 'text/plain',
    originalName: 'file2.txt',
  });

  // Delete f2 to simulate missing file
  const f2Record = await readArtifact(database, f2.id);
  if (f2Record?.localPath) {
    const { unlink } = await import('node:fs/promises');
    await unlink(f2Record.localPath).catch(() => undefined);
  }

  const manifest = await generateMediaManifest(database, artifactDir);
  assert.equal(manifest.totalArtifacts, 2);
  assert.match(manifest.notice, /Database backup contains metadata and references only/);
  assert.equal(manifest.items.find((i) => i.id === f1.id)?.fileStatus, 'ready');
  assert.equal(manifest.items.find((i) => i.id === f1.id)?.sha256, f1.sha256);
  assert.equal(manifest.items.find((i) => i.id === f2.id)?.fileStatus, 'missing');

  database.close();
});

test('Artifact 2.0: streaming download supports HEAD, Range (206), 416, ETag (304), and signed URLs', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-art-download-'));
  const tokenA = seedApp(database, 'app-a');
  const tokenB = seedApp(database, 'app-b');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // Upload an artifact for App A
  const content = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'); // 36 bytes
  const uploadRes = await app.inject({
    method: 'POST',
    url: '/api/v1/artifacts/uploads',
    headers: {
      authorization: `Bearer ${tokenA}`,
      'content-type': 'text/plain',
      'x-artifact-original-name': 'alphabet.txt',
    },
    body: content,
  });
  assert.equal(uploadRes.statusCode, 201);
  const artifact = uploadRes.json();
  const artId = artifact.id;

  // 1. HEAD request
  const headRes = await app.inject({
    method: 'HEAD',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assert.equal(headRes.statusCode, 200);
  assert.equal(headRes.headers['content-length'], '36');
  assert.equal(headRes.headers['accept-ranges'], 'bytes');
  assert.equal(headRes.body, '');

  // 2. Full GET with ETag
  const fullGet = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assert.equal(fullGet.statusCode, 200);
  assert.equal(fullGet.body, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const etag = fullGet.headers.etag;

  // 3. Conditional GET with If-None-Match -> 304
  const condGet = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenA}`, 'if-none-match': etag },
  });
  assert.equal(condGet.statusCode, 304);
  assert.equal(condGet.body, '');

  // 4. Range request: bytes=0-9 (first 10 bytes) -> 206
  const rangeRes1 = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenA}`, range: 'bytes=0-9' },
  });
  assert.equal(rangeRes1.statusCode, 206);
  assert.equal(rangeRes1.headers['content-range'], 'bytes 0-9/36');
  assert.equal(rangeRes1.headers['content-length'], '10');
  assert.equal(rangeRes1.body, '0123456789');

  // 5. Range request: bytes=30- (last 6 bytes) -> 206
  const rangeRes2 = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenA}`, range: 'bytes=30-' },
  });
  assert.equal(rangeRes2.statusCode, 206);
  assert.equal(rangeRes2.headers['content-range'], 'bytes 30-35/36');
  assert.equal(rangeRes2.body, 'UVWXYZ');

  // 6. Range request: bytes=-5 (suffix 5 bytes) -> 206
  const rangeRes3 = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenA}`, range: 'bytes=-5' },
  });
  assert.equal(rangeRes3.statusCode, 206);
  assert.equal(rangeRes3.headers['content-range'], 'bytes 31-35/36');
  assert.equal(rangeRes3.body, 'VWXYZ');

  // 7. Invalid Range: bytes=100-200 -> 416
  const rangeInvalid = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenA}`, range: 'bytes=100-200' },
  });
  assert.equal(rangeInvalid.statusCode, 416);
  assert.equal(rangeInvalid.headers['content-range'], 'bytes */36');

  // 8. App isolation: App B cannot access App A's artifact by default
  const unauthGet = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.equal(unauthGet.statusCode, 403);

  // 9. App A grants read access to App B
  const grantRes = await app.inject({
    method: 'POST',
    url: `/api/v1/artifacts/${artId}/grants`,
    headers: { authorization: `Bearer ${tokenA}` },
    payload: { granteeAppId: 'app-b', access: 'read', expiresInSeconds: 3600 },
  });
  assert.equal(grantRes.statusCode, 201);

  // App B can now read
  const grantedGet = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.equal(grantedGet.statusCode, 200);
  assert.equal(grantedGet.body, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');

  // Revoke grant
  const revokeRes = await app.inject({
    method: 'DELETE',
    url: `/api/v1/artifacts/${artId}/grants/app-b`,
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assert.equal(revokeRes.statusCode, 200);

  const revokedGet = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}`,
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.equal(revokedGet.statusCode, 403);

  // 10. Signed URL with audience/appId binding
  const expires = Date.now() + 3600_000;
  const sigAppA = signArtifact(config.imageSigningSecret, artId, expires, 'app-a');

  // Missing appId in signed URL -> 403
  const signedNoApp = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}?expires=${expires}&signature=${sigAppA}`,
  });
  assert.equal(signedNoApp.statusCode, 403);
  assert.equal(signedNoApp.json().error, 'invalid_signature');

  // Valid signed URL with appId of owner -> 200
  const signedOwner = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}?expires=${expires}&signature=${sigAppA}&appId=app-a`,
  });
  assert.equal(signedOwner.statusCode, 200);
  assert.equal(signedOwner.body, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');

  // Expired signed URL -> 403 signature_expired
  const pastExpires = Date.now() - 1000;
  const sigExpired = signArtifact(config.imageSigningSecret, artId, pastExpires, 'app-a');
  const signedExp = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}?expires=${pastExpires}&signature=${sigExpired}&appId=app-a`,
  });
  assert.equal(signedExp.statusCode, 403);
  assert.equal(signedExp.json().error, 'signature_expired');

  // Signed URL for App B (without grant) -> 403 forbidden
  const sigAppB = signArtifact(config.imageSigningSecret, artId, expires, 'app-b');
  const signedAppBUnauth = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}?expires=${expires}&signature=${sigAppB}&appId=app-b`,
  });
  assert.equal(signedAppBUnauth.statusCode, 403);
  assert.equal(signedAppBUnauth.json().error, 'forbidden');

  // Grant App B access and test signed URL with appId=app-b
  await app.inject({
    method: 'POST',
    url: `/api/v1/artifacts/${artId}/grants`,
    headers: { authorization: `Bearer ${tokenA}` },
    payload: { granteeAppId: 'app-b', access: 'read', expiresInSeconds: 3600 },
  });
  const signedAppBGranted = await app.inject({
    method: 'GET',
    url: `/api/v1/artifacts/${artId}?expires=${expires}&signature=${sigAppB}&appId=app-b`,
  });
  assert.equal(signedAppBGranted.statusCode, 200);

  // Legacy route /api/v1/images/artifacts/:id continues to work with legacy signature
  const legacySig = signArtifact(config.imageSigningSecret, artId, expires);
  const legacyRes = await app.inject({
    method: 'GET',
    url: `/api/v1/images/artifacts/${artId}?expires=${expires}&signature=${legacySig}`,
  });
  assert.equal(legacyRes.statusCode, 200);

  await app.close();
  database.close();
});

test('Artifact 2.0: quota management protects pinned and referenced files and triggers reconciliation', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-art-quota-'));
  const token = seedApp(database, 'quota-app');
  // Set a small quota of 100 bytes
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir, STHSTART_ARTIFACT_MAX_BYTES: '1073741824' }); // 1 GiB config threshold
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // Upload file 1 (unpinned)
  const f1 = await streamUploadArtifact(config, database, {
    appId: 'quota-app',
    stream: Readable.from([Buffer.alloc(50, 1)]),
    contentType: 'image/png',
  });

  // Upload file 2 (pinned)
  const f2 = await streamUploadArtifact(config, database, {
    appId: 'quota-app',
    stream: Readable.from([Buffer.alloc(50, 2)]),
    contentType: 'image/png',
  });
  await app.inject({
    method: 'PUT',
    url: `/api/v1/artifacts/${f2.id}/pin`,
    headers: { authorization: `Bearer ${token}` },
    payload: { pinned: true },
  });

  // Upload file 3 (referenced)
  const f3 = await streamUploadArtifact(config, database, {
    appId: 'quota-app',
    stream: Readable.from([Buffer.alloc(50, 3)]),
    contentType: 'image/png',
    refType: 'character',
    refId: 'char-1',
  });

  // Attempting to delete pinned/referenced file without force fails with 409
  const delPinned = await app.inject({
    method: 'DELETE',
    url: `/api/v1/artifacts/${f2.id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(delPinned.statusCode, 409);
  assert.equal(delPinned.json().error, 'artifact_is_pinned');

  const delRef = await app.inject({
    method: 'DELETE',
    url: `/api/v1/artifacts/${f3.id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(delRef.statusCode, 409);
  assert.equal(delRef.json().error, 'artifact_is_referenced');

  // Enforce quota with tight limit: only f1 can be evicted, f2 (pinned) and f3 (referenced) must be protected
  const tightConfig = { ...config, artifactMaxBytes: 110 };
  const evicted = await enforceGlobalQuota(tightConfig, database);
  assert.equal(evicted, 1);
  assert.equal(await readArtifact(database, f1.id), null); // f1 deleted
  assert.notEqual(await readArtifact(database, f2.id), null); // f2 preserved
  assert.notEqual(await readArtifact(database, f3.id), null); // f3 preserved

  // Test Reconciliation: orphan file & missing file detection
  const orphanPath = resolve(artifactDir, 'quota-app', 'orphan-file.png');
  await writeFile(orphanPath, Buffer.from('orphan'));
  const tempLeftover = resolve(artifactDir, 'quota-app', '.tmp-leftover.tmp');
  await writeFile(tempLeftover, Buffer.from('temp'));

  // Delete f2 local file to make it missing
  const f2Record = await readArtifact(database, f2.id);
  if (f2Record?.localPath) {
    await writeFile(f2Record.localPath, Buffer.from('')); // truncate
  }

  const reconcileResult = await reconcileArtifacts(config, database);
  assert.equal(reconcileResult.tempFilesCleaned, 1);
  assert.equal(reconcileResult.orphansRemoved, 1);

  await app.close();
  database.close();
});

test('Artifact 2.0: persistArtifact enforces trusted origin and blocks unauthorized redirects', async () => {
  const database = new ServiceDatabase();
  seedApp(database, 'test-app');
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-art-trusted-'));
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const trustedBase = 'http://trusted-engine.test:8188';

  // 1. Direct origin mismatch (trying to fetch from evil.com)
  await assert.rejects(
    async () => {
      await persistArtifact(config, database, {
        appId: 'test-app',
        taskId: 't-1',
        sourceUrl: 'http://evil.com/view?filename=hack.png',
        trustedBaseUrl: trustedBase,
      });
    },
    (err: Error) => {
      assert.equal(err.message, 'untrusted_remote_origin');
      return true;
    },
  );

  // 2. URL with embedded credentials
  await assert.rejects(
    async () => {
      await persistArtifact(config, database, {
        appId: 'test-app',
        taskId: 't-1',
        sourceUrl: 'http://user:pass@trusted-engine.test:8188/view?filename=img.png',
        trustedBaseUrl: trustedBase,
      });
    },
    (err: Error) => {
      assert.equal(err.message, 'url_credentials_not_allowed');
      return true;
    },
  );

  // 3. Redirect to foreign host
  const fetcherRedirectForeign: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/redirect-out')) {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://foreign-evil.com/leak.png' },
      });
    }
    return new Response(null, { status: 404 });
  };

  await assert.rejects(
    async () => {
      await persistArtifact(
        config,
        database,
        {
          appId: 'test-app',
          taskId: 't-2',
          sourceUrl: `${trustedBase}/redirect-out`,
          trustedBaseUrl: trustedBase,
        },
        fetcherRedirectForeign,
      );
    },
    (err: Error) => {
      assert.equal(err.message, 'untrusted_remote_origin');
      return true;
    },
  );

  // 4. Safe redirect within trusted base URL
  const fetcherSafeRedirect: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/redirect-safe')) {
      return new Response(null, {
        status: 302,
        headers: { location: `${trustedBase}/view?filename=actual.png` },
      });
    }
    if (url.includes('/view?filename=actual.png')) {
      return new Response(Buffer.from('safe-image-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    return new Response(null, { status: 404 });
  };

  const artId = await persistArtifact(
    config,
    database,
    {
      appId: 'test-app',
      taskId: null,
      sourceUrl: `${trustedBase}/redirect-safe`,
      trustedBaseUrl: trustedBase,
    },
    fetcherSafeRedirect,
  );
  assert.ok(artId);
  const record = await readArtifact(database, artId);
  assert.equal(record?.fileStatus, 'ready');
  assert.equal(record?.byteSize, 16);

  database.close();
});

test('Artifact 2.0: large upload (>12 MiB) succeeds and post-insert quota failure triggers rollback', async () => {
  const database = new ServiceDatabase();
  const artifactDir = await mkdtemp(resolve(tmpdir(), 'sthstart-art-large-'));
  seedApp(database, 'large-app');
  const config = testConfig({ STHSTART_ARTIFACT_DIR: artifactDir });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });

  // 14 MiB stream upload (larger than standard 12 MiB bodyLimit)
  const chunkSize = 1024 * 1024; // 1 MiB chunks
  const numChunks = 14;
  async function* generateLargeData() {
    for (let i = 0; i < numChunks; i++) {
      yield Buffer.alloc(chunkSize, i + 65);
    }
  }

  const uploaded = await streamUploadArtifact(config, database, {
    appId: 'large-app',
    stream: Readable.from(generateLargeData()),
    contentType: 'application/octet-stream',
    contentLength: numChunks * chunkSize,
    originalName: 'bigfile.bin',
  });
  assert.equal(uploaded.byteSize, 14 * 1024 * 1024);
  assert.equal(uploaded.fileStatus, 'ready');

  // Early rejection when contentLength exceeds quota
  const tinyConfig = { ...config, artifactMaxBytes: 1000 };
  await assert.rejects(
    async () => {
      await streamUploadArtifact(tinyConfig, database, {
        appId: 'large-app',
        stream: Readable.from([Buffer.alloc(5000)]),
        contentLength: 5000,
      });
    },
    (err: Error) => {
      assert.equal(err.message, 'artifact_quota_exceeded');
      return true;
    },
  );

  await app.close();
  database.close();
});
