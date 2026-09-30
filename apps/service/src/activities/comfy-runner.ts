import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { streamUploadArtifact } from '../artifacts.js';
import type { GenerateBeatMediaRequest, GenerateBeatMediaResponse, ContentDocument, ActivityScene, SceneBeat } from '@sthstart/contracts';

interface ComfyProgressCallback {
  (progress: { phase: string; progress?: number; step?: number; totalSteps?: number; promptId?: string }): void;
}

interface ComfyRunnerOptions {
  fetcher?: typeof fetch;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
}

/**
 * 编译具有角色强一致性锁定的分镜提示词
 */
export function findEffectiveBeat(
  document: ContentDocument,
  stageId: string,
  beatId: string,
): { scene: ActivityScene; beat: SceneBeat } | null {
  const stage = document.stages?.find((item) => item.id === stageId);
  if (!stage) return null;
  const topLevelScenes = (document.scenes || []).filter((scene) => scene.stageId === stageId);
  const nestedScenes = (stage.scenes || []).filter((scene) => !scene.stageId || scene.stageId === stageId);
  const nestedById = new Map(nestedScenes.map((scene) => [scene.id, scene]));
  const scenes = topLevelScenes.length === 0
    ? nestedScenes.map((scene) => ({ ...scene, stageId }))
    : Array.from(new Map(topLevelScenes.map((scene) => [scene.id, scene])).values()).map((scene) => {
        const legacy = nestedById.get(scene.id);
        if (!legacy) return { ...scene, stageId };
        const legacyBeats = new Map(legacy.beats.map((beat) => [beat.id, beat]));
        const topBeats = Array.from(new Map(scene.beats.map((beat) => [beat.id, beat])).values());
        return {
          ...scene,
          stageId,
          beats: topBeats.map((beat) => {
            const oldBeat = legacyBeats.get(beat.id);
            return oldBeat ? {
              ...beat,
              mediaUrl: beat.mediaUrl === undefined ? oldBeat.mediaUrl : beat.mediaUrl,
              mediaType: beat.mediaType === undefined ? oldBeat.mediaType : beat.mediaType,
            } : beat;
          }),
        };
      });
  for (const scene of scenes) {
    const beat = scene.beats.find((item) => item.id === beatId);
    if (beat) return { scene, beat };
  }
  return null;
}

