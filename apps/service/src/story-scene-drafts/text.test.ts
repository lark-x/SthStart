import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneBrief, SceneMessage, SceneSource, StorySceneDraft } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { SecretStore } from '../security.js';
import { collectSceneSources, compactScenePassages, resolveSceneEvidence, sourceKind, type SceneSourceReader } from './text-evidence.js';
import { createStorySceneTextActions } from './text.js';

const timestamp = '2026-11-19T08:00:00.000Z';
const brief: SceneBrief = { viewpoint: '林', action: '把钥匙交给守门人', change: '接下了对方的承诺', constraints: ['天黑前不能进门'] };

function fixture(overrides: Partial<StorySceneDraft> = {}): StorySceneDraft {
  return {
    id: 'scene', revision: 1, title: '交钥匙', character: { name: '林', origin: 'hsr' }, progress: 'start', createdAt: timestamp, updatedAt: timestamp,
    notes: '', lockedConstraints: [], authorSources: [], sources: [], candidates: [], start: null, discovery: null,
    direction: null, messages: [], brief: null, briefConfirmed: false, format: 'story', body: '', bodyVersion: 1,
    writingCandidate: null, imagePlan: null, images: [], adoption: null, currentAction: null, ...overrides,
  };
}

test('retrieval limits work-scoped searches and reads, deduplicates by locator, and prioritizes confirmed source types', async () => {
  const searches: unknown[][] = [];
  const reads: unknown[][] = [];
  const documents = [
    ['wiki', '百科学习笔记'], ['unknown', '目录待确认'], ['official', '02-任务'],
    ['books', '03-书籍'], ['voice', '04-角色语音'], ['more', '攻略'],
  ].map(([pathHash, category]) => ({
    pathHash, fileName: pathHash, totalLines: 100, tags: { 文件目录: category }, sourceTier: 'primary' as const,
    hits: [{ line: 42, snippet: '林回到候车室。' }],
  }));
  const reader: SceneSourceReader = {
    async search(...args) { searches.push(args); return documents; },
    async read(...args) {
      reads.push(args);
      return { fileName: `精读 ${args[1]}`, pathHash: args[1], tags: {}, totalLines: 100, remainingCharacters: 1, lineRange: '37-39', content: '夜色渐深。\n\n林回到候车室。' };
    },
  };
  const result = await collectSceneSources(fixture(), ['小林'], reader, false);
  assert.deepEqual(searches, [['hsr', '林', 8], ['hsr', '小林', 8]]);
  assert.deepEqual(reads, ['official', 'books', 'voice', 'unknown'].map((locator) => ['hsr', locator, 37, 12]));
  assert.deepEqual(result.sources.map((source) => source.kind), ['canon', 'canon', 'canon', 'unknown']);
  assert.deepEqual(result.sources.map((source) => [source.startLine, source.endLine]), [[37, 39], [37, 39], [37, 39], [37, 39]]);
  assert.equal(result.sources[0].locator, 'akasha:hsr:official');
  assert.equal(result.sources[0].excerpt, '夜色渐深。\n\n林回到候车室。');
  assert.equal(result.discovery.status, 'ready');
  assert.equal((await collectSceneSources(fixture(), ['小林'], reader, false)).sources[0].id, result.sources[0].id);
});

test('a substantial title-only in-game story outranks a stub, and a wiki book mirror is secondary', async () => {
  const reads: string[] = [];
  const reader: SceneSourceReader = {
    async search() {
      return [
        ['mirror', 'miyoushe/书籍/未分类', 50],
        ['stub', 'ingame_zh/17-物品资料', 3],
        ['book', 'ingame_zh/16-阅读物/01-任务道具', 38],
      ].map(([pathHash, path, totalLines]) => ({
        pathHash: String(pathHash), fileName: '林的旅记', totalLines: Number(totalLines), hits: [], tags: { 文件目录: String(path) }, sourceTier: 'primary' as const,
      }));
    },
    async read(_world, pathHash) {
      reads.push(pathHash);
      return { pathHash, fileName: '林的旅记', totalLines: 50, tags: {}, content: '林抵达港口。', lineRange: '1-1', remainingCharacters: 0 };
    },
  };
  const result = await collectSceneSources(fixture(), [], reader, false);
  assert.deepEqual(reads, ['book', 'stub', 'mirror']);
  assert.deepEqual(result.sources.map(({ kind }) => kind), ['canon', 'canon', 'secondary']);
});

