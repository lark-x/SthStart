import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkDirectTextEncoderBindings,
  encodedTextEntries,
  findSamplerTextEncoders,
  readActualEncodedTexts,
  resolveWorkflowTextValue,
} from './activities/image-prompt-snapshot.js';

/** 当前数据库里 anima-activity-1080p-eval v4 的真实形状：参数写在空拼接节点 117 上。 */
const LEGACY_V4 = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'anima_baseV10.safetensors' } },
  '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'anima_baseV10_txt.safetensors' } },
  '4': { class_type: 'StringConcatenate', inputs: { string_a: ['117', 0], string_b: 'high quality, detailed illustration', delimiter: ', ' } },
  '5': { class_type: 'StringConcatenate', inputs: { string_a: ['4', 0], string_b: 'digital illustration', delimiter: ', ' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: ['5', 0] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'score_1, score_2' } },
  '8': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 512 } },
  '9': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0], seed: 1 } },
  '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
  '117': { class_type: 'StringConcatenate', inputs: { string_a: '', string_b: '', delimiter: '' } },
};

/** v5/v6：工作流在服务端合成之后再追加一次固定画师／质量串。 */
const LEGACY_V5 = {
  ...LEGACY_V4,
  '4': { class_type: 'StringConcatenate', inputs: { string_a: '@ebora', string_b: ['5', 0], delimiter: '' } },
  '5': { class_type: 'StringConcatenate', inputs: { string_a: ',masterpiece, best quality, score_9,', string_b: ['117', 0], delimiter: '' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: ['4', 0] } },
};

/** 新工作流族：正／负提示词直接绑定编码器 text。 */
const SERVICE_FINALIZED = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'anima_baseV10.safetensors' } },
  '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'anima_baseV10_txt.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
  '8': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 512 } },
  '9': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0], seed: 1 } },
  '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
  '11': { class_type: 'SaveImage', inputs: { images: ['10', 0] } },
};

test('direct encoder bindings read back exactly the text that reaches CLIPTextEncode', () => {
  const rendered = structuredClone(SERVICE_FINALIZED);
  (rendered['6'] as { inputs: Record<string, unknown> }).inputs.text = '@ebora, masterpiece, 1girl, alice, long hair';
  (rendered['7'] as { inputs: Record<string, unknown> }).inputs.text = 'score_1, score_2';
  const texts = readActualEncodedTexts(rendered);
  assert.equal(texts.positive.resolvable, true);
  assert.equal(texts.positive.resolvable && texts.positive.text, '@ebora, masterpiece, 1girl, alice, long hair');
  assert.equal(texts.negative.resolvable && texts.negative.text, 'score_1, score_2');
  assert.equal(texts.positiveNodeId, '6');
  assert.equal(texts.negativeNodeId, '7');
});

test('legacy concat chains are reassembled with their real delimiters and order', () => {
  const rendered = structuredClone(LEGACY_V4);
  (rendered['117'] as { inputs: Record<string, unknown> }).inputs.string_a = 'alice standing';
  const texts = readActualEncodedTexts(rendered);
  assert.equal(texts.positive.resolvable, true);
  assert.equal(texts.positive.resolvable && texts.positive.text,
    'alice standing, high quality, detailed illustration, digital illustration');
  // 旧图必须能看出这是解析结果，而不是请求字段。
  assert.equal(texts.positive.resolvable && texts.positive.nodeIds.includes('5'), true);
});

test('a fixed style chain appended after the source is visible in the actual encoded text', () => {
  const rendered = structuredClone(LEGACY_V5);
  (rendered['117'] as { inputs: Record<string, unknown> }).inputs.string_a = 'alice standing';
  const texts = readActualEncodedTexts(rendered);
  assert.equal(texts.positive.resolvable, true);
  assert.equal(texts.positive.resolvable && texts.positive.text,
    '@ebora,masterpiece, best quality, score_9,alice standing');
});

test('concat cycles and unknown nodes are refused instead of guessed', () => {
  const cyclic = {
    '6': { class_type: 'CLIPTextEncode', inputs: { text: ['5', 0] } },
    '5': { class_type: 'StringConcatenate', inputs: { string_a: ['4', 0], string_b: 'x', delimiter: ', ' } },
    '4': { class_type: 'StringConcatenate', inputs: { string_a: ['5', 0], string_b: 'y', delimiter: ', ' } },
    '9': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'neg' } },
  };
  const texts = readActualEncodedTexts(cyclic);
  assert.equal(texts.positive.resolvable, false);
  assert.match(texts.positive.resolvable === false ? texts.positive.reason : '', /循环/);

  const unknown = {
    '6': { class_type: 'CLIPTextEncode', inputs: { text: ['42', 0] } },
    '42': { class_type: 'SomeCustomTextNode', inputs: { anything: 'value' } },
    '9': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'neg' } },
  };
  const unknownTexts = readActualEncodedTexts(unknown);
  assert.equal(unknownTexts.positive.resolvable, false);
  assert.match(unknownTexts.positive.resolvable === false ? unknownTexts.positive.reason : '', /SomeCustomTextNode/);
});

