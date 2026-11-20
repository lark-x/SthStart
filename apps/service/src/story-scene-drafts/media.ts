import { statSync } from 'node:fs';
import type { SceneAdoption, SceneDirection, SceneImage, StorySceneActionRequest, StorySceneDraft } from '@sthstart/contracts';
import { createArtifactReference, resolveArtifactFilePath } from '../artifacts.js';
import type { ServiceConfig } from '../config.js';
import { CREATIVE_APP_ID, CREATIVE_IMAGE_PURPOSE, CREATIVE_TEXT_PURPOSE } from '../creative.js';
import { createWorldManuscriptDocument } from '../creative-orchestration/copilot.js';
import { nowIso, type ServiceDatabase } from '../database.js';
import type { InputSchemaMap } from '../generation/configuration.js';
import { sanitizeErrorMessage } from '../generation/errors.js';
import { createGenerationTask } from '../generation/execution.js';
import { mergeImageParameters, resolveImageConfiguration } from '../generation/image-configuration.js';
import { getGenerationTask } from '../generation/task-store.js';
import type { SecretStore } from '../security.js';
import { StoryWorldError } from '../story-worlds/store.js';
import { SceneDraftError } from './store.js';

type GenerateImage = Extract<StorySceneActionRequest, { action: 'generate-image' }>;
type Adopt = Extract<StorySceneActionRequest, { action: 'adopt' }>;

const directionLabels: Record<SceneDirection, string> = {
  'canon-gap': '原作走向 · 补写留白',
  'canon-adaptation': '原作走向 · 画面改编',
  if: 'IF 线',
  original: '原创',
};
const sourceLabels = { canon: '原作', secondary: '二手资料', unknown: '性质待确认', author: '作者提供' };

