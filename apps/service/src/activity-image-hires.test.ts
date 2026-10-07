import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { HiresPreviewResponseSchema, HiresSubmitRequestSchema, StudioJobSchema, type HiresPreviewResponse, type StudioJob } from '@sthstart/contracts';
import { Value } from '@sinclair/typebox/value';
import { StudioStore } from './activities/studio-store.js';
import { previewStudioHires, createStudioHires, readFrozenHiresPlan, resolveHiresSource, type FrozenHiresPlan } from './activities/studio-hires.js';
import { ServiceDatabase } from './database.js';

// ------------------- 第二轮修复（计划 §6.1／§8）：素材细化的来源归属查询
// 用例名统一带 `parity-round2:`，便于按计划 §8 的命令只跑本轮定向用例。

const R2_NOW = '2026-10-03T00:00:00.000Z';

/** 造一个最小库：一个活动、两个槽位、三次 attempt（其中两次同槽位，旧的在前）。 */
function r2MediaFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'parity-round2-'));
  const database = new ServiceDatabase();
  // 本用例只验证**归属查询**的语义（哪张图属于哪个活动／槽位／attempt），
  // 不验证外键图。构造完整的内容修订链会引入大量与断言无关的行，
  // 所以这里显式关闭外键强制，并如实注明。
  database.connection.exec('PRAGMA foreign_keys=OFF');
  const file = join(dir, 'art.png');
  writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  database.connection.prepare('INSERT INTO activities(id,title,type,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run('act-1', '验收活动', 'general', R2_NOW, R2_NOW);
  for (const taskId of ['t1', 't3', 't2']) {
    database.connection.prepare(`INSERT INTO generation_tasks
      (id,app_id,engine_id,workflow_id,workflow_version,request_hash,request_params_json,workflow_snapshot_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(taskId, 'activities', 'engine-1', 'wf-1', 1, `rh-${taskId}`, '{}', '{}', 'succeeded', R2_NOW, R2_NOW);
  }
  for (const [artifactId, sha] of [['art-1', 'sha-old'], ['art-3', 'sha-new'], ['art-2', 'sha-other']]) {
    database.connection.prepare(`INSERT INTO artifacts(id,app_id,media_type,file_status,sha256,local_path,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(artifactId, 'activities', 'image/png', 'ready', sha, file, R2_NOW);
  }
  // attempt：a1 与 a3 同在 s1（a1 更旧），a2 在 s2。
  for (const [id, slotId, taskId, createdAt] of [
    ['a1', 's1', 't1', '2026-10-01T00:00:00.000Z'],
    ['a3', 's1', 't3', '2026-10-02T00:00:00.000Z'],
    ['a2', 's2', 't2', '2026-10-02T00:00:00.000Z'],
  ] as const) {
    database.connection.prepare(`INSERT INTO activity_image_attempts
      (id,activity_id,base_content_revision_id,image_config_revision_id,slot_id,slot_fingerprint,recipe_id,compilation_id,recipe_hash,
       execution_plan_hash,task_id,status,actual_seed,business_request_hash,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, 'act-1', 'rev-1', 'img-1', slotId, `fp-${slotId}`, `recipe-${id}`, `comp-${id}`, `rh-${id}`,
        `eph-${id}`, taskId, 'succeeded', 20260101, `brh-${id}`, createdAt, createdAt);
  }
  for (const [attemptId, artifactId] of [['a1', 'art-1'], ['a3', 'art-3'], ['a2', 'art-2']]) {
    database.connection.prepare(`INSERT INTO activity_image_attempt_outputs
      (attempt_id,artifact_id,asset_key,output_name,sort_order,created_at) VALUES (?,?,?,?,?,?)`)
      .run(attemptId, artifactId, `asset-${artifactId}`, 'default', 0, R2_NOW);
  }
  for (const [taskId, slotId, attemptId, createdAt] of [
    ['t1', 's1', 'a1', '2026-10-01T00:00:00.000Z'],
    ['t3', 's1', 'a3', '2026-10-02T00:00:00.000Z'],
    ['t2', 's2', 'a2', '2026-10-02T00:00:00.000Z'],
  ] as const) {
    database.connection.prepare(`INSERT INTO activity_media_job_links
      (task_id,activity_id,content_revision_id,slot_id,slot_fingerprint,created_at,attempt_id) VALUES (?,?,?,?,?,?,?)`)
      .run(taskId, 'act-1', 'rev-1', slotId, `fp-${slotId}`, createdAt, attemptId);
  }
  return { database, config: { artifactDirectory: dir } as never };
}

const r2MediaTarget = (slotId: string) => ({ kind: 'media_slot', slotId }) as never;

test('parity-round2: 素材来源必须属于本槽位的那次 attempt', () => {
  const { database, config } = r2MediaFixture();
  try {
    const source = resolveHiresSource(database, config, 'act-1', r2MediaTarget('s1'), 'art-1');
    assert.equal(source.targetContext.kind, 'media_slot');
    assert.equal((source.targetContext as { sourceAttemptId: string }).sourceAttemptId, 'a1');
    assert.equal(source.generationTaskId, 't1');
  } finally { database.close(); }
});

test('parity-round2: 同活动其他槽位的图片必须被拒绝', () => {
  const { database, config } = r2MediaFixture();
  try {
    // art-2 属于槽位 s2；用 s1 请求它必须失败。
    // 旧写法 `a.id=(SELECT id FROM activity_image_attempt_outputs WHERE artifact_id=? ...)` 里
    // outputs 没有 `id` 列，SQLite 会解析成外层 a.id，条件退化成恒真，于是这里会**错误地放行**。
    assert.throws(
      () => resolveHiresSource(database, config, 'act-1', r2MediaTarget('s1'), 'art-2'),
      (error: { code?: string }) => error.code === 'hires_source_not_owned',
    );
  } finally { database.close(); }
});

test('parity-round2: 同槽位多次 attempt 时按 artifactId 定位，不默认取最新一张', () => {
  const { database, config } = r2MediaFixture();
  try {
    // s1 里 a3 比 a1 新。请求 a1 的产物必须解析回 a1。
    // 旧写法在 ORDER BY created_at DESC 下会返回 a3——张冠李戴的来源归属。
    const source = resolveHiresSource(database, config, 'act-1', r2MediaTarget('s1'), 'art-1');
    assert.equal((source.targetContext as { sourceAttemptId: string }).sourceAttemptId, 'a1',
      '必须按 artifactId 找到对应 attempt，而不是取最新一次');
    assert.equal((source.targetContext as { recipeId: string }).recipeId, 'recipe-a1');
    // 反向确认：请求 a3 的产物解析回 a3，两条各自独立。
    const newer = resolveHiresSource(database, config, 'act-1', r2MediaTarget('s1'), 'art-3');
    assert.equal((newer.targetContext as { sourceAttemptId: string }).sourceAttemptId, 'a3');
  } finally { database.close(); }
});
import { insertHiresNativeHistory, processStudioHires } from './activities/studio-hires-runner.js';
import { readImageOperationMetadata } from './activities/studio-image-operation.js';
import { recoverStudioJobs, resumeStudioJob } from './activities/studio-recovery.js';
import { listStudioItems } from './activities/studio-batches.js';
import { buildParityHiresWorkflow } from './activities/parity-workflows.js';
import { computeHiresOutputSize, probePngHeader } from './activities/studio-hires.js';
import { closeFixture, hiresFixture, hiresService, pngBytes } from './activity-image-hires-support.js';

test('hires workflow bundle is service-finalized, has no quality-suffix concatenation and declares the source image input', () => {
  const bundle = buildParityHiresWorkflow();
  assert.equal(bundle.id, 'anima-activity-hires-basic');
  assert.equal(bundle.editorConfig.promptAssembly, 'service-finalized-v1');
  assert.equal(bundle.outputDeclarations[0], '13');
  assert.equal((bundle.inputCapabilities.init_image as { required?: boolean }).required, true);
  assert.equal((bundle.inputCapabilities.init_image as { semantic?: string }).semantic, 'init_image');
  assert.equal(Object.values(bundle.definition).some((node) => String((node as { class_type?: string }).class_type) === 'StringConcatenate'), false,
    'the hires graph must not concatenate any quality suffix');
  // 正负提示词直接绑定到 CLIPTextEncode.text 的字符串字面量。
  assert.deepEqual(bundle.nodeBindings.positivePrompt, ['6', 'inputs', 'text']);
  assert.deepEqual(bundle.nodeBindings.negativePrompt, ['7', 'inputs', 'text']);
  assert.deepEqual(bundle.nodeBindings.init_image, ['1', 'inputs', 'image']);
  assert.equal(typeof (bundle.definition['6'] as { inputs: { text: unknown } }).inputs.text, 'string');
  assert.equal(typeof (bundle.definition['7'] as { inputs: { text: unknown } }).inputs.text, 'string');
  // 固定图形方案顺序：LoadImage → 白底合成 → ImageScale(lanczos, crop=disabled) → VAEEncode → KSampler → VAEDecode → SaveImage。
  const definition = bundle.definition as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
  assert.equal(definition['1'].class_type, 'LoadImage');
  assert.equal(definition['3'].class_type, 'ImageCompositeMasked');
  // 计划 §12.2：合成 mask 必须是 LoadImage 反 alpha **反转后**的结果。
  // 直接用 LoadImage 的 mask 输出，在不透明图上整张 mask 为 0，会保留整张白底，
  // 把画面抹成纯白（真实实例上确实出现过，见进度日志 R6.2）。
  assert.equal(definition['14'].class_type, 'InvertMask');
  assert.deepEqual(definition['14'].inputs!.mask, ['1', 1], 'InvertMask 必须取 LoadImage 的 mask 输出');
  assert.deepEqual(definition['3'].inputs!.mask, ['14', 0], '白底合成必须用反转后的 mask');
  assert.deepEqual(definition['4'].inputs!.image, ['3', 0]);
  assert.equal(definition['5'].class_type, 'VAEEncode');
  assert.deepEqual(definition['5'].inputs!.pixels, ['4', 0]);
  assert.equal(definition['11'].class_type, 'KSampler');
  assert.deepEqual(definition['11'].inputs!.latent_image, ['5', 0]);
  assert.equal(definition['12'].class_type, 'VAEDecode');
  assert.deepEqual(definition['13'].inputs!.images, ['12', 0]);
  // 编辑器字段都必须有对应 inputSchema 键，否则界面会出现无法提交的字段。
  const schemaKeys = new Set(Object.keys(bundle.inputSchema));
  for (const key of Object.keys(bundle.editorConfig.fields)) assert.ok(schemaKeys.has(key), `editor field ${key} has no input schema entry`);
  for (const [key, [nodeId, category, paramName]] of Object.entries(bundle.nodeBindings)) {
    assert.equal(category, 'inputs', key);
    const node = definition[nodeId];
    assert.ok(node, `binding ${key} targets a missing node`);
    assert.ok(paramName in (node.inputs ?? {}), `binding ${key} targets a missing input`);
  }
  assert.equal(bundle.contentHash.length, 64);
});

test('hires output size scales by the longest side, floors to a multiple of eight and never goes below eight', () => {
  assert.deepEqual(computeHiresOutputSize(768, 512, 2000), { width: 2000, height: 1328, scale: 2000 / 768 });
  assert.deepEqual(computeHiresOutputSize(512, 768, 1536), { width: 1024, height: 1536, scale: 2 });
  assert.deepEqual(computeHiresOutputSize(2048, 2048, 2048), { width: 2048, height: 2048, scale: 1 });
  // 极端窄图仍然不小于 8，且始终为 8 的倍数。
  const tiny = computeHiresOutputSize(2000, 9, 2048);
  assert.equal(tiny.width % 8, 0); assert.equal(tiny.height, 8);
  const narrow = computeHiresOutputSize(1, 4000, 2048);
  assert.ok(narrow.width >= 8 && narrow.width % 8 === 0);
  assert.ok(narrow.height >= 8 && narrow.height % 8 === 0);
});

test('the PNG header probe reads dimensions and alpha without a heavy image dependency', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sthstart-hires-png-'));
  const cases: Array<{ name: string; colorType: number; alpha: boolean }> = [
    { name: 'rgb.png', colorType: 2, alpha: false },
    { name: 'rgba.png', colorType: 6, alpha: true },
    { name: 'gray-alpha.png', colorType: 4, alpha: true },
    { name: 'palette.png', colorType: 3, alpha: true },
    { name: 'gray.png', colorType: 0, alpha: false },
  ];
  for (const item of cases) {
    const path = join(directory, item.name);
    writeFileSync(path, pngBytes(1232, 848, item.colorType));
    const probe = probePngHeader(path);
    assert.ok(probe, `${item.name} must be readable`);
    assert.equal(probe!.width, 1232);
    assert.equal(probe!.height, 848);
    assert.equal(probe!.hasAlpha, item.alpha, `${item.name} alpha detection`);
  }
  // 非 PNG 与过短文件都不猜测尺寸。
  const text = join(directory, 'not-an-image.txt');
  writeFileSync(text, 'this is not a png file at all');
  assert.equal(probePngHeader(text), null);
  const truncated = join(directory, 'truncated.png');
  writeFileSync(truncated, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(probePngHeader(truncated), null);
  assert.equal(probePngHeader(join(directory, 'missing.png')), null);
  rmSync(directory, { recursive: true, force: true });
});

// --------------- 第二轮修复（计划 §6.2／§6.3／§8）：提交幂等、版本与来源引用
// 这三条覆盖第 4 轮写入但当时**只有类型检查**的代码。

test('parity-round2: 同键同内容返回同一个任务，同键不同参数被拒绝（§6.2）', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, previewRequest } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: previewRequest as never });
    const body = { ...(previewRequest as unknown as Record<string, unknown>), planHash: resolution.plan.planHash, idempotencyKey: 'r2-idem' };

    const first = createStudioHires(database, config, activityId, body as never);
    // 响应丢失后的原请求重发：必须返回同一个任务，而不是新建第二个。
    const again = createStudioHires(database, config, activityId, body as never);
    assert.equal(again.id, first.id, '同键同内容必须返回同一个任务');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_studio_jobs').get() as { n: number }).n), 1,
      '重发不得插入第二个任务');

    // 同键不同内容：沿用既有 idempotency_conflict，不允许改 seed/参数后复用原键。
    assert.throws(() => createStudioHires(database, config, activityId, { ...body, seed: 99 } as never),
      (error: { code?: string }) => error.code === 'idempotency_conflict');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_studio_jobs').get() as { n: number }).n), 1,
      '冲突请求不得插入任务');
  } finally { closeFixture(fixture); }
});

test('parity-round2: 冻结时立即为来源图片建立引用（§6.3）', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, previewRequest, artifactId } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: previewRequest as never });
    const job = createStudioHires(database, config, activityId,
      { ...previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'r2-ref' } as never);

    // 来源属于原生历史，不一定有 activity_assets 行；引用必须在冻结的同一事务里建立。
    const refs = database.connection.prepare(`SELECT COUNT(*) AS n FROM artifact_references
      WHERE artifact_id=? AND app_id='activities' AND ref_type='activity_studio_job' AND ref_id=?`)
      .get(artifactId, `studio-job:${job.id}`) as { n: number };
    assert.equal(refs.n, 1, '冻结时必须为来源图片建立 studio-job 引用');

    // 重复提交不得重复插入引用（ON CONFLICT DO NOTHING + 幂等前置返回）。
    createStudioHires(database, config, activityId,
      { ...previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'r2-ref' } as never);
    const after = database.connection.prepare(`SELECT COUNT(*) AS n FROM artifact_references
      WHERE artifact_id=? AND ref_type='activity_studio_job'`).get(artifactId) as { n: number };
    assert.equal(after.n, 1, '重复提交不得重复建立引用');
  } finally { closeFixture(fixture); }
});

test('parity-round2: 提交时版本不一致必须拒绝，且零任务插入（§6.2）', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, previewRequest } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: previewRequest as never });
    const base = previewRequest as unknown as Record<string, unknown>;
    const stale = { ...base, versions: { ...(base.versions as Record<string, unknown>), headVersion: 999 } };
    assert.throws(() => createStudioHires(database, config, activityId,
      { ...stale, planHash: resolution.plan.planHash, idempotencyKey: 'r2-ver' } as never),
      (error: { code?: string }) => error.code === 'studio_version_conflict');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_studio_jobs').get() as { n: number }).n), 0,
      '版本冲突时不得插入任务');
  } finally { closeFixture(fixture); }
});

/** 细化安全（计划 §17.1）：来源归属、缺图、缺快照与请求边界。 */
test('hires safety: source ownership, missing file and missing snapshot are rejected with exact codes', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, target, artifactId, previewRequest } = fixture;
    const preview = () => previewStudioHires({ database, config, activityId, request: previewRequest as never });

    // 来源属于当前目标：正常返回完整预览。
    const resolution = preview();
    assert.ok(Value.Check(HiresPreviewResponseSchema, resolution.preview), JSON.stringify(resolution.preview));
    assert.equal(resolution.preview.canSubmit, true, JSON.stringify(resolution.preview.issues));
    assert.equal(resolution.preview.sourceWidth, 768);
    assert.equal(resolution.preview.sourceHeight, 512);
    assert.equal(resolution.preview.outputWidth, 2000);
    assert.equal(resolution.preview.outputHeight, 1328);
    assert.equal(resolution.preview.seed, 7);
    assert.equal(resolution.preview.workflowId, 'anima-activity-hires-basic');
    assert.equal(resolution.preview.positivePrompt, '@ebora, masterpiece, 1girl, alice, long hair');
    assert.equal(resolution.preview.negativePrompt, 'score_1, score_2, bad anatomy');
    assert.equal(resolution.preview.sampler.steps, 31);
    assert.equal(resolution.preview.sampler.cfg, 5);
    assert.equal(resolution.preview.sampler.samplerName, 'er_sde');
    assert.equal(resolution.preview.sampler.denoise, 0.2);
    assert.equal(resolution.preview.loaders.unetName, 'anima_baseV10.safetensors');
    assert.equal(resolution.preview.transparencyHint?.includes('没有透明通道'), true);

    // 预览不写任何行、不创建生成任务。
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_studio_jobs').get() as { n: number }).n), 0);
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as { n: number }).n), 1);

    // 跨活动：来源不属于此活动。
    const otherActivity = fixture.activities.createActivity({ title: '另一个活动', type: '测试' }).activity;
    assert.throws(() => previewStudioHires({ database, config, activityId: otherActivity.id, request: previewRequest as never }),
      (error: Error & { code?: string }) => error.code === 'hires_source_not_owned');

    // 跨目标：同活动但属于其他目标的历史同样拒绝。
    assert.throws(() => previewStudioHires({ database, config, activityId,
      request: { ...previewRequest, target: { kind: 'beat', stageId: target.kind === 'beat' ? target.stageId : '', sceneId: 'scene-1', beatId: 'beat-missing' } } as never }),
      (error: Error & { code?: string }) => error.code === 'hires_source_not_owned');

    // 未知图片标识。
    assert.throws(() => previewStudioHires({ database, config, activityId, request: { ...previewRequest, sourceArtifactId: 'no-such-artifact' } as never }),
      (error: Error & { code?: string }) => error.code === 'hires_source_not_owned');

    // 非图片产物。
    database.connection.prepare(`INSERT INTO artifacts(id,app_id,local_path,content_type,byte_size,sha256,media_type,file_status,created_at)
      VALUES ('text-artifact','activities',?,'text/plain',3,'sha-text','text','ready','2026-01-01')`).run(fixture.sourcePath);
    assert.throws(() => previewStudioHires({ database, config, activityId, request: { ...previewRequest, sourceArtifactId: 'text-artifact' } as never }),
      (error: Error & { code?: string }) => error.code === 'hires_source_not_owned');

    // 缺快照：没有关联生成任务的历史行。
    database.connection.prepare(`INSERT INTO activity_beat_render_candidates
      (id,activity_id,stage_id,scene_id,beat_id,source_fingerprint,draft_version,status,positive_prompt,negative_prompt,created_at,auto_apply_state,artifact_id)
      VALUES ('legacy-candidate',?,?,'scene-1','beat-1','legacy',1,'succeeded','p','n','2026-01-01','ineligible',?)`)
      .run(activityId, target.kind === 'beat' ? target.stageId : '', artifactId);
    database.connection.prepare(`INSERT INTO artifacts(id,app_id,local_path,content_type,byte_size,sha256,media_type,file_status,created_at)
      VALUES ('legacy-artifact','activities',?,'image/png',10,'sha-legacy','image','ready','2026-01-01')`).run(fixture.sourcePath);
    database.connection.prepare(`INSERT INTO activity_beat_render_candidate_outputs(candidate_id,artifact_id,sort_order,created_at)
      VALUES ('legacy-candidate','legacy-artifact',0,'2026-01-01')`).run();
    assert.throws(() => previewStudioHires({ database, config, activityId, request: { ...previewRequest, sourceArtifactId: 'legacy-artifact' } as never }),
      (error: Error & { code?: string }) => error.code === 'hires_source_snapshot_unavailable');

    // 来源文件不可读。
    const missingPath = fixture.sourcePath.replace('source.png', 'moved-away.png');
    database.connection.prepare("UPDATE artifacts SET local_path=?,file_status='missing' WHERE id=?").run(missingPath, artifactId);
    assert.throws(() => preview(), (error: Error & { code?: string }) => error.code === 'hires_source_unavailable');
    database.connection.prepare("UPDATE artifacts SET local_path=?,file_status='ready' WHERE id=?").run(fixture.sourcePath, artifactId);
  } finally { closeFixture(fixture); }
});

test('hires safety: maxSize not larger than the longest side is refused instead of being sold as an upscale', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, previewRequest } = fixture;
    for (const maxSize of [512, 768]) {
      assert.throws(() => previewStudioHires({ database, config, activityId, request: { ...previewRequest, maxSize } as never }),
        (error: Error & { code?: string }) => error.code === 'hires_not_an_upscale', `maxSize ${maxSize} must not pass`);
    }
    // 恰好大于最长边时通过，并按比例计算真实尺寸。
    const resolution = previewStudioHires({ database, config, activityId, request: { ...previewRequest, maxSize: 776 } as never });
    assert.equal(resolution.preview.outputWidth, 776);
    assert.equal(resolution.preview.outputHeight, 512);
  } finally { closeFixture(fixture); }
});

test('hires safety: planHash ignores the current art style, prompt policy and latest role LoRA', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, previewRequest } = fixture;
    const before = previewStudioHires({ database, config, activityId, request: previewRequest as never }).plan.planHash;
    // 当前画风／策略／角色最新 LoRA 的变化不得进入 planHash。
    database.connection.prepare("INSERT INTO activity_image_prompt_policy_versions(workflow_id,workflow_version,revision,enabled,instructions,positive_suffix,negative_prompt,created_at,output_format,knowledge_mode) VALUES ('source-beat-flow',1,9,1,'new policy','suffix','neg','2026-01-01','prose','none')").run();
    database.connection.prepare("INSERT INTO activity_lora_policy_versions(workflow_id,workflow_version,revision,entries_json,created_at) VALUES ('source-beat-flow',1,9,'[{\"model\":\"latest-role.safetensors\",\"strength\":1,\"triggerWord\":\"x\",\"enabled\":true}]','2026-01-01')").run();
    const after = previewStudioHires({ database, config, activityId, request: previewRequest as never }).plan.planHash;
    assert.equal(after, before, 'planHash must not depend on current style/policy/latest LoRA');
    // 尺寸、denoise、seed 变化必须改变 planHash。
    assert.notEqual(previewStudioHires({ database, config, activityId, request: { ...previewRequest, denoise: 0.3 } as never }).plan.planHash, before);
    assert.notEqual(previewStudioHires({ database, config, activityId, request: { ...previewRequest, seed: 8 } as never }).plan.planHash, before);
    assert.notEqual(previewStudioHires({ database, config, activityId, request: { ...previewRequest, maxSize: 1536 } as never }).plan.planHash, before);
  } finally { closeFixture(fixture); }
});

/** 细化事务（计划 §17.1）：job/item 先落库、planHash 冲突、同 key 不重复历史。 */
test('hires transaction: job and single item are persisted first, and the plan hash is re-checked on submit', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, previewRequest } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: previewRequest as never });
    const submit = { ...previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'hires-submit-1' };
    assert.ok(Value.Check(HiresSubmitRequestSchema, submit));

    const job = createStudioHires(database, config, activityId, submit as never);
    assert.ok(Value.Check(StudioJobSchema, job));
    assert.equal(job.kind, 'render_batch');
    assert.equal(job.status, 'queued');
    assert.equal(job.input.operation, 'hires');
    assert.equal(job.planHash, resolution.plan.planHash);

    const items = listStudioItems(database, activityId, job.id);
    assert.equal(items.items.length, 1);
    assert.equal(items.items[0].state, 'waiting');
    assert.equal(items.items[0].placementState, 'not_requested');
    assert.equal(items.items[0].seed, 7);
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as { n: number }).n), 1, 'submit must not create a generation task');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_beat_render_candidates').get() as { n: number }).n), 1, 'submit must not create native history before dispatch');

    // 同 key 同请求：返回原 job。
    assert.equal(createStudioHires(database, config, activityId, submit as never).id, job.id);
    // 同 key 不同请求：409 idempotency_conflict。
    assert.throws(() => createStudioHires(database, config, activityId, { ...submit, maxSize: 1536, planHash: 'other' } as never),
      (error: Error & { code?: string }) => error.code === 'hires_plan_changed' || error.code === 'idempotency_conflict');
    // planHash 不一致：409 hires_plan_changed，且不重新随机 seed。
    assert.throws(() => createStudioHires(database, config, activityId, { ...submit, idempotencyKey: 'hires-submit-2', planHash: 'stale' } as never),
      (error: Error & { code?: string }) => error.code === 'hires_plan_changed');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_studio_jobs').get() as { n: number }).n), 1);
  } finally { closeFixture(fixture); }
});

test('hires transaction: a late native-history failure rolls the whole insertion back, and a retry never duplicates history', async () => {
  const fixture = hiresFixture();
  try {
    const { database, config, secrets, activityId, previewRequest, mock } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: previewRequest as never });
    const submit = { ...previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'hires-rollback' };
    const job = createStudioHires(database, config, activityId, submit as never);
    const candidateBefore = Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_beat_render_candidates').get() as { n: number }).n);
    const tasksBefore = Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as { n: number }).n);

    // 原生历史插入在 onInsertTask 事务内失败：任务插入必须整体回滚。
    database.connection.exec("CREATE TRIGGER reject_hires_candidate BEFORE INSERT ON activity_beat_render_candidates BEGIN SELECT RAISE(ABORT,'synthetic hires rollback'); END");
    await processStudioHires({ database, config, secrets, activityId, jobId: job.id, fetcher: mock.fetcher });
    database.connection.exec('DROP TRIGGER reject_hires_candidate');

    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as { n: number }).n), tasksBefore, 'rolled-back task must not remain');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_beat_render_candidates').get() as { n: number }).n), candidateBefore);
    assert.equal(mock.graphs.length, 0, 'no upstream graph is submitted by a failed association');
    const failed = new StudioStore(database).get(activityId, job.id)!;
    assert.equal(failed.status, 'failed', JSON.stringify(failed));
    assert.ok(failed.errorCode && failed.errorCode.length > 0, 'a failure must carry a code');
    assert.equal(listStudioItems(database, activityId, job.id).items[0].state, 'failed');
    assert.equal(listStudioItems(database, activityId, job.id).items[0].generationTaskId, null);

    // 同 key 重发查询原 job；不重复生成、不重复插入历史。
    assert.equal(createStudioHires(database, config, activityId, submit as never).id, job.id);
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_beat_render_candidates').get() as { n: number }).n), candidateBefore);
  } finally { closeFixture(fixture); }
});

/** 细化历史（计划 §17.1／§13.1）：三类原生历史都能看到细化图片，原图不变。 */
test('hires history: beat, comic_panel and media_slot each receive a native history row linked to this hires task', async () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, target, artifactId } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: fixture.previewRequest as never });
    const plan = resolution.plan;
    // 元数据读取依赖真实的 studio job／item 行，因此先创建真实的细化任务。
    const realJob = createStudioHires(database, config, activityId,
      { ...fixture.previewRequest, planHash: plan.planHash, idempotencyKey: 'history-links' } as never);
    const context = { activityId, studioJobId: realJob.id, studioItemId: listStudioItems(database, activityId, realJob.id).items[0].id, plan };
    const task = { taskId: 'hires-task-1', callId: 'hires-call-1', actualSeed: plan.seed, workflowSnapshot: { '1': { class_type: 'LoadImage', inputs: {} } }, requestHash: 'hires-request-hash' };
    // 与执行器 onInsertTask 相同的关联写入：原生历史 + studio item 反向引用。
    const link = (input: FrozenHiresPlan, value: typeof task) => {
      const native = insertHiresNativeHistory(database, { ...context, plan: input }, value);
      database.connection.prepare('UPDATE activity_studio_job_items SET native_job_id=?,candidate_id=? WHERE job_id=? AND id=?')
        .run(native.nativeJobId, native.candidateId, context.studioJobId, context.studioItemId);
      return native;
    };

    // beat：候选以 ineligible 落库，来源指纹继承原图，task_id／call_id 关联本次细化。
    const beat = link(plan, task);
    assert.ok(beat.candidateId);
    const candidate = database.connection.prepare('SELECT * FROM activity_beat_render_candidates WHERE id=?').get(beat.candidateId!)!;
    assert.equal(candidate.auto_apply_state, 'ineligible');
    assert.equal(candidate.task_id, 'hires-task-1');
    assert.equal(candidate.call_id, 'hires-call-1');
    assert.equal(candidate.source_fingerprint, fixture.sourceFingerprint, 'hires history must inherit the source fingerprint');
    const metadata = readImageOperationMetadata(database, beat.candidateId!);
    assert.deepEqual(metadata, { operation: 'hires', parentArtifactId: artifactId, studioJobId: realJob.id });

    // 细化不写回草稿：原镜头 mediaUrl 仍为空。
    const draft = fixture.activities.getDraft(activityId)!;
    assert.equal(draft.document.scenes![0].beats[0].mediaUrl, undefined);

    // comic_panel：新建 kind=render 的漫画 job，input 注明 operation=hires 与来源图。
    const { ComicStore } = await import('./activities/comic-store.js');
    const comics = new ComicStore(database);
    const comicDraft = comics.createComicDraft(activityId, fixture.activities.getActivity(activityId)!.currentContentRevisionId!);
    const panelId = 'panel-1';
    comics.saveComicDraft(activityId, comicDraft.draftVersion, { ...comicDraft.document,
      pages: [{ id: 'page-1', title: '第一页', template: 'single', panelIds: [panelId] }],
      panels: [{
      id: panelId, source: { stageId: target.kind === 'beat' ? target.stageId : '', sceneId: 'scene-1', beatIds: ['beat-1'] }, actorIds: ['a'],
      shotSize: 'medium', visualDescription: '观察结晶', composition: '居中', textSafeArea: 'none', selectedImage: null,
      crop: { focalX: 0.5, focalY: 0.5, zoom: 1 }, bubbles: [], presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {},
    }] });
    const comicPlan: FrozenHiresPlan = { ...plan, target: { kind: 'comic_panel', panelId },
      targetContext: { kind: 'comic_panel', panelId, contentRevisionId: fixture.activities.getActivity(activityId)!.currentContentRevisionId!, sourceRenderJobId: 'source-comic-job' } };
    const comic = link(comicPlan, { ...task, taskId: 'hires-task-comic' });
    const comicRow = database.connection.prepare('SELECT * FROM activity_comic_jobs WHERE id=?').get(comic.nativeJobId)!;
    assert.equal(comicRow.kind, 'render');
    assert.equal(comicRow.panel_id, panelId);
    assert.equal(comicRow.generation_task_id, 'hires-task-comic');
    assert.equal(JSON.parse(String(comicRow.input_json)).operation, 'hires');
    assert.equal(JSON.parse(String(comicRow.input_json)).sourceArtifactId, artifactId);
    // 细化漫画历史不会被漫画恢复流程重新执行（只挑选 queued 且已关联任务的渲染行）。
    assert.equal(comicRow.status, 'running');
    assert.equal(readImageOperationMetadata(database, comic.nativeJobId)?.operation, 'hires');

    // media_slot：复用来源 attempt 的配方，登记 parent_attempt_ids 与 media_job_link。
    const slotId = 'slot-1';
    // activity_media_job_links.task_id 外键指向真实生成任务，这里补一行以模拟已派发的细化任务。
    database.connection.prepare(`INSERT INTO generation_tasks(id,app_id,engine_id,workflow_id,workflow_version,purpose,idempotency_key,request_hash,request_params_json,
      workflow_snapshot_json,actual_seed,status,upstream_may_continue,cancellation_scope,created_at,updated_at,priority,progress_json)
      VALUES ('hires-task-media','activities','hires-engine','anima-activity-hires-basic',1,'activity_image_upscale','hires-media-key','hires-media-hash','{}','{}',7,'queued',0,'none','2026-01-01','2026-01-01','normal','{}')`).run();
    database.connection.prepare(`INSERT INTO activity_prompt_recipes(id,activity_id,slot_id,slot_fingerprint,content_revision_id,image_config_revision_id,source_refs_json,recipe_hash,references_json,blocks_json,created_at)
      VALUES ('recipe-1',?,?,'slot-fp','rev','img','[]','recipe-hash','[]','[]','2026-01-01')`).run(activityId, slotId);
    database.connection.prepare(`INSERT INTO activity_prompt_compilations(id,recipe_id,activity_id,compiler_version,template_id,template_version,channels_json,effective_params_json,execution_plan_hash,created_at)
      VALUES ('compilation-1','recipe-1',?,'v1','template-1','v1','{}','{}','plan-hash','2026-01-01')`).run(activityId);
    database.connection.prepare(`INSERT INTO activity_image_attempts(id,activity_id,base_content_revision_id,image_config_revision_id,slot_id,slot_fingerprint,
      recipe_id,compilation_id,recipe_hash,execution_plan_hash,task_id,status,actual_seed,parent_attempt_ids_json,idempotency_key,business_request_hash,created_at,updated_at)
      VALUES ('source-attempt-1',?,'rev','img',?,'slot-fp','recipe-1','compilation-1','recipe-hash','plan-hash','source-task-1','succeeded',4242,'[]','source-attempt-key','hash','2026-01-01','2026-01-01')`).run(activityId, slotId);
    const mediaPlan: FrozenHiresPlan = { ...plan, target: { kind: 'media_slot', slotId },
      targetContext: { kind: 'media_slot', slotId, sourceAttemptId: 'source-attempt-1', recipeId: 'recipe-1', compilationId: 'compilation-1',
        recipeHash: 'recipe-hash', baseContentRevisionId: 'rev', imageConfigRevisionId: 'img', slotFingerprint: 'slot-fp', executionPlanHash: 'plan-hash' } };
    const media = link(mediaPlan, { ...task, taskId: 'hires-task-media' });
    assert.ok(media.attemptId);
    const attempt = database.connection.prepare('SELECT * FROM activity_image_attempts WHERE id=?').get(media.attemptId!)!;
    assert.equal(attempt.slot_id, slotId);
    assert.equal(attempt.recipe_id, 'recipe-1');
    assert.deepEqual(JSON.parse(String(attempt.parent_attempt_ids_json)), ['source-attempt-1']);
    assert.equal(attempt.task_id, 'hires-task-media');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_image_execution_snapshots WHERE attempt_id=?').get(media.attemptId!) as { n: number }).n), 1);
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_media_job_links WHERE attempt_id=?').get(media.attemptId!) as { n: number }).n), 1);
    assert.equal(readImageOperationMetadata(database, media.attemptId!)?.operation, 'hires');

    // 原图 sha256 与文件内容都不变。
    const after = database.connection.prepare('SELECT sha256 FROM artifacts WHERE id=?').get(artifactId) as { sha256: string };
    assert.equal(after.sha256, fixture.sourceSha256);
    assert.equal(createHash('sha256').update(readFileSync(fixture.sourcePath)).digest('hex'), fixture.sourceSha256);
  } finally { closeFixture(fixture); }
});

test('hires history: stale source description is warned about and the source fingerprint is inherited, never refreshed', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, target } = fixture;
    const draft = fixture.activities.getDraft(activityId)!;
    fixture.activities.updateDraft(activityId, draft.draftVersion, {
      ...draft.document,
      scenes: draft.document.scenes!.map((scene) => ({ ...scene, beats: scene.beats.map((beat) => ({ ...beat, action: '完全不同的动作' })) })),
    });
    const resolution = previewStudioHires({ database, config, activityId, request: fixture.previewRequest as never });
    assert.equal(resolution.preview.sourceChanged, true);
    assert.ok(resolution.preview.issues.some((issue) => issue.includes('来源描述已变化')), JSON.stringify(resolution.preview.issues));
    assert.equal(resolution.plan.sourceFingerprint, fixture.sourceFingerprint, 'hires must inherit the original source fingerprint');
    assert.equal(resolution.plan.targetContext.kind, 'beat');
    assert.equal(target.kind, 'beat');
  } finally { closeFixture(fixture); }
});

/** 细化恢复（计划 §17.1／§13.3）：重启只冻结、人工 resume 释放原任务、不重投。 */
test('hires recovery: restart only freezes the queued snapshot and an explicit resume releases the same task', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, previewRequest } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: previewRequest as never });
    const job = createStudioHires(database, config, activityId, { ...previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'hires-recovery' } as never);
    const store = new StudioStore(database);
    const item = listStudioItems(database, activityId, job.id).items[0];

    // 服务重启：只允许明确确认未发出的工作后继续；不自动派发。
    recoverStudioJobs(database, config, { startup: true });
    const recovered = store.get(activityId, job.id)!;
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.errorCode, 'studio_process_interrupted');
    assert.equal(recovered.input.recovery != null, true);
    assert.equal(recovered.result, null, 'recovery must not invent a result');

    // resume 必须按 operation 分派，不能调用 resolveStudioBatchTarget 重算普通文生图计划；
    // 未确认原计划哈希时拒绝恢复（细化没有批次计划可重算）。
    assert.throws(() => resumeStudioJob(database, config, activityId, job.id,
      { expectedJobRevision: recovered.revision, itemIds: [item.id] }),
      (error: Error & { code?: string }) => error.code === 'studio_plan_changed', 'no planHash confirmation must be refused');
    const resumed = resumeStudioJob(database, config, activityId, job.id,
      { expectedJobRevision: recovered.revision, planHash: resolution.plan.planHash, itemIds: [item.id] });
    assert.equal(resumed.status, 'queued');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as { n: number }).n), 1, 'resume must not submit a new image task');

    // 已关联 queued 生成任务：冻结不自动派发，人工 resume 释放原 task，沿用原 seed。
    database.connection.prepare("UPDATE activity_studio_job_items SET state='submitted',generation_task_id='held-task',call_id='held-call' WHERE id=?").run(item.id);
    database.connection.prepare(`INSERT INTO generation_tasks(id,app_id,engine_id,workflow_id,workflow_version,purpose,idempotency_key,request_hash,request_params_json,
      workflow_snapshot_json,actual_seed,status,upstream_may_continue,cancellation_scope,created_at,updated_at,priority,progress_json,error_code,error_message)
      VALUES ('held-task','activities','hires-engine','anima-activity-hires-basic',1,'activity_image_upscale','held-key','held-hash','{}','{}',7,'queued',0,'none','2026-01-01','2026-01-01','normal','{}','studio_resume_required','工作室恢复等待确认，未继续提交。')`).run();
    database.connection.prepare("UPDATE activity_studio_jobs SET status='interrupted',revision=revision+1 WHERE id=?").run(job.id);
    recoverStudioJobs(database, config, { startup: true, jobId: job.id });
    const held = database.connection.prepare('SELECT status,error_code FROM generation_tasks WHERE id=?').get('held-task') as { status: string; error_code: string };
    assert.equal(held.status, 'queued', 'queued proves no upstream submission; recovery must not cancel it');
    assert.equal(held.error_code, 'studio_resume_required');
    const beforeResume = store.get(activityId, job.id)!;
    resumeStudioJob(database, config, activityId, job.id, { expectedJobRevision: beforeResume.revision, planHash: resolution.plan.planHash, itemIds: [item.id] });
    const released = database.connection.prepare('SELECT status,error_code,actual_seed FROM generation_tasks WHERE id=?').get('held-task') as { status: string; error_code: string | null; actual_seed: number };
    assert.equal(released.status, 'queued');
    assert.equal(released.error_code, null, 'resume releases the held task without resubmitting');
    assert.equal(Number(released.actual_seed), 7, 'the original seed is preserved');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as { n: number }).n), 2, 'resume never inserts another task');
  } finally { closeFixture(fixture); }
});

test('hires recovery: an unknown upstream keeps the association and refuses ordinary retry', () => {
  const fixture = hiresFixture();
  try {
    const { database, config, activityId, previewRequest } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: previewRequest as never });
    const job = createStudioHires(database, config, activityId, { ...previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'hires-unknown' } as never);
    const store = new StudioStore(database), item = listStudioItems(database, activityId, job.id).items[0];
    database.connection.prepare("UPDATE activity_studio_job_items SET state='unknown',generation_task_id='unknown-task' WHERE id=?").run(item.id);
    database.connection.prepare(`INSERT INTO generation_tasks(id,app_id,engine_id,workflow_id,workflow_version,purpose,idempotency_key,request_hash,request_params_json,
      workflow_snapshot_json,actual_seed,status,provider_task_id,upstream_may_continue,cancellation_scope,created_at,updated_at,priority,progress_json)
      VALUES ('unknown-task','activities','hires-engine','anima-activity-hires-basic',1,'activity_image_upscale','unknown-key','unknown-hash','{}','{}',7,'running','upstream-1',1,'none','2026-01-01','2026-01-01','normal','{}')`).run();
    database.connection.prepare("UPDATE activity_studio_jobs SET status='unknown',revision=revision+1 WHERE id=?").run(job.id);
    const current = store.get(activityId, job.id)!;
    assert.throws(() => resumeStudioJob(database, config, activityId, job.id,
      { expectedJobRevision: current.revision, planHash: resolution.plan.planHash, itemIds: [item.id] }),
      (error: Error & { code?: string }) => error.code === 'studio_resume_unsafe');
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as { n: number }).n), 2);
    // 停止：unknown 已是终态，停止请求不改变状态，也不全局 interrupt 已提交任务。
    const stopped = store.stop(activityId, job.id, store.get(activityId, job.id)!.revision);
    assert.equal(stopped.status, 'unknown');
    assert.equal(stopped.stopRequested, false, 'a terminal job is returned unchanged instead of being re-marked');
    const upstream = database.connection.prepare('SELECT status,upstream_may_continue FROM generation_tasks WHERE id=?').get('unknown-task') as { status: string; upstream_may_continue: number };
    assert.equal(upstream.status, 'running', 'stop must not interrupt an already submitted upstream task');
    assert.equal(Number(upstream.upstream_may_continue), 1);
  } finally { closeFixture(fixture); }
});

/** 透明图片（计划 §17.1／§12.2）：mask 方向、白底、原图不变、尺寸预期。 */
test('hires transparency: the alpha mask is the LoadImage inverse alpha and the composite keeps opaque pixels', () => {
  const fixture = hiresFixture({ width: 1200, height: 800, colorType: 6 });
  try {
    const { database, config, activityId } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: fixture.previewRequest as never });
    assert.equal(resolution.preview.transparencyHint?.includes('透明'), true);
    assert.equal(resolution.preview.transparencyHint?.includes('不会重新抠图'), true);
    assert.equal(resolution.plan.outputWidth, 2000);
    assert.equal(resolution.plan.outputHeight, 1328);

    // 生成的图形方案：白底合成的 mask 是 LoadImage 反 alpha **反转后**的结果（计划 §12.2），
    // 并保持 crop=disabled。直接用 LoadImage 的 mask 输出会把不透明图整张抹成白底。
    const hiresBundle = buildParityHiresWorkflow();
    const definition = hiresBundle.definition as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
    const composite = definition['3'];
    assert.equal(composite.class_type, 'ImageCompositeMasked');
    assert.equal(definition['14'].class_type, 'InvertMask');
    assert.deepEqual(definition['14'].inputs!.mask, ['1', 1], 'InvertMask takes the LoadImage mask output (inverse alpha)');
    assert.deepEqual(composite.inputs!.mask, ['14', 0], 'the composite must use the inverted mask, not the raw inverse alpha');
    assert.deepEqual(composite.inputs!.destination, ['2', 0], 'destination must be the white EmptyImage');
    assert.deepEqual(composite.inputs!.source, ['1', 0]);
    assert.equal(composite.inputs!.paste, false);
    assert.equal(definition['2'].class_type, 'EmptyImage');
    assert.equal(definition['2'].inputs!.color, 16777215, 'white background');
    // 白底必须与来源 1:1，否则来源只覆盖左上角、其余留白再被放大成白边图（真实实例上出现过，见 R7）。
    assert.deepEqual(hiresBundle.nodeBindings.sourceWidth, ['2', 'inputs', 'width']);
    assert.deepEqual(hiresBundle.nodeBindings.sourceHeight, ['2', 'inputs', 'height']);
    const scale = definition['4'];
    assert.equal(scale.class_type, 'ImageScale');
    assert.equal(scale.inputs!.upscale_method, 'lanczos');
    assert.equal(scale.inputs!.crop, 'disabled');
    // 不透明图必须保留原像素：反 alpha 为 0，反转后为 1，合成取 source；
    // 透明处反 alpha 为 1，反转后为 0，合成取白底。方向反了就会得到纯白图。
    assert.deepEqual(definition['1'].inputs!.image, '');
    assert.equal(definition['1'].class_type, 'LoadImage');

    // 原图 sha256 与文件内容不变。
    const after = database.connection.prepare('SELECT sha256 FROM artifacts WHERE id=?').get(fixture.artifactId) as { sha256: string };
    assert.equal(after.sha256, fixture.sourceSha256);
    assert.equal(statSync(fixture.sourcePath).size, readFileSync(fixture.sourcePath).length);
    assert.equal(createHash('sha256').update(readFileSync(fixture.sourcePath)).digest('hex'), fixture.sourceSha256);
  } finally { closeFixture(fixture); }
});

/** 引擎解析（计划 §17.1）：内部 engineId 透传、非内部被拒、预设/引擎冲突被拒、预览与实际一致。 */
test('hires engine resolution: internal engineId passes through, non-internal and preset conflicts are refused', async () => {
  const { createGenerationTask } = await import('./generation/execution.js');
  const fixture = hiresFixture();
  try {
    const { database, config, secrets, activityId, mock } = fixture;
    const inputs = { positivePrompt: 'p', negativePrompt: 'n', width: 2000, height: 1328, seed: 7, steps: 31, cfg: 5,
      sampler_name: 'er_sde', scheduler: 'beta', denoise: 0.2, unet_name: 'anima_baseV10.safetensors',
      clip_name: 'anima_baseV10_txt.safetensors', vae_name: 'qwen_image_vae.safetensors' };
    const inputArtifacts = [{ artifactId: fixture.artifactId, inputKey: 'init_image' }];
    // 内部 engineId 透传到任务引擎。
    const internal = await createGenerationTask(config, database, secrets, {
      appId: 'activities', purpose: 'activity_image_upscale', workflowId: 'anima-activity-hires-basic', workflowVersion: fixture.hiresVersion,
      engineId: 'hires-engine', isInternal: true, inputs, inputArtifacts, seed: 7, idempotencyKey: 'engine-internal',
    }, mock.fetcher);
    assert.equal(internal.engineId, 'hires-engine');
    // 非内部指定 engineId 被拒。
    await assert.rejects(() => createGenerationTask(config, database, secrets, {
      appId: 'activities', purpose: 'activity_image_upscale', workflowId: 'anima-activity-hires-basic', workflowVersion: fixture.hiresVersion,
      engineId: 'hires-engine', isInternal: false, inputs, inputArtifacts, seed: 7, idempotencyKey: 'engine-external',
    }, mock.fetcher), (error: Error & { code?: string }) => error.code === 'generation_engine_override_forbidden');
    // 预设与引擎冲突被拒。
    database.connection.prepare(`INSERT INTO generation_presets(id,name,description,app_id,purpose,workflow_id,workflow_version,engine_id,values_json,enabled,revision,created_at,updated_at)
      VALUES ('conflicting-preset','冲突预设','','activities','activity_image_upscale','anima-activity-hires-basic',?, 'hires-engine','{}',1,1,'2026-01-01','2026-01-01')`).run(fixture.hiresVersion);
    database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
      VALUES ('other-engine','其它 ComfyUI','comfyui','http://127.0.0.1:8288',1,1,'2026-01-01','2026-01-01')`).run();
    await assert.rejects(() => createGenerationTask(config, database, secrets, {
      appId: 'activities', purpose: 'activity_image_upscale', workflowId: 'anima-activity-hires-basic', workflowVersion: fixture.hiresVersion,
      engineId: 'other-engine', presetId: 'conflicting-preset', isInternal: true, inputs, inputArtifacts, seed: 7, idempotencyKey: 'engine-conflict',
    }, mock.fetcher), (error: Error & { code?: string }) => error.code === 'generation_engine_preset_conflict');
    void activityId;
  } finally { closeFixture(fixture); }
});

test('hires engine resolution: preview engine equals the engine finally recorded on the dispatched task', async () => {
  const fixture = hiresFixture();
  try {
    const { database, config, secrets, activityId, mock } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: fixture.previewRequest as never });
    assert.equal(resolution.preview.engineId, 'hires-engine');
    const job = createStudioHires(database, config, activityId,
      { ...fixture.previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'engine-parity' } as never);
    await processStudioHires({ database, config, secrets, activityId, jobId: job.id, fetcher: mock.fetcher });
    const item = listStudioItems(database, activityId, job.id).items[0];
    assert.ok(item.generationTaskId, JSON.stringify(listStudioItems(database, activityId, job.id)));
    const task = database.connection.prepare('SELECT engine_id,workflow_id,workflow_version,purpose,actual_seed,workflow_snapshot_json,request_params_json FROM generation_tasks WHERE id=?')
      .get(item.generationTaskId!) as { engine_id: string; workflow_id: string; workflow_version: number; purpose: string; actual_seed: number; workflow_snapshot_json: string; request_params_json: string };
    assert.equal(task.engine_id, resolution.preview.engineId, 'preview engine must equal the task engine');
    assert.equal(task.workflow_id, resolution.preview.workflowId);
    assert.equal(Number(task.workflow_version), resolution.preview.workflowVersion);
    assert.equal(task.purpose, 'activity_image_upscale');
    assert.equal(task.actual_seed ? Number(task.actual_seed) : null, resolution.preview.seed);
    const params = JSON.parse(task.request_params_json) as { inputArtifacts: Array<{ artifactId: string; inputKey: string }> };
    assert.deepEqual(params.inputArtifacts, [{ artifactId: fixture.artifactId, inputKey: 'init_image' }]);
    // 提交的图必须是冻结的原图加载器与采样参数，正负提示词直接绑定编码器。
    const graph = JSON.parse(task.workflow_snapshot_json) as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
    const submitted = mock.graphs.at(-1)! as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
    // 任务快照与实际上游图共享同一冻结定义；上传后的输入文件名只出现在上游图里。
    assert.equal(submitted['1'].class_type, 'LoadImage');
    assert.equal(typeof submitted['1'].inputs!.image, 'string');
    assert.equal(graph['1'].class_type, 'LoadImage');
    assert.equal(graph['1'].inputs!.image, '');
    assert.equal(submitted['6'].inputs!.text, resolution.preview.positivePrompt);
    assert.equal(submitted['7'].inputs!.text, resolution.preview.negativePrompt);
    assert.equal(Number(submitted['11'].inputs!.steps), 31);
    assert.equal(Number(submitted['11'].inputs!.cfg), 5);
    assert.equal(submitted['11'].inputs!.sampler_name, 'er_sde');
    assert.equal(submitted['11'].inputs!.scheduler, 'beta');
    assert.equal(Number(submitted['11'].inputs!.denoise), 0.2);
    assert.equal(Number(submitted['11'].inputs!.seed), 7);
    assert.equal(submitted['10'].inputs!.unet_name, 'anima_baseV10.safetensors');
    assert.equal(submitted['4'].inputs!.width, 2000);
    assert.equal(submitted['4'].inputs!.height, 1328);
    assert.equal(submitted['4'].inputs!.upscale_method, 'lanczos');
    // 普通文本 apply 不能作用于细化任务。
    assert.equal(job.kind, 'render_batch');
    assert.equal(job.input.batch, undefined);
    // 细化任务不进入图片备用预设入口。
    const { listStudioImageFallbackOptions } = await import('./activities/studio-image-fallback.js');
    const options = listStudioImageFallbackOptions(database, activityId, job.id);
    assert.equal(options.allowed, false);
    assert.ok(options.reason.includes('批量绘制任务'));
  } finally { closeFixture(fixture); }
});

