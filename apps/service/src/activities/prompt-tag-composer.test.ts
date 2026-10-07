import assert from 'node:assert/strict';
import test from 'node:test';
import { composeActivityPrompt, prependLoraTriggerWords, cleanPromptFormatting } from './prompt-tag-composer.js';

test('composeActivityPrompt enforces solo on single character shots and removes conflicting crowd tags', () => {
  const input = '1boy, albedo, blond hair, 2girls, teal eyes';
  const composed = composeActivityPrompt(input, { isSingleActor: true });
  assert.match(composed, /\b1boy, solo, albedo\b/);
  assert.doesNotMatch(composed, /\b2girls\b/);
});

test('composeActivityPrompt preserves multi-character shots without adding solo', () => {
  const input = 'two persons, albedo and sucrose, standing in laboratory';
  const composed = composeActivityPrompt(input, { isSingleActor: false });
  assert.doesNotMatch(composed, /\bsolo\b/);
  assert.match(composed, /\btwo persons\b/);
});

test('structured studio sources preserve actor count and different character poses', () => {
  const result = composeActivityPrompt('albedo, standing, sucrose, sitting, sleeping, open_eyes', {
    isSingleActor: false, preserveActorSemantics: true,
  });
  assert.match(result, /standing/);
  assert.match(result, /sitting/);
  assert.match(result, /open_eyes/);
  assert.doesNotMatch(result, /solo|closed_eyes/);
  assert.equal(composeActivityPrompt('empty room'), 'empty room');
  assert.equal(composeActivityPrompt('1boy', { isSingleActor: true, preserveActorSemantics: true }), '1boy');
});

test('composeActivityPrompt resolves framing conflict groups', () => {
  const input = 'close-up, 1girl, alchemist, full_body, laboratory';
  const composed = composeActivityPrompt(input, { isSingleActor: true });
  assert.match(composed, /\bclose-up\b/);
  assert.doesNotMatch(composed, /\bfull_body\b/);
});

test('composeActivityPrompt handles sleep and closed_eyes gaze rule', () => {
  const input = '1girl, sleeping on desk, looking_at_viewer, night';
  const composed = composeActivityPrompt(input, { isSingleActor: true });
  assert.match(composed, /\bclosed_eyes\b/);
  assert.doesNotMatch(composed, /\blooking_at_viewer\b/);
});

test('composeActivityPrompt resolves day vs night lighting conflicts', () => {
  const input = '1boy, laboratory, night, bright_sunlight, outdoor snow';
  const composed = composeActivityPrompt(input, { isSingleActor: true });
  assert.match(composed, /\bnight\b/);
  assert.doesNotMatch(composed, /\bbright_sunlight\b/);
});

test('prependLoraTriggerWords prepends trigger words to front with proper commas and deduplication', () => {
  const loras = [
    { model: 'albedo_v2', triggerWord: 'albedo_genshin', strength: 0.85, enabled: true },
    { model: 'disabled_lora', triggerWord: 'should_not_appear', strength: 0.5, enabled: false },
    { model: 'winter_coat', triggerWord: 'winter_outfit', strength: 0.7, enabled: true },
  ];
  const prompt = '1boy, solo, albedo, alchemy lab';
  const finalPrompt = prependLoraTriggerWords(prompt, loras);
  assert.equal(finalPrompt, 'albedo_genshin, winter_outfit, 1boy, solo, albedo, alchemy lab');
});

test('cleanPromptFormatting cleans redundant commas and extra spaces', () => {
  const raw = '  1boy, ,  solo, , albedo ,  blond hair  ';
  assert.equal(cleanPromptFormatting(raw), '1boy, solo, albedo, blond hair');
});

test('composeActivityPrompt prepends loraTriggers and qualityPrefix in optimal order', () => {
  const input = '1boy, solo, albedo, alchemy lab';
  const composed = composeActivityPrompt(input, {
    qualityPrefix: 'masterpiece, best quality',
    loraTriggers: ['albedo_genshin', 'winter_coat'],
  });
  assert.equal(composed, 'albedo_genshin, winter_coat, masterpiece, best quality, 1boy, solo, albedo, alchemy lab');
});

test('composeActivityPrompt handles prompt weights and does not duplicate weighted solo', () => {
  const input = '1boy, (solo:1.1), (close-up:1.2), full_body, laboratory';
  const composed = composeActivityPrompt(input, { isSingleActor: true });
  // Should preserve the existing (solo:1.1) and NOT insert another solo
  assert.match(composed, /\(solo:1\.1\)/);
  assert.equal(composed.split(/\bsolo\b/).length - 1, 1);
  // Conflict resolution should remove conflicting full_body even though close-up is weighted
  assert.match(composed, /\(close-up:1\.2\)/);
  assert.doesNotMatch(composed, /\bfull_body\b/);
});

test('cleanPromptFormatting and composeActivityPrompt normalize Chinese commas and extra whitespace', () => {
  const input = '1girl，solo，(close-up:1.2)，rim light';
  const composed = composeActivityPrompt(input, { isSingleActor: true });
  assert.equal(composed, '1girl, solo, (close-up:1.2), rim light');
});


