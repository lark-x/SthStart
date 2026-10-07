import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  HIRES_DENOISE_DEFAULT, HIRES_MAX_SIZE_DEFAULT, HiresPreviewRequestSchema, HiresPreviewResponseSchema,
  HiresSubmitRequestSchema, ImageOperationMetadataSchema,
} from '@sthstart/contracts';

const versions = { headVersion: 1, contentDraftVersion: 1, contentRevisionId: 'rev-1', imageConfigDraftVersion: 1, imageConfigRevisionId: 'img-1' };
const target = { kind: 'beat' as const, stageId: 's', sceneId: 'c', beatId: 'b' };

test('hires request schemas reject unknown fields and any caller-supplied paths, URLs or snapshots', () => {
  const base = { versions, target, sourceArtifactId: 'art-1' };
  assert.ok(Value.Check(HiresPreviewRequestSchema, base), 'minimal preview request is valid');
  assert.ok(Value.Check(HiresPreviewRequestSchema, { ...base, maxSize: 1536, denoise: 0.3, seed: 42 }));
  assert.ok(Value.Check(HiresSubmitRequestSchema, { ...base, seed: 42, planHash: 'hash', idempotencyKey: 'key' }));

  // 未知字段一律拒绝：服务器路径、任意 URL、输入文件名、工作流图、模型密钥、配置快照。
  for (const extra of [
    { path: 'C:/ComfyUI/input/a.png' }, { url: 'http://evil.test/a.png' }, { filename: 'a.png' },
    { workflow: { '1': { class_type: 'LoadImage', inputs: {} } } }, { apiKey: 'sk-secret' },
    { snapshot: { unet_name: 'x.safetensors' } }, { workflowId: 'anima-activity-hires-basic' },
    { engineId: 'engine-1' }, { inputs: { width: 1024 } }, { planHash: 'x' },
  ]) {
    assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, ...extra }), false, `preview must reject ${JSON.stringify(extra)}`);
  }
  assert.equal(Value.Check(HiresSubmitRequestSchema, { ...base, seed: 1, planHash: 'h', idempotencyKey: 'k', path: '/tmp/a.png' }), false);
  assert.equal(Value.Check(HiresSubmitRequestSchema, { ...base, seed: 1, planHash: 'h', idempotencyKey: 'k', inputs: {} }), false);

  // submit 必须回传预览 seed 与 planHash。
  assert.equal(Value.Check(HiresSubmitRequestSchema, { ...base, planHash: 'h', idempotencyKey: 'k' }), false);
  assert.equal(Value.Check(HiresSubmitRequestSchema, { ...base, seed: 1, idempotencyKey: 'k' }), false);
  assert.equal(Value.Check(HiresSubmitRequestSchema, { ...base, seed: 1, planHash: 'h' }), false);

  // 目标必须落在活动内的三类定位，不能夹带其它目标形态。
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, target: { kind: 'storyboard', id: 'x' } }), false);
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, target: { kind: 'media_slot', slotId: 'm', panelId: 'p' } }), false);
});

test('hires size and denoise bounds follow the plan minimum table', () => {
  const base = { versions, target, sourceArtifactId: 'art-1' };
  assert.equal(HIRES_MAX_SIZE_DEFAULT, 2000);
  assert.equal(HIRES_DENOISE_DEFAULT, 0.2);
  assert.ok(Value.Check(HiresPreviewRequestSchema, { ...base, maxSize: 512, denoise: 0.05 }));
  assert.ok(Value.Check(HiresPreviewRequestSchema, { ...base, maxSize: 2048, denoise: 0.35 }));
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, maxSize: 511 }), false);
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, maxSize: 2049 }), false);
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, maxSize: 1536.5 }), false);
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, denoise: 0.04 }), false);
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, denoise: 0.36 }), false);
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, seed: -1 }), false);
  assert.equal(Value.Check(HiresPreviewRequestSchema, { ...base, seed: 2_147_483_648 }), false);
  assert.ok(Value.Check(HiresPreviewRequestSchema, { ...base, seed: 2_147_483_647 }));
});

test('hires preview response carries the frozen source snapshot, computed size and plan hash', () => {
  const response = {
    canSubmit: true, issues: [],
    sourceArtifactId: 'art-1', sourceGenerationTaskId: 'task-1', sourceCallId: null,
    sourceFingerprint: 'fp', sourceWidth: 768, sourceHeight: 512,
    outputWidth: 2000, outputHeight: 1336, maxSize: 2000, denoise: 0.2, seed: 7,
    loaders: { unetName: 'anima_baseV10.safetensors', clipName: 'anima_baseV10_txt.safetensors', vaeName: 'qwen_image_vae.safetensors' },
    sampler: { steps: 31, cfg: 5, samplerName: 'er_sde', scheduler: 'beta', denoise: 0.2 },
    positivePrompt: '@ebora, 1girl', negativePrompt: 'score_1',
    loras: [{ model: 'a.safetensors', strength: 0.8, triggerWord: 'trig', enabled: true }],
    workflowId: 'anima-activity-hires-basic', workflowVersion: 1, engineId: 'engine-1',
    planHash: 'plan', transparencyHint: null, sourceChanged: false,
  };
  assert.ok(Value.Check(HiresPreviewResponseSchema, response));
  // 完整预览必须包含实际模型／编码器／VAE、采样参数、正负提示词、LoRA 与 planHash。
  for (const key of ['loaders', 'sampler', 'positivePrompt', 'negativePrompt', 'loras', 'planHash', 'workflowId', 'engineId']) {
    assert.ok(key in response, `preview response must include ${key}`);
  }
  // 旧调用方可能只有 null 提示；不承诺固定 2000×某高度，只回显实际计算尺寸。
  assert.ok(Value.Check(HiresPreviewResponseSchema, { ...response, transparencyHint: '来源图带透明区域。', sourceChanged: true, sourceCallId: 'call-1' }));
  assert.equal(Value.Check(HiresPreviewResponseSchema, { ...response, extra: 1 }), false);
  assert.equal(Value.Check(HiresPreviewResponseSchema, { ...response, sourceWidth: 0 }), false);
  assert.equal(Value.Check(HiresPreviewResponseSchema, { ...response, outputHeight: 4 }), false);
  assert.equal(Value.Check(HiresPreviewResponseSchema, { ...response, canSubmit: 'yes' }), false);
});

test('image operation metadata is optional for old rows and strict when present', () => {
  assert.ok(Value.Check(ImageOperationMetadataSchema, { operation: 'render', parentArtifactId: null, studioJobId: null }));
  assert.ok(Value.Check(ImageOperationMetadataSchema, { operation: 'hires', parentArtifactId: 'art-0', studioJobId: 'job-1' }));
  assert.equal(Value.Check(ImageOperationMetadataSchema, { operation: 'upscale', parentArtifactId: null, studioJobId: null }), false);
  assert.equal(Value.Check(ImageOperationMetadataSchema, { operation: 'hires', parentArtifactId: null }), false);
  assert.equal(Value.Check(ImageOperationMetadataSchema, { operation: 'hires', parentArtifactId: null, studioJobId: null, extra: 1 }), false);
});
