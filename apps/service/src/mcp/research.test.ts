import assert from 'node:assert/strict';
import test from 'node:test';
import { ResearchStore } from './research-store.js';
import { createService } from '../server.js';
import { ServiceDatabase } from '../database.js';
import { readConfig } from '../config.js';
import { SecretStore } from '../security.js';
import { applyPlanningOutput, isUnresolvedPlanningActor } from '@sthstart/contracts';

const adminToken = 'admin-research-test-token-123456789012345';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

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
function mcpToolFetch() {
  return (async (_input: unknown, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return new Response(null, { status: 405 });
    const body = init?.body ? JSON.parse(String(init.body)) as { method?: string; id?: number; params?: { name?: string; arguments?: Record<string, unknown> } } : {};
    if (body.method === 'initialize') {
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'WikiMcp', version: '1.0' } } });
    }
    if (body.method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [
        { name: 'wiki_search', description: 'Search wiki', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
        { name: 'wiki_read', description: 'Read article', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
      ] } });
    }
    if (body.method === 'tools/call') {
      const name = body.params?.name;
      const args = body.params?.arguments ?? {};
      if (name === 'wiki_search') {
        assert.deepEqual(Object.keys(args), ['query']);
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '找到派蒙相关条目：与旅行者一同冒险的向导。' }], structuredContent: { results: [{ id: 'paimon-wiki', title: '派蒙' }] } } });
      }
      if (name === 'wiki_read') {
        assert.equal(args.id, 'paimon-wiki', '读取必须使用搜索返回的文档 ID');
        return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '派蒙：旅行者的向导与伙伴，性格活泼，热爱美食。' }], structuredContent: { id: String(args.id ?? '') } } });
      }
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [] } });
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result: {} });
  }) as unknown as typeof fetch;
}

function llmFetch() {
  return (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (!url.includes('/chat/completions')) return new Response(null, { status: 404 });
    const body = init?.body ? JSON.parse(String(init.body)) as { messages?: Array<{ content?: string }> } : {};
    const prompt = body.messages?.[body.messages.length - 1]?.content ?? '';
    let content: unknown;
    if (prompt.includes('列出需要查证的问题')) {
      content = JSON.stringify([{ keyword: '派蒙', kind: 'relationship', why: '确认派蒙与主角的关系' }]);
    } else if (prompt.includes('actorRoles')) {
      content = JSON.stringify(buildPlanningPayload(prompt));
    } else if (prompt.includes('人物候选')) {
      content = JSON.stringify({
        characters: [
          { name: '派蒙', work: '原神', reason: '与旅行者关系密切', relationshipToLead: '旅行中的向导伙伴（有资料依据）', basis: 'documented', evidenceIds: [...prompt.matchAll(/\[([a-f0-9-]{36})\] 来源/g)].map(match => match[1]) },
          { name: '琴', work: '原神', reason: '代理团长，适合主持活动', relationshipToLead: '与旅行者并肩作战的伙伴（有资料依据）', basis: 'documented' },
        ],
        locations: [{ name: '璃月港', work: '原神', environment: '繁华港口', reasonForActivity: '适合聚会', originalBasis: '璃月主要港口城市', activityArrangement: '在港口餐厅聚餐', basis: 'documented' }],
      });
    } else {
      content = JSON.stringify([]);
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content: String(content) } }] });
  }) as unknown as typeof fetch;
}

/**
 * 企划生成的可控输出：只引用提示词里出现的临时候选 ID 或本地角色 ID，
 * 保证 validatePlanningOutput 的 actorIds 校验通过。
 */
