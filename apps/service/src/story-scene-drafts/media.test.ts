import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { SceneAdoption, SceneImage, StorySceneDraft } from '@sthstart/contracts';
import { enforceRetention } from '../artifacts.js';
import { readConfig } from '../config.js';
import { deleteWorldManuscriptDocument } from '../creative-orchestration/copilot.js';
import { nowIso, ServiceDatabase } from '../database.js';
import { generationExecutionsFor } from '../generation/events.js';
import { SecretStore } from '../security.js';
import { StoryStore } from '../story/store.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { createSceneDraftMedia } from './media.js';
import { SceneDraftError, SceneDraftStore } from './store.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const imageRequest = { action: 'generate-image', expectedRevision: 1, idempotencyKey: 'request' } as const;

class TestSecrets extends SecretStore {
  override async get() { return { value: null, source: 'none' as const }; }
}

async function fixture(t: TestContext) {
  const database = new ServiceDatabase();
  const config = { ...readConfig({}), artifactDirectory: await mkdtemp(join(tmpdir(), 'one-scene-media-')) };
  const createdAt = nowIso();
  const calls: Array<{ url: string; prompt: unknown; hasReference: boolean }> = [];
  const media = createSceneDraftMedia({ config, database, secrets: new TestSecrets(), fetcher: async (input, init) => {
    const url = String(input);
    const body = init?.body;
    const prompt: unknown = body instanceof FormData ? body.get('prompt') : JSON.parse(String(body)).prompt;
    calls.push({ url, prompt, hasReference: body instanceof FormData && body.has('image') });
    return Response.json({ data: [{ b64_json: png }] });
  } });
  const waitForTasks = () => Promise.all([...generationExecutionsFor(database)]);
  t.after(async () => {
    await waitForTasks();
    database.close();
    await rm(config.artifactDirectory, { recursive: true, force: true });
  });
  database.connection.prepare(`INSERT INTO managed_apps (id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('creative-center','创作中心','test','[]',1,?,?)`).run(createdAt, createdAt);
  database.connection.prepare(`INSERT INTO generation_engines (id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('test','test','cloud','https://image.invalid/v1',1,1,?,?)`).run(createdAt, createdAt);

  function addWorkflow(purpose: 'text-to-image' | 'image-to-image', supportsReference = false) {
    database.connection.prepare(`INSERT INTO generation_workflows (id,name,description,engine_kind,category,latest_version,created_at,updated_at)
      VALUES (?,?,'','cloud','image',1,?,?)`).run(purpose, purpose, createdAt, createdAt);
    database.connection.prepare(`INSERT INTO generation_workflow_versions (workflow_id,version,engine_id,input_schema_json,
      input_capabilities_json,output_declarations_json,definition_json,is_published,created_at)
      VALUES (?,1,'test',?,?,'["image"]',?,1,?)`).run(purpose, JSON.stringify({ prompt: { type: 'string', semantic: 'prompt', required: true } }),
      JSON.stringify(supportsReference ? { sourceImage: { semantic: 'init_image', mediaTypes: ['image/png'], required: true } } : {}),
      JSON.stringify({ operation: purpose, modelId: 'gpt-image-1' }), createdAt);
    database.connection.prepare(`INSERT INTO app_generation_assignments (app_id,purpose,workflow_id,workflow_version,engine_id,updated_at)
      VALUES ('creative-center',?,?,1,'test',?)`).run(purpose, purpose, createdAt);
  }

  const draft: StorySceneDraft = {
    id: 'draft', revision: 1, title: '港口换班', character: { name: '岑舟', origin: 'other' }, progress: 'image',
    createdAt, updatedAt: createdAt, notes: '', lockedConstraints: [],
    authorSources: [{ title: '作者设定', text: '主角在港口换班。' }],
    sources: [{ id: 'source', title: '港口设定集', work: '风声', locator: '第 2 节', startLine: 5, endLine: 8, excerpt: '港口换班', kind: 'canon' }],
    candidates: [], discovery: null, direction: 'if',
    start: { time: '夜间', location: '港口', hook: '换班', timeEvidence: { status: 'unconfirmed', sourceIds: [], note: '' },
      locationEvidence: { status: 'supported', sourceIds: ['source'], note: '' } },
    messages: [], brief: { viewpoint: '岑舟', action: '交接', change: '留下', constraints: [], divergence: '这一次没有离开。' },
    briefConfirmed: true, format: 'story', body: '# 换班\n\n她看了一眼远处的灯。', bodyVersion: 2, writingCandidate: null,
    imagePlan: { id: 'plan', version: 3, bodyVersion: 2, moment: '看向远处', subject: '岑舟', camera: '低机位',
      blocking: '角色在栏内', action: '伸手', occlusion: '栏杆半遮挡', style: '铅笔' },
    images: [], adoption: null, currentAction: null,
  };
  return { database, config, draft, addWorkflow, calls, media, waitForTasks };
}

