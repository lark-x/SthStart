#!/usr/bin/env node
/**
 * 只读证据采集：为一次真实的「发布全链路」产出生成 evidence.json。
 *
 * 本脚本严格只读：
 *   - node:sqlite DatabaseSync('data/sthstart.db', { readOnly: true }) 读取真实库；
 *   - 文件读取 fixture 输出目录中的 preview/run/export report 与导出产物（只取大小/布尔）；
 *   - fetch 127.0.0.1:8188/history/<promptId> 读取本机 ComfyUI 执行历史。
 * 不写真实库、不发起付费调用、不部署、不重绘、不重跑。
 *
 * 输出 evidence.json 只包含安全 ID、布尔、计数、时长，不含全文提示词/响应/密钥。
 * 取不到的上游（ComfyUI 不可达、history 缺条目）一律记为 unverified，绝不当作通过。
 *
 * 用法：
 *   node scripts/publication-production-evidence.mjs
 *   node scripts/publication-production-evidence.mjs --fixture <fixture.json|目录>
 *   node scripts/publication-production-evidence.mjs --db data/sthstart.db --comfy http://127.0.0.1:8188
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const DEFAULT_FIXTURE_ROOT = resolve('artifacts/publication-production');
const DEFAULT_DB = resolve('data/sthstart.db');
const DEFAULT_COMFY = 'http://127.0.0.1:8188';

function parseArgs(argv) {
  const out = { fixture: null, db: DEFAULT_DB, comfy: DEFAULT_COMFY };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--fixture') { out.fixture = value; i += 1; }
    else if (flag === '--db') { out.db = resolve(value); i += 1; }
    else if (flag === '--comfy') { out.comfy = String(value).replace(/\/+$/, ''); i += 1; }
  }
  return out;
}

async function resolveFixture(explicit) {
  if (explicit) {
    const target = resolve(explicit);
    if (existsSync(target) && statSync(target).isDirectory()) return join(target, 'fixture.json');
    return target;
  }
  const names = (await readdir(DEFAULT_FIXTURE_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (!names.length) throw new Error('未找到发布产出目录：' + DEFAULT_FIXTURE_ROOT);
  return join(DEFAULT_FIXTURE_ROOT, names[names.length - 1], 'fixture.json');
}

/* ---------- 只读数据库访问 ---------- */

function openReadOnly(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true });
}

function all(db, sql, ...params) { return db.prepare(sql).all(...params); }
function get(db, sql, ...params) { return db.prepare(sql).get(...params); }

function safeJson(text, fallback) {
  try { return JSON.parse(String(text)); } catch { return fallback; }
}

/* ---------- ComfyUI 工作流快照解析（对齐 generation/execution.ts 的取词逻辑） ---------- */

/**
 * 现有 execution 实现会在快照里按 KSampler 的 positive/negative 连线找到
 * CLIPTextEncode，再沿 StringConcatenate 递归拼接文本；inputs 存在多层包装，
 * 因此这里复用同一套解析，而不是只读固定节点号。
 */
function resolveTextInput(snapshot, nodeId, inputName, visited = new Set()) {
  const visitKey = nodeId + ':' + inputName;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);
  const node = snapshot ? snapshot[nodeId] : undefined;
  const value = node && node.inputs ? node.inputs[inputName] : undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') {
    const source = snapshot ? snapshot[value[0]] : undefined;
    if (source && source.class_type === 'StringConcatenate') {
      const left = resolveTextInput(snapshot, value[0], 'string_a', new Set(visited)) || '';
      const right = resolveTextInput(snapshot, value[0], 'string_b', new Set(visited)) || '';
      const delimiter = source.inputs && typeof source.inputs.delimiter === 'string' ? source.inputs.delimiter : '';
      return left + delimiter + right;
    }
  }
  return null;
}

function resolveClipText(snapshot, negative) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  for (const node of Object.values(snapshot)) {
    if (!node || typeof node !== 'object') continue;
    if (!/KSampler/.test(String(node.class_type || ''))) continue;
    const link = node.inputs ? node.inputs[negative ? 'negative' : 'positive'] : undefined;
    if (!Array.isArray(link) || typeof link[0] !== 'string') continue;
    const encoder = snapshot[link[0]];
    if (!encoder || encoder.class_type !== 'CLIPTextEncode') continue;
    const text = resolveTextInput(snapshot, link[0], 'text');
    if (text !== null) return text;
  }
  return null;
}

