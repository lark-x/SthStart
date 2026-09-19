import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../config.js';
import { ServiceDatabase, nowIso } from '../database.js';
import { NarrativeDatabase } from '../narrative-database.js';
import { createService } from '../server.js';
import { SecretStore } from '../security.js';

const headers = { 'x-sthstart-admin-token': 'admin-test-token-that-is-long-12345678' };

/**
 * 语料里有明显可研究的线索：同一事件两种相反说法，正好能验证
 * 「事实 / 推论 / 矛盾」三种类型与最低证据要求。
 */
const bundle = {
  schemaVersion: 1,
  source: { id: 'chain', name: 'Chain Fixture', kind: 'json' },
  work: { externalId: 'chain-work', title: '链式测试作品', locale: 'zh-CN' },
  release: { externalId: '1.0', label: '第一版' },
  nodes: [{ externalId: 'quest', kind: 'quest', title: '沙海遗迹', order: 1, summary: '赤王与禁忌知识的线索。' }],
  scenes: [{ externalId: 'ruins', nodeExternalId: 'quest', title: '遗迹深处', order: 1 }],
  utterances: [
    { externalId: 'u1', sceneExternalId: 'ruins', order: 1, kind: 'narration', text: '石碑上写着赤王曾接触禁忌知识。' },
    { externalId: 'u2', sceneExternalId: 'ruins', order: 2, kind: 'dialogue', speaker: '学者', text: '但另一块石碑说赤王最终封存了禁忌知识。' },
    { externalId: 'u3', sceneExternalId: 'ruins', order: 3, kind: 'dialogue', speaker: '向导', text: '两处记载互相矛盾，没人知道哪个是真的。' },
  ],
} as const;

/**
 * 桩 LLM：按提示词特征返回对应阶段的 JSON。
 * 用真实 fetch 形状，确保 callLlm 的解析路径被真正走到。
 */
function stubFetch(calls: { count: number }) {
  return (async (_url: string, init?: RequestInit) => {
    calls.count += 1;
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content?: string }> };
    const prompt = body.messages?.at(-1)?.content ?? '';
    let content = '[]';
    if (prompt.includes('制定检索计划')) {
      content = JSON.stringify([
        { question: '赤王与禁忌知识的关系是什么？', keywords: ['赤王', '禁忌知识'], nodeKinds: [], entities: ['赤王'], stopCondition: '找到两种说法' },
        { question: '石碑记载是否一致？', keywords: ['石碑'], nodeKinds: [], entities: [], stopCondition: '找到矛盾' },
      ]);
    } else if (prompt.includes('生成结论卡')) {
      // 故意包含一条「没有证据的 fact」和一条证据不足的 inference，验证降级与拒绝。
      const evidenceIds = [...prompt.matchAll(/\[([0-9a-f-]{36})\]/g)].map((match) => match[1]);
      content = JSON.stringify([
        { title: '赤王曾接触禁忌知识', claimType: 'fact', body: '石碑上写着赤王曾接触禁忌知识', explanation: '石碑原文', evidenceIds: [evidenceIds[0]], counterEvidenceIds: [], uncertainty: '', nextSteps: '' },
        { title: '两块石碑记载互相矛盾', claimType: 'contradiction', body: '两处记载互相矛盾', explanation: '同一事件两种说法', evidenceIds: [evidenceIds[1] ?? evidenceIds[0]], counterEvidenceIds: [evidenceIds[2] ?? evidenceIds[0]], uncertainty: '无法判断哪块更可信', nextSteps: '查找第三份记载' },
        { title: '赤王最终封存了禁忌知识', claimType: 'inference', body: '赤王最终封存了禁忌知识', explanation: '只有一块石碑提到', evidenceIds: [evidenceIds[0]], counterEvidenceIds: [], uncertainty: '证据单一', nextSteps: '' },
        { title: '凭空结论', claimType: 'fact', body: '这是没有证据的说法', explanation: '', evidenceIds: ['11111111-1111-1111-1111-111111111111'], counterEvidenceIds: [], uncertainty: '', nextSteps: '' },
      ]);
    } else if (prompt.includes('检查下面这些结论')) {
      const ids = [...prompt.matchAll(/\[([0-9a-f-]{36})\] \(/g)].map((match) => match[1]);
      content = JSON.stringify(ids.map((id) => ({ id, claimType: 'fact', issues: [], counterEvidenceIds: [], uncertainty: '基于本地原文', evidenceSufficient: true })));
    } else if (prompt.includes('撰写研究总稿')) {
      const evidenceIds = [...prompt.matchAll(/\[([0-9a-f-]{36})\]/g)].map((match) => match[1]);
      const claimIds = [...prompt.matchAll(/\[([0-9a-f-]{36})\] \(/g)].map((match) => match[1]);
      content = JSON.stringify({
        title: '赤王与禁忌知识研究报告', summary: '两块石碑对同一事件给出相反说法。',
        sections: [
          { heading: '研究问题', body: '赤王与禁忌知识的关系是什么？', claimIds, evidenceIds },
          { heading: '已确认事实', body: '石碑上写着赤王曾接触禁忌知识。', claimIds: claimIds.slice(0, 1), evidenceIds: evidenceIds.slice(0, 1) },
          { heading: '互相矛盾的证据', body: '另一块石碑称赤王封存了禁忌知识。', claimIds: claimIds.slice(1), evidenceIds: evidenceIds.slice(0, 2) },
          { heading: '尚未回答的问题', body: '哪一块石碑的记载更可信？', claimIds: [], evidenceIds: [] },
        ],
        evidenceIndex: evidenceIds.map((id) => ({ evidenceId: id, locator: '沙海遗迹', note: '本地原文' })),
      });
    } else if (prompt.includes('值得深入研究')) {
      content = JSON.stringify([
        { title: '赤王与禁忌知识', question: '两者关系是什么？', reason: '原文给出相反说法', keywords: ['赤王', '禁忌知识'], entities: ['赤王'], seedEvidence: [{ nodeTitle: '沙海遗迹', quote: '石碑上写着赤王曾接触禁忌知识' }], duplicateOf: '' },
        { title: '没有证据的主题', question: 'q', reason: 'r', keywords: [], entities: [], seedEvidence: [], duplicateOf: '' },
      ]);
    }
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    };
  }) as unknown as typeof fetch;
}

