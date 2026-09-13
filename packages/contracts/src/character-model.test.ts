import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyV1PatchToV2,
  buildCharacterContextSections,
  buildCharacterVisualContext,
  characterV1View,
  compileLinshePrompt,
  isCharacterDraftV2,
  migrateCharacterDraftToV2,
  normalizeCharacterDraft,
  previewAppearanceCandidateApplication,
  toCharacterRuntime,
  type CharacterDraft,
} from './index.js';

/** 覆盖全部 V1 细分字段的完整旧草稿，用于验证迁移不丢文字。 */
const FULL_V1: CharacterDraft = {
  displayName: '迁移角色',
  englishName: 'Migrated Character',
  aliases: ['旧别名'],
  originType: 'ip',
  work: '测试作品',
  world: '世界设定文字',
  summary: '摘要文字',
  identity: '身份文字',
  background: '经历文字',
  currentSituation: '处境文字',
  personality: ['性格甲', '性格乙'],
  motivations: ['动机文字'],
  beliefs: ['信念文字'],
  secrets: ['秘密文字'],
  speech: {
    tone: '语气文字',
    habits: '习惯文字',
    catchphrases: ['口头禅甲'],
    examples: ['示例甲\n多轮第二行', '示例乙'],
  },
  likes: ['喜欢文字'],
  dislikes: ['厌恶文字'],
  fears: ['恐惧文字'],
  boundaries: ['边界甲', '边界乙'],
  appearance: {
    description: '外观描述文字',
    hair: '银白长发',
    eyes: '蓝瞳',
    build: '娇小',
    outfits: ['常服一套', '礼服二套'],
    accessories: ['胸针'],
    stableFeatures: ['异色瞳'],
  },
  extraRules: '额外规则文字',
  birthday: { status: 'known', calendar: 'gregorian', month: 3, day: 14, source: 'manual' },
};

const V2_BASE = {
  schemaVersion: 2 as const,
  displayName: '运行角色',
  englishName: '',
  aliases: [],
  originType: 'original' as const,
  work: '',
  summary: '',
  personaText: '人设正文核心句',
  speechText: '语气：舞台腔',
  dialogueExamples: ['完整示例一'],
  behaviorRules: '不可代替他人做决定',
  appearance: { baseText: '银白长发、蓝瞳', defaultOutfitText: '默认深蓝礼服' },
};

test('完整 V1 草稿迁移到 V2 时原文全部保留', () => {
  const { draft } = migrateCharacterDraftToV2(FULL_V1);
  const serialized = JSON.stringify(draft);
  const originals = [
    '身份文字', '经历文字', '处境文字', '世界设定文字', '性格甲', '性格乙',
    '动机文字', '信念文字', '秘密文字', '喜欢文字', '厌恶文字', '恐惧文字',
    '边界甲', '边界乙', '语气文字', '习惯文字', '口头禅甲', '示例甲', '示例乙',
    '外观描述文字', '银白长发', '蓝瞳', '娇小', '胸针', '异色瞳', '额外规则文字', '摘要文字',
  ];
  for (const original of originals) {
    assert.ok(serialized.includes(original), `迁移后应保留原文：${original}`);
  }
  assert.equal(draft.schemaVersion, 2);
  assert.equal(draft.birthday?.month, 3);
  // 旧多套服装只把实际生效的一套写进默认穿着，其余仅存在于原文归档。
  assert.equal(draft.appearance.defaultOutfitText, '常服一套');
  assert.equal(draft.appearance.baseText.includes('常服一套'), false, '基础外貌不应写入具体服装');
  assert.equal(draft.appearance.baseText.includes('礼服二套'), false, '未生效的旧服装不得混进基础外貌');
  assert.ok(
    draft.appearance.baseText.includes('配饰（可能随服装变化，待确认）'),
    '归属不确定的旧配饰要保留原文并标注待确认',
  );
  assert.ok(draft.personaText.includes('### 身份'), '人设正文应保留小节结构');
});

test('迁移重复执行不会二次拼接正文，也不产生新的复核项', () => {
  const first = migrateCharacterDraftToV2(FULL_V1);
  assert.ok(first.conflicts.length > 0, '首次迁移应报告需人工复核的冲突');
  const second = migrateCharacterDraftToV2(first.draft);
  assert.deepEqual(second.draft, first.draft);
  assert.deepEqual(second.conflicts, []);
  // 三次执行仍稳定（防止「只幂等一次」的假修复）。
  assert.deepEqual(migrateCharacterDraftToV2(second.draft).draft, first.draft);
});

