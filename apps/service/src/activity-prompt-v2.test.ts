import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_IMAGE_COMPILER_VERSION,
  compileVisualPrompt,
  dedupeSegments,
  isServiceFinalizedAssembly,
  normalizeTagKey,
  scanPromptSegments,
} from './activities/image-prompt-v2.js';
import { parseStructuredOptimization } from './activities/image-prompt-structured.js';
import { finalizeActivityVisualPrompt, v2FinalizeInputFrom } from './activities/image-render-common.js';

// ---------------------------------------------------------------- 第二轮修复（计划 §5.3／§8）
// 用例名统一带 `parity-round2:`，便于按计划 §8 的命令只跑本轮定向用例。
// 这里走「模拟 LLM 输出 → parser → finalizer」的完整组装路径，而不是只断言某个字段。

const SERVICE_FINALIZED = { promptAssembly: 'service-finalized-v1' } as const;

/** 统计某个标签在最终串里出现的次数（按逗号切分后精确匹配，避免子串误判）。 */
function countTag(prompt: string, tag: string): number {
  return prompt.split(',').map((part) => part.trim()).filter((part) => part === tag).length;
}

/** 单人物：走完整 parser → finalizer 路径。 */
function runSingleActor() {
  const content = JSON.stringify({
    actors: [{
      actorId: 'a1',
      identity: ['hu_tao (genshin impact)'],
      appearance: ['long brown hair', 'red eyes'],
      clothing: ['black hat'],
      action: ['standing'],
      expression: ['smile'],
    }],
    camera: ['full body'],
    scene: ['night'],
    details: ['cherry blossoms'],
    naturalLanguage: 'a calm night scene',
  });
  const parsed = parseStructuredOptimization({
    content,
    finishReason: 'stop',
    actorScope: [{ actorId: 'a1', displayName: '研究员' }],
    knowledgeMode: 'none',
    sourcePrompt: '研究员站在夜里',
  });
  // 生产调用点传的是**优化器结果**，其结构化块字段名是 `visualBlocks`
  // （`image-prompt-optimizer.ts:316` 把 `structuredResult.blocks` 映射为 `visualBlocks`）。
  // 这里必须复现同一形状，否则收尾拿不到结构化块，会退回把已编译串当自然语言。
  const final = finalizeActivityVisualPrompt(
    parsed.optimizedPrompt,
    'anima style',
    [{ enabled: true, triggerWord: 'anima_trigger' } as never],
    v2FinalizeInputFrom(SERVICE_FINALIZED, { visualBlocks: parsed.blocks }),
  );
  return final;
}

test('parity-round2: 单人物身份只输出一次（label 承载身份，body 不重复）', () => {
  const final = runSingleActor();
  assert.equal(countTag(final, 'hu_tao (genshin impact)'), 1,
    `身份必须恰好出现一次，实际输出：${final}`);
});

test('parity-round2: 已编译结果不再被当作自然语言二次拼装（动作/景别各一份）', () => {
  const final = runSingleActor();
  assert.equal(countTag(final, 'standing'), 1, `动作必须恰好一次，实际输出：${final}`);
  assert.equal(countTag(final, 'full body'), 1, `景别必须恰好一次，实际输出：${final}`);
  assert.equal(countTag(final, 'long brown hair'), 1, `外观必须恰好一次，实际输出：${final}`);
});

test('parity-round2: 画风与 LoRA 触发词保持唯一组装', () => {
  const final = runSingleActor();
  assert.equal(countTag(final, 'anima style'), 1, `画风必须恰好一次，实际输出：${final}`);
  assert.equal(countTag(final, 'anima_trigger'), 1, `触发词必须恰好一次，实际输出：${final}`);
});

