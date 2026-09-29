import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceDatabase } from '../database.js';
import { StoryError, StoryStore } from './store.js';

test('story context settings accept the strict retention boundary and reject an equal trigger atomically', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new StoryStore(db);
    const project = store.createProject({ title: '上下文边界' });
    const valid = { contextWindow: 16384, outputTokens: 8192, compactThreshold: 0.5, retainTokens: 4095 };
    const updated = store.updateProject(project.id, { expectedRevision: project.revision, contextSettings: valid });
    assert.deepEqual(updated.contextSettings, valid);

    const invalid = { ...valid, retainTokens: 4096 };
    assert.throws(() => store.updateProject(project.id, {
      expectedRevision: updated.revision, summary: '不得部分写入', contextSettings: invalid,
    }), (error: unknown) => error instanceof StoryError && error.code === 'invalid_context_settings');
    assert.deepEqual(store.getProject(project.id), updated);
  } finally { db.close(); }
});

test('story documents use optimistic revisions and accepted proposals alone change canon', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new StoryStore(db);
    const item = store.createProject({ title: '雾港' });
    const outline = store.listDocuments(item.id).find((entry) => entry.kind === 'outline');
    assert.ok(outline);
    const updated = store.updateDocument(item.id, outline.id, { expectedRevision: 1, title: '主线', body: '旧大纲' });
    assert.throws(() => store.updateDocument(item.id, outline.id, { expectedRevision: 1, title: '过期', body: '错误覆盖' }),
      (error: unknown) => error instanceof StoryError && error.statusCode === 409);
    const character = store.createCharacter(item.id, { name: '林遥', notes: '寻找哥哥' });
    const session = store.createSession(item.id, '人物讨论');
    const suggestion = store.createProposal(item.id, { sessionId: session.id, kind: 'character', targetId: character.id,
      baseRevision: character.revision, proposedTitle: '林遥', proposedBody: '调查哥哥失踪背后的阴谋', reason: '加强主动性' });
    assert.equal(store.getCharacter(item.id, character.id)?.notes, '寻找哥哥');
    assert.equal(store.decideProposal(item.id, suggestion.id, 'accepted').status, 'accepted');
    assert.equal(store.getCharacter(item.id, character.id)?.notes, '调查哥哥失踪背后的阴谋');
    assert.equal(store.decideProposal(item.id, suggestion.id, 'accepted').status, 'accepted');
    const stale = store.createProposal(item.id, { sessionId: session.id, kind: 'outline', targetId: updated.id,
      baseRevision: updated.revision, proposedTitle: '新大纲', proposedBody: 'AI 建议', reason: '增加冲突' });
    store.updateDocument(item.id, updated.id, { expectedRevision: updated.revision, title: '人工编辑', body: '保留人工版本' });
    assert.throws(() => store.decideProposal(item.id, stale.id, 'accepted'),
      (error: unknown) => error instanceof StoryError && error.statusCode === 409);
    assert.equal(store.getDocument(item.id, updated.id)?.body, '保留人工版本');
    assert.equal(store.getProposal(item.id, stale.id)?.status, 'pending');
  } finally { db.close(); }
});

test('stale character proposals leave the manually revised canon and proposal unchanged', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new StoryStore(db);
    const project = store.createProject({ title: '角色提案' });
    const character = store.createCharacter(project.id, { name: '林遥', notes: '寻找哥哥' });
    const session = store.createSession(project.id, '角色讨论');
    const proposal = store.createProposal(project.id, { sessionId: session.id, kind: 'character', targetId: character.id,
      baseRevision: character.revision, proposedTitle: '林遥', proposedBody: 'AI 提案版本', reason: '补充背景' });
    const manual = store.updateCharacter(project.id, character.id, {
      expectedRevision: character.revision, name: '林遥（修订）', notes: '人工确认的设定',
    });

    assert.throws(() => store.decideProposal(project.id, proposal.id, 'accepted'),
      (error: unknown) => error instanceof StoryError && error.code === 'story_proposal_stale');
    assert.deepEqual(store.getCharacter(project.id, character.id), manual);
    assert.equal(store.getProposal(project.id, proposal.id)?.status, 'pending');
  } finally { db.close(); }
});