export function compileBeatPrompt(
  database: ServiceDatabase,
  document: ContentDocument,
  stageId: string,
  beatId: string,
  customPrompt?: string
): {
  positivePrompt: string;
  negativePrompt: string;
  characterConsistent: boolean;
  actorName: string;
} {
  const stage = document.stages?.find((s) => s.id === stageId);
  const target = findEffectiveBeat(document, stageId, beatId);
  if (!target) throw new Error('beat_not_found');
  const targetBeat = target.beat;
  const targetScene = target.scene;

  const actorName = targetBeat.characterName || document.actors.find((actor) => actor.id === targetBeat.characterId)?.displayName || targetBeat.characterId || '主角';
  const action = targetBeat?.action || '';
  const dialogue = targetBeat?.dialogue || '';
  const outcome = targetBeat?.outcome || '';

  // 从本地角色数据库读取角色核心外貌资产，彻底杜绝变脸
  let characterAppearance = '';
  let characterOutfit = '';
  let characterLora = '';
  let consistent = false;

  try {
    const profileRow = database.connection.prepare(`
      SELECT display_name, draft_json FROM character_profiles
      WHERE (display_name = ? OR id = ?) AND archived = 0
      LIMIT 1
    `).get(actorName, actorName) as { display_name: string; draft_json: string } | undefined;

    if (profileRow?.draft_json) {
      const draft = JSON.parse(profileRow.draft_json);
      consistent = true;
      const v2 = draft.v2 || draft;
      const appearance = v2.appearance || {};
      const visualSummary = appearance.visualSummary || v2.visualSummary || '';
      const outfit = appearance.outfitDescription || v2.outfitDescription || '';
      const tags = Array.isArray(v2.tags) ? v2.tags.join(', ') : '';

      characterAppearance = visualSummary ? `appearance: ${visualSummary}` : '';
      characterOutfit = outfit ? `outfit: ${outfit}` : '';
      if (tags) characterLora = `features: ${tags}`;
    }
  } catch {
    // 忽略数据库查询错误
  }

  // 场次时空要素
  const timeContext = targetScene.timeText;
  const locationContext = targetScene.locationText || stage?.location || '';
  const atmosphere = targetScene.environment || '';

  const promptParts: string[] = [];

  // 1. 画师串与画质锚点（吸收邻舍 v3.6.0 标准工作流）
  promptParts.push('masterpiece, best quality, highres, absurdres, 8k resolution');
  promptParts.push('@ebora, cinematic lighting, finely detailed');

  // 2. 底座硬约束（角色特征锁定与外貌）
  promptParts.push(`1person, solo, character: ${actorName}`);
  if (characterAppearance) promptParts.push(characterAppearance);
  if (characterOutfit) promptParts.push(characterOutfit);
  if (characterLora) promptParts.push(characterLora);

  // 3. 场景时空与环境氛围
  if (locationContext) promptParts.push(`environment: ${locationContext}`);
  if (timeContext) promptParts.push(`time: ${timeContext}`);
  if (atmosphere) promptParts.push(`atmosphere: ${atmosphere}`);

  // 4. 分镜动作与情感对白
  if (action) promptParts.push(`action: ${action}`);
  if (dialogue) promptParts.push(`expression: speaking thoughtfully, emotional nuance`);
  if (outcome) promptParts.push(`story outcome: ${outcome}`);

  // 5. 自定义提示词修饰
  if (customPrompt?.trim()) {
    promptParts.push(customPrompt.trim());
  }

  const positivePrompt = promptParts.filter(Boolean).join(', ');
  const negativePrompt = 'score_1, score_2, score_3, bad anatomy, bad hands, bad proportions, deformed anatomy, deformed face, deformed eyes, multiple fingers, text, watermark, artist name, censor, mosaic, signature, logo, shadows, highlights, strong lighting, dramatic lighting, rim light, backlighting, high contrast, volumetric lighting, lowres, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, blurry, mutated hands, poorly drawn face, mutation, deformed, dehydrated, disfigured, extra limbs';

  return {
    positivePrompt,
    negativePrompt,
    characterConsistent: consistent,
    actorName,
  };
}

/**
 * 执行 ComfyUI 渲染任务（吸收 Linshe 的通信逻辑与重试模式）
 */