function buildPlanningPayload(prompt: string) {
  const actorIds = [...new Set([...prompt.matchAll(/\[ID: ((?:actor_|cand_)[^\]]+)\]/g)].map(match => match[1]))];
  return {
    schemaVersion: 1,
    activity: { title: '派蒙的欢迎会', theme: '温馨聚会', location: '璃月港', rules: '保持轻松愉快', overview: '为派蒙和琴准备一场欢迎会' },
    actorRoles: actorIds.map((actorId) => ({ actorId, activityRole: '受邀参与者' })),
    stages: [
      { clientId: 'plan_s1', title: '港口集合', actorIds, location: '璃月港', description: '大家在港口集合', requiredBeats: ['集合完成'], endCondition: '全员到齐' },
      { clientId: 'plan_s2', title: '餐厅聚餐', actorIds, location: '港口餐厅', description: '一起用餐并合影', requiredBeats: ['合影留念'], endCondition: '聚会圆满结束' },
    ],
  };
}

function adminUrl(sessionId: string, ...rest: string[]) {
  return '/api/v1/admin/activity-planning-sessions/' + [sessionId, ...rest].join('/');
}

/** 企划闭环的公共脚手架：模型配置、本地角色、资料源会话都在这里准备好。 */
async function bootstrapPlanningSession(customLlm?: typeof fetch) {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const fetcher = combinedFetch(mcpToolFetch(), customLlm ?? llmFetch());
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets, fetcher });
  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)')
    .run('llm', 'LLM', 'llm', 'http://llm.test/v1', 'gpt-4o', null, now, now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'llm', ?)").run(now);
  const first = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: {
    displayName: '旅行者',
    draft: { schemaVersion: 2, displayName: '旅行者', work: '原神', identity: '异乡的旅行者', personality: ['勇敢'], speech: { tone: '坚定' }, appearance: { description: '金发异乡人' } },
    tags: ['原神'],
  } });
  const second = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: {
    displayName: '临时同伴',
    draft: { schemaVersion: 2, displayName: '临时同伴', work: '原神', identity: '临时的同行者', personality: ['沉稳'], speech: { tone: '平静' }, appearance: { description: '短发旅人' } },
    tags: ['原神'],
  } });
  await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources', headers: adminHeaders, payload: {
    id: 'wiki-source', name: '角色百科', url: 'https://wiki.example.com/mcp', authMode: 'none', applicableWorks: ['原神'], universal: false, purpose: '角色资料', allowedTools: ['wiki_search', 'wiki_read'], timeoutMs: 30_000,
  } });
  const session = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-planning-sessions', headers: adminHeaders, payload: {
    form: {
      templateId: 'blank', title: '旅行者的聚会', type: '聚会', theme: '温馨的午后聚会', location: '璃月港', rules: '',
      scheduledDate: null, characters: [{ characterId: first.json().id, activityRole: '主角' }], birthdayCharacterIds: [],
      leadCharacterId: first.json().id, guestCountPreference: 6,
    },
  } });
  return { app, database, sessionId: session.json().session.id as string, characterId: first.json().id as string, secondId: second.json().id as string };
}

async function runResearchTask(app: Awaited<ReturnType<typeof bootstrapPlanningSession>>['app'], sessionId: string) {
  const started = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'research'), headers: adminHeaders, payload: {
    sourceIds: ['wiki-source'], userRequest: '想办一场跨作品的欢迎会',
  } });
  assert.equal(started.statusCode, 202);
  const taskId = started.json().id as string;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const poll = await app.inject({ url: adminUrl(sessionId, 'research', taskId), headers: adminHeaders });
    const task = poll.json() as { status: string };
    if (['succeeded', 'incomplete', 'failed', 'cancelled'].includes(task.status)) return task as unknown as { status: string; id: string; characterCandidates: Array<Record<string, unknown>>; locationCandidates: Array<Record<string, unknown>> };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('研究任务未在预期时间内结束');
}

async function generatePlan(app: Awaited<ReturnType<typeof bootstrapPlanningSession>>['app'], sessionId: string, planCount = 1) {
  const started = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'jobs'), headers: adminHeaders, payload: { planCount } });
  assert.equal(started.statusCode, 202);
  const jobId = started.json().id as string;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const poll = await app.inject({ url: adminUrl(sessionId, 'jobs', jobId), headers: adminHeaders });
    const data = poll.json() as { job: { status: string }; candidates: Array<Record<string, unknown>> };
    if (!['queued', 'running'].includes(data.job.status)) return data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('企划任务未在预期时间内结束');
}