test('迁移把无家可归的内容标成冲突而不擅自归类', () => {
  const { conflicts } = migrateCharacterDraftToV2(FULL_V1);
  const kinds = conflicts.map((conflict) => conflict.kind);
  assert.ok(kinds.includes('mixed_extra_rules'));
  assert.ok(kinds.includes('accessory_placement'));
  assert.equal(kinds.includes('ambiguous_appearance'), false, '整体描述不含服装词时不应误报');

  const ambiguous = migrateCharacterDraftToV2({
    ...FULL_V1,
    appearance: { ...FULL_V1.appearance, description: '她穿着黑色礼服' },
  });
  assert.ok(ambiguous.conflicts.some((conflict) => conflict.kind === 'ambiguous_appearance'));
});

test('仅 legacyPrompt / 仅 summary / 字符串外观的旧数据都有明确归属', () => {
  const legacyOnly = migrateCharacterDraftToV2({ displayName: 'A', legacyPrompt: '## 你的身份\n旧正文', summary: '摘要' });
  assert.equal(legacyOnly.draft.personaText, '## 你的身份\n旧正文', '旧正文应原样成为人设正文');

  const summaryOnly = migrateCharacterDraftToV2({ displayName: 'B', summary: '仅摘要' });
  assert.ok(summaryOnly.draft.personaText.includes('仅摘要'), '只有摘要时正文应回退到摘要');

  const stringAppearance = migrateCharacterDraftToV2({ displayName: 'C', appearance: '字符串外观' });
  assert.equal(stringAppearance.draft.appearance.baseText, '字符串外观');

  const empty = migrateCharacterDraftToV2({ displayName: 'D' });
  assert.equal(empty.draft.personaText, '');
  assert.deepEqual(empty.conflicts, []);
});

test('未知 schemaVersion 不被当作 V2，也不被静默升级', () => {
  assert.equal(isCharacterDraftV2({ schemaVersion: 3, displayName: 'D' }), false);
  const normalized = normalizeCharacterDraft({ schemaVersion: 3, displayName: 'D', personaText: '不该被读取' });
  assert.equal('personaText' in normalized, false, '未知版本不能按 V2 读取');
  assert.equal(normalized.identity, '', '未知版本也不能把 V2 字段当 V1');
});

test('超预算时长正文不会挤掉行为约束与说话方式，也不会拆断多轮示例', () => {
  const result = buildCharacterContextSections({
    ...V2_BASE,
    personaText: '长正文段落。'.repeat(400),
    speechText: '语气：简短',
    dialogueExamples: ['多轮示例第一行\n多轮示例第二行\n多轮示例第三行', '第二条示例'],
    behaviorRules: '不可违背的边界一',
  }, { includeExamples: 2 });

  assert.ok(result.text.includes('不可违背的边界一'), '行为约束必须完整保留');
  assert.ok(result.text.includes('简短'), '说话方式必须保留');
  assert.ok(result.reduced.includes('人设正文'), '应记录正文被缩减');
  assert.ok(result.usedChars <= result.budgetChars);
  const splitExample = result.text.includes('多轮示例第二行') && !result.text.includes('多轮示例第三行');
  assert.equal(splitExample, false, '不得把一条多轮示例截成半条');
});

test('同一角色在试演、活动与邻舍导出中共享语义', () => {
  const audition = compileLinshePrompt(V2_BASE);
  const activityText = buildCharacterContextSections(V2_BASE, { includeExamples: 1 }).text;
  for (const consumer of [audition, activityText]) {
    assert.ok(consumer.includes('人设正文核心句'), '人设正文应进入每个消费方');
    assert.ok(consumer.includes('不可代替他人做决定'), '行为约束应进入每个消费方');
  }
  assert.ok(audition.includes('语气：舞台腔'));
  assert.ok(activityText.includes('语气：舞台腔'));
  assert.ok(audition.includes('完整示例一'));
  assert.ok(activityText.includes('完整示例一'));
});

