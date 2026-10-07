/** Stage 7 real sample for the activity studio A+B+C work.
 *
 * Runs against the deployed portal (which proxies the container-only service)
 * and a live ComfyUI. It ONLY writes into a brand-new test activity.
 *
 *   $env:STHSTART_ADMIN_TOKEN='...'; node scripts/activity-stage7-sample.mjs --confirm
 *
 * Flags:
 *   --portal <url>     portal origin (default http://127.0.0.1:9320)
 *   --activity <id>    reuse an existing test activity instead of creating one
 *   --render-timeout <sec>  per-render budget (default 900)
 *   --skip <list>      comma list of stages to skip: reflect,storyboard,batch,comic
 *   --with-comic-render     also render one comic panel (extra image)
 *
 * Hard budget: the normal sample creates at most 12 images and never retries a
 * failed environment blindly.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
if (!has('--confirm')) throw new Error('Pass --confirm to run the real sample; nothing was created.');
const token = (process.env.STHSTART_ADMIN_TOKEN ?? '').trim();
if (!token) throw new Error('STHSTART_ADMIN_TOKEN is required');

const portal = flag('--portal', 'http://127.0.0.1:9320').replace(/\/$/, '');
const resumeId = flag('--activity', '');
const renderTimeoutMs = Number(flag('--render-timeout', '900')) * 1000;
const skip = new Set(flag('--skip', '').split(',').map((v) => v.trim()).filter(Boolean));
const doComicRender = has('--with-comic-render');
const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
const output = resolve('artifacts/activity-studio-abc', `stage7-${stamp}`);
mkdirSync(output, { recursive: true });

const IMAGE_BUDGET = 12;
const report = { startedAt: new Date().toISOString(), portal, imageBudget: IMAGE_BUDGET, steps: [], issues: [] };
let imageCount = 0;
const step = (name, detail) => { report.steps.push({ name, ...detail }); console.log(`[${name}]`, JSON.stringify(detail)); };
const issue = (message) => { report.issues.push(message); console.error('[issue]', message); };
const save = () => writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const rid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

async function call(method, path, body) {
  const response = await fetch(`${portal}/api/admin${path}`, {
    method,
    headers: { 'x-sthstart-admin-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  return { status: response.status, body: parsed ?? text };
}

async function versions(activityId) {
  const [activity, draft, imageConfig] = await Promise.all([
    call('GET', `/activities/${activityId}`),
    call('GET', `/activities/${activityId}/draft`),
    call('GET', `/activities/${activityId}/image-config/draft`),
  ]);
  const comic = await call('GET', `/activities/${activityId}/comic/draft`);
  const context = {
    headVersion: activity.body.activity.headVersion,
    contentDraftVersion: draft.body.draftVersion,
    contentRevisionId: activity.body.activity.currentContentRevisionId ?? null,
    imageConfigDraftVersion: imageConfig.body.draftVersion,
    imageConfigRevisionId: imageConfig.body.baseRevisionId ?? null,
  };
  const comicVersion = comic.body?.draft?.draftVersion ?? comic.body?.draftVersion;
  if (comicVersion) context.comicDraftVersion = comicVersion;
  return context;
}

async function waitJob(activityId, jobId, terminal, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let job = null;
  while (Date.now() < deadline) {
    const response = await call('GET', `/activities/${activityId}/studio-jobs/${encodeURIComponent(jobId)}`);
    job = response.body;
    if (job && terminal.includes(job.status)) return job;
    await sleep(2500);
  }
  return job;
}

/** Collect every readable image artifact referenced by a studio job. */
function jobArtifacts(job) {
  const found = new Set();
  const visit = (value, depth) => {
    if (!value || depth > 6) return;
    if (typeof value === 'string') { if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) found.add(value); return; }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (typeof value === 'object') { for (const item of Object.values(value)) visit(item, depth + 1); }
  };
  visit(job?.appliedResult, 0);
  return [...found];
}

const actionText = '阿贝多轻轻摇晃试管，注视着结晶的分子重组';

