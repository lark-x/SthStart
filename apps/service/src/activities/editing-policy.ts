import { createHash } from 'node:crypto';
import type { ActivityCandidate, ContentDocument } from '@sthstart/contracts';

function conflict(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, statusCode: 409 });
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function stageContent(doc: ContentDocument, id: string) {
  const posts = doc.posts.filter(p => p.stageId === id);
  return { stage: doc.stages.filter(s => s.id === id).map(s => ({ ...s, locked: false })),
    messages: doc.messages.filter(m => m.stageId === id), posts,
    comments: doc.comments.filter(c => posts.some(p => p.id === c.postId)),
    likes: doc.likes.filter(c => posts.some(p => p.id === c.postId)),
    facts: doc.facts.filter(f => f.stageId === id), slots: doc.mediaSlots.filter(s => s.stageId === id) };
}
export function assertProtectedContent(previous: ContentDocument, next: ContentDocument): void {
  for (const stage of previous.stages.filter(s => s.locked)) {
    if (!same(stageContent(previous, stage.id), stageContent(next, stage.id))) {
      conflict('stage_locked', `阶段「${stage.title}」已锁定，请先保存解锁再编辑。`);
    }
  }
  for (const record of previous.editingPolicy?.lockedRecords || []) {
    const rows = record.kind === 'message' ? previous.messages : previous.posts;
    const newRows = record.kind === 'message' ? next.messages : next.posts;
    if (!same(rows.find(r => r.id === record.id), newRows.find(r => r.id === record.id))) {
      conflict('record_locked', '记录已锁定，请先保存解锁再编辑。');
    }
    if (record.kind === 'post' && (!same(previous.comments.filter(c => c.postId === record.id), next.comments.filter(c => c.postId === record.id))
      || !same(previous.likes.filter(c => c.postId === record.id), next.likes.filter(c => c.postId === record.id)))) {
      conflict('record_locked', '已锁定动态的评论和点赞不能自动替换。');
    }
  }
  for (const id of previous.editingPolicy?.lockedMediaSlotIds || []) {
    if (!next.mediaSlots.some(s => s.id === id)) conflict('media_slot_locked', '已锁定的媒体槽位不能删除。');
  }
  for (const record of next.editingPolicy?.lockedRecords || []) {
    const rows = record.kind === 'message' ? next.messages : next.posts;
    if (!rows.some(r => r.id === record.id)) conflict('invalid_lock', '锁定记录不存在。');
  }
  if (next.editingPolicy?.lockedMediaSlotIds.some(id => !next.mediaSlots.some(s => s.id === id))) conflict('invalid_lock', '锁定槽位不存在。');
}
export function assertGenerationUnlocked(doc: ContentDocument, mode: string, scope: Record<string, unknown>) {
  if (['stage','invite','wish','moment','shot','continue-chat'].includes(mode)) {
    const stage = doc.stages.find(s => s.id === String(scope.stageId || doc.stages[0]?.id));
    if (stage?.locked) conflict('stage_locked', '阶段已锁定，请先解锁。');
    if (mode === 'stage' && stage && (doc.editingPolicy?.lockedRecords || []).some(r =>
      [...doc.messages, ...doc.posts].some(row => row.id === r.id && row.stageId === stage.id))) {
      conflict('record_locked', '该阶段含锁定记录，请选择局部改写或先解锁。');
    }
  }
  if (mode === 'rewrite-records') {
    const ids = Array.isArray(scope.recordIds) ? scope.recordIds : [];
    const rows = [...doc.messages, ...doc.posts].filter(r => ids.includes(r.id));
    if (rows.length !== new Set(ids).size) conflict('record_missing', '选中的记录不存在。');
    if (rows.some(r => doc.stages.find(s => s.id === r.stageId)?.locked || doc.editingPolicy?.lockedRecords.some(l => l.id === r.id))) {
      conflict('record_locked', '选中的记录或所属阶段已锁定。');
    }
  }
}
export function candidateInputFingerprint(doc: ContentDocument, scope: Record<string, unknown>): string {
  const stageId = String(scope.stageId || '');
  const ids = Array.isArray(scope.recordIds) ? scope.recordIds : [];
  const context = scope.mode === 'rewrite-records'
    ? [...doc.messages, ...doc.posts].filter(r => ids.includes(r.id))
    : stageId ? stageContent(doc, stageId) : doc.stages.map(s => ({ ...s, locked: false }));
  return createHash('sha256').update(JSON.stringify({ context, actors: doc.actors, relationships: doc.relationships,
    location: doc.activity.location, rules: doc.activity.rules, theme: doc.activity.theme })).digest('hex');
}
export function assertCandidateCurrent(doc: ContentDocument, candidate: ActivityCandidate) {
  const fingerprint = candidate.scope.inputFingerprint;
  if (typeof fingerprint === 'string' && fingerprint !== candidateInputFingerprint(doc, candidate.scope)) {
    conflict('candidate_stale', '生成依据已修改，请重新生成候选后采用。');
  }
  assertGenerationUnlocked(doc, String(candidate.scope.mode || ''), candidate.scope);
}
