import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import test from 'node:test';
import type { ComicDocument } from '@sthstart/contracts';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { buildComicOfflineReaderZip } from './activities/comic-exports.js';
import { readZip } from './activities/zip.js';
import { ActivityStore } from './activities/store.js';
import { ComicStore } from './activities/comic-store.js';
import { createService } from './server.js';
import { SecretStore } from './security.js';

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=', 'base64');

function document(artifactId: string | null): ComicDocument {
  return {
    schemaVersion: 1,
    contentRevisionId: 'content-revision',
    style: 'ink-paper-v1',
    canvas: { width: 1920, height: 1080 },
    pages: [{ id: 'page-one', title: '雪山分镜', template: 'single', panelIds: ['panel-one'] }],
    panels: [{
      id: 'panel-one', source: { stageId: 'stage-one', sceneId: 'scene-one', beatIds: ['beat-one'] }, actorIds: ['actor-one'],
      shotSize: 'medium', visualDescription: '</script><script>window.pwned=true</script>', composition: '人物居中', textSafeArea: 'top_left',
      selectedImage: artifactId ? { artifactId, origin: 'comic_render', renderJobId: 'job-one', sourceFingerprint: 'fingerprint-one' } : null,
      crop: { focalX: 0.5, focalY: 0.5, zoom: 1 }, bubbles: [],
      presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {},
    }],
  };
}

function routeStory() {
  return {
    schemaVersion: 1 as const,
    activity: { title: '雪山小样', type: '短篇', theme: '结晶', location: '雪山营地', rules: '', generationMode: 'fill_details' as const },
    actors: [{ id: 'actor-one', displayName: '阿贝多', activityRole: '研究者', outfitDescription: '炼金术师服装',
      persona: { appearance: { baseText: '浅金色短发' } }, appearanceReferenceAssetKeys: [] }],
    relationships: [], stages: [{ id: 'stage-one', title: '实验', order: 1, actorIds: ['actor-one'], location: '营地', instruction: '', requiredBeats: [], locked: false, endCondition: '' }],
    scenes: [{ id: 'scene-one', stageId: 'stage-one', title: '观察结晶', timeText: '傍晚', locationText: '实验桌', environment: '风雪渐起', beats: [
      { id: 'beat-one', characterId: 'actor-one', action: '观察结晶', dialogue: '反应稳定', outcome: '完成分析', orderIndex: 0 },
    ] }],
    conversations: [], messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [],
  };
}

function routeDocument(revisionId: string, artifactId: string, jobId: string): ComicDocument {
  return {
    schemaVersion: 1, contentRevisionId: revisionId, style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 },
    pages: [{ id: 'page-one', title: '雪山分镜', template: 'single', panelIds: ['panel-one'] }],
    panels: [{
      id: 'panel-one', source: { stageId: 'stage-one', sceneId: 'scene-one', beatIds: ['beat-one'] }, actorIds: ['actor-one'],
      shotSize: 'medium', visualDescription: '阿贝多观察结晶', composition: '人物居中', textSafeArea: 'top_left',
      selectedImage: { artifactId, origin: 'comic_render', renderJobId: jobId, sourceFingerprint: 'fingerprint-one' },
      crop: { focalX: 0.5, focalY: 0.5, zoom: 1 }, bubbles: [], presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {},
    }],
  };
}