test('a concat node without a delimiter is refused rather than joined with a guessed separator', () => {
  const definition = {
    '4': { class_type: 'StringConcatenate', inputs: { string_a: 'a', string_b: 'b' } },
  };
  const result = resolveWorkflowTextValue(definition, ['4', 0]);
  assert.equal(result.resolvable, false);
  assert.match(result.resolvable === false ? result.reason : '', /分隔符/);
});

test('multiple samplers never produce a guessed source', () => {
  const definition = {
    ...structuredClone(SERVICE_FINALIZED),
    '12': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0], seed: 2 } },
  };
  const links = findSamplerTextEncoders(definition);
  assert.equal(links.ambiguous, true);
  const texts = readActualEncodedTexts(definition);
  assert.equal(texts.positive.resolvable, false);
  assert.equal(texts.samplerNodeId, null);
});

test('publication check accepts only direct text-encoder bindings', () => {
  const ok = checkDirectTextEncoderBindings(SERVICE_FINALIZED,
    { prompt: ['6', 'inputs', 'text'], negativePrompt: ['7', 'inputs', 'text'] },
    { positiveKey: 'prompt', negativeKey: 'negativePrompt' });
  assert.equal(ok.ok, true, ok.issues.join('; '));

  const legacy = checkDirectTextEncoderBindings(LEGACY_V4,
    { prompt: ['117', 'inputs', 'string_a'], negativePrompt: ['7', 'inputs', 'text'] },
    { positiveKey: 'prompt', negativeKey: 'negativePrompt' });
  assert.equal(legacy.ok, false);
  assert.ok(legacy.issues.some((issue) => issue.includes('117')));

  const concatTarget = checkDirectTextEncoderBindings(
    { ...structuredClone(SERVICE_FINALIZED), '6': { class_type: 'CLIPTextEncode', inputs: { text: ['5', 0] } }, '5': { class_type: 'StringConcatenate', inputs: { string_a: 'a', string_b: 'b', delimiter: ', ' } } },
    { prompt: ['6', 'inputs', 'text'], negativePrompt: ['7', 'inputs', 'text'] },
    { positiveKey: 'prompt', negativeKey: 'negativePrompt' });
  assert.equal(concatTarget.ok, false);
  assert.ok(concatTarget.issues.some((issue) => issue.includes('自行拼接')));

  const missingNegative = checkDirectTextEncoderBindings(SERVICE_FINALIZED,
    { prompt: ['6', 'inputs', 'text'] }, { positiveKey: 'prompt', negativeKey: null });
  assert.equal(missingNegative.ok, false);
});

test('the log exposes the text that actually reaches the encoders, and never invents one', () => {
  // 实际派发的图里，模板占位已被真实文本替换。
  const dispatched = structuredClone(SERVICE_FINALIZED);
  dispatched['6'].inputs.text = '1girl, solo, masterpiece, best quality';
  dispatched['7'].inputs.text = 'score_1, score_2';
  const entries = encodedTextEntries(dispatched);
  assert.deepEqual(entries.map((entry) => entry.role), ['positive', 'negative']);
  assert.equal(entries[0].nodeId, '6');
  assert.equal(entries[0].input, 'text');
  assert.match(entries[0].text, /masterpiece/);
  assert.match(entries[1].text, /score_1/);

  // 老式工作流只要拼接链上的分隔符可确定，就能读出真实编码文本——
  // 这正是“从中文来源到实际文本编码输入”的证据，也直接暴露 P-1 的双重追加。
  const legacyEntries = encodedTextEntries(LEGACY_V4);
  assert.equal(legacyEntries.length, 2);
  assert.match(legacyEntries[0].text, /high quality, detailed illustration/);
  assert.equal(legacyEntries[0].nodeId, '6');

  // 分隔符缺失等无法确定的情况：只给能确定的那一侧，不猜缺失的一侧。
  const partial = encodedTextEntries({ '4': { class_type: 'StringConcatenate', inputs: { string_a: 'a', string_b: 'b' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: ['4', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'neg' } },
    '9': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0] } } });
  assert.deepEqual(partial.map((entry) => entry.role), ['negative']);
  // 非工作流形状的输入同样不能抛错或编造。
  assert.deepEqual(encodedTextEntries(null), []);
  assert.deepEqual(encodedTextEntries({ workflowId: 'x', sourcePrompt: '中文来源' }), []);
});
