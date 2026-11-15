import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClientError } from '@/app/lib/api-client';
import {
  DraftSaveController,
  isConflictError,
  createSessionStorageAdapter,
  createLocalStorageAdapter,
} from './index';

test('a clean flush does not start a save or change its status', async () => {
  const controller = new DraftSaveController<string>();
  controller.document = 'saved';
  let started = false;
  assert.equal(await controller.flush(async () => assert.fail('clean document was written'), assert.fail, {
    onStart: () => { started = true; },
  }), true);
  assert.equal(started, false);
  assert.equal(controller.isClean(), true);
});

test('disposing a draft session cancels its pending autosave', async () => {
  const controller = new DraftSaveController<string>();
  let calls = 0;
  controller.schedule(() => { calls++; }, 10);
  controller.dispose();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 0);
});

test('isConflictError recognizes ApiClientError 409 and conflict messages', () => {
  assert.equal(isConflictError(new ApiClientError('conflict', { status: 409 })), true);
  assert.equal(isConflictError({ status: 409 }), true);
  assert.equal(isConflictError(new Error('draft_version_conflict')), true);
  assert.equal(isConflictError('version conflict detected'), true);
  assert.equal(isConflictError(new Error('network_error')), false);
  assert.equal(isConflictError(new ApiClientError('not found', { status: 404 })), false);
  assert.equal(isConflictError(null), false);
});

test('controller debounces consecutive updates into a single scheduled flush', async () => {
  const controller = new DraftSaveController<string>({ debounceMs: 50 });
  const saves: Array<[string, number]> = [];

  controller.document = 'step 1';
  controller.dirty = true;
  controller.schedule(() => {
    void controller.flush(
      async (doc, ver) => { saves.push([doc, ver]); return ver + 1; },
      (err) => assert.fail(String(err))
    );
  }, 30);

  // Rapid subsequent update replaces pending timer
  controller.document = 'step 2';
  controller.schedule(() => {
    void controller.flush(
      async (doc, ver) => { saves.push([doc, ver]); return ver + 1; },
      (err) => assert.fail(String(err))
    );
  }, 30);

  await new Promise(r => setTimeout(r, 60));
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0], ['step 2', 1]);
  assert.equal(controller.version, 2);
  assert.equal(controller.dirty, false);
});

test('input arriving during active save is coalesced and saved with new version', async () => {
  const controller = new DraftSaveController<string>();
  controller.document = 'first edit';
  controller.dirty = true;

  let releaseFirstSave!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirstSave = resolve; });
  const calls: Array<[string, number]> = [];

  const flushPromise = controller.flush(
    async (doc, ver) => {
      calls.push([doc, ver]);
      if (calls.length === 1) await firstGate;
      return ver + 1;
    },
    (err) => assert.fail(String(err))
  );

  // Author continues typing while first save is in flight
  controller.document = 'second edit during save';
  controller.dirty = true;

  assert.equal(controller.saving, true);
  assert.equal(calls.length, 1);

  // Release first save
  releaseFirstSave();
  const result = await flushPromise;

  assert.equal(result, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [
    ['first edit', 1],
    ['second edit during save', 2],
  ]);
  assert.equal(controller.version, 3);
  assert.equal(controller.dirty, false);
  assert.equal(controller.isClean(), true);
});

test('409 conflict stops auto-save and retains dirty local input', async () => {
  const controller = new DraftSaveController<string>();
  controller.document = 'conflicted local content';
  controller.dirty = true;
  controller.version = 5;

  let reportedConflict = false;
  let errorCount = 0;

  const result = await controller.flush(
    async () => {
      throw new ApiClientError('Server revision changed', { status: 409 });
    },
    (_err, isConflict) => {
      errorCount++;
      reportedConflict = isConflict;
    }
  );

  assert.equal(result, false);
  assert.equal(reportedConflict, true);
  assert.equal(errorCount, 1);
  assert.equal(controller.blocked, true);
  assert.equal(controller.dirty, true);
  assert.equal(controller.document, 'conflicted local content');

  // Consecutive flush while blocked must return false immediately without network calls
  let attemptedSave = false;
  const secondResult = await controller.flush(
    async () => { attemptedSave = true; return 6; },
    () => assert.fail('should not invoke error handler')
  );
  assert.equal(secondResult, false);
  assert.equal(attemptedSave, false);
});

