import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../config.js';
import { ServiceDatabase } from '../database.js';
import { NarrativeDatabase } from '../narrative-database.js';
import { createService } from '../server.js';
import { SecretStore } from '../security.js';
import { LocalNarrativeCorpusProvider } from './corpus.js';
import { ResearchStore } from './store.js';
import { validateClaim, natureForClaims, unresolvedSynthesisIds, mergeCandidates, dedupeCandidates } from './engine.js';
import { executeResearchRun } from './run.js';
import { dedupeSuggestions } from './topics.js';
import { parseTopicSuggestions, parseClaims, parseQueryPlan, parseSynthesis, parseVerification } from './prompts.js';

const headers = { 'x-sthstart-admin-token': 'admin-test-token-that-is-long-12345678' };

/** 语料 fixture：两个节点、三段台词，够验证检索、上下文与证据冻结。 */
const bundle = {
  schemaVersion: 1,
  source: { id: 'fixture', name: 'Fixture JSON', kind: 'json' },
  work: { externalId: 'work-1', title: '测试作品', locale: 'zh-CN' },
  release: { externalId: '1.0', label: '第一版' },
  nodes: [
    { externalId: 'chapter', kind: 'chapter', title: '序章', order: 1 },
    { externalId: 'quest', parentExternalId: 'chapter', kind: 'quest', title: '雨夜来信', order: 1, summary: '赤王与禁忌知识相关的线索出现。' },
  ],
  scenes: [{ externalId: 'station', nodeExternalId: 'quest', title: '车站', order: 1 }],
  utterances: [
    { externalId: 'line-1', sceneExternalId: 'station', order: 1, kind: 'narration', text: '雨落在空站台，赤王的传说在石碑上被反复涂改。' },
    { externalId: 'line-2', sceneExternalId: 'station', order: 2, kind: 'dialogue', speaker: '林', text: '禁忌知识不是他能碰的东西。' },
    { externalId: 'line-3', sceneExternalId: 'station', order: 3, kind: 'dialogue', speaker: '澈', text: '可石碑上写的是相反的结论。' },
  ],
  entities: [{ externalId: 'lin', type: 'character', name: '林', aliases: ['小林'], description: '收到来信的人。' }],
} as const;

async function fixture() {
  const database = new ServiceDatabase();
  const narrativeDatabase = new NarrativeDatabase();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'admin-test-token-that-is-long-12345678', STHSTART_IMAGE_SIGNING_SECRET: 'image-signing-test-secret-1234567890' });
  const service = await createService({ config, database, narrativeDatabase, secrets: new SecretStore({}) });
  const preview = await service.app.inject({ method: 'POST', url: '/api/v1/admin/narrative/imports/preview', headers, payload: bundle });
  const commit = await service.app.inject({ method: 'POST', url: `/api/v1/admin/narrative/imports/${preview.json().id}/commit`, headers });
  return { ...service, database, narrativeDatabase, workId: commit.json().workId as string };
}

test('local corpus provider exposes catalog, search, read and version', async () => {
  const { database, narrativeDatabase, workId } = await fixture();
  const provider = new LocalNarrativeCorpusProvider(narrativeDatabase);

  const status = await provider.status();
  assert.equal(status.status, 'ready');
  assert.equal(status.workCount, 1);

  const catalog = await provider.catalog({ workId });
  assert.equal(catalog.items.length, 2);
  const quest = catalog.items.find((item) => item.title === '雨夜来信')!;
  assert.equal(quest.utteranceCount, 3);

  // 短中文词必须走 LIKE 回退，否则 trigram 分词命中不到。
  const short = await provider.search({ workId, text: '赤王' });
  assert.equal(short.strategy, 'like');
  assert.ok(short.items.length >= 1);

  const long = await provider.search({ workId, text: '禁忌知识' });
  assert.ok(long.items.length >= 1);
  assert.equal(long.items[0].nodeId, quest.nodeId);

  // 同一场景只保留一条，避免同段对白挤掉其它场景。
  const sceneKeys = new Set(long.items.filter((item) => item.sceneId).map((item) => item.sceneId));
  assert.equal(sceneKeys.size, long.items.filter((item) => item.sceneId).length);

  const hit = short.items[0];
  const document = await provider.read({ targetType: hit.targetType, targetId: hit.targetId, contextSize: 1 });
  assert.ok(document);
  assert.equal(document!.targetId, hit.targetId);
  assert.ok(document!.locator.includes('雨夜来信'));
  assert.ok(document!.contentHash.length === 64);

  const version = await provider.version({ workId });
  assert.equal(version.nodeCount, 2);
  assert.equal(version.utteranceCount, 3);

  await database.close(); narrativeDatabase.close();
});

