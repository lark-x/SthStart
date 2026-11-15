import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CharacterProfile,
  CharacterVersion,
  KnowledgePendingItem,
  ProjectLink,
  StoryDocument,
  WebSearchResult,
  WorldActor,
  WorldSource,
} from '@sthstart/contracts';
import {
  actorAlreadyPresent,
  actorDraftSignature,
  actorFromProjectCharacter,
  actorSelectionIsStale,
  actorUpdateCandidates,
  actorVersionDiff,
  filterByText,
  filterNarrativeNodes,
  findExistingSource,
  pageItems,
  projectCharacterAlreadyPresent,
  mergeActorVersion,
  mergeSourceVersion,
  newSourcesOnly,
  sourceAlreadyPresent,
  sourceFromKeptKnowledge,
  sourceFromProjectDocument,
  sourceFromProjectLink,
  sourceChangeState,
  sourceUpdateCandidates,
  sourceVersionDiff,
  resolveCharacterVersion,
  resolveActorSelection,
  webSourceForDraft,
  webSourcesForDraft,
  worldSourceFamily,
} from './world-resource-picker';

function actor(overrides: Partial<WorldActor> = {}): WorldActor {
  return {
    id: 'actor-1',
    name: '林',
    role: 'main',
    characterId: null,
    characterVersion: null,
    background: '旧港的信使。',
    personality: '',
    speechStyle: '',
    appearance: '',
    goals: [],
    locationId: 'location-1',
    referenceArtifactIds: [],
    ...overrides,
  };
}

