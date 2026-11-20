import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServiceConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { SecretStore } from '../security.js';
import { connectSceneReader } from './text-mcp.js';

type ToolCall = { name: string; arguments: Record<string, unknown> };

function mockStoryMcp(
  tools: string[],
  call: (name: string, args: Record<string, unknown>) => unknown,
  _modern = false,
): { fetcher: typeof fetch; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: request.id, result });
    if (request.method === 'initialize') return reply({ protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Akasha', version: 'test' } });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (request.method === 'tools/list') return reply({ tools: tools.map((name) => ({ name, inputSchema: { type: 'object' } })) });
    assert.equal(request.method, 'tools/call');
    const toolCall = { name: request.params.name as string, arguments: request.params.arguments as Record<string, unknown> };
    calls.push(toolCall);
    const payload = call(toolCall.name, toolCall.arguments);
    return reply({ content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] });
  };
  return { fetcher, calls };
}

function readerFixture(fetcher: typeof fetch, modern = false) {
  const database = new ServiceDatabase();
  const secrets = new SecretStore({});
  const tools = modern ? ['searchAkasha', 'readSource'] : ['akasha_search', 'akasha_read'];
  database.connection.prepare(`INSERT INTO mcp_sources
    (id,name,url,auth_mode,applicable_works_json,allowed_tools_json,status,created_at,updated_at)
    VALUES ('story-reader','故事原文','https://mcp.example.test/','none','["gi"]',?,'enabled','','')`)
    .run(JSON.stringify(tools));
  const config = { akashaMcpUrl: null, akashaMcpKey: null, mcpTimeoutMs: 5_000 } as ServiceConfig;
  return { database, connect: () => connectSceneReader({ database, config, secrets, fetcher }, 'gi', ['林']) };
}

test('legacy readRecord paginates contiguous lines, checks each pathHash, and caps at 60,000 characters', async () => {
  const pageOne = 'a'.repeat(30_000);
  const pageTwo = 'b'.repeat(30_000);
  const pageThree = 'c'.repeat(20_000);
  const { fetcher, calls } = mockStoryMcp(['akasha_search', 'akasha_read'], (name, args) => {
    if (name === 'akasha_search') return { results: [{ pathHash: 'doc_long', fileName: '長文', totalLines: 3, hits: [] }] };
    const offset = Number(args.offset);
    const content = offset === 1 ? pageOne : offset === 2 ? pageTwo : pageThree;
    return {
      pathHash: 'doc_long', fileName: '長文', totalLines: 3, tags: {},
      lineRange: `${offset}-${offset}/3`, remainingCharacters: offset < 3 ? 100 : 0, content,
    };
  });
  const { database, connect } = readerFixture(fetcher);
  try {
    const reader = await connect();
    assert.ok(reader);
    assert.ok(reader.readRecord);
    const hit = (await reader.search('gi', '林', 1))[0];
    const record = await reader.readRecord('gi', hit.pathHash);
    assert.equal(record?.text.length, 60_000);
    assert.ok(record?.text.startsWith(pageOne));
    assert.ok(record?.text.endsWith('b'.repeat(29_999)));
    assert.equal(record?.complete, false);
    assert.deepEqual(calls.slice(1).map(({ arguments: args }) => args.offset), [1, 2]);
    await reader.close?.();
  } finally { database.close(); }
});

test('legacy readRecord rejects a mismatched source locator on a later page', async () => {
  const { fetcher } = mockStoryMcp(['akasha_search', 'akasha_read'], (name, args) => {
    if (name === 'akasha_search') return { results: [{ pathHash: 'doc_expected', fileName: '資料', totalLines: 2, hits: [] }] };
    const offset = Number(args.offset);
    return {
      pathHash: offset === 1 ? 'doc_expected' : 'doc_other', fileName: '資料', totalLines: 2, tags: {},
      lineRange: `${offset}-${offset}/2`, remainingCharacters: offset === 1 ? 10 : 0, content: '正文',
    };
  });
  const { database, connect } = readerFixture(fetcher);
  try {
    const reader = await connect();
    assert.ok(reader);
    assert.ok(reader.readRecord);
    const hit = (await reader.search('gi', '林', 1))[0];
    await assert.rejects(reader.readRecord('gi', hit.pathHash), /source_identity_changed/);
    await reader.close?.();
  } finally { database.close(); }
});