test('corpus scope narrows search to the selected node and its children', async () => {
  const { database, narrativeDatabase, workId } = await fixture();
  const provider = new LocalNarrativeCorpusProvider(narrativeDatabase);
  const catalog = await provider.catalog({ workId });
  const chapter = catalog.items.find((item) => item.title === '序章')!;

  // 选中父节点时子节点也要算在内，否则「选定章节」会搜不到内容。
  const scoped = await provider.search({ workId, text: '禁忌知识', nodeIds: [chapter.nodeId] });
  assert.ok(scoped.items.length >= 1);

  const byKind = await provider.search({ workId, text: '禁忌知识', nodeKinds: ['chapter'] });
  assert.equal(byKind.items.length, 0);

  await database.close(); narrativeDatabase.close();
});

test('claim validation enforces per-type evidence minimums', () => {
  const availableEvidenceIds = new Set(['e1', 'e2']);
  const evidenceQuotes = new Map([['e1', '赤王的传说被反复涂改'], ['e2', '石碑上写的是相反的结论']]);
  const context = { availableEvidenceIds, evidenceQuotes };

  assert.equal(validateClaim({ claimType: 'fact', body: '赤王的传说被反复涂改', uncertainty: '', evidenceIds: ['e1'], counterEvidenceIds: [] }, context).effectiveType, 'fact');
  // 事实没有证据时不能通过。
  const noEvidence = validateClaim({ claimType: 'fact', body: '凭空结论', uncertainty: '', evidenceIds: [], counterEvidenceIds: [] }, context);
  assert.equal(noEvidence.ok, false);
  assert.equal(noEvidence.effectiveType, 'open-question');
  // 推论只有一条证据时降级为猜想，而不是接受为 inference。
  const weakInference = validateClaim({ claimType: 'inference', body: '赤王的传说被反复涂改', uncertainty: '', evidenceIds: ['e1'], counterEvidenceIds: [] }, context);
  assert.equal(weakInference.ok, false);
  assert.equal(weakInference.effectiveType, 'speculation');
  // 猜想必须写明不确定性。
  assert.equal(validateClaim({ claimType: 'speculation', body: 'x', uncertainty: '', evidenceIds: [], counterEvidenceIds: [] }, context).ok, false);
  assert.equal(validateClaim({ claimType: 'speculation', body: 'x', uncertainty: '没有直接证据', evidenceIds: [], counterEvidenceIds: [] }, context).effectiveType, 'speculation');
  // 矛盾需要两条互相冲突的证据。
  assert.equal(validateClaim({ claimType: 'contradiction', body: 'x', uncertainty: '', evidenceIds: ['e1'], counterEvidenceIds: ['e2'] }, context).effectiveType, 'contradiction');
  // 不存在的证据 ID 必须被拒绝。
  const bogus = validateClaim({ claimType: 'fact', body: 'x', uncertainty: '', evidenceIds: ['e9'], counterEvidenceIds: [] }, context);
  assert.equal(bogus.ok, false);
  assert.match(bogus.reason!, /不存在的证据 ID/);
});

test('publication nature is canon only when every accepted claim is a fact', () => {
  assert.equal(natureForClaims(['fact', 'fact']), 'canon');
  assert.equal(natureForClaims(['fact', 'inference']), 'unconfirmed');
  assert.equal(natureForClaims(['open-question']), 'unconfirmed');
  assert.equal(natureForClaims([]), 'unconfirmed');
});

test('synthesis rejects unresolved evidence and claim references', () => {
  const result = unresolvedSynthesisIds(
    { sections: [{ evidenceIds: ['e1', 'gone'], claimIds: ['c1', 'lost'] }], evidenceIndex: [{ evidenceId: 'e2' }] },
    { evidenceIds: new Set(['e1']), claimIds: new Set(['c1']) },
  );
  assert.deepEqual(result.evidence.sort(), ['e2', 'gone']);
  assert.deepEqual(result.claims, ['lost']);
});

test('candidate merging dedupes by target and respects the analysis window', () => {
  const make = (id: string, query: string) => ({
    targetType: 'utterance' as const, targetId: id, nodeId: 'n1', sceneId: 's1', locator: 'l', quote: 'q',
    contextBefore: '', contextAfter: '', contentHash: 'h', sourceVersion: {}, fromQuery: query,
  });
  const merged = mergeCandidates([[make('a', 'q1'), make('b', 'q1')], [make('a', 'q2'), make('c', 'q2')]]);
  assert.deepEqual(merged.items.map((item) => item.targetId), ['a', 'b', 'c']);
  assert.equal(merged.truncated, false);
  // 同一目标被两个问题命中时保留第一条，来源问题用于审核解释。
  assert.equal(merged.items[0].fromQuery, 'q1');
  assert.equal(dedupeCandidates([make('a', 'q1'), make('a', 'q2')]).length, 1);
});

