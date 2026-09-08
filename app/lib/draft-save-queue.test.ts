import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftSaveQueue } from './draft-save-queue';

test('draft writer serializes slow requests and coalesces newer input using returned versions', async () => {
  const queue = new DraftSaveQueue<string>();
  queue.document = 'first'; queue.dirty = true;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: Array<[string, number]> = [];
  const save = async (document: string, version: number) => {
    calls.push([document, version]);
    if (calls.length === 1) await gate;
    return version + 1;
  };
  const first = queue.flush(save, (error) => assert.fail(String(error)));
  queue.document = 'second'; queue.dirty = true;
  queue.document = 'latest';
  assert.equal(queue.flush(save, (error) => assert.fail(String(error))), first);
  assert.equal(calls.length, 1);
  release();
  assert.equal(await first, true);
  assert.deepEqual(calls, [['first', 1], ['latest', 2]]);
  assert.equal(queue.version, 3);
  assert.equal(queue.dirty, false);
});

test('draft writer retains input on conflict and resumes only after explicit resolution', async () => {
  const queue = new DraftSaveQueue<string>();
  queue.document = 'my input'; queue.dirty = true;
  let failures = 0;
  const save = async () => { throw new Error('draft_version_conflict'); };
  assert.equal(await queue.flush(save, () => failures++), false);
  assert.equal(queue.document, 'my input');
  assert.equal(queue.dirty, true);
  assert.equal(await queue.flush(save, () => failures++), false);
  assert.equal(failures, 1);
  queue.blocked = false; queue.version = 9;
  assert.equal(await queue.flush(async (text, version) => { assert.equal(text, 'my input'); assert.equal(version, 9); return 10; }, (error) => assert.fail(String(error))), true);
  assert.equal(queue.version, 10);
});
