import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyScopedKnowledgeRules, isNegatedNearby, knowledgeDatasetInfo, retrieveImagePromptKnowledge,
  selectExecutableTagsForScope, tokenizeKnowledgeQuery, toKnowledgeHits,
} from './activities/image-prompt-knowledge.js';
import {
  buildStructuredSystemPrompt, parseStructuredOptimization, STRUCTURED_ERROR_CODES,
} from './activities/image-prompt-structured.js';
import { PARITY_KNOWLEDGE_ITEMS } from './activities/image-prompt-knowledge-data.js';

test('the trimmed vocabulary records its source, version and content hash', () => {
  const info = knowledgeDatasetInfo();
  assert.match(info.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(info.sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(info.contentHash, /^[0-9a-f]{64}$/);
  assert.match(info.datasetVersion, /^linshe-parity-1\+[0-9a-f]{8}$/);
  assert.ok(info.itemCount > 0 && info.tagCount > 0);
  // 成人专用类别必须已被裁剪，且裁剪后不残留任何 adult_ 前缀条目。
  assert.equal(PARITY_KNOWLEDGE_ITEMS.some((item) => item.category.startsWith('adult_')), false);
});

test('keyword retrieval marks itself keyword and refuses vector or hybrid', () => {
  const result = retrieveImagePromptKnowledge('夜景 站姿 全身 镜头', { mode: 'keyword' });
  assert.equal(result.mode, 'keyword');
  assert.match(result.note, /关键词/);
  assert.ok(result.items.length > 0);
  assert.throws(() => retrieveImagePromptKnowledge('x', { mode: 'vector' }), (error: Error & { code?: string }) => error.code === 'knowledge_mode_unsupported');
  assert.throws(() => retrieveImagePromptKnowledge('x', { mode: 'hybrid' }), (error: Error & { code?: string }) => error.code === 'knowledge_mode_unsupported');
});

test('tokenize keeps latin words and sliding Han n-grams', () => {
  const terms = tokenizeKnowledgeQuery('穿地雷系服装 selfie');
  assert.ok(terms.includes('selfie'));
  assert.ok(terms.includes('地雷'));
  assert.ok(terms.includes('地雷系'));
});

test('scopes are independent so a second character keeps the same tag', () => {
  const items = retrieveImagePromptKnowledge('long hair red eyes', { mode: 'keyword', limit: 24 }).items;
  const first = selectExecutableTagsForScope('long hair', items, { scope: 'actor:a', existingKeys: new Set() });
  const second = selectExecutableTagsForScope('long hair', items, { scope: 'actor:b', existingKeys: new Set() });
  assert.deepEqual(first.selected.map((item) => item.tag), second.selected.map((item) => item.tag));
});

test('a tag already present in the scope is not added again', () => {
  const items = retrieveImagePromptKnowledge('long hair', { mode: 'keyword', limit: 24 }).items;
  const withExisting = selectExecutableTagsForScope('long hair', items, {
    scope: 'actor:a', existingKeys: new Set(['long_hair']),
  });
  assert.equal(withExisting.selected.some((item) => item.key === 'long_hair'), false);
});

test('each scope is capped at nine knowledge tags', () => {
  const items = retrieveImagePromptKnowledge('girl standing sitting long hair red eyes smile night', { mode: 'keyword', limit: 40 }).items;
  const selection = selectExecutableTagsForScope('girl standing sitting long hair red eyes smile night', items, { scope: 'actor:a' });
  assert.ok(selection.selected.length <= 9, `got ${selection.selected.length}`);
});

test('negated wording is reported instead of being added, and never rewrites the source', () => {
  const items = [{
    knowledgeId: 'test.hair', category: 'character_vocabulary', title: 'hair', searchTerms: 'hair', content: '',
    isDefault: false, priority: 50, scenes: [], executableTags: [{ tag: 'long_hair', label: '长发', group: '' }],
  }];
  const source = 'no long hair';
  const selection = selectExecutableTagsForScope(source, items, { scope: 'actor:a' });
  assert.equal(selection.selected.length, 0);
  assert.ok(selection.removedTags.some((entry) => /否定/.test(entry.reason)));
  assert.equal(source, 'no long hair', 'source text is never rewritten');
  assert.equal(isNegatedNearby('no long hair', 'long hair'), true);
  assert.equal(isNegatedNearby('without long hair', 'long hair'), true);
  assert.equal(isNegatedNearby('she has long hair', 'long hair'), false);
});

test('scoped rules only touch that scope tag array and never natural language', () => {
  const items = PARITY_KNOWLEDGE_ITEMS.filter((item) => item.knowledgeId.startsWith('ipk.') && !item.knowledgeId.startsWith('ipk.lib.'));
  assert.ok(items.some((item) => item.knowledgeId === 'ipk.gaze.sleep'));
  const sourceText = 'she is sleeping at night';
  const applied = applyScopedKnowledgeRules({
    items,
    sourceText,
    tags: ['looking_at_viewer', 'daytime'],
  });
  // 规则补上 sleep 需要的闭眼，并清掉该作用域里与睡眠／夜晚冲突的标签。
  assert.equal(applied.tags.includes('closed_eyes'), true);
  assert.equal(applied.tags.includes('looking_at_viewer'), false);
  assert.equal(applied.tags.includes('daytime'), false);
  assert.ok(applied.removedTags.length >= 2);
  assert.ok(applied.appliedRules.length >= 2);
  // 规则从不返回或改写自然语言：来源文本必须原样保留。
  assert.equal(sourceText, 'she is sleeping at night');
  assert.equal('text' in applied, false);
});

test('knowledge hits carry the owning actor for multi-character diagnostics', () => {
  const selected = [{ tag: 'long_hair', key: 'long_hair', category: 'character_vocabulary', knowledgeId: 'ipk.lib.character.001', score: 20, priority: 55, reason: 'matched:tag' }];
  assert.deepEqual(toKnowledgeHits(selected, 'actor-b'), [{
    knowledgeId: 'ipk.lib.character.001', actorId: 'actor-b', tags: ['long_hair'], score: 20, reason: 'matched:tag',
  }]);
  assert.equal(toKnowledgeHits(selected, null)[0].actorId, null);
});

// ── 结构化分支 ──

const VALID_JSON = JSON.stringify({
  actors: [{
    actorId: 'a', identity: ['alice'], appearance: ['long hair'], clothing: ['blue dress'],
    action: ['standing'], expression: ['smile'],
  }],
  camera: ['full body'], scene: ['night'], details: ['cherry blossoms'],
  naturalLanguage: 'a quiet walk',
});

test('structured parsing accepts a valid payload and compiles scoped blocks', () => {
  const result = parseStructuredOptimization({
    content: VALID_JSON, finishReason: 'stop',
    actorScope: [{ actorId: 'a', displayName: 'Alice' }],
    knowledgeMode: 'none', sourcePrompt: 'alice standing',
  });
  assert.equal(result.blocks.characters.length, 1);
  assert.equal(result.blocks.characters[0].actorId, 'a');
  assert.deepEqual(result.blocks.camera, ['full body']);
  assert.deepEqual(result.blocks.environment, ['night']);
  assert.equal(result.blocks.naturalLanguage, 'a quiet walk');
  assert.match(result.optimizedPrompt, /alice/);
  assert.match(result.optimizedPrompt, /full body/);
  assert.equal(result.knowledgeVersion, null);
});

test('structured parsing strips markdown fences and surrounding prose', () => {
  const result = parseStructuredOptimization({
    content: '```json\n' + VALID_JSON + '\n```', finishReason: 'stop',
    actorScope: [{ actorId: 'a' }], knowledgeMode: 'none', sourcePrompt: '',
  });
  assert.equal(result.structured.actors[0].actorId, 'a');
});

test('structured errors use the exact documented codes', () => {
  const base = { actorScope: [{ actorId: 'a' }], knowledgeMode: 'none' as const, sourcePrompt: '' };
  assert.throws(() => parseStructuredOptimization({ ...base, content: 'not json at all', finishReason: 'stop' }),
    (error: Error & { code?: string }) => error.code === STRUCTURED_ERROR_CODES.invalidJson);
  assert.throws(() => parseStructuredOptimization({ ...base, content: VALID_JSON, finishReason: 'length' }),
    (error: Error & { code?: string }) => error.code === STRUCTURED_ERROR_CODES.truncated);
  assert.throws(() => parseStructuredOptimization({ ...base, content: '{"actors":[{"actorId":"a"', finishReason: 'stop' }),
    (error: Error & { code?: string }) => error.code === STRUCTURED_ERROR_CODES.truncated);
});

test('actor scope mismatches are rejected in both directions', () => {
  const twoActors = JSON.stringify({
    actors: [
      { actorId: 'a', identity: [], appearance: [], clothing: [], action: [], expression: [] },
      { actorId: 'b', identity: [], appearance: [], clothing: [], action: [], expression: [] },
    ],
    camera: [], scene: [], details: [], naturalLanguage: '',
  });
  // 目标 2 人、返回 1 人
  assert.throws(() => parseStructuredOptimization({
    content: VALID_JSON, finishReason: 'stop', actorScope: [{ actorId: 'a' }, { actorId: 'b' }],
    knowledgeMode: 'none', sourcePrompt: '',
  }), (error: Error & { code?: string }) => error.code === STRUCTURED_ERROR_CODES.actorScope);
  // 目标 1 人、返回 2 人
  assert.throws(() => parseStructuredOptimization({
    content: twoActors, finishReason: 'stop', actorScope: [{ actorId: 'a' }],
    knowledgeMode: 'none', sourcePrompt: '',
  }), (error: Error & { code?: string }) => error.code === STRUCTURED_ERROR_CODES.actorScope);
  // 未知 actorId
  assert.throws(() => parseStructuredOptimization({
    content: twoActors, finishReason: 'stop', actorScope: [{ actorId: 'a' }, { actorId: 'c' }],
    knowledgeMode: 'none', sourcePrompt: '',
  }), (error: Error & { code?: string }) => error.code === STRUCTURED_ERROR_CODES.actorScope);
});

test('an empty actor scope requires an empty actors array', () => {
  const noActors = JSON.stringify({ actors: [], camera: ['wide shot'], scene: [], details: [], naturalLanguage: '' });
  const result = parseStructuredOptimization({
    content: noActors, finishReason: 'stop', actorScope: [], knowledgeMode: 'none', sourcePrompt: 'empty street',
  });
  assert.equal(result.blocks.characters.length, 0);
  assert.deepEqual(result.blocks.camera, ['wide shot']);
  assert.throws(() => parseStructuredOptimization({
    content: VALID_JSON, finishReason: 'stop', actorScope: [], knowledgeMode: 'none', sourcePrompt: '',
  }), (error: Error & { code?: string }) => error.code === STRUCTURED_ERROR_CODES.actorScope);
});

test('keyword knowledge is only added when the mode asks for it', () => {
  const off = parseStructuredOptimization({
    content: VALID_JSON, finishReason: 'stop', actorScope: [{ actorId: 'a' }],
    knowledgeMode: 'none', sourcePrompt: 'alice long hair standing',
  });
  assert.deepEqual(off.knowledgeHits, []);
  assert.equal(off.knowledgeVersion, null);

  const on = parseStructuredOptimization({
    content: VALID_JSON, finishReason: 'stop', actorScope: [{ actorId: 'a' }],
    knowledgeMode: 'keyword', sourcePrompt: 'alice 全身 站姿 夜景 樱花',
  });
  assert.equal(on.knowledgeVersion !== null, true);
  assert.ok(on.knowledgeHits.length > 0);
  assert.ok(on.knowledgeHits.every((hit) => hit.actorId === null || hit.actorId === 'a'));
});

test('the structured system prompt pins the exact actorId list', () => {
  const prompt = buildStructuredSystemPrompt({
    instructions: 'Return JSON only.',
    actorScope: [{ actorId: 'a', displayName: 'Alice' }, { actorId: 'b' }],
  });
  assert.match(prompt, /Return JSON only\./);
  assert.match(prompt, /a \(Alice\), b/);
  assert.match(prompt, /恰好出现一次/);
  const empty = buildStructuredSystemPrompt({ instructions: 'Return JSON only.', actorScope: [] });
  assert.match(empty, /actors 必须是空数组/);
});

test('keyword rules route additions into the right slot and keep natural language untouched', () => {
  const singleActor = JSON.stringify({
    actors: [{ actorId: 'a', identity: ['alice'], appearance: [], clothing: [], action: ['standing'], expression: [] }],
    camera: ['full body'], scene: ['night'], details: [], naturalLanguage: '她在夜里散步，两人并肩。',
  });
  const result = parseStructuredOptimization({
    content: singleActor, finishReason: 'stop', actorScope: [{ actorId: 'a' }],
    knowledgeMode: 'keyword', sourcePrompt: 'alice 站姿 全身 夜景',
  });
  // 单人场景由 ipk.count.solo 规则补出人数标签，而不是猜 1girl／1boy。
  assert.equal(result.blocks.personCount, 'solo');
  // 自然语言一字不改：关系句必须保留。
  assert.equal(result.blocks.naturalLanguage, '她在夜里散步，两人并肩。');
  assert.match(result.optimizedPrompt, /solo/);
});

test('an explicit person count is never overwritten by a rule', () => {
  const result = parseStructuredOptimization({
    content: VALID_JSON, finishReason: 'stop', actorScope: [{ actorId: 'a' }],
    knowledgeMode: 'keyword', sourcePrompt: 'alice 站姿', personCount: '1girl',
  });
  assert.equal(result.blocks.personCount, '1girl');
});

test('knowledge tags already present in the model output are not duplicated', () => {
  const result = parseStructuredOptimization({
    content: VALID_JSON, finishReason: 'stop', actorScope: [{ actorId: 'a' }],
    knowledgeMode: 'keyword', sourcePrompt: 'alice long hair blue dress standing smile',
  });
  const flat = [
    ...result.blocks.characters.flatMap((actor) => [...(actor.identity ?? []), ...(actor.appearance ?? []),
      ...(actor.clothing ?? []), ...(actor.action ?? []), ...(actor.expression ?? [])]),
    ...(result.blocks.camera ?? []), ...(result.blocks.environment ?? []), ...(result.blocks.details ?? []),
  ];
  const keys = flat.map((tag) => tag.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ').trim().replace(/\s+/g, '_'));
  assert.equal(new Set(keys).size, keys.length, `duplicate tags: ${keys.join(', ')}`);
});