test('topic suggestions require real seed evidence and drop near-duplicates', () => {
  const parsed = parseTopicSuggestions(JSON.stringify([
    { title: '赤王与禁忌知识', question: 'q', reason: 'r', keywords: ['赤王'], entities: [], seedEvidence: [{ nodeTitle: '雨夜来信', quote: '赤王的传说' }], duplicateOf: '' },
    { title: '赤王与禁忌知识', question: 'q2', reason: 'r2', keywords: ['赤王'], entities: [], seedEvidence: [{ nodeTitle: '雨夜来信', quote: '赤王的传说' }], duplicateOf: '' },
    { title: '没有证据的主题', question: 'q3', reason: 'r3', keywords: [], entities: [], seedEvidence: [], duplicateOf: '' },
  ]));
  // 没有种子证据的候选在解析阶段就被丢弃。
  assert.equal(parsed.length, 2);
  const { kept, dropped } = dedupeSuggestions(parsed);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 1);
});

test('AI parsers tolerate fenced JSON and reject malformed shapes', () => {
  const plan = parseQueryPlan('```json\n[{"question":"赤王是谁","keywords":["赤王"],"nodeKinds":[],"entities":[],"stopCondition":"够了"}]\n```');
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].keywords, ['赤王']);

  const claims = parseClaims(JSON.stringify([{ title: 't', claimType: 'fact', body: 'b', explanation: 'e', evidenceIds: ['e1'], counterEvidenceIds: [], uncertainty: '', nextSteps: '' }]));
  assert.equal(claims.length, 1);
  // 缺 title 或 body 的条目被过滤。
  assert.equal(parseClaims(JSON.stringify([{ claimType: 'fact' }])).length, 0);

  const verification = parseVerification(JSON.stringify([{ id: 'c1', claimType: 'inference', issues: [], counterEvidenceIds: [], uncertainty: 'u', evidenceSufficient: true }]));
  assert.equal(verification.length, 1);
  assert.equal(verification[0].evidenceSufficient, true);

  const synthesis = parseSynthesis(JSON.stringify({ title: 'T', summary: 'S', sections: [{ heading: '研究问题', body: 'B', claimIds: ['c1'], evidenceIds: ['e1'] }], evidenceIndex: [{ evidenceId: 'e1', locator: 'L', note: 'N' }] }));
  assert.equal(synthesis.sections.length, 1);
  assert.equal(synthesis.evidenceIndex.length, 1);
});

test('research routes reject research before the topic is confirmed', async () => {
  const { app, database, narrativeDatabase, workId } = await fixture();
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/research/projects', headers, payload: { workId, title: '赤王与禁忌知识', question: '两者有什么关系？' } });
  assert.equal(created.statusCode, 201);
  const projectId = created.json().id as string;
  assert.equal(created.json().status, 'draft');

  const blocked = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/runs`, headers });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error, 'project_not_confirmed');

  const confirmed = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/confirm`, headers });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.json().status, 'confirmed');

  await app.close(); database.close(); narrativeDatabase.close();
});