test('hires dispatch never appends a quality suffix and never reads the current art style', async () => {
  const fixture = hiresFixture();
  try {
    const { database, config, secrets, activityId, mock } = fixture;
    // 写入一个会污染提示词的当前画风：细化必须完全忽略它。
    database.connection.prepare(`INSERT INTO activity_reusable_presets(id,kind,name,version,schema_version,payload_json,created_at,updated_at)
      VALUES ('style-1','production_preset','污染画风',1,1,'{"schemaKind":"activity_art_style_v1","positiveStylePrompt":"POLLUTED_STYLE_TOKEN","negativePrompt":"POLLUTED_NEGATIVE","renderProfiles":{},"defaultQuality":"final","defaultCanvas":{"width":768,"height":512}}','2026-01-01','2026-01-01')`).run();
    const resolution = previewStudioHires({ database, config, activityId, request: fixture.previewRequest as never });
    const job = createStudioHires(database, config, activityId,
      { ...fixture.previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'no-suffix' } as never);
    await processStudioHires({ database, config, secrets, activityId, jobId: job.id, fetcher: mock.fetcher });
    const submitted = mock.graphs.at(-1)! as Record<string, { inputs?: Record<string, unknown> }>;
    assert.equal(submitted['6'].inputs!.text, '@ebora, masterpiece, 1girl, alice, long hair');
    assert.equal(String(submitted['6'].inputs!.text).includes('POLLUTED_STYLE_TOKEN'), false);
    assert.equal(submitted['7'].inputs!.text, 'score_1, score_2, bad anatomy');
    assert.equal(String(submitted['7'].inputs!.text).includes('POLLUTED_NEGATIVE'), false);
  } finally { closeFixture(fixture); }
});

