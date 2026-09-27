// Tests the real storyboard call and apply flow on the isolated comic sample, then restores its two-page draft.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.STHSTART_LIVE_COMIC_TEST !== '1') throw new Error('Explicit opt-in required.');
const token = process.env.STHSTART_ADMIN_TOKEN;
if (!token) throw new Error('STHSTART_ADMIN_TOKEN is required.');
const statePath = resolve(process.env.STHSTART_LIVE_COMIC_STATE || 'artifacts/activity-comic-screenshots/live-comic-state.json');
const state = JSON.parse(await readFile(statePath, 'utf8'));
const root = `http://127.0.0.1:9320/api/admin/activities/${state.activityId}/comic`;
const request = async (method, path, body) => {
  const response = await fetch(`${root}${path}`, {
    method, headers: { 'x-sthstart-admin-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
};
const before = (await request('GET', '/draft')).draft;
if (before.document.pages.length !== 2 || before.document.panels.length !== 6) throw new Error('The isolated sample is no longer a two-page, six-panel draft.');
const submitted = await request('POST', '/storyboards', {
  expectedDraftVersion: before.draftVersion, stageId: 'stage-1', sceneId: 'scene-1', panelCount: 6,
  instructions: '按雪山实验的六个连续镜头生成漫画分镜，保留角色和现有台词，不增加新事件。',
  idempotencyKey: `comic-storyboard-smoke-${state.activityId}-${process.env.STHSTART_STORYBOARD_ATTEMPT || 'v1'}`,
});
let job = submitted.job;
const deadline = Date.now() + 5 * 60_000;
while (!['succeeded', 'failed', 'interrupted', 'unknown'].includes(job.status) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  job = (await request('GET', `/jobs/${job.id}`)).job;
}
if (job.status !== 'succeeded') throw new Error(`Storyboard job ${job.id}: ${job.status}, ${job.errorMessage || 'timeout'}`);
if (job.result?.panels?.length !== 6 || job.result?.pages?.length !== 2) throw new Error('The model result was not a valid two-page, six-panel storyboard.');
const applied = await request('POST', `/storyboards/${job.id}/apply`, { expectedDraftVersion: before.draftVersion, mode: 'append' });
try {
  if (applied.draft.document.pages.length !== 4 || applied.draft.document.panels.length !== 12) throw new Error('Applying the draft did not append two pages and six panels.');
  console.log(`Storyboard generated and applied: job=${job.id}, call=${job.callId || 'none'}`);
} finally {
  const latest = (await request('GET', '/draft')).draft;
  await request('PUT', '/draft', { expectedDraftVersion: latest.draftVersion, document: before.document });
}
const restored = (await request('GET', '/draft')).draft;
if (restored.document.pages.length !== 2 || restored.document.panels.length !== 6) throw new Error('The sample draft was not restored.');
console.log(`Restored two-page sample: ${state.activityId}`);
