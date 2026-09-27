import assert from 'node:assert/strict';
import test from 'node:test';
import { SecretStore } from '../security.js';
import { inspectWorkflowRuntime } from './runtime-preflight.js';

const engine = { id: 'anima-comfy', kind: 'comfyui', baseUrl: 'http://comfy.test', credentialAccount: null };

test('runtime preflight checks the installed Anima model, text encoder, VAE, and node classes', async () => {
  const graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'anima_baseV10.safetensors' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'anima_baseV10_txt.safetensors' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '4': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
  };
  const fetcher: typeof fetch = async () => Response.json({
    UNETLoader: { input: { required: { unet_name: [['anima_baseV10.safetensors', 'anima_turboV10.safetensors'], {}] } } },
    CLIPLoader: { input: { required: { clip_name: [['other_text_encoder.safetensors'], {}] } } },
    VAELoader: { input: { required: { vae_name: [['other_vae.safetensors'], {}] } } },
    SaveImage: { input: { required: { images: ['IMAGE', {}] } } },
  });

  const result = await inspectWorkflowRuntime(engine, graph, new SecretStore({}), fetcher);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('anima_baseV10_txt.safetensors')));
  assert.ok(result.issues.some((issue) => issue.includes('qwen_image_vae.safetensors')));
  assert.ok(!result.issues.some((issue) => issue.includes('anima_baseV10.safetensors')),
    'the selected diffusion model is present and should pass validation');
});

test('runtime preflight blocks missing custom nodes and malformed graph links', async () => {
  const malformedGraph = { '1': { class_type: 'CustomPromptJoin', inputs: { text: ['missing-node', 0] } } };
  const graphWithMissingClass = { '1': { class_type: 'CustomPromptJoin', inputs: { text: 'hello' } } };
  const fetcher: typeof fetch = async () => Response.json({});

  const malformed = await inspectWorkflowRuntime(engine, malformedGraph, new SecretStore({}), fetcher);
  assert.equal(malformed.ok, false);
  assert.ok(malformed.issues.some((issue) => issue.includes('不存在的节点 missing-node')));

  const missingClass = await inspectWorkflowRuntime(engine, graphWithMissingClass, new SecretStore({}), fetcher);
  assert.equal(missingClass.ok, false);
  assert.ok(missingClass.issues.some((issue) => issue.includes('CustomPromptJoin')));
});
