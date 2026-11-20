import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  StoryWorld,
  WorldActor,
  WorldAuthoringDraft,
  WorldBranch,
  WorldDefinition,
  WorldSuggestionCandidate,
} from '@sthstart/contracts';
import {
  WORLD_AUTHORING_STORAGE_PREFIX,
  applyCandidates,
  candidateBefore,
  compareBranchFields,
  compareDraftToServer,
  branchFieldsChanged,
  createEmptyDraft,
  createEnvelope,
  definitionFromWorld,
  definitionsEqual,
  diffAppliedChanges,
  draftFingerprint,
  draftFromLegacyDefinition,
  draftFromWorld,
  formatMinuteOfDay,
  insertCreatedWorld,
  isRunBlockingBranch,
  mergeActors,
  mergeSources,
  normalizeDraftForSubmit,
  parseAuthoringEnvelope,
  parseMinuteOfDay,
  replaceActors,
  replaceSources,
  resolveSavePlan,
  resolveSavedState,
  resolveSaveCompletion,
  revertAppliedChanges,
  sourceFromWeb,
  stashBranchDraft,
  restoreBranchDraft,
  storageKeyFor,
  validateDraft,
  validateSelection,
} from './model';

function actor(overrides: Partial<WorldActor> = {}): WorldActor {
  return {
    id: 'actor-a',
    name: '林',
    role: 'main',
    characterId: null,
    characterVersion: null,
    background: '',
    personality: '',
    speechStyle: '',
    appearance: '',
    goals: [],
    locationId: 'loc-1',
    referenceArtifactIds: [],
    ...overrides,
  };
}

function baseDraft(): WorldAuthoringDraft {
  const draft = createEmptyDraft();
  draft.definition.title = '灰烬中的向量';
  draft.definition.summary = '旧城正在缓慢燃烧。';
  draft.definition.locations = [{ id: 'loc-1', name: '北塔', description: '' }];
  draft.definition.actors = [actor()];
  return draft;
}

test('draft fingerprint ignores key order but tracks content', () => {
  const draft = baseDraft();
  const reordered = {
    initialBranch: { ...draft.initialBranch },
    definition: {
      visualStyle: draft.definition.visualStyle,
      models: draft.definition.models,
      lockedFacts: draft.definition.lockedFacts,
      sources: draft.definition.sources,
      actors: draft.definition.actors,
      visualReferences: draft.definition.visualReferences,
      locations: draft.definition.locations,
      timeLabel: draft.definition.timeLabel,
      summary: draft.definition.summary,
      workNature: draft.definition.workNature,
      parentWork: draft.definition.parentWork,
      title: draft.definition.title,
    },
  } as WorldAuthoringDraft;

  assert.equal(draftFingerprint(draft), draftFingerprint(reordered));
  assert.notEqual(draftFingerprint(draft), draftFingerprint({
    ...draft,
    definition: { ...draft.definition, title: '灰烬中的向量 II' },
  }));
  // 分支方向属于草稿内容，必须让建议失效。
  assert.notEqual(draftFingerprint(draft), draftFingerprint({
    ...draft,
    initialBranch: { ...draft.initialBranch, direction: '向北塔推进。' },
  }));
});

test('new authoring drafts carry original identity and derivative drafts require a mother work', () => {
  const draft = baseDraft();
  assert.equal(draft.definition.workNature, 'original');
  assert.equal(draft.definition.parentWork, null);
  draft.definition.workNature = 'derivative';
  assert.equal(validateDraft(draft).issues.find(issue => issue.path === 'parentWork')?.message, '同人作品必须选择所属母原作。');
  draft.definition.parentWork = '原神';
  assert.equal(validateDraft(draft).ok, true);
});

test('legacy world-form drafts migrate into an authoring draft', () => {
  const legacy: WorldDefinition = {
    ...baseDraft().definition,
    title: '旧世界',
  };
  const migrated = draftFromLegacyDefinition(legacy);
  assert.equal(migrated.definition.title, '旧世界');
  assert.equal(migrated.definition.actors.length, 1);
  assert.equal(migrated.initialBranch.title, '主线');

  const raw = JSON.stringify({ isDirty: true, data: legacy, expectedRevision: 4, updatedAt: 1 });
  const envelope = parseAuthoringEnvelope(raw);
  assert.ok(envelope);
  assert.equal(envelope.isDirty, true);
  assert.equal(envelope.baseRevision, 4);
  assert.equal(envelope.values.definition.title, '旧世界');

  // 裸 JSON（更早的存储格式）同样按草稿恢复。
  const bare = parseAuthoringEnvelope(JSON.stringify(legacy));
  assert.equal(bare?.values.definition.title, '旧世界');
  assert.equal(parseAuthoringEnvelope('{not json'), null);
  assert.equal(parseAuthoringEnvelope(JSON.stringify({ hello: 'world' })), null);
});

test('envelope keeps branch fields and idempotency key separate from the strict definition', () => {
  const envelope = createEnvelope(baseDraft(), {
    branchId: 'branch-1',
    baseRevision: 3,
    branchRevision: 7,
  });
  assert.equal(envelope.branchId, 'branch-1');
  assert.equal(envelope.baseRevision, 3);
  assert.equal(envelope.branchRevision, 7);
  assert.ok(envelope.idempotencyKey.length > 0);
  assert.equal('baseRevision' in envelope.values.definition, false);
  assert.equal('expectedRevision' in envelope.values.definition, false);

  const restored = parseAuthoringEnvelope(JSON.stringify(envelope));
  assert.equal(restored?.idempotencyKey, envelope.idempotencyKey);
  assert.equal(restored?.branchRevision, 7);
});

