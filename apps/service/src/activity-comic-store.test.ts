import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComicDocument, ContentDocument } from '@sthstart/contracts';
import { ActivityStore } from './activities/store.js';
import { ComicStore } from './activities/comic-store.js';
import { validateComicDocument } from './activities/comic-validation.js';
import { ServiceDatabase } from './database.js';

function sourceDocument(): ContentDocument {
  return {
    schemaVersion: 1,
    activity: { title: '漫画存储测试', type: '短篇', theme: '相遇', location: '庭院', rules: '', generationMode: 'fill_details' },
    actors: [{ id: 'actor-a', displayName: '角色甲', activityRole: '主角', outfitDescription: '浅色外套',
      persona: { appearance: { baseText: '黑发' } }, appearanceReferenceAssetKeys: [] }],
    relationships: [],
    stages: [{ id: 'stage-a', title: '相遇', order: 1, actorIds: ['actor-a'], location: '庭院', instruction: '', requiredBeats: [], locked: false, endCondition: '' }],
    conversations: [], messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [],
    scenes: [{ id: 'scene-a', stageId: 'stage-a', title: '庭院', timeText: '白天', locationText: '庭院', environment: '', beats: [
      { id: 'beat-a', characterId: 'actor-a', action: '挥手', dialogue: '你好', outcome: '相遇', orderIndex: 0 },
    ] }],
  } as ContentDocument;
}

function onePanelDocument(contentRevisionId: string): ComicDocument {
  return {
    schemaVersion: 1,
    contentRevisionId,
    style: 'ink-paper-v1',
    canvas: { width: 1920, height: 1080 },
    pages: [{ id: 'page-a', title: '相遇', template: 'single', panelIds: ['panel-a'] }],
    panels: [{
      id: 'panel-a', source: { stageId: 'stage-a', sceneId: 'scene-a', beatIds: ['beat-a'] }, actorIds: ['actor-a'],
      shotSize: 'medium', visualDescription: '角色挥手', composition: '人物位于画面左侧', textSafeArea: 'bottom',
      selectedImage: null, crop: { focalX: 0.5, focalY: 0.5, zoom: 1 },
      bubbles: [{ id: 'bubble-a', kind: 'speech', speakerActorId: 'actor-a', text: '你好', rect: { x: 0.1, y: 0.7, width: 0.6, height: 0.2 }, tail: null, fontSize: 32 }],
      presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {},
    }],
  };
}

function setup() {
  const database = new ServiceDatabase(':memory:');
  const activityStore = new ActivityStore(database);
  const created = activityStore.createActivity({ title: '漫画存储测试', type: '短篇', initialDocument: sourceDocument() });
  const comicStore = new ComicStore(database);
  return { database, activityId: created.activity.id, contentRevisionId: created.activity.currentContentRevisionId!, comicStore };
}

