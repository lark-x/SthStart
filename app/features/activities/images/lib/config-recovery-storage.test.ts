import test from 'node:test';
import assert from 'node:assert/strict';
import type { ImageConfigDocument } from '@sthstart/contracts';
import { clearImageConfigRecovery, readImageConfigRecovery, writeImageConfigRecovery } from './config-recovery-storage';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const document: ImageConfigDocument = {
  schemaVersion: 1,
  stylePreset: 'anime_standard',
  globalStylePrompt: '',
  globalNegativePrompt: '',
  slotConfigs: [],
};

test('recovery storage round-trips and clears through the injected browser store', () => {
  const storage = new MemoryStorage();
  writeImageConfigRecovery('activity:a1', { version: 4, baseline: 'base', document }, storage);
  assert.deepEqual(readImageConfigRecovery('activity:a1', storage), { version: 4, baseline: 'base', document });
  clearImageConfigRecovery('activity:a1', storage);
  assert.equal(readImageConfigRecovery('activity:a1', storage), null);
});

test('unavailable or malformed recovery never blocks the editor', () => {
  const storage = new MemoryStorage();
  storage.setItem('broken', '{');
  assert.equal(readImageConfigRecovery('broken', null), null);
  assert.equal(readImageConfigRecovery('broken', storage), null);
  assert.doesNotThrow(() => writeImageConfigRecovery('x', { version: 1, baseline: '', document }, null));
  assert.doesNotThrow(() => clearImageConfigRecovery('x', null));
});
