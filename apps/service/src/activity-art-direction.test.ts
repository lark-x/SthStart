import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityDocument } from '@sthstart/contracts';
import { createService } from './server.js';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { createActivityPreset } from './activities/presets.js';
import { getImageConfigDraft } from './activities/image-configs.js';
const token = 'art-direction-test-admin-123456789';
const headers = { 'x-sthstart-admin-token': token };
const payload = {
  schemaKind: 'activity_art_style_v1', positiveStylePrompt: 'ink', negativePrompt: '',
  renderProfiles: { draft: null, final: null }, defaultQuality: 'draft',
  defaultCanvas: { width: 1152, height: 648 }, previewArtifactId: null,
};
test('art style routes are admin-only, version checked, and separate from production presets', async t => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: token }), database, secrets: new SecretStore({}) });
  t.after(async () => { await app.close(); database.close(); });
  createActivityPreset(database, { kind: 'production_preset', name: '旧批次预设', payload: { candidateCountPerSlot: 2 } });
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/activity-art-styles' })).statusCode, 401);
  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/activity-art-styles', headers, payload: { name: '水墨', payload } });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const update = await app.inject({ method: 'PUT', url: `/api/v1/admin/activity-art-styles/${id}`, headers, payload: { name: '新版', payload, expectedVersion: 1 } });
  assert.equal(update.statusCode, 200, update.body);
  assert.equal(update.json().version, 2);
  const legacyBypass = await app.inject({ method: 'PATCH', url: `/api/v1/admin/activity-presets/${id}`, headers, payload: { name: '绕过版本检查' } });
  assert.equal(legacyBypass.statusCode, 409);
  assert.equal(legacyBypass.json().error, 'art_style_route_required');
  assert.equal((await app.inject({ method: 'PUT', url: `/api/v1/admin/activity-art-styles/${id}`, headers, payload: { name: '冲突', payload, expectedVersion: 1 } })).statusCode, 409);
  const list = await app.inject({ method: 'GET', url: '/api/v1/admin/activity-art-styles', headers });
  assert.equal(list.json().items.length, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/activity-art-styles', headers, payload: { name: '坏配置', payload: { ...payload, defaultCanvas: { width: 0, height: 648 } } } })).statusCode, 400);
});
test('atomic art direction commit rolls back the draft on head conflict', async t => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: token }), database, secrets: new SecretStore({}) });
  t.after(async () => { await app.close(); database.close(); });
  const store = new ActivityStore(database);
  const { activity } = store.createActivity({ title: '画风验收', type: '测试', initialDocument: buildActivityDocument({ templateId: 'blank', title: '画风验收', type: '测试', theme: '', location: '', rules: '', actors: [] }) });
  const before = getImageConfigDraft(database, activity.id);
  const document = { ...before.document, globalStylePrompt: 'ink' };
  const request = { expectedHeadVersion: activity.headVersion + 100, expectedImageConfigDraftVersion: before.draftVersion, document };
  const url = `/api/v1/admin/activities/${activity.id}/art-direction/commit`;
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: request })).statusCode, 409);
  assert.deepEqual(getImageConfigDraft(database, activity.id), before);
  const legacyConflict = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activity.id}/image-config/revisions`, headers,
    payload: { expectedHeadVersion: activity.headVersion + 100, expectedDraftVersion: before.draftVersion, document } });
  assert.equal(legacyConflict.statusCode, 409);
  assert.deepEqual(getImageConfigDraft(database, activity.id), before);
  const success = await app.inject({ method: 'POST', url, headers, payload: { ...request, expectedHeadVersion: activity.headVersion } });
  assert.equal(success.statusCode, 200, success.body);
  assert.equal(success.json().draft.document.globalStylePrompt, 'ink');
  assert.equal(success.json().activity.headVersion, activity.headVersion + 1);
});
