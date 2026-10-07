import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftSaveQueue } from '../../app/lib/draft-save-queue';

test('练习：保存失败后保留输入、版本和待保存状态', async () => {
  const queue = new DraftSaveQueue<string>();
  queue.document = '我的草稿'; queue.dirty = true;
  // TODO：用会拒绝的异步 save 模拟网络失败；记录 onError 调用。
  // TODO：断言 flush 结果、document、dirty、blocked 与 version。
  // TODO：显式解除 blocked，以成功 save 继续保存并断言状态。
  assert.fail('请实现网络失败和恢复两部分。');
});