test('project updates reject a stale revision', async () => {
  const { app, database, narrativeDatabase, workId } = await fixture();
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/research/projects', headers, payload: { workId, title: '主题', question: 'q' } });
  const projectId = created.json().id as string;
  const first = await app.inject({ method: 'PATCH', url: `/api/v1/admin/narrative/research/projects/${projectId}`, headers, payload: { title: '主题 v2', revision: 1 } });
  assert.equal(first.statusCode, 200);
  // 用已经过期的 revision 再改一次必须被拒绝，避免旧结果覆盖新主题。
  const stale = await app.inject({ method: 'PATCH', url: `/api/v1/admin/narrative/research/projects/${projectId}`, headers, payload: { title: '主题 v3', revision: 1 } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, 'revision_conflict');
  await app.close(); database.close(); narrativeDatabase.close();
});

test('research run reports a clear blocker when no text model is configured', async () => {
  const { app, database, narrativeDatabase, workId } = await fixture();
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/research/projects', headers, payload: { workId, title: '主题', question: 'q' } });
  const projectId = created.json().id as string;
  await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/confirm`, headers });
  const run = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/runs`, headers });
  assert.equal(run.statusCode, 202);
  const runId = run.json().id as string;

  // 后台运行是异步的，轮询到终态再断言。
  let detail = run.json();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const polled = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/research/runs/${runId}`, headers });
    detail = polled.json().run;
    if (!['queued', 'running'].includes(detail.status)) break;
  }
  assert.equal(detail.status, 'incomplete');
  assert.match(String(detail.incompleteReason), /文本模型/);
  await app.close(); database.close(); narrativeDatabase.close();
});

test('a cancelled run stays cancelled when a late stage result arrives', async () => {
  const { app, database, narrativeDatabase, workId } = await fixture();
  const store = new ResearchStore(narrativeDatabase);
  const project = store.createProject({ workId, title: '主题', question: 'q', scope: { workId }, origin: 'user-defined' });
  const run = store.createRun({ projectId: project.id, inputSnapshot: {}, corpusVersion: {} });
  store.updateRun(run.id, { status: 'running', stage: 'retrieval' });

  const cancelled = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/runs/${run.id}/cancel`, headers });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.json().status, 'cancelled');

  /*
   * 取消后仍然执行一次运行编排：迟到的阶段结果必须被守卫拦下，
   * 不能把状态改回 running 或写成 needs-review。
   */
  const provider = new LocalNarrativeCorpusProvider(narrativeDatabase);
  const after = await executeResearchRun(
    { database, narrativeDatabase, secrets: new SecretStore({}), provider, store, fetcher: fetch },
    run.id,
  );
  assert.equal(after!.status, 'cancelled');

  // 重复取消一个已结束的运行应被拒绝，而不是静默成功。
  const again = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/runs/${run.id}/cancel`, headers });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error, 'run_not_active');
  await app.close(); database.close(); narrativeDatabase.close();
});

test('publish preview blocks until a claim is accepted', async () => {
  const { app, database, narrativeDatabase, workId } = await fixture();
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/research/projects', headers, payload: { workId, title: '主题', question: 'q' } });
  const projectId = created.json().id as string;
  const preview = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/publish-preview`, headers });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().ready, false);
  assert.match(preview.json().blocked.join('；'), /已接受的结论/);
  await app.close(); database.close(); narrativeDatabase.close();
});

test('evidence snapshots stay readable after the source row is deleted', async () => {
  const { database, narrativeDatabase, workId } = await fixture();
  const store = new ResearchStore(narrativeDatabase);
  const provider = new LocalNarrativeCorpusProvider(narrativeDatabase);
  const project = store.createProject({ workId, title: '主题', question: 'q', scope: { workId }, origin: 'user-defined' });
  const search = await provider.search({ workId, text: '禁忌知识' });
  const document = await provider.read({ targetType: search.items[0].targetType, targetId: search.items[0].targetId, contextSize: 2 });
  const evidenceId = store.upsertEvidence({
    projectId: project.id, runId: null, providerId: provider.id, workId,
    targetType: document!.targetType, targetId: document!.targetId, nodeId: document!.nodeId, sceneId: document!.sceneId,
    locator: document!.locator, quoteSnapshot: document!.text, contextBefore: document!.contextBefore,
    contextAfter: document!.contextAfter, contentHash: document!.contentHash, sourceVersion: {},
  });
  // 删掉原台词后，冻结快照仍可读。
  narrativeDatabase.connection.prepare('DELETE FROM narrative_utterances WHERE id=?').run(document!.targetId);
  const still = store.getEvidence(evidenceId);
  assert.ok(still);
  assert.equal(still!.quoteSnapshot, document!.text);
  await database.close(); narrativeDatabase.close();
});

test('restart marks in-flight runs as interrupted without dropping evidence', async () => {
  const { database, narrativeDatabase, workId } = await fixture();
  const store = new ResearchStore(narrativeDatabase);
  const project = store.createProject({ workId, title: '主题', question: 'q', scope: { workId }, origin: 'user-defined' });
  const run = store.createRun({ projectId: project.id, inputSnapshot: {}, corpusVersion: {} });
  store.updateRun(run.id, { status: 'running', stage: 'retrieval' });
  store.upsertEvidence({
    projectId: project.id, runId: run.id, providerId: 'local-narrative', workId,
    targetType: 'node', targetId: 'node-x', nodeId: 'node-x', sceneId: null, locator: 'L', quoteSnapshot: 'Q',
    contextBefore: '', contextAfter: '', contentHash: 'h', sourceVersion: {},
  });
  const marked = store.markInterruptedRuns();
  assert.equal(marked, 1);
  assert.equal(store.getRun(run.id)!.status, 'interrupted');
  assert.equal(store.listEvidence({ runId: run.id }).length, 1);
  await database.close(); narrativeDatabase.close();
});