test('modern source headers establish canon and title-only index cards remain unknown', () => {
  assert.equal(sourceKind({}, '[Readable] 温妮莎传奇·下篇'), 'canon');
  assert.equal(sourceKind({}, '[角色故事 / Character Story] 琴 / Jean'), 'canon');
  assert.equal(sourceKind({}, '温妮莎传奇'), 'unknown');
});

test('a multilingual book yields its body and a location clue stays scoped to the character', async () => {
  const keywords: string[] = [];
  const book = '# ZH:林的故事 | EN:Lin\n\n## 正文\n风吹开铁门，少女走进监牢。';
  const reader: SceneSourceReader = {
    async search(_world, keyword) {
      keywords.push(keyword);
      return [{ pathHash: 'book', fileName: '林的故事', tags: {}, totalLines: 4, hits: [], sourceTier: 'primary' }];
    },
    async read() { return { pathHash: 'book', fileName: '林的故事', tags: {}, totalLines: 4, lineRange: '1-4', content: book, remainingCharacters: 0 }; },
    async readRecord() { return { text: book, complete: true }; },
  };
  const ref = { status: 'author' as const, sourceIds: [], note: '' };
  const result = await collectSceneSources(fixture({ start: { location: '监牢', time: '', hook: '', timeEvidence: ref, locationEvidence: ref } }), [], reader, false);
  assert.deepEqual(keywords, ['林', '林 监牢']);
  assert.equal(result.sources[0]?.startLine, 4);
  assert.equal(result.sources[0]?.excerpt, '风吹开铁门，少女走进监牢。');
  assert.equal(result.sources[0]?.fullText, book);
});

test('line-only hits are read while metadata and chapter indexes are excluded from source cards', async () => {
  const reader: SceneSourceReader = {
    async search() {
      return [
        { pathHash: 'index', fileName: '温妮莎传奇', totalLines: 12, tags: { 文件目录: 'ingame_zh/16-阅读物' }, hits: [{ line: 1, snippet: '' }], sourceTier: 'primary' },
        { pathHash: 'story', fileName: '原作记录', totalLines: 12, tags: { 文件目录: 'ingame_zh/16-阅读物' }, hits: [{ line: 8, snippet: '' }], sourceTier: 'primary' },
      ];
    },
    async read(_world, pathHash) {
      const content = pathHash === 'index'
        ? '# 温妮莎传奇\n\n## 基本信息\n\n| 项目 | 内容 |\n|---|---|\n| 书名 | 温妮莎传奇 |\n| 类型 | 书籍 |\n\n## 第1章：温妮莎传奇·上篇\n\n**描述：**自蒙德城重建起，广为传唱的歌谣。'
        : '[Readable] 原作记录\n\n林走进候车室，站在屏幕前。';
      const readable = content.split('\n').slice(0, 12).join('\n');
      const start = pathHash === 'story' ? 3 : 1;
      return { pathHash, fileName: pathHash, totalLines: 12, tags: {}, content: readable, lineRange: `${start}-12`, remainingCharacters: 0 };
    },
  };
  const result = await collectSceneSources(fixture({ character: { name: '林', origin: 'gi' } }), [], reader, false);
  assert.equal(result.discovery.status, 'ready');
  assert.deepEqual(result.sources.map(({ locator }) => locator), ['akasha:gi:story']);
  assert.match(result.sources[0].excerpt, /林走进候车室/);
});