export async function executeComfyBeatRender(
  config: ServiceConfig,
  database: ServiceDatabase,
  activityId: string,
  request: GenerateBeatMediaRequest,
  onProgress?: ComfyProgressCallback,
  options: ComfyRunnerOptions = {},
): Promise<GenerateBeatMediaResponse> {
  if (request.mediaType === 'video') throw new Error('video_generation_not_supported');
  if (request.mediaType && request.mediaType !== 'image') throw new Error('unsupported_media_type');
  if (request.seed !== undefined && (!Number.isSafeInteger(request.seed) || request.seed < 0 || request.seed > 2147483647)) throw new Error('invalid_seed');
  if (request.steps !== undefined && (!Number.isInteger(request.steps) || request.steps < 1 || request.steps > 100)) throw new Error('invalid_steps');
  if (request.cfg !== undefined && (!Number.isFinite(request.cfg) || request.cfg < 1 || request.cfg > 30)) throw new Error('invalid_cfg');
  for (const size of [request.width, request.height]) {
    if (size !== undefined && (!Number.isInteger(size) || size < 64 || size > 2048 || size % 8 !== 0)) throw new Error('invalid_image_dimensions');
  }
  const fetcher = options.fetcher || fetch;
  // 读取当前活动的草稿文档
  const draftRow = database.connection.prepare(
    'SELECT document_json, draft_version FROM activity_drafts WHERE activity_id = ?'
  ).get(activityId) as { document_json: string; draft_version: number } | undefined;

  if (!draftRow?.document_json) {
    throw new Error('activity_draft_not_found');
  }

  const document: ContentDocument = JSON.parse(draftRow.document_json);
  const seed = request.seed ?? Math.floor(Math.random() * 2147483647);
  const mediaType = 'image';

  // 编译具备角色锁定的提示词
  const { positivePrompt, negativePrompt, characterConsistent, actorName } = compileBeatPrompt(
    database,
    document,
    request.stageId,
    request.beatId,
    request.customPrompt
  );

  // 智能寻找可用 ComfyUI 引擎（未指定时自动回退到首个可用引擎）
  const engineRow = request.engineId
    ? (database.connection.prepare(
        "SELECT id, base_url FROM generation_engines WHERE id = ? AND enabled = 1 AND kind = 'comfyui'"
      ).get(request.engineId) as { id: string; base_url: string } | undefined)
    : (database.connection.prepare(
        "SELECT id, base_url FROM generation_engines WHERE enabled = 1 AND kind = 'comfyui' ORDER BY id ASC LIMIT 1"
      ).get() as { id: string; base_url: string } | undefined);

  if (!engineRow?.base_url) throw new Error('comfy_engine_unavailable');
  const comfyUrl = engineRow.base_url.replace(/\/+$/, '');
  let imageBuffer: Buffer | null = null;
  let contentType = 'image/png';

  // 连接失败必须显式报错，不能落盘模拟素材。
  try {
    const isAvailable = await fetcher(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false);

    if (!isAvailable) throw new Error('comfy_connection_failed');
    {
      if (onProgress) onProgress({ phase: 'connected', progress: 0.1 });

      // 动态获取可用的 Checkpoint 模型（未指定时自动探测可用模型列表）
      let selectedCheckpoint = request.checkpoint;
      if (!selectedCheckpoint) {
        try {
          const objInfoRes = await fetcher(`${comfyUrl}/object_info/CheckpointLoaderSimple`, { signal: AbortSignal.timeout(3000) });
          if (objInfoRes.ok) {
            const objInfo = (await objInfoRes.json()) as any;
            const ckptList = objInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
            if (Array.isArray(ckptList) && ckptList.length > 0) {
              selectedCheckpoint = ckptList.find((c: string) => /anime|turbo|xl|sd/i.test(c)) || ckptList[0];
            }
          }
        } catch {
          // fallback
        }
        if (!selectedCheckpoint) {
          selectedCheckpoint = 'anima_turboV10.safetensors';
        }
      }

      // 构建标准文生图 Prompt 结构（KSampler + CheckpointLoaderSimple + CLIPTextEncode）
      const clientId = randomUUID();
      const promptPayload = {
        client_id: clientId,
        prompt: {
          '3': {
            class_type: 'KSampler',
            inputs: {
              cfg: request.cfg ?? 7.5,
              denoise: 1,
              latent_image: ['5', 0],
              model: ['4', 0],
              negative: ['7', 0],
              positive: ['6', 0],
              sampler_name: 'euler_ancestral',
              scheduler: 'karras',
              seed,
              steps: request.steps ?? 25,
            },
          },
          '4': {
            class_type: 'CheckpointLoaderSimple',
            inputs: {
              ckpt_name: selectedCheckpoint,
            },
          },
          '5': {
            class_type: 'EmptyLatentImage',
            inputs: {
              batch_size: 1,
              height: request.height ?? 512,
              width: request.width ?? 896, // 16:9 宽画幅
            },
          },
          '6': {
            class_type: 'CLIPTextEncode',
            inputs: {
              clip: ['4', 1],
              text: positivePrompt,
            },
          },
          '7': {
            class_type: 'CLIPTextEncode',
            inputs: {
              clip: ['4', 1],
              text: request.negativePrompt || negativePrompt,
            },
          },
          '8': {
            class_type: 'VAEDecode',
            inputs: {
              samples: ['3', 0],
              vae: ['4', 2],
            },
          },
          '9': {
            class_type: 'SaveImage',
            inputs: {
              filename_prefix: `sthstart_${activityId}_beat`,
              images: ['8', 0],
            },
          },
        },
      };

      const promptRes = await fetcher(`${comfyUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promptPayload),
        signal: AbortSignal.timeout(10000),
      });

      if (promptRes.ok) {
        const { prompt_id: promptId } = (await promptRes.json()) as { prompt_id?: unknown };
        if (typeof promptId !== 'string' || !promptId.trim()) throw new Error('comfy_invalid_prompt_response');
        if (onProgress) onProgress({ phase: 'queued', promptId, progress: 0.2 });

        // 轮询历史记录（参考 Linshe downloadImagesFromHistory 的重试模式）
        const maxPollAttempts = options.maxPollAttempts ?? 120;
        const pollIntervalMs = options.pollIntervalMs ?? 1500;
        for (let i = 0; i < maxPollAttempts; i++) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          let imageInfo: { filename: string; subfolder?: string; type?: string } | undefined;
          try {
            const histRes = await fetcher(`${comfyUrl}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(3000) });
            if (histRes.ok) {
              const hist = (await histRes.json()) as Record<string, any>;
              const candidate = hist[promptId]?.outputs?.['9']?.images?.[0];
              if (candidate && typeof candidate.filename === 'string') imageInfo = candidate;
            }
          } catch {
            // 继续等待轮询
          }

          if (!imageInfo) continue;
          const viewUrl = `${comfyUrl}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || '')}&type=${encodeURIComponent(imageInfo.type || 'output')}`;
          let dlRes: Response;
          try {
            dlRes = await fetcher(viewUrl, { signal: AbortSignal.timeout(15000) });
          } catch {
            continue;
          }
          if (!dlRes.ok) continue;
          const downloadedImage = Buffer.from(await dlRes.arrayBuffer());
          contentType = dlRes.headers.get('content-type') || 'image/png';
          const isPng = downloadedImage.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
          const isJpeg = downloadedImage[0] === 0xff && downloadedImage[1] === 0xd8 && downloadedImage[2] === 0xff;
          const isWebp = downloadedImage.toString('ascii', 0, 4) === 'RIFF'
            && downloadedImage.toString('ascii', 8, 12) === 'WEBP';
          const isSupportedRaster = (contentType.includes('png') && isPng)
            || ((contentType.includes('jpeg') || contentType.includes('jpg')) && isJpeg)
            || (contentType.includes('webp') && isWebp);
          if (!isSupportedRaster || downloadedImage.length === 0) throw new Error('comfy_invalid_image_output');
          imageBuffer = downloadedImage;
          break;
        }
      } else {
        throw new Error(`comfy_prompt_rejected: ${promptRes.status}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('comfy_')) throw error;
    throw new Error('comfy_request_failed', { cause: error });
  }

  if (!imageBuffer) throw new Error('comfy_output_timeout');

  // 将生成产物落盘入 SthStart 统一媒体仓库
  const ext = contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') ? 'jpg' : 'png';
  const filename = `beat_${request.stageId}_${request.beatId}_${seed}.${ext}`;

  const artifact = await streamUploadArtifact(config, database, {
    appId: 'activities',
    stream: Readable.from([imageBuffer]),
    contentType,
    originalName: filename,
    refType: 'activity-beat',
    refId: `${activityId}:${request.beatId}`,
    metadata: {
      activityId,
      stageId: request.stageId,
      beatId: request.beatId,
      actorName,
      seed,
      characterConsistent,
    },
  });

  const mediaUrl = `/api/admin/artifacts/${artifact.id}/file`;

  return {
    success: true,
    mediaUrl,
    mediaType,
    promptUsed: positivePrompt,
    seed,
    characterConsistent,
    stageId: request.stageId,
    beatId: request.beatId,
  };
}
