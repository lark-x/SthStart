import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CharacterUpstreamApplyRequestSchema,
  CharacterUpstreamEvidenceSourceSchema,
  CharacterUpstreamResearchPreviewSchema,
  CharacterVariantSchema,
  stripMachineCharacterIndex,
  type CharacterDraftV2,
  type CharacterUpstreamAssetCandidate,
  type CharacterUpstreamEvidenceSource,
  type CharacterUpstreamSkinProposal,
} from './index.js';

test('upstream source contract preserves complete evidence and source identity while accepting legacy excerpts', () => {
  const legacy = { title: '正文', url: null, excerpt: '摘要', sourceType: 'bwiki' };
  assert.equal(Value.Check(CharacterUpstreamEvidenceSourceSchema, legacy), true);
  const full = { ...legacy, rawText: '完整原文'.repeat(5000), rawPayload: { parse: { wikitext: { '*': '完整原文' } } },
    provider: 'bwiki', externalId: 'ys:55', contentHash: 'a'.repeat(64), retrievedAt: '2026-11-16T00:00:00Z', evidenceKind: 'fulltext' };
  assert.equal(Value.Check(CharacterUpstreamEvidenceSourceSchema, full), true);
  assert.equal(Value.Check(CharacterUpstreamEvidenceSourceSchema, { ...full, evidenceKind: 'guessed' }), false);
});

test('stripMachineCharacterIndex removes machine index lines and keeps persona sections', () => {
  const input = [
    '### 身份',
    '  【MCP角色索引】{"characterId":"dan-heng"}',
    '丹恒是星穹列车的护卫，习惯先观察局势再行动。',
    '',
    '',
    '',
    '【MCP角色索引】{"aliases":["冷面小青龙"]}',
    '### 言谈与边界',
    '语气冷静、措辞简短，不主动谈论不属于自己世界观的现实常识。',
  ].join('\n');

  assert.equal(
    stripMachineCharacterIndex(input),
    [
      '### 身份',
      '丹恒是星穹列车的护卫，习惯先观察局势再行动。',
      '',
      '### 言谈与边界',
      '语气冷静、措辞简短，不主动谈论不属于自己世界观的现实常识。',
    ].join('\n'),
  );
  assert.equal(stripMachineCharacterIndex(''), '');
});

test('CharacterVariantSchema accepts variant kinds and portrait fields plus legacy variants', () => {
  for (const variantKind of ['stage', 'sp', 'form'] as const) {
    assert.equal(
      Value.Check(CharacterVariantSchema, {
        id: `variant-${variantKind}`,
        name: `形态 ${variantKind}`,
        variantKind,
        portraitAssetId: `portrait-asset-${variantKind}`,
        portraitUrl: `/api/admin/characters/assets/portrait-asset-${variantKind}`,
      }),
      true,
      `${variantKind} should be accepted`,
    );
  }

  assert.equal(
    Value.Check(CharacterVariantSchema, {
      id: 'legacy-variant',
      name: '旧版衍生形态',
      isDefault: false,
    }),
    true,
    'legacy variants without variantKind/portrait fields should remain valid',
  );
  assert.equal(
    Value.Check(CharacterVariantSchema, {
      id: 'null-portrait-variant',
      name: '无头像衍生形态',
      portraitAssetId: null,
      portraitUrl: null,
    }),
    true,
  );
  assert.equal(
    Value.Check(CharacterVariantSchema, {
      id: 'invalid-variant',
      name: '非法形态',
      variantKind: 'skin',
    }),
    false,
  );
});

test('upstream preview and apply contracts accept selected variants and skins', () => {
  const draft: CharacterDraftV2 = {
    schemaVersion: 2,
    displayName: '丹恒',
    englishName: 'Dan Heng',
    aliases: ['冷面小青龙'],
    originType: 'ip',
    work: '崩坏：星穹铁道',
    summary: '星穹列车的护卫，谨慎而可靠。',
    personaText: '### 身份\n丹恒是星穹列车的护卫。',
    speechText: '语气冷静，习惯用简短句子表达判断。',
    dialogueExamples: ['初次见面：\n用户：你是谁？\n角色：丹恒，星穹列车的护卫。'],
    behaviorRules: '保持仙舟与星穹列车的世界观认知边界。',
    appearance: {
      baseText: '黑发、青绿色眼睛，身形清瘦。',
      defaultOutfitText: '深色列车制服与长枪。',
    },
  };

  const variant: CharacterUpstreamSkinProposal = {
    id: 'variant-dan-heng-il',
    name: '丹恒•饮月',
    classification: 'variant',
    variantKind: 'sp',
    outfitDescription: '青白色龙族礼服，带有鳞片与云纹装饰。',
    loreStory: '丹恒接纳前尘后展现的饮月形态。',
    avatarUrl: 'https://example.test/dan-heng-il-avatar.png',
    portraitUrl: 'https://example.test/dan-heng-il-portrait.png',
    source: 'StarRailRes',
    isDefault: false,
    selected: true,
  };

  const skin: CharacterUpstreamSkinProposal = {
    id: 'skin-dan-heng-coat',
    name: '丹恒·巡星',
    classification: 'skin',
    outfitDescription: '深蓝长风衣与银色列车徽章。',
    loreStory: '列车组为长途探索准备的特别装束。',
    portraitUrl: 'https://example.test/dan-heng-coat.png',
    source: 'BWiki',
    selected: true,
  };

  const assets: CharacterUpstreamAssetCandidate[] = [
    {
      id: 'asset-avatar',
      kind: 'avatar',
      category: 'avatar',
      title: '丹恒官方头像',
      url: 'https://example.test/dan-heng-avatar.png',
      source: 'StarRailRes',
      recommended: true,
    },
    {
      id: 'asset-portrait',
      kind: 'portrait',
      category: 'portrait',
      title: '丹恒官方立绘',
      url: 'https://example.test/dan-heng-portrait.png',
      source: 'StarRailRes',
    },
  ];

  const sources: CharacterUpstreamEvidenceSource[] = [
    {
      title: 'StarRailRes：丹恒',
      url: 'https://example.test/starrailres/characters.json',
      excerpt: '命途：巡猎\n属性：风',
      sourceType: 'starrailres',
    },
  ];

  assert.equal(
    Value.Check(CharacterUpstreamResearchPreviewSchema, {
      query: '丹恒',
      resolvedName: '丹恒',
      resolvedWork: '崩坏：星穹铁道',
      draft,
      tags: ['列车护卫', '冷静'],
      skinsAndVariants: [variant, skin],
      assets,
      sources,
      evidenceSummary: '已汇聚 1 个数据源 · 图像资产 2 张',
      warnings: [],
    }),
    true,
  );

  assert.equal(
    Value.Check(CharacterUpstreamApplyRequestSchema, {
      expectedDraftRevision: 3,
      applyTextFields: {
        personaText: true,
        appearance: true,
        tags: true,
      },
      draft,
      tags: ['列车护卫', '冷静'],
      selectedVariants: [variant],
      selectedSkins: [skin],
      sources,
    }),
    true,
  );
});