try {
  let activityId;
  let stageId;
  let actorId;
  let sceneId;
  let beatId;

  if (resumeId) {
    activityId = resumeId;
    const draft = await call('GET', `/activities/${activityId}/draft`);
    const document = draft.body.document;
    const found = document.stages
      .flatMap((stage) => (stage.scenes ?? []).map((scene) => ({ stage, scene })))
      .flatMap(({ stage, scene }) => scene.beats.map((beat) => ({ stage, scene, beat })))
      .find((entry) => entry.beat.action === actionText);
    if (!found) throw new Error(`sample beat not found in ${activityId}`);
    stageId = found.stage.id; sceneId = found.scene.id; beatId = found.beat.id;
    actorId = document.actors.find((actor) => actor.displayName === '阿贝多')?.id;
    step('resume-activity', { activityId, stageId, sceneId, beatId, actorId });
  } else {
    const created = await call('POST', '/activities', {
      title: `阶段7真实小样·阿贝多与砂糖的雪山实验·${stamp}`,
      type: '测试', theme: '雪山炼金实验', location: '龙脊雪山·阿贝多的营地', rules: '只用于真实链路验收',
      stageTitles: ['第 1 幕：雪山低温萃取', '第 2 幕：数据复核'],
    });
    if (created.status !== 201) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    activityId = created.body.activity.id;
    step('create-activity', { status: created.status, activityId, title: created.body.activity.title });

    const draft = await call('GET', `/activities/${activityId}/draft`);
    const document = draft.body.document;
    stageId = document.stages[0].id;
    sceneId = rid('scene'); beatId = rid('beat'); actorId = rid('actor');
    const persona = {
      displayName: '阿贝多', englishName: 'Albedo', aliases: [], originType: 'original', work: '', world: '',
      summary: '', identity: '炼金术师', background: '', currentSituation: '', personality: [], motivations: [],
      beliefs: [], secrets: [], speech: { tone: '', habits: '', catchphrases: [], examples: [] }, likes: [], dislikes: [],
      fears: [], boundaries: [],
      appearance: { description: '金色短发，青绿色眼睛，白色实验袍', hair: '金色短发', eyes: '青绿色', build: '纤细', outfits: [], accessories: [] },
      extraRules: '',
    };
    const saved = await call('PUT', `/activities/${activityId}/draft`, {
      expectedDraftVersion: draft.body.draftVersion,
      document: {
        ...document,
        actors: [...document.actors, { id: actorId, displayName: '阿贝多', activityRole: '炼金术师', outfitDescription: '白色实验长袍，金色短发', persona, appearanceReferenceAssetKeys: [] }],
        stages: document.stages.map((stage, index) => index === 0 ? { ...stage, scenes: [...(stage.scenes ?? []), {
          id: sceneId, stageId, title: '雪山低温萃取', timeText: '傍晚 18:30', locationText: '龙脊雪山·阿贝多的营地',
          environment: '风雪渐起，烧瓶内泛出浅金色微光', orderIndex: 0,
          beats: [{ id: beatId, sceneId, stageId, characterId: actorId, characterName: '阿贝多', actorIds: [actorId], action: actionText, dialogue: '低温并未抑制反应，反而激发出意想不到的稳定性。', orderIndex: 0 }],
        }] } : stage),
      },
    });
    if (saved.status !== 200) throw new Error(`save draft failed: ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`);
    step('add-manual-beat', { stageId, sceneId, beatId, actorId, draftVersion: saved.body.draftVersion });
  }
  report.activityId = activityId;
  report.manualBeat = { stageId, sceneId, beatId, actorId };
  save();

  // A. One manual beat: verify settings + history + real log.
  if (!skip.has('reflect')) {
    const key = `stage7-manual-${beatId}`;
    const preview = await call('POST', `/activities/${activityId}/beat-renders/preview`, { stageId, sceneId, beatId, idempotencyKey: key });
    if (preview.status !== 200 || preview.body.canSubmit !== true) throw new Error(`manual preview blocked: ${JSON.stringify(preview.body).slice(0, 400)}`);
    const submit = await call('POST', `/activities/${activityId}/beat-renders`, { stageId, sceneId, beatId, idempotencyKey: key });
    if (submit.status !== 202) throw new Error(`manual submit failed: ${submit.status} ${JSON.stringify(submit.body).slice(0, 300)}`);
    imageCount += 1;
    const deadline = Date.now() + renderTimeoutMs;
    let candidate = null;
    while (Date.now() < deadline) {
      const listed = await call('GET', `/activities/${activityId}/beat-renders?stageId=${stageId}&sceneId=${sceneId}&beatId=${beatId}&limit=12`);
      candidate = (listed.body.items ?? []).find((item) => item.id === submit.body.candidateId) ?? null;
      if (candidate && ['succeeded', 'adopted', 'failed'].includes(candidate.status)) break;
      await sleep(3000);
    }
    const images = candidate?.images ?? [];
    const readable = images.filter((image) => image.available);
    step('A-manual-beat', {
      workflow: `${preview.body.workflowId} v${preview.body.workflowVersion}`, candidateId: submit.body.candidateId,
      status: candidate?.status ?? 'timeout', taskId: candidate?.taskId ?? null, callId: candidate?.callId ?? null,
      autoApply: `${candidate?.autoApplyState ?? '?'}`, readableImages: readable.length,
      promptOptimization: candidate?.promptOptimizationStatus ?? null, error: candidate?.error ?? null,
    });
    report.manualRender = { candidateId: submit.body.candidateId, status: candidate?.status ?? 'timeout', callId: candidate?.callId ?? null, taskId: candidate?.taskId ?? null };
    if (candidate?.status !== 'succeeded' && candidate?.status !== 'adopted') issue(`manual beat render ${candidate?.status ?? 'timeout'}: ${candidate?.error ?? ''}`);
    else if (!readable.length) issue('manual beat reported success with no readable image');
    else {
      const call_ = await call('GET', `/ai-calls/${encodeURIComponent(candidate.callId)}`);
      report.manualAiCall = call_.body;
      step('A-ai-call', {
        callStatus: call_.body?.status, models: call_.body?.models, workflowId: call_.body?.workflowId,
        workflowVersion: call_.body?.workflowVersion, upstreamTaskId: call_.body?.upstreamTaskId,
        artifactIds: call_.body?.artifactIds, events: (call_.body?.events ?? []).length,
        positivePromptChars: (call_.body?.positivePrompt ?? '').length,
      });
    }
    save();
  }

  // B. Storyboard: 6 beats from saved text, review, apply.
  let storyboardSceneId = null;
  if (!skip.has('storyboard')) {
    const context = await versions(activityId);
    const request = {
      kind: 'storyboard', versions: context, idempotencyKey: `stage7-storyboard-${activityId}-${stamp}`,
      input: {
        source: { kind: 'text', text: '阿贝多与砂糖在龙脊雪山的营地中提取星银晶露。砂糖紧张地记录温度参数，阿贝多在低温中稳定催化反应。风雪渐起，实验进入关键时刻，两人最终确认了低温萃取的成功配方。' },
        actorIds: [actorId], output: 'beats', count: 6, stageId, sceneId: null,
        instructions: '表现雪山实验的过程与两人的分工，节奏由远及近。',
      },
    };
    const createdJob = await call('POST', `/activities/${activityId}/studio-jobs`, request);
    if (createdJob.status !== 202) throw new Error(`storyboard create failed: ${createdJob.status} ${JSON.stringify(createdJob.body).slice(0, 400)}`);
    const job = await waitJob(activityId, createdJob.body.id, ['awaiting_review', 'failed', 'unknown', 'cancelled', 'interrupted']);
    const beats = job?.result?.output?.beats ?? [];
    step('B-storyboard', { jobId: job?.id, status: job?.status, beats: beats.length, sourceLabel: job?.result?.sourceLabel, resultHash: job?.result?.resultHash, error: job?.errorMessage ?? null });
    if (job?.status === 'awaiting_review' && beats.length >= 2) {
      const applied = await call('POST', `/activities/${activityId}/studio-jobs/${encodeURIComponent(job.id)}/apply`, {
        expectedJobRevision: job.revision, versions: await versions(activityId), resultHash: job.result.resultHash,
        mode: 'append', sceneId: null,
      });
      step('B-apply', { status: applied.status, applyState: applied.body?.applyState, sceneId: applied.body?.appliedResult?.sceneId, beatIds: applied.body?.appliedResult?.beatIds?.length ?? 0, error: applied.body?.errorMessage ?? applied.body?.error ?? null });
      if (applied.status === 200) storyboardSceneId = applied.body.appliedResult.sceneId;
      else issue(`storyboard apply failed: ${JSON.stringify(applied.body).slice(0, 300)}`);
      report.storyboard = { jobId: job.id, beatIds: applied.body?.appliedResult?.beatIds ?? [], sceneId: storyboardSceneId };
    } else {
      issue(`storyboard did not reach review: ${job?.status} ${job?.errorMessage ?? ''}`);
    }
    save();
  }

  // C. Refine two beats: composition + warm light.
  if (!skip.has('reflect') && !skip.has('storyboard') && storyboardSceneId) {
    const draft = await call('GET', `/activities/${activityId}/draft`);
    const scene = draft.body.document.stages.flatMap((stage) => stage.scenes ?? []).find((item) => item.id === storyboardSceneId);
    const targets = (scene?.beats ?? []).slice(0, 2);
    const results = [];
    for (const [index, target] of targets.entries()) {
      const instruction = index === 0 ? '把构图改为三分法，主体略偏左，留出右侧空间' : '增加温暖的金色侧光，营造傍晚氛围';
      const created = await call('POST', `/activities/${activityId}/studio-jobs`, {
        kind: 'refine', versions: await versions(activityId), idempotencyKey: `stage7-refine-${target.id}`,
        input: { target: { kind: 'beat', stageId, sceneId: storyboardSceneId, beatId: target.id }, instructions: instruction },
      });
      if (created.status !== 202) { issue(`refine create failed for ${target.id}: ${created.status}`); continue; }
      const job = await waitJob(activityId, created.body.id, ['awaiting_review', 'failed', 'unknown', 'cancelled', 'interrupted']);
      const applied = job?.status === 'awaiting_review'
        ? await call('POST', `/activities/${activityId}/studio-jobs/${encodeURIComponent(job.id)}/apply`, { expectedJobRevision: job.revision, versions: await versions(activityId), resultHash: job.result.resultHash })
        : null;
      results.push({ beatId: target.id, jobStatus: job?.status, applyStatus: applied?.status ?? null, explanation: job?.result?.explanation ?? null });
    }
    step('C-refine', { requested: targets.length, results });
    report.refine = results;
    save();
  }

  // D. Batch: 6 draft images with explicit fill_empty.
  if (!skip.has('batch')) {
    const draft = await call('GET', `/activities/${activityId}/draft`);
    const allBeats = draft.body.document.stages
      .flatMap((stage) => (stage.scenes ?? []).map((scene) => ({ stage, scene })))
      .flatMap(({ stage, scene }) => scene.beats.map((beat) => ({ stageId: stage.id, sceneId: scene.id, beatId: beat.id, mediaUrl: beat.mediaUrl })));
    const empty = allBeats.filter((beat) => !beat.mediaUrl).slice(0, 6);
    if (empty.length < 2) issue('not enough empty beats for the batch sample');
    else {
      const created = await call('POST', `/activities/${activityId}/studio-jobs`, {
        kind: 'render_batch', versions: await versions(activityId), idempotencyKey: `stage7-batch-${activityId}-${stamp}`,
        input: { targets: empty.map((beat) => ({ kind: 'beat', stageId: beat.stageId, sceneId: beat.sceneId, beatId: beat.beatId })), candidateCount: 1, placement: 'fill_empty' },
      });
      if (created.status !== 202) issue(`batch create failed: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
      else {
        const job = await waitJob(activityId, created.body.id, ['awaiting_review', 'failed', 'unknown', 'cancelled', 'interrupted']);
        const plans = job?.result?.plans ?? [];
        step('D-batch-preview', { jobId: job?.id, status: job?.status, plans: plans.length, imageTaskCount: job?.result?.imageTaskCount, planHash: job?.result?.planHash, issues: plans.flatMap((plan) => plan.issues ?? []) });
        if (job?.status === 'awaiting_review' && plans.length) {
          const started = await call('POST', `/activities/${activityId}/studio-jobs/${encodeURIComponent(job.id)}/start`, { expectedJobRevision: job.revision, planHash: job.result.planHash });
          step('D-batch-start', { status: started.status, jobStatus: started.body?.status, error: started.body?.error ?? started.body?.errorMessage ?? null });
          if (started.status === 202 || started.status === 200) {
            const runningDeadline = Date.now() + renderTimeoutMs;
            let current = started.body;
            while (Date.now() < runningDeadline) {
              current = (await call('GET', `/activities/${activityId}/studio-jobs/${encodeURIComponent(job.id)}`)).body;
              if (current && !['queued', 'preparing', 'running'].includes(current.status)) break;
              await sleep(4000);
            }
            const items = (await call('GET', `/activities/${activityId}/studio-jobs/${encodeURIComponent(job.id)}/items?limit=20`)).body.items ?? [];
            imageCount += items.filter((item) => (item.artifactIds ?? []).length).length;
            step('D-batch-result', {
              status: current?.status, items: items.length,
              succeeded: items.filter((item) => item.state === 'succeeded').length,
              failed: items.filter((item) => item.state === 'failed').length,
              unknown: items.filter((item) => item.state === 'unknown').length,
              placement: items.map((item) => item.placementState),
            });
            report.batch = { jobId: job.id, items: items.map((item) => ({ id: item.id, state: item.state, callId: item.callId, artifactIds: item.artifactIds, placementState: item.placementState })) };
          }
        } else issue(`batch did not reach review: ${job?.status} ${job?.errorMessage ?? ''}`);
      }
    }
    save();
  }

  // E. Comic: storyboard to two pages / six panels, dynamic read, PNG + offline ZIP.
  if (!skip.has('comic')) {
    const context = await versions(activityId);
    const created = await call('POST', `/activities/${activityId}/studio-jobs`, {
      kind: 'storyboard', versions: context, idempotencyKey: `stage7-comic-${activityId}-${stamp}`,
      input: {
        source: { kind: 'text', text: '阿贝多和砂糖在雪山营地完成星银晶露的低温萃取。砂糖快速记录数据，阿贝多稳定反应，风雪中烧瓶泛出浅金色微光，两人确认实验成功。' },
        actorIds: [actorId], output: 'comic', count: 6, stageId, sceneId: storyboardSceneId ?? sceneId,
        instructions: '两页六格，远景与特写交替，表现出实验过程和成功瞬间。',
      },
    });
    if (created.status !== 202) issue(`comic storyboard create failed: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    else {
      const job = await waitJob(activityId, created.body.id, ['awaiting_review', 'failed', 'unknown', 'cancelled', 'interrupted']);
      const comicResult = job?.result?.comic ?? null;
      step('E-comic-storyboard', { jobId: job?.id, status: job?.status, panels: comicResult?.panels?.length ?? 0, error: job?.errorMessage ?? null });
      if (job?.status === 'awaiting_review') {
        const applied = await call('POST', `/activities/${activityId}/studio-jobs/${encodeURIComponent(job.id)}/apply`, {
          expectedJobRevision: job.revision, versions: await versions(activityId), resultHash: job.result.resultHash, mode: 'append', sceneId: stageId,
        });
        const appliedResult = applied.body?.appliedResult ?? null;
        step('E-comic-apply', { status: applied.status, pages: appliedResult?.pageIds?.length ?? 0, panels: appliedResult?.panelIds?.length ?? 0, error: applied.body?.errorMessage ?? applied.body?.error ?? null });
        report.comic = { jobId: job.id, pageIds: appliedResult?.pageIds ?? [], panelIds: appliedResult?.panelIds ?? [] };

        if (applied.status === 200) {
          // Optional one real comic panel render.
          if (doComicRender && (appliedResult?.panelIds ?? []).length) {
            const panelId = appliedResult.panelIds[0];
            const previewPanel = await call('POST', `/activities/${activityId}/comic/panels/${encodeURIComponent(panelId)}/render-preview`, {});
            const startPanel = previewPanel.status === 200
              ? await call('POST', `/activities/${activityId}/comic/panels/${encodeURIComponent(panelId)}/renders`, { idempotencyKey: `stage7-comic-render-${panelId}`, planHash: previewPanel.body?.planHash, seed: previewPanel.body?.seed })
              : null;
            step('E-comic-render', { previewStatus: previewPanel.status, renderStatus: startPanel?.status ?? null, panelId });
            if (startPanel?.status !== 202) issue(`comic panel render failed to start: ${JSON.stringify(startPanel?.body).slice(0, 200)}`);
            else {
              imageCount += 1;
              const deadline = Date.now() + renderTimeoutMs;
              let history = null;
              while (Date.now() < deadline) {
                history = (await call('GET', `/activities/${activityId}/comic/panels/${encodeURIComponent(panelId)}/history?limit=10`)).body;
                const items = history?.items ?? [];
                if (items.some((item) => ['succeeded', 'failed'].includes(item.status))) break;
                await sleep(3000);
              }
              const items = history?.items ?? [];
              const succeeded = items.find((item) => item.status === 'succeeded');
              step('E-comic-render-result', { items: items.length, status: succeeded?.status ?? items[0]?.status ?? 'timeout', artifacts: succeeded?.images?.length ?? 0 });
              if (!succeeded) issue('comic panel render did not succeed');
            }
          }

          // Freeze an immutable comic revision then export PNG + offline ZIP.
          const comicDraft = await call('GET', `/activities/${activityId}/comic/draft`);
          const revision = await call('POST', `/activities/${activityId}/comic/revisions`, { expectedDraftVersion: comicDraft.body?.draft?.draftVersion ?? comicDraft.body?.draftVersion });
          const revisionId = revision.body?.id ?? revision.body?.revision?.id ?? null;
          step('E-comic-revision', { status: revision.status, revisionId, documentHash: revision.body?.documentHash ?? revision.body?.revision?.documentHash ?? null });
          if (revisionId) {
            const reader = await fetch(`${portal}/api/admin/activities/${activityId}/comic/exports/reader`, {
              method: 'POST', headers: { 'x-sthstart-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ revisionId }),
            });
            const bytes = Buffer.from(await reader.arrayBuffer());
            const zipPath = resolve(output, 'comic-offline.zip');
            writeFileSync(zipPath, bytes);
            step('E-comic-export', { status: reader.status, contentType: reader.headers.get('content-type'), bytes: bytes.length, path: zipPath });
            if (reader.status !== 200 || bytes.length < 100) issue('comic offline export did not return a usable ZIP');
          }
        }
      } else issue(`comic storyboard did not reach review: ${job?.status} ${job?.errorMessage ?? ''}`);
    }
    save();
  }

  report.imageCount = imageCount;
  if (imageCount > IMAGE_BUDGET) issue(`image count ${imageCount} exceeded the ${IMAGE_BUDGET} budget`);
  report.finishedAt = new Date().toISOString();
  report.result = report.issues.length ? 'passed_with_issues' : 'passed';
  save();
  console.log(`\nReport: ${output}\nresult=${report.result} images=${imageCount} issues=${report.issues.length}`);
  process.exitCode = report.issues.length ? 1 : 0;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.finishedAt = new Date().toISOString();
  report.result = 'failed';
  save();
  console.error('[fatal]', report.error);
  console.error(`Partial report: ${output}`);
  process.exitCode = 1;
}