test('topic suggestion route reports an explicit blocker on an empty corpus', async () => {
  const database = new ServiceDatabase();
  const narrativeDatabase = new NarrativeDatabase();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'admin-test-token-that-is-long-12345678', STHSTART_IMAGE_SIGNING_SECRET: 'image-signing-test-secret-1234567890' });
  const { app } = await createService({ config, database, narrativeDatabase, secrets: new SecretStore({}) });
  const provider = await app.inject({ method: 'GET', url: '/api/v1/admin/narrative/research/provider', headers });
  assert.equal(provider.json().status, 'empty');
  const suggestions = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/research/topic-suggestions', headers, payload: { workId: 'missing' } });
  assert.equal(suggestions.statusCode, 404);
  await app.close(); database.close(); narrativeDatabase.close();
});

test('research runs appear in the unified task drawer and can be cancelled there', async () => {
  const { app, database, narrativeDatabase, workId } = await fixture();
  const store = new ResearchStore(narrativeDatabase);
  const project = store.createProject({ workId, title: '抽屉里的专题', question: 'q', scope: { workId }, origin: 'user-defined' });
  const run = store.createRun({ projectId: project.id, inputSnapshot: {}, corpusVersion: {} });
  store.updateRun(run.id, { status: 'running', stage: 'retrieval', progressLabel: '检索本地原文' });

  const tasks = await app.inject({ method: 'GET', url: '/api/v1/admin/tasks?domain=narrative_research', headers });
  assert.equal(tasks.statusCode, 200);
  const item = tasks.json().items.find((entry: { taskId: string }) => entry.taskId === run.id);
  assert.ok(item, 'research run should be listed in the task drawer');
  assert.equal(item.displayState, 'running');
  assert.match(item.title, /剧情研究/);
  assert.equal(item.capabilities.cancel, true);
  assert.ok(String(item.targetUrl).includes('/apps/narrative'));

  const cancelled = await app.inject({ method: 'POST', url: `/api/v1/admin/tasks/narrative_research/${run.id}/cancel`, headers });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(store.getRun(run.id)!.status, 'cancelled');

  // 已结束的运行不能再取消，但可以重新排队。
  const again = await app.inject({ method: 'POST', url: `/api/v1/admin/tasks/narrative_research/${run.id}/cancel`, headers });
  assert.equal(again.statusCode, 400);
  const retried = await app.inject({ method: 'POST', url: `/api/v1/admin/tasks/narrative_research/${run.id}/retry`, headers });
  assert.equal(retried.statusCode, 200);
  assert.equal(store.getRun(run.id)!.status, 'queued');

  await app.close(); database.close(); narrativeDatabase.close();
});

test('mcp-shaped provider satisfies the same contract as the local provider', async () => {
  const { database, narrativeDatabase, workId } = await fixture();
  /*
   * 未来接入 MCP 时只新增一个实现，研究引擎与页面不变。
   * 这里用一个最小替身确认接口面确实够用。
   */
  const stub = {
    id: 'stub-mcp', name: 'Stub MCP', kind: 'mcp' as const,
    status: async () => ({ id: 'stub-mcp', name: 'Stub MCP', kind: 'mcp' as const, status: 'ready' as const, message: '', workCount: 1 }),
    version: async (scope: { workId: string }) => ({ providerId: 'stub-mcp', workId: scope.workId, workUpdatedAt: '', nodeCount: 1, utteranceCount: 1, contentHash: 'h' }),
    catalog: async () => ({ items: [{ nodeId: 'n', parentId: null, kind: 'quest', title: 't', summary: '', sortOrder: 1, utteranceCount: 1 }], truncated: false }),
    search: async () => ({ items: [{ targetType: 'node' as const, targetId: 'n', nodeId: 'n', sceneId: null, title: 't', excerpt: 'e', speaker: null, sourceLine: null, locator: 'l' }], truncated: false, strategy: 'fts' as const }),
    read: async () => ({ targetType: 'node' as const, targetId: 'n', workId, nodeId: 'n', sceneId: null, nodeTitle: 't', sceneTitle: '', speaker: null, text: 'x', contextBefore: '', contextAfter: '', locator: 'l', contentHash: 'h', sourceVersion: { providerId: 'stub-mcp', workId, workUpdatedAt: '', nodeCount: 1, utteranceCount: 1, contentHash: 'h' } }),
  };
  const status = await stub.status();
  assert.equal(status.kind, 'mcp');
  const page = await stub.search();
  assert.equal(page.items[0].targetType, 'node');
  await database.close(); narrativeDatabase.close();
});