test('comic contract migration creates draft, revision, job, and output tables', () => {
  const { database } = setup();
  const tables = new Set((database.connection.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
  for (const table of ['activity_comic_drafts', 'activity_comic_revisions', 'activity_comic_jobs', 'activity_comic_job_outputs']) assert.ok(tables.has(table));
  const comicMigration = database.connection.prepare('SELECT name FROM schema_migrations WHERE version = 43').get() as { name: string } | undefined;
  assert.equal(comicMigration?.name, 'activity-comic-drafts-revisions-and-jobs');
  database.close();
});

test('comic draft saves are compare-and-swap and revisions remain immutable', () => {
  const { database, activityId, contentRevisionId, comicStore } = setup();
  const created = comicStore.createComicDraft(activityId, contentRevisionId);
  assert.equal(created.draftVersion, 1);
  assert.equal(created.document.pages.length, 0);
  const document = onePanelDocument(contentRevisionId);
  const saved = comicStore.saveComicDraft(activityId, 1, document);
  assert.equal(saved.draftVersion, 2);
  assert.throws(() => comicStore.saveComicDraft(activityId, 1, document), (error: unknown) =>
    (error as { code?: string; statusCode?: number }).code === 'comic_draft_conflict'
      && (error as { statusCode?: number }).statusCode === 409);

  const revision = comicStore.createComicRevision(activityId, 2);
  assert.equal(revision.documentHash.length, 64);
  assert.equal(comicStore.getComicRevision(activityId, revision.id)?.documentHash, revision.documentHash);
  comicStore.saveComicDraft(activityId, 2, { ...document, pages: [{ ...document.pages[0], title: '已修改' }] });
  assert.equal(comicStore.getComicRevision(activityId, revision.id)?.document.pages[0].title, '相遇');
  database.close();
});

test('comic document validation reports source, speaker, template, duplicate, and bounds errors', () => {
  const source = sourceDocument();
  const valid = onePanelDocument('revision-a');
  assert.doesNotThrow(() => validateComicDocument(valid, source));

  const unknownActor = structuredClone(valid);
  unknownActor.panels[0].actorIds = ['missing-actor'];
  assert.throws(() => validateComicDocument(unknownActor, source), /不存在的角色/);

  const outOfBounds = structuredClone(valid);
  outOfBounds.panels[0].bubbles[0].rect.x = 0.7;
  assert.throws(() => validateComicDocument(outOfBounds, source), /超出画格范围/);

  const wrongTemplate = structuredClone(valid);
  wrongTemplate.pages[0].template = 'duo';
  assert.throws(() => validateComicDocument(wrongTemplate, source), /duo 模板需要 2 格/);

  const orphan = structuredClone(valid);
  orphan.pages.push({ id: 'page-b', title: '重复归属', template: 'single', panelIds: ['panel-a'] });
  assert.throws(() => validateComicDocument(orphan, source), /必须恰好属于一个页面/);

  const duplicateBubble = structuredClone(valid);
  duplicateBubble.panels[0].bubbles.push({ ...duplicateBubble.panels[0].bubbles[0], text: '重复 ID' });
  assert.throws(() => validateComicDocument(duplicateBubble, source), /气泡 ID 重复/);

  const duplicateAcrossPanels = structuredClone(valid);
  duplicateAcrossPanels.pages[0].template = 'duo';
  duplicateAcrossPanels.pages[0].panelIds.push('panel-b');
  duplicateAcrossPanels.panels.push({ ...structuredClone(duplicateAcrossPanels.panels[0]), id: 'panel-b' });
  assert.throws(() => validateComicDocument(duplicateAcrossPanels, source), /气泡 ID 重复（整份漫画）/);

  const wrongBeat = structuredClone(valid);
  wrongBeat.panels[0].source.beatIds = ['missing-beat'];
  assert.throws(() => validateComicDocument(wrongBeat, source), /来源镜头不存在/);
});

test('comic jobs are idempotent and atomically claimable', () => {
  const { database, activityId, comicStore } = setup();
  const request = { stageId: 'stage-a', sceneId: 'scene-a', panelCount: 6 };
  const first = comicStore.createComicJob({ activityId, kind: 'storyboard', idempotencyKey: 'same-key', request, traceId: 'trace-a' });
  const repeated = comicStore.createComicJob({ activityId, kind: 'storyboard', idempotencyKey: 'same-key', request, traceId: 'trace-b' });
  assert.equal(first.isExisting, false);
  assert.equal(repeated.isExisting, true);
  assert.equal(first.job.id, repeated.job.id);
  assert.throws(() => comicStore.createComicJob({ activityId, kind: 'storyboard', idempotencyKey: 'same-key', request: { ...request, panelCount: 8 }, traceId: 'trace-c' }),
    (error: unknown) => (error as { code?: string }).code === 'idempotency_conflict');
  assert.equal(comicStore.claimComicJob(first.job.id), true);
  assert.equal(comicStore.claimComicJob(first.job.id), false);
  assert.equal(comicStore.getComicJob(activityId, first.job.id)?.status, 'preparing');
  database.close();
});
