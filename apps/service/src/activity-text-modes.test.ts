import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { adoptCandidate, executeTextJob, retryTextJob } from './activities/text-jobs.js';

const adminToken = 'activity-text-modes-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

function minimalDocument() {
  return {
    schemaVersion: 1 as const,
    activity: { title: '海边营地烧烤', type: '生活与聚会', theme: '篝火与烧烤', location: '海边营地', rules: '', generationMode: 'fill_details' as const, scheduledDate: '2026-08-08' },
    actors: [
      {
        id: 'actor_a', displayName: '甲', activityRole: '主厨', outfitDescription: '便服', appearanceReferenceAssetKeys: [],
        persona: { displayName: '甲', identity: '擅长生火', personality: ['沉稳', '细心'], speech: { tone: '简短', habits: '先做事后说话', catchphrases: ['可以了'], examples: ['火候到了。'] }, sourceSnapshot: { likes: ['烤肉'], dislikes: ['浪费食物'] } },
      },
      { id: 'actor_b', displayName: '乙', activityRole: '记录者', outfitDescription: '便服', appearanceReferenceAssetKeys: [], persona: { displayName: '乙', identity: '喜欢拍照', sourceSnapshot: { likes: ['照片'] } } },
    ],
    relationships: [{ fromActorId: 'actor_a', toActorId: 'actor_b', description: '多年好友' }],
    stages: [
      { id: 'stage_1', title: '搭营地', order: 1, actorIds: ['actor_a', 'actor_b'], location: '海边营地', instruction: '搭帐篷与烤架', requiredBeats: [{ id: 'beat_1', text: '搭好烤架', actorIds: ['actor_a'] }], locked: false, endCondition: '营地就绪' },
      { id: 'stage_2', title: '烧烤晚会', order: 2, actorIds: ['actor_a', 'actor_b'], location: '海边营地', instruction: '边烤边聊', requiredBeats: [], locked: false, endCondition: '天黑收摊' },
    ],
    conversations: [{ id: 'group_main', kind: 'group' as const, title: '营地群', memberActorIds: ['actor_a', 'actor_b'] }],
    messages: [{ id: 'msg_existing', conversationId: 'group_main', stageId: 'stage_1', kind: 'message' as const, speakerActorId: 'actor_b', text: '我先去搬东西了', mediaSlotIds: [], storyOrder: 1 }],
    posts: [{ id: 'post_existing', stageId: 'stage_2', authorActorId: 'actor_b', text: '今晚看星星', mediaSlotIds: [], storyOrder: 2, sourceFactIds: [] }],
    comments: [{ id: 'comment_existing', postId: 'post_existing', authorActorId: 'actor_a', text: '记得带外套', storyOrder: 3 }],
    likes: [{ postId: 'post_existing', actorId: 'actor_a' }],
    mediaSlots: [], facts: [], stageResults: [],
  };
}

async function setup() {
  const database = new ServiceDatabase();
  const fetcher: typeof fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    schemaVersion: 1,
    stageId: 'stage_2',
    summary: '阶段纪要',
    messages: [{ clientId: 'm1', conversationId: 'group_main', speakerActorId: 'actor_a', text: '两位都到了吗？', mediaClientIds: [], order: 10 }],
    posts: [{ clientId: 'p1', authorActorId: 'actor_b', text: '今晚的海风很舒服', mediaClientIds: [], sourceFactClientIds: [], order: 20 }],
    comments: [], facts: [], mediaSlots: [],
  }) } }] });
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: adminToken }), database, secrets: new SecretStore({}), fetcher });
  const now = new Date().toISOString();
  database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('text-modes-llm', 'LLM', 'llm', 'http://llm.test/v1', 'test-model', null, now, now);
  database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'text-modes-llm', ?)").run(now);
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders, payload: { document: minimalDocument() } });
  assert.equal(created.statusCode, 201, created.body);
  const store = new ActivityStore(database);
  return { app, database, store, activityId: created.json().activity.id as string, created: created.json() };
}

test('activity creation keeps the full stage definitions instead of only titles', async () => {
  const { app, database, store, activityId } = await setup();
  try {
    const document = store.getDraft(activityId)!.document;
    assert.equal(document.stages[0].instruction, '搭帐篷与烤架');
    assert.deepEqual(document.stages[0].requiredBeats.map((beat) => beat.text), ['搭好烤架']);
    assert.equal(document.activity.scheduledDate, '2026-08-08');
  } finally { await app.close(); database.close(); }
});