test('parity-round2: 双人物分别归属，相同衣服标签各出现一次', () => {
  const content = JSON.stringify({
    actors: [
      { actorId: 'a1', identity: ['hu_tao (genshin impact)'], appearance: ['long brown hair'], clothing: ['black coat'], action: ['standing'], expression: ['smile'] },
      { actorId: 'a2', identity: ['zhongli (genshin impact)'], appearance: ['short black hair'], clothing: ['black coat'], action: ['sitting'], expression: ['calm'] },
    ],
    camera: ['full body'],
    scene: ['night'],
    details: ['cherry blossoms'],
    naturalLanguage: 'two people at night',
  });
  const parsed = parseStructuredOptimization({
    content,
    finishReason: 'stop',
    actorScope: [{ actorId: 'a1' }, { actorId: 'a2' }],
    knowledgeMode: 'none',
    sourcePrompt: '两个人在夜里',
  });

  // 先确认解析结果本身是对的：两个人的 clothing 都还在，且编译串里有两份 black coat。
  assert.deepEqual(parsed.blocks.characters.map((actor) => actor.clothing), [['black coat'], ['black coat']],
    '解析阶段不得丢掉第二个角色的相同标签');
  assert.equal(countTag(parsed.optimizedPrompt, 'black coat'), 2,
    `parser 编译结果应有两份，实际：${parsed.optimizedPrompt}`);

  const final = finalizeActivityVisualPrompt(
    parsed.optimizedPrompt, 'anima style', [],
    v2FinalizeInputFrom(SERVICE_FINALIZED, { visualBlocks: parsed.blocks }),
  );

  assert.equal(countTag(final, 'black coat'), 2,
    `两个人各自的 black coat 都必须保留，实际输出：${final}`);
  assert.equal(countTag(final, 'hu_tao (genshin impact)'), 1, `实际输出：${final}`);
  assert.equal(countTag(final, 'zhongli (genshin impact)'), 1, `实际输出：${final}`);
  assert.equal(countTag(final, 'standing'), 1, `实际输出：${final}`);
  assert.equal(countTag(final, 'sitting'), 1, `实际输出：${final}`);
});

test('parity-round2: 无人物输入只允许空 actors，返回人物一律拒绝', () => {
  assert.throws(() => parseStructuredOptimization({
    content: JSON.stringify({
      actors: [{
        actorId: 'a1', identity: ['someone'], appearance: ['long hair'],
        clothing: ['coat'], action: ['standing'], expression: ['calm'],
      }],
      camera: ['full body'], scene: ['night'], details: ['cherry blossoms'], naturalLanguage: 'a scene',
    }),
    finishReason: 'stop',
    actorScope: [],
    knowledgeMode: 'none',
    sourcePrompt: '空场景',
  }), (error: { code?: string }) => error.code === 'prompt_optimizer_actor_scope_invalid');
});

test('scanPromptSegments keeps weighted groups and commas inside brackets intact', () => {
  const { segments } = scanPromptSegments('(long hair:1.2, red eyes:0.9), smile, [black hat]');
  assert.equal(segments.length, 3);
  assert.equal(segments[0].raw, '(long hair:1.2, red eyes:0.9)');
  assert.equal(segments[1].base, 'smile');
  assert.equal(segments[2].base, 'black hat');
});

test('scanPromptSegments extracts explicit weights and keeps them separate from the base tag', () => {
  const { segments } = scanPromptSegments('(long hair:1.3), long hair, [black hat]');
  assert.equal(segments[0].base, 'long hair');
  assert.equal(segments[0].weight, '1.3');
  assert.equal(segments[1].weight, null);
  assert.equal(segments[2].base, 'black hat');
});

test('nested weight expressions stay opaque instead of being merged into one weight', () => {
  const { segments, warnings } = scanPromptSegments('((red eyes:0.8):0.5)');
  assert.equal(segments.length, 1);
  assert.equal(segments[0].opaque, true);
  assert.equal(segments[0].raw, '((red eyes:0.8):0.5)');
  assert.equal(segments[0].weight, null);
  assert.equal(warnings.length, 1);
});

