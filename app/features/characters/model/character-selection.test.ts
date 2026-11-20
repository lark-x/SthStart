import assert from 'node:assert/strict';
import test from 'node:test';
import type { CharacterProfile, CharacterVersion } from '@sthstart/contracts';
import { resolveCharacterSelection } from './character-selection';
import { activityActorFromCharacterSelection } from './selection-consumers';
import { publishedCharacterInput } from '@/app/features/projects/published-character';
import { EMPTY_DRAFT_V2 } from '../schemas';

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});
const profile: CharacterProfile = {
  id: 'source-1',
  slug: 'lin',
  displayName: '林',
  draft: {
    ...EMPTY_DRAFT_V2,
    displayName: '林',
    originType: 'original',
    summary: '港口信使',
    personaText: '主档案正文',
  },
  tags: [],
  avatarUrl: null,
  latestVersion: null,
  archived: false,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  draftRevision: 4,
};
const version: CharacterVersion = {
  characterId: profile.id,
  version: 2,
  versionLabel: '远行之前',
  data: profile.draft,
  compiledLinshePrompt: '',
  relationships: [],
  createdAt: '2026-01-01',
  draftRevision: 4,
  variants: [
    {
      id: 'sp',
      name: 'SP',
      personaText: 'SP专属故事',
      appearance: { baseText: '银发', defaultOutfitText: '铠甲' },
    },
  ],
  assets: [
    {
      id: 'coat',
      characterId: profile.id,
      title: '冬衣',
      kind: 'reference',
      category: 'costume',
      url: '',
      artifactId: null,
      metadata: { outfitDescription: '白色冬衣', loreStory: '雪山纪念' },
      tags: [],
      createdAt: '2026-01-01',
      sourceUrl: null,
      sourcePage: null,
    },
  ],
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body =
      url === '/api/auth/admin-session'
        ? { csrfToken: 'test-only' }
        : handler(url, init);
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test('an original without a saved stage never publishes during selection or project adoption', async () => {
  const mutations: string[] = [];
  mockFetch((url, init) => {
    if (init?.method === 'POST') mutations.push(url);
    return {
      ...profile,
      versions: [],
      sources: [],
      relationships: [],
      links: [],
    };
  });
  await assert.rejects(resolveCharacterSelection(profile), /尚未保存阶段/);
  await assert.rejects(publishedCharacterInput(profile), /尚未保存阶段/);
  assert.deepEqual(mutations, []);
});

test('original selection preserves an explicitly chosen named stage without publishing', async () => {
  mockFetch((url, init) => {
    assert.notEqual(init?.method, 'POST');
    return {
      ...profile,
      latestVersion: 3,
      versions: [{ ...version, version: 3 }, version],
      sources: [],
      relationships: [],
      links: [],
    };
  });
  const choice = await resolveCharacterSelection(profile, { version: 2 });
  assert.equal(choice.version.versionLabel, '远行之前');
  assert.equal(choice.version.version, 2);
});

test('non-original selection freezes the current revision and uses the returned latest snapshot', async () => {
  let published = 0;
  const ip = {
    ...profile,
    draft: { ...profile.draft, originType: 'ip' as const },
    latestVersion: 1,
  };
  mockFetch((url, init) => {
    if (url.endsWith('/publish')) {
      published++;
      assert.deepEqual(JSON.parse(String(init?.body)), {
        expectedDraftRevision: 4,
      });
      return version;
    }
    return {
      ...ip,
      versions: [version],
      sources: [],
      relationships: [],
      links: [],
    };
  });
  const choice = await resolveCharacterSelection(ip);
  assert.equal(choice.version.version, 2);
  assert.equal(published, 1);
});

test('project and activity adoption consume the same frozen variant and text-only costume', async () => {
  const choice = {
    profile,
    versions: [version],
    version,
    variantId: 'sp',
    costumeAssetId: 'coat',
  };
  let snapshotUrl = '';
  mockFetch((url) => {
    snapshotUrl = url;
    return {
      id: 'actor-1',
      displayName: '旧稿',
      persona: {},
      activityRole: '参与者',
      outfitDescription: '旧服装',
    };
  });
  const project = await publishedCharacterInput(profile, choice);
  assert.match(project.notes || '', /SP专属故事/);
  assert.match(project.notes || '', /雪山纪念/);
  assert.match(project.notes || '', /白色冬衣/);
  assert.equal(project.sourceVariantId, 'sp');
  assert.equal(project.sourceCostumeAssetId, 'coat');
  const actor = await activityActorFromCharacterSelection(choice);
  assert.match(snapshotUrl, /version=2&variantId=sp&costumeAssetId=coat/);
  assert.equal(actor.sourceVersion, 2);
  assert.equal(actor.sourceVariantId, 'sp');
  assert.equal(actor.outfitDescription, '白色冬衣');
  assert.match(String(actor.persona.personaText), /SP专属故事/);
  assert.match(String(actor.persona.personaText), /雪山纪念/);
  assert.equal(profile.draft.summary, '港口信使');
});