test('suggestion envelopes keep manual and excluded selections across reloads', () => {
  const envelope = createEnvelope(baseDraft());
  envelope.suggestion = {
    fingerprint: 'fp',
    scope: 'actors',
    instruction: '补一个人物',
    candidates: [],
    gaps: [],
    selectedIds: ['cand-actor'],
    manualIds: ['cand-actor'],
    excludedIds: ['cand-location'],
    createdAt: '2026-11-15T00:00:00.000Z',
  };
  const restored = parseAuthoringEnvelope(JSON.stringify(envelope));
  assert.deepEqual(restored?.suggestion?.manualIds, ['cand-actor']);
  assert.deepEqual(restored?.suggestion?.excludedIds, ['cand-location']);

  const legacy = {
    ...envelope,
    suggestion: { ...envelope.suggestion, manualIds: undefined, excludedIds: undefined },
  };
  const legacyRestored = parseAuthoringEnvelope(JSON.stringify(legacy));
  assert.equal(legacyRestored?.suggestion?.manualIds, undefined);
  assert.deepEqual(legacyRestored?.suggestion?.selectedIds, ['cand-actor']);
});

test('storage keys keep the legacy create/edit names', () => {
  assert.equal(storageKeyFor(undefined), 'create');
  assert.equal(storageKeyFor('world-9'), 'edit:world-9');
  assert.equal(WORLD_AUTHORING_STORAGE_PREFIX + storageKeyFor(undefined), 'sthstart:story-worlds:draft:create');
  assert.equal(WORLD_AUTHORING_STORAGE_PREFIX + storageKeyFor('w'), 'sthstart:story-worlds:draft:edit:w');
});

test('time parsing refuses to guess and formats defined minutes', () => {
  assert.equal(parseMinuteOfDay(''), undefined);
  assert.equal(parseMinuteOfDay('  '), undefined);
  assert.equal(parseMinuteOfDay('06:30'), 390);
  assert.equal(parseMinuteOfDay('23:59'), 1439);
  assert.equal(parseMinuteOfDay('24:00'), null);
  assert.equal(parseMinuteOfDay('06:60'), null);
  assert.equal(parseMinuteOfDay('630'), null);
  assert.equal(formatMinuteOfDay(390), '06:30');
  assert.equal(formatMinuteOfDay(undefined), '');
});

test('selection validation blocks missing locations instead of falling back', () => {
  const draft = baseDraft();
  const orphan: WorldSuggestionCandidate = {
    id: 'c-actor',
    target: 'actor',
    value: actor({ id: 'actor-new', name: '新人物', locationId: 'loc-missing' }),
    sourceIds: [],
    dependsOn: [],
    note: '',
  };
  const orphanCheck = validateSelection(draft, [orphan]);
  assert.equal(orphanCheck.ok, false);
  assert.match(orphanCheck.errors.join(' '), /地点/);

  const newLocation: WorldSuggestionCandidate = {
    id: 'c-loc',
    target: 'location',
    value: { id: 'loc-2', name: '南门', description: '' },
    sourceIds: [],
    dependsOn: [],
    note: '',
  };
  const paired: WorldSuggestionCandidate = {
    ...orphan,
    id: 'c-actor-2',
    dependsOn: ['c-loc'],
    value: actor({ id: 'actor-new-2', name: '新人物', locationId: 'loc-2' }),
  };
  assert.equal(validateSelection(draft, [newLocation, paired]).ok, true);

  // 依赖被取消后，引用它的候选必须报错，不能静默忽略。
  const withoutDependency = validateSelection(draft, [paired]);
  assert.equal(withoutDependency.ok, false);
  assert.match(withoutDependency.errors.join(' '), /c-loc/);
});

test('selection validation rejects duplicate new ids and unknown sources', () => {
  const draft = baseDraft();
  const duplicate: WorldSuggestionCandidate = {
    id: 'c-1',
    target: 'location',
    value: { id: 'loc-1', name: '重复', description: '' },
    sourceIds: ['source-missing'],
    dependsOn: [],
    note: '',
  };
  const result = validateSelection(draft, [duplicate]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /重复/);
  assert.match(result.errors.join(' '), /source-missing/);
});

test('selection validation blocks a candidate whose existing entity was deleted', () => {
  const draft = baseDraft();
  // 作者删掉了 actor-a，但建议仍指向它；不能当成“新增”追加回去。
  const withoutActor: WorldAuthoringDraft = {
    ...draft,
    definition: { ...draft.definition, actors: [] },
  };
  const staleActor: WorldSuggestionCandidate = {
    id: 'c-stale-actor',
    target: 'actor',
    entityId: 'actor-a',
    value: actor(),
    sourceIds: [],
    dependsOn: [],
    note: '',
  };
  const staleLocation: WorldSuggestionCandidate = {
    id: 'c-stale-loc',
    target: 'location',
    entityId: 'loc-removed',
    value: { id: 'loc-removed', name: '旧地点', description: '' },
    sourceIds: [],
    dependsOn: [],
    note: '',
  };
  const result = validateSelection(withoutActor, [staleActor, staleLocation]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /actor-a/);
  assert.match(result.errors.join(' '), /loc-removed/);

  // 防御：即使跳过校验直接应用，也不能把“更新”变成“新增”。
  const applied = applyCandidates(withoutActor, [staleActor]);
  assert.equal(applied.definition.actors.length, 0);
});

test('applying candidates writes world fields to definition and direction to the branch', () => {
  const draft = baseDraft();
  const candidates: WorldSuggestionCandidate[] = [
    { id: 'c-title', target: 'title', value: '新名字', sourceIds: [], dependsOn: [], note: '' },
    { id: 'c-time', target: 'startMinuteOfDay', value: 390, sourceIds: [], dependsOn: [], note: '' },
    { id: 'c-facts', target: 'lockedFacts', value: ['城不会在三天内熄灭。'], sourceIds: [], dependsOn: [], note: '' },
    { id: 'c-direction', target: 'direction', value: '向北塔推进。', sourceIds: [], dependsOn: [], note: '' },
  ];
  const next = applyCandidates(draft, candidates);
  assert.equal(next.definition.title, '新名字');
  assert.equal(next.definition.startMinuteOfDay, 390);
  assert.deepEqual(next.definition.lockedFacts, ['城不会在三天内熄灭。']);
  assert.equal(next.initialBranch.direction, '向北塔推进。');
  // 未勾选的字段保持原样。
  assert.equal(next.definition.summary, draft.definition.summary);
  assert.equal(next.definition.actors.length, 1);
});

