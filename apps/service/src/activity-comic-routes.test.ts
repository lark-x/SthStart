import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ContentDocument } from '@sthstart/contracts';
import { createService } from './server.js';
import { readConfig } from './config.js';
import { ServiceDatabase, nowIso } from './database.js';
import { SecretStore } from './security.js';
import { ActivityStore } from './activities/store.js';
import { ComicStore } from './activities/comic-store.js';

const adminToken = 'comic-route-admin-token-1234567890';
const headers = { 'x-sthstart-admin-token': adminToken };

function source(): ContentDocument {
  return {
    schemaVersion: 1,
    activity: { title: '雪山实验', type: '短篇', theme: '发现', location: '龙脊雪山', rules: '', generationMode: 'fill_details' },
    actors: [{ id: 'actor-a', displayName: '阿贝多', activityRole: '主角', outfitDescription: '炼金术师服装', persona: { appearance: { baseText: '金色头发' } }, appearanceReferenceAssetKeys: [] }],
    relationships: [], messages: [], posts: [], comments: [], likes: [], mediaSlots: [], facts: [], stageResults: [], conversations: [],
    stages: [{ id: 'stage-a', title: '雪山', order: 1, actorIds: ['actor-a'], location: '龙脊雪山', instruction: '发现结晶', requiredBeats: [], locked: false, endCondition: '' }],
    scenes: [{ id: 'scene-a', stageId: 'stage-a', title: '实验营地', timeText: '傍晚', locationText: '营地', environment: '风雪渐起', beats: [
      { id: 'beat-a', characterId: 'actor-a', action: '观察结晶', dialogue: '反应稳定。', outcome: '完成分析', orderIndex: 0 },
    ] }],
  } as ContentDocument;
}

function validOutput(count = 4, actorId = 'actor-a') {
  return { panels: Array.from({ length: count }, (_, index) => ({ sourceBeatIds: ['beat-a'], actorIds: [actorId], shotSize: 'medium',
    visualDescription: `分镜画面 ${index + 1}`, composition: '角色位于中央', textSafeArea: 'top_left',
    bubbles: [{ kind: 'speech', speakerActorId: actorId, text: `第 ${index + 1} 格` }],
  })) };
}

test('comic draft/storyboard routes are contract-validated, idempotent, and only apply after review', async () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-comic-routes-'));
  const database = new ServiceDatabase(':memory:');
  let modelResponse = JSON.stringify(validOutput());
  let modelCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith('/chat/completions')) {
      modelCalls++;
      return Response.json({ choices: [{ message: { content: modelResponse } }] });
    }
    return new Response('unexpected upstream call', { status: 404 });
  };
  const config = readConfig({ STHSTART_ADMIN_TOKEN: adminToken, STHSTART_ARTIFACT_DIR: artifactDirectory });
  const secrets = new SecretStore({});
  const { app } = await createService({ config, database, secrets, fetcher });
  try {
    const now = nowIso();
    database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
      VALUES ('comic-text','Mock comic LLM','llm','http://llm.mock/v1','mock-storyboard-model',NULL,1,?,?)`).run(now, now);
    database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','comic-text',?)").run(now);
    const activity = new ActivityStore(database).createActivity({ title: '雪山实验', type: '短篇', initialDocument: source() }).activity;
    const activityId = activity.id;
    const comicStore = new ComicStore(database);
    const initialDraft = comicStore.createComicDraft(activityId, activity.currentContentRevisionId!);
    const root = `/api/v1/admin/activities/${activityId}/comic`;

    const read = await app.inject({ method: 'GET', url: `${root}/draft`, headers });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().draft.draftVersion, 1);
    const invalidSave = await app.inject({ method: 'PUT', url: `${root}/draft`, headers, payload: { expectedDraftVersion: 1, document: { bad: true } } });
    assert.equal(invalidSave.statusCode, 400);

    const request = { expectedDraftVersion: initialDraft.draftVersion, stageId: 'stage-a', sceneId: 'scene-a', panelCount: 4, idempotencyKey: 'storyboard-one' };
    const queued = await app.inject({ method: 'POST', url: `${root}/storyboards`, headers, payload: request });
    assert.equal(queued.statusCode, 202, queued.body);
    const jobId = queued.json().job.id as string;
    const duplicate = await app.inject({ method: 'POST', url: `${root}/storyboards`, headers, payload: request });
    assert.equal(duplicate.statusCode, 202);
    assert.equal(duplicate.json().job.id, jobId);
    const idempotencyConflict = await app.inject({ method: 'POST', url: `${root}/storyboards`, headers,
      payload: { ...request, instructions: '另一种方案' } });
    assert.equal(idempotencyConflict.statusCode, 409);

    let job = comicStore.getComicJob(activityId, jobId)!;
    for (let attempt = 0; attempt < 100 && !['succeeded', 'failed'].includes(job.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      job = comicStore.getComicJob(activityId, jobId)!;
    }
    assert.equal(job.status, 'succeeded', job.errorMessage ?? 'storyboard task did not finish');
    assert.equal(modelCalls, 1);
    assert.ok(job.callId);
    assert.equal(database.connection.prepare("SELECT COUNT(*) count FROM ai_call_records WHERE business_event='activity.comic.storyboard'").get()!.count, 1);
    assert.equal(comicStore.getComicDraft(activityId)?.document.pages.length, 0, 'generation must not mutate the draft');

    const applied = await app.inject({ method: 'POST', url: `${root}/storyboards/${jobId}/apply`, headers,
      payload: { expectedDraftVersion: 1, mode: 'append' } });
    assert.equal(applied.statusCode, 200, applied.body);
    assert.equal(applied.json().draft.draftVersion, 2);
    assert.equal(applied.json().draft.document.panels.length, 4);
    const retryAfterDraftChanged = await app.inject({ method: 'POST', url: `${root}/storyboards`, headers, payload: request });
    assert.equal(retryAfterDraftChanged.statusCode, 202, retryAfterDraftChanged.body);
    assert.equal(retryAfterDraftChanged.json().job.id, jobId, 'a retry after applying the storyboard returns the original task');
    assert.equal(modelCalls, 1);
    const conflict = await app.inject({ method: 'POST', url: `${root}/storyboards/${jobId}/apply`, headers,
      payload: { expectedDraftVersion: 1, mode: 'append' } });
    assert.equal(conflict.statusCode, 409);

    modelResponse = JSON.stringify(validOutput(4, 'unknown-actor'));
    const invalidJobResponse = await app.inject({ method: 'POST', url: `${root}/storyboards`, headers, payload: {
      expectedDraftVersion: 2, stageId: 'stage-a', sceneId: 'scene-a', panelCount: 4, idempotencyKey: 'storyboard-invalid-actor',
    } });
    const invalidJobId = invalidJobResponse.json().job.id as string;
    let invalidJob = comicStore.getComicJob(activityId, invalidJobId)!;
    for (let attempt = 0; attempt < 100 && !['succeeded', 'failed'].includes(invalidJob.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      invalidJob = comicStore.getComicJob(activityId, invalidJobId)!;
    }
    assert.equal(invalidJob.status, 'failed');
    assert.equal(invalidJob.errorCode, 'comic_storyboard_invalid_reference');
    assert.equal(comicStore.getComicDraft(activityId)?.draftVersion, 2);
  } finally {
    await app.close();
    database.close();
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});