async function fixture() {
  const database = new ServiceDatabase();
  const narrativeDatabase = new NarrativeDatabase();
  const calls = { count: 0 };
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'admin-test-token-that-is-long-12345678', STHSTART_IMAGE_SIGNING_SECRET: 'image-signing-test-secret-1234567890' });
  const service = await createService({ config, database, narrativeDatabase, secrets: new SecretStore({}), fetcher: stubFetch(calls) });
  const now = nowIso();
  database.connection.prepare('INSERT INTO provider_profiles(id,kind,name,base_url,model,credential_account,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)')
    .run('llm-1', 'llm', '桩模型', 'http://llm.test/v1', 'stub', null, now, now);
  database.connection.prepare('INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES (?,?,?,?)').run('narrative', 'text', 'llm-1', now);
  const preview = await service.app.inject({ method: 'POST', url: '/api/v1/admin/narrative/imports/preview', headers, payload: bundle });
  const commit = await service.app.inject({ method: 'POST', url: `/api/v1/admin/narrative/imports/${preview.json().id}/commit`, headers });
  return { ...service, database, narrativeDatabase, calls, workId: commit.json().workId as string };
}

async function waitForRun(app: Awaited<ReturnType<typeof fixture>>['app'], runId: string) {
  let detail: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const polled = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/research/runs/${runId}`, headers });
    detail = polled.json() as Record<string, unknown>;
    const run = detail.run as Record<string, unknown>;
    if (!['queued', 'running'].includes(String(run.status))) break;
  }
  return detail;
}

test('full chain: suggest → confirm → research → review → publish into the material library', async () => {
  const { app, database, narrativeDatabase, calls, workId } = await fixture();

  // 1. AI 选题：只保留有真实种子证据的候选。
  const suggested = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/research/topic-suggestions', headers, payload: { workId } });
  assert.equal(suggested.statusCode, 201);
  assert.equal(suggested.json().items.length, 1);
  assert.equal(suggested.json().discarded.length, 1);
  assert.match(suggested.json().discarded[0].reason, /种子证据/);
  assert.ok(suggested.json().items[0].seedEvidence.length >= 1);

  // 2. 选中候选 → 建专题（第一次确认前仍是 draft）。
  const selected = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/topic-suggestions/${suggested.json().items[0].id}/select`, headers });
  assert.equal(selected.statusCode, 201);
  const projectId = selected.json().id as string;
  assert.equal(selected.json().status, 'draft');
  assert.equal(selected.json().origin, 'ai-suggested');

  const confirmed = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/confirm`, headers });
  assert.equal(confirmed.json().status, 'confirmed');

  // 3. 研究运行：检索 → 结论 → 校验 → 总稿。
  const started = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/runs`, headers });
  assert.equal(started.statusCode, 202);
  const detail = await waitForRun(app, started.json().id as string);
  const run = detail.run as Record<string, unknown>;
  assert.equal(run.status, 'needs-review', `error=${String(run.errorMessage)} incomplete=${String(run.incompleteReason)}`);
  assert.ok((run.queryPlan as unknown[]).length >= 1);
  assert.ok(calls.count >= 4, `expected several model calls, got ${calls.count}`);

  const claims = detail.claims as Array<Record<string, unknown>>;
  /*
   * 三条通过、一条被拒：
   * - fact（1 条证据）与 contradiction（2 条）通过；
   * - inference 只有 1 条证据，按最低要求被拒绝（不降级也不接受）；
   * - 引用不存在证据 ID 的结论被拒绝。
   */
  assert.equal(claims.length, 2, `titles=${claims.map((claim) => `${String(claim.title)}/${String(claim.claimType)}`).join(',')}`);
  assert.ok(claims.some((claim) => claim.claimType === 'fact'));
  assert.ok(claims.some((claim) => claim.claimType === 'contradiction'));
  assert.ok(claims.every((claim) => claim.claimType !== null));
  const rejected = ((run.synthesis as Record<string, unknown>).rejectedClaims ?? []) as Array<{ reason: string }>;
  assert.equal(rejected.length, 2);
  assert.ok(rejected.some((item) => /少于两条独立证据/.test(item.reason)));
  assert.ok(rejected.some((item) => /不存在的证据 ID/.test(item.reason)));

  // 每条事实或推论都能打开对应原文。
  for (const claim of claims) {
    const evidence = claim.evidence as Array<Record<string, unknown>>;
    assert.ok(evidence.length >= 1, `claim ${String(claim.title)} has no evidence`);
    for (const item of evidence) {
      const fetched = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/research/evidence/${String(item.id)}`, headers });
      assert.equal(fetched.statusCode, 200);
      assert.ok(String(fetched.json().archiveHref).includes('/apps/narrative'));
      assert.ok(String(fetched.json().quoteSnapshot).length > 0);
    }
  }

  // 4. 发布前必须先接受结论。
  const blockedPreview = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/publish-preview`, headers });
  assert.equal(blockedPreview.json().ready, false);
  const blockedPublish = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/publish`, headers });
  assert.equal(blockedPublish.statusCode, 409);

  for (const claim of claims) {
    const accepted = await app.inject({ method: 'PATCH', url: `/api/v1/admin/narrative/research/claims/${String(claim.id)}`, headers, payload: { status: 'accepted', revision: claim.revision } });
    assert.equal(accepted.statusCode, 200);
  }

  const readyPreview = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/publish-preview`, headers });
  assert.equal(readyPreview.json().ready, true, JSON.stringify(readyPreview.json().blocked));
  // 含推论/矛盾时性质必须是未确认，不能标成原作事实。
  assert.equal(readyPreview.json().nature, 'unconfirmed');

  // 5. 第二次确认 → 写入资料库。
  const published = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/publish`, headers, payload: { revision: readyPreview.json().revision } });
  assert.equal(published.statusCode, 201);
  const noteId = published.json().noteId as string;

  const note = database.connection.prepare('SELECT title,kind,stage,content_json FROM creative_notes WHERE id=?').get(noteId) as { title: string; kind: string; stage: string; content_json: string };
  assert.equal(note.kind, 'story');
  assert.equal(note.stage, 'reference');
  assert.match(note.content_json, /原作明确事实|研究推论|矛盾与疑点/);

  const knowledge = database.connection.prepare('SELECT nature,authorship,usage,category,origin_json,sources_json FROM note_knowledge WHERE note_id=?').get(noteId) as Record<string, unknown>;
  assert.equal(knowledge.nature, 'unconfirmed');
  assert.equal(knowledge.authorship, 'ai-organized');
  assert.equal(knowledge.usage, 'reference');
  assert.equal(knowledge.category, 'plot');
  assert.match(String(knowledge.origin_json), /research/);
  assert.ok(JSON.parse(String(knowledge.sources_json)).length >= 1);

  // 6. 重复发布幂等：不重复创建资料。
  const again = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/publish`, headers, payload: { revision: readyPreview.json().revision } });
  assert.equal(again.json().created, false);
  assert.equal(again.json().noteId, noteId);
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM creative_notes WHERE id=?').get(noteId)!.count, 1);

  // 7. 资料能回到研究专题与证据原文。
  const projectAfter = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/research/projects/${projectId}`, headers });
  assert.equal(projectAfter.json().project.status, 'published');
  assert.equal(projectAfter.json().project.publishedNoteId, noteId);

  await app.close(); database.close(); narrativeDatabase.close();
});

test('editing the draft and republishing updates the same note and bumps its revision', async () => {
  const { app, database, narrativeDatabase, workId } = await fixture();
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/research/projects', headers, payload: { workId, title: '主题', question: 'q' } });
  const projectId = created.json().id as string;
  await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/confirm`, headers });
  const started = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/runs`, headers });
  const detail = await waitForRun(app, started.json().id as string);
  const claims = detail.claims as Array<Record<string, unknown>>;
  for (const claim of claims) await app.inject({ method: 'PATCH', url: `/api/v1/admin/narrative/research/claims/${String(claim.id)}`, headers, payload: { status: 'accepted' } });

  const project = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/research/projects/${projectId}`, headers });
  const first = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/publish`, headers, payload: { revision: project.json().project.revision } });
  const noteId = first.json().noteId as string;
  const firstRevision = (database.connection.prepare('SELECT revision FROM creative_notes WHERE id=?').get(noteId) as { revision: number }).revision;

  // 编辑总稿后再发布：更新同一篇资料并增加 revision，不新建副本。
  const draftId = project.json().latestDraft.id as string;
  const edited = await app.inject({ method: 'PATCH', url: `/api/v1/admin/narrative/research/drafts/${draftId}`, headers, payload: { title: '改过的标题', summary: '改过的概述' } });
  assert.equal(edited.statusCode, 200);
  const second = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/publish`, headers, payload: { revision: project.json().project.revision } });
  // 更新已有资料而不是新建，因此返回 200 且 created=false。
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().created, false);
  assert.equal(second.json().noteId, noteId);
  const after = database.connection.prepare('SELECT title,revision FROM creative_notes WHERE id=?').get(noteId) as { title: string; revision: number };
  assert.equal(after.title, '改过的标题');
  assert.ok(after.revision > firstRevision, 'republish should bump the note revision');
  // 资料库里只有这一篇，不会留下标题相近的副本。
  // 资料库里只会有这一篇研究资料（不新建副本）。
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM creative_notes WHERE id=?').get(noteId)!.count, 1);
  assert.equal(database.connection.prepare('SELECT COUNT(*) count FROM research_note_links WHERE project_id=?').get(projectId)!.count, 2);
  const linked = database.connection.prepare('SELECT DISTINCT note_id FROM research_note_links WHERE project_id=?').all(projectId) as Array<{ note_id: string }>;
  assert.equal(linked.length, 1);

  await app.close(); database.close(); narrativeDatabase.close();
});