async function fetchSession(app: Awaited<ReturnType<typeof bootstrapPlanningSession>>['app'], sessionId: string) {
  const response = await app.inject({ url: adminUrl(sessionId), headers: adminHeaders });
  assert.equal(response.statusCode, 200);
  return response.json() as {
    session: { status: string; version: number; document: { actors: Array<Record<string, unknown>>; stages: Array<{ id: string; actorIds: string[] }> } };
    candidates: Array<{ id: string; payload: unknown }>;
    pendingActors: Array<{ actorId: string; displayName: string; affectedStageIds: string[] }>;
    summaries: Array<{ id: string; stageCount: number; pendingPersonaCount: number }>;
  };
}

test('planning: 用户自填地点写入研究选择且重复提交不会重复', async () => {
  const { app, database, sessionId } = await bootstrapPlanningSession();
  const task = await runResearchTask(app, sessionId);
  const userLocationId = 'user_loc_' + 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const payload = {
    characters: [],
    locations: [],
    addLocations: [{ id: userLocationId, name: '自家天台', note: '备用场地', status: 'required', locked: true }],
  };
  const saved = await app.inject({ method: 'PUT', url: adminUrl(sessionId, 'research', task.id, 'selection'), headers: adminHeaders, payload });
  assert.equal(saved.statusCode, 200);
  const locations = saved.json().task.locationCandidates as Array<Record<string, unknown>>;
  const created = locations.find((item) => item.id === userLocationId);
  assert.ok(created, '自填地点应写入候选');
  assert.equal(created?.userProvided, true);
  assert.equal(created?.userStatus, 'required');
  assert.equal(created?.locked, true);
  assert.equal(saved.json().selection.lockedLocationId, userLocationId);

  const again = await app.inject({ method: 'PUT', url: adminUrl(sessionId, 'research', task.id, 'selection'), headers: adminHeaders, payload });
  assert.equal(again.statusCode, 200);
  assert.equal((again.json().task.locationCandidates as unknown[]).length, locations.length, '重复提交不应产生重复地点');

  await app.close(); database.close();
});

test('planning: 待补人设必须补齐或匹配后才能创建活动', async () => {
  const { app, database, sessionId, secondId } = await bootstrapPlanningSession();
  const task = await runResearchTask(app, sessionId);
  const characterCandidates = task.characterCandidates as Array<{ id: string; displayName: string }>;
  assert.equal(characterCandidates.length, 2);

  const selection = await app.inject({ method: 'PUT', url: adminUrl(sessionId, 'research', task.id, 'selection'), headers: adminHeaders, payload: {
    characters: characterCandidates.map((candidate) => ({ id: candidate.id, status: 'required' })),
    locations: [{ id: (task.locationCandidates as Array<{ id: string }>)[0].id, status: 'required', locked: true }],
  } });
  assert.equal(selection.statusCode, 200);

  const generated = await generatePlan(app, sessionId, 1);
  assert.equal(generated.candidates.length, 1, '应生成一份方案');

  const session = await fetchSession(app, sessionId);
  assert.equal(session.pendingActors.length, 2, '两位研究候选都应成为待补人设');
  assert.equal(session.summaries[0].stageCount, 2);
  assert.equal(session.summaries[0].pendingPersonaCount, 2);

  const candidateId = generated.candidates[0].id as string;
  const payload = generated.candidates[0].payload;
  const blocked = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'create-activity'), headers: adminHeaders, payload: {
    document: applyPlanningOutput(session.session.document as never, payload as never),
    candidateId,
  } });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error, 'pending_actors_unresolved');

  const firstActor = session.pendingActors[0];
  const draft = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'actors', firstActor.actorId, 'persona-draft'), headers: adminHeaders, payload: {} });
  assert.equal(draft.statusCode, 200);
  assert.equal(draft.json().hasEvidence, true, '有资料摘录时人设草稿应标记为有依据');

  const completed = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'actors', firstActor.actorId, 'resolve'), headers: adminHeaders, payload: {
    mode: 'persona', displayName: draft.json().displayName, persona: draft.json().persona, sourceNote: draft.json().basisNote,
  } });
  assert.equal(completed.statusCode, 200);
  assert.ok(completed.json().createdCharacterId, '补齐人设应写入本地角色库');
  assert.equal(completed.json().pendingActors.length, 1);

  const secondActor = completed.json().pendingActors[0] as { actorId: string };
  const matched = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'actors', secondActor.actorId, 'resolve'), headers: adminHeaders, payload: {
    mode: 'match', characterId: secondId,
  } });
  assert.equal(matched.statusCode, 200);
  assert.equal(matched.json().pendingActors.length, 0);

  const afterResolve = await fetchSession(app, sessionId);
  assert.ok(afterResolve.session.document.actors.every((actor) => !isUnresolvedPlanningActor(actor as never)), '解析后不应留下未解析角色');

  const created = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'create-activity'), headers: adminHeaders, payload: {
    document: applyPlanningOutput(afterResolve.session.document as never, payload as never),
    candidateId,
  } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().created, true);
  const finalSession = await fetchSession(app, sessionId);
  assert.equal(finalSession.session.status, 'created');

  await app.close(); database.close();
});