test('hires call log records the business event, the inherited configuration and a studio return link', async () => {
  const fixture = hiresFixture();
  try {
    const { database, config, secrets, activityId, mock } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: fixture.previewRequest as never });
    const job = createStudioHires(database, config, activityId,
      { ...fixture.previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'call-log' } as never);
    await processStudioHires({ database, config, secrets, activityId, jobId: job.id, fetcher: mock.fetcher });
    const call = database.connection.prepare("SELECT * FROM ai_call_records WHERE business_event='activity.image.hires'").get() as
      Record<string, unknown> | undefined;
    assert.ok(call, 'activity.image.hires call must be recorded');
    assert.equal(call!.object_type, 'activity-studio-job');
    assert.equal(call!.object_id, job.id);
    assert.equal(call!.trace_id, job.traceId);
    const sourceUrl = String(call!.source_url);
    assert.ok(sourceUrl.startsWith(`/apps/activities/${activityId}?`), sourceUrl);
    assert.ok(sourceUrl.includes(`studioJobId=${job.id}`), sourceUrl);
    assert.equal(sourceUrl.includes('http://127.0.0.1:8188'), false, 'the business return link must not be replaced by the upstream URL');
    const parameters = JSON.parse(String(call!.parameters_json)) as Record<string, unknown>;
    assert.equal(parameters.purpose, 'activity_image_upscale');
    assert.equal(parameters.seed, 7);
    const visual = parameters.visualConfiguration as Record<string, unknown>;
    assert.equal(visual.operation, 'hires');
    assert.equal(visual.sourceArtifactId, fixture.artifactId);
    assert.equal(visual.sourceTaskId, fixture.sourceTaskId);
    assert.equal(visual.sourceFingerprint, fixture.sourceFingerprint);
    assert.equal(visual.maxSize, 2000);
    assert.equal(visual.outputWidth, 2000);
    assert.equal(visual.outputHeight, 1328);
    assert.equal(visual.denoise, 0.2);
    assert.equal(visual.engineId, 'hires-engine');
    const inherited = visual.inherited as { loaders: Record<string, unknown>; sampler: Record<string, unknown>; loras: unknown[] };
    assert.equal(inherited.loaders.unet, 'anima_baseV10.safetensors');
    assert.equal(inherited.sampler.steps, 31);
    assert.deepEqual(inherited.loras, []);
    // 日志不保存 base64 或图片二进制。
    assert.equal(String(call!.request_snapshot_json).includes('base64'), false);
  } finally { closeFixture(fixture); }
});