test('retry strategy unblocks queue and flushes dirty input with updated version', async () => {
  const controller = new DraftSaveController<string>();
  controller.document = 'retry text';
  controller.dirty = true;
  controller.version = 3;

  // First attempt fails with network error
  await controller.flush(
    async () => { throw new Error('network unreachable'); },
    (_err, conflict) => { assert.equal(conflict, false); }
  );

  assert.equal(controller.blocked, true);
  assert.equal(controller.dirty, true);

  // Retry action: unblock and flush
  controller.unblock();
  assert.equal(controller.blocked, false);

  const ok = await controller.flush(
    async (doc, ver) => {
      assert.equal(doc, 'retry text');
      assert.equal(ver, 3);
      return 4;
    },
    (err) => assert.fail(String(err))
  );

  assert.equal(ok, true);
  assert.equal(controller.version, 4);
  assert.equal(controller.dirty, false);
  assert.equal(controller.isClean(), true);
});

test('recovery strategy: explicit choice between keepLocal and acceptServer', async () => {
  const controller = new DraftSaveController<{ title: string }>();
  controller.document = { title: 'draft from local storage' };
  controller.dirty = true;
  controller.blocked = true;
  controller.version = 1;

  // Scenario A: Keep local edits and resave on top of server version 4
  const serverVersion = 4;
  controller.version = serverVersion;
  controller.unblock();
  assert.equal(controller.blocked, false);

  const saveCalls: Array<[{ title: string }, number]> = [];
  const saved = await controller.flush(
    async (doc, ver) => { saveCalls.push([doc, ver]); return ver + 1; },
    (err) => assert.fail(String(err))
  );
  assert.equal(saved, true);
  assert.deepEqual(saveCalls, [[{ title: 'draft from local storage' }, 4]]);
  assert.equal(controller.version, 5);
  assert.equal(controller.dirty, false);

  // Scenario B: Accept server version, discard local edits
  const serverDocument = { title: 'official server title' };
  controller.document = serverDocument;
  controller.version = 10;
  controller.dirty = false;
  controller.blocked = false;

  assert.equal(controller.document.title, 'official server title');
  assert.equal(controller.dirty, false);
  assert.equal(controller.isClean(), true);
});

test('storage adapters handle session and local storage with validation and safe parsing', () => {
  const mockStorageMap = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => mockStorageMap.get(key) ?? null,
    setItem: (key: string, value: string) => { mockStorageMap.set(key, value); },
    removeItem: (key: string) => { mockStorageMap.delete(key); },
  };

  interface TestDoc {
    schemaVersion: number;
    text: string;
  }
  const validator = (raw: unknown): raw is TestDoc => {
    const candidate = raw as TestDoc | null;
    return Boolean(candidate && candidate.schemaVersion === 1 && typeof candidate.text === 'string');
  };

  const adapter = createSessionStorageAdapter<TestDoc>('sthstart:test:key', validator, mockStorage);

  // Empty initially
  assert.equal(adapter.get(), null);

  // Valid write and read
  const ok = adapter.set({ schemaVersion: 1, text: 'hello draft' });
  assert.equal(ok, true);
  assert.deepEqual(adapter.get(), { schemaVersion: 1, text: 'hello draft' });

  // Schema mismatch rejected
  mockStorageMap.set('sthstart:test:key', JSON.stringify({ schemaVersion: 2, text: 'wrong version' }));
  assert.equal(adapter.get(), null);

  // Malformed JSON handled safely without throwing
  mockStorageMap.set('sthstart:test:key', '{ invalid json ...');
  assert.equal(adapter.get(), null);

  // Remove
  adapter.remove();
  assert.equal(adapter.get(), null);

  // Quota exceeded simulation
  const failingStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  };
  const failingAdapter = createLocalStorageAdapter('quota:key', undefined, failingStorage);
  assert.equal(failingAdapter.set('large content'), false);
});
