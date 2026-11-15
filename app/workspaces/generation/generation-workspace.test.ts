import type { ImageContextSelection } from '@sthstart/contracts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectedImageGenerationPanel,
  GenerationSourcesPicker,
  loadGenerationContextChoices,
  adaptEffectiveContext,
  toggleCharacterInContext,
  toggleNoteInContext,
  isCharacterInContext,
  isNoteInContext,
} from './index';
import { ImageGenerationPanel } from '@/app/features/generation/components/image-generation-panel';

test('ConnectedImageGenerationPanel and workspace exports have expected types and contracts', () => {
  assert.equal(typeof ConnectedImageGenerationPanel, 'function');
  assert.equal(typeof GenerationSourcesPicker, 'function');
  assert.equal(typeof ImageGenerationPanel, 'function');
  assert.equal(typeof loadGenerationContextChoices, 'function');
  assert.equal(typeof adaptEffectiveContext, 'function');
  assert.equal(typeof toggleCharacterInContext, 'function');
  assert.equal(typeof toggleNoteInContext, 'function');
  assert.equal(typeof isCharacterInContext, 'function');
  assert.equal(typeof isNoteInContext, 'function');
});

test('adaptEffectiveContext merges selected notes into fixed base context', () => {
  const fixedBase = {
    characters: [{ characterId: 'char-1', draftRevision: 2 }],
    noteIds: ['note-base'],
  };

  const selected = {
    characters: [{ characterId: 'char-ignored' }],
    noteIds: ['note-user-1', 'note-user-2'],
  };

  const result = adaptEffectiveContext(fixedBase, selected);
  assert.deepEqual(result, {
    characters: [{ characterId: 'char-1', draftRevision: 2 }],
    noteIds: ['note-user-1', 'note-user-2'],
  });

  // When selected has no noteIds, base noteIds are preserved
  const resultPreserved = adaptEffectiveContext(fixedBase, {});
  assert.deepEqual(resultPreserved, fixedBase);

  // When baseContext is undefined, selectedContext is used directly
  assert.deepEqual(adaptEffectiveContext(undefined, selected), selected);
  assert.deepEqual(adaptEffectiveContext(undefined, undefined), {});
});

test('toggleCharacterInContext adds, removes, and enforces max limit of 8 characters', () => {
  let context: ImageContextSelection = {};

  // Add first character
  context = toggleCharacterInContext(context, 'char-1', true);
  assert.deepEqual(context.characters, [{ characterId: 'char-1' }]);
  assert.equal(isCharacterInContext(context, 'char-1'), true);
  assert.equal(isCharacterInContext(context, 'char-2'), false);

  // Add more characters up to limit 8
  for (let i = 2; i <= 8; i++) {
    context = toggleCharacterInContext(context, `char-${i}`, true);
  }
  assert.equal(context.characters?.length, 8);

  // 9th character is trimmed by maxCharacters = 8
  context = toggleCharacterInContext(context, 'char-9', true);
  assert.equal(context.characters?.length, 8);
  assert.equal(isCharacterInContext(context, 'char-9'), false);

  // Remove a character
  context = toggleCharacterInContext(context, 'char-1', false);
  assert.equal(context.characters?.length, 7);
  assert.equal(isCharacterInContext(context, 'char-1'), false);
});

test('toggleNoteInContext adds, removes, and enforces max limit of 12 notes', () => {
  let context: ImageContextSelection = {};

  // Add note
  context = toggleNoteInContext(context, 'note-1', true);
  assert.deepEqual(context.noteIds, ['note-1']);
  assert.equal(isNoteInContext(context, 'note-1'), true);
  assert.equal(isNoteInContext(context, 'note-2'), false);

  // Add up to 12 notes
  for (let i = 2; i <= 12; i++) {
    context = toggleNoteInContext(context, `note-${i}`, true);
  }
  assert.equal(context.noteIds?.length, 12);

  // 13th note is trimmed by maxNotes = 12
  context = toggleNoteInContext(context, 'note-13', true);
  assert.equal(context.noteIds?.length, 12);
  assert.equal(isNoteInContext(context, 'note-13'), false);

  // Remove a note
  context = toggleNoteInContext(context, 'note-1', false);
  assert.equal(context.noteIds?.length, 11);
  assert.equal(isNoteInContext(context, 'note-1'), false);
});