test('planning: 移除待补人设会同步更新阶段引用', async () => {
  const { app, database, sessionId, secondId } = await bootstrapPlanningSession();
  const task = await runResearchTask(app, sessionId);
  const characterCandidates = task.characterCandidates as Array<{ id: string; displayName: string }>;
  await app.inject({ method: 'PUT', url: adminUrl(sessionId, 'research', task.id, 'selection'), headers: adminHeaders, payload: {
    characters: characterCandidates.map((candidate) => ({ id: candidate.id, status: 'required' })),
    locations: [],
  } });
  const generated = await generatePlan(app, sessionId, 1);
  const candidateId = generated.candidates[0].id as string;
  const payload = generated.candidates[0].payload;
  const before = await fetchSession(app, sessionId);
  const removedActor = before.pendingActors[0];

  const removed = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'actors', removedActor.actorId, 'resolve'), headers: adminHeaders, payload: { mode: 'remove' } });
  assert.equal(removed.statusCode, 200);
  assert.ok(removed.json().affectedStageIds.length >= 1, '应返回受影响的阶段');

  const after = await fetchSession(app, sessionId);
  assert.ok(!after.session.document.actors.some((actor) => actor.id === removedActor.actorId), '被移除的角色不应留在企划中');
  assert.ok(after.session.document.stages.every((stage) => !stage.actorIds.includes(removedActor.actorId)), '阶段引用应同步更新');
  assert.equal(after.pendingActors.length, 1);

  const remaining = after.pendingActors[0];
  await app.inject({ method: 'POST', url: adminUrl(sessionId, 'actors', remaining.actorId, 'resolve'), headers: adminHeaders, payload: { mode: 'match', characterId: secondId } });
  const fresh = await fetchSession(app, sessionId);
  const created = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'create-activity'), headers: adminHeaders, payload: {
    document: applyPlanningOutput(fresh.session.document as never, payload as never),
    candidateId,
  } });
  assert.equal(created.statusCode, 201);

  await app.close(); database.close();
});