test('snippet modes append invitation and wish text without wiping existing stage content', async () => {
  const { app, database, store, activityId, created } = await setup();
  try {
    const document = store.getDraft(activityId)!.document;
    const job = store.createJob({ activityId, kind: 'text', mode: 'invite', requestHash: 'invite-proof' }).job;
    const prompts: string[] = [];
    await executeTextJob({
      store, database, secrets: new SecretStore({}), activityId, jobId: job.id, mode: 'invite',
      scope: { stageId: 'stage_2', speakerActorId: 'actor_a' }, inputSnapshot: document,
      fetcher: async (_input, init) => {
        prompts.push(String(init?.body));
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          schemaVersion: 1, stageId: 'stage_2',
          messages: [{ clientId: 'm1', conversationId: 'group_main', speakerActorId: 'actor_a', text: '晚上来营地，火已经生好了。', order: 10 }],
          posts: [], facts: [], mediaSlots: [],
        }) } }] });
      },
    });
    assert.equal(store.getJob(activityId, job.id)?.status, 'succeeded');
    // 提示词包含完整人设细节，便于模型保持角色一致性。
    assert.ok(prompts[0].includes('可以了') || prompts[0].includes('火候到了'), prompts[0].slice(0, 200));
    const candidateId = store.getJob(activityId, job.id)!.resultCandidateIds[0];
    adoptCandidate(database, store, activityId, candidateId, created.activity.headVersion);
    const adopted = store.getDraft(activityId)!.document;
    assert.equal(adopted.messages.some((message) => message.text === '晚上来营地，火已经生好了。'), true);
    // 追加写入不会清掉阶段内已有内容。
    assert.equal(adopted.messages.some((message) => message.id === 'msg_existing'), true);
    assert.equal(adopted.posts.some((post) => post.id === 'post_existing'), true);
    assert.equal(adopted.comments.some((comment) => comment.id === 'comment_existing'), true);
  } finally { await app.close(); database.close(); }
});

test('rewrite candidates only change the selected records and reject stale targets', async () => {
  const { app, database, store, activityId, created } = await setup();
  try {
    const document = store.getDraft(activityId)!.document;
    const job = store.createJob({ activityId, kind: 'text', mode: 'rewrite-records', requestHash: 'rewrite-proof' }).job;
    const prompts: string[] = [];
    await executeTextJob({
      store, database, secrets: new SecretStore({}), activityId, jobId: job.id, mode: 'rewrite-records',
      scope: { recordIds: ['msg_existing'] }, instructions: '更活泼一些', inputSnapshot: document,
      fetcher: async (_input, init) => {
        prompts.push(String(init?.body));
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          schemaVersion: 1,
          rewrittenMessages: [{ id: 'msg_existing', text: '搬东西交给我，你们先歇会儿！' }],
          rewrittenPosts: [],
        }) } }] });
      },
    });
    assert.equal(store.getJob(activityId, job.id)?.status, 'succeeded');
    const candidateId = store.getJob(activityId, job.id)!.resultCandidateIds[0];
    adoptCandidate(database, store, activityId, candidateId, created.activity.headVersion);
    const adopted = store.getDraft(activityId)!.document;
    assert.equal(adopted.messages.find((message) => message.id === 'msg_existing')?.text, '搬东西交给我，你们先歇会儿！');
    // 未选中的记录保持不变。
    assert.equal(adopted.posts.find((post) => post.id === 'post_existing')?.text, '今晚看星星');
    assert.equal(adopted.comments.length, 1);
    // 记录被删除后候选失效，不能再写入。
    const staleDoc = { ...adopted, messages: adopted.messages.filter((message) => message.id !== 'msg_existing') };
    store.updateDraft(activityId, store.getDraft(activityId)!.draftVersion, staleDoc);
    assert.throws(() => adoptCandidate(database, store, activityId, candidateId, store.getActivity(activityId)!.headVersion), /已被修改/);
  } finally { await app.close(); database.close(); }
});

test('retry replays the original request and refuses jobs without a snapshot', async () => {
  const { app, database, store, activityId } = await setup();
  try {
    const document = store.getDraft(activityId)!.document;
    const prompts: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      prompts.push(String(init?.body));
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const marker = '阶段 ID: ';
      const content = body.messages[1].content;
      const markerIndex = content.indexOf(marker);
      const stageId = markerIndex >= 0 ? content.slice(markerIndex + marker.length).split('\n')[0].replace('\r', '').split(' ')[0].split('（')[0].trim() : 'stage_2';
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: 1, stageId, summary: '纪要', messages: [], posts: [], comments: [], facts: [], mediaSlots: [],
      }) } }] });
    };
    const job = store.createJob({
      activityId, kind: 'text', mode: 'stage', requestHash: 'retry-proof',
      request: { mode: 'stage', scope: { stageId: 'stage_1' }, userInstruction: '保持安静的氛围', inputSnapshot: document },
    }).job;
    // 先失败，再用同一个任务重试，重试必须沿用原来的阶段与要求。
    await executeTextJob({ store, database, secrets: new SecretStore({}), activityId, jobId: job.id, mode: 'stage', scope: { stageId: 'stage_1' }, instructions: '保持安静的氛围',
      inputSnapshot: document, fetcher: async () => new Response('boom', { status: 500 }) });
    assert.equal(store.getJob(activityId, job.id)?.status, 'failed');
    await retryTextJob(database, new SecretStore({}), store, activityId, job.id, fetcher);
    const finished = await waitFor(() => { const current = store.getJob(activityId, job.id); return current && (current.status === 'succeeded' || current.status === 'failed') ? current : null; });
    assert.equal(finished.status, 'succeeded', String(finished.errorMessage));
    assert.ok(prompts[0].includes('保持安静的氛围'));
    assert.ok(prompts[0].includes('stage_1'));

    // 没有请求快照的旧任务不能被冒充成原请求重试。
    const legacy = store.createJob({ activityId, kind: 'text', mode: 'plan', requestHash: 'legacy-proof' }).job;
    const retried = await retryTextJob(database, new SecretStore({}), store, activityId, legacy.id, fetcher);
    assert.equal(retried?.status, 'failed');
    assert.match(String(retried?.errorMessage), /原始输入快照/);
  } finally { await app.close(); database.close(); }
});

async function waitFor<T>(check: () => T | null, timeoutMs = 5_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