test('image enqueue commits its owning action in the task transaction and uses a previewable artifact', async t => {
  const { database, draft, addWorkflow, media, calls, waitForTasks, config } = await fixture(t);
  addWorkflow('text-to-image');
  database.connection.exec('CREATE TABLE test_action (task_id TEXT NOT NULL)');
  const record = (id: string) => {
    assert.equal(database.connection.isTransaction, true);
    database.connection.prepare('INSERT INTO test_action VALUES (?)').run(id);
  };
  await assert.rejects(media.generateImage(draft, imageRequest, 'rejected', id => {
    record(id);
    throw new SceneDraftError('revision_conflict', '草稿已更新。', 409);
  }), { code: 'revision_conflict' });
  assert.deepEqual(database.connection.prepare('SELECT id FROM generation_tasks').all(), []);
  assert.deepEqual(database.connection.prepare('SELECT task_id FROM test_action').all(), []);

  const taskId = await media.generateImage(draft, imageRequest, 'accepted', record);
  const image: SceneImage = { id: 'accepted', taskId, bodyVersion: 2, planVersion: 3, status: 'queued', createdAt: nowIso() };
  assert.equal((database.connection.prepare('SELECT task_id FROM test_action').get() as { task_id: string }).task_id, taskId);
  assert.equal(await media.generateImage(draft, imageRequest, 'accepted', () => assert.fail('double enqueue')), taskId);
  await waitForTasks();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://image.invalid/v1/images/generations');
  assert.match(String(calls[0].prompt), /前后站位：角色在栏内\n关键动作：伸手\n空间遮挡：栏杆半遮挡/);
  const succeeded = media.readImageTask(image);
  assert.equal(succeeded.status, 'succeeded');
  assert.ok(succeeded.artifactId);
  assert.equal(succeeded.bodyVersion, 2);
  assert.equal(succeeded.planVersion, 3);

  database.connection.prepare("UPDATE generation_tasks SET status='abandoned',upstream_may_continue=1 WHERE id=?").run(taskId);
  assert.equal(media.readImageTask(image).status, 'uncertain');
  database.connection.prepare("UPDATE generation_tasks SET status='succeeded',upstream_may_continue=0 WHERE id=?").run(taskId);
  database.connection.prepare('UPDATE artifacts SET local_path=? WHERE id=?').run(join(config.artifactDirectory, 'missing.png'), succeeded.artifactId);
  assert.equal(media.readImageTask(succeeded).status, 'failed');
  assert.equal(media.readImageTask(succeeded).artifactId, undefined);
});

async function addReferenceArtifact(database: ServiceDatabase, artifactDirectory: string, artifactId: string) {
  const filename = join(artifactDirectory, `${artifactId}.png`);
  const reference = Buffer.from(png, 'base64');
  await writeFile(filename, reference);
  database.connection.prepare(`INSERT INTO artifacts (id,app_id,local_path,content_type,byte_size,media_type,file_status,created_at)
    VALUES (?,'creative-center',?,'image/png',?,'image','ready',?)`).run(artifactId, filename, reference.length, nowIso());
}