test('separate evidence checks validate exact passage, character presence, temporal scope and source authority', () => {
  const canon: SceneSource = {
    id: 'canon', title: '列车停靠记录', work: '星铁', locator: 'akasha:hsr:doc_fixture', kind: 'canon', startLine: 11, endLine: 22,
    excerpt: [
      '门开之后，林站在候车室看着屏幕。', '林提到旧剧院。', '林挥了挥手，白川来到旧剧院。',
      '有人传言，林曾抵达港口。', '任务解锁条件：林到达旧剧院。', '旧码头是这趟旅程的终点。',
      '据记载，领路的林，曾在生命结束之刻来到此地。', '林回了家，黄昏时白川走进港口。',
      '林来到东码头。', '骑士来到旧港。', '北岸与东港隔海相望。', '林抵达此处。',
    ].join('\n'),
  };
  const secondary = { ...canon, id: 'wiki', kind: 'secondary' as const };
  const passages = compactScenePassages([canon, secondary], ['林', '骑士']);
  const check = (field: 'time' | 'location', value: string, refs: string[], hypothesis = false) =>
    resolveSceneEvidence(field, value, refs, passages, '林', hypothesis);
  assert.equal(check('time', '门开之后', ['1.11']).status, 'supported');
  assert.equal(check('location', '候车室', ['1.11']).status, 'supported');
  assert.equal(check('time', '当晚八时', ['1.11']).status, 'inferred');
  assert.equal(check('location', '旧剧院', ['1.12']).status, 'inferred');
  assert.equal(check('location', '旧剧院', ['1.13']).status, 'inferred');
  assert.equal(check('location', '港口', ['1.14']).status, 'inferred');
  assert.equal(check('location', '旧剧院', ['1.15']).status, 'inferred');
  assert.equal(check('location', '候车室', ['2.11']).status, 'inferred');
  assert.equal(check('location', '候车室', ['1.11'], true).status, 'inferred');
  assert.deepEqual(check('location', '候车室', ['99.11']).sourceIds, []);
  assert.equal(check('location', '候车室', ['99.11']).status, 'unconfirmed');
  assert.equal(check('location', '旧码头', ['1.16', '1.17']).status, 'supported');
  assert.equal(check('time', '生命结束之刻', ['1.17']).status, 'supported');
  assert.equal(check('location', '旧码头', ['1.17']).status, 'inferred');
  assert.equal(check('location', '旧码头', ['2.16', '1.17']).status, 'inferred');
  assert.equal(check('time', '黄昏时', ['1.18']).status, 'inferred');
  assert.equal(check('location', '东', ['1.19']).status, 'inferred');
  assert.equal(check('location', '旧港', ['1.20']).status, 'inferred');
  assert.equal(check('location', '北岸', ['1.21', '1.22']).status, 'inferred');
});

function modelFixture(fetcher: typeof fetch, configOverrides: Partial<ServiceConfig> = {}) {
  const database = new ServiceDatabase();
  const secrets = new SecretStore({});
  database.connection.exec(`
    INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
      VALUES ('story-worlds','故事世界','test-hash','[]',1,'','');
    INSERT INTO service_connections(id,name,kind,base_url,created_at,updated_at)
      VALUES ('provider','Test','openai-compatible-text','https://model.example.test/v1','','');
    INSERT INTO model_profiles(id,connection_id,name,model_id,created_at,updated_at)
      VALUES ('profile','provider','Test','scene-test','','');
    INSERT INTO purpose_bindings(id,app_id,purpose_key,target_type,target_id,updated_at)
      VALUES ('binding','story-worlds','authoring','model','profile','');
  `);
  const config = { akashaMcpUrl: null, akashaMcpKey: null, mcpTimeoutMs: 5_000, ...configOverrides } as ServiceConfig;
  return { database, run: createStorySceneTextActions({ database, config, secrets, fetcher }) };
}

const completion = (value: unknown) => Response.json({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] });
const request = { expectedRevision: 1, idempotencyKey: 'test' };

test('timeouts remain recoverable and pasted material works without the remote source', async () => {
  const sourceCalls: string[] = [];
  let modelCalls = 0;
  const { database, run } = modelFixture(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('mcp.example.test')) {
      if (body.method === 'tools/call') sourceCalls.push(body.params.name);
      throw new DOMException('timeout', 'TimeoutError');
    }
    modelCalls += 1;
    const { sources } = JSON.parse(body.messages[1].content);
    assert.equal(sources[0].kind, 'author');
    return completion({ candidates: [{ time: '', location: '候车室', hook: '林第一次独自等车',
      timeRefs: ['1.99'], locationRefs: ['1.1'],
    }] });
  }, { akashaMcpUrl: 'https://mcp.example.test/' });
  try {
    const outage = await run(fixture(), { ...request, action: 'discover' }, { actionId: 'outage' });
    assert.equal(outage.action, 'discover');
    assert.equal(outage.discovery.status, 'timeout');
    assert.equal(modelCalls, 0);
    const authorSources = [{ title: '作者草案', locator: '第一段', text: '林站在候车室等车。' }];
    const result = await run(fixture({ character: { name: '林', work: '夜车', origin: 'other' }, authorSources }),
      { ...request, action: 'discover' }, { actionId: 'pasted' });
    assert.equal(result.action, 'discover');
    assert.equal(result.candidates[0].locationEvidence.status, 'author');
    assert.equal(result.candidates[0].timeEvidence.status, 'unconfirmed');
    assert.equal(result.sources[0].locator, '第一段');
    assert.deepEqual(sourceCalls, ['akasha_search']);
    assert.equal(modelCalls, 1);
  } finally { database.close(); }
});

