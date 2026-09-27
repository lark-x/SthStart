import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { SecretStore, issueToken } from './security.js';
import { callLlm } from './activities/text-jobs.js';

function count(database: ServiceDatabase, sql: string) {
  return Number((database.connection.prepare(sql).get() as { count: number }).count);
}

test('activity stage LLM calls keep the business event, prompt, answer, and usage', async () => {
  const database = new ServiceDatabase(':memory:');
  const profile = {
    id: 'activity-test-model', name: 'Activity Test Model', baseUrl: 'https://llm.example.test/v1', model: 'story-model',
    secret: null, thinkingMode: 'omit' as const, headers: {}, extraBody: {},
  };
  const fetcher: typeof fetch = async () => Response.json({
    choices: [{ message: { content: '完成阶段草稿。' } }], usage: { prompt_tokens: 17, completion_tokens: 6 },
  });
  try {
    const answer = await callLlm(profile, '请撰写下一阶段。', fetcher, undefined, {
      database, businessEvent: 'activity.text.stage', objectType: 'activity', objectId: 'activity-test',
    });
    assert.equal(answer, '完成阶段草稿。');
    assert.equal(count(database, 'SELECT COUNT(*) count FROM ai_call_records'), 1);
    const record = database.connection.prepare('SELECT application_id,business_event,object_id,status,positive_prompt,response_text,usage_json FROM ai_call_records')
      .get() as Record<string, string>;
    assert.equal(record.application_id, 'activities');
    assert.equal(record.business_event, 'activity.text.stage');
    assert.equal(record.object_id, 'activity-test');
    assert.equal(record.status, 'succeeded');
    assert.equal(record.positive_prompt, '请撰写下一阶段。');
    assert.equal(record.response_text, '完成阶段草稿。');
    assert.deepEqual(JSON.parse(record.usage_json), { prompt_tokens: 17, completion_tokens: 6 });
  } finally { database.close(); }
});

test('managed chat streaming and vector embedding each create a safe public audit record', async () => {
  const appToken = issueToken('linshe-audit-test');
  const previousToken = process.env.STHSTART_APP_TOKEN;
  process.env.STHSTART_APP_TOKEN = appToken;
  const database = new ServiceDatabase(':memory:');
  let llmAuthorization = '';
  const streamText = `data: {"choices":[{"delta":{"content":"hello upstream-secret-value image data:image/png;base64,QUJDREVGRw=="}}]}\n\ndata: [DONE]\n\n`;
  const streamBytes = new TextEncoder().encode(streamText);
  const secretBoundary = streamText.indexOf('upstream-secret-value') + 'upstream-secret-'.length;
  const mediaBoundary = streamText.indexOf('base64,') + 'base64,'.length + 3;
  const chunks = [streamBytes.slice(0, secretBoundary), streamBytes.slice(secretBoundary, mediaBoundary), streamBytes.slice(mediaBoundary)];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/chat/completions')) {
      llmAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      } });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.endsWith('/embed')) return Response.json({ embeddings: [[0.1, 0.2]] });
    return new Response('not found', { status: 404 });
  };
  const secrets = new SecretStore({ STHSTART_SECRET_LINSHE_AUDIT_MODEL: 'upstream-secret-value' });
  const { app } = await createService({
    config: readConfig({ STHSTART_ADMIN_TOKEN: 'ai-integration-admin-token-123456', STHSTART_VECTOR_URL: 'https://vector.example.test' }),
    database, secrets, fetcher,
  });
  if (previousToken === undefined) delete process.env.STHSTART_APP_TOKEN;
  else process.env.STHSTART_APP_TOKEN = previousToken;

  const now = new Date().toISOString();
  database.connection.prepare(`INSERT INTO provider_profiles
    (id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`)
    .run('linshe-audit-model', 'Hosted LLM', 'llm', 'https://llm.example.test/v1', 'hosted-model', 'profile:linshe-audit-model', now, now);
  database.connection.prepare(`INSERT INTO provider_profile_options(profile_id,thinking_mode,headers_json,extra_body_json)
    VALUES ('linshe-audit-model','omit','{}',?)`).run(JSON.stringify({ custom_api_key: 'upstream-secret-value' }));
  database.connection.prepare(`INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('linshe','text','linshe-audit-model',?)`).run(now);

  try {
    const stream = await app.inject({ method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${appToken}` }, payload: { model: 'ignored-client-model', stream: true, messages: [{ role: 'user', content: 'hello' }] } });
    assert.equal(stream.statusCode, 200, stream.body);
    assert.equal(stream.body, streamText);
    assert.equal(llmAuthorization, 'Bearer upstream-secret-value');

    const vector = await app.inject({ method: 'POST', url: '/api/v1/vector/embed',
      headers: { authorization: `Bearer ${appToken}` }, payload: { text: '向量审计测试' } });
    assert.equal(vector.statusCode, 200, vector.body);
    assert.deepEqual(vector.json().embeddings, [[0.1, 0.2]]);

    assert.equal(count(database, 'SELECT COUNT(*) count FROM ai_call_records'), 2);
    const records = database.connection.prepare('SELECT application_id,business_event,call_type,status,response_text,request_snapshot_json FROM ai_call_records ORDER BY business_event')
      .all() as Array<Record<string, string>>;
    assert.deepEqual(records.map((row) => [row.business_event, row.call_type, row.status]), [
      ['public.chat.completion', 'text', 'succeeded'],
      ['public.vector.embed', 'embedding', 'succeeded'],
    ]);
    assert.match(records[0].response_text, /hello/);
    assert.match(records[0].response_text, /\[REDACTED_MEDIA_DATA_URL\]/);
    assert.match(records[1].response_text, /0\.1/);
    assert.doesNotMatch(JSON.stringify(records), /upstream-secret-value|QUJDREVGRw==/);
    const chatEvents = database.connection.prepare("SELECT phase FROM ai_call_events WHERE call_id=(SELECT id FROM ai_call_records WHERE business_event='public.chat.completion') ORDER BY id")
      .all() as Array<{ phase: string }>;
    assert.deepEqual(chatEvents.map((event) => event.phase), ['requested', 'submitted', 'stream_completed']);
    const fullAudit = JSON.stringify({ records: database.connection.prepare('SELECT * FROM ai_call_records').all(), events: database.connection.prepare('SELECT * FROM ai_call_events').all() });
    assert.doesNotMatch(fullAudit, /upstream-secret-value|QUJDREVGRw==/);
  } finally {
    await app.close(); database.close();
  }
});
