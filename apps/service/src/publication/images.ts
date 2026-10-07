import type { PublicationDocument, PublicationShot, ActorSnapshot, ActivityLora } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { buildActivityImageWorkflowSnapshot, inspectActivityImageWorkflow, referenceInputKey, resolveEffectiveActivityVisualPlan } from '../activities/image-render-common.js';
import { extractModelNames } from '../ai-call-trace.js';
import { fingerprint, publicationError, shotFingerprint } from './store.js';
import { listPresets } from '../generation/configuration-store.js';
import { PARITY_TEXT_WORKFLOW_ID } from '../activities/parity-workflows.js';

/** Only the new publication mode prefers the full-prompt parity graph; legacy bindings stay intact. */
function publicationSettings(database: ServiceDatabase, shot: PublicationShot) {
  const settings = { ...shot.renderSettings, parameters: { width: 768, height: 1024, ...shot.renderSettings.parameters } };
  if (!settings.workflowId && !settings.presetId && !settings.referenceAssetKey) {
    const preset = listPresets(database, { appId: 'activities', purpose: 'activity_image_text', workflowId: PARITY_TEXT_WORKFLOW_ID })
      .find(p => p.enabled && String(p.values.unet_name ?? '').includes('anima_base'));
    if (preset) return { ...settings, presetId: preset.id, presetRevision: preset.revision,
      workflowId: preset.workflowId, workflowVersion: preset.workflowVersion };
  }
  return settings;
}

function requireCompletePromptBinding(effective: ReturnType<typeof resolveEffectiveActivityVisualPlan>) {
  const { resolved } = effective.selection;
  const binding = resolved.workflow.nodeBindings[effective.positiveKey];
  const node = binding ? resolved.workflow.definition[binding[0]] as { class_type?: string } | undefined : undefined;
  // A fixed StringConcatenate chain adds words after preview and would duplicate the service style.
  // Do not mutate an immutable workflow or submit a misleading "final prompt" snapshot.
  if (!binding || node?.class_type !== 'CLIPTextEncode' || binding.slice(1).join('.') !== 'inputs.text') {
    throw publicationError('publication_workflow_prompt_composition', '制作台需要正向提示词直接绑定文本编码器的完整提示词工作流。请选择“邻舍对齐 · Base/Turbo”；旧工作流内部重复拼词不能用于此模式。', 409);
  }
}