function mockStoryMcp(
  tools: string[], call: (name: string, args: Record<string, unknown>) => unknown,
): typeof fetch {
  return async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: request.id, result });
    if (request.method === 'initialize') return reply({ protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Akasha', version: '1' } });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (request.method === 'tools/list') return reply({ tools: tools.map((name) => ({ name, inputSchema: { type: 'object' } })) });
    assert.equal(request.method, 'tools/call');
    const payload = call(request.params.name, request.params.arguments);
    return reply({ content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] });
  };
}

test('modern GI MCP reads the hit chunk, uses chunk-local coordinates, and limits the action to four distinct sources', async () => {
  const calls: unknown[][] = [];
  const first = { chunkId: 20, cite: '镇史 · 第一卷', excerpt: '[Readable] 镇史\n搜索摘要并不等于精读原文。' };
  const excerpt = '[Readable] 镇史\n门开之后，林站在候车室看着屏幕。';
  const late = `${['[Readable] 异地镇史', ...Array.from({ length: 19 }, () => '一行背景。')].join('\n')}\n林到达码头。`;
  const mcp = mockStoryMcp(['searchAkasha', 'readSource'], (tool, args) => {
    calls.push([tool, args]);
    if (tool === 'searchAkasha') return { results: [first, { ...first, chunkId: 21 }, { ...first, chunkId: 22, excerpt: late },
      ...[23, 24, 25].map((chunkId) => ({ chunkId, cite: `镇史 · ${chunkId}`, excerpt: first.excerpt }))] };
    assert.equal(tool, 'readSource');
    return { results: [{ ...first, chunkId: 19, excerpt: '前一段文本' }, { cite: first.cite, chunkId: args.chunkId, excerpt: args.chunkId === 22 ? late : excerpt }] };
  });
  const { database, run } = modelFixture(async (url, init) => {
    if (String(url).includes('mcp.example.test')) return mcp(url, init);
    const body = JSON.parse(String(init?.body));
    const { sources } = JSON.parse(body.messages[1].content) as { sources: Array<{ kind: string; lines: Record<string, string> }> };
    assert.ok(sources.every(({ kind }) => kind === 'canon'));
    assert.match(sources[0].lines['1.21'], /林到达码头/);
    assert.equal(sources[1].lines['2.2'], '门开之后，林站在候车室看着屏幕。');
    return completion({ candidates: [{ time: '门开之后', location: '候车室', hook: '林关掉旧屏幕', timeRefs: ['2.2'], locationRefs: ['2.2'] }] });
  }, { akashaMcpUrl: 'https://mcp.example.test/' });
  try {
    const result = await run(fixture({ character: { name: '林', origin: 'gi' } }), { ...request, action: 'discover' }, { actionId: 'modern' });
    assert.equal(result.action, 'discover');
    assert.equal(result.discovery.status, 'ready');
    assert.deepEqual(result.sources.map(({ startLine, endLine }) => [startLine, endLine]), [[16, 21], [1, 2], [1, 2], [1, 2]]);
    assert.deepEqual(calls[0], ['searchAkasha', { query: '林', topK: 8 }]);
    assert.deepEqual(calls.slice(1), [22, 20, 23, 24].flatMap((chunkId) => [
      ['readSource', { chunkId, scope: 'source', limit: 3 }],
      ['readSource', { chunkId, scope: 'source', offset: 0, limit: 3 }],
    ]));
    assert.equal(result.sources[1].locator, 'akasha:gi:chunk:20');
    assert.equal(result.candidates[0].locationEvidence.status, 'supported');
    assert.equal(result.candidates[0].timeEvidence.status, 'supported');
  } finally { database.close(); }
});