test('applying a new actor appends and an existing entity replaces in place', () => {
  const draft = baseDraft();
  const newActor = actor({ id: 'actor-b', name: '阿岚' });
  const editedActor = actor({ name: '林·改' });
  const next = applyCandidates(draft, [
    {
      id: 'c-new', target: 'actor', value: newActor,
      sourceIds: [], dependsOn: [], note: '',
    },
    {
      id: 'c-edit', target: 'actor', entityId: 'actor-a', value: editedActor,
      sourceIds: [], dependsOn: [], note: '',
    },
  ]);
  assert.deepEqual(next.definition.actors.map((item) => item.name), ['林·改', '阿岚']);
});

test('applying a stale actor candidate keeps the real character binding and media', () => {
  const draft = baseDraft();
  draft.definition.actors = [{
    ...actor(),
    characterId: 'char-real',
    characterVersion: 7,
    referenceArtifactIds: ['art-keep-1', 'art-keep-2'],
  }];
  // 生成建议时角色还没有绑定；候选里是 null 与空媒体。
  const staleCandidate: WorldSuggestionCandidate = {
    id: 'c-stale-binding',
    target: 'actor',
    entityId: 'actor-a',
    value: { ...actor(), name: '林·新', characterId: null, characterVersion: null, referenceArtifactIds: [] },
    sourceIds: [],
    dependsOn: [],
    note: '',
  };
  const next = applyCandidates(draft, [staleCandidate]);
  const saved = next.definition.actors[0];
  assert.equal(saved.name, '林·新');
  assert.equal(saved.characterId, 'char-real');
  assert.equal(saved.characterVersion, 7);
  assert.deepEqual(saved.referenceArtifactIds, ['art-keep-1', 'art-keep-2']);
});

test('candidateBefore describes new and existing entities without inventing values', () => {
  const draft = baseDraft();
  assert.equal(
    candidateBefore(draft, { id: 'x', target: 'actor', value: actor(), sourceIds: [], dependsOn: [], note: '' }),
    '（新增人物）',
  );
  assert.match(
    candidateBefore(draft, { id: 'y', target: 'actor', entityId: 'actor-a', value: actor(), sourceIds: [], dependsOn: [], note: '' }),
    /林/,
  );
  assert.match(
    candidateBefore(draft, { id: 'z', target: 'startMinuteOfDay', value: 60, sourceIds: [], dependsOn: [], note: '' }),
    /（空）|未定义/,
  );
});

test('normalizing strips blanks but never rewrites an invalid actor location', () => {
  const draft = baseDraft();
  draft.definition.title = '  灰烬中的向量  ';
  draft.definition.actors = [
    actor({ name: ' 林 ', goals: [' 找妹妹 ', '   ', '找妹妹'] }),
    actor({ id: 'actor-empty', name: '   ' }),
  ];
  draft.definition.actors[0].locationId = 'loc-missing';
  draft.definition.lockedFacts = [' 城不会熄灭 ', '  '];

  const normalized = normalizeDraftForSubmit(draft);
  assert.equal(normalized.definition.title, '灰烬中的向量');
  assert.equal(normalized.definition.actors.length, 1);
  assert.equal(normalized.definition.actors[0].name, '林');
  assert.deepEqual(normalized.definition.actors[0].goals, ['找妹妹', '找妹妹']);
  assert.equal(normalized.definition.actors[0].locationId, 'loc-missing');
  assert.deepEqual(normalized.definition.lockedFacts, ['城不会熄灭']);
  assert.equal(validateDraft(normalized).ok, false);
});

test('draft validation reports field paths the form can show', () => {
  const empty = createEmptyDraft();
  const result = validateDraft(empty);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.path === 'title'));
  assert.ok(result.issues.some((issue) => issue.path === 'actors'));

  const valid = baseDraft();
  valid.definition.summary = '简介';
  assert.equal(validateDraft(valid).ok, true);

  const brokenBinding = baseDraft();
  brokenBinding.definition.actors = [actor({ characterId: 'char-1', characterVersion: null })];
  const binding = validateDraft(brokenBinding);
  assert.equal(binding.ok, false);
  assert.ok(binding.issues.some((issue) => issue.path === 'actors.0.characterId'));
});

test('web sources stay unverified and carry the saved library id when present', () => {
  const item = {
    id: 'web-1',
    title: '北塔考据',
    url: 'https://example.com/tower',
    siteName: 'Example',
    snippet: '摘要',
    content: '',
    retrievedAt: '2026-11-14T00:00:00.000Z',
    contentHash: 'hash-1',
    status: 'snippet' as const,
    truncated: false,
  };
  const plain = sourceFromWeb(item);
  assert.equal(plain.nature, 'unverified');
  assert.equal(plain.sourceVersion, 'web:hash-1');
  assert.equal(plain.sourceUrl, item.url);

  const saved = sourceFromWeb(item, 'knowledge-9');
  assert.equal(saved.sourceVersion, 'web:knowledge-9');

  // 同一网页只有一个来源 ID；另存知识库不产生第二份重复来源。
  const merged = mergeSources([plain], [saved]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, plain.id);
});

test('run status gating matches the server definition of an active run', () => {
  assert.equal(isRunBlockingBranch('running'), true);
  assert.equal(isRunBlockingBranch('paused'), true);
  assert.equal(isRunBlockingBranch('uncertain'), true);
  assert.equal(isRunBlockingBranch('completed'), false);
  assert.equal(isRunBlockingBranch(null), false);
});

test('branch comparison names exactly the fields that would be written', () => {
  const draft = baseDraft();
  const server = { title: '主线', mode: 'canon-gap' as const, direction: '' };
  assert.equal(compareBranchFields(draft, server).changed, false);

  const changed = {
    ...draft,
    initialBranch: { ...draft.initialBranch, mode: 'adaptation' as const, direction: '向北塔推进。' },
  };
  const comparison = compareBranchFields(changed, server);
  assert.equal(comparison.changed, true);
  assert.deepEqual(comparison.fields.map((field) => field.field), ['mode', 'direction']);
  // 模式用中文标签展示，方向保留原文。
  assert.equal(comparison.fields[0].draft, '改编');
  assert.equal(comparison.fields[1].draft, '向北塔推进。');
});

