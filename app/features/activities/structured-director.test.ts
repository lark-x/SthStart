import assert from 'node:assert/strict';
import test from 'node:test';
import { toggleDirectorSetting, validVisualNumericValue } from './structured-director';

test('director choices are exclusive within their field and never mutate authored text', () => {
  const local = { customPrompt: '(close_up:1.2), 独立原文', director: { shotSize: 'wide' as const, mood: 'tense' as const } };
  const next = { ...local, director: toggleDirectorSetting(local.director, 'shotSize', 'closeup') };
  assert.deepEqual(next.director, { shotSize: 'closeup', mood: 'tense' });
  assert.equal(next.customPrompt, local.customPrompt);
  assert.deepEqual(toggleDirectorSetting(next.director, 'shotSize', 'closeup'), { mood: 'tense' });
});
test('numeric controls respect schema constraints and do not turn empty input into zero', () => {
  const field = { type: 'integer', minimum: 256, maximum: 2048, step: 64 };
  assert.equal(validVisualNumericValue('1024', field), 1024);
  for (const raw of ['', ' ', '0', '1000', '4096', 'NaN', '512.5']) assert.equal(validVisualNumericValue(raw, field), null);
});