test('HSR prefers its scoped Story MCP, then uses the enabled global source while its preset is disabled', async () => {
  const calls: unknown[][] = [];
  const usedSources: string[] = [];
  const mcp = mockStoryMcp(['akasha_search', 'akasha_read'], (tool, args) => {
    calls.push([tool, args]);
    if (tool === 'akasha_search') return { results: [{ pathHash: 'doc_fixture', fileName: '列车记录', tags: { 文件目录: '02-任务' }, hits: [{ line: 48 }] }] };
    return { pathHash: 'doc_fixture', fileName: '列车记录', content: '林走进候车室。', lineRange: '43-43', totalLines: 50 };
  });
  const { database, run } = modelFixture(async (url, init) => {
    assert.ok(!String(url).includes('genshin.example.test'));
    if (String(url).includes('hsr.example.test') || String(url).includes('global.example.test')) {
      if (JSON.parse(String(init?.body)).method === 'initialize') usedSources.push(String(url));
      return mcp(url, init);
    }
    return completion({ candidates: [] });
  }, { akashaMcpUrl: 'https://genshin.example.test/' });
  database.connection.exec(`
    INSERT INTO mcp_sources (id,name,url,auth_mode,applicable_works_json,allowed_tools_json,status,created_at,updated_at)
    VALUES ('hsr-story','星铁资料','https://hsr.example.test/','none','["hsr"]','["akasha_search","akasha_read"]','enabled','',''),
           ('global-story','通用资料','https://global.example.test/','none','[]','["akasha_search","akasha_read"]','enabled','','2026'),
           ('akasha-terminal','已停用预设','https://genshin.example.test/','none','["gi"]','["akasha_search","akasha_read"]','disabled','','');
  `);
  try {
    const result = await run(fixture(), { ...request, action: 'discover' }, { actionId: 'starrail' });
    assert.equal(result.action, 'discover');
    assert.equal(result.sources[0].kind, 'canon');
    assert.deepEqual(calls, [['akasha_search', { world: 'hsr', keyword: '林', maxResults: 8 }],
      ['akasha_read', { world: 'hsr', pathHash: 'doc_fixture', offset: 43, limit: 12 }],
      ['akasha_read', { world: 'hsr', pathHash: 'doc_fixture', offset: 1, limit: 2000 }]]);
    database.connection.exec("UPDATE mcp_sources SET status='disabled' WHERE id='hsr-story'");
    const fallback = await run(fixture(), { ...request, action: 'discover' }, { actionId: 'starrail-global' });
    assert.equal(fallback.action, 'discover');
    assert.equal(fallback.sources[0].kind, 'canon');
    assert.deepEqual(usedSources, ['https://hsr.example.test/', 'https://global.example.test/']);
  } finally { database.close(); }
});

test('legacy Story MCP accepts text search and read results, groups title-only hits, and rejects mismatched read locators', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const mcp = mockStoryMcp(['akasha_search', 'akasha_read'], (tool, args) => {
    calls.push(args);
    if (tool === 'akasha_search') return [
      '[akasha_search]', '查询: 林', '书名 2', '- 林的旅记 | doc_book | 2行 | 文件目录=ingame_zh/16-阅读物',
      '- 林的百科 | doc_wiki | 200行 | 文件目录=moegirl', '内容 1',
      '- 林的百科 | doc_wiki | 200行 | 文件目录=moegirl', '  L61: 林到达港口。',
    ].join('\n');
    if (args.pathHash === 'doc_book') return '[akasha_read]\n文件: 林的旅记 | doc_book\n目录: ingame_zh/16-阅读物\n范围: 1-2 / 共2行\n正文:\n门开之后，林抵达港口。\n海水很凉。';
    return '[akasha_read]\n文件: 错误资料 | doc_different\n目录: ingame_zh/16-阅读物\n范围: 56-56 / 共200行\n正文:\n林抵达港口。';
  });
  const { database, run } = modelFixture(async (url, init) => String(url).includes('mcp.example.test') ? mcp(url, init) : completion({ candidates: [] }),
    { akashaMcpUrl: 'https://mcp.example.test/' });
  try {
    const result = await run(fixture(), { ...request, action: 'discover' }, { actionId: 'legacy-text' });
    assert.equal(result.action, 'discover');
    assert.deepEqual(calls, [{ world: 'hsr', keyword: '林', maxResults: 8 }, { world: 'hsr', pathHash: 'doc_book', offset: 1, limit: 12 },
      { world: 'hsr', pathHash: 'doc_book', offset: 1, limit: 2000 }, { world: 'hsr', pathHash: 'doc_wiki', offset: 56, limit: 12 }]);
    assert.deepEqual(result.sources.map(({ title, excerpt, locator, kind }) => ({ title, excerpt, locator, kind })), [
      { title: '林的旅记', excerpt: '门开之后，林抵达港口。\n海水很凉。', locator: 'akasha:hsr:doc_book', kind: 'canon' },
    ]);
    assert.match(result.discovery.message, /部分资料读取失败/);
  } finally { database.close(); }
});

