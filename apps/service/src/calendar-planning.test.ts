import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { queryCalendar } from './calendar.js';

const adminToken = 'calendar-planning-test-token-1234567';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };
const config = () => readConfig({ STHSTART_ADMIN_TOKEN: adminToken });

async function waitFor<T>(check: () => Promise<T | null> | T | null, timeoutMs = 5_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function createCharacter(app: Awaited<ReturnType<typeof createService>>['app'], input: { name: string; identity?: string; birthday?: unknown; work?: string }) {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/admin/characters', headers: adminHeaders,
    payload: { displayName: input.name, draft: { displayName: input.name, work: input.work || '', identity: input.identity || '普通身份', ...(input.birthday ? { birthday: input.birthday } : {}) } },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

test('calendar lists yearly birthdays for same-day characters and skips invalid or missing ones', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: config(), database, secrets: new SecretStore({}) });
  try {
    const a = await createCharacter(app, { name: '同一天甲', work: '原神', birthday: { status: 'known', calendar: 'gregorian', month: 3, day: 14, source: 'manual' } });
    const b = await createCharacter(app, { name: '同一天乙', work: '原神', birthday: { status: 'known', calendar: 'gregorian', month: 3, day: 14, source: 'manual' } });
    const leap = await createCharacter(app, { name: '闰日角色', birthday: { status: 'known', calendar: 'gregorian', month: 2, day: 29, source: 'manual' } });
    await createCharacter(app, { name: '农历角色', birthday: { status: 'needs_confirmation', calendar: 'lunar', rawText: '农历八月十五' } });
    await createCharacter(app, { name: '没有生日' });
    // 明确清空过的旧文本生日不能被自动补回。
    await createCharacter(app, { name: '清空生日', identity: '档案\n生日：3月14日', birthday: { status: 'unset', calendar: 'unknown', source: 'manual' } });
    // 从未处理过的旧文本生日按派生结果进入日历。
    const derived = await createCharacter(app, { name: '派生生日', identity: '档案\n生日：5月20日' });

    const response = await app.inject({ url: '/api/v1/admin/calendar?from=2026-03-01&to=2026-03-31', headers: adminHeaders });
    assert.equal(response.statusCode, 200, response.body);
    const items = response.json().events as Array<{ kind: string; date: string; characterId?: string }>;
    const march14 = items.filter((event) => event.kind === 'birthday' && event.date === '2026-03-14');
    assert.equal(march14.length, 2);
    assert.deepEqual(new Set(march14.map((event) => event.characterId)), new Set([a.id, b.id]));
    assert.equal(items.some((event) => event.characterId === leap.id), false);

    // 2 月 29 日只在闰年显示，平年不平移。
    const leapYear = (await app.inject({ url: '/api/v1/admin/calendar?from=2028-02-01&to=2028-02-29', headers: adminHeaders })).json().events as Array<{ date: string; characterId?: string }>;
    assert.equal(leapYear.some((event) => event.date === '2028-02-29' && event.characterId === leap.id), true);

    const may = (await app.inject({ url: '/api/v1/admin/calendar?from=2026-05-01&to=2026-05-31', headers: adminHeaders })).json().events as Array<{ characterId?: string }>;
    assert.equal(may.some((event) => event.characterId === derived.id), true);

    assert.throws(() => queryCalendar(database, { from: '2026-01-01', to: '2027-06-01' }), /calendar_range_too_large|invalid_calendar_range/);
  } finally { await app.close(); database.close(); }
});

