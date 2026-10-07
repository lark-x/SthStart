import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftSaveQueue } from '../../app/lib/draft-save-queue';

test('参考答案：网络失败保留草稿，显式恢复后使用原版本重试', async () => {
  const queue = new DraftSaveQueue<string>();
  queue.document = '尚未保存的章节'; queue.dirty = true; queue.version = 7;
  const errors: unknown[] = [];
  assert.equal(await queue.flush(async () => { throw new Error('offline'); }, error => errors.push(error)), false);
  assert.equal(queue.document, '尚未保存的章节'); assert.equal(queue.dirty, true);
  assert.equal(queue.version, 7); assert.equal(queue.blocked, true); assert.equal(errors.length, 1);
  queue.blocked = false;
  assert.equal(await queue.flush(async (body, version) => {
    assert.equal(body, '尚未保存的章节'); assert.equal(version, 7); return 8;
  }, error => assert.fail(String(error))), true);
  assert.equal(queue.dirty, false); assert.equal(queue.version, 8);
});
