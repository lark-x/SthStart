import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { applySavedActivityTemplate, createActivityPreset, updateActivityPreset, deleteActivityPreset } from './activities/presets.js';
import { buildActivityDocument } from '@sthstart/contracts';

const adminToken = 'activity-presets-token-123456789012345';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

test('activity reusable presets CRUD and template instantiation', async (t) => {
  const database = new ServiceDatabase();
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
  });
  const secrets = new SecretStore({});
  const { app } = await createService({ config, database, secrets });

  t.after(async () => {
    await app.close();
    database.close();
  });

  let createdTemplateId = '';
  let createdProductionPresetId = '';

  await t.test('POST /api/v1/admin/activity-presets - create activity template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/activity-presets',
      headers: adminHeaders,
      payload: {
        kind: 'activity_template',
        name: '海滩度假派对模板',
        payload: {
          activityType: '度假派对',
          theme: '海滩欢聚',
          location: '黄金海岸',
          stages: [
            {
              title: '集合与冲浪',
              instruction: '换上沙滩泳装集合',
              location: '沙滩俱乐部',
              requiredBeats: ['到达沙滩', '挑选冲浪板'],
              roleSlotIds: ['organizer', 'guest'],
              endCondition: '所有角色在水边集合',
            },
            {
              title: '落日篝火晚会',
              instruction: '点燃篝火，分享故事与烤肉',
              location: '海边营地',
              requiredBeats: ['点燃篝火', '合影留念'],
              roleSlotIds: ['organizer', 'guest', 'chef'],
              endCondition: '晚会结束',
            },
          ],
        },
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.kind, 'activity_template');
    assert.equal(body.name, '海滩度假派对模板');
    assert.equal(body.version, 1);
    assert.ok(body.id.startsWith('preset_'));
    createdTemplateId = body.id;
  });

  await t.test('POST /api/v1/admin/activity-presets - create production preset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/activity-presets',
      headers: adminHeaders,
      payload: {
        kind: 'production_preset',
        name: '日系动漫精选画风',
        payload: {
          candidateCountPerSlot: 2,
          stylePrompt: 'anime aesthetic, vibrant colors, soft lighting',
          referenceImageStrategy: 'appearance_only',
        },
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.kind, 'production_preset');
    assert.equal(body.name, '日系动漫精选画风');
    assert.equal(body.version, 1);
    createdProductionPresetId = body.id;
  });

  await t.test('GET /api/v1/admin/activity-presets - list and filter by kind', async () => {
    const listAllRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/activity-presets',
      headers: adminHeaders,
    });
    assert.equal(listAllRes.statusCode, 200);
    const allPresets = listAllRes.json().items;
    assert.ok(allPresets.length >= 2);

    const listTemplateRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/activity-presets?kind=activity_template',
      headers: adminHeaders,
    });
    assert.equal(listTemplateRes.statusCode, 200);
    const templates = listTemplateRes.json().items;
    assert.ok(templates.every((p: { kind: string }) => p.kind === 'activity_template'));
    assert.ok(templates.some((p: { id: string }) => p.id === createdTemplateId));

    const listProdRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/activity-presets?kind=production_preset',
      headers: adminHeaders,
    });
    assert.equal(listProdRes.statusCode, 200);
    const prodPresets = listProdRes.json().items;
    assert.ok(prodPresets.every((p: { kind: string }) => p.kind === 'production_preset'));
    assert.ok(prodPresets.some((p: { id: string }) => p.id === createdProductionPresetId));
  });

  await t.test('GET /api/v1/admin/activity-presets/:id - get single preset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/activity-presets/${createdTemplateId}`,
      headers: adminHeaders,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.id, createdTemplateId);
    assert.equal(body.name, '海滩度假派对模板');
    assert.equal(body.payload.location, '黄金海岸');
  });

  await t.test('PATCH /api/v1/admin/activity-presets/:id - update preset increments version', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/activity-presets/${createdTemplateId}`,
      headers: adminHeaders,
      payload: {
        name: '豪华海滩度假派对模板',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.name, '豪华海滩度假派对模板');
    assert.equal(body.version, 2);
  });

  await t.test('POST /api/v1/admin/activity-presets/:id/instantiate - instantiate template into activity draft', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/activity-presets/${createdTemplateId}/instantiate`,
      headers: adminHeaders,
      payload: {
        title: '2026 夏日特别企划',
        location: '马尔代夫沙滩',
        actorMappings: {
          organizer: 'actor_lumine',
          guest: 'actor_paimon',
          chef: 'actor_xiangling',
        },
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.title, '2026 夏日特别企划');
    assert.equal(body.type, '度假派对');
    assert.equal(body.location, '马尔代夫沙滩');
    assert.equal(body.templateMetadata.presetId, createdTemplateId);
    assert.equal(body.templateMetadata.presetVersion, 2);

    assert.equal(body.stages.length, 2);
    // Stage 1
    assert.ok(body.stages[0].id.startsWith('stage_1_'));
    assert.equal(body.stages[0].title, '集合与冲浪');
    assert.deepEqual(body.stages[0].actorIds, ['actor_lumine', 'actor_paimon']);
    assert.equal(body.stages[0].requiredBeats.length, 2);
    assert.equal(body.stages[0].requiredBeats[0].text, '到达沙滩');
    assert.equal(body.stages[0].locked, false);

    // Stage 2
    assert.ok(body.stages[1].id.startsWith('stage_2_'));
    assert.equal(body.stages[1].title, '落日篝火晚会');
    assert.deepEqual(body.stages[1].actorIds, ['actor_lumine', 'actor_paimon', 'actor_xiangling']);

    // Ensure it does NOT carry old messages, posts, media assets, or task history
    assert.equal((body as Record<string, unknown>).messages, undefined);
    assert.equal((body as Record<string, unknown>).posts, undefined);
    assert.equal((body as Record<string, unknown>).slotBindings, undefined);
  });

  await t.test('POST /api/v1/admin/activity-presets/:id/instantiate - rejects non-template preset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/activity-presets/${createdProductionPresetId}/instantiate`,
      headers: adminHeaders,
      payload: {
        title: '测试非法实例化',
        actorMappings: {},
      },
    });
    assert.equal(res.statusCode, 400);
  });

  await t.test('DELETE /api/v1/admin/activity-presets/:id - delete preset', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/activity-presets/${createdProductionPresetId}`,
      headers: adminHeaders,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);

    const checkRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/activity-presets/${createdProductionPresetId}`,
      headers: adminHeaders,
    });
    assert.equal(checkRes.statusCode, 404);
  });
});

