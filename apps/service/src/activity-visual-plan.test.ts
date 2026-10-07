import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityDocument, type ComicDocument, type ImageConfigDocument } from '@sthstart/contracts';
import { ServiceDatabase } from './database.js';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { installVisualTestWorkflow as install } from './activities/test-support/visual-workflow.js';
import { ActivityStore } from './activities/store.js';
import { ComicStore } from './activities/comic-store.js';
import { getImageConfigDraft } from './activities/image-configs.js';
import { compilePromptRecipe, resolveImageExecutionPlan } from './activities/image-prompt-compiler.js';
import { buildActivityImageWorkflowSnapshot, hashVisualPlan, resolveEffectiveActivityVisualPlan } from './activities/image-render-common.js';

const token = 'visual-plan-admin-test-1234567890';
const headers = { 'x-sthstart-admin-token': token };


test('beat, comic and media share versioned quality profiles and semantic canvas bindings', async t => {
  const database = new ServiceDatabase();
  const { app } = await createService({ config: readConfig({ STHSTART_ADMIN_TOKEN: token }), database, secrets: new SecretStore({}),
    fetcher: async () => Response.json({
      CLIPTextEncode: { input: { required: { text: ['STRING',{}] } } }, KSampler: { input: { required: {} } },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['base.safetensors','turbo.safetensors'],{}] } } },
      SaveImage: { input: { required: {} } }, EmptyLatentImage: { input: { required: {} } },
    }) });
  t.after(async () => { await app.close(); database.close(); });
  const profiles = install(database);
  const content = buildActivityDocument({ templateId: 'blank', title: '三类目标配置一致性', type: '测试', theme: '实验', location: '营地', rules: '',
    actors: [{ id: 'a', displayName: '甲', persona: { appearance: { baseText: '银色短发' } }, activityRole: '', outfitDescription: '蓝衣' }] });
  const stageId = content.stages[0].id;
  content.scenes = [{ id: 's', stageId, title: '观察', timeText: '', locationText: '营地', beats: [{ id: 'b', characterId: 'a', action: '观察烧瓶' }] }];
  content.mediaSlots = [{ id: 'm', kind: 'image', stageId, caption: '观察烧瓶', shotDescription: '', actorIds: ['a'], sourceFactIds: [] }];
  const store = new ActivityStore(database);
  const created = store.createActivity({ title: content.activity.title, type: '测试', initialDocument: content });
  const activityId = created.activity.id;
  const revisionId = created.activity.currentContentRevisionId!;
  const comicStore = new ComicStore(database);
  comicStore.createComicDraft(activityId, revisionId);
  const comic: ComicDocument = { schemaVersion: 1, contentRevisionId: revisionId, style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 },
    pages: [{ id: 'page', title: '', template: 'single', panelIds: ['p'] }], panels: [{ id: 'p', source: { stageId, sceneId: 's', beatIds: ['b'] },
      actorIds: ['a'], shotSize: 'medium', visualDescription: '观察烧瓶', composition: '', textSafeArea: 'none', selectedImage: null,
      crop: { focalX: .5, focalY: .5, zoom: 1 }, bubbles: [], presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {} }] };
  comicStore.saveComicDraft(activityId, 1, comic);
  for (const quality of ['draft','final'] as const) {
    const draft = getImageConfigDraft(database, activityId);
    const imageConfig: ImageConfigDocument = { ...draft.document, globalStylePrompt: 'ink, warm_light', globalNegativePrompt: '',
      artDirection: { selectedStyle: null, quality, canvas: { width: 1024, height: 768 }, renderProfiles: profiles, parameterOverrides: {} } };
    const committed = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/art-direction/commit`, headers,
      payload: { expectedHeadVersion: store.getActivity(activityId)!.headVersion, expectedImageConfigDraftVersion: draft.draftVersion, document: imageConfig } });
    assert.equal(committed.statusCode, 200, committed.body);
    const beat = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/beat-renders/preview`, headers,
      payload: { stageId, sceneId: 's', beatId: 'b', seed: 123 } });
    const panel = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/comic/panels/p/render-preview`, headers,
      payload: { expectedDraftVersion: 2, seed: 123 } });
    assert.equal(beat.statusCode, 200, beat.body);
    assert.equal(panel.statusCode, 200, panel.body);
    const configBeforePreview = getImageConfigDraft(database, activityId);
    const slotPreview = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/slot-visual-preview`, headers,
      payload: { slotId: 'm', document: imageConfig } });
    assert.equal(slotPreview.statusCode, 200, slotPreview.body);
    assert.equal(slotPreview.json().parameters.latent_w, 1024);
    assert.equal(slotPreview.json().fields.find((field: { key: string }) => field.key === 'model').modelEditable, false);
    assert.deepEqual(getImageConfigDraft(database, activityId), configBeforePreview, 'settings preview never saves a draft or creates a revision');
    const foreignSlot = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/slot-visual-preview`, headers,
      payload: { slotId: 'foreign', document: imageConfig } });
    assert.equal(foreignSlot.statusCode, 404);
    for (const preview of [beat.json(), panel.json()]) {
      const width = preview.fields.find((field: { key: string }) => field.key === 'latent_w');
      assert.equal(width.label, '宽度');
      assert.equal(width.minimum, 256);
      assert.equal(width.step, 64);
      assert.equal(preview.fields.find((field: { key: string }) => field.key === 'model').modelEditable, false);
      assert.equal(preview.fields.some((field: { key: string }) => field.key === 'prompt'), false, 'no phantom legacy fields');
    }
    const plan = resolveImageExecutionPlan(database, false, profiles[quality].presetId, profiles[quality].presetRevision)!;
    const compiled = compilePromptRecipe({ activityId, contentRevisionId: revisionId, imageConfigRevisionId: committed.json().revision.id,
      slotId: content.mediaSlots[0].id, contentDoc: content, imageConfigDoc: imageConfig, executionPlan: plan });
    const media = resolveEffectiveActivityVisualPlan(database, { imageConfig, imageConfigRevisionId: committed.json().revision.id, settings: {},
      actors: content.actors, sourcePrompt: compiled.compilation.channels.description, seed: 123 });
    for (const parameters of [beat.json().parameters, panel.json().parameters, media.parameters]) {
      assert.equal(parameters.latent_w, 1024);
      assert.equal(parameters.latent_h, 768);
      assert.equal(parameters.steps, quality === 'draft' ? 12 : 24);
      assert.equal(parameters.model, quality === 'draft' ? 'turbo.safetensors' : 'base.safetensors');
      assert.equal(parameters.unwanted, '', 'explicit empty negatives survive every adapter');
    }
    assert.equal(compiled.compilation.effectiveParams.latent_w, 1024);
    assert.ok(compiled.compilation.channels.description);
    assert.equal(compiled.compilation.channels.prompt, undefined);
    assert.doesNotMatch(compiled.compilation.channels.description, /warm_light/, 'style is appended after optimization');
    const local = resolveEffectiveActivityVisualPlan(database, { imageConfig, settings: { parameters: { width: 1280 } }, actors: [], sourcePrompt: '风雪', seed: 123 });
    assert.equal(local.parameters.latent_w, 1280);
    assert.equal(local.parameters.steps, media.parameters.steps);
    assert.throws(() => resolveEffectiveActivityVisualPlan(database, { imageConfig, settings: { parameters: { width: 1000 } }, actors: [], sourcePrompt: '', seed: 123 }));
    assert.throws(() => resolveEffectiveActivityVisualPlan(database, { imageConfig, settings: { parameters: { model: 'foreign.safetensors' } }, actors: [], sourcePrompt: '', seed: 123 }), { code: 'model_not_allowed' });
    const snapshot = buildActivityImageWorkflowSnapshot(media.selection.resolved, media.parameters, media.seed, []);
    assert.equal((snapshot['6'] as { inputs: { width: number } }).inputs.width, 1024);
    assert.equal(media.provenance.quality, quality);
    assert.equal(media.provenance.imageConfigRevisionId, committed.json().revision.id);
  }
  assert.equal(database.connection.prepare('SELECT COUNT(*) n FROM generation_tasks').get()!.n, 0, 'previews do not submit or rewrite media');
});

test('visual plan hashes ignore object order but retain ordered arrays', () => {
  assert.equal(hashVisualPlan({ a: 1, nested: { b: 2, a: 3 } }), hashVisualPlan({ nested: { a: 3, b: 2 }, a: 1 }));
  assert.notEqual(hashVisualPlan(['a','b']), hashVisualPlan(['b','a']));
});
