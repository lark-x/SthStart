import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_TONES, pickAvatarTone } from './avatar-tone';

test('avatar tone is stable for the same name', () => {
  assert.equal(pickAvatarTone('芙宁娜'), pickAvatarTone('芙宁娜'));
  assert.equal(pickAvatarTone('林舟'), pickAvatarTone('林舟'));
});

test('avatar tone always resolves to a declared semantic tone', () => {
  for (const name of ['', '?', '芙宁娜', 'Nahida', '空之律者', '钟离', 'a'.repeat(120)]) {
    assert.ok(AVATAR_TONES.includes(pickAvatarTone(name)));
  }
});

test('neighbouring names do not all collapse onto one tone', () => {
  const tones = new Set(['林舟', '许知夏', '陈望', '方遥', '钟离', '芙宁娜', '雷电将军'].map(pickAvatarTone));
  assert.ok(tones.size >= 3, `expected at least 3 tones, received ${[...tones].join(', ')}`);
});