test('rebase comparison lists only differing fields, including branch fields', () => {
  const draft = baseDraft();
  draft.definition.summary = '作者改过的简介';
  draft.initialBranch.direction = '作者写下的方向';
  const server = {
    definition: { ...baseDraft().definition, title: '服务器标题' },
    branch: { title: '主线', mode: 'canon-gap' as const, direction: '' },
  };
  const fields = compareDraftToServer(draft, server);
  const names = fields.map((field) => field.field);
  assert.ok(names.includes('title'));
  assert.ok(names.includes('summary'));
  assert.ok(names.includes('branch.direction'));
  assert.equal(names.includes('visualStyle'), false);
  assert.equal(fields.find((field) => field.field === 'summary')?.server, '旧城正在缓慢燃烧。');
  assert.equal(fields.find((field) => field.field === 'summary')?.draft, '作者改过的简介');
});

test('definitionFromWorld strips server-only fields before saving', () => {
  const world = {
    ...baseDraft().definition,
    id: 'world-1',
    revision: 4,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  } as StoryWorld;
  const definition = definitionFromWorld(world);
  assert.equal(definition.title, world.title);
  assert.equal('id' in definition, false);
  assert.equal('revision' in definition, false);
  assert.equal('createdAt' in definition, false);
  assert.equal(validateDraft({ definition, initialBranch: baseDraft().initialBranch }).ok, true);
});

test('save plan refuses to fall back to the latest revision when the base is unknown', () => {
  const base = {
    isEdit: true,
    scope: 'all' as const,
    hasConflict: false,
    baseRevision: undefined as number | undefined,
    branchChanged: false,
    branchLocked: false,
    serverReady: true,
  };
  const missingBase = resolveSavePlan(base);
  assert.equal(missingBase.kind, 'blocked');
  assert.equal(missingBase.kind === 'blocked' && missingBase.conflict, true);

  const conflicted = resolveSavePlan({ ...base, hasConflict: true, baseRevision: 3 });
  assert.equal(conflicted.kind, 'blocked');
  assert.equal(conflicted.kind === 'blocked' && conflicted.conflict, true);

  const notReady = resolveSavePlan({ ...base, baseRevision: 3, serverReady: false });
  assert.equal(notReady.kind, 'blocked');
});

test('save plan keeps the world saveable while a branch is running', () => {
  const input = {
    isEdit: true,
    hasConflict: false,
    baseRevision: 5,
    branchChanged: true,
    branchLocked: true,
    serverReady: true,
  };
  // 全部保存：分支被锁时仍保存世界，只是不写分支。
  const all = resolveSavePlan({ ...input, scope: 'all' });
  assert.equal(all.kind, 'save');
  assert.equal(all.kind === 'save' && all.writeWorld, true);
  assert.equal(all.kind === 'save' && all.writeBranch, false);

  // 单独保存分支：明确阻断，并提示可以只存世界。
  const blocked = resolveSavePlan({ ...input, scope: 'branch' });
  assert.equal(blocked.kind, 'blocked');
  assert.match(blocked.kind === 'blocked' ? blocked.message : '', /只保存世界设定/);

  // 只存世界：仍然放行。
  const worldOnly = resolveSavePlan({ ...input, scope: 'world' });
  assert.equal(worldOnly.kind, 'save');
  assert.equal(worldOnly.kind === 'save' && worldOnly.writeWorld, true);
  assert.equal(worldOnly.kind === 'save' && worldOnly.writeBranch, false);
  assert.equal(worldOnly.kind === 'save' && worldOnly.expectedRevision, 5);
});

test('save plan writes both scopes and blocks a no-op branch save', () => {
  const input = {
    isEdit: true,
    hasConflict: false,
    baseRevision: 7,
    branchRevision: 3,
    branchChanged: true,
    branchLocked: false,
    serverReady: true,
  };
  const both = resolveSavePlan({ ...input, scope: 'all' });
  assert.equal(both.kind, 'save');
  assert.equal(both.kind === 'save' && both.writeWorld, true);
  assert.equal(both.kind === 'save' && both.writeBranch, true);

  const branchOnly = resolveSavePlan({ ...input, scope: 'branch' });
  assert.equal(branchOnly.kind, 'save');
  assert.equal(branchOnly.kind === 'save' && branchOnly.writeWorld, false);
  assert.equal(branchOnly.kind === 'save' && branchOnly.writeBranch, true);

  const noop = resolveSavePlan({ ...input, scope: 'branch', branchChanged: false });
  assert.equal(noop.kind, 'blocked');
  assert.equal(noop.kind === 'blocked' && noop.conflict, false);

  const create = resolveSavePlan({ ...input, isEdit: false, baseRevision: undefined, scope: 'all' });
  assert.equal(create.kind, 'create');
});

test('save plan requires a branch base before writing branch fields', () => {
  const plan = resolveSavePlan({
    isEdit: true,
    scope: 'all',
    hasConflict: false,
    baseRevision: 4,
    branchRevision: undefined,
    branchChanged: true,
    branchLocked: false,
    serverReady: true,
  });
  assert.equal(plan.kind, 'blocked');
  assert.equal(plan.kind === 'blocked' && plan.conflict, true);

  const withBase = resolveSavePlan({
    isEdit: true,
    scope: 'all',
    hasConflict: false,
    baseRevision: 4,
    branchRevision: 2,
    branchChanged: true,
    branchLocked: false,
    serverReady: true,
  });
  assert.equal(withBase.kind, 'save');
  assert.equal(withBase.kind === 'save' && withBase.branchRevision, 2);
});

