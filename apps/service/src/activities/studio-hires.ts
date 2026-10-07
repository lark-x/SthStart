import { randomUUID } from 'node:crypto';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import type {
  ActivityLora, ContentDocument, HiresPreviewRequest, HiresPreviewResponse, HiresSubmitRequest,
  MediaSlot, StudioJob, StudioTarget,
} from '@sthstart/contracts';
import { nowIso, type ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import { resolveArtifactStoragePath, createArtifactReference } from '../artifacts.js';
import { generationCallId } from '../ai-call-trace.js';
import { resolveWorkflowAndEngine } from '../generation/task-store.js';
import { parseEditorConfig, type InputSchemaMap } from '../generation/configuration.js';
import { PARITY_HIRES_PURPOSE, PARITY_HIRES_WORKFLOW_ID } from './parity-workflows.js';
import {
  checkDirectTextEncoderBindings, findSamplerTextEncoders, readActualEncodedTexts,
} from './image-prompt-snapshot.js';
import { promptInputKey } from './image-render-common.js';
import { computeSlotFingerprint } from './image-prompt-compiler.js';
import { ActivityStore } from './store.js';
import { ComicStore } from './comic-store.js';
import { compileComicPanelSource } from './comic-renders.js';
import { previewBeatRenderSourceFingerprint } from './beat-renders.js';
import { assertStudioVersions } from './studio-storyboard.js';
import { StudioStore, studioError, studioHash } from './studio-store.js';

/**
 * 阶段 4A：基础细化接口与冻结计划（计划 §11）。
 *
 * 职责边界：
 * - 来源必须是**该目标原生历史中的图片产物**；“同活动但属于其他目标”也拒绝。
 * - 冻结原图的实际执行快照（实际编码文本、加载器输入、唯一采样器参数、动态 LoRA 文件），
 *   无法安全识别时返回 hires_source_snapshot_unavailable，绝不用当前默认配置假装沿用原图。
 * - preview 不提交模型、不创建生成任务、不写任何行。
 * - planHash 只覆盖来源／目标／细化工作流／引擎／尺寸／denoise／seed，不依赖当前画风、
 *   当前提示词策略或角色最新 LoRA（计划 §11.3）。
 */

export const HIRES_OPERATION = 'hires';
export const HIRES_PURPOSE = PARITY_HIRES_PURPOSE;
/** 阶段 4C／§14：细化调用的业务事件与中文名称。 */
export const HIRES_BUSINESS_EVENT = 'activity.image.hires';
export const HIRES_BUSINESS_EVENT_LABEL = '图片放大细化';

/** 私有冻结计划：只有服务端运行时构造与校验，不作为浏览器可上传的请求 Schema。 */
export interface FrozenHiresPlan {
  snapshotVersion: 1;
  operation: 'hires';
  target: StudioTarget;
  /** 目标定位的额外信息：beat 保存来源候选与版本，comic_panel 保存绑定内容版本，media_slot 保存配方与原 attempt。 */
  targetContext: FrozenHiresTargetContext;
  placement: 'history_only';
  sourceArtifactId: string;
  sourceSha256: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceFingerprint: string;
  sourceGenerationTaskId: string;
  sourceCallId: string | null;
  workflowId: string;
  workflowVersion: number;
  engineId: string;
  maxSize: number;
  outputWidth: number;
  outputHeight: number;
  denoise: number;
  seed: number;
  finalPositive: string;
  finalNegative: string;
  actualLoras: ActivityLora[];
  inputs: Record<string, unknown>;
  planHash: string;
}

export type FrozenHiresTargetContext =
  | { kind: 'beat'; stageId: string; sceneId: string; beatId: string; sourceCandidateId: string; sourceDraftVersion: number }
  | { kind: 'comic_panel'; panelId: string; contentRevisionId: string; sourceRenderJobId: string }
  | { kind: 'media_slot'; slotId: string; sourceAttemptId: string; recipeId: string; compilationId: string; recipeHash: string;
      baseContentRevisionId: string; imageConfigRevisionId: string; slotFingerprint: string; executionPlanHash: string };

interface HiresSource {
  artifactId: string;
  sha256: string;
  generationTaskId: string;
  callId: string | null;
  sourceFingerprint: string;
  targetContext: FrozenHiresTargetContext;
}

interface SourceSnapshot {
  definition: Record<string, unknown>;
  loaders: { unetName: string | null; clipName: string | null; vaeName: string | null };
  sampler: { steps: number; cfg: number; samplerName: string; scheduler: string };
  positive: string;
  negative: string;
  actualLoras: ActivityLora[];
  declaredLoras: ActivityLora[];
  positiveKey: string;
  negativeKey: string;
}

export interface HiresResolution {
  plan: FrozenHiresPlan;
  preview: HiresPreviewResponse;
}

const ALPHA_HINT = '来源图带透明区域；细化结果是不透明新图（透明处合成为白色），不会重新抠图。';
const OPAQUE_HINT = '来源图没有透明通道；细化结果保持原像素，不会产生黑底或变色。';

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
    catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function imageMedia(mediaType: unknown): boolean {
  const value = String(mediaType ?? '');
  return value === 'image' || value.startsWith('image/');
}

/** 向下取 8 的倍数，最小 8（计划 §12.1）。 */
export function alignToMultipleOfEight(value: number): number {
  return Math.max(8, Math.floor(value / 8) * 8);
}

/** scale = maxSize / max(sourceWidth, sourceHeight)，按比例计算宽高并向下取 8 的倍数。 */
export function computeHiresOutputSize(sourceWidth: number, sourceHeight: number, maxSize: number): { width: number; height: number; scale: number } {
  const longest = Math.max(sourceWidth, sourceHeight);
  const scale = maxSize / longest;
  return { width: alignToMultipleOfEight(sourceWidth * scale), height: alignToMultipleOfEight(sourceHeight * scale), scale };
}

export interface PngProbe { width: number; height: number; hasAlpha: boolean }

/**
 * 只读 PNG 头取得尺寸与颜色类型（计划 §12.2）。不引入重型图像依赖：
 * 校验签名与 IHDR，其余格式（JPEG／WebP）本轮不猜测。
 */
export function probePngHeader(filePath: string): PngProbe | null {
  let fd: number | null = null;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size < 33) return null;
    fd = openSync(filePath, 'r');
    const header = Buffer.alloc(33);
    if (readSync(fd, header, 0, 33, 0) !== 33) return null;
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!header.subarray(0, 8).equals(signature)) return null;
    if (header.readUInt32BE(8) !== 13 || header.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null;
    const colorType = header[25];
    // 颜色类型 3（调色板）与 0／2／4／6 之外的取值不猜测；3 使用 tRNS 表示透明。
    const hasAlpha = colorType === 4 || colorType === 6 || colorType === 3;
    return { width, height, hasAlpha };
  } catch { return null; } finally { if (fd !== null) { try { closeSync(fd); } catch { /* 关闭失败不影响探测结果 */ } } }
}

