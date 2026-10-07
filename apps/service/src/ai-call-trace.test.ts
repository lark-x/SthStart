import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceDatabase } from './database.js';
import { registerAiCallRoutes } from './ai-call-routes.js';
import { appendAiCallEvent, createAiCallRecord, extractModelNames, recordAiCallStream, redactAiValue, updateAiCallRecord } from './ai-call-trace.js';
import type { ServiceConfig } from './config.js';
import { nowIso } from './database.js';

const ADMIN_TOKEN = 'ai-call-audit-test-admin-token';

test('AI audit redaction removes credentials and multimodal data URLs recursively', () => {
  const redacted = redactAiValue({
    apiKey: 'secret-one', token: 'secret-two', nested: { authorization: 'Bearer secret-three' },
    prompt: 'image data:image/png;base64,QUJDRA== and https://user:pass@example.test/x?access_token=abc&signature=def',
  }) as Record<string, unknown>;
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.equal(redacted.token, '[REDACTED]');
  assert.equal((redacted.nested as Record<string, unknown>).authorization, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(redacted), /secret-one|secret-two|secret-three|QUJDRA|user:pass|access_token=abc|signature=def/);
});

test('model extraction ignores ComfyUI node links under model inputs', () => {
  assert.deepEqual(extractModelNames({
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly-fp16.safetensors' } },
    '2': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['3', 0] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'subject' } },
  }), ['v1-5-pruned-emaonly-fp16.safetensors']);
});

test('audit persistence redacts configured extension secrets across record, event, response, and stream boundaries', async () => {
  const database = new ServiceDatabase();
  const secret = 'extension-secret-value-should-never-be-written';
  const callId = createAiCallRecord(database, {
    applicationId: 'test', feature: 'stream', businessEvent: 'test.stream', callType: 'llm',
    redactionSecrets: [secret], positivePrompt: `before ${secret} after`,
    requestSnapshot: { extensionParameters: { api_key: secret }, note: `configured value ${secret}` },
  });
  updateAiCallRecord(database, callId, {
    responseText: `provider echo: ${secret}`, event: 'provider_response', detail: { nested: `echo ${secret}` }, redactionSecrets: [secret],
  });
  const payload = 'x'.repeat(126) + secret + 'y'.repeat(98) + 'data:image/png;base64,QUJDREVGRw==';
  const source = `data: {"text":"${payload}"}\n\n`;
  const encoded = new TextEncoder().encode(source);
  // This places the beginning of the credential just before the redactor's
  // normal emit boundary, exercising the partial-prefix case.
  const splitAt = Buffer.byteLength('data: {"text":"') + 128;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, splitAt));
      controller.enqueue(encoded.slice(splitAt));
      controller.close();
    },
  });
  const audited = recordAiCallStream(database, callId, stream, 'succeeded', [secret]);
  assert.equal(await new Response(audited).text(), source, 'SSE bytes pass through unchanged');
  const row = database.connection.prepare('SELECT response_text,status FROM ai_call_records WHERE id=?').get(callId) as { response_text: string; status: string };
  assert.match(row.response_text, /\[REDACTED_MEDIA_DATA_URL\]/);
  assert.doesNotMatch(row.response_text, /QUJDREVGRw==/);
  assert.doesNotMatch(row.response_text, new RegExp(secret));
  const persisted = JSON.stringify({ record: database.connection.prepare('SELECT * FROM ai_call_records WHERE id=?').get(callId),
    events: database.connection.prepare('SELECT * FROM ai_call_events WHERE call_id=?').all(callId) });
  assert.doesNotMatch(persisted, new RegExp(secret));
  assert.equal(row.status, 'succeeded');
  database.close();
});

