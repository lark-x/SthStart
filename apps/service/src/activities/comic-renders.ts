import { randomInt, randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { buildCharacterVisualContext, DEFAULT_ACTIVITY_NEGATIVE_PROMPT } from '@sthstart/contracts';
import type { ComicPanel, ComicRenderPreview, ContentDocument, ActivityLora } from '@sthstart/contracts';
import {
  ComicHistoryPageSchema, ComicRenderPreviewRequestSchema, ComicRenderPreviewSchema, ComicRenderRequestSchema,
  ComicSelectImageRequestSchema,
} from '@sthstart/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { createGenerationTask } from '../generation/execution.js';
import { getGenerationTask } from '../generation/task-store.js';
import { listModels } from '../generation/comfy-discovery.js';
import { generationEventBus } from '../generation/events.js';
import { resolveArtifactStoragePath } from '../artifacts.js';
import { extractModelNames, hashAiSource, updateAiCallRecord } from '../ai-call-trace.js';
import { linkPromptOptimizationTask, optimizeActivityImagePrompt, PromptOptimizationError } from './image-prompt-optimizer.js';
import { studioRenderAudit, type StudioRenderContext } from './studio-render-context.js';
import { resolveActivityImagePromptPolicy } from './image-prompt-policies.js';
import { activityTextProfileId, inspectStudioTextProfile } from './studio-model-binding.js';
import {
  activityVisualParameterFields, appendLoraTriggerWords, buildActivityImageWorkflowSnapshot, finalizeActivityVisualPrompt, hashVisualPlan, inspectActivityImageWorkflow, mergeActivityImageInputs, resolveEffectiveActivityVisualPlan,
  mergeActivityLoras, parseInputCapabilities, promptInputKey, readActivityLoraPolicy, referenceInputKey,
  resolveActivityImageWorkflow, v2FinalizeInputFrom,
} from './image-render-common.js';
import { ComicStore } from './comic-store.js';
import { ActivityStore } from './store.js';
import { getCommittedImageConfig, getCommittedImageConfigRevisionId } from './image-configs.js';
import { compileDirectorPrompt, resolveVisualSettings } from './visual-settings.js';
import type { ComicJob } from '@sthstart/contracts';

type AdminCheck = (request: FastifyRequest, reply: FastifyReply) => boolean;
type ResolvedWorkflow = ReturnType<typeof resolveActivityImageWorkflow>['resolved'];
type ComicRenderPlan = {
  purpose: string;
  workflow: ResolvedWorkflow;
  presetId: string | null;
  presetRevision: number | null;
  promptPolicy: ReturnType<typeof resolveActivityImagePromptPolicy>;
  parameters: Record<string, unknown>;
  positivePrompt: string;
  stylePrompt: string;
  visualConfiguration: Record<string, unknown>;
  negativeOverride: string | undefined;
  negativePrompt: string;
  positiveKey: string;
  negativeKey: string | null;
  seed: number;
  model: string | null;
  sourceFingerprint: string;
  sources: Array<{ label: string; value: string }>;
  loras: Array<ActivityLora & { source: 'global' | 'character' | 'shot'; available: boolean }>;
  loraPolicyRevision: number;
  referenceInputKey: string | null;
  inputArtifacts: Array<{ artifactId: string; inputKey: string }>;
  warnings: string[];
  planHash: string;
  workflowSnapshot: Record<string, unknown>;
};

function codedError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function sceneFor(content: ContentDocument, stageId: string, sceneId: string) {
  const stage = content.stages.find((item) => item.id === stageId);
  if (!stage) return null;
  const topLevel = (content.scenes ?? []).find((scene) => scene.id === sceneId && scene.stageId === stageId);
  if (topLevel) return { stage, scene: topLevel };
  const nested = stage.scenes?.find((scene) => scene.id === sceneId && (!scene.stageId || scene.stageId === stageId));
  return nested ? { stage, scene: { ...nested, stageId } } : null;
}

function actorVisualText(actor: ContentDocument['actors'][number]) {
  return buildCharacterVisualContext(actor.persona, { outfitOverride: actor.outfitDescription }).text;
}

export function compileComicPanelSource(input: { content: ContentDocument; panel: ComicPanel }): {
  positivePrompt: string; sourceFingerprint: string; sources: Array<{ label: string; value: string }>;
} {
  const { content, panel } = input;
  if (panel.renderSettings.director?.shotSize || panel.renderSettings.composition) {
    throw codedError('comic_duplicate_direction', '漫画景别与构图请使用画格自身字段，不要在绘制设置重复指定。', 400);
  }
  const selected = sceneFor(content, panel.source.stageId, panel.source.sceneId);
  if (!selected) throw codedError('comic_source_not_found', '画格引用的阶段或场次不在绑定的剧情版本中。', 409);
  const { stage, scene } = selected;
  const beats = panel.source.beatIds.map((id) => scene.beats.find((beat) => beat.id === id));
  if (beats.some((beat) => !beat)) throw codedError('comic_source_not_found', '画格引用的原镜头不在绑定的剧情版本中。', 409);
  const actors = panel.actorIds.map((id) => content.actors.find((actor) => actor.id === id));
  if (actors.some((actor) => !actor)) throw codedError('comic_actor_not_found', '画格引用的角色不在绑定的剧情版本中。', 409);
  const actorDescription = (actors as ContentDocument['actors']).map((actor) => `${actor.displayName}：${actorVisualText(actor)}`).filter(Boolean).join('；');
  const shotLabel: Record<ComicPanel['shotSize'], string> = { wide: '远景', medium: '中景', closeup: '特写', detail: '局部细节特写' };
  const safeAreaLabel: Record<ComicPanel['textSafeArea'], string> = {
    none: '不需要预留台词区，主体可充分利用画面', top_left: '画面左上方预留干净、低细节的气泡空间',
    top_right: '画面右上方预留干净、低细节的气泡空间', bottom: '画面底部预留干净、低细节的字幕空间',
  };
  const values = [
    { label: '角色外观与服装', value: actorDescription },
    { label: '场景地点、时间与环境', value: [stage.location, scene.title, scene.locationText, scene.timeText, scene.environment].filter(Boolean).join('；') },
    { label: '来源镜头动作与结果', value: (beats as NonNullable<typeof beats[number]>[]).map((beat) => [beat.action, beat.outcome].filter(Boolean).join('；')).join('；') },
    { label: '画格动作', value: panel.visualDescription || (beats as NonNullable<typeof beats[number]>[]).map((beat) => beat.action).join('；') },
    { label: '景别', value: shotLabel[panel.shotSize] },
    { label: '构图与主体位置', value: panel.composition },
    { label: '文字留白', value: safeAreaLabel[panel.textSafeArea] },
    { label: '用户补充', value: panel.renderSettings.customPrompt?.trim() ?? '' },
    { label: '导演设置', value: compileDirectorPrompt(panel.renderSettings.director) },
    { label: '补充视觉描述', value: panel.renderSettings.visualSupplement ?? '' },
    { label: '表情要求', value: panel.renderSettings.expression ?? '' },
    { label: '绘制约束', value: '画面中不要生成任何可读文字、台词、水印、签名或漫画边框；台词由应用后期绘制。' },
  ].filter((item) => item.value.trim());
  const positivePrompt = values.map((item) => `${item.label}：${item.value}`).join('\n');
  const sourceFingerprint = hashAiSource({
    stage: { id: stage.id, title: stage.title, location: stage.location, instruction: stage.instruction },
    scene: { id: scene.id, title: scene.title, timeText: scene.timeText, locationText: scene.locationText, environment: scene.environment },
    beats: (beats as NonNullable<typeof beats[number]>[]).map((beat) => ({ id: beat.id, characterId: beat.characterId, action: beat.action, outcome: beat.outcome })),
    actors, panel: { actorIds: panel.actorIds, shotSize: panel.shotSize, visualDescription: panel.visualDescription, composition: panel.composition,
      textSafeArea: panel.textSafeArea, customPrompt: panel.renderSettings.customPrompt ?? '',
      visualSupplement: panel.renderSettings.visualSupplement ?? '',expression: panel.renderSettings.expression ?? '',
      ...(panel.renderSettings.director ? { director: panel.renderSettings.director } : {}) },
  });
  return { positivePrompt, sourceFingerprint, sources: values };
}

function referenceArtifact(database: ServiceDatabase, activityId: string, content: ContentDocument, panel: ComicPanel, assetKey: string | null, artifactDirectory: string) {
  if (!assetKey) return { artifactId: null as string | null, inputKey: null as string | null, actor: null as ContentDocument['actors'][number] | null };
  const actor = panel.actorIds.map((id) => content.actors.find((item) => item.id === id)).find((item) => item?.appearanceReferenceAssetKeys?.includes(assetKey)) ?? null;
  if (!actor) throw codedError('reference_asset_not_available', '所选角色参考图不属于当前画格中的角色。', 409);
  const row = database.connection.prepare(`SELECT aa.artifact_id FROM activity_assets aa
    JOIN artifacts a ON a.id=aa.artifact_id WHERE aa.activity_id=? AND aa.asset_key=? AND aa.type='image' AND a.file_status='ready'
    AND EXISTS (SELECT 1 FROM activity_character_asset_transfers t WHERE t.activity_id=aa.activity_id AND t.asset_key=aa.asset_key AND t.source_character_id=?)`)
    .get(activityId, assetKey, actor.sourceCharacterId ?? '') as { artifact_id: string } | undefined;
  if (!row || !resolveArtifactStoragePath(database, row.artifact_id, artifactDirectory)) throw codedError('reference_asset_not_available', '角色参考图没有复制到此活动，或文件不可用。', 409);
  return { artifactId: row.artifact_id, inputKey: null as string | null, actor };
}

function buildComicRenderPlan(input: {
  database: ServiceDatabase; activityId: string; content: ContentDocument; panel: ComicPanel; artifactDirectory: string; seed?: number;
}): ComicRenderPlan {
  const { database, activityId, content, panel, artifactDirectory } = input;
  const compiled = compileComicPanelSource({ content, panel });
  const referenceAssetKey = panel.renderSettings.referenceAssetKey ?? null;
  const effective = resolveEffectiveActivityVisualPlan(database, { imageConfig: getCommittedImageConfig(database, activityId),
    imageConfigRevisionId: getCommittedImageConfigRevisionId(database, activityId),
    settings: panel.renderSettings, actors: content.actors.filter(actor => panel.actorIds.includes(actor.id)),
    sourcePrompt: compiled.positivePrompt, seed: input.seed });
  const { visual, selection } = effective;
  const { resolved, purpose, presetValues, hasPreset, selectedPresetId, selectedPresetRevision } = selection;
  const schema = resolved.workflow.inputSchema as import('../generation/configuration.js').InputSchemaMap;
  const positiveKey = promptInputKey(schema);
  if (!positiveKey) throw codedError('image_workflow_incompatible', '工作流没有声明正向提示词输入。', 409);
  const negativeKey = promptInputKey(schema, true);
  if (negativeKey && !resolved.workflow.nodeBindings[negativeKey]) throw codedError('negative_prompt_binding_missing', '工作流声明了反向提示词，但没有绑定到节点。', 409);
  const { promptPolicy, loraPolicy, loras } = effective;
  const actorReference = referenceArtifact(database, activityId, content, panel, referenceAssetKey, artifactDirectory);
  const supportedReferenceKey = referenceInputKey(resolved);
  if (referenceAssetKey && !supportedReferenceKey) throw codedError('reference_input_unsupported', '所选工作流不支持角色参考图输入。', 409);
  const inputArtifacts = actorReference.artifactId && supportedReferenceKey ? [{ artifactId: actorReference.artifactId, inputKey: supportedReferenceKey }] : [];
  const { parameters: params, seed } = effective;
  const negativePrompt = effective.negativePrompt ?? '';
  const warnings: string[] = [];
  const requiredReferences = Object.entries(parseInputCapabilities(resolved.workflow.inputCapabilities)).filter(([, capability]) => capability.required === true);
  const missingReferences = requiredReferences.filter(([key]) => !inputArtifacts.some((item) => item.inputKey === key));
  for (const [key] of missingReferences) warnings.push(`工作流要求参考输入 ${key}，当前画格未提供。`);
  if (!inputArtifacts.length && !loras.some((item) => item.enabled)) warnings.push('角色一致性目前仅依赖文字提示；未启用参考图或 LoRA。');
  if (panel.actorIds.length > 1 && loras.some((item) => item.enabled)) warnings.push('同时加载多个角色 LoRA 不保证角色与画面位置一一对应。');
  const workflowSnapshot = buildActivityImageWorkflowSnapshot(resolved, params, seed, loras);
  const model = extractModelNames(workflowSnapshot).join(', ') || null;
  const planHash = hashVisualPlan({ activityId, panelId: panel.id, configurationHash: effective.configurationHash,
    sourceFingerprint: compiled.sourceFingerprint, purpose, workflowId: resolved.workflow.id, workflowVersion: resolved.workflow.version,
    engineId: resolved.engine.id, presetId: selectedPresetId, presetRevision: selectedPresetRevision, parameters: params, seed,
    referenceAssetKey, inputArtifacts, promptPolicy, loraPolicyRevision: loraPolicy.revision, loras, stylePrompt: visual.stylePrompt });
  return { purpose, workflow: resolved, presetId: selectedPresetId, presetRevision: selectedPresetRevision, promptPolicy,
    parameters: params, positivePrompt: compiled.positivePrompt, stylePrompt: visual.stylePrompt, negativeOverride: visual.negativePrompt, negativePrompt, positiveKey, negativeKey, seed, model,
    sourceFingerprint: compiled.sourceFingerprint, sources: compiled.sources, loras, loraPolicyRevision: loraPolicy.revision,
    referenceInputKey: supportedReferenceKey, inputArtifacts, warnings: [...warnings, ...(missingReferences.length ? ['缺少工作流必需输入，已阻止提交。'] : [])],
    planHash, workflowSnapshot, visualConfiguration: effective.provenance };
}

function previewFromPlan(plan: ComicRenderPlan, canSubmit: boolean): ComicRenderPreview {
  return {
    planHash: plan.planHash, canSubmit, workflowId: plan.workflow.workflow.id, workflowVersion: plan.workflow.workflow.version,
    workflowName: plan.workflow.workflow.name, engineId: plan.workflow.engine.id, engineName: plan.workflow.engine.name, model: plan.model,
    seed: plan.seed, sourceFingerprint: plan.sourceFingerprint, presetId: plan.presetId, presetRevision: plan.presetRevision,
    promptPolicyRevision: plan.promptPolicy.revision, referenceSupported: Boolean(plan.referenceInputKey), referenceSelected: plan.inputArtifacts.length > 0,
    promptAssembly: plan.workflow.workflow.editorConfig?.promptAssembly === 'service-finalized-v1' ? 'service-finalized-v1' : 'workflow-internal',
    parameters: plan.parameters, positivePrompt: plan.positivePrompt, negativePrompt: plan.negativePrompt,
    fields: activityVisualParameterFields(plan.workflow, plan.parameters),
    sources: plan.sources, loras: plan.loras, warnings: plan.warnings,
  };
}

async function preflightPlan(plan: ComicRenderPlan, secrets: SecretStore, fetcher: typeof fetch, refresh = true) {
  const runtime = await inspectActivityImageWorkflow(plan.workflow, plan.parameters, plan.seed, plan.loras, secrets, fetcher, refresh);
  const enabled = plan.loras.filter((item) => item.enabled);
  let availableLoras = new Set<string>();
  let loraError: string | null = null;
  if (enabled.length) {
    try {
      let secret: string | null = null;
      if (plan.workflow.engine.credentialAccount) secret = (await secrets.get(plan.workflow.engine.credentialAccount)).value;
      const inventory = await listModels(plan.workflow.engine, secret, { category: 'loras', refresh }, fetcher);
      availableLoras = new Set(inventory.items.map((item) => item.name));
      loraError = inventory.error ?? null;
    } catch (error) { loraError = error instanceof Error ? error.message : String(error); }
  }
  const loras = plan.loras.map((item) => ({ ...item, available: !item.enabled || availableLoras.has(item.model) }));
  const issues = [...runtime.issues];
  const missing = enabled.filter((item) => !availableLoras.has(item.model));
  if (loraError) issues.push(`无法读取当前 ComfyUI 实例的 LoRA 清单：${loraError}`);
  else for (const item of missing) issues.push(`LoRA 文件缺失：${item.model}；请放入此实例的 models/loras 目录。`);
  return { canSubmit: runtime.ok && !issues.length && !plan.warnings.some((warning) => warning.includes('已阻止提交')), loras, issues };
}

function mapTaskStatus(status: string): ComicJob['status'] {
  if (['succeeded', 'completed'].includes(status)) return 'succeeded';
  if (['failed', 'cancelled', 'abandoned'].includes(status)) return 'failed';
  if (status === 'queued') return 'queued';
  if (['preparing', 'submitting', 'accepted', 'running'].includes(status)) return 'running';
  return 'unknown';
}

export function syncComicRenderJob(database: ServiceDatabase, config: ServiceConfig, store: ComicStore, job: ComicJob) {
  if (job.kind !== 'render' || !job.generationTaskId) return;
  const task = getGenerationTask(database, job.generationTaskId, 'activities');
  if (!task) { store.updateComicJob(job.id, { status: 'unknown', errorCode: 'comic_generation_task_missing', errorMessage: '统一生成任务记录不存在，未自动重试。' }); return; }
  const mapped = task.upstreamMayContinue ? 'unknown' : mapTaskStatus(task.status);
  if (mapped === 'succeeded') {
    const rows = database.connection.prepare(`SELECT a.id,a.media_type FROM generation_task_artifacts ta
      JOIN artifacts a ON a.id=ta.artifact_id WHERE ta.task_id=? ORDER BY ta.sort_order`).all(task.id) as Array<{ id: string; media_type: string | null }>;
    const imageRows = rows.filter((row) => row.media_type === 'image' || row.media_type?.startsWith('image/'));
    store.recordComicJobOutputs(job.id, imageRows.map((row) => row.id));
    const readable = imageRows.filter((row) => resolveArtifactStoragePath(database, row.id, config.artifactDirectory));
    if (!readable.length) {
      store.updateComicJob(job.id, { status: 'failed', errorCode: 'comic_render_output_missing', errorMessage: imageRows.length ? '生成任务完成，但图片文件不可读取。' : '生成任务完成，但没有图片产物。' });
      return;
    }
    store.updateComicJob(job.id, { status: 'succeeded', errorCode: null, errorMessage: null });
    return;
  }
  if (mapped === 'failed') {
    store.updateComicJob(job.id, { status: 'failed', errorCode: task.errorCode ?? 'comic_render_failed', errorMessage: task.errorMessage ?? '图片生成失败。' });
    return;
  }
  store.updateComicJob(job.id, { status: mapped });
}

export async function processComicRenderJob(options: {
  jobId: string; activityId: string; config: ServiceConfig; database: ServiceDatabase; secrets: SecretStore; fetcher?: typeof fetch;
  comicStore?: ComicStore; activityStore?: ActivityStore;
  context?: StudioRenderContext & { onInsertTask(taskId: string,callId: string): void };
}) {
  const store = options.comicStore ?? new ComicStore(options.database);
  if (!store.claimComicJob(options.jobId)) return;
  const job = store.getComicJob(options.activityId, options.jobId);
  if (!job || job.kind !== 'render') return;
  let optimizerCallId: string | null = null;
  try {
    if (options.context && !options.context.canContinue()) throw codedError('studio_process_interrupted','已停止后续提交，未发送 ComfyUI 任务。');
    const request = job.input as unknown as { panelId: string; expectedDraftVersion: number; planHash: string; seed: number; sourceFingerprint: string };
    const draft = store.getComicDraft(options.activityId);
    if (!draft || draft.draftVersion !== request.expectedDraftVersion) throw codedError('comic_draft_conflict', '漫画草稿已改变；本次任务未提交，请重新预览。', 409);
    const panel = draft.document.panels.find((item) => item.id === request.panelId);
    if (!panel) throw codedError('comic_panel_not_found', '待绘制画格已删除。', 409);
    const activityStore = options.activityStore ?? new ActivityStore(options.database);
    const revision = activityStore.getContentRevision(options.activityId, draft.document.contentRevisionId);
    if (!revision) throw codedError('comic_source_missing', '画格绑定的剧情版本不存在。', 409);
    const plan = buildComicRenderPlan({ database: options.database, activityId: options.activityId, content: revision.document, panel,
      artifactDirectory: options.config.artifactDirectory, seed: request.seed });
    if (plan.planHash !== request.planHash || plan.sourceFingerprint !== request.sourceFingerprint) throw codedError('comic_render_plan_conflict', '工作流、提示词策略、画格内容或生成设置已变化；请重新预览。', 409);
    const live = await preflightPlan(plan, options.secrets, options.fetcher ?? fetch, true);
    if (!live.canSubmit) throw codedError('workflow_runtime_requirements_missing', `当前 ComfyUI 实例缺少必要依赖：${live.issues.join(' ')}`, 409);
    store.updateComicJob(job.id, { status: 'running' });
    const optimized = await optimizeActivityImagePrompt(options.database, options.secrets, {
      activityId: options.activityId, workflowId: plan.workflow.workflow.id, workflowVersion: plan.workflow.workflow.version,
      policy: plan.promptPolicy, sourcePrompt: plan.positivePrompt, existingNegativePrompt: plan.negativePrompt,
      idempotencyKey: `comic:${options.activityId}:${job.id}`, traceId: options.context?.traceId ?? job.traceId,
      studioContext: options.context,
      actorScope: panel.actorIds.map((id) => ({
        actorId: id, displayName: revision.document.actors.find((actor) => actor.id === id)?.displayName,
      })),
    }, options.fetcher ?? fetch);
    optimizerCallId = optimized.optimizerCallId;
    if (options.context && !options.context.canContinue()) throw codedError('studio_process_interrupted','已停止后续提交，未发送 ComfyUI 任务。');
    const finalPrompt = finalizeActivityVisualPrompt(optimized.optimizedPrompt, plan.stylePrompt, plan.loras,
      v2FinalizeInputFrom(plan.workflow.workflow.editorConfig, optimized));
    const finalInputs = { ...plan.parameters, [plan.positiveKey]: finalPrompt };
    const finalNegative = plan.negativeOverride ?? optimized.negativePrompt ?? plan.negativePrompt;
    if (plan.negativeKey) finalInputs[plan.negativeKey] = finalNegative;
    const createTaskIdempotencyKey = `comic:${options.activityId}:${job.id}`;
    const task = await createGenerationTask(options.config, options.database, options.secrets, {
      appId: 'activities', purpose: plan.purpose, workflowId: plan.workflow.workflow.id, workflowVersion: plan.workflow.workflow.version,
      presetId: plan.presetId, presetRevision: plan.presetRevision, isInternal: true, validationMode: 'strict', inputs: finalInputs,
      inputArtifacts: plan.inputArtifacts, activityLoras: plan.loras.filter((item) => item.enabled).map(({ model, strength, triggerWord, enabled }) => ({ model, strength, triggerWord, enabled })),
      seed: plan.seed, idempotencyKey: createTaskIdempotencyKey,
      audit: { feature: 'activity-comic', businessEvent: 'activity.comic.panel.render', objectType: 'activity-comic-panel',
        objectId: `${options.activityId}:${panel.id}`, sourceUrl: `/apps/activities/${encodeURIComponent(options.activityId)}?tab=playback&mode=comic`,
        traceId: job.traceId, parentId: optimized.optimizerCallId, positivePrompt: finalPrompt, negativePrompt: finalNegative,
        visualConfiguration: { ...plan.visualConfiguration, ...studioRenderAudit(options.context) } },
      onInsertTask: (snapshot) => {
        if (options.context && !options.context.canContinue()) throw codedError('studio_process_interrupted','已停止后续提交，未发送 ComfyUI 任务。');
        store.updateComicJob(job.id, { status: 'queued', generationTaskId: snapshot.taskId, callId: snapshot.callId });
        options.context?.onInsertTask(snapshot.taskId,snapshot.callId);
      },
    }, options.fetcher ?? fetch);
    const current = store.getComicJob(options.activityId, job.id);
    if (!current?.generationTaskId) {
      const taskCall = options.database.connection.prepare('SELECT id FROM ai_call_records WHERE generation_task_id=? ORDER BY requested_at DESC LIMIT 1').get(task.id) as { id: string } | undefined;
      store.updateComicJob(job.id, { status: 'queued', generationTaskId: task.id, callId: taskCall?.id ?? optimized.optimizerCallId });
    }
    linkPromptOptimizationTask(options.database, options.activityId, createTaskIdempotencyKey, task.id);
    syncComicRenderJob(options.database, options.config, store, store.getComicJob(options.activityId, job.id)!);
  } catch (error) {
    const value = error as Error & { code?: string; optimizerCallId?: string | null };
    const callId = value.optimizerCallId ?? optimizerCallId;
    store.updateComicJob(job.id, { status: 'failed', callId,
      errorCode: value.code ?? 'comic_render_failed', errorMessage: value.message ?? '漫画画格绘制失败。' });
  }
}

/** Synchronous, source-bound history job creation for Studio's enclosing application transaction. */
export function previewStudioComicRender(database:ServiceDatabase,activityId:string,panelId:string,artifactDirectory:string,seed:number,
  settingsOverride?:Partial<import('@sthstart/contracts').SceneBeatRenderSettings>){
  const draft=new ComicStore(database).getComicDraft(activityId),panel=draft?.document.panels.find(panel=>panel.id===panelId);
  if(!draft||!panel)throw codedError('studio_source_changed','待绘制画格已经不存在。',409);
  const activities=new ActivityStore(database),content=activities.getContentRevision(activityId,draft.document.contentRevisionId)?.document;
  if(!content)throw codedError('studio_source_changed','画格绑定的剧情版本不存在。',409);
  if(activities.getDraft(activityId)?.document.stages.find(stage=>stage.id===panel.source.stageId)?.locked)throw codedError('studio_target_locked','画格来源阶段已锁定。',409);
  const plan=buildComicRenderPlan({database,activityId,content,panel:settingsOverride?{...panel,renderSettings:{...panel.renderSettings,...settingsOverride}}:panel,artifactDirectory,seed});
  return {plan,name:panel.visualDescription,actorIds:panel.actorIds,empty:!panel.selectedImage};
}
export function createStudioComicRenderJob(database: ServiceDatabase, activityId: string, panelId: string, artifactDirectory: string,
  seed: number,idempotencyKey: string,traceId: string,
  settingsOverride?:Partial<import('@sthstart/contracts').SceneBeatRenderSettings>) {
  const store = new ComicStore(database), draft = store.getComicDraft(activityId);
  const panel = draft?.document.panels.find(panel => panel.id === panelId);
  if (!draft || !panel) throw codedError('studio_source_changed','待绘制画格已经不存在。',409);
  const content = new ActivityStore(database).getContentRevision(activityId,draft.document.contentRevisionId)?.document;
  if (!content) throw codedError('studio_source_changed','画格绑定的剧情版本不存在。',409);
  const effectivePanel=settingsOverride?{...panel,renderSettings:{...panel.renderSettings,...settingsOverride}}:panel;
  const plan = buildComicRenderPlan({ database,activityId,content,panel:effectivePanel,artifactDirectory,seed });
  const created = store.createComicJob({ activityId,kind: 'render',panelId,idempotencyKey,traceId,request: {
    panelId,expectedDraftVersion: draft.draftVersion,planHash: plan.planHash,seed: plan.seed,sourceFingerprint: plan.sourceFingerprint,
    renderSettings: effectivePanel.renderSettings,sourceRevisionId: draft.document.contentRevisionId,purpose: plan.purpose,
    workflowId: plan.workflow.workflow.id,workflowVersion: plan.workflow.workflow.version,presetId: plan.presetId,presetRevision: plan.presetRevision,
    engineId: plan.workflow.engine.id,model: plan.model,parameters: plan.parameters,originalPrompt: plan.positivePrompt,negativePrompt: plan.negativePrompt,
    promptPolicyRevision: plan.promptPolicy.revision,loraPolicyRevision: plan.loraPolicyRevision,loras: plan.loras,inputArtifacts: plan.inputArtifacts,workflowSnapshot: plan.workflowSnapshot,
  } },{ skipTransaction: true });
  return { job: created.job,planHash: plan.planHash,sourceFingerprint: plan.sourceFingerprint,seed: plan.seed,referenceArtifactIds: plan.inputArtifacts.map(input => input.artifactId) };
}

export function registerComicRenderRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore,
  checkAdmin: AdminCheck, fetcher: typeof fetch = fetch) {
  const store = new ComicStore(database);
  const activityStore = new ActivityStore(database);
  for (const queued of store.listQueuedComicJobs(500).filter((job) => job.kind === 'render')) {
    setImmediate(() => { void processComicRenderJob({ jobId: queued.id, activityId: queued.activityId, config, database, secrets, fetcher, comicStore: store, activityStore }); });
  }
  for (const job of store.listComicJobsForRecovery(500)) syncComicRenderJob(database, config, store, job);
  const onGenerationEvent = (event: { taskId: string }) => {
    const jobs = store.findComicRenderJobsByTask(event.taskId);
    for (const job of jobs) syncComicRenderJob(database, config, store, job);
  };
  generationEventBus.on('event:activities', onGenerationEvent);
  app.addHook('onClose', async () => { generationEventBus.off('event:activities', onGenerationEvent); });

  app.post<{ Params: { activityId: string; panelId: string }; Body: unknown }>('/api/v1/admin/activities/:activityId/comic/panels/:panelId/render-preview', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(ComicRenderPreviewRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const body = request.body as { expectedDraftVersion: number; seed?: number };
      const draft = store.getComicDraft(request.params.activityId);
      if (!draft || draft.draftVersion !== body.expectedDraftVersion) throw codedError('comic_draft_conflict', '漫画草稿已更新，请保存或刷新后重试。', 409);
      const panel = draft.document.panels.find((item) => item.id === request.params.panelId);
      if (!panel) throw codedError('comic_panel_not_found', '画格不存在。', 404);
      const revision = activityStore.getContentRevision(request.params.activityId, draft.document.contentRevisionId);
      if (!revision) throw codedError('comic_source_missing', '绑定的剧情版本不存在。', 409);
      const plan = buildComicRenderPlan({ database, activityId: request.params.activityId, content: revision.document, panel,
        artifactDirectory: config.artifactDirectory, seed: body.seed });
      const preflight = await preflightPlan(plan, secrets, fetcher, true);
      // 凭据缺口：`preflightPlan` 只查工作流运行时与 LoRA 清单，判断不了文本模型凭据。
      // 缺了这一步，凭据不可用时预览仍报 canSubmit=true，用户在界面上看到的是一个点下去就失败的按钮。
      const issues = [...preflight.issues];
      let canSubmit = preflight.canSubmit;
      if (plan.promptPolicy.enabled) {
        const readiness = await inspectStudioTextProfile(database, secrets, activityTextProfileId(database));
        if (!readiness.ready) { canSubmit = false; issues.push(`提示词优化所需的活动文本模型不可用：${readiness.reason}`); }
      }
      const response = previewFromPlan(plan, canSubmit);
      const warnings = [...response.warnings, ...issues];
      const finalResponse = { ...response, loras: preflight.loras, warnings, canSubmit };
      if (!Value.Check(ComicRenderPreviewSchema, finalResponse)) return reply.code(500).send({ error: 'comic_render_preview_invalid' });
      return reply.send(finalResponse);
    } catch (error) {
      const value = error as Error & { code?: string; statusCode?: number };
      return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'comic_render_preview_failed', message: value.message });
    }
  });

  app.post<{ Params: { activityId: string; panelId: string }; Body: unknown }>('/api/v1/admin/activities/:activityId/comic/panels/:panelId/renders', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(ComicRenderRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const body = request.body as { expectedDraftVersion: number; planHash: string; seed?: number; idempotencyKey: string };
      const existing = store.getComicJobByIdempotencyKey(request.params.activityId, body.idempotencyKey);
      if (existing) {
        if (existing.kind !== 'render' || existing.panelId !== request.params.panelId
          || existing.input.expectedDraftVersion !== body.expectedDraftVersion || existing.input.planHash !== body.planHash
          || (body.seed !== undefined && existing.input.seed !== body.seed)) throw codedError('idempotency_conflict', '相同请求标识已用于不同的绘制参数。', 409);
        return reply.code(202).send({ job: existing });
      }
      const draft = store.getComicDraft(request.params.activityId);
      if (!draft || draft.draftVersion !== body.expectedDraftVersion) throw codedError('comic_draft_conflict', '漫画草稿已更新，请重新预览。', 409);
      const panel = draft.document.panels.find((item) => item.id === request.params.panelId);
      if (!panel) throw codedError('comic_panel_not_found', '画格不存在。', 404);
      const revision = activityStore.getContentRevision(request.params.activityId, draft.document.contentRevisionId);
      if (!revision) throw codedError('comic_source_missing', '绑定的剧情版本不存在。', 409);
      const plan = buildComicRenderPlan({ database, activityId: request.params.activityId, content: revision.document, panel,
        artifactDirectory: config.artifactDirectory, seed: body.seed });
      if (plan.planHash !== body.planHash) throw codedError('comic_render_plan_conflict', '当前工作流、提示词或参数与预览不一致，请重新预览。', 409);
      const preflight = await preflightPlan(plan, secrets, fetcher, true);
      if (!preflight.canSubmit) throw codedError('workflow_runtime_requirements_missing', `当前 ComfyUI 实例无法满足工作流：${preflight.issues.join(' ')}`, 409);
      const created = store.createComicJob({ activityId: request.params.activityId, kind: 'render', panelId: panel.id,
        idempotencyKey: body.idempotencyKey, traceId: randomUUID(), request: {
          panelId: panel.id, expectedDraftVersion: draft.draftVersion, planHash: plan.planHash, seed: plan.seed,
          sourceFingerprint: plan.sourceFingerprint, renderSettings: panel.renderSettings, sourceRevisionId: draft.document.contentRevisionId,
          purpose: plan.purpose, workflowId: plan.workflow.workflow.id, workflowVersion: plan.workflow.workflow.version,
          presetId: plan.presetId, presetRevision: plan.presetRevision, engineId: plan.workflow.engine.id, model: plan.model,
          parameters: plan.parameters, originalPrompt: plan.positivePrompt, negativePrompt: plan.negativePrompt,
          promptPolicyRevision: plan.promptPolicy.revision, loraPolicyRevision: plan.loraPolicyRevision, loras: plan.loras,
          inputArtifacts: plan.inputArtifacts, workflowSnapshot: plan.workflowSnapshot,
        } });
      if (!created.isExisting) setImmediate(() => { void processComicRenderJob({ jobId: created.job.id, activityId: request.params.activityId,
        config, database, secrets, fetcher, comicStore: store, activityStore }); });
      return reply.code(202).send({ job: store.getComicJob(request.params.activityId, created.job.id) });
    } catch (error) {
      const value = error as Error & { code?: string; statusCode?: number };
      return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'comic_render_submit_failed', message: value.message });
    }
  });

  app.get<{ Params: { activityId: string; panelId: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/v1/admin/activities/:activityId/comic/panels/:panelId/history', async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      const draft = store.getComicDraft(request.params.activityId);
      const panel = draft?.document.panels.find((item) => item.id === request.params.panelId);
      if (!draft || !panel) return reply.code(404).send({ error: 'comic_panel_not_found' });
      const revision = activityStore.getContentRevision(request.params.activityId, draft.document.contentRevisionId);
      if (!revision) return reply.code(409).send({ error: 'comic_source_missing' });
      let sourceFingerprint: string;
      try { sourceFingerprint = compileComicPanelSource({ content: revision.document, panel }).sourceFingerprint; }
      catch (error) { return reply.code(409).send({ error: 'comic_source_invalid', message: error instanceof Error ? error.message : String(error) }); }
      const result = store.listComicHistoryImages(request.params.activityId, panel.id, panel.selectedImage?.artifactId ?? null,
        sourceFingerprint, request.query.cursor, Number(request.query.limit ?? 24));
      const beatImages = store.listBeatHistoryImages(request.params.activityId, panel, panel.selectedImage?.artifactId ?? null);
      const allImages = [...result.images, ...beatImages.filter((image) => !result.images.some((item) => item.artifactId === image.artifactId))];
      const images = allImages.map((image) => {
        const available = Boolean(resolveArtifactStoragePath(database, image.artifactId, config.artifactDirectory));
        return { ...image, available, unavailableReason: available ? null : '文件不可用', previewUrl: available ? `/api/admin/artifacts/${encodeURIComponent(image.artifactId)}/file` : null };
      });
      const response = { images, jobs: result.jobs, nextCursor: result.nextCursor };
      if (!Value.Check(ComicHistoryPageSchema, response)) return reply.code(500).send({ error: 'comic_history_invalid' });
      return reply.send(response);
    });

  app.post<{ Params: { activityId: string; panelId: string }; Body: unknown }>(
    '/api/v1/admin/activities/:activityId/comic/panels/:panelId/select-image', async (request, reply) => {
      if (!checkAdmin(request, reply)) return;
      if (!Value.Check(ComicSelectImageRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const body = request.body as { expectedDraftVersion: number; artifactId: string; allowStaleSource: boolean };
        const draft = store.getComicDraft(request.params.activityId);
        const panel = draft?.document.panels.find((item) => item.id === request.params.panelId);
        if (!draft || !panel) throw codedError('comic_panel_not_found', '画格不存在。', 404);
        const revision = activityStore.getContentRevision(request.params.activityId, draft.document.contentRevisionId);
        if (!revision) throw codedError('comic_source_missing', '绑定的剧情版本不存在。', 409);
        const fingerprint = compileComicPanelSource({ content: revision.document, panel }).sourceFingerprint;
        const next = store.selectComicPanelImage({ activityId: request.params.activityId, panelId: panel.id,
          expectedDraftVersion: body.expectedDraftVersion, artifactId: body.artifactId, artifactDirectory: config.artifactDirectory,
          currentSourceFingerprint: fingerprint, allowStaleSource: body.allowStaleSource });
        return reply.send({ draft: next });
      } catch (error) {
        const value = error as Error & { code?: string; statusCode?: number };
        return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'comic_image_select_failed', message: value.message });
      }
    });
}