test('legacy readRecord detects discontinuous page ranges instead of marking the record complete', async () => {
  const { fetcher } = mockStoryMcp(['akasha_search', 'akasha_read'], (name, args) => {
    if (name === 'akasha_search') return { results: [{ pathHash: 'doc_gap', fileName: '資料', totalLines: 4, hits: [] }] };
    const offset = Number(args.offset);
    const actualStart = offset === 1 ? 1 : 4;
    return {
      pathHash: 'doc_gap', fileName: '資料', totalLines: 4, tags: {},
      lineRange: `${actualStart}-${actualStart}/4`, remainingCharacters: offset === 1 ? 10 : 0, content: '正文',
    };
  });
  const { database, connect } = readerFixture(fetcher);
  try {
    const reader = await connect();
    assert.ok(reader);
    assert.ok(reader.readRecord);
    const hit = (await reader.search('gi', '林', 1))[0];
    await assert.rejects(reader.readRecord('gi', hit.pathHash), /discontinuous_source/);
    await reader.close?.();
  } finally { database.close(); }
});

test('legacy text protocol reads every page and uses remainingCharacters metadata', async () => {
  const { fetcher } = mockStoryMcp(['akasha_search', 'akasha_read'], (name, args) => {
    if (name === 'akasha_search') return '[akasha_search]\n- 林的书 | doc_text | 2行';
    const offset = Number(args.offset);
    return [
      '[akasha_read]', '文件: 林的书 | doc_text', `范围: ${offset}-${offset} / 共2行`,
      `剩余字符数: ${offset === 1 ? 12 : 0}`, '正文:', offset === 1 ? '第一行。' : '第二行。',
    ].join('\n');
  });
  const { database, connect } = readerFixture(fetcher);
  try {
    const reader = await connect();
    assert.ok(reader);
    assert.ok(reader.readRecord);
    const hit = (await reader.search('gi', '林', 1))[0];
    const record = await reader.readRecord('gi', hit.pathHash);
    assert.deepEqual(record, { text: '第一行。\n第二行。', complete: true });
    await reader.close?.();
  } finally { database.close(); }
});

test('modern readRecord follows nextOffset and verifies cite and source identity on each page', async () => {
  const { fetcher, calls } = mockStoryMcp(['searchAkasha', 'readSource'], (name, args) => {
    if (name === 'searchAkasha') return { results: [{ chunkId: 22, cite: '林的官方故事', excerpt: '[角色故事 / Character Story] 林\n搜索命中。' }] };
    const offset = Number(args.offset ?? 0);
    const excerpt = offset === 0 ? '[角色故事 / Character Story] 林\n第一页原文。' : '第二页原文。';
    return { results: [{ chunkId: 22, cite: '林的官方故事', excerpt }], nextOffset: offset === 0 ? 1 : null };
  }, true);
  const { database, connect } = readerFixture(fetcher, true);
  try {
    const reader = await connect();
    assert.ok(reader);
    assert.ok(reader.readRecord);
    const hit = (await reader.search('gi', '林', 1))[0];
    const record = await reader.readRecord('gi', hit.pathHash);
    assert.deepEqual(record, { text: '[角色故事 / Character Story] 林\n第一页原文。\n第二页原文。', complete: true });
    assert.deepEqual(calls.slice(1).map(({ arguments: args }) => args.offset), [0, 1]);
    await reader.close?.();
  } finally { database.close(); }
});

test('modern readRecord rejects a changed cite and truncates oversized sources as incomplete', async () => {
  const mismatched = mockStoryMcp(['searchAkasha', 'readSource'], (name) => name === 'searchAkasha'
    ? { results: [{ chunkId: 9, cite: '目标来源', excerpt: '[Readable] 目标书\n搜索摘要。' }] }
    : { results: [{ chunkId: 9, cite: '另一来源', excerpt: '[Readable] 目标书\n错误正文。' }], nextOffset: null }, true);
  const first = readerFixture(mismatched.fetcher, true);
  try {
    const reader = await first.connect();
    assert.ok(reader);
    assert.ok(reader.readRecord);
    const hit = (await reader.search('gi', '林', 1))[0];
    await assert.rejects(reader.readRecord('gi', hit.pathHash), /source_identity_changed/);
    await reader.close?.();
  } finally { first.database.close(); }

  const large = mockStoryMcp(['searchAkasha', 'readSource'], (name, args) => name === 'searchAkasha'
    ? { results: [{ chunkId: 10, cite: '大型来源', excerpt: '[Readable] 大型书\n搜索摘要。' }] }
    : { results: [{ chunkId: 10, cite: '大型来源', excerpt: 'x'.repeat(60_010) }], nextOffset: null }, true);
  const second = readerFixture(large.fetcher, true);
  try {
    const reader = await second.connect();
    assert.ok(reader);
    assert.ok(reader.readRecord);
    const hit = (await reader.search('gi', '林', 1))[0];
    const record = await reader.readRecord('gi', hit.pathHash);
    assert.equal(record?.text.length, 60_000);
    assert.equal(record?.complete, false);
    await reader.close?.();
  } finally { second.database.close(); }
});
