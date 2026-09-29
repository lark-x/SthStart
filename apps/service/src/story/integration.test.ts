import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createService } from '../server.js';
import { readConfig } from '../config.js';
import { ServiceDatabase, nowIso } from '../database.js';
import { SecretStore } from '../security.js';
import { StoryStore } from './store.js';

async function freePort(): Promise<number> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const port = address.port; server.close(); await once(server, 'close'); return port;
}

test('Story API runs DSH through the public text gateway and continues a session after process restart', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'sthstart-story-integration-'));
  let calls = 0;
  let outlineId = '';
  const provider = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    calls++;
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as { model?: string };
    assert.equal(payload.model, 'story-mock-model');
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (calls === 3) {
      response.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'story-mock-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-story-proposal', type: 'function', function: {
        name: 'mcp__story__story_propose_outline_change', arguments: JSON.stringify({ targetId: outlineId, baseRevision: 1, proposedTitle: '主线大纲', proposedBody: '新的冲突升级', reason: '让人物动机更清楚' }),
      } }] }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'story-mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
      response.end('data: [DONE]\n\n'); return;
    }
    response.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'story-mock-model', choices: [{ index: 0, delta: { role: 'assistant', content: `第${calls}轮答复` }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'story-mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const providerAddress = provider.address(); assert.ok(providerAddress && typeof providerAddress !== 'string');
  const servicePort = await freePort();
  const config = readConfig({ SERVICE_PORT: String(servicePort), STHSTART_DATABASE_PATH: resolve(root, 'story.db'),
    STHSTART_NARRATIVE_DATABASE_PATH: resolve(root, 'narrative.db'), STHSTART_ARTIFACT_DIR: resolve(root, 'artifacts'),
    STHSTART_ADMIN_TOKEN: 'story-integration-admin-token-1234567890' });
  const database = new ServiceDatabase(config.databasePath);
  let app: Awaited<ReturnType<typeof createService>>['app'] | undefined;
  try {
    ({ app } = await createService({ config, database, secrets: new SecretStore({}) }));
    const now = nowIso();
    database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
      VALUES ('story-mock','Mock','llm',?,'story-mock-model',NULL,1,?,?)`).run(`http://127.0.0.1:${providerAddress.port}/v1`, now, now);
    database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('story','text','story-mock',?)").run(now);
    const store = new StoryStore(database);
    const project = store.createProject({ title: '雾港' });
    const session = store.createSession(project.id, '主线讨论');
    outlineId = store.listDocuments(project.id)[0]!.id;
    await app.listen({ host: '127.0.0.1', port: servicePort });
    const headers = { 'x-sthstart-admin-token': config.adminToken! };
    const url = `/api/v1/admin/story/projects/${project.id}/sessions/${session.id}/messages`;
    const eventsAbort = new AbortController();
    const events = await fetch(`http://127.0.0.1:${servicePort}/api/v1/admin/story/projects/${project.id}/sessions/${session.id}/events`,
      { headers, signal: eventsAbort.signal });
    assert.equal(events.status, 200);
    const eventReader = events.body!.getReader();
    for (let turn = 1; turn <= 2; turn++) {
      const sent: { statusCode: number; body: string } = await app.inject({ method: 'POST', url, headers, payload: { content: `请讨论第${turn}幕`, idempotencyKey: `turn-${turn}-key` } });
      assert.equal(sent.statusCode, 202, sent.body);
      for (let attempt = 0; attempt < 150 && store.requireSession(project.id, session.id).status === 'running'; attempt++) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      assert.equal(store.requireSession(project.id, session.id).status, 'idle');
      assert.match(store.listMessages(project.id, session.id).at(-1)!.content, new RegExp(`第${turn}轮答复`));
    }
    const proposalTurn: { statusCode: number; body: string } = await app.inject({ method: 'POST', url, headers,
      payload: { content: '请提出主线修改提案', idempotencyKey: 'turn-3-proposal' } });
    assert.equal(proposalTurn.statusCode, 202, proposalTurn.body);
    for (let attempt = 0; attempt < 150 && store.requireSession(project.id, session.id).status === 'running'; attempt++) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.equal(store.requireSession(project.id, session.id).status, 'idle');
    assert.equal(store.listProposals(project.id).length, 1, 'MCP tool must create one pending proposal');
    assert.equal(store.listProposals(project.id)[0]!.status, 'pending');
    assert.equal(store.listDocuments(project.id)[0]!.body, '', 'proposal must not change canon');
    let eventText = '';
    for (let attempt = 0; attempt < 20 && !eventText.includes('event: completed'); attempt++) {
      const next = await Promise.race([
        eventReader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SSE event timed out')), 1000)),
      ]);
      eventText += new TextDecoder().decode(next.value);
    }
    assert.match(eventText, /event: completed/);
    eventsAbort.abort();
    const compacted = await app.inject({ method: 'POST',
      url: `/api/v1/admin/story/projects/${project.id}/sessions/${session.id}/compact`, headers, payload: {} });
    assert.equal(compacted.statusCode, 200, compacted.body);
    assert.equal(typeof compacted.json().compacted, 'boolean');
    assert.ok(calls >= 2);
  } finally {
    if (app) await app.close(); database.close(); provider.close(); await rm(root, { recursive: true, force: true });
  }
});