test('parity-round2: 预览路由拒绝陈旧的请求版本（§6.2 的请求边界）', async () => {
  // 第 16 轮把版本校验从 previewStudioHires() 移到路由层，此处是该决定的**唯一**覆盖。
  // 规划函数本身必须保持宽松（否则会挡掉「来源描述已变化」的警告），
  // 因此校验是否真的生效，只能在 HTTP 边界上验证。
  const fixture = hiresFixture();
  let close: (() => Promise<void>) | null = null;
  try {
    const { app, headers, url, close: closeApp } = await hiresService(fixture);
    close = closeApp;
    const base = fixture.previewRequest as unknown as Record<string, unknown>;
    const stale = { ...base, versions: { ...(base.versions as Record<string, unknown>), headVersion: 999 } };

    const rejected = await app.inject({ method: 'POST', url: `${url}/preview`, headers, payload: stale });
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.equal((rejected.json() as { error?: string }).error, 'studio_version_conflict');

    // 反证：版本正确时同一条路由必须成功——说明 409 来自版本校验，而不是请求本身有别的毛病。
    const ok = await app.inject({ method: 'POST', url: `${url}/preview`, headers, payload: fixture.previewRequest });
    assert.equal(ok.statusCode, 200, ok.body);
  } finally { if (close) await close(); closeFixture(fixture); }
});