function inlineMarkdown(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[\\`*_{}\[\]()<>#|~]/g, '\\$&');
}

function manuscriptBody(draft: StorySceneDraft, artifactId: string | undefined): string {
  const cited = new Set([
    ...(draft.start?.timeEvidence.sourceIds ?? []),
    ...(draft.start?.locationEvidence.sourceIds ?? []),
  ]);
  const sourceLines = draft.sources.filter(source => cited.has(source.id)).map(source => {
    const name = [source.work, source.title].filter(Boolean).join(' · ');
    return `${sourceLabels[source.kind]} · ${inlineMarkdown(name)}${source.locator ? ` · ${inlineMarkdown(source.locator)}` : ''} · 第 ${source.startLine}–${source.endLine} 行`;
  });
  for (const source of draft.authorSources) {
    const label = `作者提供 · ${inlineMarkdown(source.title)}${source.locator ? ` · ${inlineMarkdown(source.locator)}` : ''}`;
    if (!sourceLines.some(line => line.startsWith(`${label} · 第 `))) sourceLines.push(label);
  }

  const direction = draft.direction ? directionLabels[draft.direction] : '未指定';
  const sections = [draft.body, '---', '### 一幕故事 · 收录信息', `走向：**${direction}** · 正文版本 ${draft.bodyVersion}`];
  if (draft.direction === 'if' && draft.brief?.divergence?.trim()) {
    sections.push(`分歧点：${inlineMarkdown(draft.brief.divergence)}`);
  }
  if (sourceLines.length) sections.push(`出处\n\n${[...new Set(sourceLines)].map(source => `- ${source}`).join('\n')}`);
  if (artifactId) sections.push(`![本幕代表画面](/api/admin/creative/artifacts/${encodeURIComponent(artifactId)})`);
  return sections.join('\n\n');
}

export function createSceneDraftMedia({ config, database, secrets, fetcher }: {
  config: ServiceConfig; database: ServiceDatabase; secrets: SecretStore; fetcher?: typeof fetch;
}) {
  function isPreviewable(artifactId: string): boolean {
    const row = database.connection.prepare(`SELECT local_path FROM artifacts
      WHERE id=? AND app_id=? AND file_status='ready' AND content_type LIKE 'image/%' AND media_type='image'`)
      .get(artifactId, CREATIVE_APP_ID) as { local_path: string | null } | undefined;
    // The existing creative preview endpoint streams the stored local file.
    if (!row?.local_path) return false;
    try {
      const file = statSync(row.local_path);
      return file.isFile() && file.size > 0;
    } catch {
      return false;
    }
  }

  function readImageTask(image: SceneImage): SceneImage {
    const { artifactId: _artifactId, error: _error, ...snapshot } = image;
    const task = getGenerationTask(database, image.taskId, CREATIVE_APP_ID);
    if (!task) return { ...snapshot, status: 'failed', error: '找不到这次生成任务。' };
    const message = task.errorMessage ? sanitizeErrorMessage(task.errorMessage).slice(0, 300) : undefined;
    if (task.upstreamMayContinue) {
      return { ...snapshot, status: 'uncertain', error: message || '上游仍可能在生成，请等待任务恢复。' };
    }
    switch (task.status) {
      case 'succeeded': {
        const preview = task.artifacts.find(artifact => artifact.mediaKind === 'image' && isPreviewable(artifact.artifactId));
        if (preview) return { ...snapshot, status: 'succeeded', artifactId: preview.artifactId };
        return { ...snapshot, status: 'failed', error: '任务已完成，但没有可预览的图片。' };
      }
      case 'queued': return { ...snapshot, status: 'queued' };
      case 'submitting': case 'accepted': case 'running': return { ...snapshot, status: 'running' };
      default: return { ...snapshot, status: 'failed', error: message || '这次生成没有完成，可以重新提交。' };
    }
  }

  async function generateImage(draft: StorySceneDraft, request: GenerateImage, actionId: string, onInserted: (taskId: string) => void): Promise<string> {
    const plan = draft.imagePlan;
    if (!draft.body.trim() || !plan || plan.bodyVersion !== draft.bodyVersion || !plan.moment.trim() || !plan.subject.trim()) {
      throw new SceneDraftError('image_plan_required', '请先确认适用于当前正文的画面方案。');
    }
    const referenceArtifactId = plan.referenceArtifactId;
    const purpose = referenceArtifactId ? CREATIVE_IMAGE_PURPOSE : CREATIVE_TEXT_PURPOSE;
    const selection = { appId: CREATIVE_APP_ID, purpose, presetId: request.configId };
    let resolved: ReturnType<typeof resolveImageConfiguration>;
    try {
      resolved = resolveImageConfiguration(database, selection);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code && !code.startsWith('ERR_')) {
        throw new SceneDraftError(code, referenceArtifactId
          ? '当前图生图配置不可用。请选择可用的图生图预设，或移除参考图后使用文生图。'
          : '当前文生图配置不可用，请在生成设置中配置或选择可用预设。', 409);
      }
      throw error;
    }
    const { workflow, engine, configuration, preset } = resolved;
    const { promptKey, referenceInputKey } = configuration;
    if (!promptKey || !['comfyui', 'cloud'].includes(engine.kind) || workflow.engineKind !== engine.kind) {
      throw new SceneDraftError('image_configuration_unavailable', '此生成配置无法提交画面方案，请选择其他有效配置。', 409);
    }
    if (referenceArtifactId && !referenceInputKey) {
      throw new SceneDraftError('image_reference_unsupported', '当前配置无法接收参考图。请选择支持参考图的图生图配置，或移除参考图后生成。', 409);
    }

    const description = [
      ['角色', draft.character.name], ['瞬间', plan.moment], ['主体', plan.subject], ['机位', plan.camera],
      ['前后站位', plan.blocking], ['关键动作', plan.action], ['空间遮挡', plan.occlusion], ['画风与参考', plan.style],
    ].filter(([, value]) => value.trim()).map(([label, value]) => `${label}：${value.trim()}`).join('\n');
    // The task API only merges defaults when a preset is selected. Legacy ComfyUI
    // workflows already carry defaults in their graph, while cloud consumes named inputs.
    const defaults = !preset && (workflow.configFormatVersion >= 2 || engine.kind === 'cloud')
      ? Object.fromEntries(Object.entries(workflow.inputSchema as InputSchemaMap)
        .filter(([key, field]) => field.default != null && field.default !== '' && workflow.editorConfig?.fields[key]?.section !== 'fixed')
        .map(([key, field]) => [key, field.default]))
      : {};
    const inputs = { ...defaults, [promptKey]: description };
    const inputArtifacts = referenceArtifactId && referenceInputKey ? [{ artifactId: referenceArtifactId, inputKey: referenceInputKey }] : [];
    try {
      if (engine.kind === 'cloud') {
        const effective = mergeImageParameters(resolved, inputs);
        if ((effective.operation || workflow.definition.operation || purpose) !== purpose) {
          throw new SceneDraftError('image_configuration_unavailable', '当前配置的图片操作与参考图选择不匹配，请更换配置。', 409);
        }
      }
      if (referenceArtifactId) {
        const image = database.connection.prepare("SELECT local_path,storage_key FROM artifacts WHERE id=? AND file_status='ready' AND media_type='image' AND content_type LIKE 'image/%'")
          .get(referenceArtifactId) as { local_path: string | null; storage_key: string | null } | undefined;
        if (!image || !resolveArtifactFilePath(image, config.artifactDirectory)) {
          throw new SceneDraftError('image_reference_unavailable', '参考图片当前无法读取，请重新上传或移除。', 409);
        }
      }
      const task = await createGenerationTask(config, database, secrets, {
        appId: CREATIVE_APP_ID,
        purpose,
        idempotencyKey: `story-scene-draft:${actionId}`,
        ...(preset ? { presetId: preset.preset.id, presetRevision: preset.preset.revision } : {}),
        inputs,
        inputArtifacts,
        priority: 'interactive',
        validationMode: 'strict',
        audit: {
          feature: 'story-scene-drafts', businessEvent: 'story_scene.generate_image', objectType: 'story-scene-draft', objectId: draft.id,
          traceId: actionId, positivePrompt: description,
          visualConfiguration: { configurationHash: configuration.configurationHash, promptMode: configuration.promptMode },
        },
        onInsertTask: ({ taskId }) => onInserted(taskId),
      }, fetcher);
      return task.id;
    } catch (error) {
      if (error instanceof SceneDraftError) throw error;
      const code = (error as { code?: string }).code;
      if (code && !code.startsWith('ERR_') && error instanceof Error) {
        throw new SceneDraftError(code, sanitizeErrorMessage(error.message).slice(0, 300), 409);
      }
      throw error;
    }
  }

  function adopt(draft: StorySceneDraft, request: Adopt, onAdopted: (adoption: SceneAdoption) => void): SceneAdoption {
    if (draft.adoption) return draft.adoption;
    if (!draft.body.trim()) throw new SceneDraftError('body_required', '请先写好这一幕。');
    const title = draft.title.trim() || `${draft.character.name}的一幕`;
    const artifactId = draft.images.slice().reverse()
      .filter(image => image.bodyVersion === draft.bodyVersion && image.planVersion === draft.imagePlan?.version)
      .map(readImageTask)
      .find(image => image.status === 'succeeded')?.artifactId;
    let adoption: SceneAdoption | undefined;
    try {
      createWorldManuscriptDocument(database, request.worldId, {
        kind: 'scene', title, body: manuscriptBody(draft, artifactId), projectId: request.projectId,
      }, {
        requireExplicitProject: true,
        onCreated(document) {
          if (artifactId) createArtifactReference(database, { appId: CREATIVE_APP_ID, artifactId, refType: 'story-document', refId: document.id });
          adoption = {
            worldId: request.worldId, projectId: document.projectId, documentId: document.id,
            href: `/apps/story/${encodeURIComponent(document.projectId)}?entry=${encodeURIComponent(document.id)}`,
            bodyVersion: draft.bodyVersion, createdAt: nowIso(),
          };
          onAdopted(adoption);
        },
      });
    } catch (error) {
      if (error instanceof StoryWorldError) throw new SceneDraftError(error.code, error.message, error.statusCode);
      throw error;
    }
    return adoption!;
  }

  return { generateImage, readImageTask, adopt };
}