test('AI stream client disconnect and upstream interruption settle their audit records', async () => {
  const database = new ServiceDatabase();
  const encoder = new TextEncoder();
  try {
    const disconnectedCallId = createAiCallRecord(database, {
      applicationId: 'test', feature: 'stream', businessEvent: 'test.stream.disconnect', callType: 'llm',
    });
    updateAiCallRecord(database, disconnectedCallId, { status: 'submitted', event: 'submitted' });
    let sourceCancelled = false;
    const disconnectSource = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode('data: first chunk\n\n')); },
      cancel() { sourceCancelled = true; },
    });
    const disconnectReader = recordAiCallStream(database, disconnectedCallId, disconnectSource).getReader();
    const firstChunk = await disconnectReader.read();
    assert.equal(new TextDecoder().decode(firstChunk.value), 'data: first chunk\n\n');
    await disconnectReader.cancel('client navigated away');

    const disconnected = database.connection.prepare('SELECT status,error_code FROM ai_call_records WHERE id=?')
      .get(disconnectedCallId) as { status: string; error_code: string | null };
    assert.equal(disconnected.status, 'abandoned');
    assert.equal(disconnected.error_code, null, 'a normal client cancel is not reported as an upstream failure');
    assert.equal(sourceCancelled, true);
    const disconnectedEvents = database.connection.prepare('SELECT phase FROM ai_call_events WHERE call_id=? ORDER BY id')
      .all(disconnectedCallId) as Array<{ phase: string }>;
    assert.deepEqual(disconnectedEvents.map((event) => event.phase), ['requested', 'submitted', 'client_disconnected']);

    const interruptedCallId = createAiCallRecord(database, {
      applicationId: 'test', feature: 'stream', businessEvent: 'test.stream.interrupted', callType: 'llm',
    });
    updateAiCallRecord(database, interruptedCallId, { status: 'submitted', event: 'submitted' });
    let emittedFirstChunk = false;
    const interruptedSource = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!emittedFirstChunk) {
          emittedFirstChunk = true;
          controller.enqueue(encoder.encode('data: partial response\n\n'));
          return;
        }
        controller.error(new Error('upstream connection reset'));
      },
    });
    const interruptedReader = recordAiCallStream(database, interruptedCallId, interruptedSource).getReader();
    const partialChunk = await interruptedReader.read();
    assert.equal(new TextDecoder().decode(partialChunk.value), 'data: partial response\n\n');
    await assert.rejects(interruptedReader.read(), /upstream connection reset/);

    const interrupted = database.connection.prepare('SELECT status,error_code,error_message FROM ai_call_records WHERE id=?')
      .get(interruptedCallId) as { status: string; error_code: string | null; error_message: string | null };
    assert.equal(interrupted.status, 'abandoned');
    assert.equal(interrupted.error_code, 'stream_interrupted');
    assert.match(interrupted.error_message ?? '', /upstream connection reset/);
    const interruptedEvents = database.connection.prepare('SELECT phase FROM ai_call_events WHERE call_id=? ORDER BY id')
      .all(interruptedCallId) as Array<{ phase: string }>;
    assert.deepEqual(interruptedEvents.map((event) => event.phase), ['requested', 'submitted', 'stream_interrupted']);
  } finally {
    database.close();
  }
});