test('reference input requires a compatible image preset and is forwarded as media', async t => {
  const { database, config, draft, addWorkflow, media, calls, waitForTasks } = await fixture(t);
  addWorkflow('image-to-image');
  draft.imagePlan!.referenceArtifactId = 'reference';
  await assert.rejects(media.generateImage(draft, imageRequest, 'unsupported', () => assert.fail('queued unsupported reference')), { code: 'image_reference_unsupported' });
  assert.equal(draft.imagePlan!.referenceArtifactId, 'reference');
  assert.deepEqual(database.connection.prepare('SELECT id FROM generation_tasks').all(), []);
  assert.equal(calls.length, 0);

  database.connection.prepare('UPDATE generation_workflow_versions SET input_capabilities_json=? WHERE workflow_id=?')
    .run(JSON.stringify({ sourceImage: { semantic: 'init_image', mediaTypes: ['image/png'], required: true } }), 'image-to-image');
  await addReferenceArtifact(database, config.artifactDirectory, 'reference');
  await media.generateImage(draft, imageRequest, 'reference', () => {});
  await waitForTasks();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://image.invalid/v1/images/edits');
  assert.equal(calls[0].hasReference, true);
});

test('a saved reference is retained before enqueue and the old reference is released on replacement or clear', async t => {
  const { database, config, draft } = await fixture(t);
  for (const id of ['first-ref', 'second-ref']) await addReferenceArtifact(database, config.artifactDirectory, id);
  database.connection.prepare(`INSERT INTO storage_policies (app_id,mode,ttl_days) VALUES ('creative-center','ttl',1)
    ON CONFLICT(app_id) DO UPDATE SET mode='ttl',ttl_days=1`).run();
  const store = new SceneDraftStore(database);
  const blank = store.create({ idempotencyKey: 'retention', character: draft.character });
  const plan = draft.imagePlan!;
  const current = store.patch(blank.id, { expectedRevision: blank.revision, body: draft.body, imagePlan: { ...plan, referenceArtifactId: 'first-ref' } });
  assert.throws(() => store.patch(blank.id, { expectedRevision: current.revision, imagePlan: { ...plan, referenceArtifactId: 'absent-ref' } }), { code: 'image_reference_unavailable' });
  assert.equal(store.get(blank.id).imagePlan?.referenceArtifactId, 'first-ref');
  const replacement = store.patch(blank.id, { expectedRevision: current.revision, imagePlan: { ...plan, referenceArtifactId: 'second-ref' } });
  assert.throws(() => store.patch(blank.id, { expectedRevision: current.revision, imagePlan: { ...plan, referenceArtifactId: null } }), { code: 'revision_conflict' });
  const afterExpiry = Date.now() + 2 * 86400_000;
  assert.equal(await enforceRetention(database, 'creative-center', afterExpiry), 1);
  assert.deepEqual(database.connection.prepare('SELECT id FROM artifacts ORDER BY id').all().map(row => row.id), ['second-ref']);
  store.patch(blank.id, { expectedRevision: replacement.revision, imagePlan: { ...plan, referenceArtifactId: null } });
  assert.equal(await enforceRetention(database, 'creative-center', afterExpiry), 1);
  assert.deepEqual(database.connection.prepare('SELECT id FROM artifacts').all(), []);
});

