import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeKeys, characterKeys, notebookKeys, narrativeKeys, providerKeys } from './query-keys';
import { cn } from './cn';
import { Value } from '@sinclair/typebox/value';
import {
  CharacterDraftSchema,
  AppConfigResponseSchema,
} from '@sthstart/contracts';

test('query key factories generate structured immutable key tuples', () => {
  assert.deepEqual(runtimeKeys.overview(), ['runtime', 'overview']);
  assert.deepEqual(characterKeys.list({ query: 'test' }), ['characters', 'list', { query: 'test' }]);
  assert.deepEqual(characterKeys.detail('c1'), ['characters', 'detail', 'c1']);
  assert.deepEqual(notebookKeys.list({ kind: 'diary' }), ['notebook', 'list', { kind: 'diary' }]);
  assert.deepEqual(narrativeKeys.tree('w1'), ['narrative', 'tree', 'w1']);
  assert.deepEqual(providerKeys.overview(), ['providers', 'overview']);
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
});