test('calendar projects activity schedules and supports character, kind and range filters', async () => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: config(), database, secrets: new SecretStore({}) });
  try {
    const host = await createCharacter(app, { name: '寿星甲', work: '原神', birthday: { status: 'known', calendar: 'gregorian', month: 9, day: 9, source: 'manual' } });
    const guest = await createCharacter(app, { name: '客人乙', work: '崩坏：星穹铁道' });
    await createCharacter(app, { name: '无关角色', work: '原神' });

    const snapshotHost = (await app.inject({ url: `/api/v1/admin/activities/characters/${host.id}/snapshot`, headers: adminHeaders })).json();
    const snapshotGuest = (await app.inject({ url: `/api/v1/admin/activities/characters/${guest.id}/snapshot`, headers: adminHeaders })).json();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/admin/activities', headers: adminHeaders,
      payload: { document: {
        schemaVersion: 1,
        activity: { title: '寿星甲的生日会', type: '生日聚会', theme: '生日', location: '家里', rules: '', generationMode: 'fill_details', scheduledDate: '2026-09-09', templateId: 'birthday', birthdayActorIds: [snapshotHost.id] },
        actors: [snapshotHost, snapshotGuest], relationships: [],
        stages: [
          { id: 'stage_1', title: '准备', order: 1, actorIds: [snapshotHost.id], location: '家里', instruction: '', requiredBeats: [], locked: false, endCondition: '' },
          { id: 'stage_2', title: '庆祝', order: 2, actorIds: [snapshotHost.id, snapshotGuest.id], location: '家里', instruction: '', requiredBeats: [], locked: false, endCondition: '' },
        ],
        conversations: [{ id: 'group_main', kind: 'group', title: '生日会', memberActorIds: [snapshotHost.id, snapshotGuest.id] }],
        messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [],
      } },
    });
    assert.equal(created.statusCode, 201, created.body);
    const activityId = created.json().activity.id as string;
    assert.equal(created.json().activity.scheduledDate, '2026-09-09');

    const september = (await app.inject({ url: '/api/v1/admin/calendar?from=2026-09-01&to=2026-09-30', headers: adminHeaders })).json().events as Array<{ kind: string; activityId?: string; characterId?: string }>;
    assert.equal(september.filter((event) => event.kind === 'activity').length, 1);
    assert.equal(september.find((event) => event.kind === 'activity')?.activityId, activityId);

    // 角色条件对活动按“任一参与者符合”匹配，并且活动只返回一项。
    const byHost = (await app.inject({ url: `/api/v1/admin/calendar?from=2026-09-01&to=2026-09-30&filter=${encodeURIComponent(JSON.stringify({ works: ['原神'] }))}`, headers: adminHeaders })).json().events as Array<{ kind: string }>;
    assert.equal(byHost.filter((event) => event.kind === 'activity').length, 1);
    const byStarRail = (await app.inject({ url: `/api/v1/admin/calendar?from=2026-09-01&to=2026-09-30&filter=${encodeURIComponent(JSON.stringify({ works: ['崩坏：星穹铁道'] }))}`, headers: adminHeaders })).json().events as Array<{ kind: string }>;
    assert.equal(byStarRail.filter((event) => event.kind === 'activity').length, 1);
    const byUnknownWork = (await app.inject({ url: `/api/v1/admin/calendar?from=2026-09-01&to=2026-09-30&filter=${encodeURIComponent(JSON.stringify({ works: ['不存在的作品'] }))}`, headers: adminHeaders })).json().events as Array<{ kind: string }>;
    assert.equal(byUnknownWork.length, 0);

    const onlyBirthdays = (await app.inject({ url: `/api/v1/admin/calendar?from=2026-09-01&to=2026-09-30&filter=${encodeURIComponent(JSON.stringify({ kinds: ['birthday'] }))}`, headers: adminHeaders })).json().events as Array<{ kind: string }>;
    assert.equal(onlyBirthdays.every((event) => event.kind === 'birthday'), true);

    // 改期后投影同步更新，旧日期不再出现。
    const detail = (await app.inject({ url: `/api/v1/admin/activities/${activityId}`, headers: adminHeaders })).json();
    const movedDoc = { ...detail.draft.document, activity: { ...detail.draft.document.activity, scheduledDate: '2026-10-01' } };
    const savedDraft = await app.inject({ method: 'PUT', url: `/api/v1/admin/activities/${activityId}/draft`, headers: adminHeaders, payload: { expectedDraftVersion: detail.draft.draftVersion, document: movedDoc } });
    assert.equal(savedDraft.statusCode, 200, savedDraft.body);
    const committed = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/draft/commit`, headers: adminHeaders, payload: { expectedHeadVersion: detail.activity.headVersion, expectedDraftVersion: detail.draft.draftVersion + 1 } });
    assert.equal(committed.statusCode, 200, committed.body);
    const septemberAfter = (await app.inject({ url: '/api/v1/admin/calendar?from=2026-09-01&to=2026-09-30', headers: adminHeaders })).json().events as Array<{ kind: string }>;
    assert.equal(septemberAfter.filter((event) => event.kind === 'activity').length, 0);
    const october = (await app.inject({ url: '/api/v1/admin/calendar?from=2026-10-01&to=2026-10-31', headers: adminHeaders })).json().events as Array<{ kind: string }>;
    assert.equal(october.filter((event) => event.kind === 'activity').length, 1);

    // 归档后不再出现在日历上。
    await app.inject({ method: 'PUT', url: `/api/v1/admin/activities/${activityId}`, headers: adminHeaders, payload: { expectedHeadVersion: 2, archived: true } });
    const afterArchive = (await app.inject({ url: '/api/v1/admin/calendar?from=2026-10-01&to=2026-10-31', headers: adminHeaders })).json().events as Array<{ kind: string }>;
    assert.equal(afterArchive.filter((event) => event.kind === 'activity').length, 0);
  } finally { await app.close(); database.close(); }
});

test('planning session freezes personas, generates a candidate, and creates an idempotent activity', async () => {
  const database = new ServiceDatabase();
  const requests: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    requests.push(String(init?.body || ''));
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      schemaVersion: 1,
      activity: { title: '甲的生日惊喜派对', theme: '为甲准备惊喜生日会', location: '天台', rules: '保密', overview: '大家一起为甲准备惊喜派对。' },
      actorRoles: [],
      stages: [
        { clientId: 'plan_s1', title: '准备', actorIds: [], location: '天台', description: '布置场地', requiredBeats: ['完成布置'], endCondition: '准备完成' },
        { clientId: 'plan_s2', title: '庆祝', actorIds: [], location: '天台', description: '庆祝生日', requiredBeats: ['送上蛋糕'], endCondition: '活动结束' },
      ],
    }) } }] });
  };
  const { app } = await createService({ config: config(), database, secrets: new SecretStore({}), fetcher });
  try {
    const now = new Date().toISOString();
    database.connection.prepare('INSERT INTO provider_profiles VALUES (?,?,?,?,?,?,1,?,?)').run('plan-llm', 'LLM', 'llm', 'http://llm.test/v1', 'test-model', null, now, now);
    database.connection.prepare("INSERT INTO app_llm_assignments VALUES ('activities', 'text', 'plan-llm', ?)").run(now);
    const host = await createCharacter(app, { name: '主角甲', birthday: { status: 'known', calendar: 'gregorian', month: 9, day: 9, source: 'manual' } });
    const guest = await createCharacter(app, { name: '朋友乙' });

    const created = await app.inject({
      method: 'POST', url: '/api/v1/admin/activity-planning-sessions', headers: adminHeaders,
      payload: { form: {
        templateId: 'birthday', title: '甲的生日会', type: '生日聚会', theme: '', location: '天台', rules: '', scheduledDate: '2026-09-09',
        characters: [{ characterId: host.id }, { characterId: guest.id }], birthdayCharacterIds: [host.id], instruction: '想要一个天台惊喜',
      } },
    });
    assert.equal(created.statusCode, 201, created.body);
    const session = created.json().session;
    assert.equal(session.document.stages.length, 4);
    assert.equal(session.document.activity.scheduledDate, '2026-09-09');
    assert.equal(session.document.activity.birthdayActorIds.length, 1);

    const jobResponse = await app.inject({ method: 'POST', url: `/api/v1/admin/activity-planning-sessions/${session.id}/jobs`, headers: adminHeaders, payload: { idempotencyKey: 'plan-1' } });
    assert.equal(jobResponse.statusCode, 202, jobResponse.body);
    const jobId = jobResponse.json().id as string;
    const finished = await waitFor(async () => {
      const polled = await app.inject({ url: `/api/v1/admin/activity-planning-sessions/${session.id}/jobs/${jobId}`, headers: adminHeaders });
      const body = polled.json();
      return body.job.status === 'succeeded' || body.job.status === 'failed' ? body : null;
    });
    assert.equal(finished.job.status, 'succeeded', finished.job.errorMessage);
    assert.ok(requests[0].includes('天台惊喜'));
    const candidate = finished.candidates[0];
    assert.equal(candidate.payload.stages.length, 2);

    // 用编辑后的企划创建活动：日期与寿星保持用户设定。
    const edited = JSON.parse(JSON.stringify(session.document));
    edited.activity.title = '甲的生日惊喜派对';
    edited.stages = candidate.payload.stages.map((stage: Record<string, unknown>, index: number) => ({
      id: `stage_${index + 1}`, title: stage.title, order: index + 1,
      actorIds: session.document.stages[index]?.actorIds || [], location: stage.location, instruction: stage.description,
      requiredBeats: (stage.requiredBeats as string[]).map((text, beatIndex) => ({ id: `beat_${index + 1}_${beatIndex + 1}`, text, actorIds: [] })),
      locked: false, endCondition: stage.endCondition,
    }));
    const firstCreate = await app.inject({ method: 'POST', url: `/api/v1/admin/activity-planning-sessions/${session.id}/create-activity`, headers: adminHeaders, payload: { document: edited } });
    assert.equal(firstCreate.statusCode, 201, firstCreate.body);
    const activityId = firstCreate.json().activity.id as string;
    assert.equal(firstCreate.json().activity.scheduledDate, '2026-09-09');
    const secondCreate = await app.inject({ method: 'POST', url: `/api/v1/admin/activity-planning-sessions/${session.id}/create-activity`, headers: adminHeaders, payload: { document: edited } });
    assert.equal(secondCreate.statusCode, 200, secondCreate.body);
    assert.equal(secondCreate.json().activity.id, activityId);
    assert.equal(database.connection.prepare('SELECT count(*) count FROM activities').get()!.count, 1);

    const calendar = (await app.inject({ url: '/api/v1/admin/calendar?from=2026-09-01&to=2026-09-30', headers: adminHeaders })).json().events as Array<{ kind: string; activityId?: string }>;
    assert.equal(calendar.find((event) => event.kind === 'activity')?.activityId, activityId);

    // 提交的角色人设必须与会话快照一致。
    const tampered = JSON.parse(JSON.stringify(edited));
    tampered.actors[0].persona = { ...tampered.actors[0].persona, identity: '被替换的身份' };
    const session2 = (await app.inject({
      method: 'POST', url: '/api/v1/admin/activity-planning-sessions', headers: adminHeaders,
      payload: { form: { templateId: 'birthday', title: '乙的生日会', scheduledDate: '2026-09-09', characters: [{ characterId: guest.id }], birthdayCharacterIds: [guest.id] } },
    })).json().session;
    const tamperDoc = JSON.parse(JSON.stringify(session2.document));
    tamperDoc.actors[0].persona = { ...tamperDoc.actors[0].persona, identity: '被替换的身份' };
    const rejected = await app.inject({ method: 'POST', url: `/api/v1/admin/activity-planning-sessions/${session2.id}/create-activity`, headers: adminHeaders, payload: { document: tamperDoc } });
    assert.equal(rejected.statusCode, 409, rejected.body);

    // 草稿在生成后发生变化时拒绝创建。
    const third = (await createCharacter(app, { name: '草稿角色', identity: '初版设定' })).id as string;
    const session3 = (await app.inject({
      method: 'POST', url: '/api/v1/admin/activity-planning-sessions', headers: adminHeaders,
      payload: { form: { templateId: 'gathering', title: '草稿角色的聚会', characters: [{ characterId: third }], birthdayCharacterIds: [] } },
    })).json().session;
    const current = (await app.inject({ url: `/api/v1/admin/characters/${third}`, headers: adminHeaders })).json();
    await app.inject({ method: 'PUT', url: `/api/v1/admin/characters/${third}`, headers: adminHeaders, payload: { draft: { ...current.draft, identity: '改过的设定' }, expectedDraftRevision: current.draftRevision } });
    const stale = await app.inject({ method: 'POST', url: `/api/v1/admin/activity-planning-sessions/${session3.id}/create-activity`, headers: adminHeaders, payload: { document: session3.document } });
    assert.equal(stale.statusCode, 409, stale.body);
  } finally { await app.close(); database.close(); }
});