function resolveSampler(snapshot) {
  if (!snapshot) return null;
  for (const node of Object.values(snapshot)) {
    if (!node || typeof node !== 'object') continue;
    if (!/KSampler/.test(String(node.class_type || ''))) continue;
    const inputs = node.inputs || {};
    return {
      seed: inputs.seed != null ? inputs.seed : null,
      steps: inputs.steps != null ? inputs.steps : null,
      cfg: inputs.cfg != null ? inputs.cfg : null,
      samplerName: inputs.sampler_name != null ? inputs.sampler_name : null,
      scheduler: inputs.scheduler != null ? inputs.scheduler : null,
      denoise: inputs.denoise != null ? inputs.denoise : null,
    };
  }
  return null;
}

function resolveLatentSize(snapshot) {
  if (!snapshot) return null;
  for (const node of Object.values(snapshot)) {
    if (!node || typeof node !== 'object') continue;
    if (!/LatentImage/.test(String(node.class_type || ''))) continue;
    const inputs = node.inputs || {};
    if (inputs.width != null && inputs.height != null) return { width: inputs.width, height: inputs.height };
  }
  return null;
}

function resolveModelNames(snapshot) {
  if (!snapshot) return [];
  const names = new Set();
  for (const node of Object.values(snapshot)) {
    if (!node || typeof node !== 'object') continue;
    for (const entry of Object.entries(node.inputs || {})) {
      const key = entry[0], value = entry[1];
      if (/_name$/.test(key) && typeof value === 'string') names.add(value);
    }
  }
  return [...names].sort();
}

/* ---------- 比对工具 ---------- */

function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a === b;
}

function sameValue(a, b) {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}

function buildEvidence() {
  const report = {
    schema: 'publication-production-evidence/v1',
    generatedAt: new Date().toISOString(),
    inputs: {},
    fixture: {},
    publication: {},
    sourceChapter: {},
    approval: {},
    run: {},
    counts: {},
    tasks: [],
    imageEvidence: [],
    imageEvidenceSummary: {},
    speechEvidence: [],
    speechTotals: {},
    export: {},
    runReport: {},
    verification: { allChecksPassed: false, failures: [], unverified: [], notes: [] },
  };
  const fail = (message) => report.verification.failures.push(message);
  const unverified = (message) => report.verification.unverified.push(message);
  const note = (message) => report.verification.notes.push(message);
  return { report, fail, unverified, note };
}