function combinedFetch(mcp: typeof fetch, llm: typeof fetch): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    if (url.includes('/chat/completions')) return llm(input, init);
    return mcp(input, init);
  }) as typeof fetch;
}
test('research flow: create task, poll progress, save selection, preserve results', async () => {
  const database = new ServiceDatabase();
  const secrets = new MemorySecrets();
  const fetcher = combinedFetch(mcpToolFetch(), llmFetch());
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets, fetcher });

  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)')
    .run('llm', 'LLM', 'llm', 'http://llm.test/v1', 'gpt-4o', null, now, now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'llm', ?)").run(now);

  const character = await app.inject({ method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders, payload: {
    displayName: '旅行者',
    draft: { schemaVersion: 2, displayName: '旅行者', work: '原神', identity: '异乡的旅行者', personality: ['勇敢'], speech: { tone: '坚定' }, appearance: { description: '金发异乡人' } },
    tags: ['原神'],
  } });
  assert.equal(character.statusCode, 201);
  const characterId = character.json().id;

  const mcpSource = await app.inject({ method: 'POST', url: '/api/v1/admin/mcp-sources', headers: adminHeaders, payload: {
    id: 'wiki-source', name: '角色百科', url: 'https://wiki.example.com/mcp', authMode: 'none', applicableWorks: ['原神'], universal: false, purpose: '角色资料', allowedTools: ['wiki_search', 'wiki_read'], timeoutMs: 30_000,
  } });
  assert.equal(mcpSource.statusCode, 201);

  const session = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-planning-sessions', headers: adminHeaders, payload: {
    form: {
      templateId: 'blank',
      title: '旅行者的聚会',
      type: '聚会',
      theme: '温馨的午后聚会',
      location: '璃月港',
      rules: '',
      scheduledDate: null,
      characters: [{ characterId, activityRole: '主角' }],
      birthdayCharacterIds: [],
    },
  } });
  assert.equal(session.statusCode, 201);
  const sessionId = session.json().session.id;

  const research = await app.inject({ method: 'POST', url: `/api/v1/admin/activity-planning-sessions/${sessionId}/research`, headers: adminHeaders, payload: {
    leadCharacter: '旅行者',
    leadWork: '原神',
    activityType: '聚会',
    userRequest: '想办惊喜聚会，有一些跨作品的料理爱好者参加',
    crossoverWorks: ['原神'],
    guestCountPreference: 6,
    sourceIds: ['wiki-source'],
  } });
  assert.equal(research.statusCode, 202);
  const taskId = research.json().id;
  interface TaskPoll { status: string; evidence?: unknown[]; characterCandidates?: unknown[]; locationCandidates?: unknown[]; errorMessage?: string | null }
  let task: TaskPoll | null = null;
  for (let i = 0; i < 40; i += 1) {
    const poll = await app.inject({ url: `/api/v1/admin/activity-planning-sessions/${sessionId}/research/${taskId}`, headers: adminHeaders });
    task = poll.json() as TaskPoll;
    if (task?.status === 'succeeded' || task?.status === 'incomplete' || task?.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(task, 'task should exist');
  const taskResult = task as NonNullable<typeof task>;
  assert.ok(['succeeded', 'incomplete'].includes(task.status!), 'task should finish (got ' + task.status + ')');
  assert.ok((taskResult.evidence ?? []).length > 0, 'should have evidence');
  assert.ok((taskResult.characterCandidates ?? []).length > 0, 'should have character candidates');
  assert.ok((taskResult.locationCandidates ?? []).length > 0, 'should have location candidates');

  const characterCandidate = (taskResult.characterCandidates as Array<Record<string, unknown>>)[0];
  assert.equal(characterCandidate.displayName, '派蒙');
  assert.equal(characterCandidate.localMatchStatus, 'none');

  const selection = await app.inject({ method: 'PUT', url: `/api/v1/admin/activity-planning-sessions/${sessionId}/research/${taskId}/selection`, headers: adminHeaders, payload: {
    characters: [{ id: characterCandidate.id, status: 'required' }],
    locations: [{ id: (taskResult.locationCandidates as Array<Record<string, unknown>>)[0].id, status: 'required', locked: true }],
  } });
  assert.equal(selection.statusCode, 200);
  assert.equal(selection.json().selection.requiredCharacterIds.length, 1);
  assert.ok(selection.json().selection.lockedLocationId);

  const sessionDetail = await app.inject({ url: `/api/v1/admin/activity-planning-sessions/${sessionId}`, headers: adminHeaders });
  assert.ok(sessionDetail.json().session.form?.selection);

  await app.close(); database.close();
});