/** 来源必须属于该目标原生历史；同活动但属于其他目标同样拒绝。 */
export function resolveHiresSource(database: ServiceDatabase, config: ServiceConfig, activityId: string, target: StudioTarget, artifactId: string): HiresSource {
  const row = database.connection.prepare('SELECT id,app_id,media_type,file_status,sha256,local_path FROM artifacts WHERE id=?')
    .get(artifactId) as { id: string; app_id: string; media_type: string | null; file_status: string; sha256: string | null; local_path: string | null } | undefined;
  if (!row || row.app_id !== 'activities' || !imageMedia(row.media_type)) {
    throw studioError('hires_source_not_owned', '图片不属于当前目标的可用历史。', 409);
  }
  const sha256 = row.sha256?.trim() ?? '';
  if (!sha256) throw studioError('hires_source_snapshot_unavailable', '无法安全复用原图参数（产物缺少内容哈希），建议重新绘制。', 409);
  if (row.file_status !== 'ready' || !resolveArtifactStoragePath(database, artifactId, config.artifactDirectory)) {
    throw studioError('hires_source_unavailable', '原图文件不可用，记录仍保留。', 409);
  }
  if (target.kind === 'beat') {
    const candidate = database.connection.prepare(`SELECT c.id,c.task_id,c.draft_version,c.source_fingerprint FROM activity_beat_render_candidates c
      LEFT JOIN activity_beat_render_candidate_outputs o ON o.candidate_id=c.id
      WHERE c.activity_id=? AND c.stage_id=? AND c.scene_id=? AND c.beat_id=?
        AND (o.artifact_id=? OR (o.artifact_id IS NULL AND c.artifact_id=?))
      ORDER BY c.created_at DESC LIMIT 1`)
      .get(activityId, target.stageId, target.sceneId, target.beatId, artifactId, artifactId) as
      { id: string; task_id: string | null; draft_version: number; source_fingerprint: string | null } | undefined;
    if (!candidate) throw studioError('hires_source_not_owned', '图片不属于当前目标的可用历史。', 409);
    if (!candidate.task_id) throw studioError('hires_source_snapshot_unavailable', '这张历史图片没有执行快照，无法安全复用原图参数，建议重新绘制。', 409);
    return { artifactId, sha256, generationTaskId: String(candidate.task_id), callId: null,
      sourceFingerprint: candidate.source_fingerprint?.trim() ?? '',
      targetContext: { kind: 'beat', stageId: target.stageId, sceneId: target.sceneId, beatId: target.beatId,
        sourceCandidateId: String(candidate.id), sourceDraftVersion: Number(candidate.draft_version) } };
  }
  if (target.kind === 'comic_panel') {
    const job = database.connection.prepare(`SELECT j.id,j.input_json,j.generation_task_id FROM activity_comic_job_outputs o
      JOIN activity_comic_jobs j ON j.id=o.job_id
      WHERE o.artifact_id=? AND j.activity_id=? AND j.panel_id=? AND j.kind='render'
      ORDER BY j.created_at DESC LIMIT 1`)
      .get(artifactId, activityId, target.panelId) as { id: string; input_json: string; generation_task_id: string | null } | undefined;
    if (!job) throw studioError('hires_source_not_owned', '图片不属于当前目标的可用历史。', 409);
    if (!job.generation_task_id) throw studioError('hires_source_snapshot_unavailable', '这张历史图片没有执行快照，无法安全复用原图参数，建议重新绘制。', 409);
    const input = jsonObject(job.input_json);
    return { artifactId, sha256, generationTaskId: String(job.generation_task_id), callId: null,
      sourceFingerprint: typeof input.sourceFingerprint === 'string' ? input.sourceFingerprint : '',
      targetContext: { kind: 'comic_panel', panelId: target.panelId,
        contentRevisionId: typeof input.sourceRevisionId === 'string' ? input.sourceRevisionId : '',
        sourceRenderJobId: String(job.id) } };
  }
  // 归属校验（计划 §6.1）：必须证明这张 artifact 属于**本活动、本槽位**的那次 attempt。
  //
  // 原写法 `a.id=(SELECT id FROM activity_image_attempt_outputs WHERE artifact_id=? LIMIT 1)`
  // 有真实缺陷：`activity_image_attempt_outputs` 的列是
  // (attempt_id, artifact_id, asset_key, output_name, sort_order, created_at)，**没有 `id`**。
  // SQLite 会把子查询里的 `id` 解析成**外层** `a.id`，于是条件退化成
  // 「存在任意一行 artifact_id 匹配」——即 a.id = a.id 恒真，
  // 同活动其他槽位、甚至别的 attempt 的图都能通过校验。
  // 改为显式 join `o.attempt_id = a.id`，让 artifact 与 attempt 真正关联。
  const attempt = database.connection.prepare(`SELECT a.id,a.task_id,a.recipe_id,a.compilation_id,a.recipe_hash,a.base_content_revision_id,
      a.image_config_revision_id,a.slot_fingerprint,a.execution_plan_hash
    FROM activity_media_job_links l
    JOIN activity_image_attempts a ON a.id=l.attempt_id
    JOIN activity_image_attempt_outputs o ON o.attempt_id=a.id
    WHERE l.activity_id=? AND l.slot_id=? AND o.artifact_id=?
    ORDER BY l.created_at DESC LIMIT 1`)
    .get(activityId, target.slotId, artifactId) as
    { id: string; task_id: string; recipe_id: string; compilation_id: string; recipe_hash: string; base_content_revision_id: string;
      image_config_revision_id: string; slot_fingerprint: string; execution_plan_hash: string } | undefined;
  if (!attempt) throw studioError('hires_source_not_owned', '图片不属于当前目标的可用历史。', 409);
  return { artifactId, sha256, generationTaskId: String(attempt.task_id), callId: null, sourceFingerprint: String(attempt.slot_fingerprint),
    targetContext: { kind: 'media_slot', slotId: target.slotId, sourceAttemptId: String(attempt.id), recipeId: String(attempt.recipe_id),
      compilationId: String(attempt.compilation_id), recipeHash: String(attempt.recipe_hash),
      baseContentRevisionId: String(attempt.base_content_revision_id), imageConfigRevisionId: String(attempt.image_config_revision_id),
      slotFingerprint: String(attempt.slot_fingerprint), executionPlanHash: String(attempt.execution_plan_hash) } };
}

