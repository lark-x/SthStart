import assert from 'node:assert/strict';
import test from 'node:test';
import { keyringAccount, keyringBackendAllowed } from './security.js';

test('keyring account keeps portable identifiers unchanged', () => {
  assert.equal(keyringAccount('profile-safe_model@host.test'), 'profile-safe_model@host.test');
});

test('keyring account deterministically encodes database separators', () => {
  const first = keyringAccount('profile:my-model');
  const second = keyringAccount('profile:my-model');
  assert.equal(first, second);
  assert.match(first, /^[A-Za-z0-9._@-]+$/);
  assert.ok(first.startsWith('profile-my-model-'));
  assert.notEqual(first, keyringAccount('profile-my-model'));
});

test('different unsafe logical accounts cannot collapse to one keyring account', () => {
  assert.notEqual(keyringAccount('profile:a/b'), keyringAccount('profile:a:b'));
});

test('keyring backend selection excludes the no-op backend', () => {
  assert.equal(keyringBackendAllowed('null', {}), false);
});

test('file backend is only selectable with an explicit master key', () => {
  assert.equal(keyringBackendAllowed('file', {}), false);
  assert.equal(keyringBackendAllowed('file', { KEYRING_FILE_MASTER_KEY: '   ' }), false);
  assert.equal(keyringBackendAllowed('file', { KEYRING_FILE_MASTER_KEY: 'a'.repeat(64) }), true);
});

test('system backed keyrings stay selectable so they win over the encrypted file', () => {
  for (const backend of ['native-windows', 'native-macos', 'native-linux', 'secret-service', 'windows', 'macos']) {
    assert.equal(keyringBackendAllowed(backend, {}), true);
  }
});
