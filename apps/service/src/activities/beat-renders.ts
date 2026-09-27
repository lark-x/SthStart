import { randomInt, randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ActivityImagePromptPolicy, ActivityLora, ActivityScene, ActorSnapshot, BeatRenderAdoptResponse, BeatRenderCandidate, BeatRenderImage, BeatRenderPreview,
  BeatRenderPreviewRequest, BeatRenderSubmitRequest, BeatRenderSubmitResponse, ContentDocument, SceneBeat,
} from '@sthstart/contracts';
import {
  BeatRenderActivityLoraPolicyResponseSchema, BeatRenderAdoptResponseSchema, BeatRenderCandidateListSchema, BeatRenderPreviewRequestSchema, BeatRenderSelectImageRequestSchema, BeatRenderActivityLoraPolicySchema, SaveBeatRenderActivityLoraPolicyRequestSchema, BeatRenderRerenderRequestSchema, GenerateBeatMediaRequestSchema,
  buildCharacterVisualContext,
  BeatRenderPreviewSchema, BeatRenderSubmitRequestSchema,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { SecretStore } from '../security.js';
import { createGenerationTask } from '../generation/execution.js';
import { projectFieldContracts, validateRequiredValues, type InputSchemaMap } from '../generation/configuration.js';
import { resolveWorkflowAndEngine } from '../generation/task-store.js';
import { loadObjectInfo, listModels } from '../generation/comfy-discovery.js';
import { generationEventBus } from '../generation/events.js';
import { resolveArtifactStoragePath } from '../artifacts.js';
import { extractModelNames, hashAiSource, redactAiValue, syncBeatRenderCandidateFromTask, updateAiCallRecord } from '../ai-call-trace.js';
import { linkPromptOptimizationTask, optimizeActivityImagePrompt, PromptOptimizationError } from './image-prompt-optimizer.js';
import { resolveActivityImagePromptPolicy } from './image-prompt-policies.js';
import {
  appendLoraTriggerWords, buildActivityImageWorkflowSnapshot, inspectActivityImageWorkflow,
  listActivityImageWorkflowOptions, mergeActivityImageInputs, mergeActivityLoras, parseInputCapabilities,
  promptInputKey as promptKey, readActivityLoraPolicy, referenceInputKey as referenceInput, resolveActivityImageWorkflow,
} from './image-render-common.js';
import type { ActivityStore } from './store.js';

type AdminCheck = (request: FastifyRequest, reply: FastifyReply) => boolean;
type RenderTarget = { stage: ContentDocument['stages'][number]; scene: ActivityScene; beat: SceneBeat; actor: ActorSnapshot | null };
type NormalizedOptions = {
  purpose: string; workflowId: string; workflowVersion: number; presetId: string | null; presetRevision: number | null;
  seed: number; positivePrompt: string; negativePrompt: string | null; parameters: Record<string, unknown>;
  referenceAssetKey: string | null; referenceArtifactId: string | null; referenceInputKey: string | null;
  sourceFingerprint: string; source: Array<{ label: string; value: string }>;
  warnings: string[]; canSubmit: boolean;
  resolved: ReturnType<typeof resolveWorkflowAndEngine>;
  planHash: string;
  workflowOptions: BeatRenderPreview['workflowOptions']; presetOptions: BeatRenderPreview['presetOptions'];
  promptPolicy: ActivityImagePromptPolicy; optimizerReady: boolean;
  loras: Array<ActivityLora & { source: 'global' | 'character' | 'shot'; available: boolean }>;
  loraPolicyRevision: number;
  fields: BeatRenderPreview['fields'];
};

function codedError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requireConfiguredAdmin(config: ServiceConfig, checkAdmin: AdminCheck, request: FastifyRequest, reply: FastifyReply) {
  if (!config.adminToken) { reply.code(503).send({ error: 'admin_not_configured' }); return false; }
  return checkAdmin(request, reply);
}

function stageScenes(document: ContentDocument, stage: ContentDocument['stages'][number]): ActivityScene[] {
  const top = (document.scenes ?? []).filter((scene) => scene.stageId === stage.id);
  const nested = (stage.scenes ?? []).filter((scene) => !scene.stageId || scene.stageId === stage.id);
  if (!top.length) return nested.map((scene) => ({ ...scene, stageId: stage.id }));
  const nestedById = new Map(nested.map((scene) => [scene.id, scene]));
  const unique = new Map<string, ActivityScene>();
  for (const scene of top) {
    if (unique.has(scene.id)) continue;
    const old = nestedById.get(scene.id);
    if (!old) { unique.set(scene.id, { ...scene, stageId: stage.id }); continue; }
    const oldBeats = new Map(old.beats.map((beat) => [beat.id, beat]));
    unique.set(scene.id, {
      ...scene, stageId: stage.id,
      beats: scene.beats.map((beat) => {
        const legacy = oldBeats.get(beat.id);
        return legacy ? { ...beat, mediaUrl: beat.mediaUrl === undefined ? legacy.mediaUrl : beat.mediaUrl, mediaType: beat.mediaType === undefined ? legacy.mediaType : beat.mediaType } : beat;
      }),
    });
  }
  return [...unique.values()];
}

export function findBeatRenderTarget(document: ContentDocument, stageId: string, sceneId: string, beatId: string): RenderTarget | null {
  const stage = document.stages.find((item) => item.id === stageId);
  if (!stage) return null;
  const scene = stageScenes(document, stage).find((item) => item.id === sceneId);
  const beat = scene?.beats.find((item) => item.id === beatId);
  if (!scene || !beat) return null;
  return { stage, scene, beat, actor: document.actors.find((actor) => actor.id === beat.characterId) ?? null };
}

function actorVisualText(actor: ActorSnapshot): string {
  return buildCharacterVisualContext(actor.persona, {
    outfitOverride: actor.outfitDescription,
  }).text;
}

function compileSource(target: RenderTarget, customPrompt?: string) {
  const { stage, scene, beat, actor } = target;
  const subject = actor
    ? `${actor.displayName}，必须出现在画面中，不可缺席${actorVisualText(actor) ? `；${actorVisualText(actor)}` : ''}`
    : beat.characterId === 'narrator'
      ? '无人物角色，聚焦场景中正在发生的事物'
      : `${beat.characterName || beat.characterId}，必须出现在画面中，不可缺席`;
  const composition = customPrompt?.trim()
    ? `${customPrompt.trim()}；主体角色需清楚可见，可见动作应明确呈现。`
    : actor
      ? '以指定角色为画面主体，确保人物可见并清楚呈现动作，避免裁切或遗漏人物。'
      : '画面聚焦场景关键元素与正在发生的变化，保持主体明确。';
  const source = [
    { label: '主体角色', value: subject },
    { label: '可见动作', value: beat.action },
    { label: '场景', value: [stage.location, scene.title, scene.timeText, scene.locationText, scene.environment].filter(Boolean).join('；') },
    { label: '镜头构图', value: composition },
  ].filter((item) => item.value.trim());
  const positivePrompt = source.map((item) => `${item.label}：${item.value}`).join('\n');
  const sourceFingerprint = hashAiSource({
    stage: { id: stage.id, title: stage.title, location: stage.location, instruction: stage.instruction },
    scene: { id: scene.id, title: scene.title, timeText: scene.timeText, locationText: scene.locationText, environment: scene.environment },
    beat: { id: beat.id, characterId: beat.characterId, characterName: beat.characterName, action: beat.action, dialogue: beat.dialogue, outcome: beat.outcome,
      mediaType: beat.mediaType === 'video' ? 'video' : null },
    actor: actor ? { id: actor.id, sourceCharacterId: actor.sourceCharacterId, sourceVersion: actor.sourceVersion, displayName: actor.displayName, persona: actor.persona, activityRole: actor.activityRole, outfitDescription: actor.outfitDescription, appearanceReferenceAssetKeys: actor.appearanceReferenceAssetKeys } : null,
  });
  return { source, positivePrompt, sourceFingerprint };
}

function parameterFields(resolved: ReturnType<typeof resolveWorkflowAndEngine>, values: Record<string, unknown>): BeatRenderPreview['fields'] {
  const schema = resolved.workflow.inputSchema as InputSchemaMap;
  const contracts = projectFieldContracts(schema, resolved.workflow.editorConfig);
  return contracts.map((field) => {
    const configured = resolved.workflow.editorConfig?.fields[field.key];
    const modelField = field.type === 'model' || Boolean(field.modelCategory);
    const modelEditable = modelField && resolved.workflow.editorConfig?.modelSelection !== 'preset-locked' && configured?.allowIndividualSwitch !== false;
    return {
      key: field.key, label: field.label, type: field.type, value: values[field.key] ?? field.defaultValue,
      required: field.required, ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
      ...(field.maximum === undefined ? {} : { maximum: field.maximum }), ...(field.step === undefined ? {} : { step: field.step }),
      ...(field.enumValues === undefined ? {} : { enumValues: field.enumValues }),
      ...(configured?.allowedModels ? { allowedModels: configured.allowedModels } : {}),
      ...(field.modelCategory ? { modelCategory: field.modelCategory } : {}), modelEditable,
    };
  });
}

function normalizeOptions(database: ServiceDatabase, activityId: string, target: RenderTarget, request: BeatRenderPreviewRequest): NormalizedOptions {
  const { source, positivePrompt, sourceFingerprint } = compileSource(target, request.customPrompt);
  const selection = resolveActivityImageWorkflow(database, { purpose: request.purpose, referenceAssetKey: request.referenceAssetKey,
    workflowId: request.workflowId, workflowVersion: request.workflowVersion, presetId: request.presetId, presetRevision: request.presetRevision });
  const { purpose, selectedPresetId, selectedPresetRevision, presetValues, hasPreset, resolved } = selection;
  const availableWorkflows = selection.availableWorkflows;
  const inputSchema = resolved.workflow.inputSchema as InputSchemaMap;
  const promptPolicy = resolveActivityImagePromptPolicy(database, resolved.workflow.id, resolved.workflow.version);
  const loraPolicy = readActivityLoraPolicy(database, resolved.workflow.id, resolved.workflow.version);
  const loraOverrides = request.loraOverrides ?? target.beat.renderSettings?.loraOverrides ?? [];
  const loras = mergeActivityLoras(loraPolicy.entries, target.actor?.visualLoras ?? [], loraOverrides);
  const injection = resolved.workflow.editorConfig?.activityLoraInjection;
  if (loras.some((item) => item.enabled) && !injection) throw codedError('activity_lora_unsupported', '所选工作流版本未声明动态 LoRA 插入点。', 409);
  if (loras.some((item) => item.enabled) && Object.values(resolved.workflow.definition).some((raw) => {
    const node = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return node.class_type === 'LoraLoader' || node.class_type === 'LoraLoaderModelOnly';
  })) throw codedError('activity_lora_static_conflict', '所选工作流包含固定 LoRA 节点，不能再叠加动态 LoRA。', 409);
  const optimizerReady = Boolean(database.connection.prepare(`SELECT 1 FROM app_llm_assignments a JOIN provider_profiles p ON p.id=a.profile_id
    WHERE a.app_id='activities' AND a.role='text' AND p.kind='llm' AND p.enabled=1 AND p.model IS NOT NULL AND p.model<>''`).get());
  const promptInputKey = promptKey(inputSchema)!;
  const negativeInputKey = promptKey(inputSchema, true);
  if (negativeInputKey && !resolved.workflow.nodeBindings[negativeInputKey]) {
    throw codedError('negative_prompt_binding_missing', '当前工作流声明了反向提示词，但未绑定到 ComfyUI 节点；请在生成配置中修正工作流后重试。', 409);
  }
  const defaultNegativePrompt = '低清晰度，模糊，畸形肢体，错误手部，多余手指，缺失手指，文字，水印，签名，裁切，重复人物';
  const mode = resolved.workflow.configFormatVersion >= 2 ? 'strict' : 'lenient';
  const merged = mergeActivityImageInputs(resolved, presetValues, request.parameters ?? {}, hasPreset);
  merged[promptInputKey] = positivePrompt;
  const negativePrompt = negativeInputKey ? request.negativePrompt?.trim() || promptPolicy.negativePrompt.trim() || defaultNegativePrompt : null;
  if (negativeInputKey && negativePrompt !== null) merged[negativeInputKey] = negativePrompt;
  const seedKey = Object.entries(inputSchema).find(([key, entry]) => String(entry.semantic ?? '').toLowerCase() === 'seed' || key.toLowerCase() === 'seed' || key.toLowerCase() === 'noise_seed')?.[0];
  const configuredSeed = seedKey ? request.parameters?.[seedKey] : undefined;
  const seed = request.seed ?? (typeof configuredSeed === 'number' && Number.isInteger(configuredSeed) && configuredSeed >= 0 && configuredSeed <= 2_147_483_647
    ? configuredSeed : randomInt(0, 2_147_483_647));
  if (seedKey && (seedKey in merged || inputSchema[seedKey]?.required)) merged[seedKey] = seed;
  if (mode === 'strict') validateRequiredValues(inputSchema, resolved.workflow.editorConfig, merged);

  const warnings: string[] = [];
  let referenceAssetKey: string | null = request.referenceAssetKey ?? null;
  let referenceArtifactId: string | null = null;
  let referenceInputKey: string | null = null;
  const supportedReferenceInput = referenceInput(resolved);
  if (referenceAssetKey) {
    const actorKeys = target.actor?.appearanceReferenceAssetKeys ?? [];
    if (!target.actor || !actorKeys.includes(referenceAssetKey)) throw codedError('reference_asset_not_available', '所选参考图不属于当前镜头角色的已关联资料。');
    if (!supportedReferenceInput) throw codedError('reference_input_unsupported', '所选工作流没有声明可用的角色参考图输入能力。', 409);
    const asset = database.connection.prepare(`SELECT aa.artifact_id FROM activity_assets aa
      JOIN artifacts a ON a.id=aa.artifact_id WHERE aa.activity_id=? AND aa.asset_key=? AND aa.type='image' AND a.file_status='ready'
      AND EXISTS (SELECT 1 FROM activity_character_asset_transfers t WHERE t.activity_id=aa.activity_id AND t.asset_key=aa.asset_key AND t.source_character_id=?)`)
      .get(activityId, referenceAssetKey, target.actor.sourceCharacterId ?? '') as { artifact_id: string } | undefined;
    if (!asset) throw codedError('reference_asset_not_available', '角色参考图尚未复制到此活动，或当前文件不可用。');
    referenceArtifactId = asset.artifact_id;
    referenceInputKey = supportedReferenceInput;
  } else if (target.actor && (target.actor.appearanceReferenceAssetKeys ?? []).length && !supportedReferenceInput) {
    warnings.push('当前工作流不支持角色参考图；本次只使用角色快照文字。');
  }
  const requiredReferences = Object.entries(parseInputCapabilities(resolved.workflow.inputCapabilities)).filter(([, item]) => item.required === true);
  const missingReferences = requiredReferences.filter(([key]) => !referenceAssetKey || key !== referenceInputKey);
  for (const [key] of missingReferences) warnings.push(`工作流要求输入参考媒体 ${key}，当前候选未提供此项。`);
  if (!referenceAssetKey && !loras.some((item) => item.enabled)) warnings.push('本次未使用参考图或 LoRA；角色信息仅以快照文字加入提示词。');

  const presetOptions = selection.presets;
  const fields = parameterFields(resolved, merged);
  const canSubmit = missingReferences.length === 0;
  const planHash = hashAiSource({ activityId, stageId: target.stage.id, sceneId: target.scene.id, beatId: target.beat.id, sourceFingerprint,
    purpose, workflowId: resolved.workflow.id, workflowVersion: resolved.workflow.version, engineId: resolved.engine.id,
    presetId: selectedPresetId, presetRevision: selectedPresetRevision, inputs: merged, seed,
    referenceAssetKey, referenceArtifactId, referenceInputKey, loraPolicyRevision: loraPolicy.revision, loras });
  const versionedPlanHash = hashAiSource({ planHash, promptPolicy });
  return { purpose, workflowId: resolved.workflow.id, workflowVersion: resolved.workflow.version, presetId: selectedPresetId, presetRevision: selectedPresetRevision,
    seed, positivePrompt, negativePrompt, parameters: merged,
    referenceAssetKey, referenceArtifactId, referenceInputKey, sourceFingerprint, source, warnings, canSubmit,
    resolved, planHash: versionedPlanHash, workflowOptions: availableWorkflows, presetOptions, fields, promptPolicy, optimizerReady,
    loras, loraPolicyRevision: loraPolicy.revision };
}

function previewResponse(_database: ServiceDatabase, draftVersion: number, plan: NormalizedOptions): BeatRenderPreview {
  const finalGraph = buildActivityImageWorkflowSnapshot(plan.resolved, plan.parameters, plan.seed, plan.loras);
  const model = extractModelNames(finalGraph).join(', ') || null;
  return {
    purpose: plan.purpose, planHash: plan.planHash, source: plan.source, positivePrompt: plan.positivePrompt, negativePrompt: plan.negativePrompt,
    workflowId: plan.resolved.workflow.id, workflowName: plan.resolved.workflow.name, workflowVersion: plan.resolved.workflow.version,
    engineId: plan.resolved.engine.id, engineName: plan.resolved.engine.name, model,
    parameters: plan.parameters, referenceSupported: Boolean(referenceInput(plan.resolved)), referenceSelected: Boolean(plan.referenceAssetKey),
    referenceAssetKey: plan.referenceAssetKey, referenceInputKey: plan.referenceInputKey,
    seed: plan.seed, selectedPresetId: plan.presetId, selectedPresetRevision: plan.presetRevision,
    canSubmit: plan.canSubmit && (!plan.promptPolicy.enabled || plan.optimizerReady),
    promptOptimization: { enabled: plan.promptPolicy.enabled, policyRevision: plan.promptPolicy.revision, profileReady: plan.optimizerReady },
    workflowOptions: plan.workflowOptions, presetOptions: plan.presetOptions, fields: plan.fields,
    warnings: [...plan.warnings, ...(plan.promptPolicy.enabled && !plan.optimizerReady ? ['活动文本模型未配置；提交将被阻止，避免未经优化直接生图。'] : [])], draftVersion,
    loras: plan.loras, loraModels: [],
  };
}

async function inspectBeatPlanRuntime(plan: NormalizedOptions, secrets: SecretStore, fetcher: typeof fetch, refresh = true) {
  return inspectActivityImageWorkflow(plan.resolved, plan.parameters, plan.seed, plan.loras, secrets, fetcher, refresh);
}

function blockOnRuntimeIssues(issues: string[]) {
  return codedError('workflow_runtime_requirements_missing', `当前 ComfyUI 实例无法满足此工作流：${issues.join(' ')}`, 409);
}

function updateBeatMedia(document: ContentDocument, stageId: string, sceneId: string, beatId: string, mediaUrl: string): ContentDocument | null {
  const targetStage = document.stages.find((item) => item.id === stageId);
  if (!targetStage) return null;
  const scenes = stageScenes(document, targetStage);
  const selected = scenes.find((item) => item.id === sceneId);
  if (!selected?.beats.some((item) => item.id === beatId)) return null;
  const updated = scenes.map((scene) => scene.id !== sceneId ? scene : {
    ...scene,
    beats: scene.beats.map((beat) => beat.id === beatId ? { ...beat, mediaUrl, mediaType: 'image' as const } : beat),
  });
  const allScenes = (document.scenes ?? []).filter((scene) => !document.stages.some((stage) => stage.id === scene.stageId));
  const normalizedScenes = document.stages.flatMap((stage) => stage.id === stageId ? updated : stageScenes(document, stage));
  return { ...document, scenes: [...allScenes, ...normalizedScenes], stages: document.stages.map((stage) => stage.id === stageId ? { ...stage, scenes: updated } : stage) };
}

function candidateFromRow(row: Record<string, unknown>, images: BeatRenderImage[] = []): BeatRenderCandidate {
  let progress: Record<string, unknown> | null = null;
  try { const parsed: unknown = JSON.parse(String(row.progress_json ?? 'null')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) progress = parsed as Record<string, unknown>; } catch { /* legacy task progress */ }
  return {
    id: String(row.id), activityId: String(row.activity_id), stageId: String(row.stage_id), sceneId: String(row.scene_id), beatId: String(row.beat_id),
    status: String(row.status) as BeatRenderCandidate['status'], taskId: row.task_id == null ? null : String(row.task_id), callId: row.call_id == null ? null : String(row.call_id),
    artifactId: row.artifact_id == null ? null : String(row.artifact_id), mediaUrl: row.media_url == null ? null : String(row.media_url),
    images,
    originalPrompt: String(row.original_prompt ?? row.positive_prompt), positivePrompt: String(row.positive_prompt),
    negativePrompt: row.negative_prompt == null || String(row.negative_prompt) === '' ? null : String(row.negative_prompt),
    promptOptimizationStatus: String(row.prompt_optimization_status ?? 'skipped') as BeatRenderCandidate['promptOptimizationStatus'],
    sourceFingerprint: String(row.source_fingerprint),
    autoApplyState: (row.auto_apply_state ?? 'ineligible') as BeatRenderCandidate['autoApplyState'],
    autoApplyReason: row.auto_apply_reason == null ? null : String(row.auto_apply_reason),
    artifactSha256: row.artifact_sha256 == null ? null : String(row.artifact_sha256), progress,
    createdAt: String(row.created_at), adoptedAt: row.adopted_at == null ? null : String(row.adopted_at), error: row.error_message == null ? null : String(redactAiValue(row.error_message)),
  };
}

function candidateImages(database: ServiceDatabase, row: Record<string, unknown>, artifactDirectory: string, currentMediaUrl: string | undefined): BeatRenderImage[] {
  const candidateId = String(row.id);
  let images = database.connection.prepare(`SELECT o.artifact_id,o.sort_order,a.sha256,a.media_type,a.file_status
    FROM activity_beat_render_candidate_outputs o JOIN artifacts a ON a.id=o.artifact_id
    WHERE o.candidate_id=? ORDER BY o.sort_order`).all(candidateId) as Array<{ artifact_id: string; sort_order: number; sha256: string | null; media_type: string | null; file_status: string }>;
  if (!images.length && row.artifact_id) {
    const artifact = database.connection.prepare('SELECT id,sha256,media_type,file_status FROM artifacts WHERE id=?').get(String(row.artifact_id)) as
      { id: string; sha256: string | null; media_type: string | null; file_status: string } | undefined;
    if (artifact) images = [{ artifact_id: artifact.id, sort_order: 0, sha256: artifact.sha256, media_type: artifact.media_type, file_status: artifact.file_status }];
  }
  return images.filter((item) => item.media_type === 'image' || item.media_type?.startsWith('image/')).map((item, index) => {
    const available = Boolean(resolveArtifactStoragePath(database, item.artifact_id, artifactDirectory));
    const mediaUrl = `/api/admin/artifacts/${encodeURIComponent(item.artifact_id)}/file`;
    return { artifactId: item.artifact_id, mediaUrl, sha256: item.sha256, available, isCurrent: currentMediaUrl === mediaUrl,
      index: Number(item.sort_order ?? index) };
  });
}

function tryAutoApplyCandidate(database: ServiceDatabase, store: ActivityStore, artifactDirectory: string, candidateId: string): boolean {
  return database.transaction(() => {
    const candidate = database.connection.prepare(`SELECT * FROM activity_beat_render_candidates WHERE id=? AND auto_apply_state='pending'`)
      .get(candidateId) as Record<string, unknown> | undefined;
    if (!candidate || candidate.status !== 'succeeded' || !candidate.artifact_id) return false;
    const outputs = database.connection.prepare(`SELECT o.artifact_id,a.media_type FROM activity_beat_render_candidate_outputs o
      JOIN artifacts a ON a.id=o.artifact_id WHERE o.candidate_id=? ORDER BY o.sort_order`).all(candidateId) as
      Array<{ artifact_id: string; media_type: string | null }>;
    const ordered = outputs.length ? outputs : [{ artifact_id: String(candidate.artifact_id), media_type: 'image' }];
    const firstAvailable = ordered.find((item) => (item.media_type === 'image' || item.media_type?.startsWith('image/'))
      && resolveArtifactStoragePath(database, item.artifact_id, artifactDirectory));
    if (!firstAvailable) {
      database.connection.prepare("UPDATE activity_beat_render_candidates SET auto_apply_state='skipped',auto_apply_reason='产物文件不可读取' WHERE id=? AND auto_apply_state='pending'").run(candidateId);
      return false;
    }
    const artifactId = firstAvailable.artifact_id;
    const mediaUrl = `/api/admin/artifacts/${encodeURIComponent(artifactId)}/file`;
    if (artifactId !== String(candidate.artifact_id)) {
      const artifact = database.connection.prepare('SELECT sha256 FROM artifacts WHERE id=?').get(artifactId) as { sha256: string | null } | undefined;
      database.connection.prepare('UPDATE activity_beat_render_candidates SET artifact_id=?,artifact_sha256=?,media_url=? WHERE id=?')
        .run(artifactId, artifact?.sha256 ?? null, mediaUrl, candidateId);
    }
    const draft = store.getDraft(String(candidate.activity_id));
    const target = draft && findBeatRenderTarget(draft.document, String(candidate.stage_id), String(candidate.scene_id), String(candidate.beat_id));
    if (!draft || !target) {
      database.connection.prepare("UPDATE activity_beat_render_candidates SET auto_apply_state='skipped',auto_apply_reason='镜头或活动草稿已不存在' WHERE id=? AND auto_apply_state='pending'").run(candidateId);
      return false;
    }
    if (target.beat.mediaUrl) {
      database.connection.prepare("UPDATE activity_beat_render_candidates SET auto_apply_state='skipped',auto_apply_reason='提交时或生成期间镜头已出现画面' WHERE id=? AND auto_apply_state='pending'").run(candidateId);
      return false;
    }
    if (compileSource(target).sourceFingerprint !== String(candidate.source_fingerprint)) {
      database.connection.prepare("UPDATE activity_beat_render_candidates SET auto_apply_state='skipped',auto_apply_reason='镜头描述或角色资料已变化' WHERE id=? AND auto_apply_state='pending'").run(candidateId);
      return false;
    }
    try {
      const updatedDocument = updateBeatMedia(draft.document, String(candidate.stage_id), String(candidate.scene_id), String(candidate.beat_id), mediaUrl);
      if (!updatedDocument) throw new Error('beat_not_found');
      store.updateDraft(String(candidate.activity_id), draft.draftVersion, updatedDocument);
      database.connection.prepare("UPDATE activity_beat_render_candidates SET auto_apply_state='applied',auto_apply_reason='镜头首次成功生成，已自动写入草稿',adopted_at=COALESCE(adopted_at,?) WHERE id=? AND auto_apply_state='pending'")
        .run(nowIso(), candidateId);
      if (candidate.call_id) updateAiCallRecord(database, String(candidate.call_id), { event: 'candidate_auto_applied', detail: { activityId: candidate.activity_id,
        stageId: candidate.stage_id, sceneId: candidate.scene_id, beatId: candidate.beat_id, artifactId } });
      return true;
    } catch (error) {
      const value = error as Error & { code?: string };
      const reason = value.code === 'draft_version_conflict' ? '草稿已被修改，未自动覆盖' : '自动写入草稿失败';
      database.connection.prepare("UPDATE activity_beat_render_candidates SET auto_apply_state='skipped',auto_apply_reason=? WHERE id=? AND auto_apply_state='pending'").run(reason, candidateId);
      return false;
    }
  });
}

function recoverPendingAutoApply(database: ServiceDatabase, store: ActivityStore, artifactDirectory: string, activityId?: string) {
  const rows = database.connection.prepare(`SELECT id FROM activity_beat_render_candidates WHERE auto_apply_state='pending' AND status='succeeded'
    ${activityId ? 'AND activity_id=?' : ''} ORDER BY created_at`).all(...(activityId ? [activityId] : [])) as Array<{ id: string }>;
  for (const row of rows) tryAutoApplyCandidate(database, store, artifactDirectory, row.id);
}

/** Repair an interrupted task-to-candidate write from the durable task result. */
function reconcileCandidateTasks(database: ServiceDatabase, activityId: string, candidateId?: string) {
  const rows = database.connection.prepare(`SELECT c.task_id,t.status,t.error_message FROM activity_beat_render_candidates c
    JOIN generation_tasks t ON t.id=c.task_id
    WHERE c.activity_id=? ${candidateId ? 'AND c.id=?' : ''}
      AND c.adopted_at IS NULL
      AND ((t.status='succeeded' AND (c.status!='succeeded' OR c.artifact_id IS NULL))
        OR (t.status IN ('failed','cancelled','abandoned') AND c.status IN ('preparing','queued','running')))`)
    .all(...(candidateId ? [activityId, candidateId] : [activityId])) as Array<{ task_id: string; status: string; error_message: string | null }>;
  for (const row of rows) syncBeatRenderCandidateFromTask(database, row.task_id,
    row.status === 'succeeded' ? 'succeeded' : 'failed',
    row.error_message ? { errorMessage: row.error_message } : {});
}

function selectCandidateImage(
  database: ServiceDatabase, store: ActivityStore, artifactDirectory: string,
  activityId: string, candidateId: string, artifactId: string, allowStaleSource = false,
): BeatRenderAdoptResponse {
  reconcileCandidateTasks(database, activityId, candidateId);
  return database.transaction(() => {
    const candidate = database.connection.prepare('SELECT * FROM activity_beat_render_candidates WHERE id=? AND activity_id=?')
      .get(candidateId, activityId) as Record<string, unknown> | undefined;
    if (!candidate) throw codedError('beat_render_candidate_not_found', '未找到此镜头历史图片。', 404);
    if (!['succeeded', 'adopted'].includes(String(candidate.status))) throw codedError('beat_render_candidate_not_ready', '此任务尚未成功生成图片。', 409);
    const linked = database.connection.prepare(`SELECT 1 FROM activity_beat_render_candidate_outputs WHERE candidate_id=? AND artifact_id=?`)
      .get(candidateId, artifactId) || String(candidate.artifact_id ?? '') === artifactId;
    if (!linked) throw codedError('beat_render_image_not_found', '此图片不属于该镜头生成记录。', 404);
    const artifact = database.connection.prepare("SELECT id,sha256,file_status,media_type FROM artifacts WHERE id=? AND app_id='activities'")
      .get(artifactId) as { id: string; sha256: string | null; file_status: string; media_type: string | null } | undefined;
    if (!artifact || !(artifact.media_type === 'image' || artifact.media_type?.startsWith('image/'))
      || !resolveArtifactStoragePath(database, artifactId, artifactDirectory)) {
      throw codedError('beat_render_artifact_unavailable', '图片文件不可读取，无法切换到此历史图片。', 409);
    }
    const draft = store.getDraft(activityId);
    if (!draft) throw codedError('activity_not_found', '活动草稿已不存在。', 404);
    const target = findBeatRenderTarget(draft.document, String(candidate.stage_id), String(candidate.scene_id), String(candidate.beat_id));
    if (!target) throw codedError('beat_render_source_conflict', '原镜头已不存在，不能切换历史图片。', 409);
    const mediaUrl = `/api/admin/artifacts/${encodeURIComponent(artifact.id)}/file`;
    if (target.beat.mediaUrl === mediaUrl) {
      if (candidate.call_id) updateAiCallRecord(database, String(candidate.call_id), { event: 'candidate_image_selected', detail: { activityId,
        stageId: candidate.stage_id, sceneId: candidate.scene_id, beatId: candidate.beat_id, artifactId: artifact.id, idempotent: true } });
      return { draftVersion: draft.draftVersion, mediaUrl, document: draft.document };
    }
    if (!allowStaleSource && compileSource(target).sourceFingerprint !== String(candidate.source_fingerprint)) {
      throw codedError('beat_render_source_conflict', '镜头描述或角色资料在此图片生成后已变化。确认后可将这张旧描述图片切换为当前画面。', 409);
    }
    const updatedDocument = updateBeatMedia(draft.document, String(candidate.stage_id), String(candidate.scene_id), String(candidate.beat_id), mediaUrl);
    if (!updatedDocument) throw codedError('beat_render_source_conflict', '原镜头已不存在，不能切换历史图片。', 409);
    const updated = store.updateDraft(activityId, draft.draftVersion, updatedDocument);
    database.connection.prepare("UPDATE activity_beat_render_candidates SET status='adopted',adopted_at=? WHERE id=? AND status IN ('succeeded','adopted')")
      .run(nowIso(), candidateId);
    if (candidate.call_id) updateAiCallRecord(database, String(candidate.call_id), { event: 'candidate_image_selected', detail: {
      activityId, stageId: candidate.stage_id, sceneId: candidate.scene_id, beatId: candidate.beat_id, artifactId: artifact.id,
    } });
    return { draftVersion: updated.draftVersion, mediaUrl, document: updated.document };
  });
}

function scopedBeatIdempotencyKey(activityId: string, idempotencyKey: string) {
  return `beat-${hashAiSource(activityId).slice(0, 12)}-${idempotencyKey}`;
}

/**
 * A candidate without a generation task cannot be resumed safely after a
 * process restart: the optimizer request may have been interrupted, and no
 * ComfyUI task exists to reconcile. Give it a durable terminal state before
 * admin routes accept a duplicate idempotency key.
 */
export function recoverOrphanedBeatRenderCandidates(database: ServiceDatabase): number {
  const message = '服务在镜头生图任务创建前重启，本次请求已中断且未提交 ComfyUI；请重新生成。';
  const activeAiCallStatuses = ['requested', 'submitted', 'accepted', 'running'] as const;
  return database.transaction(() => {
    const candidates = database.connection.prepare(`SELECT id,activity_id,idempotency_key,call_id
      FROM activity_beat_render_candidates WHERE status='preparing' AND task_id IS NULL`).all() as Array<{
        id: string; activity_id: string; idempotency_key: string | null; call_id: string | null;
      }>;
    const findActiveCallsByTrace = database.connection.prepare(`SELECT id FROM ai_call_records
      WHERE business_event='activity.image.prompt.optimize' AND trace_id=? AND status IN (?,?,?,?)`);
    const findActiveCall = database.connection.prepare(`SELECT id FROM ai_call_records
      WHERE id=? AND business_event='activity.image.prompt.optimize' AND status IN (?,?,?,?)`);

    for (const candidate of candidates) {
      let traceId: string | null = null;
      if (candidate.idempotency_key) {
        const scopedKey = scopedBeatIdempotencyKey(candidate.activity_id, candidate.idempotency_key);
        const run = database.connection.prepare(`SELECT id,trace_id FROM activity_prompt_optimization_runs
          WHERE activity_id=? AND idempotency_key=? AND status='preparing'`).get(candidate.activity_id, scopedKey) as
          { id: string; trace_id: string } | undefined;
        if (run) {
          traceId = run.trace_id;
          database.connection.prepare(`UPDATE activity_prompt_optimization_runs SET status='failed',error_code=?,error_message=?,updated_at=?
            WHERE id=? AND status='preparing'`).run('beat_render_interrupted_on_restart', message, nowIso(), run.id);
        }
      }

      const activeCalls = new Map<string, unknown>();
      if (traceId) {
        for (const call of findActiveCallsByTrace.all(traceId, ...activeAiCallStatuses) as Array<{ id: string }>) activeCalls.set(call.id, call.id);
      }
      if (candidate.call_id) {
        for (const call of findActiveCall.all(candidate.call_id, ...activeAiCallStatuses) as Array<{ id: string }>) activeCalls.set(call.id, call.id);
      }
      for (const callId of activeCalls.keys()) {
        updateAiCallRecord(database, callId, { status: 'abandoned', event: 'service_restart_before_generation_task',
          errorCode: 'beat_render_interrupted_on_restart', errorMessage: message });
      }

      database.connection.prepare(`UPDATE activity_beat_render_candidates SET status='failed',error_message=?,
        prompt_optimization_status=CASE WHEN prompt_optimization_status='optimizing' THEN 'failed' ELSE prompt_optimization_status END
        WHERE id=? AND status='preparing' AND task_id IS NULL`).run(message, candidate.id);
    }
    return candidates.length;
  });
}

async function dispatchBeatRender(
  config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch, store: ActivityStore,
  activityId: string, candidateId: string, request: BeatRenderSubmitRequest, submittedPlanHash: string, sourceFingerprint: string,
) {
  let optimizerCallId: string | null = null;
  try {
    const currentDraft = store.getDraft(activityId);
    const currentTarget = currentDraft && findBeatRenderTarget(currentDraft.document, request.stageId, request.sceneId, request.beatId);
    if (!currentDraft || !currentTarget || compileSource(currentTarget).sourceFingerprint !== sourceFingerprint) {
      throw codedError('beat_render_source_conflict', '提交后镜头内容发生变化，已取消本次生图。', 409);
    }
    const plan = normalizeOptions(database, activityId, currentTarget, request);
    if (plan.planHash !== submittedPlanHash) throw codedError('beat_render_plan_conflict', '提交后提示词策略或生成配置发生变化，已取消本次生图。', 409);
    const candidate = database.connection.prepare('SELECT idempotency_key,status FROM activity_beat_render_candidates WHERE id=? AND activity_id=?')
      .get(candidateId, activityId) as { idempotency_key: string; status: string } | undefined;
    if (!candidate || candidate.status !== 'preparing') return;
    const preflight = await inspectBeatPlanRuntime(plan, secrets, fetcher, true);
    if (!preflight.ok) throw blockOnRuntimeIssues(preflight.issues);
    const scopedIdempotencyKey = scopedBeatIdempotencyKey(activityId, request.idempotencyKey);
    const optimized = await optimizeActivityImagePrompt(database, secrets, {
      activityId, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion, policy: plan.promptPolicy,
      sourcePrompt: plan.positivePrompt, existingNegativePrompt: plan.negativePrompt, idempotencyKey: scopedIdempotencyKey,
    }, fetcher);
    optimizerCallId = optimized.optimizerCallId;
    const finalPrompt = appendLoraTriggerWords(optimized.optimizedPrompt, plan.loras);
    database.connection.prepare(`UPDATE activity_beat_render_candidates SET call_id=?,positive_prompt=?,negative_prompt=?,prompt_optimization_status=?
      WHERE id=? AND status='preparing'`).run(optimizerCallId, finalPrompt, optimized.negativePrompt ?? '', optimized.status, candidateId);
    const positiveKey = promptKey(plan.resolved.workflow.inputSchema as InputSchemaMap);
    if (!positiveKey) throw codedError('image_workflow_incompatible', '工作流没有绑定正向提示词输入。', 409);
    plan.parameters[positiveKey] = finalPrompt;
    const negativeKey = promptKey(plan.resolved.workflow.inputSchema as InputSchemaMap, true);
    if (negativeKey && optimized.negativePrompt) plan.parameters[negativeKey] = optimized.negativePrompt;
    const task = await createGenerationTask(config, database, secrets, {
      appId: 'activities', purpose: plan.purpose, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion, isInternal: true,
      presetId: plan.presetId, presetRevision: plan.presetRevision, inputs: plan.parameters,
      activityLoras: plan.loras.filter((lora) => lora.enabled).map(({ model, strength, triggerWord, enabled }) => ({ model, strength, triggerWord, enabled })),
      inputArtifacts: plan.referenceArtifactId && plan.referenceInputKey ? [{ artifactId: plan.referenceArtifactId, inputKey: plan.referenceInputKey }] : [],
      seed: plan.seed, idempotencyKey: scopedIdempotencyKey, validationMode: 'strict',
      audit: { feature: 'beat-render', businessEvent: 'activity.beat.render', objectType: 'activity-beat',
        objectId: `${activityId}:${request.stageId}:${request.sceneId}:${request.beatId}`,
        sourceUrl: `/apps/activities/${encodeURIComponent(activityId)}`, traceId: optimized.traceId, parentId: optimized.optimizerCallId },
      onInsertTask: ({ taskId, callId }) => {
        database.connection.prepare(`UPDATE activity_beat_render_candidates SET task_id=?,call_id=?,status='queued',positive_prompt=?,negative_prompt=?
          WHERE id=? AND status='preparing'`).run(taskId, callId, finalPrompt, optimized.negativePrompt ?? '', candidateId);
      },
    }, fetcher);
    linkPromptOptimizationTask(database, activityId, scopedIdempotencyKey, task.id);
  } catch (error) {
    const value = error as Error & { code?: string; statusCode?: number; optimizerCallId?: string | null };
    const optimizationFailed = error instanceof PromptOptimizationError;
    const callId = value.optimizerCallId ?? optimizerCallId;
    database.connection.prepare(`UPDATE activity_beat_render_candidates SET status='failed',auto_apply_state=CASE WHEN auto_apply_state='pending' THEN 'skipped' ELSE auto_apply_state END,
      auto_apply_reason=CASE WHEN auto_apply_state='pending' THEN '生成准备失败' ELSE auto_apply_reason END,call_id=COALESCE(?,call_id),error_message=?,
      prompt_optimization_status=CASE WHEN ? THEN 'failed' ELSE prompt_optimization_status END
      WHERE id=? AND status='preparing'`).run(callId, String(redactAiValue(value.message)), optimizationFailed ? 1 : 0, candidateId);
  }
}

export function registerBeatRenderRoutes(
  app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch,
  store: ActivityStore, checkAdmin: AdminCheck,
) {
  const authorized = (request: FastifyRequest, reply: FastifyReply) => requireConfiguredAdmin(config, checkAdmin, request, reply);
  const previewBody = BeatRenderPreviewRequestSchema;
  const beatListQuery = Type.Partial(Type.Object({ stageId: Type.String(), sceneId: Type.String(), beatId: Type.String(), limit: Type.Integer({ minimum: 1, maximum: 100 }), offset: Type.Integer({ minimum: 0 }) }));
  recoverPendingAutoApply(database, store, config.artifactDirectory);
  const onGenerationEvent = (event: { taskId: string; eventType: string }) => {
    if (event.eventType !== 'succeeded' && event.eventType !== 'completed') return;
    const rows = database.connection.prepare('SELECT id FROM activity_beat_render_candidates WHERE task_id=? AND auto_apply_state=\'pending\'')
      .all(event.taskId) as Array<{ id: string }>;
    for (const row of rows) tryAutoApplyCandidate(database, store, config.artifactDirectory, row.id);
  };
  generationEventBus.on('event:activities', onGenerationEvent);
  app.addHook('onClose', async () => { generationEventBus.off('event:activities', onGenerationEvent); });

  const activityLoraPolicySnapshot = async (workflowId: string, workflowVersion: number) => {
    const resolved = resolveWorkflowAndEngine(database, 'activities', { workflowId, workflowVersion, isInternal: true });
    const stored = readActivityLoraPolicy(database, workflowId, workflowVersion);
    let secret: string | null = null;
    if (resolved.engine.credentialAccount) secret = (await secrets.get(resolved.engine.credentialAccount)).value;
    const [objectInfo, modelList] = await Promise.all([
      loadObjectInfo(resolved.engine, secret, fetcher, true),
      listModels(resolved.engine, secret, { category: 'loras', refresh: true }, fetcher),
    ]);
    const insertionSupported = Boolean(resolved.workflow.editorConfig?.activityLoraInjection)
      && !Object.values(resolved.workflow.definition).some((raw) => {
        const node = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        return node.class_type === 'LoraLoader' || node.class_type === 'LoraLoaderModelOnly';
      });
    const nodeAvailable = Boolean(objectInfo.objectInfo?.LoraLoaderModelOnly);
    const message = !insertionSupported ? '此工作流版本未声明动态 LoRA 插入点，或已包含固定 LoRA 节点。'
      : !nodeAvailable ? '当前 ComfyUI 实例缺少 LoraLoaderModelOnly 节点。'
        : modelList.error ? `读取 LoRA 文件清单失败：${modelList.error}` : null;
    return {
      policy: { workflowId, workflowVersion, revision: stored.revision, entries: stored.entries, insertionSupported },
      models: modelList.items.map((item) => item.name), nodeAvailable, message,
    };
  };

  app.get<{ Querystring: { workflowId: string; workflowVersion: number } }>('/api/v1/admin/generation/activity-loras', {
    schema: { querystring: Type.Object({ workflowId: Type.String(), workflowVersion: Type.Integer({ minimum: 1 }) }), response: { 200: BeatRenderActivityLoraPolicyResponseSchema } },
  }, async (request, reply) => {
    if (!authorized(request, reply)) return;
    try { return await activityLoraPolicySnapshot(request.query.workflowId, request.query.workflowVersion); }
    catch (error) { return reply.code(409).send({ error: 'activity_lora_policy_unavailable', message: error instanceof Error ? error.message : String(error) }); }
  });

  app.put<{ Body: { workflowId: string; workflowVersion: number; expectedRevision: number; entries: ActivityLora[] } }>('/api/v1/admin/generation/activity-loras', {
    schema: { body: SaveBeatRenderActivityLoraPolicyRequestSchema, response: { 200: BeatRenderActivityLoraPolicyResponseSchema } },
  }, async (request, reply) => {
    if (!authorized(request, reply)) return;
    try {
      const current = readActivityLoraPolicy(database, request.body.workflowId, request.body.workflowVersion);
      if (current.revision !== request.body.expectedRevision) throw codedError('activity_lora_revision_conflict', 'LoRA 配置已被其他操作更新，请刷新后重试。', 409);
      const resolved = resolveWorkflowAndEngine(database, 'activities', { workflowId: request.body.workflowId, workflowVersion: request.body.workflowVersion, isInternal: true });
      if (!resolved.workflow.editorConfig?.activityLoraInjection) throw codedError('activity_lora_unsupported', '所选工作流版本尚未声明动态 LoRA 插入点。', 409);
      if (new Set(request.body.entries.map((entry) => entry.model)).size !== request.body.entries.length) throw codedError('duplicate_lora_model', '同一工作流的全局 LoRA 文件不能重复。');
      const nextRevision = current.revision + 1;
      database.connection.prepare(`INSERT INTO activity_lora_policy_versions(workflow_id,workflow_version,revision,entries_json,created_at)
        VALUES (?,?,?,?,?)`).run(request.body.workflowId, request.body.workflowVersion, nextRevision, JSON.stringify(request.body.entries), nowIso());
      return await activityLoraPolicySnapshot(request.body.workflowId, request.body.workflowVersion);
    } catch (error) {
      const value = error as Error & { code?: string; statusCode?: number };
      return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'activity_lora_policy_save_failed', message: value.message });
    }
  });

  app.post<{ Params: { id: string }; Body: BeatRenderPreviewRequest }>('/api/v1/admin/activities/:id/beat-renders/preview', { schema: { body: previewBody } }, async (request, reply) => {
    if (!authorized(request, reply)) return;
    const draft = store.getDraft(request.params.id);
    if (!draft) return reply.code(404).send({ error: 'activity_not_found' });
    const target = findBeatRenderTarget(draft.document, request.body.stageId, request.body.sceneId, request.body.beatId);
    if (!target) return reply.code(404).send({ error: 'beat_not_found', message: '此镜头已不存在，请刷新后重新选择。' });
    if (target.beat.mediaType === 'video') return reply.code(400).send({ error: 'video_generation_not_supported', message: '镜头已有视频引用，当前入口只支持图片生成。' });
    try {
      const plan = normalizeOptions(database, request.params.id, target, request.body);
      const response = previewResponse(database, draft.draftVersion, plan);
      const preflight = await inspectBeatPlanRuntime(plan, secrets, fetcher, true);
      let secret: string | null = null;
      if (plan.resolved.engine.credentialAccount) secret = (await secrets.get(plan.resolved.engine.credentialAccount)).value;
      const inventory = await listModels(plan.resolved.engine, secret, { category: 'loras', refresh: true }, fetcher);
      const models = inventory.items.map((item) => item.name);
      const loras = response.loras.map((lora) => ({ ...lora, available: !lora.enabled || models.includes(lora.model) }));
      const missingLora = response.loras.filter((lora) => lora.enabled && !models.includes(lora.model)).map((lora) => `LoRA 文件缺失：${lora.model}（请安装到当前实例的 models/loras 并刷新）。`);
      const inventoryIssue = inventory.error && response.loras.some((lora) => lora.enabled) ? [`无法读取此实例的 LoRA 文件清单：${inventory.error}`] : [];
      const warnings = [...response.warnings, ...preflight.issues, ...missingLora, ...inventoryIssue];
      const canSubmit = response.canSubmit && preflight.ok && !missingLora.length && !inventoryIssue.length;
      return { ...response, loras, loraModels: models, canSubmit, warnings };
    }
    catch (error) {
      const value = error as Error & { code?: string; statusCode?: number };
      return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'beat_render_preview_failed', message: value.message });
    }
  });

  app.post<{ Params: { id: string }; Body: BeatRenderSubmitRequest }>('/api/v1/admin/activities/:id/beat-renders', { schema: { body: BeatRenderSubmitRequestSchema } }, async (request, reply) => {
    if (!authorized(request, reply)) return;
    const activityId = request.params.id;
    const draft = store.getDraft(activityId);
    if (!draft) return reply.code(404).send({ error: 'activity_not_found' });
    const target = findBeatRenderTarget(draft.document, request.body.stageId, request.body.sceneId, request.body.beatId);
    if (!target) return reply.code(404).send({ error: 'beat_not_found', message: '此镜头已不存在，请刷新后重新选择。' });
    if (target.beat.mediaType === 'video') return reply.code(400).send({ error: 'video_generation_not_supported', message: '视频镜头不能提交图片生成。' });
    try {
      const plan = normalizeOptions(database, activityId, target, request.body);
      if (!plan.canSubmit) throw codedError('beat_render_input_required', plan.warnings.join(' '), 409);
      if (plan.promptPolicy.enabled && !plan.optimizerReady) throw codedError('prompt_optimizer_not_configured',
        '活动尚未绑定可用的文本模型，已停止生图；请到生成配置的应用模型设置中绑定后重试。', 409);
      if (plan.planHash !== request.body.planHash) throw codedError('beat_render_plan_conflict', '镜头内容或工作流配置已变化，请重新预览后提交。', 409);
      const requestFingerprint = hashAiSource({ planHash: plan.planHash, sourceFingerprint: plan.sourceFingerprint });
      const previous = database.connection.prepare('SELECT * FROM activity_beat_render_candidates WHERE activity_id=? AND idempotency_key=?')
        .get(activityId, request.body.idempotencyKey) as Record<string, unknown> | undefined;
      if (previous) {
        if (String(previous.request_fingerprint ?? '') !== requestFingerprint) throw codedError('idempotency_conflict', '此幂等键已用于其他镜头配置，请重新提交。', 409);
        return reply.code(202).send({ candidateId: String(previous.id), taskId: previous.task_id == null ? null : String(previous.task_id),
          callId: previous.call_id == null ? null : String(previous.call_id) } satisfies BeatRenderSubmitResponse);
      }
      const preflight = await inspectBeatPlanRuntime(plan, secrets, fetcher, true);
      if (!preflight.ok) throw blockOnRuntimeIssues(preflight.issues);
      const candidateId = randomUUID();
      const autoApplyState = target.beat.mediaUrl ? 'ineligible' : 'pending';
      database.connection.prepare(`INSERT INTO activity_beat_render_candidates
        (id,activity_id,stage_id,scene_id,beat_id,idempotency_key,request_fingerprint,source_fingerprint,draft_version,task_id,call_id,
          status,positive_prompt,negative_prompt,created_at,original_prompt,prompt_optimization_status,auto_apply_state,auto_apply_reason,auto_apply_draft_version)
        VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,'preparing',?,?,?,?,?,?,?,?)`)
        .run(candidateId, activityId, request.body.stageId, request.body.sceneId, request.body.beatId, request.body.idempotencyKey,
          requestFingerprint, plan.sourceFingerprint, draft.draftVersion, plan.positivePrompt, plan.negativePrompt ?? '', nowIso(), plan.positivePrompt,
          plan.promptPolicy.enabled ? 'optimizing' : 'skipped', autoApplyState,
          autoApplyState === 'ineligible' ? '提交时镜头已有画面' : null, draft.draftVersion);
      setImmediate(() => { void dispatchBeatRender(config, database, secrets, fetcher, store, activityId, candidateId, request.body, plan.planHash, plan.sourceFingerprint); });
      return reply.code(202).send({ candidateId, taskId: null, callId: null } satisfies BeatRenderSubmitResponse);
    } catch (error) {
      const value = error as Error & { code?: string; statusCode?: number };
      const status = value.statusCode ?? (value.code?.includes('not_found') ? 404 : value.code?.includes('conflict') ? 409 : 400);
      return reply.code(status).send({ error: value.code ?? 'beat_render_submit_failed', message: value.message });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { stageId?: string; sceneId?: string; beatId?: string; limit?: number; offset?: number } }>('/api/v1/admin/activities/:id/beat-renders', { schema: { querystring: beatListQuery, response: { 200: BeatRenderCandidateListSchema } } }, (request, reply) => {
    if (!authorized(request, reply)) return;
    if (!store.getActivity(request.params.id)) return reply.code(404).send({ error: 'activity_not_found' });
    reconcileCandidateTasks(database, request.params.id);
    recoverPendingAutoApply(database, store, config.artifactDirectory, request.params.id);
    const clauses = ['c.activity_id=?'];
    const args: SQLInputValue[] = [request.params.id];
    for (const key of ['stageId', 'sceneId', 'beatId'] as const) if (request.query[key]) { clauses.push(`c.${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}=?`); args.push(request.query[key]); }
    const total = Number((database.connection.prepare(`SELECT COUNT(*) AS count FROM activity_beat_render_candidates c WHERE ${clauses.join(' AND ')}`).get(...args) as { count: number }).count);
    const outputImageCount = Number((database.connection.prepare(`SELECT COUNT(DISTINCT o.artifact_id) AS count FROM activity_beat_render_candidate_outputs o
      JOIN activity_beat_render_candidates c ON c.id=o.candidate_id JOIN artifacts a ON a.id=o.artifact_id
      WHERE ${clauses.join(' AND ')} AND (a.media_type='image' OR a.media_type LIKE 'image/%')`).get(...args) as { count: number }).count);
    const legacyImageCount = Number((database.connection.prepare(`SELECT COUNT(DISTINCT c.artifact_id) AS count FROM activity_beat_render_candidates c
      JOIN artifacts a ON a.id=c.artifact_id WHERE ${clauses.join(' AND ')} AND (a.media_type='image' OR a.media_type LIKE 'image/%')
      AND NOT EXISTS (SELECT 1 FROM activity_beat_render_candidate_outputs o WHERE o.candidate_id=c.id)`).get(...args) as { count: number }).count);
    const limit = Math.min(Math.max(request.query.limit ?? 24, 1), 100);
    const offset = Math.max(request.query.offset ?? 0, 0);
    const rows = database.connection.prepare(`SELECT c.*,t.progress_json FROM activity_beat_render_candidates c
      LEFT JOIN generation_tasks t ON t.id=c.task_id WHERE ${clauses.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Array<Record<string, unknown>>;
    const draft = store.getDraft(request.params.id);
    const target = draft && request.query.stageId && request.query.sceneId && request.query.beatId
      ? findBeatRenderTarget(draft.document, request.query.stageId, request.query.sceneId, request.query.beatId) : null;
    return { items: rows.map((row) => candidateFromRow(row, candidateImages(database, row, config.artifactDirectory, target?.beat.mediaUrl))),
      total, imageTotal: outputImageCount + legacyImageCount, limit, offset, draftVersion: draft?.draftVersion ?? 0 };
  });

  app.post<{ Params: { id: string; candidateId: string; artifactId: string }; Body: { allowStaleSource?: boolean } }>(
    '/api/v1/admin/activities/:id/beat-renders/:candidateId/images/:artifactId/select',
    { schema: { body: BeatRenderSelectImageRequestSchema, response: { 200: BeatRenderAdoptResponseSchema } } }, (request, reply) => {
      if (!authorized(request, reply)) return;
      try { return selectCandidateImage(database, store, config.artifactDirectory, request.params.id, request.params.candidateId, request.params.artifactId, request.body.allowStaleSource); }
      catch (error) {
        const value = error as Error & { code?: string; statusCode?: number };
        return reply.code(value.statusCode ?? (value.code?.includes('conflict') ? 409 : value.code?.includes('not_found') ? 404 : 400))
          .send({ error: value.code ?? 'beat_render_image_select_failed', message: value.message });
      }
    });

  // Compatibility: old callers still select the task's first image via /adopt.
  app.post<{ Params: { id: string; candidateId: string } }>('/api/v1/admin/activities/:id/beat-renders/:candidateId/adopt', { schema: { response: { 200: BeatRenderAdoptResponseSchema } } }, (request, reply) => {
    if (!authorized(request, reply)) return;
    reconcileCandidateTasks(database, request.params.id, request.params.candidateId);
    const row = database.connection.prepare('SELECT artifact_id FROM activity_beat_render_candidates WHERE id=? AND activity_id=?')
      .get(request.params.candidateId, request.params.id) as { artifact_id: string | null } | undefined;
    if (!row?.artifact_id) return reply.code(409).send({ error: 'beat_render_candidate_not_ready', message: '此镜头记录还没有可切换的首张图片。' });
    try { return selectCandidateImage(database, store, config.artifactDirectory, request.params.id, request.params.candidateId, row.artifact_id); }
    catch (error) {
      const value = error as Error & { code?: string; statusCode?: number };
      return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'beat_render_adopt_failed', message: value.message });
    }
  });

  app.post<{ Params: { id: string; candidateId: string }; Body: { seed?: number } }>(
    '/api/v1/admin/activities/:id/beat-renders/:candidateId/rerender',
    { schema: { body: BeatRenderRerenderRequestSchema } }, async (request, reply) => {
      if (!authorized(request, reply)) return;
      let rerenderCandidateId: string | null = null;
      try {
        const source = database.connection.prepare(`SELECT c.*,t.workflow_id,t.workflow_version,t.purpose,t.request_params_json,t.workflow_snapshot_json,
          t.actual_seed,t.engine_id,call.trace_id FROM activity_beat_render_candidates c
          JOIN generation_tasks t ON t.id=c.task_id LEFT JOIN ai_call_records call ON call.id=c.call_id
          WHERE c.id=? AND c.activity_id=? AND c.status IN ('succeeded','adopted')`)
          .get(request.params.candidateId, request.params.id) as Record<string, unknown> | undefined;
        if (!source) throw codedError('beat_render_candidate_not_ready', '只有已完成的镜头图片可以按原配置重绘。', 409);
        const saved = JSON.parse(String(source.request_params_json ?? '{}')) as Record<string, unknown>;
        const inputs = saved.inputs && typeof saved.inputs === 'object' ? { ...(saved.inputs as Record<string, unknown>) } : null;
        if (!inputs) throw codedError('beat_render_snapshot_unavailable', '这条旧记录没有完整的生成参数快照，无法安全重绘。', 409);
        const workflowId = String(source.workflow_id);
        const workflowVersion = Number(source.workflow_version);
        const resolved = resolveWorkflowAndEngine(database, 'activities', { purpose: String(source.purpose), workflowId, workflowVersion, isInternal: true });
        let seed = request.body.seed ?? randomInt(0, 2_147_483_647);
        if (request.body.seed === undefined && seed === Number(source.actual_seed)) seed = (seed + 1) % 2_147_483_648;
        const seedKey = Object.entries(resolved.workflow.inputSchema as InputSchemaMap).find(([key, entry]) =>
          String(entry.semantic ?? '').toLowerCase() === 'seed' || ['seed', 'noise_seed'].includes(key.toLowerCase()))?.[0];
        if (seedKey) inputs[seedKey] = seed;
        const activityLoras = Array.isArray(saved.activityLoras) ? saved.activityLoras as ActivityLora[] : [];
        const id = randomUUID();
        rerenderCandidateId = id;
        const key = `beat-rerender-${id}`;
        const now = nowIso();
        database.connection.prepare(`INSERT INTO activity_beat_render_candidates
          (id,activity_id,stage_id,scene_id,beat_id,idempotency_key,request_fingerprint,source_fingerprint,draft_version,status,
           positive_prompt,negative_prompt,created_at,original_prompt,prompt_optimization_status,auto_apply_state,auto_apply_reason)
          VALUES (?,?,?,?,?,?,?,?,?,'preparing',?,?,?,?,?,'ineligible','重绘结果仅进入历史，不自动替换当前画面')`)
          .run(id, request.params.id, String(source.stage_id), String(source.scene_id), String(source.beat_id), key, hashAiSource({ source: String(source.id), seed }), String(source.source_fingerprint),
            Number(source.draft_version), String(source.positive_prompt), source.negative_prompt == null ? null : String(source.negative_prompt), now, String(source.original_prompt), String(source.prompt_optimization_status));
        const callTrace = source.trace_id ? String(source.trace_id) : undefined;
        let rerenderCallId: string | null = null;
        const task = await createGenerationTask(config, database, secrets, {
          appId: 'activities', purpose: String(source.purpose), workflowId, workflowVersion, isInternal: true,
          inputs, inputArtifacts: Array.isArray(saved.inputArtifacts) ? saved.inputArtifacts as Array<{ artifactId: string; inputKey: string }> : [],
          activityLoras, seed, idempotencyKey: key, validationMode: 'strict', retryOf: String(source.task_id),
          audit: { feature: 'beat-render', businessEvent: 'activity.beat.render.rerender', objectType: 'activity-beat',
            objectId: `${request.params.id}:${source.stage_id}:${source.scene_id}:${source.beat_id}`,
            sourceUrl: `/apps/activities/${encodeURIComponent(request.params.id)}`,
            ...(source.call_id ? { parentId: String(source.call_id) } : {}), ...(callTrace ? { traceId: callTrace } : {}) },
          onInsertTask: ({ taskId, callId }) => {
            rerenderCallId = callId;
            database.connection.prepare(`UPDATE activity_beat_render_candidates SET task_id=?,call_id=?,status='queued'
              WHERE id=? AND status='preparing'`).run(taskId, callId, id);
          },
        }, fetcher);
        return reply.code(202).send({ candidateId: id, taskId: task.id, callId: rerenderCallId } satisfies BeatRenderSubmitResponse);
      } catch (error) {
        const value = error as Error & { code?: string; statusCode?: number };
        if (rerenderCandidateId) database.connection.prepare(`UPDATE activity_beat_render_candidates SET status='failed',
          auto_apply_state=CASE WHEN auto_apply_state='pending' THEN 'skipped' ELSE auto_apply_state END,
          auto_apply_reason=CASE WHEN auto_apply_state='pending' THEN '重绘任务准备失败' ELSE auto_apply_reason END,error_message=?
          WHERE id=? AND status='preparing'`).run(String(redactAiValue(value.message)), rerenderCandidateId);
        return reply.code(value.statusCode ?? 409).send({ error: value.code ?? 'beat_render_rerender_failed', message: value.message });
      }
    });
}

export function registerLegacyBeatRenderRoute(
  app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch,
  store: ActivityStore, checkAdmin: AdminCheck,
) {
  const authorized = (request: FastifyRequest, reply: FastifyReply) => requireConfiguredAdmin(config, checkAdmin, request, reply);
  // The legacy response shape remains available, but generation runs through the versioned task and candidate pipeline.
  app.post<{ Params: { id: string }; Body: import('@sthstart/contracts').GenerateBeatMediaRequest }>(
    '/api/v1/admin/activities/:id/generate-beat-media',
    { schema: { body: GenerateBeatMediaRequestSchema } },
    async (request, reply) => {
      if (!authorized(request, reply)) return;
      if (request.body.engineId) {
        const engine = database.connection.prepare('SELECT id FROM generation_engines WHERE id=? AND enabled=1 AND kind=\'comfyui\'')
          .get(request.body.engineId);
        if (!engine) return reply.code(502).send({ error: 'comfy_engine_unavailable', message: '指定的 ComfyUI 引擎不存在或当前不可用。' });
      }
      if (request.body.mediaType === 'video') return reply.code(400).send({ error: 'video_generation_not_supported' });
      const draft = store.getDraft(request.params.id);
      if (!draft) return reply.code(404).send({ error: 'activity_not_found' });
      const stage = draft.document.stages.find((item) => item.id === request.body.stageId);
      const target = stage && stageScenes(draft.document, stage).flatMap((scene) => scene.beats.map((beat) => ({ scene, beat }))).find((item) => item.beat.id === request.body.beatId);
      if (!target) return reply.code(404).send({ error: 'beat_not_found' });
      const base: BeatRenderPreviewRequest = { stageId: stage!.id, sceneId: target.scene.id, beatId: target.beat.id,
        customPrompt: request.body.customPrompt, negativePrompt: request.body.negativePrompt, seed: request.body.seed == null ? undefined : Number(request.body.seed) };
      if (base.seed !== undefined && (!Number.isInteger(base.seed) || base.seed < 0 || base.seed > 2_147_483_647)) {
        return reply.code(400).send({ error: 'invalid_seed', message: '种子必须是 0 到 2147483647 之间的整数。' });
      }
      let initial: NormalizedOptions;
      try {
        initial = normalizeOptions(database, request.params.id, { stage: stage!, ...target, actor: draft.document.actors.find((actor) => actor.id === target.beat.characterId) ?? null }, base);
      } catch (error) {
        const value = error as Error & { code?: string; statusCode?: number };
        if (value.code === 'generation_engine_unavailable' || value.code === 'comfy_engine_unavailable') {
          return reply.code(502).send({ error: 'comfy_engine_unavailable', message: value.message });
        }
        return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'generation_failed', message: value.message });
      }
      const parameters: Record<string, unknown> = {};
      const legacy = { steps: request.body.steps, cfg: request.body.cfg, width: request.body.width, height: request.body.height };
      for (const [key, schemaEntry] of Object.entries(initial.resolved.workflow.inputSchema as InputSchemaMap)) {
        const semantic = String(schemaEntry.semantic ?? key).toLowerCase().replaceAll('_', '');
        const legacyValue = semantic === 'steps' ? legacy.steps : semantic === 'cfg' ? legacy.cfg : semantic === 'width' ? legacy.width : semantic === 'height' ? legacy.height : undefined;
        if (legacyValue !== undefined) parameters[key] = legacyValue;
      }
      if (request.body.checkpoint) {
        const checkpoint = initial.fields.find((field) => field.modelCategory === 'checkpoints' || /checkpoint/i.test(field.modelCategory ?? ''));
        if (!checkpoint?.modelEditable) return reply.code(409).send({ error: 'model_selection_locked', message: '当前工作流/预设锁定了模型，请在生成配置中调整预设。' });
        parameters[checkpoint.key] = request.body.checkpoint;
      }
      if (request.body.engineId && request.body.engineId !== initial.resolved.engine.id) return reply.code(409).send({ error: 'generation_engine_assignment_managed', message: '引擎由当前工作流绑定管理，请先调整生成配置。' });
      const previewRequest = { ...base, parameters };
      const plan = normalizeOptions(database, request.params.id, { stage: stage!, ...target, actor: draft.document.actors.find((actor) => actor.id === target.beat.characterId) ?? null }, previewRequest);
      try {
        const preflight = await inspectBeatPlanRuntime(plan, secrets, fetcher, true);
        if (!preflight.ok) throw blockOnRuntimeIssues(preflight.issues);
        const legacyIdempotencyKey = `beat-legacy-${randomUUID()}`;
        const optimized = await optimizeActivityImagePrompt(database, secrets, {
          activityId: request.params.id, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion,
          policy: plan.promptPolicy, sourcePrompt: plan.positivePrompt, existingNegativePrompt: plan.negativePrompt,
          idempotencyKey: legacyIdempotencyKey,
        }, fetcher);
        const finalPrompt = appendLoraTriggerWords(optimized.optimizedPrompt, plan.loras);
        const positiveKey = promptKey(plan.resolved.workflow.inputSchema as InputSchemaMap);
        if (!positiveKey) throw codedError('image_workflow_incompatible', '工作流没有绑定正向提示词输入。', 409);
        plan.parameters[positiveKey] = finalPrompt;
        const negativeKey = promptKey(plan.resolved.workflow.inputSchema as InputSchemaMap, true);
        if (negativeKey && optimized.negativePrompt) plan.parameters[negativeKey] = optimized.negativePrompt;
        const created = await createGenerationTask(config, database, secrets, {
          appId: 'activities', purpose: plan.purpose, workflowId: plan.workflowId, workflowVersion: plan.workflowVersion, isInternal: true,
          presetId: plan.presetId, presetRevision: plan.presetRevision, inputs: plan.parameters, seed: plan.seed,
          activityLoras: plan.loras.filter((lora) => lora.enabled).map(({ model, strength, triggerWord, enabled }) => ({ model, strength, triggerWord, enabled })),
          idempotencyKey: legacyIdempotencyKey, validationMode: 'strict',
          audit: { feature: 'beat-render', businessEvent: 'activity.beat.render.legacy', objectType: 'activity-beat', objectId: `${request.params.id}:${request.body.stageId}:${target.scene.id}:${request.body.beatId}`,
            traceId: optimized.traceId, parentId: optimized.optimizerCallId },
          onInsertTask: ({ taskId, callId }) => database.connection.prepare(`INSERT INTO activity_beat_render_candidates
            (id,activity_id,stage_id,scene_id,beat_id,idempotency_key,request_fingerprint,source_fingerprint,draft_version,task_id,call_id,status,positive_prompt,negative_prompt,created_at,original_prompt,prompt_optimization_status)
            VALUES (?,?,?,?,?,NULL,?,?,?,?,?,'queued',?,?,?,?,?)`).run(randomUUID(), request.params.id, stage!.id, target.scene.id, target.beat.id,
              hashAiSource({ planHash: plan.planHash, legacy: true }), plan.sourceFingerprint, draft.draftVersion, taskId, callId, finalPrompt,
              optimized.negativePrompt ?? '', nowIso(), plan.positivePrompt, optimized.status),
        }, fetcher);
        linkPromptOptimizationTask(database, request.params.id, legacyIdempotencyKey, created.id);
        const deadline = Date.now() + 150_000;
        let current = created;
        while (!['succeeded', 'failed', 'abandoned'].includes(current.status) && Date.now() < deadline) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
          const row = database.connection.prepare('SELECT * FROM generation_tasks WHERE id=?').get(created.id) as Record<string, unknown> | undefined;
          if (!row) break;
          const state = String(row.status) as typeof current.status;
          current = { ...current, status: state };
        }
        const candidate = database.connection.prepare('SELECT media_url,status FROM activity_beat_render_candidates WHERE task_id=?').get(created.id) as { media_url: string | null; status: string } | undefined;
        const success = current.status === 'succeeded' && candidate?.status === 'succeeded' && Boolean(candidate.media_url);
        return reply.code(200).send({ success, mediaUrl: candidate?.media_url ?? '', mediaType: 'image', promptUsed: finalPrompt, seed: plan.seed,
          characterConsistent: false, stageId: stage!.id, beatId: target.beat.id, ...(!success ? { error: current.status === 'succeeded' ? 'generation_pending: 图片生成仍在处理中，请从候选区查看。' : current.status === 'failed' ? current.errorMessage ?? 'generation_failed' : 'generation_pending: 图片生成仍在处理中，请从候选区查看。' } : {}) });
      } catch (error) {
        const value = error as Error & { code?: string; statusCode?: number };
        if (value.code === 'generation_engine_unavailable' || value.code === 'comfy_engine_unavailable') {
          return reply.code(502).send({ error: 'comfy_engine_unavailable', message: value.message });
        }
        return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'generation_failed', message: value.message });
      }
    },
  );
}
