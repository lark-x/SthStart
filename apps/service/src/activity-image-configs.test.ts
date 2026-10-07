import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildActivityDocument } from '@sthstart/contracts';
import { ServiceDatabase } from './database.js';
import { ActivityStore } from './activities/store.js';
import { hashImageConfig, getImageConfigDraft, saveImageConfigDraft, commitImageConfigRevision } from './activities/image-configs.js';

function fixture(t: test.TestContext) {
  const db = new ServiceDatabase();
  t.after(() => db.close());
  const store = new ActivityStore(db);
  const { activity } = store.createActivity({ title: '验收', type: '测试', initialDocument: buildActivityDocument({
    templateId: 'blank', title: '验收', type: '测试', theme: '', location: '', rules: '', actors: [],
  }) });
  return { db, store, id: activity.id };
}
test('config hashes ignore object property ordering but preserve slot array order', () => {
  const a = { schemaVersion: 1 as const, stylePreset: '', globalStylePrompt: '', globalNegativePrompt: '', slotConfigs: [{ slotId: 'a' }, { slotId: 'b' }] };
  assert.equal(hashImageConfig(a), hashImageConfig({ slotConfigs: a.slotConfigs, globalNegativePrompt: '', globalStylePrompt: '', stylePreset: '', schemaVersion: 1 }));
  assert.notEqual(hashImageConfig(a), hashImageConfig({ ...a, slotConfigs: [...a.slotConfigs].reverse() }));
});
test('image config save rejects stale versions and invalid dimensions without changing data', t => {
  const { db, id } = fixture(t);
  const draft = getImageConfigDraft(db, id);
  const saved = saveImageConfigDraft(db, id, draft.draftVersion, { ...draft.document, globalStylePrompt: 'ink' });
  assert.equal(saved.draftVersion, 2);
  assert.throws(() => saveImageConfigDraft(db, id, 1, draft.document), { code: 'draft_version_conflict', statusCode: 409 });
  assert.throws(() => saveImageConfigDraft(db, id, 2, { ...draft.document, slotConfigs: [{ slotId: 's' }, { slotId: 's' }] }), { code: 'invalid_image_config' });
  assert.equal(getImageConfigDraft(db, id).document.globalStylePrompt, 'ink');
});
test('unchanged image config commit reuses immutable revision and keeps head unchanged', t => {
  const { db, store, id } = fixture(t);
  const draft = getImageConfigDraft(db, id);
  const first = commitImageConfigRevision(db, store, id, draft.draftVersion, store.getActivity(id)!.headVersion);
  const second = commitImageConfigRevision(db, store, id, draft.draftVersion, first.activity.headVersion);
  assert.equal(second.revision.id, first.revision.id);
  assert.equal(second.activity.headVersion, first.activity.headVersion);
  assert.throws(() => commitImageConfigRevision(db, store, id, draft.draftVersion, first.activity.headVersion - 1), { code: 'revision_conflict' });
  const updated = saveImageConfigDraft(db, id, draft.draftVersion, { ...draft.document, globalStylePrompt: 'changed' });
  const third = commitImageConfigRevision(db, store, id, updated.draftVersion, second.activity.headVersion);
  assert.notEqual(third.revision.id, first.revision.id);
  assert.equal(first.revision.document.globalStylePrompt, draft.document.globalStylePrompt);
});

test('two database connections cannot save the same image-config version twice', t => {
  const directory = mkdtempSync(join(tmpdir(), 'sthstart-image-cas-'));
  const first = new ServiceDatabase(join(directory, 'test.db'));
  const second = new ServiceDatabase(join(directory, 'test.db'));
  t.after(() => { first.close(); second.close(); rmSync(directory, { recursive: true, force: true }); });
  const store = new ActivityStore(first);
  const { activity } = store.createActivity({ title: '并发', type: '测试', initialDocument: buildActivityDocument({
    templateId: 'blank', title: '并发', type: '测试', theme: '', location: '', rules: '', actors: [],
  }) });
  const a = getImageConfigDraft(first, activity.id);
  const b = getImageConfigDraft(second, activity.id);
  saveImageConfigDraft(first, activity.id, a.draftVersion, { ...a.document, globalStylePrompt: 'first' });
  assert.throws(() => saveImageConfigDraft(second, activity.id, b.draftVersion, { ...b.document, globalStylePrompt: 'second' }), { statusCode: 409 });
  assert.equal(getImageConfigDraft(second, activity.id).document.globalStylePrompt, 'first');
});

test('draft preview references may change but immutable config revisions retain their references', t => {
  const { db, store, id } = fixture(t);
  db.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('activities','Activities','image-config-test','[]',1,?,?)`).run(new Date().toISOString(), new Date().toISOString());
  for (const artifactId of ['preview-a', 'preview-b']) db.connection.prepare(`INSERT INTO artifacts
    (id,app_id,content_type,byte_size,created_at,media_type,file_status) VALUES (?,'activities','image/png',1,?,'image/png','ready')`).run(artifactId, new Date().toISOString());
  const initial = getImageConfigDraft(db, id);
  const art = { schemaKind: 'activity_art_style_v1' as const, positiveStylePrompt: '', negativePrompt: '',
    renderProfiles: { draft: null, final: null }, defaultQuality: 'draft' as const, defaultCanvas: { width: 1024, height: 1024 }, previewArtifactId: 'preview-a' };
  const document = { ...initial.document, artDirection: { selectedStyle: { id: 'card', version: 1, name: '画风', payloadSnapshot: art },
    quality: 'draft' as const, canvas: art.defaultCanvas, renderProfiles: art.renderProfiles, parameterOverrides: {} } };
  const saved = saveImageConfigDraft(db, id, 1, document);
  const revision = commitImageConfigRevision(db, store, id, saved.draftVersion, store.getActivity(id)!.headVersion);
  const updated = structuredClone(document);
  updated.artDirection.selectedStyle.payloadSnapshot.previewArtifactId = 'preview-b';
  saveImageConfigDraft(db, id, saved.draftVersion, updated);
  const rows = db.connection.prepare('SELECT artifact_id,ref_type,ref_id FROM artifact_references').all() as Array<{ artifact_id: string; ref_type: string; ref_id: string }>;
  assert.ok(rows.some(row => row.artifact_id === 'preview-a' && row.ref_id === `image-config-revision:${revision.revision.id}`));
  assert.ok(rows.some(row => row.artifact_id === 'preview-b' && row.ref_type === 'activity_image_config_draft'));
  assert.equal(rows.filter(row => row.artifact_id === 'preview-a' && row.ref_type === 'activity_image_config_draft').length, 0);
});
