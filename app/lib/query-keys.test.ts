import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runtimeKeys, characterKeys, notebookKeys, narrativeKeys, providerKeys,
  storyKeys, projectKeys, topicKeys, topicCollectionKeys, ideaBatchKeys,
  knowledgeCollectionKeys, knowledgePendingKeys, mcpSourceKeys, characterFacetKeys, aiCallKeys,
  workspaceKeys, mediaLibraryKeys,
} from './query-keys';
import { cn } from './cn';
import { Value } from '@sinclair/typebox/value';
import {
  CharacterDraftSchema,
  AppConfigResponseSchema,
  ArtifactDescriptorSchema,
  ArtifactGrantSchema,
  ArtifactReferenceSchema,
  GenerationEngineSchema,
  GenerationWorkflowSchema,
  GenerationWorkflowVersionSchema,
  GenerationTaskDescriptorSchema,
  GenerationEventSchema,
} from '@sthstart/contracts';

test('query key factories generate structured immutable key tuples', () => {
  assert.deepEqual(runtimeKeys.overview(), ['runtime', 'overview']);
  assert.deepEqual(characterKeys.list({ query: 'test' }), ['characters', 'list', { query: 'test' }]);
  assert.deepEqual(characterKeys.detail('c1'), ['characters', 'detail', 'c1']);
  assert.deepEqual(notebookKeys.list({ kind: 'diary' }), ['notebook', 'list', { kind: 'diary' }]);
  assert.deepEqual(narrativeKeys.tree('w1'), ['narrative', 'tree', 'w1']);
  assert.deepEqual(providerKeys.overview(), ['providers', 'overview']);
});

test('migrated key factories keep the exact shapes of the literals they replaced', () => {
  const params = { view: 'all', page: 1 };
  // 左边是工厂输出，右边是迁移前组件里的字面量；两者必须逐元素相等，缓存与前缀失效才不变。
  const cases: Array<[readonly unknown[], unknown[]]> = [
    [workspaceKeys.recent(10), ['workspace', 'recent', 10]],
    [mediaLibraryKeys.summary(), ['media-library', 'summary']],
    [storyKeys.projects(), ['story', 'projects']],
    [storyKeys.scope('p1'), ['story', 'p1']],
    [storyKeys.project('p1'), ['story', 'p1', 'project']],
    [storyKeys.documents('p1'), ['story', 'p1', 'documents']],
    [storyKeys.characters('p1'), ['story', 'p1', 'characters']],
    [storyKeys.proposals('p1'), ['story', 'p1', 'proposals']],
    [storyKeys.bridgeStatus('p1'), ['story', 'p1', 'bridge-status']],
    [storyKeys.dshStatus('p1'), ['story', 'p1', 'dsh-status']],
    [storyKeys.search('p1', 'q'), ['story', 'p1', 'search', 'q']],
    [storyKeys.archiveSessions('p1'), ['story', 'p1', 'archive-sessions']],
    [storyKeys.archiveMessages('p1', 's1'), ['story', 'p1', 'archive-messages', 's1']],
    [storyKeys.revisions('p1', 'chapter', 'e1'), ['story', 'p1', 'revisions', 'chapter', 'e1']],
    [storyKeys.compileScript('p1', 't', 'b'), ['story', 'p1', 'compile-script', 't', 'b']],
    [projectKeys.all, ['projects']],
    [projectKeys.overview('p1'), ['projects', 'p1']],
    [topicKeys.all, ['topics']],
    [topicKeys.list(params), ['topics', params]],
    [topicKeys.picker(params), ['topics', 'picker', params]],
    [topicKeys.detail('t1'), ['topics', 'detail', 't1']],
    [topicCollectionKeys.all, ['topic-collection']],
    [topicCollectionKeys.runs(), ['topic-collection', 'runs']],
    [topicCollectionKeys.settings(), ['topic-collection', 'settings']],
    [ideaBatchKeys.list(), ['idea-batches']],
    [ideaBatchKeys.detail('b1'), ['idea-batch', 'b1']],
    [knowledgeCollectionKeys.all, ['knowledge-collections']],
    [knowledgeCollectionKeys.poll('r1,r2'), ['knowledge-collections', 'poll', 'r1,r2']],
    [knowledgeCollectionKeys.run('r1'), ['knowledge-run', 'r1']],
    [knowledgePendingKeys.all, ['knowledge-pending']],
    [knowledgePendingKeys.list('open'), ['knowledge-pending', 'open']],
    [knowledgePendingKeys.detail('d1'), ['knowledge-pending', 'detail', 'd1']],
    [mcpSourceKeys.all, ['mcp-sources']],
    [characterFacetKeys.works(), ['characters', 'works-facets']],
    [aiCallKeys.list(params, 'c1'), ['ai-calls', params, 'c1']],
    [aiCallKeys.storage(), ['ai-calls-storage']],
    [aiCallKeys.detail('a1'), ['ai-call', 'a1']],
  ];
  for (const [actual, expected] of cases) assert.deepEqual(actual, expected);

  // 项目级失效必须仍能命中项目内的所有子键。
  const scope = storyKeys.scope('p1');
  for (const key of [storyKeys.documents('p1'), storyKeys.bridgeStatus('p1'), storyKeys.revisions('p1', 'chapter', 'e1')]) {
    assert.deepEqual(key.slice(0, scope.length), [...scope]);
  }
  // 共享的全量角色列表落在 characterKeys.all 前缀下，编辑角色后的 ['characters'] 失效仍会刷新它。
  assert.deepEqual(characterKeys.list(undefined).slice(0, 1), ['characters']);
});