test('AI call routes require admin auth and preserve detail after related generation data is gone', async () => {
  const database = new ServiceDatabase();
  const app = Fastify({ logger: false });
  registerAiCallRoutes(app, { adminToken: ADMIN_TOKEN } as ServiceConfig, database);
  const artifactDir = mkdtempSync(join(tmpdir(), 'sthstart-ai-call-artifact-'));
  const imagePath = join(artifactDir, 'candidate.png');
  const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  writeFileSync(imagePath, imageBytes);
  const now = nowIso();
  const knownSecret = 'known-extension-value-must-stay-private';
  database.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('activities','Activities','activities-test-hash','[]',1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,created_at,updated_at)
    VALUES ('audit-engine','Audit Engine','comfyui','http://comfy.test',1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflows(id,name,engine_kind,latest_version,created_at,updated_at)
    VALUES ('workflow-1','Audit Workflow','comfyui',3,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,definition_json,is_published,created_at)
    VALUES ('workflow-1',3,'audit-engine','{}',1,?)`).run(now);
  database.connection.prepare(`INSERT INTO generation_tasks(id,app_id,engine_id,workflow_id,workflow_version,request_hash,request_params_json,workflow_snapshot_json,status,created_at,updated_at)
    VALUES ('deleted-task','activities','audit-engine','workflow-1',3,'hash','{}','{}','succeeded',?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO artifacts(id,app_id,task_id,local_path,content_type,byte_size,created_at)
    VALUES ('deleted-artifact','activities','deleted-task','/missing/artifact.png','image/png',8,?)`).run(now);
  database.connection.prepare(`INSERT INTO artifacts(id,app_id,task_id,local_path,content_type,byte_size,sha256,created_at)
    VALUES ('available-artifact','activities','deleted-task',?,'image/png',8,'known-sha256',?)`).run(imagePath, now);
  const callId = createAiCallRecord(database, {
    traceId: 'trace-shared-test',
    applicationId: 'activities', feature: 'beat-render', businessEvent: 'activity.beat.render',
    objectType: 'activity', objectId: 'activity-1', callType: 'image', workflowId: 'workflow-1', workflowVersion: 3,
    parameters: { extensionNote: `configured ${knownSecret}` },
    requestSnapshot: { inputs: { prompt: 'safe prompt', api_key: 'do-not-return' }, extensionNote: `configured ${knownSecret}` },
    positivePrompt: `safe prompt ${knownSecret}`,
    redactionSecrets: [knownSecret],
    generationTaskId: 'deleted-task', artifactIds: ['deleted-artifact', 'missing-artifact', 'available-artifact'],
  });
  updateAiCallRecord(database, callId, { status: 'succeeded', responseText: `rendered ${knownSecret}`, redactionSecrets: [knownSecret] });
  appendAiCallEvent(database, callId, 'submitted', { providerTaskId: 'provider-1', extensionResult: knownSecret, token: 'do-not-return' }, [knownSecret]);
  createAiCallRecord(database, { traceId: 'trace-shared-test', applicationId: 'activities', feature: 'text', businessEvent: 'activity.text.stage', callType: 'llm' });
  database.connection.prepare('DELETE FROM generation_tasks WHERE id=?').run('deleted-task');
  database.connection.prepare('DELETE FROM artifacts WHERE id=?').run('deleted-artifact');

  try {
    const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/ai-calls' });
    assert.equal(denied.statusCode, 401);
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/ai-calls?applicationId=activities&businessEvent=activity.beat.render&limit=1', headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(list.statusCode, 200, list.body);
    const listed = list.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null };
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].id, callId);
    assert.equal('requestSnapshot' in listed.items[0], false, 'list uses a compact summary');
    const groupedList = await app.inject({ method: 'GET', url: '/api/v1/admin/ai-calls?traceId=trace-shared-test', headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(groupedList.statusCode, 200);
    assert.equal(groupedList.json().items.length, 2);
    const stats = await app.inject({ method: 'GET', url: '/api/v1/admin/ai-calls/stats', headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(stats.statusCode, 200, stats.body);
    assert.equal(stats.json().recordCount, 2);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${callId}`, headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(detail.statusCode, 200, detail.body);
    const payload = detail.json() as Record<string, unknown>;
    assert.equal(payload.errorCode, null);
    assert.deepEqual(payload.artifactDetails, [
      { id: 'deleted-artifact', sha256: null, available: false, previewUrl: null },
      { id: 'missing-artifact', sha256: null, available: false, previewUrl: null },
      { id: 'available-artifact', sha256: 'known-sha256', available: true, previewUrl: `/api/admin/ai-calls/${callId}/artifacts/available-artifact` },
    ]);
    assert.equal((payload.traceCalls as unknown[]).length, 2);
    assert.doesNotMatch(detail.body, /do-not-return/);
    assert.doesNotMatch(detail.body, new RegExp(knownSecret));
    const directStored = JSON.stringify({ record: database.connection.prepare('SELECT * FROM ai_call_records WHERE id=?').get(callId), events: database.connection.prepare('SELECT * FROM ai_call_events WHERE call_id=?').all(callId) });
    assert.doesNotMatch(directStored, new RegExp(knownSecret));
    assert.deepEqual((payload.events as Array<{ phase: string }>).map((event) => event.phase), ['requested', 'submitted']);
    const unauthorizedPreview = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${callId}/artifacts/available-artifact` });
    assert.equal(unauthorizedPreview.statusCode, 401);
    const unrelatedPreview = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${callId}/artifacts/not-linked`, headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(unrelatedPreview.statusCode, 404);
    const preview = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${callId}/artifacts/available-artifact`, headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(preview.statusCode, 200);
    assert.deepEqual(preview.rawPayload, imageBytes);
    assert.equal(preview.headers['cache-control'], 'private, no-store');
    unlinkSync(imagePath);
    const expiredPreview = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${callId}/artifacts/available-artifact`, headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(expiredPreview.statusCode, 404);
    const refreshedDetail = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${callId}`, headers: { 'x-sthstart-admin-token': ADMIN_TOKEN } });
    assert.equal(refreshedDetail.json().artifactDetails[2].available, false);
    assert.equal(refreshedDetail.json().artifactDetails[2].sha256, 'known-sha256');
  } finally {
    await app.close();
    database.close();
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

// 计划 §1.1：日志要能读出“实际进入文本编码器的字符串”。活动生图把整张图直接存进
// requestSnapshot（键是节点 id），配置试运行则存成 { workflow: 图 }；两种都必须认。
test('AI call detail resolves encoded texts from both activity-graph and wrapped snapshots', async () => {
  const database = new ServiceDatabase();
  const app = Fastify({ logger: false });
  registerAiCallRoutes(app, { adminToken: ADMIN_TOKEN } as ServiceConfig, database);
  const headers = { 'x-sthstart-admin-token': ADMIN_TOKEN };
  const graph = {
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'anima_baseV10_txt.safetensors', type: 'qwen_image' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 512 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'assembled positive prompt' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'assembled negative prompt' } },
    '9': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0], seed: 20260101, steps: 31 } },
  };
  const activityCallId = createAiCallRecord(database, {
    traceId: 'trace-encoded-activity', applicationId: 'activities', feature: 'beat-render',
    businessEvent: 'activity.beat.render', objectType: 'activity', objectId: 'activity-1', callType: 'image',
    requestSnapshot: graph,
  });
  const wrappedCallId = createAiCallRecord(database, {
    traceId: 'trace-encoded-wrapped', applicationId: 'creative-center', feature: 'configuration-test',
    businessEvent: 'generation.workflow.test', callType: 'image',
    requestSnapshot: { workflow: graph, inputs: { prompt: 'ignored' } },
  });
  // 图内自行拼接、无法安全解析时不得编造文本。
  const opaqueCallId = createAiCallRecord(database, {
    traceId: 'trace-encoded-opaque', applicationId: 'activities', feature: 'beat-render',
    businessEvent: 'activity.beat.render', callType: 'image',
    requestSnapshot: {
      '6': { class_type: 'CLIPTextEncode', inputs: { text: ['99', 0] } },
      '9': { class_type: 'KSampler', inputs: { positive: ['6', 0] } },
    },
  });

  try {
    const activityDetail = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${activityCallId}`, headers });
    assert.equal(activityDetail.statusCode, 200, activityDetail.body);
    assert.deepEqual(activityDetail.json().encodedTexts, [
      { nodeId: '6', input: 'text', role: 'positive', text: 'assembled positive prompt' },
      { nodeId: '7', input: 'text', role: 'negative', text: 'assembled negative prompt' },
    ]);

    const wrappedDetail = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${wrappedCallId}`, headers });
    assert.equal(wrappedDetail.statusCode, 200, wrappedDetail.body);
    assert.deepEqual(wrappedDetail.json().encodedTexts, activityDetail.json().encodedTexts);

    const opaqueDetail = await app.inject({ method: 'GET', url: `/api/v1/admin/ai-calls/${opaqueCallId}`, headers });
    assert.equal(opaqueDetail.statusCode, 200, opaqueDetail.body);
    assert.deepEqual(opaqueDetail.json().encodedTexts, [], '无法安全解析时必须返回空列表而不是猜一个文本');
  } finally {
    await app.close();
    database.close();
  }
});