test('regenerating the draft uses only accepted claims and keeps the review state', async () => {
  const { app, database, narrativeDatabase, workId } = await fixture();
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/narrative/research/projects', headers, payload: { workId, title: '主题', question: 'q' } });
  const projectId = created.json().id as string;
  await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/confirm`, headers });
  const started = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/runs`, headers });
  const detail = await waitForRun(app, started.json().id as string);
  const claims = detail.claims as Array<Record<string, unknown>>;

  // 一条都不接受时不能重写总稿：避免模型把未审核内容写进资料。
  const blocked = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/regenerate-draft`, headers });
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.json().message, /已接受的结论/);

  for (const claim of claims) await app.inject({ method: 'PATCH', url: `/api/v1/admin/narrative/research/claims/${String(claim.id)}`, headers, payload: { status: 'accepted' } });
  const regenerated = await app.inject({ method: 'POST', url: `/api/v1/admin/narrative/research/projects/${projectId}/regenerate-draft`, headers });
  assert.equal(regenerated.statusCode, 201);
  assert.ok(regenerated.json().draftId);

  const project = await app.inject({ method: 'GET', url: `/api/v1/admin/narrative/research/projects/${projectId}`, headers });
  // 新版本排在最前，且专题回到待审核而不是直接发布。
  assert.equal(project.json().latestDraft.id, regenerated.json().draftId);
  assert.ok(project.json().drafts.length >= 2);
  assert.equal(project.json().project.status, 'review');

  await app.close(); database.close(); narrativeDatabase.close();
});