test('scanPromptSegments marks unbalanced brackets opaque and never rewrites them', () => {
  const { segments, warnings } = scanPromptSegments('(broken:1.2, smile');
  assert.equal(segments.length, 1);
  assert.equal(segments[0].opaque, true);
  assert.equal(segments[0].raw, '(broken:1.2, smile');
  assert.equal(warnings.length, 1);
});

test('scanPromptSegments honours escaped separators', () => {
  const { segments } = scanPromptSegments('tag\\,with\\,commas, second');
  assert.equal(segments.length, 2);
  assert.equal(segments[0].base, 'tag\\,with\\,commas');
});

test('same normalized tag with the same weight is deduplicated inside one scope', () => {
  const segments = scanPromptSegments('long hair, Long_Hair, smile').segments;
  const result = dedupeSegments(segments, 'camera');
  assert.deepEqual(result.kept.map((segment) => segment.raw), ['long hair', 'smile']);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].scope, 'camera');
});

test('different explicit weights are kept and reported instead of silently merged', () => {
  const segments = scanPromptSegments('(long hair:1.3), (long hair:0.7)').segments;
  const result = dedupeSegments(segments, 'style');
  assert.equal(result.kept.length, 2);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /多个显式权重/);
});

test('two characters may share the same hair colour without losing the second block', () => {
  const compiled = compileVisualPrompt({
    personCount: '2girls',
    characters: [
      { actorId: 'a', identity: ['hu tao (genshin impact)'], appearance: ['long brown hair', 'red eyes'], action: ['standing'] },
      { actorId: 'b', identity: ['fischl (genshin impact)'], appearance: ['long brown hair', 'green eyes'], action: ['sitting'] },
    ],
    naturalLanguage: 'the two characters face each other',
  });
  assert.match(compiled.positive, /2girls/);
  const hairCount = compiled.positive.match(/long brown hair/g)?.length ?? 0;
  assert.equal(hairCount, 2, 'second character keeps the same hair colour');
  assert.match(compiled.positive, /hu tao \(genshin impact\)/);
  assert.match(compiled.positive, /fischl \(genshin impact\)/);
});

test('opposite poses of different characters are preserved', () => {
  const compiled = compileVisualPrompt({
    personCount: '1girl, 1boy',
    characters: [
      { actorId: 'a', identity: ['alice'], action: ['standing'] },
      { actorId: 'b', identity: ['bob'], action: ['sitting'] },
    ],
  });
  assert.match(compiled.positive, /standing/);
  assert.match(compiled.positive, /sitting/);
});

test('an unknown actor count is never guessed and no solo tag is invented', () => {
  const compiled = compileVisualPrompt({ naturalLanguage: 'two figures in a hallway' });
  assert.doesNotMatch(compiled.positive, /\bsolo\b/);
  assert.doesNotMatch(compiled.positive, /\b1girl\b/);
});

test('an empty scene produces no solo tag', () => {
  const compiled = compileVisualPrompt({ camera: ['wide shot'], environment: ['empty street'] });
  assert.doesNotMatch(compiled.positive, /\bsolo\b/);
  assert.match(compiled.positive, /wide shot/);
});

test('assembly follows the documented order and keeps one copy of the style string', () => {
  const compiled = compileVisualPrompt({
    loraTriggers: ['my_lora_trigger'],
    stylePrompt: '@ebora, masterpiece, best quality',
    personCount: '1girl',
    characters: [{ actorId: 'a', identity: ['alice'], appearance: ['long hair'] }],
    camera: ['full body'],
    environment: ['night'],
    details: ['cherry blossoms'],
    naturalLanguage: 'a quiet evening walk',
  });
  const order = ['my_lora_trigger', '@ebora', 'masterpiece', '1girl', 'alice', 'long hair', 'full body', 'night', 'cherry blossoms', 'a quiet evening walk'];
  let cursor = -1;
  for (const token of order) {
    const index = compiled.positive.indexOf(token);
    assert.ok(index > cursor, `${token} must appear after the previous block`);
    cursor = index;
  }
  assert.equal(compiled.positive.match(/@ebora/g)?.length, 1);
  assert.equal(compiled.diagnostics.compilerVersion, ACTIVITY_IMAGE_COMPILER_VERSION);
});