test('branch-only save never discards unsaved world edits', () => {
  const draft = baseDraft();
  draft.definition.summary = '作者尚未保存的世界改动';
  const serverDefinition = baseDraft().definition;
  const serverBranch = { title: '主线', mode: 'canon-gap' as const, direction: '' };
  const saved = resolveSavedState({
    scope: 'branch',
    writeBranch: true,
    draft,
    savedDefinition: serverDefinition,
    savedBranch: { ...serverBranch, direction: '新方向' },
  });
  // 世界定义保持作者输入，不被服务器值覆盖。
  assert.equal(saved.values.definition.summary, '作者尚未保存的世界改动');
  assert.equal(saved.values.initialBranch.direction, '新方向');
  assert.equal(saved.worldPending, true);
  assert.equal(saved.keepDirty, true);
});

test('world-only save keeps unsaved branch direction dirty', () => {
  const draft = baseDraft();
  draft.definition.summary = '已保存的世界';
  draft.initialBranch.direction = '作者尚未保存的方向';
  const saved = resolveSavedState({
    scope: 'world',
    writeBranch: false,
    draft,
    savedDefinition: { ...draft.definition, summary: '已保存的世界' },
    savedBranch: { title: '主线', mode: 'canon-gap', direction: '' },
  });
  assert.equal(saved.values.initialBranch.direction, '作者尚未保存的方向');
  assert.equal(saved.branchPending, true);
  assert.equal(saved.keepDirty, true);
});

test('full save clears dirty only when both sides were written', () => {
  const draft = baseDraft();
  const saved = resolveSavedState({
    scope: 'all',
    writeBranch: true,
    draft,
    savedDefinition: draft.definition,
    savedBranch: { ...draft.initialBranch },
  });
  assert.equal(saved.keepDirty, false);
  assert.equal(saved.branchPending, false);
});

test('locked-branch save keeps the unsaved direction instead of replacing it with server text', () => {
  const draft = baseDraft();
  draft.initialBranch.direction = '分支运行期间写的方向';
  // plan.writeBranch=false：服务端分支仍是旧值。
  const saved = resolveSavedState({
    scope: 'all',
    writeBranch: false,
    draft,
    savedDefinition: draft.definition,
    savedBranch: { title: '主线', mode: 'canon-gap', direction: '服务端旧方向' },
  });
  assert.equal(saved.values.initialBranch.direction, '分支运行期间写的方向');
  assert.equal(saved.branchPending, true);
  assert.equal(saved.keepDirty, true);
});

test('edits made while the save request is in flight survive the response', () => {
  const submitted = baseDraft();
  submitted.definition.summary = '提交时的简介';
  const late = {
    ...submitted,
    definition: { ...submitted.definition, summary: '保存期间继续输入' },
  };
  const saved = resolveSaveCompletion({
    scope: 'all',
    writeBranch: true,
    draft: submitted,
    submitted,
    late,
    savedDefinition: submitted.definition,
    savedBranch: submitted.initialBranch,
  });
  assert.equal(saved.values.definition.summary, '保存期间继续输入');
  assert.equal(saved.lateWorldEdits, true);
  assert.equal(saved.keepDirty, true);
});

test('late branch input during a branch save is kept instead of the saved branch value', () => {
  const submitted = baseDraft();
  const late = {
    ...submitted,
    initialBranch: { ...submitted.initialBranch, direction: '保存期间写的方向' },
  };
  const saved = resolveSaveCompletion({
    scope: 'branch',
    writeBranch: true,
    draft: submitted,
    submitted,
    late,
    savedDefinition: submitted.definition,
    savedBranch: { title: '主线', mode: 'canon-gap', direction: '已保存的方向' },
  });
  assert.equal(saved.values.initialBranch.direction, '保存期间写的方向');
  assert.equal(saved.lateBranchEdits, true);
  assert.equal(saved.keepDirty, true);
});

test('a save with no late edits still ends clean', () => {
  const submitted = baseDraft();
  const saved = resolveSaveCompletion({
    scope: 'all',
    writeBranch: true,
    draft: submitted,
    submitted,
    late: submitted,
    savedDefinition: submitted.definition,
    savedBranch: submitted.initialBranch,
  });
  assert.equal(saved.keepDirty, false);
  assert.equal(saved.lateWorldEdits, false);
});

test('saving a full branch response keeps the next draft valid without response metadata', () => {
  const submitted = baseDraft();
  const savedBranch = {
    ...submitted.initialBranch,
    id: 'branch-saved',
    worldId: 'world-saved',
    revision: 2,
    currentTick: 0,
    createdAt: '2026-11-15T00:00:00.000Z',
  };
  for (const scope of ['all', 'branch'] as const) {
    const saved = resolveSaveCompletion({
      scope,
      writeBranch: true,
      draft: submitted,
      submitted,
      late: submitted,
      savedDefinition: submitted.definition,
      savedBranch,
    });
    assert.deepEqual(saved.values.initialBranch, submitted.initialBranch);
    assert.equal(validateDraft(saved.values).ok, true);
    assert.equal(saved.keepDirty, false);
  }
});

test('AI undo reverts only fields still holding the AI value', () => {
  const before = baseDraft();
  const applied = applyCandidates(before, [
    { id: 'c-title', target: 'title', value: 'AI 起的名字', sourceIds: [], dependsOn: [], note: '' },
    { id: 'c-summary', target: 'summary', value: 'AI 写的简介', sourceIds: [], dependsOn: [], note: '' },
  ]);
  const changes = diffAppliedChanges(before, applied, 'AI 建议 2 项');
  // 作者在采纳后手改了简介，但标题保持 AI 值。
  const edited = {
    ...applied,
    definition: { ...applied.definition, summary: '作者后来改的简介' },
  };
  const result = revertAppliedChanges(edited, changes);
  assert.equal(result.values.definition.title, before.definition.title);
  assert.equal(result.values.definition.summary, '作者后来改的简介');
  assert.equal(result.reverted, 1);
  assert.equal(result.kept, 1);
});

