import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CharacterProfile,
  KnowledgePendingItem,
  WorldDefinition,
  WorldEvent,
  WorldEventPage,
} from '@sthstart/contracts';
import { DEFAULT_WORLD_RUN_SETTINGS } from '@sthstart/contracts';
import {
  actorFromCharacter,
  actorFromCharacterVersion,
  bucketHeights,
  branchPollInterval,
  defaultWindow,
  formatDuration,
  formatQuota,
  formatTick,
  hashString,
  idempotencyKey,
  mergeEventPages,
  normalizeWorldDefinition,
  quotaPercent,
  resolveEffectiveModel,
  resumeTargetTick,
  sourceFromNote,
  sourceFromNarrative,
  sourceFromKnowledge,
  validateResumeSettings,
  validateWorldDefinition,
  workflowsForEngine,
} from './world-format';

function definition(overrides: Partial<WorldDefinition> = {}): WorldDefinition {
  return {
    title: '  雾港  ',
    summary: ' 摘要 ',
    timeLabel: ' 故事时间 ',
    locations: [{ id: 'loc-1', name: ' 港区 ', description: ' 雨夜 ' }],
    actors: [{
      id: 'actor-1',
      name: ' 林 ',
      role: 'main',
      characterId: null,
      characterVersion: null,
      background: ' 背景 ',
      personality: ' 性格 ',
      speechStyle: ' 说话 ',
      appearance: ' 外观 ',
      goals: [' 找到信 ', ''],
      locationId: 'loc-1',
      referenceArtifactIds: [' ref-1 ', 'ref-1', ''],
    }],
    sources: [{ id: 'source-1', title: ' 旧报 ', nature: 'canon', content: ' 内容 ', sourceUrl: ' https://example.com ', sourceVersion: ' v1 ', capturedAt: '2026-01-01T00:00:00.000Z' }],
    lockedFacts: [' 不能离开港区 ', ''],
    models: { action: null, adjudication: null, narration: null },
    visualStyle: ' 水彩 ',
    ...overrides,
  };
}

test('tick and duration formatting stays readable for world-relative time', () => {
  assert.equal(formatTick(0), '第 1 天 00:00');
  assert.equal(formatTick(90), '第 1 天 01:30');
  assert.equal(formatTick(1_440), '第 2 天 00:00');
  assert.equal(formatDuration(30), '30 分钟');
  assert.equal(formatDuration(90), '1 小时 30 分钟');
  assert.equal(formatDuration(1_440), '1 天');
});

test('default window shows the latest 24 hours and remains valid at the start', () => {
  assert.deepEqual(defaultWindow({ currentTick: 0 }), { from: 0, to: 1_440 });
  assert.deepEqual(defaultWindow({ currentTick: 2_000 }), { from: 560, to: 2_000 });
  assert.deepEqual(defaultWindow(null), { from: 0, to: 1_440 });
});

test('normalization trims and removes blank content without inventing data', () => {
  const normalized = normalizeWorldDefinition(definition({
    actors: [
      ...definition().actors,
      { ...definition().actors[0], id: 'actor-2', name: '   ' },
    ],
  }));
  assert.equal(normalized.title, '雾港');
  assert.equal(normalized.locations[0].name, '港区');
  assert.deepEqual(normalized.actors[0].goals, ['找到信']);
  assert.deepEqual(normalized.actors[0].referenceArtifactIds, ['ref-1']);
  assert.equal(normalized.actors.length, 1);
  assert.deepEqual(normalized.lockedFacts, ['不能离开港区']);
  assert.equal(normalized.sources[0].sourceUrl, 'https://example.com');
});

test('world validation blocks missing actors, locations and invalid actor locations', () => {
  assert.match(validateWorldDefinition(definition()) ?? '', /^$/);
  assert.equal(validateWorldDefinition(definition()), null);
  assert.match(validateWorldDefinition(definition({ actors: [] })) ?? '', /至少需要一名人物/);
  assert.match(validateWorldDefinition(definition({ locations: [] })) ?? '', /至少需要一个地点/);
  assert.match(
    validateWorldDefinition(definition({
      actors: [{ ...definition().actors[0], locationId: 'missing' }],
    })) ?? '',
    /还没有有效地点/,
  );
});