function source(overrides: Partial<WorldSource> = {}): WorldSource {
  return {
    id: 'source-1',
    title: '旧报',
    nature: 'unverified',
    content: '港区封港。',
    sourceUrl: 'https://example.com/old',
    sourceVersion: 'v1',
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function webResult(overrides: Partial<WebSearchResult> = {}): WebSearchResult {
  return {
    id: 'web-1',
    title: '港区旧闻',
    url: 'https://example.com/news',
    siteName: '旧闻录',
    snippet: '十年前港区曾经封港。',
    content: '',
    retrievedAt: '2026-11-14T08:00:00.000Z',
    contentHash: 'hash-1',
    status: 'snippet',
    truncated: false,
    ...overrides,
  };
}

test('actor deduplication recognizes linked characters and identical original copies', () => {
  const linked = actor({ characterId: 'character-1', characterVersion: 3 });
  assert.equal(actorAlreadyPresent([linked], actor({
    id: 'actor-2',
    name: '另一个名字',
    characterId: 'character-1',
    characterVersion: 3,
  })), true);

  const original = actor({ name: '林', background: '旧港的信使。' });
  assert.equal(actorAlreadyPresent([original], actor({
    id: 'actor-3',
    name: ' 林 ',
    background: '旧港的信使。',
  })), true);
  assert.equal(actorAlreadyPresent([original], actor({
    id: 'actor-4',
    name: '林',
    background: '另一位信使。',
  })), false);
});

test('character version selection resolves the chosen published snapshot', () => {
  const versions = [
    { version: 4, characterId: 'character-1' },
    { version: 2, characterId: 'character-1' },
  ] as unknown as Parameters<typeof resolveCharacterVersion>[0];
  assert.equal(resolveCharacterVersion(versions, 2)?.version, 2);
  assert.equal(resolveCharacterVersion(versions, 4)?.version, 4);
  assert.equal(resolveCharacterVersion(versions, 3), null);
  assert.equal(resolveCharacterVersion(versions, null), null);
  assert.equal(resolveCharacterVersion([], 4), null);
});

test('actor version updates replace text while preserving location, role and media', () => {
  const current = actor({
    id: 'actor-world-1',
    characterId: 'character-1',
    characterVersion: 1,
    name: '旧版名称',
    background: '旧版背景',
    locationId: 'location-keep',
    role: 'supporting',
    referenceArtifactIds: ['artifact-1'],
  });
  const incoming = actor({
    id: 'actor-new',
    characterId: 'character-1',
    characterVersion: 2,
    name: '新版名称',
    background: '新版背景',
    locationId: 'location-other',
    role: 'main',
    referenceArtifactIds: [],
  });
  const merged = mergeActorVersion(current, incoming);
  assert.equal(merged.id, 'actor-world-1');
  assert.equal(merged.locationId, 'location-keep');
  assert.equal(merged.role, 'supporting');
  assert.deepEqual(merged.referenceArtifactIds, ['artifact-1']);
  assert.equal(merged.characterVersion, 2);
  assert.equal(merged.name, '新版名称');
  assert.equal(merged.background, '新版背景');
  const diff = actorVersionDiff(current, merged);
  assert.ok(diff.some((item) => item.field === 'version' && item.after === 'v2'));
  assert.ok(diff.some((item) => item.field === 'name'));
  assert.ok(diff.every((item) => item.field !== 'locationId'));
});

test('version diffs keep complete text beyond preview length and preserve line breaks', () => {
  const sharedPrefix = '港'.repeat(300);
  const actorBefore = `${sharedPrefix}\n旧结尾`;
  const actorAfter = `${sharedPrefix}\n新结尾`;
  const actorDiff = actorVersionDiff(
    actor({ background: actorBefore }),
    actor({ background: actorAfter }),
  ).find((item) => item.field === 'background');
  assert.ok(actorDiff);
  assert.equal(actorDiff.before, actorBefore);
  assert.equal(actorDiff.after, actorAfter);
  assert.match(actorDiff.before, /\n旧结尾$/);
  assert.match(actorDiff.after, /\n新结尾$/);

  const sourceBefore = `${sharedPrefix}\n旧资料尾段`;
  const sourceAfter = `${sharedPrefix}\n新资料尾段`;
  const current = source({
    sourceVersion: 'stable-version',
    content: sourceBefore,
  });
  const incoming = source({
    sourceVersion: 'stable-version',
    content: sourceAfter,
  });
  assert.equal(sourceChangeState([current], incoming), 'update');
  const sourceDiff = sourceVersionDiff(current, incoming)
    .find((item) => item.field === 'content');
  assert.ok(sourceDiff);
  assert.equal(sourceDiff.before, sourceBefore);
  assert.equal(sourceDiff.after, sourceAfter);
  assert.match(sourceDiff.after, /\n新资料尾段$/);
  const candidates = sourceUpdateCandidates([current], [incoming]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].incoming.content, sourceAfter);
});

test('character updates use the live draft entity and flag stale selections', () => {
  const oldActor = actor({
    id: 'actor-world-1',
    characterId: 'character-1',
    characterVersion: 1,
    name: '旧快照名称',
    background: '旧快照背景',
    locationId: 'location-keep',
    referenceArtifactIds: ['artifact-1'],
  });
  const liveActor = actor({
    ...oldActor,
    name: '后台修改名称',
    background: '后台修改后的最新背景',
  });
  const profile = {
    id: 'character-1',
    displayName: '林',
  } as CharacterProfile;
  const version = {
    characterId: 'character-1',
    version: 2,
    data: {
      schemaVersion: 2,
      displayName: '新版名称',
      englishName: '',
      aliases: [],
      originType: 'original',
      work: '',
      summary: '新版摘要',
      personaText: '新版正文',
      speechText: '',
      dialogueExamples: [],
      behaviorRules: [],
      appearance: {
        baseText: '',
        defaultOutfitText: '',
      },
    },
    compiledLinshePrompt: '',
    relationships: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as CharacterVersion;
  const selection = {
    profile,
    versions: [version],
    version: 2,
    actorId: oldActor.id,
    draftSignature: actorDraftSignature(oldActor),
  };
  assert.equal(actorSelectionIsStale(selection, [liveActor]), true);
  assert.equal(actorSelectionIsStale(selection, [oldActor]), false);

  const candidates = actorUpdateCandidates([selection], [liveActor]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].current.background, '后台修改后的最新背景');
  assert.equal(candidates[0].incoming.id, liveActor.id);
  assert.equal(candidates[0].incoming.locationId, 'location-keep');
  assert.equal(candidates[0].incoming.role, liveActor.role);
  assert.deepEqual(
    candidates[0].incoming.referenceArtifactIds,
    ['artifact-1'],
  );
  assert.equal(candidates[0].incoming.background, '新版正文');

  const acknowledged = {
    ...selection,
    draftSignature: actorDraftSignature(liveActor),
  };
  assert.equal(actorSelectionIsStale(acknowledged, [liveActor]), false);
});

test('deleted, unbound and identity-changed character bindings block old candidates', () => {
  const original = actor({
    id: 'actor-bound',
    characterId: 'character-1',
    characterVersion: 1,
    background: '原绑定正文',
    locationId: 'location-keep',
    referenceArtifactIds: ['artifact-1'],
  });
  const version = {
    characterId: 'character-1',
    version: 2,
    data: {
      schemaVersion: 2,
      displayName: '新版名称',
      englishName: '',
      aliases: [],
      originType: 'original',
      work: '',
      summary: '新版摘要',
      personaText: '新版正文',
      speechText: '',
      dialogueExamples: [],
      behaviorRules: [],
      appearance: {
        baseText: '',
        defaultOutfitText: '',
      },
    },
    compiledLinshePrompt: '',
    relationships: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as CharacterVersion;
  const selection = {
    profile: {
      id: 'character-1',
      displayName: '林',
    } as CharacterProfile,
    versions: [version],
    version: 2,
    actorId: original.id,
    draftSignature: actorDraftSignature(original),
  };

  const missing = resolveActorSelection(selection, []);
  assert.equal(missing.blocked, 'missing');
  assert.deepEqual(actorUpdateCandidates([selection], []), []);

  const unbound = actor({
    ...original,
    characterId: null,
    characterVersion: null,
  });
  assert.equal(
    resolveActorSelection(selection, [unbound]).blocked,
    'unbound',
  );
  assert.deepEqual(actorUpdateCandidates([selection], [unbound]), []);

  const changedIdentity = actor({
    ...original,
    characterId: 'character-2',
    characterVersion: 3,
  });
  assert.equal(
    resolveActorSelection(selection, [changedIdentity]).blocked,
    'identity-changed',
  );
  assert.deepEqual(
    actorUpdateCandidates([selection], [changedIdentity]),
    [],
  );

  const replacementId = actor({
    ...original,
    id: 'actor-replacement',
  });
  assert.equal(
    resolveActorSelection(selection, [replacementId]).blocked,
    'missing',
  );
  assert.deepEqual(actorUpdateCandidates([selection], [replacementId]), []);
});

test('source version updates keep the existing source id and expose differences', () => {
  const current = source({
    id: 'source-note-1',
    sourceVersion: 'note:note-1:r1',
    content: '旧正文',
  });
  const incoming = source({
    id: 'source-note-1',
    sourceVersion: 'note:note-1:r2',
    content: '新正文',
  });
  assert.equal(sourceChangeState([current], incoming), 'update');
  const candidates = sourceUpdateCandidates([current], [incoming]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].merged.id, current.id);
  assert.equal(candidates[0].merged.content, '新正文');
  assert.ok(sourceVersionDiff(current, incoming).some((item) => item.field === 'content'));
  assert.equal(mergeSourceVersion(current, incoming).id, current.id);
  assert.equal(sourceChangeState([current], current), 'same');
  assert.equal(sourceChangeState([], incoming), 'new');
});

test('source URL fallback stays inside the same source family', () => {
  const sharedUrl = 'https://example.com/news';
  const web = webSourceForDraft(webResult({
    id: 'web-new',
    url: sharedUrl,
    contentHash: 'web-new-hash',
  }));
  const canon = source({
    id: 'source-canon-manual',
    nature: 'canon',
    sourceVersion: 'manual',
    sourceUrl: sharedUrl,
  });
  const project = sourceFromProjectDocument('雾港项目', {
    id: 'document-1',
    projectId: 'project-1',
    kind: 'world',
    title: '港区设定',
    body: '项目作者正文。',
    position: 1,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  project.sourceUrl = sharedUrl;
  const knowledge = source({
    id: 'source-8c1f3f7e-4f7d-4c0b-9b55-0e2d1f3c6a71',
    sourceVersion: 'source-version-1',
    sourceUrl: sharedUrl,
  });

  assert.equal(worldSourceFamily(web), 'web');
  assert.equal(worldSourceFamily(canon), 'manual');
  assert.equal(worldSourceFamily(project), 'project');
  assert.equal(worldSourceFamily(knowledge), 'knowledge');
  assert.equal(findExistingSource([canon], web), null);
  assert.equal(findExistingSource([project], web), null);
  assert.equal(findExistingSource([knowledge], web), null);
  assert.equal(sourceChangeState([canon], web), 'new');
  assert.equal(sourceChangeState([project], web), 'new');
  assert.equal(sourceChangeState([knowledge], web), 'new');
  assert.deepEqual(newSourcesOnly([canon], [web]), [web]);
  assert.deepEqual(sourceUpdateCandidates([canon], [web]), []);

  const olderWeb = webSourceForDraft(webResult({
    id: 'web-old',
    url: sharedUrl,
    contentHash: 'web-old-hash',
    snippet: '旧网页摘要。',
  }));
  assert.equal(findExistingSource([olderWeb], web)?.id, olderWeb.id);
  assert.equal(sourceChangeState([olderWeb], web), 'update');
  assert.equal(sourceUpdateCandidates([olderWeb], [web]).length, 1);

  const newerKnowledge = source({
    id: 'source-70c9d6a5-0e12-4b3e-9c42-7d3d1b6e1f24',
    sourceVersion: 'source-version-2',
    sourceUrl: sharedUrl,
    content: '更新后的资料正文。',
  });
  assert.equal(findExistingSource([knowledge], newerKnowledge)?.id, knowledge.id);
  assert.equal(sourceChangeState([knowledge], newerKnowledge), 'update');
});

test('project characters use a published snapshot only when both source fields exist', () => {
  const linked = {
    id: 'project-character-1',
    projectId: 'project-1',
    name: '林',
    notes: '项目里采用的角色库版本。',
    sourceCharacterId: 'character-1',
    sourceVersion: 2,
    latestSourceVersion: 3,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  assert.equal(projectCharacterAlreadyPresent([actor({
    characterId: 'character-1',
    characterVersion: 2,
  })], linked), true);
  assert.equal(projectCharacterAlreadyPresent([], {
    ...linked,
    sourceVersion: null,
  }), false);

  const original = actorFromProjectCharacter({
    ...linked,
    sourceCharacterId: null,
    sourceVersion: null,
  }, 'location-1');
  assert.equal(original.characterId, null);
  assert.equal(original.characterVersion, null);
  assert.equal(original.name, '林');
  assert.equal(original.background, '项目里采用的角色库版本。');
  assert.notEqual(original.id, 'project-character-1');
});

test('original project characters with the same name do not impersonate a library snapshot', () => {
  const original = {
    id: 'project-character-original',
    projectId: 'project-1',
    name: '林',
    notes: '这是项目里另行写的原创设定。',
    sourceCharacterId: null,
    sourceVersion: null,
    latestSourceVersion: null,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const libraryActor = actor({
    characterId: 'character-1',
    characterVersion: 3,
  });
  assert.equal(projectCharacterAlreadyPresent([libraryActor], original), false);
  assert.equal(actorAlreadyPresent([libraryActor], actorFromProjectCharacter(
    original,
    'location-1',
  )), false);
  assert.equal(projectCharacterAlreadyPresent([], original), false);
});

test('a linked project character keeps the version shown by the project copy', () => {
  const character = {
    id: 'project-character-1',
    projectId: 'project-1',
    name: '林',
    notes: '项目里采用的角色库版本。',
    sourceCharacterId: 'character-1',
    sourceVersion: 2,
    latestSourceVersion: 3,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const older = actor({ characterId: 'character-1', characterVersion: 1 });
  assert.equal(projectCharacterAlreadyPresent([older], character), true);
  assert.equal(actorAlreadyPresent([older], actor({
    characterId: 'character-1',
    characterVersion: 2,
  })), true);
  assert.equal(actorAlreadyPresent([older], actor({
    id: 'actor-original',
    name: '林',
    characterId: null,
    characterVersion: null,
    background: '项目原创说明。',
  })), false);
});

test('original project characters deduplicate only against the same copied text', () => {
  const original = {
    id: 'project-character-original',
    projectId: 'project-1',
    name: '林',
    notes: '项目原创说明。',
    sourceCharacterId: null,
    sourceVersion: null,
    latestSourceVersion: null,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const copied = actorFromProjectCharacter(original, 'location-1');
  assert.equal(projectCharacterAlreadyPresent([copied], original), true);
  assert.equal(projectCharacterAlreadyPresent([actor({
    name: '林',
    background: '另一个同名角色。',
  })], original), false);
});

test('project documents and links preserve their source identity and truncation', () => {
  const document: StoryDocument = {
    id: 'document-1',
    projectId: 'project-1',
    kind: 'world',
    title: '港区设定',
    body: '港区在雨夜关闭。',
    position: 1,
    revision: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };
  const documentSource = sourceFromProjectDocument('雾港项目', document);
  assert.equal(documentSource.nature, 'author');
  assert.equal(documentSource.content, '港区在雨夜关闭。');
  assert.match(documentSource.sourceVersion, /document-1.*r4/);
  assert.match(documentSource.sourceUrl, /project-1/);

  const link: ProjectLink = {
    id: 'link-1',
    kind: 'note',
    sourceId: 'note-1',
    title: '旧报摘录',
    excerpt: '封港记录。',
    nature: 'community',
    authorship: 'excerpt',
    sourceVersion: 'note:note-1:r2',
    usage: 'background',
    capturedAt: '2026-02-02T00:00:00.000Z',
    sourceHref: '/apps/notebook/note-1',
    state: 'unchanged',
    truncated: true,
    adoptedEntryId: null,
  };
  const linkSource = sourceFromProjectLink('雾港项目', link);
  assert.equal(linkSource.nature, 'unverified');
  assert.match(linkSource.content, /封港记录。/);
  assert.match(linkSource.content, /项目快照已截断/);
  assert.equal(linkSource.sourceUrl, '/apps/notebook/note-1');
  assert.equal(linkSource.sourceVersion, 'note:note-1:r2');
});

test('web sources use content hashes and label snippets, extracted text and failures', () => {
  const snippet = webSourceForDraft(webResult());
  assert.equal(snippet.id, 'source-web-web-1');
  assert.equal(snippet.nature, 'unverified');
  assert.equal(snippet.sourceUrl, 'https://example.com/news');
  assert.equal(snippet.sourceVersion, 'web:hash-1');
  assert.match(snippet.content, /搜索摘要，尚未核实/);
  assert.match(snippet.content, /十年前港区曾经封港/);

  const extracted = webSourceForDraft(webResult({
    status: 'extracted',
    content: '正文第一段。\n\n正文第二段。',
    truncated: true,
    contentHash: 'hash-extracted',
  }));
  assert.equal(extracted.sourceVersion, 'web:hash-extracted');
  assert.match(extracted.content, /正文第一段/);
  assert.match(extracted.content, /正文已截断/);
  assert.doesNotMatch(extracted.content, /搜索摘要，尚未核实/);

  const failed = webSourceForDraft(webResult({
    status: 'failed',
    error: '站点拒绝访问',
  }));
  assert.match(failed.content, /正文提取失败/);
  assert.match(failed.content, /站点拒绝访问/);
  assert.match(failed.content, /搜索摘要，尚未核实/);
});

test('web failures without content remain explicit summaries and are not imported until selected', () => {
  const failed = webSourceForDraft(webResult({
    status: 'failed',
    snippet: '',
    content: '',
    error: '连接超时',
  }));
  assert.match(failed.content, /正文提取失败：连接超时/);
  assert.match(failed.content, /搜索摘要，尚未核实/);
  assert.equal(webSourcesForDraft([], []).length, 0);

  const added = webSourcesForDraft([
    webResult({ id: 'web-failed', status: 'failed', snippet: '', content: '' }),
    webResult({ id: 'web-ok' }),
  ], []);
  assert.equal(added.length, 2);
  assert.match(added[0].content, /没有可用摘要/);
  assert.doesNotMatch(added[1].content, /正文提取失败/);
});

test('web import deduplication is stable across repeated confirmations', () => {
  const first = webResult({ id: 'web-1', contentHash: 'same-content' });
  const second = webResult({ id: 'web-2', contentHash: 'other-content' });
  const once = webSourcesForDraft([first, second], []);
  assert.equal(once.length, 2);
  assert.equal(webSourcesForDraft([first, second], once).length, 0);
  assert.equal(webSourcesForDraft([first], once).length, 0);
  assert.deepEqual(
    once.map((item) => item.id),
    ['source-web-web-1', 'source-web-web-2'],
  );
});

test('web confirmation separates new sources from existing version updates', () => {
  const existing = webSourceForDraft(webResult({
    id: 'web-existing',
    contentHash: 'old-content',
    snippet: '旧网页摘要。',
  }));
  const changed = webSourceForDraft(webResult({
    id: 'web-existing',
    contentHash: 'new-content',
    status: 'extracted',
    content: '新的网页正文。',
  }));
  const added = webSourceForDraft(webResult({
    id: 'web-added',
    url: 'https://example.com/second',
    contentHash: 'added-content',
  }));
  const incoming = [changed, added];
  const updates = sourceUpdateCandidates([existing], incoming);
  const additions = newSourcesOnly([existing], incoming);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].current.id, existing.id);
  assert.equal(updates[0].incoming.id, changed.id);
  assert.equal(additions.length, 1);
  assert.equal(additions[0].id, added.id);
  assert.ok(sourceVersionDiff(
    updates[0].current,
    updates[0].incoming,
  ).some((item) => item.field === 'content'));
});

test('source deduplication uses stable source ids', () => {
  const existing = source({ id: 'source-note-1' });
  assert.equal(sourceAlreadyPresent([existing], source({ id: 'source-note-1' })), true);
  assert.equal(sourceAlreadyPresent([existing], source({ id: 'source-note-2' })), false);
});

test('kept knowledge sources use the library version id instead of capture time', () => {
  const item: KnowledgePendingItem = {
    id: 'pending-1',
    runId: 'run-1',
    collectionId: 'collection-1',
    collectionName: '网页另存',
    sourceVersionId: 'source-version-1',
    title: '灯塔考据',
    excerpt: '守塔人记录。',
    characters: [],
    url: 'https://example.com/lighthouse',
    sourceName: 'example.com',
    sourceKind: 'web',
    retrievedAt: '2026-11-14T08:00:00.000Z',
    changeType: 'new',
    state: 'kept',
    createdAt: '2026-11-14T08:00:00.000Z',
    updatedAt: '2026-11-14T08:00:00.000Z',
  };
  const result = sourceFromKeptKnowledge(item);
  assert.equal(result.sourceVersion, 'source-version-1');
  assert.notEqual(result.sourceVersion, item.retrievedAt);
  assert.equal(result.id, 'source-pending-1');
  assert.equal(result.sourceUrl, item.url);
  assert.equal(result.nature, 'unverified');
  assert.equal(result.content, item.excerpt);
});

test('Chinese text search trims, normalizes spaces and preserves page boundaries', () => {
  const items = [
    { title: '雾港灯塔', body: '守塔人记录', kind: 'world' },
    { title: '雾港码头', body: '潮汐表', kind: 'scene' },
    { title: '旧港档案', body: '十年前封港', kind: 'world' },
  ];
  const fields = (item: typeof items[number]) => [item.title, item.body, item.kind];

  assert.deepEqual(
    filterByText(items, '  雾港  ', fields).map((item) => item.title),
    ['雾港灯塔', '雾港码头'],
  );
  assert.deepEqual(
    filterByText(items, '守塔人', fields).map((item) => item.title),
    ['雾港灯塔'],
  );
  assert.deepEqual(filterByText(items, '不存在', fields), []);
  assert.deepEqual(
    filterByText(items, '', fields).map((item) => item.title),
    items.map((item) => item.title),
  );

  assert.deepEqual(pageItems(items, 1, 2).map((item) => item.title), ['雾港灯塔', '雾港码头']);
  assert.deepEqual(pageItems(items, 2, 2).map((item) => item.title), ['旧港档案']);
  assert.deepEqual(pageItems(items, 3, 2), []);
  assert.deepEqual(pageItems(items, 0, 2).map((item) => item.title), ['雾港灯塔', '雾港码头']);
});

test('narrative node filtering works with Chinese keywords and page selection', () => {
  const nodes = [
    { id: 'node-1', parentId: null, kind: 'chapter', title: '雾港序章', sortOrder: 1, summary: '雨夜抵达。' },
    { id: 'node-2', parentId: null, kind: 'quest', title: '灯塔来信', sortOrder: 2, summary: '守塔人留下线索。' },
    { id: 'node-3', parentId: null, kind: 'chapter', title: '离港', sortOrder: 3, summary: '船只启航。' },
  ];
  const filtered = filterNarrativeNodes(nodes, '灯塔');
  assert.deepEqual(filtered.map((node) => node.id), ['node-2']);
  assert.deepEqual(
    pageItems(filterNarrativeNodes(nodes, '雾港'), 1, 1).map((node) => node.id),
    ['node-1'],
  );
  assert.deepEqual(filterNarrativeNodes(nodes, '雨夜').map((node) => node.id), ['node-1']);
  assert.deepEqual(filterNarrativeNodes(nodes, 'chapter').map((node) => node.id), ['node-1', 'node-3']);
});