test('AI undo keeps sources and actors added after applying', () => {
  const before = baseDraft();
  const applied = applyCandidates(before, [
    { id: 'c-summary', target: 'summary', value: 'AI 写的简介', sourceIds: [], dependsOn: [], note: '' },
  ]);
  const changes = diffAppliedChanges(before, applied, 'AI 建议 1 项');
  const later = {
    ...applied,
    definition: {
      ...applied.definition,
      sources: [{
        id: 'source-new', title: '作者后加的来源', nature: 'author' as const, content: '正文',
        sourceUrl: '', sourceVersion: 'v1', capturedAt: '2026-11-14T00:00:00.000Z',
      }],
      actors: [...applied.definition.actors, { ...actor(), id: 'actor-later', name: '后加人物' }],
    },
  };
  const result = revertAppliedChanges(later, changes);
  assert.equal(result.values.definition.summary, before.definition.summary);
  assert.equal(result.values.definition.sources.length, 1);
  assert.equal(result.values.definition.sources[0].id, 'source-new');
  assert.ok(result.values.definition.actors.some((item) => item.id === 'actor-later'));
});

test('AI undo keeps an actor the author edited after applying', () => {
  const before = baseDraft();
  const aiActor = { ...actor(), id: 'actor-ai', name: 'AI 人物', background: 'AI 背景' };
  const applied = applyCandidates(before, [
    { id: 'c-actor', target: 'actor', value: aiActor, sourceIds: [], dependsOn: [], note: '' },
  ]);
  const changes = diffAppliedChanges(before, applied, 'AI 建议 1 项');
  const edited = {
    ...applied,
    definition: {
      ...applied.definition,
      actors: applied.definition.actors.map((item) => (
        item.id === 'actor-ai' ? { ...item, background: '作者改过的背景' } : item
      )),
    },
  };
  const result = revertAppliedChanges(edited, changes);
  const kept = result.values.definition.actors.find((item) => item.id === 'actor-ai');
  assert.ok(kept);
  assert.equal(kept?.background, '作者改过的背景');
  assert.equal(result.kept, 1);
});

test('AI undo reverts AI-edited fields but keeps a hand-edited personality', () => {
  const before = baseDraft();
  before.definition.actors = [{ ...actor(), personality: '原性格', background: '原背景' }];
  const aiActor = { ...before.definition.actors[0], personality: 'AI 性格', background: 'AI 背景' };
  const applied = applyCandidates(before, [
    { id: 'c-actor', target: 'actor', entityId: 'actor-a', value: aiActor, sourceIds: [], dependsOn: [], note: '' },
  ]);
  const changes = diffAppliedChanges(before, applied, 'AI 建议 1 项');
  const edited = {
    ...applied,
    definition: {
      ...applied.definition,
      actors: applied.definition.actors.map((item) => (
        item.id === 'actor-a' ? { ...item, personality: '作者手改的性格' } : item
      )),
    },
  };
  const result = revertAppliedChanges(edited, changes);
  const finalActor = result.values.definition.actors[0];
  assert.equal(finalActor.background, '原背景');
  assert.equal(finalActor.personality, '作者手改的性格');
  assert.equal(result.reverted, 1);
  assert.equal(result.kept, 1);
});

test('AI undo reverts a location description without touching a hand-edited name', () => {
  const before = baseDraft();
  const aiLocation = { ...before.definition.locations[0], name: 'AI 地名', description: 'AI 描述' };
  const applied = applyCandidates(before, [
    { id: 'c-loc', target: 'location', entityId: 'loc-1', value: aiLocation, sourceIds: [], dependsOn: [], note: '' },
  ]);
  const changes = diffAppliedChanges(before, applied, 'AI 建议 1 项');
  const edited = {
    ...applied,
    definition: {
      ...applied.definition,
      locations: applied.definition.locations.map((item) => (
        item.id === 'loc-1' ? { ...item, name: '作者改的地名' } : item
      )),
    },
  };
  const result = revertAppliedChanges(edited, changes);
  assert.equal(result.values.definition.locations[0].description, before.definition.locations[0].description);
  assert.equal(result.values.definition.locations[0].name, '作者改的地名');
});

test('AI undo removes an untouched AI actor but leaves existing ones', () => {
  const before = baseDraft();
  const applied = applyCandidates(before, [
    { id: 'c-actor', target: 'actor', value: { ...actor(), id: 'actor-ai', name: 'AI 人物' }, sourceIds: [], dependsOn: [], note: '' },
  ]);
  const changes = diffAppliedChanges(before, applied, 'AI 建议 1 项');
  const result = revertAppliedChanges(applied, changes);
  assert.equal(result.values.definition.actors.some((item) => item.id === 'actor-ai'), false);
  assert.equal(result.values.definition.actors.length, 1);
});

test('definition equality ignores key order', () => {
  const definition = baseDraft().definition;
  const reordered = Object.fromEntries(
    Object.entries(definition).reverse(),
  ) as unknown as typeof definition;
  assert.equal(definitionsEqual(definition, reordered), true);
  assert.equal(definitionsEqual(definition, { ...definition, title: '别的名字' }), false);
});

test('comparison sees same-name actors with different backgrounds', () => {
  const draft = baseDraft();
  const server = {
    definition: {
      ...baseDraft().definition,
      actors: [{ ...actor(), background: '服务器背景' }],
    },
    branch: { title: '主线', mode: 'canon-gap' as const, direction: '' },
  };
  draft.definition.actors = [{ ...actor(), background: '作者背景' }];
  const fields = compareDraftToServer(draft, server);
  const background = fields.find((field) => field.field === 'actors.actor-a.background');
  assert.ok(background, '同名不同背景必须出现在对照表里');
  assert.equal(background?.server, '服务器背景');
  assert.equal(background?.draft, '作者背景');
});

test('comparison sees equal source counts with different bodies', () => {
  const source = {
    id: 'source-1', title: '资料', nature: 'author' as const, content: '服务器正文',
    sourceUrl: '', sourceVersion: 'v1', capturedAt: '2026-11-01T00:00:00.000Z',
  };
  const draft = baseDraft();
  draft.definition.sources = [{ ...source, content: '作者正文' }];
  const server = {
    definition: { ...baseDraft().definition, sources: [source] },
    branch: { title: '主线', mode: 'canon-gap' as const, direction: '' },
  };
  const fields = compareDraftToServer(draft, server);
  const content = fields.find((field) => field.field === 'sources.source-1.content');
  assert.ok(content, '同数量但正文不同必须可见');
  assert.equal(content?.server, '服务器正文');
  assert.equal(content?.draft, '作者正文');
});