test('story sessions are independent and message idempotency never repeats a turn', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new StoryStore(db);
    const p = store.createProject({ title: '测试' });
    const a = store.createSession(p.id, 'A');
    const b = store.createSession(p.id, 'B');
    assert.notEqual(a.runtimeSessionId, b.runtimeSessionId);
    const sent = store.beginMessage(p.id, a.id, '第一问', 'request-0001');
    assert.equal(sent.created, true);
    assert.equal(store.beginMessage(p.id, a.id, '第一问', 'request-0001').created, false);
    assert.throws(() => store.beginMessage(p.id, a.id, '不同内容', 'request-0001'),
      (error: unknown) => error instanceof StoryError && error.code === 'story_idempotency_conflict');
    assert.throws(() => store.beginMessage(p.id, a.id, '第二问', 'request-0002'),
      (error: unknown) => error instanceof StoryError && error.code === 'story_session_busy');
    store.completeMessage(p.id, a.id, sent.item.id, '回答');
    assert.equal(store.listMessages(p.id, a.id).length, 2);
    assert.equal(store.listMessages(p.id, b.id).length, 0);
  } finally { db.close(); }
});

test('interrupted sessions recover pending messages and preserve idempotency until acknowledged', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new StoryStore(db);
    const project = store.createProject({ title: '会话恢复' });
    const interrupted = store.createSession(project.id, '中断会话');
    const idle = store.createSession(project.id, '空闲会话');
    const pending = store.beginMessage(project.id, interrupted.id, '继续调查港口', 'recovery-0001');

    assert.equal(store.recoverInterruptedSessions(), 1);
    assert.equal(store.recoverInterruptedSessions(), 0);
    assert.equal(store.getSession(interrupted.id)?.status, 'interrupted');
    assert.equal(store.getSession(idle.id)?.status, 'idle');
    assert.equal(store.listMessages(project.id, interrupted.id)[0]?.status, 'interrupted');
    assert.throws(() => store.completeMessage(project.id, interrupted.id, pending.item.id, '迟到的回复'),
      (error: unknown) => error instanceof StoryError && error.code === 'story_message_not_pending');

    const retry = store.beginMessage(project.id, interrupted.id, '继续调查港口', 'recovery-0001');
    assert.equal(retry.created, false);
    assert.equal(retry.item.id, pending.item.id);
    assert.equal(retry.item.status, 'interrupted');
    assert.throws(() => store.beginMessage(project.id, interrupted.id, '替换后的内容', 'recovery-0001'),
      (error: unknown) => error instanceof StoryError && error.code === 'story_idempotency_conflict');
    assert.throws(() => store.beginMessage(project.id, interrupted.id, '下一条消息', 'recovery-0002'),
      (error: unknown) => error instanceof StoryError && error.code === 'story_session_busy');

    assert.equal(store.acknowledgeInterruptedSession(project.id, interrupted.id).status, 'idle');
    assert.equal(store.beginMessage(project.id, interrupted.id, '确认恢复后的新问题', 'recovery-0002').created, true);
  } finally { db.close(); }
});

test('chapters keep immutable revisions, restore creates a new revision, and reorder uses project CAS', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new StoryStore(db);
    const project = store.createProject({ title: '章节版本' });
    const first = store.createDocument(project.id, { kind: 'chapter', title: '第一章', body: '# 初稿' });
    const second = store.createDocument(project.id, { kind: 'chapter', title: '第二章', body: '第二章正文' });
    const edited = store.updateDocument(project.id, first.id, { expectedRevision: first.revision, title: '第一章', body: '# 修订' });
    const history = store.listEntryRevisions(project.id, 'chapter', first.id);
    assert.deepEqual(history.map((item) => item.revision), [2, 1]);
    assert.equal(history[0]?.source, 'manual');
    const restored = store.restoreEntryRevision(project.id, 'chapter', first.id, history[1]!.id, edited.revision);
    assert.equal(restored.revision, 3);
    assert.equal('body' in restored && restored.body === '# 初稿', true);
    const currentProject = store.getProject(project.id)!;
    const reordered = store.reorderChapters(project.id, currentProject.revision, [second.id, first.id]);
    assert.equal(reordered.revision, currentProject.revision + 1);
    assert.deepEqual(store.listDocuments(project.id).filter((item) => item.kind === 'chapter').map((item) => item.id), [second.id, first.id]);
    assert.throws(() => store.reorderChapters(project.id, currentProject.revision, [first.id, second.id]),
      (error: unknown) => error instanceof StoryError && error.code === 'story_revision_conflict');
    assert.throws(() => store.reorderChapters(project.id, reordered.revision, [first.id, first.id]),
      (error: unknown) => error instanceof StoryError && error.code === 'story_chapter_order_invalid');
  } finally { db.close(); }
});