test('cn utility merges tailwind classes properly', () => {
  assert.equal(cn('px-2 py-1', 'px-4'), 'py-1 px-4');
  assert.equal(cn('text-red-500', false && 'hidden', undefined, 'text-blue-500'), 'text-blue-500');
});

test('shared typebox contracts validate structure correctly', () => {
  const validDraft = {
    displayName: 'Test Character',
    englishName: 'Test',
    aliases: ['T'],
    originType: 'original' as const,
    work: 'Story',
    world: 'World',
    summary: 'A summary',
    identity: 'Identity',
    background: 'Background',
    currentSituation: 'Situation',
    personality: ['Kind'],
    motivations: ['Protect'],
    beliefs: ['Hope'],
    secrets: ['None'],
    speech: {
      tone: 'Gentle',
      habits: 'Smiles',
      catchphrases: ['Hello'],
      examples: ['Greetings'],
    },
    likes: ['Tea'],
    dislikes: ['Coffee'],
    fears: ['Dark'],
    boundaries: ['Lies'],
    appearance: {
      description: 'Tall',
      hair: 'Black',
      eyes: 'Brown',
      build: 'Slim',
      outfits: ['Coat'],
      accessories: ['Ring'],
    },
    extraRules: '',
  };

  assert.equal(Value.Check(CharacterDraftSchema, validDraft), true);

  const invalidDraft = {
    ...validDraft,
    originType: 'unknown-origin',
  };
  assert.equal(Value.Check(CharacterDraftSchema, invalidDraft), false);

  const validAppConfig = {
    app: { id: 'linshe', name: '邻舍' },
    llm: {
      text: { profileId: 'p1', name: 'DeepSeek', model: 'deepseek-v4-flash', ready: true, updatedAt: '2026-08-26T00:00:00.000Z' },
      multimodal: null,
      ready: true,
    },
  };
  assert.equal(Value.Check(AppConfigResponseSchema, validAppConfig), true);

  const invalidAppConfig = {
    app: { id: 'linshe' },
    llm: { text: null, ready: 'not-a-bool' },
  };
  assert.equal(Value.Check(AppConfigResponseSchema, invalidAppConfig), false);

  const validArtifact = {
    id: 'art-1',
    appId: 'linshe',
    taskId: null,
    providerUrl: null,
    contentType: 'image/png',
    byteSize: 1024,
    sha256: 'abc',
    fileStatus: 'ready' as const,
    originalName: 'photo.png',
    mediaType: 'image',
    width: 1024,
    height: 1024,
    durationMs: null,
    paramsSummary: {},
    pinned: false,
    url: '/api/v1/artifacts/art-1',
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  };
  assert.equal(Value.Check(ArtifactDescriptorSchema, validArtifact), true);

  const validGrant = {
    id: 'g-1',
    artifactId: 'art-1',
    ownerAppId: 'linshe',
    granteeAppId: 'notebook',
    access: 'read' as const,
    expiresAt: null,
    createdAt: '2026-08-27T00:00:00.000Z',
  };
  assert.equal(Value.Check(ArtifactGrantSchema, validGrant), true);

  const validRef = {
    id: 'r-1',
    artifactId: 'art-1',
    appId: 'notebook',
    refType: 'note',
    refId: 'n-123',
    createdAt: '2026-08-27T00:00:00.000Z',
  };
  assert.equal(Value.Check(ArtifactReferenceSchema, validRef), true);

  const validEngine = {
    id: 'comfy-1',
    name: 'Local ComfyUI',
    kind: 'comfyui' as const,
    baseUrl: 'http://127.0.0.1:8188',
    enabled: true,
    concurrencyLimit: 2,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  };
  assert.equal(Value.Check(GenerationEngineSchema, validEngine), true);

  const validWorkflow = {
    id: 'txt2img-flux',
    name: 'Flux Txt2Img',
    description: 'Flux model pipeline',
    engineKind: 'comfyui' as const,
    latestVersion: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  };
  assert.equal(Value.Check(GenerationWorkflowSchema, validWorkflow), true);

  const validWfVersion = {
    workflowId: 'txt2img-flux',
    version: 1,
    engineId: 'comfy-1',
    inputSchema: { prompt: { type: 'string' } },
    nodeBindings: { prompt: ['6', 'inputs', 'text'] },
    outputDeclarations: ['9'],
    definition: { '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } } },
    isPublished: true,
    createdAt: '2026-08-27T00:00:00.000Z',
  };
  assert.equal(Value.Check(GenerationWorkflowVersionSchema, validWfVersion), true);

  const validTask = {
    id: 'gt-1',
    appId: 'linshe',
    engineId: 'comfy-1',
    workflowId: 'txt2img-flux',
    workflowVersion: 1,
    purpose: 'image',
    idempotencyKey: 'idemp-12345',
    status: 'succeeded' as const,
    actualSeed: 42,
    providerTaskId: 'prompt-999',
    errorCode: null,
    errorMessage: null,
    upstreamMayContinue: false,
    cancellationScope: 'none' as const,
    retryOf: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    finishedAt: '2026-08-27T00:00:05.000Z',
    artifacts: [{
      artifactId: 'art-1',
      outputName: '9',
      sortOrder: 0,
      url: '/api/v1/artifacts/art-1',
      byteSize: 1024,
      contentType: 'image/png',
      sha256: 'abc',
    }],
  };
  assert.equal(Value.Check(GenerationTaskDescriptorSchema, validTask), true);

  const validEvent = {
    id: 1,
    taskId: 'gt-1',
    appId: 'linshe',
    eventType: 'accepted',
    payload: { status: 'accepted', providerTaskId: 'p-1' },
    createdAt: '2026-08-27T00:00:00.000Z',
  };
  assert.equal(Value.Check(GenerationEventSchema, validEvent), true);
});
