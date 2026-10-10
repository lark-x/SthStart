import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyThemeId,
  applyThemeMode,
  readThemeId,
  readThemeMode,
  THEMES,
  THEME_BOOTSTRAP_SCRIPT,
} from './theme-preference';

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

test('readThemeId correctly resolves 4-tier theme matrix and legacy keys', () => {
  const values = new Map<string, string>();
  const get = (key: string) => values.get(key) ?? null;

  // Default fallback
  assert.equal(readThemeId(get, false), 'light-paper');
  assert.equal(readThemeId(get, true), 'dark-espresso');

  // Exact 4 theme IDs
  values.set('sthstart_theme_id', 'dark-obsidian');
  assert.equal(readThemeId(get, false), 'dark-obsidian');

  values.set('sthstart_theme_id', 'light-zinc');
  assert.equal(readThemeId(get, false), 'light-zinc');

  values.set('sthstart_theme_id', 'dark-espresso');
  assert.equal(readThemeId(get, false), 'dark-espresso');

  // Legacy theme key fallback
  values.delete('sthstart_theme_id');
  values.set('sthstart_theme', 'warm');
  assert.equal(readThemeId(get, false), 'light-paper');

  values.set('sthstart_theme', 'neutral');
  assert.equal(readThemeId(get, false), 'light-zinc');

  // Legacy eye care mode fallback
  values.delete('sthstart_theme');
  values.set('sthstart_eye_care_mode', 'false');
  assert.equal(readThemeId(get, false), 'light-zinc');

  values.set('sthstart_eye_care_mode', 'true');
  assert.equal(readThemeId(get, false), 'light-paper');
});

test('applyThemeId sets data-theme, data-color-mode, style.colorScheme and data-eye-care correctly', () => {
  const values = new Map<string, string>();
  const style: { colorScheme?: string } = {};
  const root = {
    setAttribute: (key: string, value: string) => values.set(key, value),
    removeAttribute: (key: string) => values.delete(key),
    style,
  };

  applyThemeId(root, 'light-paper');
  assert.equal(values.get('data-theme'), 'light-paper');
  assert.equal(values.get('data-color-mode'), 'light');
  assert.equal(style.colorScheme, 'light');
  assert.equal(values.get('data-eye-care'), 'true');

  applyThemeId(root, 'light-zinc');
  assert.equal(values.get('data-theme'), 'light-zinc');
  assert.equal(values.get('data-color-mode'), 'light');
  assert.equal(style.colorScheme, 'light');
  assert.equal(values.has('data-eye-care'), false);

  applyThemeId(root, 'dark-espresso');
  assert.equal(values.get('data-theme'), 'dark-espresso');
  assert.equal(values.get('data-color-mode'), 'dark');
  assert.equal(style.colorScheme, 'dark');
  assert.equal(values.has('data-eye-care'), false);

  applyThemeId(root, 'dark-obsidian');
  assert.equal(values.get('data-theme'), 'dark-obsidian');
  assert.equal(values.get('data-color-mode'), 'dark');
  assert.equal(style.colorScheme, 'dark');
  assert.equal(values.has('data-eye-care'), false);
});

test('THEMES constant covers all 4 matrix entries', () => {
  assert.equal(THEMES.length, 4);
  assert.deepEqual(THEMES.map((t) => t.id), [
    'light-paper',
    'light-zinc',
    'dark-espresso',
    'dark-obsidian',
  ]);
});

test('THEME_BOOTSTRAP_SCRIPT covers all 4 matrix entries and sets style.colorScheme', () => {
  assert.match(THEME_BOOTSTRAP_SCRIPT, /light-paper/);
  assert.match(THEME_BOOTSTRAP_SCRIPT, /light-zinc/);
  assert.match(THEME_BOOTSTRAP_SCRIPT, /dark-espresso/);
  assert.match(THEME_BOOTSTRAP_SCRIPT, /dark-obsidian/);
  assert.match(THEME_BOOTSTRAP_SCRIPT, /style\.colorScheme/);
});
