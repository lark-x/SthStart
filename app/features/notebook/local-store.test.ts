import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreativeNote } from '@sthstart/contracts';
import {
  canAdvancePendingRevision,
  canClaimSyncLease,
  draftBaseRevision,
  mergeAcknowledgedWrite,
  nextLocalNoteRecord,
  type LocalNoteRecord,
} from './local-store';

const NOTE: CreativeNote = {
  id: 'note-1',
  title: '傍晚的车站',
  kind: 'note',
  summary: '摘要',
  content: [{ id: 'body', type: 'text', text: '本机新写的正文' }],
  tags: [],
  stage: 'draft',
  favorite: false,
  revision: 1,
};

function record(patch: Partial<LocalNoteRecord> = {}): LocalNoteRecord {
  return {
    noteId: 'note-1',
    note: NOTE,
    localVersion: 2,
    status: 'pending',
    updatedAt: 1_000,
    attemptCount: 0,
    nextAttemptAt: 0,
    ...patch,
  };
}

test('a draft rebases onto a revision this tab wrote and had acknowledged', () => {
  // 回归：PUT 200 rev2 到达时编辑器还在写，草稿基线仍是 rev1；下一次保存
  // 必须沿用本标签页自己的 rev2，否则会拿 rev1 再 PUT 一次并收到假 409。
  assert.equal(draftBaseRevision(1, 2, new Set([1, 2])), 2);
});

test('a revision observed from the server is never promoted into the draft baseline', () => {
  // 外部编辑把服务端推进到 rev2，本标签页只读到它、没有写过它。
  assert.equal(draftBaseRevision(1, 2, new Set()), 1);
  assert.equal(draftBaseRevision(1, 2, new Set([2])), 1);
  assert.equal(draftBaseRevision(1, undefined), 1);
});

test('an already current or newer draft revision is left alone', () => {
  assert.equal(draftBaseRevision(2, 2, new Set([1, 2])), 2);
  assert.equal(draftBaseRevision(3, 2, new Set([1, 2])), 3);
  // 新建笔记第一次确认前没有 revision，只能采用本标签页的确认值。
  assert.equal(draftBaseRevision(undefined, 1, new Set([1])), 1);
  assert.equal(draftBaseRevision(undefined, undefined), undefined);
});

test('saving a draft keeps its content and adopts the acknowledged baseline', () => {
  const saved = nextLocalNoteRecord(record(), NOTE, 'pending', 5_000, { revision: 2, proven: new Set([1, 2]) });
  assert.equal(saved.note.revision, 2);
  assert.deepEqual(saved.note.content, NOTE.content);
  assert.equal(saved.localVersion, 3);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.updatedAt, 5_000);
});

test('a conflict is never rebased and keeps its local content', () => {
  const saved = nextLocalNoteRecord(
    record({ status: 'conflict', error: '服务端笔记已变化' }),
    NOTE,
    'pending',
    5_000,
    { revision: 2, proven: new Set([1, 2]) },
  );
  assert.equal(saved.status, 'conflict');
  assert.equal(saved.error, '服务端笔记已变化');
  assert.equal(saved.note.revision, 1, 'the stale base is preserved so the retry still conflicts');
  assert.deepEqual(saved.note.content, NOTE.content);
});

test('a synced hydration does not claim an acknowledged baseline', () => {
  const saved = nextLocalNoteRecord(undefined, NOTE, 'synced', 5_000, { revision: 9, proven: new Set([9]) });
  assert.equal(saved.status, 'synced');
  assert.equal(saved.note.revision, 1);
  assert.equal(saved.localVersion, 1);
});

test('only one live claim per revision: a fresh in-flight write blocks a second tab', () => {
  const now = 100_000;
  assert.equal(canClaimSyncLease(record({ status: 'syncing', updatedAt: now - 1_000 }), 2, now), false);
  // 边界与 pendingLocalNotes 一致：租约必须严格早于 60s 才算过期。
  assert.equal(canClaimSyncLease(record({ status: 'syncing', updatedAt: now - 60_000 }), 2, now), false);
  assert.equal(canClaimSyncLease(record({ status: 'syncing', updatedAt: now - 60_001 }), 2, now), true);
  assert.equal(canClaimSyncLease(record({ status: 'pending' }), 2, now), true);
  assert.equal(canClaimSyncLease(record({ status: 'synced' }), 2, now), false);
  assert.equal(canClaimSyncLease(record({ status: 'conflict' }), 2, now), false);
  assert.equal(canClaimSyncLease(record({ localVersion: 3 }), 2, now), false, 'stale list entry');
  assert.equal(canClaimSyncLease(undefined, 2, now), false);
});

test('consecutive writes keep the acknowledged revision chain', () => {
  const first = mergeAcknowledgedWrite(undefined, 1, 2);
  assert.equal(first.revision, 2);
  assert.deepEqual([...first.proven].sort(), [1, 2]);
  const second = mergeAcknowledgedWrite(first, 2, 3);
  assert.equal(second.revision, 3);
  assert.deepEqual([...second.proven].sort(), [1, 2, 3]);
});

test('a write that skips an unknown revision starts a new chain', () => {
  // 本机确认 1→2；另一台设备写了 2→3；界面刷新后从 3 写 4。
  const local = mergeAcknowledgedWrite(undefined, 1, 2);
  const afterExternal = mergeAcknowledgedWrite(local, 3, 4);
  assert.equal(afterExternal.revision, 4);
  assert.deepEqual([...afterExternal.proven].sort(), [3, 4], 'the unknown 2→3 jump is not licensed');
  // 仍停在 rev1 的草稿不能被抬到 4，必须继续拿 rev1 去撞真实 409。
  assert.equal(draftBaseRevision(1, afterExternal.revision, afterExternal.proven), 1);
  // 而基于 3 的草稿可以安全前进到 4。
  assert.equal(draftBaseRevision(3, afterExternal.revision, afterExternal.proven), 4);
});

test('the provenance set stays bounded across a long session', () => {
  let state = mergeAcknowledgedWrite(undefined, 0, 1);
  for (let revision = 1; revision < 40; revision += 1) state = mergeAcknowledgedWrite(state, revision, revision + 1);
  assert.equal(state.revision, 40);
  assert.equal(state.proven.size, 8);
  assert.equal(state.proven.has(40), true);
});

test('a newer pending record only advances on the exact revision this request sent', () => {
  assert.equal(canAdvancePendingRevision(2, 2), true);
  assert.equal(canAdvancePendingRevision(1, 2), false);
  assert.equal(canAdvancePendingRevision(undefined, 2), false);
  assert.equal(canAdvancePendingRevision(2, undefined), false);
});
