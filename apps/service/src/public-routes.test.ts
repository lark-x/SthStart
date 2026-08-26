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

  // 1. History reports execution error -> task marked failed
  let fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/history/task-err')) {
      return Response.json({
        'task-err': {
          status: { status_str: 'error', messages: [['execution_error', { exception_message: 'CUDA out of memory' }]] },
          outputs: {},
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
  await app.close();

  // 2. History returns image but /view download returns 404/500 -> task marked failed with artifact_download_failed
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