test('saved template applies stage roles and freezes its version across planning edits', () => {
  const database = new ServiceDatabase();
  try {
    const preset = createActivityPreset(database, { kind: 'activity_template', name: '生日模板', payload: {
      rules: '保密惊喜', roleSlots: [{ id: 'lead' }, { id: 'guest' }],
      stages: [{ title: '朋友布置', instruction: '朋友提前布置', roleSlotIds: ['guest'] },
        { title: '寿星到场', instruction: '寿星吹蜡烛', roleSlotIds: ['lead'] }],
    } });
    const makeDocument = () => buildActivityDocument({ templateId: preset.id, title: '生日会', actors: [
      { id: 'friend', displayName: '朋友', activityRole: '', outfitDescription: '', appearanceReferenceAssetKeys: [], persona: { displayName: '朋友' } },
      { id: 'birthday', displayName: '寿星', activityRole: '', outfitDescription: '', appearanceReferenceAssetKeys: [], persona: { displayName: '寿星' } },
    ], birthdayActorIds: ['birthday'] });
    const first = applySavedActivityTemplate(database, makeDocument(), preset.id);
    assert.equal(first.stages[0].instruction, '朋友提前布置');
    assert.deepEqual(first.stages[0].actorIds, ['friend']);
    assert.deepEqual(first.stages[1].actorIds, ['birthday']);
    assert.equal(first.activity.rules, '保密惊喜');
    updateActivityPreset(database, preset.id, { payload: { stages: [{ title: '新的模板' }] } });
    const edited = applySavedActivityTemplate(database, makeDocument(), preset.id, first);
    assert.equal(edited.activity.templateSnapshot?.version, 1);
    assert.deepEqual(edited.stages, first.stages);
    deleteActivityPreset(database, preset.id);
    assert.equal(applySavedActivityTemplate(database, makeDocument(), preset.id, first).stages[0].title, '朋友布置');
    assert.throws(() => applySavedActivityTemplate(database, makeDocument(), preset.id), /模板不存在/);
  } finally { database.close(); }
});