test('character snapshots copy role-library text and version without linking the actor id', () => {
  const profile: CharacterProfile = {
    id: 'character-1',
    slug: 'lin',
    displayName: '林',
    draft: {
      schemaVersion: 2,
      displayName: '林',
      englishName: '',
      aliases: [],
      originType: 'original',
      work: '',
      summary: '前信使',
      personaText: '曾经送信，后来失踪。',
      speechText: '说话很短。',
      dialogueExamples: [],
      behaviorRules: '',
      appearance: { baseText: '深色外套', defaultOutfitText: '雨披' },
    },
    tags: [],
    avatarUrl: null,
    latestVersion: 3,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const actor = actorFromCharacter(profile, 'loc-1');
  assert.equal(actor.name, '林');
  assert.equal(actor.characterId, 'character-1');
  assert.equal(actor.characterVersion, 3);
  assert.equal(actor.locationId, 'loc-1');
  assert.match(actor.background, /曾经送信/);
  assert.match(actor.speechStyle, /说话很短/);
  assert.match(actor.appearance, /深色外套/);
  assert.notEqual(actor.id, profile.id);
});

test('world actors copy the published version, never a newer editable draft', () => {
  const profile: CharacterProfile = {
    id: 'character-2',
    slug: 'lin-2',
    displayName: '林',
    draft: {
      schemaVersion: 2,
      displayName: '林',
      englishName: '',
      aliases: [],
      originType: 'original',
      work: '',
      summary: '未发布的草稿',
      personaText: '草稿里还没发布的新经历。',
      speechText: '',
      dialogueExamples: [],
      behaviorRules: '',
      appearance: { baseText: '', defaultOutfitText: '' },
    },
    tags: [],
    avatarUrl: null,
    latestVersion: 2,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const actor = actorFromCharacterVersion(profile, {
    characterId: profile.id,
    version: 2,
    data: {
      ...profile.draft,
      summary: '已发布版本',
      personaText: '已发布版本里的旧经历。',
    },
    compiledLinshePrompt: '',
    relationships: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  }, 'loc-1');
  assert.equal(actor.characterVersion, 2);
  assert.match(actor.background, /已发布版本里的旧经历/);
  assert.doesNotMatch(actor.background, /草稿里还没发布/);
});

test('published actor snapshots use the selected version name before the profile name', () => {
  const profile: CharacterProfile = {
    id: 'character-version-name',
    slug: 'lin-version-name',
    displayName: '角色库最新名',
    draft: {
      schemaVersion: 2,
      displayName: '角色库最新名',
      englishName: '',
      aliases: [],
      originType: 'original',
      work: '',
      summary: '',
      personaText: '',
      speechText: '',
      dialogueExamples: [],
      behaviorRules: '',
      appearance: { baseText: '', defaultOutfitText: '' },
    },
    tags: [],
    avatarUrl: null,
    latestVersion: 2,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const actor = actorFromCharacterVersion(profile, {
    characterId: profile.id,
    version: 1,
    data: {
      ...profile.draft,
      displayName: '旧版角色名',
      personaText: '旧版正文。',
    },
    compiledLinshePrompt: '',
    relationships: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  }, 'loc-1');
  assert.equal(actor.name, '旧版角色名');
  assert.equal(actor.characterVersion, 1);
  assert.match(actor.background, /旧版正文/);
});

test('knowledge snapshots are marked unverified and keep the excerpt', () => {
  const item: KnowledgePendingItem = {
    id: 'pending-1',
    runId: 'run-1',
    collectionId: 'collection-1',
    collectionName: '旧报',
    sourceVersionId: 'version-1',
    title: '港区旧报',
    excerpt: '十年前港区封港。',
    characters: [],
    url: 'https://example.com/old',
    sourceName: '旧报',
    sourceKind: 'web',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    changeType: 'new',
    state: 'kept',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const source = sourceFromKnowledge(item);
  assert.equal(source.nature, 'unverified');
  assert.equal(source.content, '十年前港区封港。');
  assert.equal(source.sourceUrl, 'https://example.com/old');
});

test('workflow filtering only returns workflows bound to the chosen engine', () => {
  const workflows = [
    { id: 'wf-1', name: 'A', versions: [{ version: 1, engineId: 'engine-1' }] },
    { id: 'wf-2', name: 'B', versions: [{ version: 1, engineId: 'engine-2' }] },
    { id: 'wf-3', name: 'C', engine_kind: 'comfyui', versions: [] },
  ];
  assert.deepEqual(
    workflowsForEngine(workflows, { id: 'engine-1', name: '主引擎', kind: 'comfyui' }).map((workflow) => workflow.id),
    ['wf-1', 'wf-3'],
  );
  assert.deepEqual(
    workflowsForEngine(workflows, { id: 'engine-3', name: 'Comfy', kind: 'comfyui' }).map((workflow) => workflow.id),
    ['wf-3'],
  );
  assert.deepEqual(workflowsForEngine(workflows, undefined), []);
});

test('idempotency keys are stable, bounded and change with payload', () => {
  const first = idempotencyKey('run', { branch: 'b1', settings: { durationTicks: 1_440 } });
  const second = idempotencyKey('run', { branch: 'b1', settings: { durationTicks: 1_440 } });
  const third = idempotencyKey('run', { branch: 'b1', settings: { durationTicks: 720 } });
  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.ok(first.length < 160);
  assert.match(first, /^sw-run-[0-9a-f]{16}$/);
  assert.equal(hashString('same'), hashString('same'));
});

test('quota helpers clamp and bucket heights remain proportional', () => {
  assert.equal(quotaPercent(0, 0), 0);
  assert.equal(quotaPercent(60, 120), 50);
  assert.equal(quotaPercent(200, 120), 100);
  assert.equal(formatQuota(3, 12), '3 / 12');
  assert.deepEqual(bucketHeights([{ from: 0, to: 10, count: 0 }, { from: 10, to: 20, count: 4 }]), [2, 100]);
});

test('event pages merge without duplicates and sort by world time', () => {
  const page = (items: WorldEvent[], total = items.length): WorldEventPage => ({
    items,
    nextCursor: null,
    total,
    from: 0,
    to: 1_000,
    buckets: [],
  });
  const event = (id: string, tick: number): WorldEvent => ({
    id,
    worldId: 'w',
    branchId: 'b',
    tick,
    duration: 0,
    title: id,
    summary: '',
    locationId: 'l',
    participantIds: ['a'],
    facts: [],
    perspectives: [],
    causeEventIds: [],
    storyLineIds: [],
    stateChanges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const merged = mergeEventPages([page([event('late', 20)]), page([event('early', 10), event('late', 20)])]);
  assert.deepEqual(merged.map((item) => item.id), ['early', 'late']);
});

test('branch polling continues for image work after a completed run', () => {
  assert.equal(branchPollInterval('running', []), 3_000);
  assert.equal(branchPollInterval('queued', null), 3_000);
  assert.equal(branchPollInterval('completed', [{ status: 'queued' }]), 6_000);
  assert.equal(branchPollInterval('completed', [{ status: 'uncertain' }]), 6_000);
  assert.equal(branchPollInterval('completed', [{ status: 'succeeded' }]), false);
  assert.equal(branchPollInterval(null, [{ status: 'planned' }]), false);
});

test('resume settings can extend budgets but never shrink below consumed work', () => {
  const run = { textCallsUsed: 120, imagesSubmitted: 12, startTick: 0, targetTick: 1_440 };
  const current = { ...DEFAULT_WORLD_RUN_SETTINGS };
  assert.equal(validateResumeSettings(run, current), null);
  assert.match(
    validateResumeSettings(run, { ...current, maxTextCalls: 100 }) ?? '',
    /不能低于已使用/,
  );
  assert.match(
    validateResumeSettings(run, { ...current, maxImages: 10 }) ?? '',
    /不能低于已提交/,
  );
  assert.match(
    validateResumeSettings(run, { ...current, durationTicks: 720 }) ?? '',
    /只能延长/,
  );
  const extended = { ...current, durationTicks: 2_880, maxTextCalls: 200, maxImages: 20 };
  assert.equal(validateResumeSettings(run, extended), null);
  assert.equal(resumeTargetTick(run, extended), 2_880);
});

test('effective model resolves explicit, purpose and app bindings in service order', () => {
  const catalog = [
    { id: 'model-explicit', name: '显式模型', model: 'm-1', enabled: true, capabilities: ['text'] },
    { id: 'model-purpose', name: '用途模型', model: 'm-2', enabled: true, capabilities: ['text'] },
    { id: 'model-app', name: '应用默认', model: 'm-3', enabled: true, capabilities: ['text'] },
  ];
  const purposeBindings = [
    { id: 'binding-1', appId: 'story-worlds', purposeKey: 'action', targetType: 'model' as const, targetId: 'model-purpose', inheritAppDefault: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const assignments = [
    { appId: 'story-worlds', textProfileId: 'model-app', multimodalProfileId: null, updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const explicit = resolveEffectiveModel('action', 'model-explicit', { catalog, purposeBindings, assignments });
  assert.equal(explicit.source, 'explicit');
  assert.match(explicit.label, /显式模型/);

  const purpose = resolveEffectiveModel('action', null, { catalog, purposeBindings, assignments });
  assert.equal(purpose.source, 'purpose');
  assert.match(purpose.label, /用途模型/);

  const app = resolveEffectiveModel('adjudication', null, { catalog, purposeBindings, assignments });
  assert.equal(app.source, 'app');
  assert.match(app.label, /应用默认/);

  const missing = resolveEffectiveModel('narration', null, { catalog, purposeBindings, assignments: [] });
  assert.equal(missing.source, 'missing');
  assert.match(missing.warning ?? '', /没有为故事世界提供/);

  const invalidExplicit = resolveEffectiveModel('action', 'deleted-model', { catalog, purposeBindings, assignments });
  assert.equal(invalidExplicit.source, 'unavailable');
  assert.match(invalidExplicit.warning ?? '', /不存在/);
});

test('notes and narrative nodes become real source snapshots', () => {
  const note = {
    id: 'note-1',
    title: '港区笔记',
    kind: 'note' as const,
    summary: '封港记录',
    content: [
      { id: 'b1', type: 'text' as const, text: '第一段正文' },
      { id: 'b2', type: 'link' as const, url: 'https://example.com', label: '旧报', note: '来源' },
    ],
    tags: [],
    stage: 'reference' as const,
    favorite: false,
    revision: 2,
    knowledge: {
      schemaVersion: 1 as const,
      works: [],
      characters: [],
      locations: [],
      nature: 'canon' as const,
      authorship: 'handwritten' as const,
      usage: 'record' as const,
      sources: [],
    },
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
  const noteSource = sourceFromNote(note);
  assert.equal(noteSource.nature, 'canon');
  assert.match(noteSource.content, /第一段正文/);
  assert.match(noteSource.content, /旧报/);
  assert.match(noteSource.sourceVersion, /r2/);

  const work = { id: 'work-1', title: '旧港', description: '', locale: 'zh', sourceName: '原作', nodeCount: 1 };
  const node = { id: 'node-1', parentId: null, kind: 'scene', title: '封港', sortOrder: 0, summary: '港区关闭' };
  const reading = {
    node: { id: 'node-1', workId: 'work-1', title: '封港', summary: '港区关闭', conceptArtifacts: [] },
    scenes: [{
      id: 'scene-1',
      title: '码头',
      summary: '雨夜',
      sortOrder: 0,
      utterances: [{ id: 'u1', kind: 'line', speaker: '林', text: '封港了。', condition: null }],
    }],
  };
  const narrativeSource = sourceFromNarrative(work, node, reading);
  assert.equal(narrativeSource.nature, 'unverified');
  assert.match(narrativeSource.title, /旧港/);
  assert.match(narrativeSource.content, /林：封港了/);
  assert.match(narrativeSource.sourceVersion, /work-1/);
});

test('notes without an id derive stable source identity from content and metadata', () => {
  const base = {
    title: '无名笔记',
    kind: 'note' as const,
    summary: '摘要',
    content: [{ id: 'block-1', type: 'text' as const, text: '正文甲' }],
    tags: [],
    stage: 'reference' as const,
    favorite: false,
    knowledge: {
      schemaVersion: 1 as const,
      works: [],
      characters: [],
      locations: [],
      nature: 'canon' as const,
      authorship: 'handwritten' as const,
      usage: 'record' as const,
      sources: [],
    },
  };
  const first = sourceFromNote(base);
  const same = sourceFromNote(base);
  const changedContent = sourceFromNote({
    ...base,
    content: [{ id: 'block-1', type: 'text' as const, text: '正文乙' }],
  });
  const changedNature = sourceFromNote({
    ...base,
    knowledge: { ...base.knowledge, nature: 'personal' as const },
  });
  assert.equal(first.id, same.id);
  assert.notEqual(first.id, changedContent.id);
  assert.notEqual(first.id, changedNature.id);
  assert.match(first.sourceVersion, new RegExp(first.id.replace('source-note-', '')));
});
