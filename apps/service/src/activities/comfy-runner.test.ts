import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContentDocument } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { readConfig } from '../config.js';
import { compileBeatPrompt, executeComfyBeatRender, findEffectiveBeat } from './comfy-runner.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ActivityStore } from './store.js';
import { createService } from '../server.js';
import { SecretStore } from '../security.js';

const stage = { id: 'stage-1', title: '测试', order: 1, actorIds: [], location: '', instruction: '', requiredBeats: [], locked: false, endCondition: '' };
const scene = { id: 'scene-1', stageId: 'stage-1', title: '', timeText: '', locationText: '', beats: [{ id: 'beat-1', characterId: 'actor-1', action: '新的动作', outcome: '故事结果' }] };
const document = {
  schemaVersion: 1,
  activity: { title: '测试活动', type: '聚会', theme: '单测', location: '', rules: '', generationMode: 'fill_details' },
  stages: [{ ...stage, scenes: [{ ...scene, beats: [{ ...scene.beats[0], action: '旧动作' }] }] }],
  scenes: [scene],
  actors: [{ id: 'actor-1', displayName: '角色甲' }],
  relationships: [], conversations: [], messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [],
} as unknown as ContentDocument;

function comfyFetchSequence(options: { image?: Uint8Array; imageContentType?: string; omitOutput?: boolean } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/system_stats')) return new Response('{}', { status: 200 });
    if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'prompt-1' });
    if (url.endsWith('/history/prompt-1')) {
      return Response.json(options.omitOutput ? { 'prompt-1': { outputs: {} } } : {
        'prompt-1': { outputs: { '9': { images: [{ filename: 'generated.png', subfolder: '', type: 'output' }] } } },
      });
    }
    if (url.includes('/view?')) return new Response(Buffer.from(options.image || Uint8Array.from([137, 80, 78, 71])), {
      status: 200,
      headers: { 'content-type': options.imageContentType || 'image/png' },
    });
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

function seedDraft(database: ServiceDatabase, sourceDocument: ContentDocument) {
  const store = new ActivityStore(database);
  const { activity, draft } = store.createActivity({
    title: sourceDocument.activity.title,
    type: sourceDocument.activity.type,
    initialDocument: sourceDocument,
  });
  assert.equal(draft.document.activity.title, sourceDocument.activity.title);
  return activity.id;
}

test('beat prompt reads the top-level scene for its stage', () => {
  const database = new ServiceDatabase();
  try {
    assert.equal(findEffectiveBeat(document, 'stage-1', 'beat-1')?.beat.action, '新的动作');
    assert.equal(findEffectiveBeat(document, 'other-stage', 'beat-1'), null);
    const prompt = compileBeatPrompt(database, document, 'stage-1', 'beat-1');
    assert.match(prompt.positivePrompt, /新的动作/);
    assert.doesNotMatch(prompt.positivePrompt, /旧动作/);
    assert.match(compileBeatPrompt(database, document, 'stage-1', 'beat-1').positivePrompt, /故事结果/);
  } finally {
    database.close();
  }
});

test('beat lookup merges matching legacy media without crossing stage or deletion boundaries', () => {
  const merged = structuredClone(document);
  merged.stages[0].scenes = [
    { ...scene, stageId: 'stage-1', beats: [{ ...scene.beats[0], mediaUrl: '/legacy.png', mediaType: 'image' }] },
    { ...scene, id: 'legacy-only', stageId: 'stage-1', beats: [{ ...scene.beats[0], id: 'legacy-beat', action: '旧场次动作' }] },
    { ...scene, id: 'other-stage-scene', stageId: 'stage-2', beats: [{ ...scene.beats[0], id: 'other-stage-beat' }] },
  ];
  assert.equal(findEffectiveBeat(merged, 'stage-1', 'beat-1')?.beat.mediaUrl, '/legacy.png');
  assert.equal(findEffectiveBeat(merged, 'stage-1', 'legacy-beat'), null);
  assert.equal(findEffectiveBeat(merged, 'stage-1', 'other-stage-beat'), null);
});

test('top-level scenes and beats remain authoritative after legacy deletion', () => {
  const merged = structuredClone(document);
  merged.scenes = [{ ...scene, beats: [{ ...scene.beats[0], id: 'kept-beat', action: 'canonical' }] }];
  merged.stages[0].scenes = [
    { ...scene, beats: [{ ...scene.beats[0], id: 'deleted-beat', action: 'removed' }] },
    { ...scene, id: 'deleted-scene', beats: [{ ...scene.beats[0], id: 'deleted-scene-beat' }] },
  ];
  assert.equal(findEffectiveBeat(merged, 'stage-1', 'kept-beat')?.beat.action, 'canonical');
  assert.equal(findEffectiveBeat(merged, 'stage-1', 'deleted-beat'), null);
  assert.equal(findEffectiveBeat(merged, 'stage-1', 'deleted-scene-beat'), null);
});

test('unsupported video fails without creating an artifact', async () => {
  const database = new ServiceDatabase();
  try {
    const config = readConfig({ STHSTART_ADMIN_TOKEN: 'test-admin-token-123456789012345' });
    await assert.rejects(
      executeComfyBeatRender(config, database, 'missing-activity', { stageId: 'stage-1', beatId: 'beat-1', mediaType: 'video' }),
      /video_generation_not_supported/,
    );
  } finally {
    database.close();
  }
});

