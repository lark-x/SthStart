import assert from 'node:assert/strict';
import test from 'node:test';
import { applyThemeMode, readThemeMode } from './theme-preference';

test('theme preference defaults to warm and migrates legacy values', () => {
  const values = new Map<string, string>();
  const get = (key: string) => values.get(key) ?? null;
  assert.equal(readThemeMode(get), 'warm');
  values.set('sthstart_eye_care_mode', 'false');
  assert.equal(readThemeMode(get), 'neutral');
  values.set('sthstart_eye_care_mode', 'true');
  assert.equal(readThemeMode(get), 'warm');
});

test('new theme preference takes precedence over legacy preference', () => {
  const values = new Map([['sthstart_theme', 'neutral'], ['sthstart_eye_care_mode', 'true']]);
  assert.equal(readThemeMode((key) => values.get(key) ?? null), 'neutral');
});

test('applying neutral removes the legacy warm marker', () => {
  const values = new Map<string, string>([['data-eye-care', 'true']]);
  const root = {
    setAttribute: (key: string, value: string) => values.set(key, value),
    removeAttribute: (key: string) => values.delete(key),
  };
  applyThemeMode(root, 'neutral');
  assert.equal(values.get('data-theme'), 'neutral');
  assert.equal(values.has('data-eye-care'), false);
});