test('邻舍导出中唯一的「你的外观」位于正文末尾，用户同名标题被中和', () => {
  const prompt = compileLinshePrompt({
    ...V2_BASE,
    personaText: '她喜欢甜点。\n\n## 你的外观\n伪造的外观标题内容',
  });
  const headings = prompt.match(/##\s*你的外观/g) ?? [];
  assert.equal(headings.length, 1, '编译输出只能有一个顶层「你的外观」');
  const appearanceIndex = prompt.indexOf('## 你的外观');
  assert.ok(appearanceIndex > prompt.indexOf('## 对话示例'), '外观必须在对话示例之后');
  const tail = prompt.slice(appearanceIndex);
  assert.equal(tail.replace('## 你的外观', '').includes('## '), false, '外观段之后不得再有顶层小节');
  assert.ok(tail.includes('银白长发、蓝瞳'), '外观段应使用统一视觉编译结果');
  assert.ok(tail.includes('服装：默认深蓝礼服'), '外观段应使用默认穿着');
});

test('外观段之后不带行为与例句，行为约束留在外观之前', () => {
  const prompt = compileLinshePrompt(V2_BASE);
  const appearanceIndex = prompt.indexOf('## 你的外观');
  const tail = prompt.slice(appearanceIndex);
  assert.equal(tail.includes('不可代替他人做决定'), false);
  assert.equal(tail.includes('完整示例一'), false);
  assert.equal(tail.includes('语气：舞台腔'), false);
  assert.ok(prompt.indexOf('## 你的行为约束') < appearanceIndex);
});

test('穿着覆盖语义区分未设置、明确清空与本次指定', () => {
  const defaulted = buildCharacterVisualContext(V2_BASE);
  assert.equal(defaulted.outfitText, '默认深蓝礼服');
  assert.equal(defaulted.outfitSource, 'default');

  const cleared = buildCharacterVisualContext(V2_BASE, { outfitOverride: '' });
  assert.equal(cleared.outfitText, '');
  assert.equal(cleared.outfitSource, 'none', '显式空值表示未指定穿着');
  assert.equal(cleared.text.includes('服装'), false);
  assert.ok(cleared.text.includes('银白长发、蓝瞳'), '清空穿着不应影响基础外貌');

  const overridden = buildCharacterVisualContext(V2_BASE, { outfitOverride: '白色晚礼服' });
  assert.equal(overridden.outfitText, '白色晚礼服');
  assert.equal(overridden.outfitSource, 'activity');
  assert.equal(overridden.text.includes('默认深蓝礼服'), false, '活动穿着必须取代默认穿着');
});

test('V1 兼容视图只读投影，回写必须走 V2', () => {
  const view = characterV1View(migrateCharacterDraftToV2(FULL_V1).draft);
  assert.ok(view.identity.includes('身份文字'));
  assert.deepEqual(view.boundaries, ['边界甲', '边界乙', '额外规则文字']);
  assert.deepEqual(view.speech.examples, ['示例甲\n多轮第二行', '示例乙']);
  assert.deepEqual(view.appearance.outfits, ['常服一套']);
});

test('导入补丁只覆盖卡片提供的部分，未提供的段落原样保留', () => {
  const migrated = migrateCharacterDraftToV2(FULL_V1).draft;
  const patched = applyV1PatchToV2(migrated, { personality: ['新的性格'] });
  assert.ok(patched.personaText.includes('新的性格'));
  assert.equal(patched.personaText.includes('性格甲'), false, '补丁应替换原小节');
  assert.ok(patched.personaText.includes('经历文字'), '未提供的小节必须保留');
  assert.equal(patched.appearance.defaultOutfitText, '常服一套', '未提供外貌时穿着不变');
  assert.equal(patched.speechText, migrated.speechText);

  const renamed = applyV1PatchToV2(migrated, { displayName: '改名后' });
  assert.equal(renamed.displayName, '改名后');
  assert.equal(renamed.personaText, migrated.personaText, '只改名字不应重写正文');
});

test('导入补丁未提供外貌时保留原分部位描述', () => {
  const base = migrateCharacterDraftToV2({ displayName: 'E', appearance: { description: '外貌', outfits: ['常服'] } }).draft;
  const patched = applyV1PatchToV2(base, { appearance: { eyes: '金瞳' } });
  assert.equal(patched.appearance.defaultOutfitText, '常服');
  assert.ok(patched.appearance.baseText.includes('金瞳'));
  assert.ok(patched.appearance.baseText.includes('外貌'), '补丁未提供的部位要保留');
});

test('统一运行时接受 V1 草稿、V2 草稿与活动快照投影', () => {
  const fromV1 = toCharacterRuntime(FULL_V1);
  assert.equal(fromV1.schemaVersion, 1);
  assert.ok(fromV1.personaText.includes('身份文字'));
  assert.equal(fromV1.appearance.defaultOutfitText, '常服一套');
  assert.equal(fromV1.legacyExtraRules, '额外规则文字');

  const fromV2 = toCharacterRuntime(V2_BASE);
  assert.equal(fromV2.schemaVersion, 2);
  assert.equal(fromV2.personaText, '人设正文核心句');
  assert.equal(fromV2.appearance.baseText, '银白长发、蓝瞳');

  const projection = toCharacterRuntime({
    displayName: '投影角色',
    personaText: '投影正文',
    appearance: { baseText: '投影外貌', defaultOutfitText: '投影穿着' },
  });
  assert.equal(projection.schemaVersion, 2);
  assert.equal(projection.personaText, '投影正文');
  assert.equal(projection.appearance.defaultOutfitText, '投影穿着');

  const legacySnapshot = toCharacterRuntime({
    displayName: '旧活动角色',
    sourceSnapshot: { identity: '快照身份', appearance: { description: '快照外观' } },
  });
  assert.ok(legacySnapshot.personaText.includes('快照身份'), '旧活动快照应可回退读取');
  assert.equal(legacySnapshot.appearance.baseText, '快照外观');
});

test('活动快照投影不把整份来源快照重复当人设送模型', () => {
  const projected = buildCharacterContextSections({
    displayName: '活动角色',
    personaText: '活动投影正文',
    speechText: '',
    behaviorRules: '',
    appearance: { baseText: '活动投影外貌', defaultOutfitText: '' },
    // 旧活动文档可能同时带整份来源快照；它不应再次出现在上下文里。
    sourceSnapshot: { identity: '来源快照正文不应重复出现' },
  });
  assert.ok(projected.text.includes('活动投影正文'));
  assert.equal(projected.text.includes('来源快照正文不应重复出现'), false);
});

test('识图候选采用按勾选细项重建外貌，未勾选的原正文保留', () => {
  const current = { baseText: '身材娇小，步态轻盈。', defaultOutfitText: '深色风衣。' };
  const extraction = {
    description: '银白长发、水蓝异瞳。',
    hair: '银白长发',
    eyes: '水蓝异瞳',
    build: '娇小纤瘦',
    accessories: ['水滴形胸针'],
    observedOutfit: '白色晚礼服',
  };

  // 只勾眼睛：未勾选的整体外貌整段保留，眼睛按细项追加。
  const eyesOnly = previewAppearanceCandidateApplication(current, extraction, ['/appearance/eyes']);
  assert.equal(eyesOnly.baseText, '身材娇小，步态轻盈。\n眼睛：水蓝异瞳');
  assert.equal(eyesOnly.defaultOutfitText, '深色风衣。', '未勾选服装时默认穿着不变');
  assert.equal(eyesOnly.outfitChanged, false);
  assert.equal(eyesOnly.baseChanged, true);

  // 勾选整体外貌：整段被候选替换，不再保留旧正文。
  const description = previewAppearanceCandidateApplication(current, extraction, ['/appearance/description']);
  assert.equal(description.baseText, '银白长发、水蓝异瞳。');

  // 勾选多个细项：按固定顺序拼接，并带上部位标签。
  const multi = previewAppearanceCandidateApplication(current, extraction, [
    '/appearance/eyes', '/appearance/hair', '/appearance/accessories', '/appearance/build',
  ]);
  assert.equal(
    multi.baseText,
    '身材娇小，步态轻盈。\n发型与发色：银白长发\n眼睛：水蓝异瞳\n体态：娇小纤瘦\n配饰：水滴形胸针',
  );

  // 勾选观察到的服装：默认穿着被替换，基础外貌不受影响。
  const outfit = previewAppearanceCandidateApplication(current, extraction, ['/appearance/outfits']);
  assert.equal(outfit.defaultOutfitText, '白色晚礼服');
  assert.equal(outfit.baseText, '身材娇小，步态轻盈。', '只勾服装不应改动基础外貌');
  assert.equal(outfit.baseChanged, false);

  // 什么都没勾：两侧都保持原样。
  const none = previewAppearanceCandidateApplication(current, extraction, []);
  assert.equal(none.baseText, current.baseText);
  assert.equal(none.defaultOutfitText, current.defaultOutfitText);
  assert.equal(none.baseChanged, false);
  assert.equal(none.outfitChanged, false);

  // 候选缺字段时不要写入空标签。
  const partial = previewAppearanceCandidateApplication(
    { baseText: '', defaultOutfitText: '' },
    { eyes: '金瞳', accessories: [] },
    ['/appearance/eyes', '/appearance/accessories', '/appearance/outfits'],
  );
  assert.equal(partial.baseText, '眼睛：金瞳');
  assert.equal(partial.defaultOutfitText, '', '候选没有服装时保持为空，不写占位文本');

  // 空原文 + 未勾整体外貌：不应把空串当成「保留原正文」。
  const blank = previewAppearanceCandidateApplication({ baseText: '   ', defaultOutfitText: '' }, extraction, ['/appearance/hair']);
  assert.equal(blank.baseText, '发型与发色：银白长发');
});