test('native DSH proposals may create entries but only acceptance writes canon and a revision', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new StoryStore(db);
    const project = store.createProject({ title: '提案创建' });
    const proposal = store.createNativeProposal(project.id, {
      operation: 'create', kind: 'chapter', targetId: null, baseRevision: null,
      proposedTitle: '雪夜', proposedBody: '角色在风雪中发现脚印。', reason: '推进悬念',
    }).proposal;
    assert.equal(proposal.origin, 'native_dsh');
    assert.equal(proposal.sessionId, null);
    assert.equal(store.listDocuments(project.id).some((item) => item.title === '雪夜'), false);
    const accepted = store.decideProposal(project.id, proposal.id, 'accepted');
    assert.equal(accepted.status, 'accepted');
    assert.ok(accepted.resultEntryId);
    const entry = store.getDocument(project.id, accepted.resultEntryId!);
    assert.equal(entry?.body, '角色在风雪中发现脚印。');
    assert.equal(store.listEntryRevisions(project.id, 'chapter', entry!.id)[0]?.source, 'proposal');
    const rejected = store.createNativeProposal(project.id, {
      operation: 'create', kind: 'scene', targetId: null, baseRevision: null,
      proposedTitle: '废弃场景', proposedBody: '不应进入正史', reason: '比较方案',
    }).proposal;
    store.decideProposal(project.id, rejected.id, 'rejected');
    assert.equal(store.listDocuments(project.id).some((item) => item.title === '废弃场景'), false);
  } finally { db.close(); }
});

test('bridge grants store only a hash, rotate, revoke, and search is bounded and paginated', () => {
  const db = new ServiceDatabase(':memory:');
  try {
    const store = new StoryStore(db);
    const first = store.createProject({ title: '甲项目' });
    const second = store.createProject({ title: '乙项目' });
    store.createDocument(first.id, { kind: 'chapter', title: '章节 A', body: '同一关键词在第一章。' });
    store.createDocument(first.id, { kind: 'chapter', title: '章节 B', body: '同一关键词在第二章。' });
    const grant = store.createBridgeGrant(first.id);
    const savedHash = (db.connection.prepare('SELECT token_hash FROM story_bridge_grants WHERE project_id=?').get(first.id) as { token_hash: string }).token_hash;
    assert.notEqual(savedHash, grant.token);
    assert.equal(store.authorizeBridge(first.id, grant.token), true);
    assert.equal(store.authorizeBridge(second.id, grant.token), false);
    const page = store.searchEntries(first.id, '同一关键词', 'chapter', 1, 0);
    assert.equal(page.items.length, 1);
    assert.equal(page.nextCursor, 1);
    const next = store.searchEntries(first.id, '同一关键词', 'chapter', 1, page.nextCursor!);
    assert.equal(next.items.length, 1);
    assert.equal(next.nextCursor, null);
    const rotated = store.createBridgeGrant(first.id);
    assert.equal(store.authorizeBridge(first.id, grant.token), false);
    assert.equal(store.authorizeBridge(first.id, rotated.token), true);
    store.revokeBridgeGrant(first.id);
    assert.equal(store.authorizeBridge(first.id, rotated.token), false);
  } finally { db.close(); }
});