async function collectImageEvidence(db, fixture, comfyBase, helpers) {
  const fail = helpers.fail, unverified = helpers.unverified;
  const run = get(db, 'SELECT id FROM publication_runs WHERE activity_id=?', fixture.activityId);
  const tasks = all(db, 'SELECT id,target_id,status,generation_task_id,call_id FROM publication_tasks WHERE kind=\'image\' AND run_id=? ORDER BY target_id', run.id);
  const evidence = [];
  for (const task of tasks) {
    const generation = get(db, 'SELECT workflow_snapshot_json,actual_seed,provider_task_id,status,retry_of,engine_id FROM generation_tasks WHERE id=?', task.generation_task_id);
    const call = get(db, 'SELECT request_snapshot_json,positive_prompt,negative_prompt,models_json,parent_id,retry_of,status,provider,workflow_id,workflow_version,duration_ms,requested_at,ended_at,artifact_ids_json FROM ai_call_records WHERE id=?', task.call_id);
    if (!generation || !call) {
      fail('image ' + task.target_id + '：缺少 generation 任务或 AI call 记录。');
      evidence.push({ shotId: task.target_id, complete: false });
      continue;
    }
    const dbSnapshot = safeJson(generation.workflow_snapshot_json, {});
    const callSnapshot = safeJson(call.request_snapshot_json, {});
    const dbSampler = resolveSampler(dbSnapshot);
    const callSampler = resolveSampler(callSnapshot);
    const dbSize = resolveLatentSize(dbSnapshot);
    const callSize = resolveLatentSize(callSnapshot);
    const item = {
      shotId: task.target_id,
      complete: true,
      publicationTaskId: task.id,
      publicationTaskStatus: task.status,
      generationTaskId: task.generation_task_id,
      generationStatus: generation.status,
      generationRetryOf: generation.retry_of || null,
      generationActualSeed: generation.actual_seed != null ? generation.actual_seed : null,
      callId: task.call_id,
      callParentId: call.parent_id || null,
      callRetryOf: call.retry_of || null,
      callStatus: call.status,
      callProvider: call.provider,
      callDurationMs: call.duration_ms != null ? call.duration_ms : null,
      callModelNames: safeJson(call.models_json, []),
      workflowId: call.workflow_id || null,
      workflowVersion: call.workflow_version != null ? call.workflow_version : null,
      engineId: generation.engine_id,
      comfyProviderTaskId: generation.provider_task_id || null,
      artifactIds: safeJson(call.artifact_ids_json, []),
    };
    const dbPositive = resolveClipText(dbSnapshot, false);
    const dbNegative = resolveClipText(dbSnapshot, true);
    const callPositive = resolveClipText(callSnapshot, false);
    const callNegative = resolveClipText(callSnapshot, true);
    item.promptCharCounts = {
      db: { positive: dbPositive ? dbPositive.length : null, negative: dbNegative ? dbNegative.length : null },
      call: { positive: callPositive ? callPositive.length : null, negative: callNegative ? callNegative.length : null },
    };
    item.workflowSnapshotVsCallRequest = {
      positiveTextEqual: sameText(dbPositive, callPositive),
      negativeTextEqual: sameText(dbNegative, callNegative),
      seedEqual: sameValue(dbSampler && dbSampler.seed, callSampler && callSampler.seed),
      stepsEqual: sameValue(dbSampler && dbSampler.steps, callSampler && callSampler.steps),
      cfgEqual: sameValue(dbSampler && dbSampler.cfg, callSampler && callSampler.cfg),
      samplerNameEqual: sameValue(dbSampler && dbSampler.samplerName, callSampler && callSampler.samplerName),
      schedulerEqual: sameValue(dbSampler && dbSampler.scheduler, callSampler && callSampler.scheduler),
      sizeEqual: Boolean(dbSize && callSize && dbSize.width === callSize.width && dbSize.height === callSize.height),
      modelNamesEqual: JSON.stringify(resolveModelNames(dbSnapshot)) === JSON.stringify(resolveModelNames(callSnapshot)),
      actualSeedEqualsSamplerSeed: sameValue(generation.actual_seed, dbSampler && dbSampler.seed),
    };
    let historyGraph = null;
    try {
      const response = await fetch(comfyBase + '/history/' + encodeURIComponent(generation.provider_task_id), { signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        unverified('image ' + task.target_id + '：ComfyUI /history 返回 HTTP ' + response.status + '，上游图参数未验证。');
      } else {
        const data = await response.json();
        const entry = data ? data[generation.provider_task_id] : null;
        if (!entry || !Array.isArray(entry.prompt) || !entry.prompt[2]) {
          unverified('image ' + task.target_id + '：ComfyUI 历史缺少该 promptId 的图定义，上游图参数未验证。');
        } else {
          historyGraph = entry.prompt[2];
          item.comfyHistoryStatus = entry.status && entry.status.status_str ? entry.status.status_str : null;
        }
      }
    } catch (error) {
      unverified('image ' + task.target_id + '：无法访问 ComfyUI ' + comfyBase + '（' + (error instanceof Error ? error.message : String(error)) + '），上游图参数未验证。');
    }
    if (historyGraph) {
      const historyPositive = resolveClipText(historyGraph, false);
      const historyNegative = resolveClipText(historyGraph, true);
      const historySampler = resolveSampler(historyGraph);
      const historySize = resolveLatentSize(historyGraph);
      item.comfyHistoryFound = true;
      item.promptCharCounts.comfy = { positive: historyPositive ? historyPositive.length : null, negative: historyNegative ? historyNegative.length : null };
      item.historySampler = historySampler;
      item.historySize = historySize;
      item.historyModelNames = resolveModelNames(historyGraph);
      item.dbVsComfy = {
        positiveTextEqual: sameText(dbPositive, historyPositive),
        negativeTextEqual: sameText(dbNegative, historyNegative),
        seedEqual: sameValue(dbSampler && dbSampler.seed, historySampler && historySampler.seed),
        stepsEqual: sameValue(dbSampler && dbSampler.steps, historySampler && historySampler.steps),
        cfgEqual: sameValue(dbSampler && dbSampler.cfg, historySampler && historySampler.cfg),
        samplerNameEqual: sameValue(dbSampler && dbSampler.samplerName, historySampler && historySampler.samplerName),
        sizeEqual: Boolean(dbSize && historySize && dbSize.width === historySize.width && dbSize.height === historySize.height),
        modelNamesEqual: JSON.stringify(resolveModelNames(dbSnapshot)) === JSON.stringify(resolveModelNames(historyGraph)),
      };
      item.callVsComfy = {
        positiveTextEqual: sameText(callPositive, historyPositive),
        negativeTextEqual: sameText(callNegative, historyNegative),
        seedEqual: sameValue(callSampler && callSampler.seed, historySampler && historySampler.seed),
        stepsEqual: sameValue(callSampler && callSampler.steps, historySampler && historySampler.steps),
        cfgEqual: sameValue(callSampler && callSampler.cfg, historySampler && historySampler.cfg),
        sizeEqual: Boolean(callSize && historySize && callSize.width === historySize.width && callSize.height === historySize.height),
      };
      const checks = Object.values(item.workflowSnapshotVsCallRequest).concat(Object.values(item.dbVsComfy), Object.values(item.callVsComfy));
      item.threeWayParityOk = checks.every(Boolean);
      if (!item.threeWayParityOk) fail('image ' + task.target_id + '：DB 快照 / AI call 请求 / ComfyUI 历史在提示词、模型或采样参数上不一致。');
    } else {
      item.comfyHistoryFound = false;
      item.threeWayParityOk = null;
    }
    evidence.push(item);
  }
  return evidence;
}

function collectSpeechEvidence(db, fixture) {
  const run = get(db, 'SELECT id FROM publication_runs WHERE activity_id=?', fixture.activityId);
  const tasks = all(db, 'SELECT id,target_id,status,call_id,output_json FROM publication_tasks WHERE kind=\'speech\' AND run_id=? ORDER BY target_id', run.id);
  const evidence = [];
  let totalCharacters = 0;
  let totalDurationMs = 0;
  for (const task of tasks) {
    const call = get(db, 'SELECT id,parent_id,retry_of,status,provider,models_json,usage_json,duration_ms,requested_at,ended_at,artifact_ids_json,trace_id FROM ai_call_records WHERE id=?', task.call_id);
    const artifactId = safeJson(task.output_json, [])[0] || null;
    const artifact = artifactId ? get(db, 'SELECT id,duration_ms,byte_size,file_status FROM artifacts WHERE id=?', artifactId) : null;
    const usage = safeJson(call ? call.usage_json : '{}', {});
    const characters = Number(usage && usage.inputCharacters != null ? usage.inputCharacters : 0);
    totalCharacters += Number.isFinite(characters) ? characters : 0;
    totalDurationMs += Number(artifact && artifact.duration_ms != null ? artifact.duration_ms : 0);
    evidence.push({
      utteranceId: task.target_id,
      publicationTaskId: task.id,
      publicationTaskStatus: task.status,
      callId: task.call_id,
      callParentId: call ? call.parent_id || null : null,
      callRetryOf: call ? call.retry_of || null : null,
      callStatus: call ? call.status : null,
      provider: call ? call.provider : null,
      modelNames: safeJson(call ? call.models_json : '[]', []),
      inputCharacters: Number.isFinite(characters) ? characters : null,
      callDurationMs: call && call.duration_ms != null ? call.duration_ms : null,
      audioArtifactId: artifactId,
      audioDurationMs: artifact && artifact.duration_ms != null ? artifact.duration_ms : null,
      audioByteSize: artifact ? artifact.byte_size : null,
      audioFileStatus: artifact ? artifact.file_status : null,
    });
  }
  return { evidence, totalCharacters, totalDurationMs };
}

async function collectExportEvidence(db, fixture, outputDir, helpers) {
  const fail = helpers.fail, unverified = helpers.unverified;
  const run = get(db, 'SELECT id FROM publication_runs WHERE activity_id=?', fixture.activityId);
  const tasks = all(db, 'SELECT id,status,output_json,created_at,updated_at FROM publication_tasks WHERE kind=\'export\' AND run_id=? ORDER BY created_at', run.id);
  const latest = tasks[tasks.length - 1];
  const result = {
    exportTaskCount: tasks.length,
    succeededExportTaskCount: tasks.filter((task) => task.status === 'succeeded').length,
    tasks: tasks.map((task) => ({ id: task.id, status: task.status, artifactIds: safeJson(task.output_json, []) })),
    artifacts: {},
    filesOnDisk: {},
  };
  if (!latest) { fail('缺少 export 任务记录。'); return result; }
  const ids = safeJson(latest.output_json, []);
  const rows = ids.length
    ? all(db, 'SELECT id,media_type,content_type,byte_size,width,height,duration_ms,has_audio,fps,file_status FROM artifacts WHERE id IN (' + ids.map(() => '?').join(',') + ')', ...ids)
    : [];
  for (const row of rows) {
    result.artifacts[row.id] = {
      mediaType: row.media_type, contentType: row.content_type, byteSize: row.byte_size,
      width: row.width, height: row.height, durationMs: row.duration_ms,
      hasAudio: Boolean(row.has_audio), fps: row.fps, fileStatus: row.file_status,
    };
  }
  const disk = { zip: 'publication.zip', cover: 'cover.png', video: 'video.mp4' };
  for (const name of Object.keys(disk)) {
    const file = join(outputDir, disk[name]);
    if (!existsSync(file)) { fail('导出产物缺失：' + file); result.filesOnDisk[name] = { present: false }; continue; }
    result.filesOnDisk[name] = { present: true, byteSize: statSync(file).size };
  }
  const reportPath = join(outputDir, 'export-report.json');
  if (existsSync(reportPath)) {
    const report = safeJson(await readFile(reportPath, 'utf8'), {});
    result.reportArtifactIds = report.artifactIds || null;
    result.reportZipStructureOk = report.zipStructureOk != null ? report.zipStructureOk : null;
    result.reportZipImages = report.zipImages != null ? report.zipImages : null;
    result.reportSecretLeakCount = Array.isArray(report.secretLeaks) ? report.secretLeaks.length : null;
    if (Array.isArray(report.zipEntries)) result.zipEntriesOnRecord = report.zipEntries.length;
    if (result.reportZipStructureOk === false) fail('export-report 记录 ZIP 结构校验未通过。');
    if (report.regeneration && (report.regeneration.images || report.regeneration.speech || report.regeneration.paidModelCalls)) fail('export-report 记录导出过程仍发生了重新生成或付费调用。');
  } else {
    unverified('缺少 export-report.json，无法交叉核对 ZIP 结构与产物 ID。');
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixturePath = await resolveFixture(args.fixture);
  if (!existsSync(fixturePath)) throw new Error('找不到 fixture.json：' + fixturePath);
  const fixture = safeJson(await readFile(fixturePath, 'utf8'), null);
  if (!fixture || !fixture.activityId || !fixture.outputDir) throw new Error('fixture.json 缺少 activityId 或 outputDir。');
  const outputDir = resolve(fixture.outputDir);
  if (!existsSync(outputDir)) throw new Error('fixture 输出目录不存在：' + outputDir);
  if (!existsSync(args.db)) throw new Error('找不到数据库：' + args.db);
  const db = openReadOnly(args.db);
  const built = buildEvidence();
  const report = built.report, fail = built.fail, unverified = built.unverified;
  report.inputs = { fixturePath, databasePath: args.db, comfyBaseUrl: args.comfy, outputDir };
  report.fixture = {
    projectId: fixture.projectId || null,
    chapterId: fixture.chapterId || null,
    chapterRevisionId: fixture.chapterRevisionId || null,
    activityId: fixture.activityId,
    shotIds: Array.isArray(fixture.shotIds) ? fixture.shotIds : [],
    characters: fixture.characters || {},
  };
  const engine = get(db, 'SELECT id,base_url,kind FROM generation_engines WHERE kind=\'comfyui\' LIMIT 1');
  report.inputs.comfyEngineId = engine ? engine.id : null;
  report.inputs.comfyEngineBaseUrl = engine ? engine.base_url : null;
  try {
    const draftRow = get(db, 'SELECT draft_version,document_json,updated_at FROM publication_drafts WHERE activity_id=?', fixture.activityId);
    if (!draftRow) throw new Error('找不到该活动对应的发布草稿。');
    const document = safeJson(draftRow.document_json, {});
    const shots = Array.isArray(document.shots) ? document.shots : [];
    const sourceEntryRevisionIds = document.source && Array.isArray(document.source.entryRevisionIds) ? document.source.entryRevisionIds : [];
    const frozenRevision = get(db, 'SELECT id,entry_id,entry_kind,revision,source FROM story_entry_revisions WHERE id=?', fixture.chapterRevisionId);
    const currentChapter = get(db, 'SELECT id,kind,revision,updated_at FROM story_documents WHERE id=?', fixture.chapterId);
    report.publication = {
      activityId: fixture.activityId,
      draftVersion: draftRow.draft_version,
      sourceEntryRevisionIds,
      sourceIncludesChapterRevision: sourceEntryRevisionIds.indexOf(fixture.chapterRevisionId) >= 0,
      shotCount: shots.length,
      utteranceCount: shots.reduce((sum, shot) => sum + ((shot.utterances && shot.utterances.length) || 0), 0),
      selectedImageCount: shots.filter((shot) => shot.selectedImage && shot.selectedImage.artifactId).length,
      selectedAudioCount: shots.reduce((sum, shot) => sum + (shot.utterances || []).filter((u) => u.selectedAudioArtifactId).length, 0),
    };
    report.sourceChapter = {
      chapterId: fixture.chapterId,
      chapterRevisionId: fixture.chapterRevisionId,
      frozenRevisionNumber: frozenRevision ? Number(frozenRevision.revision) : null,
      frozenRevisionExists: Boolean(frozenRevision),
      frozenEntryKind: frozenRevision ? frozenRevision.entry_kind : null,
      currentChapterRevision: currentChapter ? Number(currentChapter.revision) : null,
      stillAtOriginalRevision: Boolean(frozenRevision && currentChapter && Number(frozenRevision.revision) === Number(currentChapter.revision)),
    };
    if (!frozenRevision) fail('来源章节版本 ' + fixture.chapterRevisionId + ' 在 story_entry_revisions 中不存在。');
    if (!report.sourceChapter.stillAtOriginalRevision) fail('来源章节已不在冻结版本的原 revision 上。');
    if (!report.publication.sourceIncludesChapterRevision) fail('草稿来源未包含 fixture 的章节版本 ID。');
    const approval = get(db, 'SELECT id,draft_version,revision_id,config_hash,image_budget,speech_budget,make_video,speech_profile_id FROM publication_approvals WHERE activity_id=? ORDER BY created_at DESC LIMIT 1', fixture.activityId);
    report.approval = approval ? {
      id: approval.id,
      draftVersion: Number(approval.draft_version),
      revisionId: approval.revision_id,
      imageBudget: Number(approval.image_budget),
      speechBudget: Number(approval.speech_budget),
      makeVideo: Boolean(approval.make_video),
      speechProfileId: approval.speech_profile_id,
    } : {};
    if (!approval) fail('找不到管理员审批记录。');
    else if (Number(approval.image_budget) !== 8 || Number(approval.speech_budget) !== 265) fail('审批额度不是 8 图 / 265 字。');
    const run = get(db, 'SELECT id,approval_id,status,images_used,speech_used,created_at,updated_at FROM publication_runs WHERE activity_id=?', fixture.activityId);
    if (!run) throw new Error('找不到发布运行记录。');
    report.run = {
      id: run.id,
      approvalId: run.approval_id,
      status: run.status,
      imagesUsed: Number(run.images_used),
      speechUsed: Number(run.speech_used),
      withinImageBudget: Number(run.images_used) <= Number(approval ? approval.image_budget : -1),
      withinSpeechBudget: Number(run.speech_used) <= Number(approval ? approval.speech_budget : -1),
    };
    if (report.run.status !== 'succeeded') fail('运行状态不是 succeeded：' + report.run.status);
    if (!report.run.withinImageBudget) fail('图片使用量超出审批额度。');
    if (!report.run.withinSpeechBudget) fail('配音字符使用量超出审批额度。');
    const allTasks = all(db, 'SELECT id,kind,target_id,status,generation_task_id,call_id FROM publication_tasks WHERE run_id=? ORDER BY kind,target_id', run.id);
    report.tasks = allTasks.map((task) => ({
      id: task.id, kind: task.kind, targetId: task.target_id, status: task.status,
      generationTaskId: task.generation_task_id || null, callId: task.call_id || null,
    }));
    const byKind = (kind) => allTasks.filter((task) => task.kind === kind);
    report.counts = {
      imageTasks: { total: byKind('image').length, succeeded: byKind('image').filter((task) => task.status === 'succeeded').length },
      speechTasks: { total: byKind('speech').length, succeeded: byKind('speech').filter((task) => task.status === 'succeeded').length },
      exportTasks: { total: byKind('export').length, succeeded: byKind('export').filter((task) => task.status === 'succeeded').length },
      imagesUsed: report.run.imagesUsed,
      speechCharactersUsed: report.run.speechUsed,
    };
    if (report.counts.imageTasks.succeeded !== 6) fail('图片任务成功数不是 6：' + report.counts.imageTasks.succeeded);
    if (report.counts.speechTasks.succeeded !== 6) fail('配音任务成功数不是 6：' + report.counts.speechTasks.succeeded);
    if (report.counts.exportTasks.succeeded < 1) fail('没有成功的 export 任务。');
    if (report.run.imagesUsed !== 6) fail('运行记录 imagesUsed 不是 6：' + report.run.imagesUsed);
    if (report.run.speechUsed !== 265) fail('运行记录 speechUsed 不是 265：' + report.run.speechUsed);
    report.imageEvidence = await collectImageEvidence(db, fixture, args.comfy, built);
    report.imageEvidenceSummary = {
      count: report.imageEvidence.length,
      comfyHistoryVerified: report.imageEvidence.filter((item) => item.comfyHistoryFound === true).length,
      allThreeWayParity: report.imageEvidence.length > 0 && report.imageEvidence.every((item) => item.threeWayParityOk === true),
    };
    const speech = collectSpeechEvidence(db, fixture);
    report.speechEvidence = speech.evidence;
    report.speechTotals = {
      count: speech.evidence.length,
      succeeded: speech.evidence.filter((item) => item.callStatus === 'succeeded').length,
      inputCharacters: speech.totalCharacters,
      audioDurationMs: speech.totalDurationMs,
    };
    if (speech.evidence.length !== 6) fail('配音任务数不是 6：' + speech.evidence.length);
    if (speech.totalCharacters !== report.run.speechUsed) fail('配音 call 字符合计（' + speech.totalCharacters + '）与运行记录 speechUsed（' + report.run.speechUsed + '）不一致。');
    report.export = await collectExportEvidence(db, fixture, outputDir, built);
    const runReportPath = join(outputDir, 'run-report.json');
    if (existsSync(runReportPath)) {
      const runReport = safeJson(await readFile(runReportPath, 'utf8'), {});
      report.runReport = {
        status: runReport.status || null,
        imagesUsed: runReport.imagesUsed != null ? runReport.imagesUsed : null,
        speechCharactersUsed: runReport.speechCharactersUsed != null ? runReport.speechCharactersUsed : null,
        automaticRetry: Boolean(runReport.regeneration && runReport.regeneration.automaticRetry),
        automaticRedraw: Boolean(runReport.regeneration && runReport.regeneration.automaticRedraw),
        failureCount: Array.isArray(runReport.failures) ? runReport.failures.length : null,
      };
      if (report.runReport.automaticRetry || report.runReport.automaticRedraw) fail('run-report 记录发生自动重试或自动重绘。');
      if (report.runReport.failureCount) fail('run-report 记录存在失败项。');
    } else {
      unverified('缺少 run-report.json，无法交叉核对运行报告。');
    }
    const video = Object.values(report.export.artifacts || {}).find((item) => item.mediaType === 'video');
    if (video) {
      report.export.videoDurationMs = video.durationMs;
      report.export.videoHasAudio = video.hasAudio;
      report.export.speechDurationSumMs = report.speechTotals.audioDurationMs;
      if (!video.hasAudio) fail('导出视频不含音轨。');
    }
  } finally {
    db.close();
  }
  report.verification.allChecksPassed = report.verification.failures.length === 0 && report.verification.unverified.length === 0;
  const evidencePath = join(outputDir, 'evidence.json');
  await writeFile(evidencePath, JSON.stringify(report, null, 2));
  const summary = {
    evidencePath,
    images: report.counts.imageTasks,
    speech: report.counts.speechTasks,
    approval: { images: report.approval.imageBudget, characters: report.approval.speechBudget },
    used: { images: report.run.imagesUsed, characters: report.run.speechUsed },
    sourceChapterStillOriginalRevision: report.sourceChapter.stillAtOriginalRevision,
    comfyHistoryVerified: report.imageEvidenceSummary.comfyHistoryVerified,
    threeWayParity: report.imageEvidenceSummary.allThreeWayParity,
    audioTotalDurationMs: report.speechTotals.audioDurationMs,
    failures: report.verification.failures,
    unverified: report.verification.unverified,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!report.verification.allChecksPassed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('publication-production-evidence 失败：' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