test('hires preview and submit HTTP routes are admin-only and reject unknown fields', async () => {
  const fixture = hiresFixture();
  let close: (() => Promise<void>) | null = null;
  try {
    const { app, headers, url, close: closeApp } = await hiresService(fixture);
    close = closeApp;
    const unauthenticated = await app.inject({ method: 'POST', url: `${url}/preview`, payload: fixture.previewRequest });
    assert.equal(unauthenticated.statusCode, 401);
    const bad = await app.inject({ method: 'POST', url: `${url}/preview`, headers, payload: { ...fixture.previewRequest, path: 'C:/secret.png' } });
    assert.equal(bad.statusCode, 400);
    const ok = await app.inject({ method: 'POST', url: `${url}/preview`, headers, payload: fixture.previewRequest });
    assert.equal(ok.statusCode, 200, ok.body);
    const preview = ok.json() as HiresPreviewResponse;
    assert.ok(Value.Check(HiresPreviewResponseSchema, preview), JSON.stringify(preview));
    assert.equal(preview.canSubmit, true, JSON.stringify(preview.issues));
    const submit = await app.inject({ method: 'POST', url, headers,
      payload: { ...fixture.previewRequest, planHash: preview.planHash, idempotencyKey: 'http-hires' } });
    assert.equal(submit.statusCode, 202, submit.body);
    const job = submit.json() as StudioJob;
    assert.ok(Value.Check(StudioJobSchema, job));
    // 轮询继续使用既有 /studio-jobs/:jobId 系列。
    const polled = await app.inject({ method: 'GET', url: `/api/v1/admin/activities/${fixture.activityId}/studio-jobs/${job.id}`, headers });
    assert.equal(polled.statusCode, 200);
    assert.equal(polled.json().input.operation, 'hires');
    const plan = readFrozenHiresPlan(polled.json() as StudioJob);
    assert.equal(plan.operation, 'hires');
    assert.equal(plan.placement, 'history_only');
    const items = await app.inject({ method: 'GET', url: `/api/v1/admin/activities/${fixture.activityId}/studio-jobs/${job.id}/items`, headers });
    assert.equal(items.statusCode, 200);
    assert.equal(items.json().items.length, 1);
  } finally { if (close) await close(); closeFixture(fixture); }
});

