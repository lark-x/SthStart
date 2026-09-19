import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildActivityDocument } from '@sthstart/contracts';
const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT || 4200}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
test('rework: source change can be kept across refresh, with a working source link', async ({ page, request }) => {
    const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8'));
    const created = await request.post(service + '/api/v1/admin/activities', { headers, data: { document } });
    expect(created.ok()).toBeTruthy();
    const { activity, draft } = await created.json();
    document.actors[0].outfitDescription = '本场新礼服';
    const saved = await request.put(`${service}/api/v1/admin/activities/${activity.id}/draft`, { headers, data: { expectedDraftVersion: draft.draftVersion, document } });
    expect(saved.ok()).toBeTruthy();
    const published = await request.post(`${service}/api/v1/admin/activities/${activity.id}/commit`, { headers, data: { expectedHeadVersion: activity.headVersion, expectedDraftVersion: (await saved.json()).draftVersion } });
    expect(published.ok()).toBeTruthy();
    await page.goto(`/apps/activities/${activity.id}`);
    await page.getByRole('button', { name: /查看 \d+ 项内容变化/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/服装已修改/).first()).toBeVisible();
    await dialog.getByRole('button', { name: '选择可处理项' }).click();
    await dialog.getByRole('button', { name: '确认保留', exact: true }).click();
    await expect(dialog.getByText('没有待复核内容，可以继续创作。')).toBeVisible();
    await page.reload();
    await page.getByText('更多操作', { exact: true }).click();
    await page.getByRole('button', { name: '内容变化与处理历史' }).click();
    await page.getByLabel('显示已处理和历史变化').check();
    await expect(page.getByText(/已确认保留/).first()).toBeVisible();
    await page.getByRole('link', { name: '修改本场源头' }).first().click();
    await expect(page.getByLabel('服装', { exact: true }).first()).toHaveValue('本场新礼服');
    await page.screenshot({ path: '/tmp/sthstart-rework-source.png', fullPage: true });
});
test('rework: default profile and template role selection are visible in creation', async ({ page, request }) => {
    const profile = await request.post(service + '/api/v1/admin/activity-presets', { headers, data: { kind: 'creation_profile', name: 'UI 验证配置', payload: { candidateCount: 2, instruction: '温暖日常' } } });
    expect(profile.ok()).toBeTruthy();
    const p = await profile.json();
    await request.post(service + '/api/v1/admin/activity-creation-profile/default', { headers, data: { id: p.id } });
    try {
        const template = await request.post(service + '/api/v1/admin/activity-presets', { headers, data: { kind: 'activity_template', name: 'UI 职责模板', payload: { schemaVersion: 2, roleSlots: [{ id: 'lead', label: '主角', required: true, multiple: false }], stages: [{ title: '欢迎 {{role.lead}}', roleSlotIds: ['lead'] }, { title: '合照', roleSlotIds: ['lead'] }] } } });
        const t = await template.json();
        /*
         * 手动表单已移除，模板与角色职责映射改到向导第一步验证。
         * 向导用「活动模板」下拉，选中自定义模板后会出现职责映射面板。
         */
        await page.goto('/apps/activities/new');
        await page.getByLabel('活动模板').selectOption(t.id);
        await page.getByRole('button', { name: '自定义参与者' }).first().click();
        await page.getByLabel('自定义参与者 1 名称').fill('旅行者');
        await expect(page.getByText('本次活动的角色职责')).toBeVisible();
        await page.screenshot({ path: '/tmp/sthstart-rework-template.png', fullPage: true });
    }
    finally {
        await request.post(service + '/api/v1/admin/activity-creation-profile/default', { headers, data: { id: null } });
    }
});
test('rework: compare and adopt two messages, then resume the remaining one', async ({ page, request }) => {
    test.skip(!process.env.E2E_REWORK_DATABASE_PATH, 'Candidate seeding requires an explicit isolated test database');
    const doc = buildActivityDocument({ templateId: 'blank', title: '局部采用页面验证', type: '聚会', actors: [{ id: 'actor', displayName: '旅行者', persona: {}, activityRole: '主角', outfitDescription: '便装', appearanceReferenceAssetKeys: [] }] });
    doc.conversations = [{ id: 'chat', kind: 'group', title: '活动群', memberActorIds: ['actor'] }];
    doc.messages = [1, 2, 3].map(n => ({ id: `m${n}`, kind: 'message', conversationId: 'chat', stageId: doc.stages[0].id, speakerActorId: 'actor', text: `旧内容 ${n}`, storyOrder: n, mediaSlotIds: [] }));
    const created = await request.post(service + '/api/v1/admin/activities', { headers, data: { document: doc } });
    expect(created.ok()).toBeTruthy();
    const { activity } = await created.json();
    const { ServiceDatabase } = await import('../../apps/service/src/database');
    const { ActivityStore } = await import('../../apps/service/src/activities/store');
    const { rewriteBaseline } = await import('../../apps/service/src/activities/candidate-review');
    const database = new ServiceDatabase(process.env.E2E_REWORK_DATABASE_PATH);
    let candidateId = '';
    const jobId = crypto.randomUUID();
    try {
        const store = new ActivityStore(database);
        const c = store.createCandidate({ activityId: activity.id, scope: { mode: 'rewrite-records', jobId, recordIds: ['m1', 'm2', 'm3'], reviewBaseline: rewriteBaseline(doc, { recordIds: ['m1', 'm2', 'm3'] }) }, payload: { rewrittenMessages: [1, 2, 3].map(n => ({ id: `m${n}`, text: `新内容 ${n}` })) }, validation: {} });
        candidateId = c.id;
        database.connection.prepare("INSERT INTO activity_jobs(id,activity_id,kind,mode,status,request_hash,result_candidate_ids_json,model_metadata_json,created_at,updated_at) VALUES(?,?,'text','rewrite-records','succeeded','ui',?,'{}',?,?)").run(jobId, activity.id, JSON.stringify([c.id]), new Date().toISOString(), new Date().toISOString());
    }
    finally {
        database.close();
    }
    await page.goto(`/apps/activities/${activity.id}?tab=records&jobId=${jobId}`);
    await expect(page.getByText('对比并采用所选内容')).toBeVisible();
    const articles = page.getByRole('dialog').locator('article');
    await articles.nth(0).getByRole('checkbox').check();
    await articles.nth(1).getByRole('checkbox').check();
    await page.getByRole('button', { name: '采用所选 2 项' }).click();
    await expect(articles.filter({ hasText: '（已采用）' })).toHaveCount(2);
    await page.reload();
    await expect(page.getByText('对比并采用所选内容')).toBeVisible();
    await page.getByRole('button', { name: '选择所有可采用项' }).click();
    await page.getByRole('button', { name: '采用所选 1 项' }).click();
    await expect(page.getByRole('dialog').locator('article').filter({ hasText: '（已采用）' })).toHaveCount(3);
    const comparison = await request.get(`${service}/api/v1/admin/activities/${activity.id}/candidates/${candidateId}/comparison`, { headers });
    expect((await comparison.json()).units.every((u: {
        applied: boolean;
    }) => u.applied)).toBeTruthy();
    await page.screenshot({ path: '/tmp/sthstart-rework-candidates.png', fullPage: true });
});
test('rework: applying a profile to an existing activity requires preview and updates the frozen snapshot', async ({ page, request }) => {
    const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8'));
    const created = await request.post(service + '/api/v1/admin/activities', { headers, data: { document } });
    const { activity } = await created.json();
    const response = await request.post(service + '/api/v1/admin/activity-presets', { headers, data: { kind: 'creation_profile', name: '本场水彩配置', payload: { globalStylePrompt: 'watercolor', candidateCount: 2 } } });
    const profile = await response.json();
    await page.goto(`/apps/activities/${activity.id}?tab=settings`);
    await page.getByText('高级选项：创作偏好与模板（可选）').click();
    await page.getByLabel('创作配置', { exact: true }).selectOption(profile.id);
    await expect(page.getByText('套用「本场水彩配置」的参数预览')).toBeVisible();
    const applied = page.waitForResponse(r => r.url().endsWith('/creation-profile/apply') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '确认套用', exact: true }).click();
    expect((await applied).ok()).toBeTruthy();
    await expect(page.getByText(/已冻结「本场水彩配置」/)).toBeVisible();
    const config = await request.get(`${service}/api/v1/admin/activities/${activity.id}/image-config/draft`, { headers });
    expect((await config.json()).document.globalStylePrompt).toBe('watercolor');
});