test('discussion, writing, and image planning use one auditable request and bounded context', async () => {
  const requests: any[] = [];
  const responses = [
    { text: '这一轮从林的视角。', suggestedBrief: brief },
    '```markdown\n林把钥匙交给门卫。\n```',
    { moment: '林把钥匙交给门卫。', subject: '伸手的林', camera: '门外近景', blocking: '林在门外，门卫在门内', action: '把钥匙递进门缝', occlusion: '门只挡住门卫的肩', style: '水彩' },
  ];
  const { database, run } = modelFixture(async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return completion(responses[requests.length - 1]);
  });
  try {
    const messages: SceneMessage[] = Array.from({ length: 20 }, (_, index) => ({ id: `m-${index}`, role: 'assistant', text: `历史 ${index}`, createdAt: timestamp }));
    const incoming: SceneMessage = { id: 'm-author', role: 'author', text: '换成林视角', createdAt: timestamp };
    const draft = fixture({ messages: [...messages, incoming], brief, briefConfirmed: true, format: 'script', direction: 'if', lockedConstraints: ['不使用旁白'] });
    const discussion = await run(draft, { ...request, action: 'discuss', message: incoming.text }, { actionId: 'discuss', message: incoming });
    assert.equal(discussion.action, 'discuss');
    assert.deepEqual(discussion.message.suggestedBrief, brief);
    const write = await run(draft, { ...request, action: 'write' }, { actionId: 'write' });
    assert.deepEqual(write, { action: 'write', body: '林把钥匙交给门卫。' });
    assert.equal(write.action, 'write');
    const draftWithImage = { ...draft, body: write.body,
      imagePlan: { ...responses[2] as NonNullable<StorySceneDraft['imagePlan']>, id: 'plan', version: 1, bodyVersion: 1, referenceArtifactId: 'saved-artifact' } };
    const image = await run(draftWithImage, { ...request, action: 'plan-image', instruction: '门内门外要分清' }, { actionId: 'image' });
    assert.equal(image.action, 'plan-image');
    assert.equal(image.plan.referenceArtifactId, 'saved-artifact');
    assert.equal(requests.length, 3);
    const discussionPrompt = JSON.parse(requests[0].messages[1].content);
    assert.equal(discussionPrompt.recentMessages.length, 8);
    assert.deepEqual(discussionPrompt.recentMessages.at(-1), { role: 'author', text: incoming.text });
    assert.equal(discussionPrompt.briefConfirmed, true);
    assert.deepEqual(discussionPrompt.lockedConstraints, ['不使用旁白']);
    assert.equal(requests[1].response_format, undefined);
    assert.equal(JSON.parse(requests[1].messages[1].content).format, 'script');
    assert.equal(JSON.parse(requests[2].messages[1].content).body, write.body);
    const records = database.connection.prepare('SELECT trace_id, status, object_id FROM ai_call_records ORDER BY rowid').all();
    assert.deepEqual(records.map(({ trace_id }) => trace_id), ['discuss', 'write', 'image']);
    assert.ok(records.every(({ status, object_id }) => status === 'succeeded' && object_id === 'scene'));
  } finally { database.close(); }
});

