/** Real end-to-end sample against the deployed portal and a live ComfyUI.
 *
 * The SthStart service only listens inside the container (4100). The portal on
 * 9320 exposes it through /api/admin/* using the admin token header, so this
 * script talks to the portal.
 *
 * It creates a NEW test activity only and never touches an existing project.
 * Pass --confirm to actually create the activity and submit one image.
 *
 *   $env:STHSTART_ADMIN_TOKEN='...'; node scripts/activity-real-sample.mjs --confirm
 *
 * Optional flags:
 *   --portal <url>    portal origin (default http://127.0.0.1:9320)
 *   --activity <id>   reuse an existing test activity (resume a partial run)
 *   --timeout <sec>   per-render wait budget (default 600)
 *   --keep            keep polling even if a render fails (default: stop)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const token = (process.env.STHSTART_ADMIN_TOKEN ?? '').trim();
if (!token) throw new Error('STHSTART_ADMIN_TOKEN is required');
if (!confirmed) throw new Error('Pass --confirm to run the real sample; nothing was created.');

const portal = flag('--portal', 'http://127.0.0.1:9320').replace(/\/$/, '');
const resumeActivityId = flag('--activity', '');
const renderTimeoutSeconds = Number(flag('--timeout', '600'));
const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const output = resolve('artifacts/activity-studio-abc', `real-sample-${stamp}`);
mkdirSync(output, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function call(method, path, body) {
  const response = await fetch(`${portal}/api/admin${path}`, {
    method,
    headers: { 'x-sthstart-admin-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  return { status: response.status, body: parsed ?? text };
}
const randomId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const report = { startedAt: new Date().toISOString(), portal, steps: [], issues: [] };
const step = (name, detail) => { report.steps.push({ name, ...detail }); console.log(`[${name}]`, JSON.stringify(detail)); };
const issue = (message) => { report.issues.push(message); console.error('[issue]', message); };
const save = () => writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));

try {
  const actionText = '阿贝多轻轻摇晃试管，注视着结晶的分子重组';
  let activityId;
  let stage;
  let sceneId;
  let beatId;

  if (resumeActivityId) {
    // Resume: reuse the activity an interrupted run already created.
    activityId = resumeActivityId;
    const draftResponse = await call('GET', `/activities/${activityId}/draft`);
    const document = draftResponse.body.document;
    if (!document) throw new Error(`draft missing for ${activityId}: ${JSON.stringify(draftResponse.body).slice(0, 300)}`);
    const found = document.stages
      .flatMap((item) => (item.scenes ?? []).map((scene) => ({ stage: item, scene })))
      .flatMap(({ stage: owner, scene }) => scene.beats.map((beat) => ({ stage: owner, scene, beat })))
      .find((entry) => entry.beat.action === actionText);
    if (!found) throw new Error(`the sample beat is not present in activity ${activityId}`);
    stage = found.stage; sceneId = found.scene.id; beatId = found.beat.id;
    step('resume-activity', { activityId, stageId: stage.id, sceneId, beatId });
  } else {
  // 1. Create a brand-new test activity (never touches existing projects).
  const created = await call('POST', '/activities', {
    title: `真实小样·阿贝多与砂糖的雪山实验·${stamp}`,
    type: '测试',
    theme: '雪山炼金实验',
    location: '龙脊雪山·阿贝多的营地',
    rules: '只用于真实链路验收',
    stageTitles: ['第 1 幕：雪山低温萃取', '第 2 幕：数据复核'],
  });
  if (created.status !== 201) throw new Error(`create activity failed: ${created.status} ${JSON.stringify(created.body).slice(0, 400)}`);
  activityId = created.body.activity.id;
  step('create-activity', { status: created.status, activityId, title: created.body.activity.title });

  const draftResponse = await call('GET', `/activities/${activityId}/draft`);
  const document = draftResponse.body.document;
  const draftVersion = draftResponse.body.draftVersion;
  if (!document || !draftVersion) throw new Error(`draft missing: ${JSON.stringify(draftResponse.body).slice(0, 400)}`);

  stage = document.stages[0];
  sceneId = randomId('scene');
  beatId = randomId('beat');
  const actorId = randomId('actor');
  const actor = {
    id: actorId,
    displayName: '阿贝多',
    activityRole: '炼金术师',
    outfitDescription: '白色实验长袍，金色短发',
    persona: {
      displayName: '阿贝多',
      englishName: 'Albedo',
      aliases: [],
      originType: 'original',
      work: '',
      world: '',
      summary: '',
      identity: '炼金术师',
      background: '',
      currentSituation: '',
      personality: [],
      motivations: [],
      beliefs: [],
      secrets: [],
      speech: { tone: '', habits: '', catchphrases: [], examples: [] },
      likes: [],
      dislikes: [],
      fears: [],
      boundaries: [],
      appearance: { description: '金色短发，青绿色眼睛，白色实验袍', hair: '金色短发', eyes: '青绿色', build: '纤细', outfits: [], accessories: [] },
      extraRules: '',
    },
    appearanceReferenceAssetKeys: [],
  };
  const beat = {
    id: beatId,
    sceneId,
    stageId: stage.id,
    characterId: actorId,
    characterName: '阿贝多',
    actorIds: [actorId],
    action: actionText,
    dialogue: '低温并未抑制反应，反而激发出意想不到的稳定性。',
    orderIndex: 0,
  };
  const scene = { id: sceneId, stageId: stage.id, title: '雪山低温萃取', timeText: '傍晚 18:30', locationText: '龙脊雪山·阿贝多的营地', environment: '风雪渐起，烧瓶内泛出浅金色微光', beats: [beat], orderIndex: 0 };
  const stages = document.stages.map((item, index) => index === 0 ? { ...item, scenes: [...(item.scenes ?? []), scene] } : item);
  const saved = await call('PUT', `/activities/${activityId}/draft`, {
    expectedDraftVersion: draftVersion,
    document: { ...document, actors: [...document.actors, actor], stages },
  });
  if (saved.status !== 200) throw new Error(`save draft failed: ${saved.status} ${JSON.stringify(saved.body).slice(0, 400)}`);
  step('add-actor-beat', { status: saved.status, stageId: stage.id, sceneId, beatId, actorId, draftVersion: saved.body.draftVersion });
  }

  // The seed is derived from the idempotency key, so preview and submit must
  // use the SAME key or the plan hash will differ and submit returns 409.
  // This mirrors what the workbench does.
  const idempotencyKey = `real-sample-${activityId}-${beatId}`;

  // 2. Preview must be submittable before we spend a real render.
  const preview = await call('POST', `/activities/${activityId}/beat-renders/preview`, { stageId: stage.id, sceneId, beatId, idempotencyKey });
  step('preview', {
    status: preview.status,
    canSubmit: preview.body.canSubmit,
    workflow: `${preview.body.workflowId} v${preview.body.workflowVersion}`,
    preset: preview.body.presetId ?? null,
    model: preview.body.model ?? null,
    positiveChars: (preview.body.positivePrompt ?? '').length,
    warnings: preview.body.warnings ?? [],
  });
  if (preview.status !== 200 || preview.body.canSubmit !== true) throw new Error(`preview not submittable: ${JSON.stringify(preview.body).slice(0, 600)}`);
  report.preview = {
    workflowId: preview.body.workflowId, workflowVersion: preview.body.workflowVersion,
    presetId: preview.body.presetId ?? null, model: preview.body.model ?? null,
    positivePrompt: preview.body.positivePrompt ?? null, negativePrompt: preview.body.negativePrompt ?? null,
    seed: preview.body.seed ?? null, planHash: preview.body.planHash ?? null,
  };

  // 3. Submit exactly one real image.
  const submit = await call('POST', `/activities/${activityId}/beat-renders`, {
    stageId: stage.id, sceneId, beatId, idempotencyKey,
  });
  step('submit', { status: submit.status, candidateId: submit.body.candidateId, taskId: submit.body.taskId, callId: submit.body.callId });
  if (submit.status !== 202) throw new Error(`submit failed: ${submit.status} ${JSON.stringify(submit.body).slice(0, 400)}`);
  report.activityId = activityId;
  report.candidateId = submit.body.candidateId;
  report.idempotencyKey = idempotencyKey;
  save();

  // 4. Poll until the candidate reaches a terminal state.
  const deadline = Date.now() + renderTimeoutSeconds * 1000;
  let candidate = null;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const listed = await call('GET', `/activities/${activityId}/beat-renders?stageId=${stage.id}&sceneId=${sceneId}&beatId=${beatId}&limit=12`);
    candidate = (listed.body.items ?? []).find((item) => item.id === submit.body.candidateId) ?? null;
    if (candidate && ['succeeded', 'adopted', 'failed'].includes(candidate.status)) break;
    await sleep(3000);
  }
  const images = candidate?.images ?? [];
  step('render-result', {
    status: candidate?.status ?? 'timeout', attempts,
    taskId: candidate?.taskId ?? null, callId: candidate?.callId ?? null,
    promptOptimizationStatus: candidate?.promptOptimizationStatus ?? null,
    autoApply: `${candidate?.autoApplyState ?? '?'}/${candidate?.autoApplyReason ?? '?'}`,
    images: images.map((image) => ({ artifactId: image.artifactId, available: image.available, isCurrent: image.isCurrent })),
    error: candidate?.error ?? null,
  });
  report.candidate = candidate;
  if (!candidate) issue(`render timed out after ${renderTimeoutSeconds}s (taskId=${submit.body.taskId})`);
  else if (candidate.status === 'failed') issue(`render failed: ${candidate.error ?? 'unknown'}`);
  else if (!images.some((image) => image.available)) issue('candidate reported success but no readable image artifact was found');

  // 5. Read the AI call log that the render produced.
  const callId = candidate?.callId ?? submit.body.callId;
  if (callId) {
    const log = await call('GET', `/ai-calls/${encodeURIComponent(callId)}`);
    const events = Array.isArray(log.body?.events) ? log.body.events : [];
    step('ai-call', {
      status: log.status, callId, callStatus: log.body?.status ?? null,
      provider: log.body?.provider ?? null, models: log.body?.models ?? null,
      workflowId: log.body?.workflowId ?? null, workflowVersion: log.body?.workflowVersion ?? null,
      upstreamTaskId: log.body?.upstreamTaskId ?? null, eventCount: events.length,
      positivePromptChars: (log.body?.positivePrompt ?? '').length,
      artifactIds: log.body?.artifactIds ?? null,
    });
    report.aiCall = log.body;

    // Compare the log snapshot with the preview plan; mismatch means the
    // recorded configuration is not the one that actually ran.
    const record = log.body?.requestSnapshot?.record ?? log.body?.requestSnapshot ?? null;
    const snapshotSeed = Number(record?.seed ?? record?.inputs?.seed ?? NaN);
    if (report.preview?.seed != null && Number.isFinite(snapshotSeed) && snapshotSeed !== report.preview.seed) {
      issue(`seed mismatch: preview=${report.preview.seed} log=${snapshotSeed}`);
    }
    if (report.preview?.workflowId && log.body?.workflowId && report.preview.workflowId !== log.body.workflowId) {
      issue(`workflow mismatch: preview=${report.preview.workflowId} log=${log.body.workflowId}`);
    }
  } else {
    issue('no callId returned for the render; AI call log cannot be verified');
  }

  report.finishedAt = new Date().toISOString();
  report.result = candidate?.status === 'succeeded' || candidate?.status === 'adopted' ? 'passed' : 'failed';
  save();
  console.log(`\nReport written to ${output}`);
  console.log(`result=${report.result} activityId=${activityId}`);
  if (report.issues.length) console.log(`issues=${report.issues.length}`);
  process.exitCode = report.result === 'passed' ? 0 : 1;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.finishedAt = new Date().toISOString();
  save();
  console.error('[fatal]', report.error);
  console.error(`Partial report written to ${output}`);
  process.exitCode = 1;
}