test('activity API rejects video generation with a clear error and no artifact', async (t) => {
  const database = new ServiceDatabase();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'test-admin-token-123456789012345' });
  const { app } = await createService({ config, database, secrets: new SecretStore({}) });
  const activityId = seedDraft(database, document);
  t.after(async () => { await app.close(); database.close(); });

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/generate-beat-media`,
    headers: { 'x-sthstart-admin-token': 'test-admin-token-123456789012345' },
    payload: { stageId: 'stage-1', beatId: 'beat-1', mediaType: 'video' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'video_generation_not_supported');

  const unavailableEngineResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/activities/${activityId}/generate-beat-media`,
    headers: { 'x-sthstart-admin-token': 'test-admin-token-123456789012345' },
    payload: { stageId: 'stage-1', beatId: 'beat-1', mediaType: 'image', engineId: 'missing-engine', checkpoint: 'missing.safetensors' },
  });
  assert.equal(unavailableEngineResponse.statusCode, 502);
  assert.equal(unavailableEngineResponse.json().error, 'comfy_engine_unavailable');
  const count = database.connection.prepare('SELECT COUNT(*) AS count FROM artifacts').get() as { count: number };
  assert.equal(count.count, 0);
});

test('ComfyUI image succeeds through mocked fetch and uploads only the returned image', async (t) => {
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-comfy-test-'));
  t.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const database = new ServiceDatabase();
  t.after(() => database.close());
  const activityId = seedDraft(database, document);
  const now = new Date().toISOString();
  database.connection.prepare(`INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('activities','Activities','test-token-hash','[]',1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('comfy-test','Comfy test','comfyui','http://comfy.test',1,1,'now','now')`).run();
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
  const { fetcher, calls } = comfyFetchSequence({ image: imageBytes });
  const config = readConfig({
    STHSTART_ADMIN_TOKEN: 'test-admin-token-123456789012345',
    STHSTART_ARTIFACT_DIR: artifactDirectory,
  });
  const result = await executeComfyBeatRender(config, database, activityId, {
    stageId: 'stage-1', beatId: 'beat-1', engineId: 'comfy-test', checkpoint: 'test.safetensors', seed: 7,
  }, undefined, { fetcher, pollIntervalMs: 0, maxPollAttempts: 1 });
  assert.equal(result.success, true);
  assert.equal(result.mediaType, 'image');
  assert.match(result.mediaUrl, /^\/api\/admin\/artifacts\/.+\/file$/);
  assert.equal(calls.filter((call) => call.url.endsWith('/prompt')).length, 1);
  const artifactId = result.mediaUrl.split('/').at(-2)!;
  assert.deepEqual(await readFile(resolve(artifactDirectory, 'activities', `${artifactId}.png`)), imageBytes);
});

test('ComfyUI connection failure and timeout create no artifacts', async (t) => {
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-comfy-test-'));
  t.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const database = new ServiceDatabase();
  t.after(() => database.close());
  const activityId = seedDraft(database, document);
  const now = new Date().toISOString();
  database.connection.prepare(`INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('activities','Activities','test-token-hash','[]',1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('comfy-test','Comfy test','comfyui','http://comfy.test',1,1,'now','now')`).run();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'test-admin-token-123456789012345', STHSTART_ARTIFACT_DIR: artifactDirectory });
  const failingFetch: typeof fetch = async () => { throw new Error('offline'); };
  await assert.rejects(executeComfyBeatRender(config, database, activityId,
    { stageId: 'stage-1', beatId: 'beat-1', engineId: 'comfy-test', checkpoint: 'test.safetensors' },
    undefined, { fetcher: failingFetch, pollIntervalMs: 0, maxPollAttempts: 1 }), /comfy_connection_failed/);

  const timeout = comfyFetchSequence({ omitOutput: true });
  await assert.rejects(executeComfyBeatRender(config, database, activityId,
    { stageId: 'stage-1', beatId: 'beat-1', engineId: 'comfy-test', checkpoint: 'test.safetensors' },
    undefined, { fetcher: timeout.fetcher, pollIntervalMs: 0, maxPollAttempts: 1 }), /comfy_output_timeout/);
  const count = database.connection.prepare('SELECT COUNT(*) AS count FROM artifacts').get() as { count: number };
  assert.equal(count.count, 0);
});

test('ComfyUI response with a non-image payload is rejected before artifact storage', async (t) => {
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), 'sthstart-comfy-test-'));
  t.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const database = new ServiceDatabase();
  t.after(() => database.close());
  const activityId = seedDraft(database, document);
  const now = new Date().toISOString();
  database.connection.prepare(`INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('activities','Activities','test-token-hash','[]',1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('comfy-test','Comfy test','comfyui','http://comfy.test',1,1,'now','now')`).run();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: 'test-admin-token-123456789012345', STHSTART_ARTIFACT_DIR: artifactDirectory });
  const fakeImage = comfyFetchSequence({ image: Buffer.from('<svg>not an image</svg>'), imageContentType: 'image/svg+xml' });
  await assert.rejects(executeComfyBeatRender(config, database, activityId,
    { stageId: 'stage-1', beatId: 'beat-1', engineId: 'comfy-test', checkpoint: 'test.safetensors' },
    undefined, { fetcher: fakeImage.fetcher, pollIntervalMs: 0, maxPollAttempts: 1 }), /comfy_invalid_image_output/);
  const count = database.connection.prepare('SELECT COUNT(*) AS count FROM artifacts').get() as { count: number };
  assert.equal(count.count, 0);
});