test('adoption validates binding, rolls back initial project creation, and keeps the body, label, sources and matching image', async t => {
  const { database, draft, addWorkflow, media, waitForTasks } = await fixture(t);
  addWorkflow('text-to-image');
  const worldStore = new StoryWorldStore(database);
  const story = new StoryStore(database);
  const definition = {
    title: '港口故事', summary: '夜班', timeLabel: '第一日',
    locations: [{ id: 'port', name: '港口', description: '故事发生的港口' }],
    actors: [{ id: 'cen', name: '岑舟', role: 'main' as const, characterId: null, characterVersion: null,
      background: '', personality: '', speechStyle: '', appearance: '', goals: [], locationId: 'port', referenceArtifactIds: [] }],
    sources: [], lockedFacts: [], models: { action: null, adjudication: null, narration: null }, visualStyle: '',
  };
  const world = worldStore.create(definition);
  const request = { action: 'adopt', worldId: world.id, expectedRevision: 1, idempotencyKey: 'adopt' } as const;
  const otherProject = story.createProject({ title: '同名项目', workId: definition.title });
  assert.throws(() => media.adopt(draft, { ...request, projectId: otherProject.id }, () => assert.fail('accepted mismatched project')), { code: 'manuscript_project_mismatch' });
  assert.throws(() => media.adopt(draft, request, () => {
    assert.equal(database.connection.isTransaction, true);
    throw Error('record failed');
  }), /record failed/);
  assert.deepEqual(story.listProjects().map(project => project.id), [otherProject.id]);
  assert.deepEqual(worldStore.overview(world.id).branches, []);

  const taskId = await media.generateImage(draft, imageRequest, 'current-image', () => {});
  await waitForTasks();
  draft.images.push({ id: 'current-image', taskId, status: 'queued', bodyVersion: draft.bodyVersion, planVersion: 3, createdAt: nowIso() });
  const image = media.readImageTask(draft.images[0]);
  assert.equal(image.status, 'succeeded');
  let persisted: SceneAdoption | undefined;
  const adopted = media.adopt(draft, request, result => {
    assert.equal(database.connection.isTransaction, true);
    persisted = result;
  });
  assert.deepEqual(adopted, persisted);
  draft.adoption = adopted;
  assert.equal(media.adopt(draft, request, () => assert.fail('duplicate adoption')), adopted);
  const adoptedDocument = story.getDocument(adopted.projectId, adopted.documentId)!;
  assert.equal(adoptedDocument.kind, 'scene');
  assert.equal(adoptedDocument.title, draft.title);
  assert.ok(adoptedDocument.body.startsWith(`${draft.body}\n\n`));
  assert.match(adoptedDocument.body, /IF 线/);
  assert.match(adoptedDocument.body, /风声 · 港口设定集 · 第 2 节 · 第 5–8 行/);
  assert.match(adoptedDocument.body, /作者提供 · 作者设定/);
  assert.ok(adoptedDocument.body.includes(`/api/admin/creative/artifacts/${image.artifactId}`));
  assert.ok(database.connection.prepare("SELECT 1 FROM artifact_references WHERE ref_type='story-document' AND ref_id=? AND artifact_id=?")
    .get(adopted.documentId, image.artifactId!));

  const branch = worldStore.overview(world.id).branches[0];
  database.connection.prepare('INSERT INTO sw_project_bindings VALUES (?,?,?,?,?,?)').run(otherProject.id, world.id, branch.id, 1, nowIso(), nowIso());
  const editedDraft = { ...draft, adoption: null, id: 'another-draft', body: `${draft.body}\n\n又亮了一盏灯。`, bodyVersion: draft.bodyVersion + 1, direction: 'canon-gap' as const };
  assert.throws(() => media.adopt(editedDraft, request, () => assert.fail('picked ambiguous project')), { code: 'manuscript_project_required' });
  const updatedAdoption = media.adopt(editedDraft, { ...request, projectId: otherProject.id }, () => {});
  const updatedDocument = story.getDocument(otherProject.id, updatedAdoption.documentId)!;
  assert.match(updatedDocument.body, /原作走向 · 补写留白/);
  assert.doesNotMatch(updatedDocument.body, /本幕代表画面/);

  const replannedDraft = { ...draft, adoption: null, id: 'replanned-draft', imagePlan: { ...draft.imagePlan!, version: 4 } };
  const replannedAdoption = media.adopt(replannedDraft, { ...request, projectId: otherProject.id }, () => {});
  assert.doesNotMatch(story.getDocument(otherProject.id, replannedAdoption.documentId)!.body, /本幕代表画面/);

  deleteWorldManuscriptDocument(database, world.id, adopted.documentId, adopted.projectId);
  assert.equal(database.connection.prepare("SELECT 1 FROM artifact_references WHERE ref_type='story-document' AND ref_id=?").get(adopted.documentId), undefined);
});
