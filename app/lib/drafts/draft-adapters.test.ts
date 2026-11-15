import assert from 'node:assert/strict';
import test from 'node:test';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  ComicDocumentSchema,
  ContentDocumentSchema,
  PublicationDocumentSchema,
  buildActivityDocument,
  type ComicDocument,
  type ContentDocument,
  type PublicationDocument,
} from '@sthstart/contracts';
import {
  DraftSaveController,
  createSessionStorageAdapter,
  createLocalStorageAdapter,
} from './index';

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    store,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    },
  };
}

function comicDocument(contentRevisionId: string): ComicDocument {
  return {
    schemaVersion: 1,
    contentRevisionId,
    style: 'ink-paper-v1',
    canvas: { width: 1920, height: 1080 },
    pages: [{
      id: 'page-1',
      title: '雨后的街角',
      template: 'single',
      panelIds: ['panel-1'],
    }],
    panels: [{
      id: 'panel-1',
      source: { stageId: 'stage-1', sceneId: 'scene-1', beatIds: ['beat-1'] },
      actorIds: [],
      shotSize: 'wide',
      visualDescription: '雨后的街角与亮起的路灯。',
      composition: '空景，路灯位于画面右侧。',
      textSafeArea: 'none',
      selectedImage: null,
      crop: { focalX: 0.5, focalY: 0.5, zoom: 1 },
      bubbles: [],
      presentation: { camera: 'none', impact: 'none', holdMs: null },
      renderSettings: {},
    }],
  };
}

test('Studio draft adapter round-trips a schema-valid ContentDocument and rejects invalid data', () => {
  const activityId = 'act-studio-1';
  const backupKey = `sthstart:activity-draft:${activityId}`;
  const { store, storage } = memoryStorage();
  const adapter = createSessionStorageAdapter<ContentDocument>(
    backupKey,
    (raw): raw is ContentDocument => Value.Check(ContentDocumentSchema, raw),
    storage,
  );

  const validDoc = buildActivityDocument({
    templateId: 'blank',
    title: '草稿适配器验收',
    type: '测试',
    theme: '',
    location: '街角',
    rules: '',
    actors: [{
      id: 'actor-1',
      displayName: '主角',
      persona: {},
      activityRole: '主角',
      outfitDescription: '便装',
    }],
  });

  assert.equal(Value.Check(ContentDocumentSchema, validDoc), true);
  assert.equal(adapter.get(), null);
  assert.equal(adapter.set(validDoc), true);
  assert.deepEqual(adapter.get(), validDoc);

  store.set(backupKey, JSON.stringify({ ...validDoc, schemaVersion: 2 }));
  assert.equal(adapter.get(), null);
  store.set(backupKey, JSON.stringify({ ...validDoc, stages: 'invalid' }));
  assert.equal(adapter.get(), null);

  assert.equal(adapter.set(validDoc), true);
  adapter.remove();
  assert.equal(adapter.get(), null);
});

test('Comic draft adapter round-trips a schema-valid document and isolates another content revision', () => {
  const activityId = 'act-comic-1';
  const backupKey = `sthstart:activity-comic-draft:${activityId}`;
  const currentRevisionId = 'rev-100';
  const { store, storage } = memoryStorage();
  const currentRevisionSchema = Type.Object({
    contentRevisionId: Type.Literal(currentRevisionId),
  });
  const adapter = createSessionStorageAdapter<ComicDocument>(
    backupKey,
    (raw): raw is ComicDocument =>
      Value.Check(ComicDocumentSchema, raw)
      && Value.Check(currentRevisionSchema, raw),
    storage,
  );

  const staleComic = comicDocument('rev-099');
  assert.equal(Value.Check(ComicDocumentSchema, staleComic), true);
  store.set(backupKey, JSON.stringify(staleComic));
  assert.equal(adapter.get(), null, 'a comic for another content revision is not recovered');

  const currentComic = comicDocument(currentRevisionId);
  assert.equal(Value.Check(ComicDocumentSchema, currentComic), true);
  assert.equal(adapter.set(currentComic), true);
  assert.deepEqual(adapter.get(), currentComic);

  store.set(backupKey, JSON.stringify({ ...currentComic, style: undefined }));
  assert.equal(adapter.get(), null, 'a comic without the required canvas style is rejected');
});

test('Publication draft adapter round-trips a schema-valid document and rejects unsupported fields', () => {
  const activityId = 'act-pub-1';
  const key = `sthstart:publication-draft:${activityId}`;
  const { store, storage } = memoryStorage();
  const adapter = createLocalStorageAdapter<PublicationDocument>(
    key,
    (raw): raw is PublicationDocument => Value.Check(PublicationDocumentSchema, raw),
    storage,
  );

  const localDoc: PublicationDocument = {
    schemaVersion: 1,
    source: {
      storyProjectId: 'project-1',
      entryRevisionIds: ['revision-1'],
      sourceHash: 'source-hash-1',
    },
    title: 'Publication A',
    synopsis: 'Local typed synopsis',
    orientation: 'portrait',
    actors: [],
    shots: [],
    publishingCopy: {
      title: 'Publication A',
      description: 'Local typed description',
      tags: ['demo'],
    },
  };

  assert.equal(Value.Check(PublicationDocumentSchema, localDoc), true);
  assert.equal(adapter.get(), null);
  assert.equal(adapter.set(localDoc), true);
  assert.deepEqual(adapter.get(), localDoc);

  store.set(key, JSON.stringify({ ...localDoc, summary: 'not part of the publication contract' }));
  assert.equal(adapter.get(), null, 'unsupported root fields are rejected');
  store.set(key, JSON.stringify({
    ...localDoc,
    source: { ...localDoc.source, entryRevisionIds: [] },
  }));
  assert.equal(adapter.get(), null, 'publication sources require at least one frozen revision');

  assert.equal(adapter.set(localDoc), true);
  adapter.remove();
  assert.equal(adapter.get(), null);
});

test('DraftSaveController: consecutive saves with versioned conflict resolution and recovery', async () => {
  const controller = new DraftSaveController<{ text: string }>();
  controller.document = { text: 'draft v1' };
  controller.version = 1;
  controller.dirty = true;

  const ok1 = await controller.flush(
    async (doc, version) => {
      assert.equal(doc.text, 'draft v1');
      assert.equal(version, 1);
      return 2;
    },
    (error) => assert.fail(String(error)),
  );
  assert.equal(ok1, true);
  assert.equal(controller.version, 2);
  assert.equal(controller.dirty, false);

  controller.document = { text: 'draft v2' };
  controller.dirty = true;

  let conflictCaught = false;
  const ok2 = await controller.flush(
    async () => {
      throw Object.assign(new Error('revision_conflict'), { status: 409 });
    },
    (_error, isConflict) => {
      conflictCaught = isConflict;
    },
  );

  assert.equal(ok2, false);
  assert.equal(conflictCaught, true);
  assert.equal(controller.blocked, true);
  assert.equal(controller.dirty, true);
  assert.equal(controller.document?.text, 'draft v2');

  controller.version = 5;
  controller.unblock();
  assert.equal(controller.blocked, false);

  const ok3 = await controller.flush(
    async (doc, version) => {
      assert.equal(doc.text, 'draft v2');
      assert.equal(version, 5);
      return 6;
    },
    (error) => assert.fail(String(error)),
  );

  assert.equal(ok3, true);
  assert.equal(controller.version, 6);
  assert.equal(controller.dirty, false);
  assert.equal(controller.isClean(), true);
});