test('research: 引用按人物保存，修改选择不会改写旧修订', async () => {
  const { app, database, sessionId } = await bootstrapPlanningSession();
  try {
    const task = await runResearchTask(app, sessionId);
    assert.ok((task.characterCandidates[0].evidenceIds as string[]).length > 0);
    assert.deepEqual(task.characterCandidates[1].evidenceIds, []);
    assert.equal(task.characterCandidates[1].basis, 'creative');
    const session = (await app.inject({ url: adminUrl(sessionId), headers: adminHeaders })).json().session;
    const research = new ResearchStore(database);
    const before = research.getRevision(session.researchRevisionId)!;
    const saved = await app.inject({ method: 'PUT', url: adminUrl(sessionId, 'research', task.id, 'selection'), headers: adminHeaders,
      payload: { characters: [{ id: task.characterCandidates[0].id, status: 'required' }] } });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(research.getRevision(before.id), before);
    assert.equal(before.taskSnapshot!.characterCandidates[0].userStatus, 'optional');
    const after = (await app.inject({ url: adminUrl(sessionId), headers: adminHeaders })).json().session;
    assert.notEqual(after.researchRevisionId, before.id);
    assert.equal(research.getRevision(after.researchRevisionId)!.taskSnapshot!.characterCandidates[0].userStatus, 'required');
  } finally { await app.close(); database.close(); }
});

test('planning: 表单保存保持人物 ID，失败不半写入，跳过研究清除旧引用', async () => {
  const { app, database, sessionId, secondId } = await bootstrapPlanningSession();
  try {
    await runResearchTask(app, sessionId);
    const before = (await app.inject({ url: adminUrl(sessionId), headers: adminHeaders })).json().session;
    const form = { ...before.form, characters: [...before.form.characters, { characterId: secondId }] };
    delete form.researchRevisionId;
    const saved = await app.inject({ method: 'PUT', url: adminUrl(sessionId), headers: adminHeaders, payload: { form, expectedVersion: before.version } });
    assert.equal(saved.statusCode, 200, saved.body);
    const session = saved.json().session;
    assert.equal(session.document.actors[0].id, before.document.actors[0].id);
    assert.equal(session.characters.length, 2);
    assert.equal(session.characters[1].actorId, session.document.actors[1].id);
    assert.equal(session.researchRevisionId, null);
    const invalid = await app.inject({ method: 'PUT', url: adminUrl(sessionId), headers: adminHeaders,
      payload: { form: { ...form, characters: [{ characterId: 'missing' }] }, expectedVersion: session.version } });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual((await app.inject({ url: adminUrl(sessionId), headers: adminHeaders })).json().session, session);
  } finally { await app.close(); database.close(); }
});

test('planning: 采用方案只需补齐其使用的人物', async () => {
  const { app, database, sessionId, secondId } = await bootstrapPlanningSession();
  try {
    await runResearchTask(app, sessionId);
    const generated = await generatePlan(app, sessionId, 3);
    assert.equal(generated.candidates.length, 3);
    const session = await fetchSession(app, sessionId);
    const selected = session.pendingActors[0].actorId;
    await app.inject({ method: 'POST', url: adminUrl(sessionId, 'actors', selected, 'resolve'), headers: adminHeaders, payload: { mode: 'match', characterId: secondId } });
    const fresh = await fetchSession(app, sessionId);
    assert.equal(fresh.pendingActors.length, 1);
    const document = applyPlanningOutput({ ...fresh.session.document, actors: fresh.session.document.actors.filter(actor => !actor.candidateRefId || actor.id === selected) } as never, generated.candidates[0].payload as never);
    const created = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'create-activity'), headers: adminHeaders, payload: { document, candidateId: generated.candidates[0].id } });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().session.document.actors.length, 2);
  } finally { await app.close(); database.close(); }
});

