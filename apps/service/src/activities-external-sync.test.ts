import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ServiceDatabase } from './database.js';
import { readConfig } from './config.js';
import { createService } from './server.js';
import { SecretStore } from './security.js';

const adminToken = 'admin-sync-test-token-1234567890';
const adminHeaders = { 'x-sthstart-admin-token': adminToken };

test('Activity Studio: external pipeline sync creates activity with scenes and media', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'sthstart-sync-test-'));
  const dummyVideo = resolve(dir, 'test-render.mp4');
  await writeFile(dummyVideo, 'dummy-video-binary-content');

  const database = new ServiceDatabase(resolve(dir, 'service.db'));
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: adminToken,
    STHSTART_DATABASE_PATH: resolve(dir, 'service.db'),
    STHSTART_DATA_DIR: dir,
  });
  const secrets = new SecretStore({});
  const { app } = await createService({ config, database, secrets });

  const syncPayload = {
    title: '阿贝多的雪山密信',
    theme: '雪山探险与未解之谜',
    actors: [
      {
        id: 'actor_albedo',
        displayName: '阿贝多',
        activityRole: '首席炼金术士',
        persona: { tone: '严谨、冷静' },
        outfitDescription: '雪山炼金常服',
      },
    ],
    scenes: [
      {
        id: 'scene_camp',
        title: '第 1 场：雪山营地',
        timeText: '清晨 07:00',
        locationText: '龙脊雪山·阿贝多的营地',
        environment: '风雪呼啸，炉火微明',
        beats: [
          {
            id: 'beat_1',
            characterId: 'actor_albedo',
            characterName: '阿贝多',
            action: '阿贝多 站在炼金台前观察烧瓶反应',
            dialogue: '温度下降得比预想的还要快。',
            outcome: '发现了特殊的冰晶结晶',
            mediaUrl: dummyVideo,
            mediaType: 'video',
          },
        ],
      },
    ],
  };

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities/sync-external',
    headers: adminHeaders,
    payload: syncPayload,
  });

  if (response.statusCode !== 200) {
    console.error('Response error:', response.statusCode, response.json());
  }
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.success, true);
  assert.ok(body.activityId);
  assert.equal(body.sceneCount, 1);
  assert.equal(body.beatCount, 1);

  // Verify the activity can be retrieved
  const getRes = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/activities/${body.activityId}`,
    headers: adminHeaders,
  });
  assert.equal(getRes.statusCode, 200);
  const getBody = getRes.json();
  assert.equal(getBody.activity.title, '阿贝多的雪山密信');
  const stage = getBody.draft.document.stages[0];
  assert.equal(stage.scenes.length, 1);
  assert.equal(stage.scenes[0].title, '第 1 场：雪山营地');
  assert.equal(stage.scenes[0].beats[0].characterName, '阿贝多');
  assert.equal(stage.scenes[0].beats[0].mediaType, 'video');
  // mediaUrl should have been ingested as an artifact file url
  assert.ok(stage.scenes[0].beats[0].mediaUrl.startsWith('/api/admin/artifacts/'));

  // Verify updating existing activity
  const updatePayload = {
    activityId: body.activityId,
    title: '阿贝多的雪山密信（第二幕已更新）',
    scenes: [
      {
        id: 'scene_camp',
        title: '第 1 场：雪山营地（深入调查）',
        timeText: '上午 10:00',
        locationText: '龙脊雪山·阿贝多的营地',
        environment: '暴风雪平息，结晶开始散发微光',
        beats: [
          {
            id: 'beat_1',
            characterId: 'actor_albedo',
            characterName: '阿贝多',
            action: '阿贝多 记录实验数据',
            dialogue: '结论证实了我的假设。',
            mediaUrl: dummyVideo,
            mediaType: 'video',
          },
        ],
      },
    ],
  };

  const updateRes = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/activities/sync-external',
    headers: adminHeaders,
    payload: updatePayload,
  });

  if (updateRes.statusCode !== 200) {
    console.error('Update error:', updateRes.statusCode, updateRes.json());
  }
  assert.equal(updateRes.statusCode, 200);
  const updateBody = updateRes.json();
  assert.equal(updateBody.success, true);
  assert.equal(updateBody.activityId, body.activityId);
  assert.equal(updateBody.headVersion, 2);

  await app.close();
  database.close();
});