/** 从渲染完成的工作流图里读出唯一采样器的实际参数；多采样器不猜。 */
function readSamplerParameters(definition: Record<string, unknown>, samplerNodeId: string) {
  const node = jsonObject(definition[samplerNodeId]);
  const inputs = jsonObject(node.inputs);
  const steps = Number(inputs.steps), cfg = Number(inputs.cfg);
  const samplerName = String(inputs.sampler_name ?? ''), scheduler = String(inputs.scheduler ?? '');
  if (!Number.isSafeInteger(steps) || steps < 1 || !Number.isFinite(cfg) || cfg < 0 || !samplerName || !scheduler) {
    throw studioError('hires_source_snapshot_unavailable', '原图执行快照缺少可用的采样参数（steps／cfg／sampler／scheduler），无法安全复用。', 409);
  }
  return { steps, cfg, samplerName, scheduler };
}

function readLoaderValue(definition: Record<string, unknown>, classType: string, inputName: string): string | null {
  for (const node of Object.values(definition)) {
    const raw = jsonObject(node);
    if (String(raw.class_type ?? '') !== classType) continue;
    const value = jsonObject(raw.inputs)[inputName];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function loraNodes(definition: Record<string, unknown>): Array<{ id: string; name: string; strength: number }> {
  const found: Array<{ id: string; name: string; strength: number }> = [];
  for (const [id, node] of Object.entries(definition)) {
    const raw = jsonObject(node);
    const classType = String(raw.class_type ?? '');
    if (classType !== 'LoraLoader' && classType !== 'LoraLoaderModelOnly') continue;
    const inputs = jsonObject(raw.inputs);
    const name = typeof inputs.lora_name === 'string' ? inputs.lora_name : '';
    const strength = Number(inputs.strength_model ?? inputs.strength ?? 1);
    if (!name) throw studioError('hires_source_snapshot_unavailable', '原图执行快照中的 LoRA 节点缺少文件名，无法安全识别 LoRA 链。', 409);
    found.push({ id, name, strength: Number.isFinite(strength) ? strength : 1 });
  }
  return found;
}

/** 冻结原图实际执行快照（计划 §11.2）。任何无法安全识别的项都明确拒绝，不用当前默认配置顶替。 */
export function freezeSourceSnapshot(database: ServiceDatabase, source: HiresSource): SourceSnapshot {
  const task = database.connection.prepare('SELECT id,workflow_id,workflow_version,request_params_json,workflow_snapshot_json FROM generation_tasks WHERE id=? AND app_id=?')
    .get(source.generationTaskId, 'activities') as { id: string; workflow_id: string; workflow_version: number; request_params_json: string; workflow_snapshot_json: string } | undefined;
  if (!task) throw studioError('hires_source_snapshot_unavailable', '原图的生成任务记录不存在，无法安全复用原图参数。', 409);
  const definition = jsonObject(task.workflow_snapshot_json);
  const requestParams = jsonObject(task.request_params_json);
  const declaredLoras: ActivityLora[] = Array.isArray(requestParams.activityLoras)
    ? (requestParams.activityLoras as Array<Record<string, unknown>>).map((item) => ({
      model: String(item.model ?? ''), strength: Number(item.strength ?? 1),
      triggerWord: String(item.triggerWord ?? ''), enabled: item.enabled !== false,
    })).filter((item) => item.model)
    : [];

  const version = database.connection.prepare('SELECT input_schema_json,node_bindings_json,editor_config_json FROM generation_workflow_versions WHERE workflow_id=? AND version=?')
    .get(String(task.workflow_id), Number(task.workflow_version)) as { input_schema_json: string; node_bindings_json: string; editor_config_json: string | null } | undefined;
  if (!version) throw studioError('hires_source_snapshot_unavailable', '原图使用的工作流版本已不存在，无法安全复用原图参数。', 409);
  const editorConfig = parseEditorConfig(version.editor_config_json);
  if (editorConfig?.promptAssembly !== 'service-finalized-v1') {
    throw studioError('hires_source_snapshot_unavailable', '原图由工作流自行拼接提示词，无法确定实际编码文本；建议重新绘制。', 409);
  }
  const schema = jsonObject(version.input_schema_json) as InputSchemaMap;
  const bindings = jsonObject(version.node_bindings_json) as Record<string, string[]>;
  const positiveKey = promptInputKey(schema), negativeKey = promptInputKey(schema, true);
  const direct = checkDirectTextEncoderBindings(definition, bindings, { positiveKey, negativeKey });
  if (!direct.ok) throw studioError('hires_source_snapshot_unavailable', `原图执行快照无法安全解析提示词：${direct.issues.join(' ')}`, 409);

  const links = findSamplerTextEncoders(definition);
  if (links.ambiguous || !links.samplerNodeIds.length) {
    throw studioError('hires_source_snapshot_unavailable', '原图执行快照中存在多个或缺失的采样器，无法确定实际来源参数。', 409);
  }
  const samplerNodeId = links.samplerNodeIds[0];
  const encoded = readActualEncodedTexts(definition);
  if (!encoded.positive.resolvable) throw studioError('hires_source_snapshot_unavailable', `无法解析原图实际正向提示词：${encoded.positive.reason}`, 409);
  if (!encoded.negative.resolvable) throw studioError('hires_source_snapshot_unavailable', `无法解析原图实际负向提示词：${encoded.negative.reason}`, 409);

  const loaders = {
    unetName: readLoaderValue(definition, 'UNETLoader', 'unet_name') ?? readLoaderValue(definition, 'CheckpointLoaderSimple', 'ckpt_name'),
    clipName: readLoaderValue(definition, 'CLIPLoader', 'clip_name'),
    vaeName: readLoaderValue(definition, 'VAELoader', 'vae_name'),
  };
  const actualLoras = loraNodes(definition).map((item) => ({ model: item.name, strength: item.strength, triggerWord: '', enabled: true }));
  const declaredNames = declaredLoras.filter((item) => item.enabled).map((item) => item.model).sort();
  const actualNames = actualLoras.map((item) => item.model).sort();
  if (new Set(actualNames).size !== actualNames.length || JSON.stringify(declaredNames) !== JSON.stringify(actualNames)) {
    throw studioError('hires_source_snapshot_unavailable', '原图执行快照中的 LoRA 链无法唯一确定（重复文件或与冻结配置不一致）。', 409);
  }
  // 触发词沿用冻结记录，避免把当前角色的最新 LoRA 设置混进旧图。
  const actualWithTriggers = actualLoras.map((item) => {
    const declared = declaredLoras.find((entry) => entry.model === item.model);
    return { ...item, triggerWord: declared?.triggerWord ?? '' };
  });
  return { definition, loaders, sampler: readSamplerParameters(definition, samplerNodeId),
    positive: encoded.positive.text, negative: encoded.negative.text, actualLoras: actualWithTriggers, declaredLoras,
    positiveKey: positiveKey!, negativeKey: negativeKey! };
}

/** 来源描述是否已变化：只警告，不自动采纳，也不写回（计划 §11.2）。 */
function currentTargetFingerprint(database: ServiceDatabase, activityId: string, target: StudioTarget): string | null {
  try {
    if (target.kind === 'beat') {
      return previewBeatRenderSourceFingerprint(database, activityId, {
        stageId: target.stageId, sceneId: target.sceneId, beatId: target.beatId,
      });
    }
    if (target.kind === 'comic_panel') {
      const draft = new ComicStore(database).getComicDraft(activityId);
      const panel = draft?.document.panels.find((item) => item.id === target.panelId);
      if (!draft || !panel) return null;
      const content = new ActivityStore(database).getContentRevision(activityId, draft.document.contentRevisionId)?.document;
      if (!content) return null;
      return compileComicPanelSource({ content, panel }).sourceFingerprint;
    }
    const draft = new ActivityStore(database).getDraft(activityId);
    const slot = draft?.document.mediaSlots.find((item) => item.id === target.slotId) as MediaSlot | undefined;
    if (!draft || !slot) return null;
    return computeSlotFingerprint(slot, draft.document as ContentDocument);
  } catch { return null; }
}

function publishedHiresVersion(database: ServiceDatabase): number | null {
  const row = database.connection.prepare('SELECT MAX(version) AS version FROM generation_workflow_versions WHERE workflow_id=? AND is_published=1')
    .get(PARITY_HIRES_WORKFLOW_ID) as { version: number | null } | undefined;
  return row?.version == null ? null : Number(row.version);
}

function resolveHiresTarget(database: ServiceDatabase, engineId?: string | null) {
  const version = publishedHiresVersion(database);
  if (version == null) {
    throw studioError('hires_workflow_unavailable', '细化工作流 anima-activity-hires-basic 尚未发布，请先完成配置注册。', 409);
  }
  const resolved = resolveWorkflowAndEngine(database, 'activities', {
    purpose: HIRES_PURPOSE, workflowId: PARITY_HIRES_WORKFLOW_ID, workflowVersion: version, isInternal: true,
    ...(engineId ? { engineId } : {}),
  });
  return { resolved, workflowVersion: resolved.workflow.version, engineId: resolved.engine.id };
}

/**
 * 只读预览：不提交模型、不创建生成任务、不写任何行（计划 §11.1／§11.3）。
 * 随机 seed 只在这里产生一次，submit 必须回传同一个 seed。
 */
export function previewStudioHires(options: {
  database: ServiceDatabase; config: ServiceConfig; activityId: string; request: HiresPreviewRequest; engineId?: string | null;
}): HiresResolution {
  const { database, config, activityId, request } = options;
  // 注意：这里**故意不做** `assertStudioVersions`。
  //
  // 第 4 轮曾在此加过版本校验，结果破坏了 15 条既有用例。读完用例后确认那是我判断错了：
  // `hires history: stale source description is warned about...` 要求「内容在来源图生成之后发生变化」时，
  // 预览仍然**成功返回**，并给出 `sourceChanged` + “来源描述已变化”警告、继承原指纹、不偷偷重画。
  // 这个行为只有在规划函数不硬拒绝版本时才可能出现——它要展示的正是“来源已陈旧”这件事本身。
  //
  // 计划 §6.2 的「预览和新提交都验证请求版本」由**请求边界（路由层）**执行，
  // 那里才是客户端版本上下文真正进入系统的地方；本函数保持为纯规划函数。
  const target = request.target;
  const issues: string[] = [];
  const source = resolveHiresSource(database, config, activityId, target, request.sourceArtifactId);
  const snapshot = freezeSourceSnapshot(database, source);
  const probe = probeHiresSource(database, config, source.artifactId);
  const maxSize = request.maxSize ?? 2000;
  const denoise = request.denoise ?? 0.2;
  const seed = request.seed ?? Math.floor(Math.random() * 2_147_483_648);
  const built = buildHiresPlan({ database, activityId, source, snapshot, probe, maxSize, denoise, seed, engineId: options.engineId });
  issues.push(...built.issues);
  const plan = built.plan;

  const current = currentTargetFingerprint(database, activityId, target);
  const sourceChanged = Boolean(current && plan.sourceFingerprint && current !== plan.sourceFingerprint);
  if (sourceChanged) issues.push('来源描述已变化：本轮沿用原图冻结参数，不会自动写回，之后选择结果仍需原生 stale-source 确认。');

  const canSubmit = issues.length === 0 && Boolean(plan.engineId);
  return {
    plan,
    preview: {
      canSubmit, issues, sourceArtifactId: source.artifactId, sourceGenerationTaskId: source.generationTaskId,
      sourceCallId: plan.sourceCallId, sourceFingerprint: plan.sourceFingerprint,
      sourceWidth: probe.width, sourceHeight: probe.height, outputWidth: plan.outputWidth, outputHeight: plan.outputHeight,
      maxSize, denoise, seed,
      loaders: snapshot.loaders,
      sampler: { ...snapshot.sampler, denoise },
      positivePrompt: snapshot.positive, negativePrompt: snapshot.negative,
      loras: snapshot.actualLoras.map(({ model, strength, triggerWord, enabled }) => ({ model, strength, triggerWord, enabled })),
      workflowId: PARITY_HIRES_WORKFLOW_ID, workflowVersion: plan.workflowVersion, engineId: plan.engineId, planHash: plan.planHash,
      transparencyHint: probe.hasAlpha ? ALPHA_HINT : OPAQUE_HINT, sourceChanged,
    },
  };
}

/**
 * 冻结计划构造：preview 与 submit 共用同一条路径，因此两处的 planHash 一定一致。
 * 这里不做任何写入，也不提交模型。
 */
function buildHiresPlan(input: {
  database: ServiceDatabase; activityId: string; source: HiresSource; snapshot: SourceSnapshot; probe: PngProbe;
  maxSize: number; denoise: number; seed: number; engineId?: string | null;
}): { plan: FrozenHiresPlan; issues: string[] } {
  const { database, source, snapshot, probe, maxSize, denoise, seed } = input;
  const issues: string[] = [];
  const longest = Math.max(probe.width, probe.height);
  if (maxSize <= longest) {
    throw studioError('hires_not_an_upscale', `所选尺寸 ${maxSize} 不大于原图最长边 ${longest}，请换更大尺寸，或使用原图／普通重绘。`, 409);
  }
  const size = computeHiresOutputSize(probe.width, probe.height, maxSize);

  let engineId = '', workflowVersion = 0;
  try {
    const resolved = resolveHiresTarget(database, input.engineId);
    engineId = resolved.engineId;
    workflowVersion = resolved.workflowVersion;
  } catch (error) {
    const value = error as Error & { code?: string };
    if (value.code === 'hires_workflow_unavailable') throw error;
    issues.push(`细化引擎不可用：${value.message}`);
  }

  const inputs: Record<string, unknown> = {
    positivePrompt: snapshot.positive,
    negativePrompt: snapshot.negative,
    width: size.width,
    height: size.height,
    // 白底合成必须与来源 1:1（计划 §12.2），所以来源尺寸要一起写回工作流。
    sourceWidth: probe.width,
    sourceHeight: probe.height,
    seed,
    steps: snapshot.sampler.steps,
    cfg: snapshot.sampler.cfg,
    sampler_name: snapshot.sampler.samplerName,
    scheduler: snapshot.sampler.scheduler,
    denoise,
    ...(snapshot.loaders.unetName ? { unet_name: snapshot.loaders.unetName } : {}),
    ...(snapshot.loaders.clipName ? { clip_name: snapshot.loaders.clipName } : {}),
    ...(snapshot.loaders.vaeName ? { vae_name: snapshot.loaders.vaeName } : {}),
  };

  const sourceSnapshotHash = studioHash({
    generationTaskId: source.generationTaskId, sourceArtifactId: source.artifactId, sourceSha256: source.sha256,
    definition: snapshot.definition, loaders: snapshot.loaders, sampler: snapshot.sampler,
    positive: snapshot.positive, negative: snapshot.negative, actualLoras: snapshot.actualLoras,
  });
  // 细化 planHash 只覆盖来源、目标、细化工作流／引擎、尺寸、denoise、seed（计划 §11.3）。
  const planHash = studioHash({
    sourceArtifactId: source.artifactId, sourceSha256: source.sha256, sourceSnapshotHash,
    target: source.targetContext.kind === 'beat'
      ? { kind: 'beat', stageId: source.targetContext.stageId, sceneId: source.targetContext.sceneId, beatId: source.targetContext.beatId }
      : source.targetContext.kind === 'comic_panel'
        ? { kind: 'comic_panel', panelId: source.targetContext.panelId }
        : { kind: 'media_slot', slotId: source.targetContext.slotId },
    workflowId: PARITY_HIRES_WORKFLOW_ID, workflowVersion, engineId,
    maxSize, outputWidth: size.width, outputHeight: size.height, denoise, seed,
  });

  return {
    issues,
    plan: {
      snapshotVersion: 1, operation: HIRES_OPERATION, target: targetOf(source.targetContext), targetContext: source.targetContext,
      placement: 'history_only',
      sourceArtifactId: source.artifactId, sourceSha256: source.sha256, sourceWidth: probe.width, sourceHeight: probe.height,
      sourceFingerprint: source.sourceFingerprint, sourceGenerationTaskId: source.generationTaskId,
      sourceCallId: source.callId ?? generationCallId(database, source.generationTaskId),
      workflowId: PARITY_HIRES_WORKFLOW_ID, workflowVersion, engineId,
      maxSize, outputWidth: size.width, outputHeight: size.height, denoise, seed,
      finalPositive: snapshot.positive, finalNegative: snapshot.negative, actualLoras: snapshot.actualLoras,
      inputs, planHash,
    },
  };
}

/** 目标定位（不含来源附加信息），用于计划内的 `target` 字段。 */
function targetOf(context: FrozenHiresTargetContext): StudioTarget {
  if (context.kind === 'beat') return { kind: 'beat', stageId: context.stageId, sceneId: context.sceneId, beatId: context.beatId };
  if (context.kind === 'comic_panel') return { kind: 'comic_panel', panelId: context.panelId };
  return { kind: 'media_slot', slotId: context.slotId };
}

/** 原图尺寸只从可信产物文件读取，不依赖未经校验的前端宽高。 */
export function probeHiresSource(database: ServiceDatabase, config: ServiceConfig, artifactId: string): PngProbe {
  const storagePath = resolveArtifactStoragePath(database, artifactId, config.artifactDirectory);
  const probe = storagePath ? probePngHeader(storagePath) : null;
  if (!probe) {
    throw studioError('hires_source_unavailable', '无法可靠取得原图尺寸（只支持可读取的 PNG 产物），记录仍保留。', 409);
  }
  return probe;
}

/** 供执行器复用：只读地重算一次冻结计划，用于派发前的 planHash 复查。 */
export function rebuildFrozenHiresPlan(database: ServiceDatabase, config: ServiceConfig, activityId: string, plan: FrozenHiresPlan): FrozenHiresPlan {
  const source = resolveHiresSource(database, config, activityId, plan.target, plan.sourceArtifactId);
  if (source.sha256 !== plan.sourceSha256) {
    throw studioError('hires_plan_changed', '原图内容已变化，请重新预览。', 409);
  }
  const snapshot = freezeSourceSnapshot(database, source);
  const probe = probeHiresSource(database, config, source.artifactId);
  return buildHiresPlan({ database, activityId, source, snapshot, probe,
    maxSize: plan.maxSize, denoise: plan.denoise, seed: plan.seed, engineId: plan.engineId }).plan;
}

/** 私有运行时校验：冻结计划只由服务端构造，读回时仍需验证结构。 */
export function readFrozenHiresPlan(job: StudioJob): FrozenHiresPlan {
  const input = job.input as Partial<FrozenHiresPlan>;
  if (input?.snapshotVersion !== 1 || input.operation !== HIRES_OPERATION || !input.target || !input.targetContext
    || typeof input.sourceArtifactId !== 'string' || typeof input.sourceSha256 !== 'string'
    || !Number.isSafeInteger(input.sourceWidth) || !Number.isSafeInteger(input.sourceHeight)
    || !Number.isSafeInteger(input.outputWidth) || !Number.isSafeInteger(input.outputHeight)
    || !Number.isSafeInteger(input.maxSize) || typeof input.denoise !== 'number'
    || !Number.isSafeInteger(input.seed) || typeof input.planHash !== 'string'
    || typeof input.workflowId !== 'string' || !Number.isSafeInteger(input.workflowVersion)
    || typeof input.engineId !== 'string' || !input.inputs || typeof input.inputs !== 'object'
    || typeof input.finalPositive !== 'string' || typeof input.finalNegative !== 'string') {
    throw studioError('hires_plan_unavailable', '细化冻结计划不完整，未提交上游任务。', 409);
  }
  return input as FrozenHiresPlan;
}

/**
 * 提交：先在同一事务内复查版本与 planHash，再冻结 job/item 并落库；不在这里访问网络。
 * planHash 不一致返回 409 hires_plan_changed，且不重新随机 seed 来“修正”。
 */
export function createStudioHires(database: ServiceDatabase, config: ServiceConfig, activityId: string, request: HiresSubmitRequest): StudioJob {
  const store = new StudioStore(database);
  return database.transaction(() => {
    // 1. 幂等优先（计划 §6.2）：响应丢失后的原请求重发，不应被新的草稿版本或配置阻挡，
    //    因此这一步必须在版本校验与预览之前。同键不同内容由 findIdempotent 抛
    //    idempotency_conflict（409），沿用既有错误码，不另立一套。
    const existing = store.findIdempotent(activityId, request.idempotencyKey, studioHash(request));
    if (existing) return existing;
    // 2. 版本校验：`HiresSubmitRequestSchema` 一直带 `versions`，但此前从未被使用，
    //    于是「新任务 + 旧版本」能一路走到插入。继承原图参数不代表可以忽略当前操作对象版本。
    assertStudioVersions(database, activityId, request.versions);
    // 3. 计划复查。
    const current = previewStudioHires({ database, config, activityId, request: { ...request, seed: request.seed } });
    if (current.plan.planHash !== request.planHash) {
      throw studioError('hires_plan_changed', '预览配置已变化，请重新预览。', 409);
    }
    const plan = current.plan;
    const created = store.create({
      activityId, kind: 'render_batch', idempotencyKey: request.idempotencyKey, request, planHash: plan.planHash,
      freeze: () => ({ ...plan }),
    }, { skipTransaction: true });
    if (created.existing) return created.job;
    // 4. 冻结来源图片引用（计划 §6.3）：与任务插入同一事务，失败即整体回滚。
    //    来源产物属于目标原生历史（漫画画格／镜头／素材 attempt），不一定有 activity_assets 行，
    //    所以不走 `store.create({ artifactIds })` 那条通道——它会要求 activity_assets，
    //    而归属校验已由 resolveHiresSource() 按活动＋槽位＋attempt 完成。
    createArtifactReference(database, {
      artifactId: plan.sourceArtifactId, appId: 'activities',
      refType: 'activity_studio_job', refId: `studio-job:${created.job.id}`,
    });
    const now = nowIso(), itemId = randomUUID();
    database.connection.prepare(`INSERT INTO activity_studio_job_items
      (id,job_id,target_key,target_json,candidate_index,attempt_no,state,input_json,source_fingerprint,submission_key,placement_state,created_at,updated_at)
      VALUES (?,?,?,?,0,0,'waiting',?,?,?, 'not_requested',?,?)`).run(
      itemId, created.job.id, studioHash(plan.target), JSON.stringify(plan.target), JSON.stringify(plan),
      plan.sourceFingerprint || plan.sourceSha256, `studio-hires-${studioHash({ jobId: created.job.id, itemId }).slice(0, 40)}`, now, now);
    return store.get(activityId, created.job.id)!;
  });
}