test('IF writing uses the confirmed event and divergence from the fork snapshot', async () => {
  const accepted = { ...brief, canonEvent: '林原本将唯一的钥匙交给守门人。', divergence: '林在守门人伸手时自己收回钥匙。' };
  const earlier: SceneMessage = {
    id: 'older-brainstorm', role: 'assistant', text: '第一种设想是钥匙在见到守门人前就被扔掉。', createdAt: timestamp,
    suggestedBrief: { ...accepted, divergence: '提前扔掉钥匙。' },
  };
  let calls = 0;
  const { database, run } = modelFixture(async (_url, init) => {
    calls++;
    const payload = JSON.parse(String(init?.body));
    const context = JSON.parse(payload.messages[1].content);
    assert.equal(context.direction, 'if');
    assert.equal(context.briefConfirmed, true);
    assert.deepEqual(context.brief, accepted);
    assert.deepEqual(context.recentMessages, [{ role: 'assistant', text: earlier.text }]);
    assert.deepEqual(context.lockedConstraints, ['见面前只有这一把钥匙']);
    return Response.json({ choices: [{ finish_reason: 'stop', message: {
      role: 'assistant', reasoning_content: '内部思考', content: '守门人摊开手。林把已经递出去的钥匙攥回掌心。',
    } }], usage: { total_tokens: 240 } });
  });
  try {
    const draft = fixture({ id: 'if-fork', forkedFrom: 'canon-draft', direction: 'if', brief: accepted,
      briefConfirmed: true, messages: [earlier], lockedConstraints: ['见面前只有这一把钥匙'] });
    const result = await run(draft, { ...request, action: 'write', instruction: '保持林视角，少写旁白' }, { actionId: 'write-if' });
    assert.deepEqual(result, { action: 'write', body: '守门人摊开手。林把已经递出去的钥匙攥回掌心。' });
    assert.equal(calls, 1);
    assert.equal(database.connection.prepare('SELECT object_id FROM ai_call_records WHERE trace_id=?').get('write-if')?.object_id, 'if-fork');
  } finally { database.close(); }
});

test('supplier rejection returns safe copy and dispatches once, while malformed discovery keeps the sources', async () => {
  let calls = 0;
  const { database, run } = modelFixture(async () => {
    if (++calls === 1) return Response.json({ error: 'secret=do-not-forward' }, { status: 422 });
    return completion({ candidates: [], tool: 'not a supported key' });
  });
  try {
    await assert.rejects(run(fixture(), { ...request, action: 'write' }, { actionId: 'failure' }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code: string }).code, 'story_scene_model_rejected');
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
    assert.equal(calls, 1);
    const result = await run(fixture({ character: { name: '林', origin: 'original' }, authorSources: [{ title: '我的设定', text: '林是守门人。' }] }),
      { ...request, action: 'discover' }, { actionId: 'invalid' });
    assert.equal(result.action, 'discover');
    assert.equal(result.discovery.status, 'unavailable');
    assert.equal(result.sources[0].title, '我的设定');
    assert.equal(result.candidates.length, 0);
  } finally { database.close(); }
});

test('scene text disables thinking on a cloned profile and reports an empty length-limited completion without another request', async () => {
  let calls = 0;
  const { database, run } = modelFixture(async (_url, init) => {
    calls++;
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.equal(payload.reasoning_effort, undefined);
    assert.equal(payload.max_tokens, 4_000);
    return Response.json({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: null } }],
      usage: { completion_tokens: 4_000, completion_tokens_details: { reasoning_tokens: 3_997 } } });
  });
  try {
    database.connection.exec("UPDATE model_profiles SET thinking_level='high' WHERE id='profile'");
    const draft = fixture({ character: { name: '林', origin: 'original' }, authorSources: [{ title: '设定', text: '林在港口等船。' }] });
    const result = await run(draft, { ...request, action: 'discover' }, { actionId: 'thinking-regression' });
    assert.equal(result.action, 'discover');
    assert.equal(result.discovery.status, 'unavailable');
    assert.match(result.discovery.message, /输出额度/);
    assert.equal(result.sources.length, 1);
    assert.equal(calls, 1);
    const audit = database.connection.prepare('SELECT status, error_code, usage_json FROM ai_call_records WHERE trace_id=?').get('thinking-regression');
    assert.equal(audit?.status, 'failed');
    assert.equal(audit?.error_code, 'story_scene_model_output_truncated');
    assert.equal(JSON.parse(String(audit?.usage_json)).completion_tokens, 4_000);
    assert.equal(database.connection.prepare('SELECT thinking_level FROM model_profiles WHERE id=?').get('profile')?.thinking_level, 'high');
  } finally { database.close(); }
});