test('comparison sees model binding and visual reference differences', () => {
  const draft = baseDraft();
  draft.definition.models = { action: 'model-a', adjudication: null, narration: null };
  draft.definition.visualReferences = [{
    id: 'visual-1', name: '北塔', kind: 'location', locationId: 'loc-1',
    description: '作者描述', referenceArtifactIds: ['art-1'],
  }];
  const server = {
    definition: {
      ...baseDraft().definition,
      models: { action: 'model-b', adjudication: 'model-c', narration: null },
      visualReferences: [{
        id: 'visual-1', name: '北塔', kind: 'location' as const, locationId: 'loc-1',
        description: '服务器描述', referenceArtifactIds: ['art-2'],
      }],
    },
    branch: { title: '主线', mode: 'canon-gap' as const, direction: '' },
  };
  const fields = compareDraftToServer(draft, server);
  const names = fields.map((field) => field.field);
  assert.ok(names.includes('models'));
  assert.ok(names.includes('visualReferences.visual-1.description'));
  assert.ok(names.includes('visualReferences.visual-1.referenceArtifactIds'));
  const models = fields.find((field) => field.field === 'models');
  assert.match(models!.server, /model-b/);
  assert.match(models!.draft, /model-a/);
});

test('comparison reports added and deleted entities explicitly', () => {
  const draft = baseDraft();
  draft.definition.actors = [
    ...draft.definition.actors,
    { ...actor(), id: 'actor-new', name: '新人物' },
  ];
  const server = {
    definition: {
      ...baseDraft().definition,
      actors: [...baseDraft().definition.actors, { ...actor(), id: 'actor-gone', name: '被删人物' }],
    },
    branch: { title: '主线', mode: 'canon-gap' as const, direction: '' },
  };
  const fields = compareDraftToServer(draft, server);
  assert.ok(fields.some((field) => field.field === 'actors.actor-new' && /新增/.test(field.draft)));
  assert.ok(fields.some((field) => field.field === 'actors.actor-gone' && /已删除/.test(field.draft)));
});

test('branch field changes are measured against the server, not a render snapshot', () => {
  const draft = baseDraft();
  draft.initialBranch = { title: '主线', mode: 'canon-gap', direction: '' };
  const snapshot = {
    branchId: 'b1', title: '主线', mode: 'canon-gap' as const, direction: '', revision: 1,
  };
  assert.equal(branchFieldsChanged(draft, snapshot), false);
  assert.equal(branchFieldsChanged({ ...draft, initialBranch: { ...draft.initialBranch, direction: '改了' } }, snapshot), true);
  // 没有服务端快照时不能断定“改过”。
  assert.equal(branchFieldsChanged({ ...draft, initialBranch: { ...draft.initialBranch, direction: '改了' } }, undefined), false);
});

test('branch drafts survive a switch and restore per branch', () => {
  const envelope = createEnvelope(baseDraft(), {
    branchId: 'branch-a',
    baseRevision: 3,
    branchRevision: 1,
  });
  const dirty: typeof envelope = {
    ...envelope,
    isDirty: true,
    serverBranch: { branchId: 'branch-a', title: '主线', mode: 'canon-gap', direction: '', revision: 1 },
    values: {
      ...envelope.values,
      initialBranch: { title: '主线', mode: 'canon-gap', direction: '分支 A 未保存方向' },
    },
  };
  const stashed = stashBranchDraft(dirty, 'branch-a');
  assert.ok(stashed?.['branch-a']);
  assert.equal(stashed!['branch-a'].direction, '分支 A 未保存方向');

  // 切到 B：用 B 的服务端值。
  const restoredB = restoreBranchDraft(stashed, 'branch-b', {
    title: '支线', mode: 'adaptation', direction: 'B 的方向',
  });
  assert.equal(restoredB.title, '支线');
  assert.equal(restoredB.direction, 'B 的方向');

  // 切回 A：恢复 A 的未保存方向，而不是服务端空值。
  const restoredA = restoreBranchDraft(stashed, 'branch-a', {
    title: '主线', mode: 'canon-gap', direction: '',
  });
  assert.equal(restoredA.direction, '分支 A 未保存方向');

  // 未改动时不写入槽位，避免把“本来如此”当成草稿。
  const clean = {
    ...envelope,
    serverBranch: { branchId: 'branch-a', title: '主线', mode: 'canon-gap' as const, direction: '', revision: 1 },
  };
  assert.equal(stashBranchDraft(clean, 'branch-a'), undefined);
});

test('a created world is prepended to the cached list once', () => {
  const existing = { id: 'world-old', ...baseDraft().definition } as StoryWorld;
  const created = { id: 'world-new', ...baseDraft().definition } as StoryWorld;
  const list = { items: [existing] };

  const merged = insertCreatedWorld(list, created);
  assert.deepEqual(merged?.items.map((item) => item.id), ['world-new', 'world-old']);
  // 幂等：重复合并不会产生重复条目。
  assert.deepEqual(insertCreatedWorld(merged, created)?.items.map((item) => item.id), ['world-new', 'world-old']);
  // 没有缓存时不伪造列表，交给 invalidate 重新拉取。
  assert.equal(insertCreatedWorld(undefined, created), undefined);
});

test('merging a newer character version replaces the body but keeps identity and media', () => {
  const existing = {
    ...actor(),
    characterId: 'char-1',
    characterVersion: 2,
    referenceArtifactIds: ['art-1'],
    background: '旧背景',
  };
  const incoming = {
    ...actor(),
    characterId: 'char-1',
    characterVersion: 5,
    referenceArtifactIds: [],
    background: '新版本背景',
    locationId: 'loc-elsewhere',
    role: 'supporting' as const,
  };
  const merged = mergeActors([existing], [incoming]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, existing.id);
  assert.equal(merged[0].characterVersion, 5);
  assert.equal(merged[0].background, '新版本背景');
  assert.equal(merged[0].locationId, existing.locationId);
  assert.equal(merged[0].role, existing.role);
  assert.deepEqual(merged[0].referenceArtifactIds, ['art-1']);

  // 同版本重复导入不产生改动。
  assert.equal(mergeActors([existing], [{ ...existing, background: 'x' }])[0].background, '旧背景');
});

