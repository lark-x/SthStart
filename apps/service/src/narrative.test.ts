import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from './config.js';
import { ServiceDatabase } from './database.js';
import { NarrativeDatabase } from './narrative-database.js';
import { AkashaMcpConnector } from './narrative-connectors.js';
import { createService } from './server.js';
import { SecretStore } from './security.js';

const headers = { 'x-sthstart-admin-token': 'admin-test-token-that-is-long-12345678' };
const bundle = {
  schemaVersion: 1,
  source: { id: 'fixture', name: 'Fixture JSON', kind: 'json' },
  work: { externalId: 'work-1', title: '测试作品', locale: 'zh-CN' },
  release: { externalId: '1.0', label: '第一版' },
  nodes: [
    { externalId: 'chapter', kind: 'chapter', title: '序章', order: 1 },
    { externalId: 'quest', parentExternalId: 'chapter', kind: 'quest', title: '雨夜来信', order: 1 },
  ],
  scenes: [{ externalId: 'station', nodeExternalId: 'quest', title: '车站', order: 1 }],
  utterances: [
    { externalId: 'line-1', sceneExternalId: 'station', order: 1, kind: 'narration', text: '雨落在空站台。' },
    { externalId: 'line-2', sceneExternalId: 'station', order: 2, kind: 'dialogue', speaker: '林', text: '末班车已经离开了。' },
  ],
  entities: [{ externalId: 'lin', type: 'character', name: '林', aliases: ['小林'], description: '收到来信的人。' }],
} as const;

function fixture() {
  const database = new ServiceDatabase(); const narrativeDatabase = new NarrativeDatabase();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'admin-test-token-that-is-long-12345678', STHSTART_IMAGE_SIGNING_SECRET: 'image-signing-test-secret-1234567890' });
  return createService({ config, database, narrativeDatabase, secrets: new SecretStore({}) }).then((service) => ({ ...service, database, narrativeDatabase }));
}

test('narrative JSON preview commits a readable and searchable task chain idempotently', async () => {
  const { app, database, narrativeDatabase } = await fixture();
  const preview = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/imports/preview', headers, payload: bundle });
  assert.equal(preview.statusCode, 201); assert.equal(preview.json().report.incoming.utterances, 2);
  const commit = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/imports/${preview.json().id}/commit`, headers });
  assert.equal(commit.statusCode, 200); const workId = commit.json().workId as string;
  const tree = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/works/${workId}/tree`, headers });
  assert.equal(tree.json().items.length, 2); const quest = tree.json().items.find((item: { title: string }) => item.title === '雨夜来信');
  const read = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/nodes/${quest.id}/read`, headers });
  assert.equal(read.json().scenes[0].utterances[1].text, '末班车已经离开了。');
  const search = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/search?q=${encodeURIComponent('末班车')}&workId=${workId}`, headers });
  assert.equal(search.statusCode, 200); assert.equal(search.json().items.length, 1);
  const middleSearch = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/search?q=${encodeURIComponent('已经')}&workId=${workId}`, headers });
  assert.equal(middleSearch.statusCode, 200); assert.equal(middleSearch.json().items.length, 1);
  const shortSearch = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/search?q=${encodeURIComponent('已经'.slice(1))}&workId=${workId}`, headers });
  assert.equal(shortSearch.statusCode, 200); assert.equal(shortSearch.json().items.length, 1);

  const repeatedPreview = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/imports/preview', headers, payload: bundle });
  await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/imports/${repeatedPreview.json().id}/commit`, headers });
  assert.equal(narrativeDatabase.connection.prepare('SELECT COUNT(*) count FROM narrative_utterances').get()!.count, 2);

  const note = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/utterances/${read.json().scenes[0].utterances[1].id}/to-note`, headers });
  assert.equal(note.statusCode, 201);
  const saved = database.connection.prepare('SELECT content_json FROM creative_notes WHERE id=?').get(note.json().id) as { content_json: string };
  assert.match(saved.content_json, /archive-reference/); assert.match(saved.content_json, /末班车/);
  await app.close(); database.close(); narrativeDatabase.close();
});

test('narrative import rejects broken references without staging a batch', async () => {
  const { app, database, narrativeDatabase } = await fixture();
  const invalid = { ...bundle, scenes: [{ externalId: 'lost', nodeExternalId: 'missing', order: 1 }], utterances: [] };
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/imports/preview', headers, payload: invalid });
  assert.equal(response.statusCode, 400); assert.match(response.body, /不存在的节点/);
  assert.equal(narrativeDatabase.connection.prepare('SELECT COUNT(*) count FROM narrative_import_batches').get()!.count, 0);
  await app.close(); database.close(); narrativeDatabase.close();
});

test('Akasha connector stays idle until invoked and normalizes mocked documents', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> }; calls.push(request);
    const tool = (request.params as { name?: string }).name;
    if (tool === 'akasha_search') return Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: {
      results: [{ fileName: '雨夜来信', pathHash: 'doc_fixture', totalLines: 2, hits: [{ line: 1, snippet: '林：你来了。' }], tags: { 文件目录: '[图鉴,任务]' } }],
      knowledge_graph: { deliberately: 'ignored' },
    } } });
    return Response.json({ jsonrpc: '2.0', id: 2, result: { structuredContent: {
      fileName: '雨夜来信', pathHash: 'doc_fixture', totalLines: 2, tags: { 文件目录: '[图鉴,任务]' },
      content: '林：你来了。\n雨还没有停。', lineRange: '1-2', remainingCharacters: 0,
    } } });
  };
  const connector = new AkashaMcpConnector('https://mcp.test/api', 5_000, fetcher);
  assert.equal(connector.describe().status, 'ready'); assert.equal(calls.length, 0);
  const results = await connector.search('gi', '来信', 3);
  assert.equal(calls.length, 1); assert.equal(results[0].pathHash, 'doc_fixture'); assert.equal(results[0].sourceTier, 'primary');
  assert.equal('knowledge_graph' in results[0], false);
  const document = await connector.readAll('gi', results[0].pathHash);
  const normalized = await connector.normalize({ world: 'gi', document, title: results[0].fileName });
  assert.equal(normalized.work.title, '原神'); assert.equal(normalized.nodes[0].externalId, 'doc_fixture');
  assert.deepEqual(normalized.utterances.map((line) => [line.kind, line.speaker, line.text]), [
    ['dialogue', '林', '你来了。'], ['narration', undefined, '雨还没有停。'],
  ]);
});