test('hires source file hash mismatch and removed source block dispatch without a provider task id', async () => {
  const fixture = hiresFixture();
  try {
    const { database, config, secrets, activityId, mock } = fixture;
    const resolution = previewStudioHires({ database, config, activityId, request: fixture.previewRequest as never });
    const job = createStudioHires(database, config, activityId,
      { ...fixture.previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'hash-mismatch' } as never);
    database.connection.prepare("UPDATE artifacts SET sha256='changed-hash' WHERE id=?").run(fixture.artifactId);
    await processStudioHires({ database, config, secrets, activityId, jobId: job.id, fetcher: mock.fetcher });
    assert.equal(mock.graphs.length, 0, 'a changed source must not reach the engine');
    const failed = new StudioStore(database).get(activityId, job.id)!;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'hires_plan_changed');
    assert.equal(listStudioItems(database, activityId, job.id).items[0].generationTaskId, null);
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks').get() as { n: number }).n), 1);

    // 来源文件被删除：明确阻止，不伪造 providerTaskId。
    database.connection.prepare("UPDATE artifacts SET sha256=? WHERE id=?").run(fixture.sourceSha256, fixture.artifactId);
    unlinkSync(fixture.sourcePath);
    // 提交阶段（以及预览阶段）都必须拒绝，而不是带着缺失文件发任务。
    assert.throws(() => createStudioHires(database, config, activityId,
      { ...fixture.previewRequest, planHash: resolution.plan.planHash, idempotencyKey: 'removed-file' } as never),
      (error: Error & { code?: string }) => error.code === 'hires_source_unavailable');
    assert.equal(mock.graphs.length, 0);
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM generation_tasks WHERE provider_task_id IS NOT NULL').get() as { n: number }).n), 0);
    assert.equal(Number((database.connection.prepare('SELECT COUNT(*) AS n FROM activity_studio_jobs').get() as { n: number }).n), 1,
      'a rejected submit must not persist a second job');
  } finally { closeFixture(fixture); }
});

test('hires fixture artifacts are cleaned up between runs', () => {
  const fixture = hiresFixture();
  const directory = dirname(fixture.sourcePath);
  try { assert.ok(readFileSync(fixture.sourcePath).length > 0); }
  finally { closeFixture(fixture); rmSync(directory, { recursive: true, force: true }); }
});