test('planning: 地点约束实际校验，重试保留三份方案及原始约束', async () => {
  let repaired = false;
  let generationCalls = 0;
  const base = llmFetch();
  const llm: typeof fetch = async (url, init) => {
    const response = await base(url, init);
    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = JSON.parse(data.choices[0].message.content);
    if (content.actorRoles) {
      generationCalls++;
      if (repaired) content.activity.location = '自家天台';
      data.choices[0].message.content = JSON.stringify(content);
    }
    return Response.json(data);
  };
  const { app, database, sessionId } = await bootstrapPlanningSession(llm);
  try {
    const task = await runResearchTask(app, sessionId);
    await app.inject({ method: 'PUT', url: adminUrl(sessionId, 'research', task.id, 'selection'), headers: adminHeaders,
      payload: { addLocations: [{ id: 'user_loc_roof', name: '自家天台', status: 'required', locked: true }] } });
    const generated = await generatePlan(app, sessionId, 3);
    assert.equal(generated.job.status, 'failed');
    assert.equal(generationCalls, 3);
    const job = (await app.inject({ url: adminUrl(sessionId), headers: adminHeaders })).json().jobs[0];
    assert.match(job.errorMessage, /锁定/);
    repaired = true;
    const retry = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'jobs', job.id, 'retry'), headers: adminHeaders });
    assert.equal(retry.statusCode, 202);
    let finished;
    for (let i = 0; i < 80; i++) {
      finished = (await app.inject({ url: adminUrl(sessionId, 'jobs', job.id), headers: adminHeaders })).json();
      if (finished.job.status === 'succeeded' || finished.job.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(finished.job.status, 'succeeded', finished.job.errorMessage);
    assert.equal(finished.candidates.length, 3);
    assert.equal(generationCalls, 6);
  } finally { await app.close(); database.close(); }
});

test('planning: 取消后迟到的模型响应不会创建方案或覆盖状态', async () => {
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const base = llmFetch();
  const { app, database, sessionId } = await bootstrapPlanningSession(async (url, init) => { entered(); await gate; return base(url, init); });
  try {
    const start = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'jobs'), headers: adminHeaders, payload: { planCount: 3 } });
    await enteredPromise;
    const cancelled = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'jobs', start.json().id, 'cancel'), headers: adminHeaders });
    assert.equal(cancelled.json().status, 'cancelled');
    release();
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = (await app.inject({ url: adminUrl(sessionId, 'jobs', start.json().id), headers: adminHeaders })).json();
    assert.equal(result.job.status, 'cancelled');
    assert.deepEqual(result.candidates, []);
    assert.equal((await fetchSession(app, sessionId)).session.status, 'draft');
  } finally { release(); await app.close(); database.close(); }
});


test('research: 取消后迟到响应不能继续检索或覆盖取消状态', async () => {
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const base = llmFetch();
  const { app, database, sessionId } = await bootstrapPlanningSession(async (url, init) => { entered(); await gate; return base(url, init); });
  try {
    const start = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'research'), headers: adminHeaders, payload: { sourceIds: ['wiki-source'] } });
    await enteredPromise;
    const cancelled = await app.inject({ method: 'POST', url: adminUrl(sessionId, 'research', start.json().id, 'cancel'), headers: adminHeaders });
    assert.equal(cancelled.json().status, 'cancelled');
    release();
    await new Promise(resolve => setTimeout(resolve, 30));
    const task = (await app.inject({ url: adminUrl(sessionId, 'research', start.json().id), headers: adminHeaders })).json();
    assert.equal(task.status, 'cancelled');
    assert.equal(task.usedToolCalls, 0);
    assert.deepEqual(task.characterCandidates, []);
  } finally { release(); await app.close(); database.close(); }
});