test('global style, camera and environment are deduplicated across their own scopes', () => {
  const compiled = compileVisualPrompt({
    stylePrompt: 'masterpiece, masterpiece, best quality',
    camera: ['full body', 'full_body'],
    environment: ['night', 'masterpiece'],
    details: ['cherry blossoms', 'cherry_blossoms'],
  });
  assert.equal(compiled.positive.match(/masterpiece/g)?.length, 1);
  assert.equal(compiled.positive.match(/full[ _]body/g)?.length, 1);
  assert.equal(compiled.positive.match(/cherry[ _]blossoms/g)?.length, 1);
  assert.equal(compiled.positive.match(/\bnight\b/g)?.length, 1);
});

test('lora trigger words match whole tags, not substrings of other tags', () => {
  // `hair` is a substring of the body tag `long hair`; a naive includes() check would drop the trigger.
  const compiled = compileVisualPrompt({
    loraTriggers: ['hair', 'hair', 'detailed_face'],
    naturalLanguage: 'long hair flowing in the wind',
  });
  assert.ok(compiled.positive.startsWith('hair,'), compiled.positive);
  assert.equal(compiled.positive.match(/detailed_face/g)?.length, 1);
  // 同一触发词列表内的重复只保留一次。
  assert.equal(compiled.positive.split(', ').filter((part) => part === 'hair').length, 1);
});

test('a trigger word already present in the body is not prepended a second time', () => {
  const compiled = compileVisualPrompt({
    loraTriggers: ['detailed_face'],
    stylePrompt: 'detailed_face, masterpiece',
  });
  assert.equal(compiled.positive.match(/detailed_face/g)?.length, 1);
  assert.ok(compiled.diagnostics.removedTags.some((entry) => entry.scope === 'lora_trigger'));
});

test('duplicate trigger words inside one list are reported as removed', () => {
  const compiled = compileVisualPrompt({ loraTriggers: ['alpha', 'alpha'] });
  assert.equal(compiled.positive.match(/\balpha\b/g)?.length, 1);
  assert.ok(compiled.diagnostics.removedTags.some((entry) => entry.reason === '同一触发词列表内重复'));
});

test('director constraints keep their explicit wording and outrank nothing silently', () => {
  const compiled = compileVisualPrompt({
    directorConstraints: ['close-up', 'from above'],
    camera: ['full body'],
  });
  assert.match(compiled.positive, /close-up/);
  assert.match(compiled.positive, /full body/);
});

test('natural language keeps required relationship sentences instead of being stripped', () => {
  const compiled = compileVisualPrompt({
    characters: [{ actorId: 'a', action: ['standing'] }, { actorId: 'b', action: ['sitting'] }],
    naturalLanguage: 'alice rests her hand on bob shoulder',
  });
  assert.match(compiled.positive, /alice rests her hand on bob shoulder/);
});

test('an anonymous multi-actor scene gets positional relationship labels instead of invented ids', () => {
  const compiled = compileVisualPrompt({
    personCount: '2girls',
    characters: [{ actorId: 'unknown-1', appearance: ['long hair'] }, { actorId: 'unknown-2', appearance: ['short hair'] }],
  });
  assert.match(compiled.positive, /the character on the left/);
  assert.match(compiled.positive, /the character on the right/);
  assert.doesNotMatch(compiled.positive, /unknown-1/);
});

test('normalizeTagKey and isServiceFinalizedAssembly behave as documented', () => {
  assert.equal(normalizeTagKey('  Long-Hair '), 'long_hair');
  assert.equal(normalizeTagKey('红色眼睛'), '红色眼睛');
  assert.equal(isServiceFinalizedAssembly({ promptAssembly: 'service-finalized-v1' }), true);
  assert.equal(isServiceFinalizedAssembly({ promptAssembly: 'other' }), false);
  assert.equal(isServiceFinalizedAssembly(null), false);
});