export interface FrozenImagePlan {
  shotId: string; sourceFingerprint: string; purpose: string; workflowId: string; workflowVersion: number;
  engineId: string; presetId: string | null; presetRevision: number | null;
  inputs: Record<string, unknown>; inputArtifacts: Array<{ artifactId: string; inputKey: string }>;
  loras: ActivityLora[]; positivePrompt: string; negativePrompt: string | null;
  models: string[]; definitionHash: string; configurationHash: string;
}
/** New mode is authored by the harness, not passed through the internal LLM optimizer. */
export function compilePublicationImagePrompt(doc: PublicationDocument, shot: PublicationShot): string {
  const p = shot.structuredPrompt;
  const tags = p.actors.flatMap(a => [...a.identity, ...a.appearance, ...a.clothing, ...a.action, ...a.expression]);
  const prompt = [...tags, ...p.camera, ...p.scene, ...p.details, p.naturalLanguage].filter(Boolean).join(', ');
  if (!/[a-zA-Z]{3}/u.test(prompt) || !p.scene.length || shot.actorIds.some(id => !p.actors.some(a => a.actorId === id))) {
    throw publicationError('publication_prompt_incomplete', `镜头 ${shot.id} 需要 Harness 编写完整英文场景和人物提示词，服务不会自动改写中文。`);
  }
  // 字幕由项目播放器在图外单独绘制；生图只需填满画幅，画面内不留字幕白区，也不生成任何文字、水印或气泡。
  return `${prompt}, compose the scene to fill the entire frame, no text, no watermark, no speech bubbles, no border`;
}
export function imagePlan(database: ServiceDatabase, doc: PublicationDocument, shot: PublicationShot): FrozenImagePlan {
  const actors: ActorSnapshot[] = doc.actors.filter(a => shot.actorIds.includes(a.id)).map(a => ({ id: a.id, displayName: a.name, persona: {}, activityRole: '', outfitDescription: '', visualLoras: a.loras }));
  const settings = publicationSettings(database, shot);
  const effective = resolveEffectiveActivityVisualPlan(database, { imageConfig: null, settings, actors,
    sourcePrompt: compilePublicationImagePrompt(doc, shot), seed: 0 });
  requireCompletePromptBinding(effective);
  const { selection, loras, positiveKey, negativeKey } = effective, resolved = selection.resolved;
  const triggers = loras.filter(l => l.enabled).map(l => l.triggerWord.trim()).filter(Boolean);
  const positivePrompt = [...new Set([...triggers, compilePublicationImagePrompt(doc, shot), effective.visual.stylePrompt, effective.promptPolicy.positiveSuffix].filter(Boolean))].join(', ');
  const inputs = { ...effective.parameters, [positiveKey]: positivePrompt };
  if (negativeKey) inputs[negativeKey] = effective.negativePrompt ?? '';
  const seedField = Object.entries(resolved.workflow.inputSchema).find(([key, value]) => key === 'seed' || (value as { semantic?: string }).semantic === 'seed')?.[0];
  if (seedField) inputs[seedField] = 0;
  const inputArtifacts: FrozenImagePlan['inputArtifacts'] = [];
  const references = doc.actors.filter(a => shot.actorIds.includes(a.id) && a.referenceArtifactId).map(a => a.referenceArtifactId!);
  if (shot.renderSettings.referenceAssetKey) references.push(shot.renderSettings.referenceAssetKey);
  if (references.length) {
    const key = referenceInputKey(resolved);
    if (!key || new Set(references).size !== 1) throw publicationError('publication_reference_unsupported', '所选工作流只允许一个明确参考图，不能悄悄忽略或合并多角色参考。');
    inputArtifacts.push({ inputKey: key, artifactId: references[0] });
  }
  const graph = buildActivityImageWorkflowSnapshot(resolved, inputs, 0, loras);
  return { shotId: shot.id, sourceFingerprint: shotFingerprint(doc, shot.id), purpose: selection.purpose,
    workflowId: resolved.workflow.id, workflowVersion: resolved.workflow.version, engineId: resolved.engine.id,
    presetId: selection.selectedPresetId, presetRevision: selection.selectedPresetRevision,
    inputs, inputArtifacts, loras, positivePrompt, negativePrompt: effective.negativePrompt,
    models: extractModelNames(graph), definitionHash: fingerprint(graph),
    configurationHash: fingerprint({ graph, inputs, loras, purpose: selection.purpose, engine: { id: resolved.engine.id, baseUrl: resolved.engine.baseUrl },
      presetId: selection.selectedPresetId, presetRevision: selection.selectedPresetRevision, promptPolicy: effective.promptPolicy, loraPolicy: effective.loraPolicy }) };
}
export async function preflightImage(database: ServiceDatabase, doc: PublicationDocument, shot: PublicationShot, secrets: SecretStore, fetcher: typeof fetch) {
  const effective = resolveEffectiveActivityVisualPlan(database, { imageConfig: null,
    settings: publicationSettings(database, shot),
    actors: doc.actors.filter(a => shot.actorIds.includes(a.id)).map(a => ({ id: a.id, displayName: a.name, persona: {}, activityRole: '', outfitDescription: '', visualLoras: a.loras })),
    sourcePrompt: compilePublicationImagePrompt(doc, shot), seed: 0 });
  const plan = imagePlan(database, doc, shot);
  const checked = await inspectActivityImageWorkflow(effective.selection.resolved, plan.inputs, 0, plan.loras, secrets, fetcher, true);
  if (!checked.ok) throw publicationError('publication_workflow_missing', `${shot.id}：${checked.issues.join('；')}`, 409);
  return plan;
}