test('merging a newer source version replaces its body but keeps the id', () => {
  const base = {
    id: 'source-1', title: '资料', nature: 'author' as const, content: '旧正文',
    sourceUrl: '', sourceVersion: 'v1', capturedAt: '2026-11-01T00:00:00.000Z',
  };
  const merged = mergeSources([base], [{ ...base, id: 'source-other', content: '新正文', sourceVersion: 'v2' }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].content, '旧正文');

  const replaced = mergeSources([base], [{ ...base, content: '新正文', sourceVersion: 'v2' }]);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].id, 'source-1');
  assert.equal(replaced[0].content, '新正文');
  assert.equal(replaced[0].sourceVersion, 'v2');
});

test('version replacement updates a bound actor and keeps current identity', () => {
  const existing = {
    ...actor(),
    characterId: 'char-current',
    characterVersion: 9,
    locationId: 'loc-current',
    role: 'supporting' as const,
    referenceArtifactIds: ['media-current'],
    background: '旧背景',
  };
  const updated = {
    ...actor(),
    characterId: 'char-current',
    characterVersion: 9,
    locationId: 'loc-old',
    role: 'main' as const,
    referenceArtifactIds: [],
    name: '新名字',
    background: '版本正文变化',
  };
  const result = replaceActors([existing], [updated]);
  assert.equal(result.replaced, 1);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].background, '版本正文变化');
  assert.equal(result.items[0].name, '新名字');
  assert.equal(result.items[0].characterId, 'char-current');
  assert.equal(result.items[0].characterVersion, 9);
  assert.equal(result.items[0].id, 'actor-a');
  assert.equal(result.items[0].locationId, 'loc-current');
  assert.equal(result.items[0].role, 'supporting');
  assert.deepEqual(result.items[0].referenceArtifactIds, ['media-current']);

  const sameVersion = {
    ...existing,
    characterId: 'char-current',
    characterVersion: 9,
    background: '同版本正文变化',
  };
  assert.equal(mergeActors([existing], [sameVersion]).length, 1);
  assert.equal(mergeActors([existing], [sameVersion])[0].background, '旧背景');
});

test('version replacement refuses rebinding, unbound snapshots and deleted actors', () => {
  const existing = {
    ...actor(),
    characterId: 'char-current',
    characterVersion: 2,
    background: '旧背景',
  };
  const rebound = replaceActors([existing], [{
    ...existing,
    characterId: 'char-other',
    characterVersion: 9,
    background: '不该写入',
  }]);
  assert.equal(rebound.replaced, 0);
  assert.equal(rebound.items[0].background, '旧背景');
  assert.match(rebound.rejected[0].reason, /绑定已变化|已解绑/);

  const unbound = replaceActors([{ ...existing, characterId: null }], [{
    ...existing,
    characterId: null,
    characterVersion: 9,
    background: '不该写入',
  }]);
  assert.equal(unbound.replaced, 0);
  assert.equal(unbound.items[0].background, '旧背景');
  assert.match(unbound.rejected[0].reason, /已解绑/);

  const deleted = replaceActors([existing], [{ ...existing, id: 'actor-new', name: '新人物' }]);
  assert.equal(deleted.replaced, 0);
  assert.deepEqual(deleted.items.map((item) => item.id), ['actor-a']);
  assert.match(deleted.rejected[0].reason, /已不在当前世界/);
});

test('source replacement applies a same-version body edit instead of skipping it', () => {
  const current = {
    id: 'source-1', title: '稳定资料', nature: 'author' as const, content: '旧正文',
    sourceUrl: 'https://example.com/a', sourceVersion: 'v1', capturedAt: '2026-11-01T00:00:00.000Z',
  };
  const updated = {
    ...current,
    title: '更新标题',
    nature: 'canon' as const,
    content: '同版本但正文已变',
    sourceUrl: 'https://example.com/b',
    capturedAt: '2026-11-15T00:00:00.000Z',
  };
  const result = replaceSources([current], [updated]);
  assert.equal(result.replaced, 1);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'source-1');
  assert.equal(result.items[0].title, '更新标题');
  assert.equal(result.items[0].nature, 'canon');
  assert.equal(result.items[0].content, '同版本但正文已变');
  assert.equal(result.items[0].sourceUrl, 'https://example.com/b');
  assert.equal(result.items[0].sourceVersion, 'v1');
  assert.equal(result.items[0].capturedAt, '2026-11-15T00:00:00.000Z');
});

test('source replacement never resurrects a deleted source id', () => {
  const current = {
    id: 'source-1', title: '稳定资料', nature: 'author' as const, content: '旧正文',
    sourceUrl: '', sourceVersion: 'v1', capturedAt: '2026-11-01T00:00:00.000Z',
  };
  const deleted = replaceSources([], [{ ...current, content: '已删除后又被选择' }]);
  assert.equal(deleted.replaced, 0);
  assert.deepEqual(deleted.items, []);
  assert.match(deleted.rejected[0].reason, /已不在当前世界/);
});

test('draftFromWorld keeps server revisions out of the definition', () => {
  const world = {
    ...baseDraft().definition,
    id: 'world-1',
    revision: 5,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  } as StoryWorld;
  const branch: WorldBranch = {
    id: 'branch-1', worldId: 'world-1', title: '主线', mode: 'adaptation',
    parentBranchId: null, forkTick: 0, currentTick: 0, revision: 2, sourceRevision: 5,
    direction: '向北塔推进。', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
  };
  const draft = draftFromWorld(world, branch);
  assert.equal(draft.definition.title, world.title);
  assert.equal(draft.initialBranch.mode, 'adaptation');
  assert.equal(draft.initialBranch.direction, '向北塔推进。');
  assert.equal('id' in draft.definition, false);
  assert.equal('revision' in draft.definition, false);
});