test('offline comic export contains only local assets and safely embeds comic text', () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-comic-export-'));
  const database = new ServiceDatabase(':memory:');
  const now = nowIso();
  const imagePath = join(artifactDirectory, 'panel.png');
  writeFileSync(imagePath, imageBytes);
  database.connection.prepare(`INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('activities','Activities','comic-export-test-token-hash','[]',1,?,?)`).run(now, now);
  database.connection.prepare(`INSERT INTO artifacts(id,app_id,local_path,content_type,byte_size,created_at,media_type,file_status)
    VALUES ('comic-image-one','activities',?,'image/png',?,?,'image','ready')`).run(imagePath, imageBytes.length, now);

  try {
    const config = readConfig({ STHSTART_ADMIN_TOKEN: 'comic-export-test-admin-token-1234567890', STHSTART_ARTIFACT_DIR: artifactDirectory });
    const archive = buildComicOfflineReaderZip({ database, config, activityId: 'activity-one', document: document('comic-image-one'), revisionId: 'revision-one' });
    const files = readZip(archive);
    assert.ok(files.has('index.html'));
    assert.ok(files.has('assets/reader.js'));
    assert.ok(files.has('assets/images/image-001.png'));
    assert.ok(files.has('assets/fonts/NotoSansSC-VF.ttf'));
    assert.ok(files.has('licenses/NotoSansSC-OFL.txt'));
    const html = new TextDecoder().decode(files.get('index.html')!);
    assert.match(html, /\\u003c\/script>/, 'inline comic data escapes the script-closing delimiter');
    assert.doesNotMatch(html, /<script>window\.pwned=true/);
    assert.doesNotMatch(html, /https?:\/\//, 'the reader has no remote script, font, or image URL');
    assert.doesNotMatch(html, new RegExp(artifactDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const reader = new TextDecoder().decode(files.get('assets/reader.js')!);
    assert.doesNotMatch(reader, /\bfetch\s*\(/, 'the offline reader does not call an API');
    assert.doesNotThrow(() => new Script(reader), 'the bundled offline reader is valid JavaScript');

    assert.throws(() => buildComicOfflineReaderZip({ database, config, activityId: 'activity-one', document: document(null), revisionId: 'revision-two' }),
      (error: Error & { code?: string }) => error.code === 'comic_export_images_unavailable');
    const overflowing = document('comic-image-one');
    overflowing.panels[0].bubbles = [{ id: 'overflow-bubble', kind: 'speech', speakerActorId: null,
      text: '雪山实验'.repeat(40), rect: { x: 0.1, y: 0.1, width: 0.15, height: 0.07 }, tail: null, fontSize: 32 }];
    assert.throws(() => buildComicOfflineReaderZip({ database, config, activityId: 'activity-one', document: overflowing, revisionId: 'revision-three' }),
      (error: Error & { code?: string; details?: string[] }) => error.code === 'comic_bubble_overflow' && Boolean(error.details?.[0]?.includes('overflow-bubble')));
  } finally {
    database.close();
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});

test('comic reader export route serves an immutable revision and reports missing panel images', async () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-comic-export-route-'));
  const database = new ServiceDatabase(':memory:');
  const adminToken = 'comic-export-route-admin-token-1234567890';
  const headers = { 'x-sthstart-admin-token': adminToken };
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken, STHSTART_ARTIFACT_DIR: artifactDirectory });
  const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher: async () => new Response('unexpected request', { status: 404 }) });
  const imagePath = join(artifactDirectory, 'route-panel.png');
  writeFileSync(imagePath, imageBytes);
  try {
    const activity = new ActivityStore(database).createActivity({ title: '雪山小样', type: '短篇', initialDocument: routeStory() }).activity;
    const activityId = activity.id;
    const comicStore = new ComicStore(database);
    const draft = comicStore.createComicDraft(activityId, activity.currentContentRevisionId!);
    const created = comicStore.createComicJob({ activityId, kind: 'render', panelId: 'panel-one', idempotencyKey: 'export-render-one',
      request: { sourceFingerprint: 'fingerprint-one' }, traceId: 'trace-one' });
    comicStore.updateComicJob(created.job.id, { status: 'succeeded' });
    database.connection.prepare(`INSERT INTO artifacts(id,app_id,local_path,content_type,byte_size,created_at,media_type,file_status)
      VALUES ('route-comic-image','activities',?,'image/png',?,?,'image','ready')`).run(imagePath, imageBytes.length, nowIso());
    comicStore.recordComicJobOutputs(created.job.id, ['route-comic-image']);
    const saved = comicStore.saveComicDraft(activityId, draft.draftVersion, routeDocument(activity.currentContentRevisionId!, 'route-comic-image', created.job.id));
    const revision = comicStore.createComicRevision(activityId, saved.draftVersion);
    const path = `/api/v1/admin/activities/${activityId}/comic/exports/reader`;
    const response = await app.inject({ method: 'POST', url: path, headers, payload: { revisionId: revision.id } });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers['content-type'] ?? '', /application\/zip/);
    const files = readZip(response.rawPayload);
    assert.ok(files.has('index.html'));
    assert.ok(files.has('assets/images/image-001.png'));

    rmSync(imagePath, { force: true });
    const missing = await app.inject({ method: 'POST', url: path, headers, payload: { revisionId: revision.id } });
    assert.equal(missing.statusCode, 409, missing.body);
    assert.equal(missing.json().error, 'comic_export_images_unavailable');
    assert.match(missing.json().details[0], /panel-one/);
  } finally {
    await app.close();
    database.close();
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});
