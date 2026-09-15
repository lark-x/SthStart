import type { CandidateComparison, CandidateReviewUnit, ContentDocument } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { ActivityStore } from './store.js';
import { valueHash, isReviewLocked, resolveTextReview } from './change-impact.js';
import { assertCandidateCurrent } from './editing-policy.js';
import { adoptCandidate } from './text-jobs.js';
interface Baseline {
    version: 1;
    records: Record<string, unknown>;
    actors: string[];
    contextHash: string;
}
function contextHash(doc: ContentDocument, actorIds: string[]) {
    const { title, type, theme, location, rules, overview, scheduledDate, birthdayActorIds } = doc.activity;
    return valueHash({ activity: { title, type, theme, location, rules, overview, scheduledDate, birthdayActorIds }, actors: doc.actors.filter(a => actorIds.includes(a.id)) });
}
export function rewriteBaseline(doc: ContentDocument, scope: Record<string, unknown>): Baseline {
    const ids = Array.isArray(scope.recordIds) ? scope.recordIds : [];
    const messages = doc.messages.filter(m => ids.includes(m.id));
    const posts = doc.posts.filter(p => ids.includes(p.id));
    const actors = [...new Set([...messages.map(m => m.speakerActorId), ...posts.map(p => p.authorActorId)].filter((id): id is string => Boolean(id)))];
    return { version: 1, records: Object.fromEntries([...messages, ...posts].map(r => [r.id, r])), actors, contextHash: contextHash(doc, actors) };
}
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code, statusCode: 409 }); }
export function compareCandidate(database: ServiceDatabase, store: ActivityStore, activityId: string, candidateId: string): CandidateComparison {
    const candidate = store.getCandidate(activityId, candidateId);
    const draft = store.getDraft(activityId);
    if (!candidate || !draft)
        fail('not_found', '候选不存在');
    if (candidate.scope.importedReadOnly)
        return { candidateId, legacy: true, dismissed: true, units: [{ id: 'whole', kind: 'append_candidate', targetId: '', title: '导入的历史候选', before: '', after: '请在新活动中重新生成，旧候选保留作参考。', applied: candidate.adopted, conflict: '此历史候选未包含可验证的依赖快照' }] };
    const baseline = candidate.scope.reviewBaseline as Baseline | undefined;
    const applied = new Set((database.connection.prepare('SELECT unit_id FROM activity_candidate_applications WHERE activity_id=? AND candidate_id=?').all(activityId, candidateId) as {
        unit_id: string;
    }[]).map(r => r.unit_id));
    const units: CandidateReviewUnit[] = [];
    if (candidate.scope.mode === 'rewrite-records' && baseline?.version === 1) {
        for (const [field, kind] of [['rewrittenMessages', 'rewrite_message'], ['rewrittenPosts', 'rewrite_post']] as const) {
            const rows = candidate.payload[field];
            if (!Array.isArray(rows))
                continue;
            for (const row of rows as Array<{
                id: string;
                text: string;
            }>) {
                const before = baseline.records[row.id] as {
                    text: string;
                } | undefined;
                const current = (kind === 'rewrite_message' ? draft.document.messages : draft.document.posts).find(r => r.id === row.id);
                const id = `${kind}:${row.id}`;
                let conflict: string | undefined;
                if (!before || typeof row.text !== 'string')
                    conflict = '候选包含原范围外的记录';
                else if (!current)
                    conflict = '该记录已删除';
                else if (isReviewLocked(draft.document, { targetKind: kind === 'rewrite_message' ? 'message' : 'post', targetId: row.id }))
                    conflict = '记录或所属阶段已锁定';
                else if (valueHash(current) !== valueHash(before))
                    conflict = '该记录在生成后已修改';
                else if (contextHash(draft.document, baseline.actors) !== baseline.contextHash)
                    conflict = '本次使用的角色或活动设定已修改';
                const done = applied.has(id) || candidate.adopted;
                units.push({ id, kind, targetId: row.id, title: current?.text.slice(0, 48) || row.id, before: current?.text || before?.text || '', after: row.text, applied: done, conflict: done ? undefined : conflict });
            }
        }
    }
    else {
        const stage = draft.document.stages.find(s => s.id === candidate.scope.stageId);
        let conflict: string | undefined;
        try {
            if (!candidate.adopted) {
                assertCandidateDependencies(database, store, activityId, candidateId);
                assertCandidateCurrent(draft.document, candidate);
            }
        }
        catch (error) {
            conflict = (error as Error).message;
        }
        const currentRows = [...draft.document.messages, ...draft.document.posts].filter(r => !stage || r.stageId === stage.id);
        const nextRows = [...(Array.isArray(candidate.payload.messages) ? candidate.payload.messages : []), ...(Array.isArray(candidate.payload.posts) ? candidate.payload.posts : [])] as {
            text?: string;
        }[];
        units.push({ id: 'whole', kind: candidate.scope.mode === 'stage' ? 'replace_stage' : 'append_candidate', targetId: stage?.id || '', title: stage?.title || '完整候选', before: currentRows.map(r => r.text).join('\n'), after: nextRows.map(r => r.text || '').join('\n') || (Array.isArray(candidate.payload.stages) ? candidate.payload.stages.map((s: Record<string, unknown>) => `${s.title || '阶段'}：${s.description || s.instruction || ''}`).join('\n') : String(candidate.payload.overview || candidate.payload.summary || '查看下方候选详情')), applied: candidate.adopted, conflict });
    }
    return { candidateId, units, legacy: candidate.scope.mode === 'rewrite-records' && !baseline, dismissed: candidate.scope.dismissed === true };
}
export function applyCandidateSelection(database: ServiceDatabase, store: ActivityStore, activityId: string, candidateId: string, input: {
    unitIds: string[];
    expectedHeadVersion: number;
    expectedDraftVersion: number;
    idempotencyKey: string;
}) {
    const comparison = compareCandidate(database, store, activityId, candidateId);
    if (!input.idempotencyKey || !Array.isArray(input.unitIds) || !input.unitIds.length || new Set(input.unitIds).size !== input.unitIds.length)
        fail('invalid_selection', '请选择不重复的候选内容');
    const receipts = database.connection.prepare('SELECT data_json FROM activity_candidate_applications WHERE activity_id=? AND candidate_id=? AND request_key=?').all(activityId, candidateId, input.idempotencyKey) as Array<{
        data_json: string;
    }>;
    if (receipts.length && receipts.some(r => valueHash(JSON.parse(r.data_json).requestUnitIds) !== valueHash([...input.unitIds].sort())))
        fail('idempotency_conflict', '相同请求标识不能用于不同选择');
    if (new Set(comparison.units.map(u => u.id)).size !== comparison.units.length)
        fail('invalid_candidate', '候选包含重复记录，请重新生成');
    const chosen = input.unitIds.map(id => comparison.units.find(u => u.id === id) || fail('invalid_selection', '采用内容不属于该候选'));
    const pending = chosen.filter(u => !u.applied);
    if (!pending.length)
        return { activity: store.getActivity(activityId), comparison };
    const draft = store.getDraft(activityId)!;
    const activity = store.getActivity(activityId)!;
    if (draft.draftVersion !== input.expectedDraftVersion || activity.headVersion !== input.expectedHeadVersion)
        fail('revision_conflict', '活动版本已变化，请刷新对比后再采用');
    if (pending.some(u => u.conflict))
        fail('candidate_conflict', pending.find(u => u.conflict)!.conflict!);
    if (pending[0].id === 'whole')
        return adoptCandidate(database, store, activityId, candidateId, input.expectedHeadVersion);
    const next = structuredClone(draft.document);
    for (const unit of pending) {
        const rows = unit.kind === 'rewrite_message' ? next.messages : next.posts;
        rows.find(r => r.id === unit.targetId)!.text = unit.after;
    }
    return database.transaction(() => {
        const updated = store.updateDraft(activityId, draft.draftVersion, next);
        const committed = store.commitDraft(activityId, activity.headVersion, updated.draftVersion, { skipTransaction: true });
        for (const unit of pending)
            database.connection.prepare('INSERT INTO activity_candidate_applications(activity_id,candidate_id,unit_id,request_key,content_revision_id,data_json,created_at) VALUES (?,?,?,?,?,?,?)')
                .run(activityId, candidateId, unit.id, input.idempotencyKey, committed.contentRevisionId, JSON.stringify({ targetId: unit.targetId, text: unit.after, requestUnitIds: [...input.unitIds].sort() }), new Date().toISOString());
        resolveTextReview(database.connection, activityId, next, candidateId, pending.map(u => u.targetId));
        const complete = comparison.units.every(unit => unit.applied || input.unitIds.includes(unit.id));
        if (complete)
            database.connection.prepare('UPDATE activity_candidates SET adopted=1 WHERE activity_id=? AND id=?').run(activityId, candidateId);
        return { activity: committed.activity, comparison: compareCandidate(database, store, activityId, candidateId) };
    });
}
export function assertCandidateDependencies(database: ServiceDatabase, store: ActivityStore, activityId: string, candidateId: string, selectedIds: string[] = []): void {
    const candidate = store.getCandidate(activityId, candidateId)!;
    const facts = candidate.scope.factContext as {
        stageIds: string[];
        hash: string;
    } | undefined;
    if (facts && valueHash(store.getDraft(activityId)!.document.facts.filter(f => facts.stageIds.includes(f.stageId))) !== facts.hash)
        fail('candidate_dependency', '作为生成依据的前序事实已改变，请重新生成');
    const predecessors = candidate.scope.precedingCandidateIds as string[] | undefined;
    for (const id of predecessors || []) {
        if (selectedIds.includes(id))
            continue;
        const previous = store.getCandidate(activityId, id);
        if (!previous?.adopted)
            fail('candidate_dependency', '本候选引用了前序候选，请先采用前序内容，或把它们一同选中');
        const receipt = database.connection.prepare("SELECT data_json FROM activity_candidate_applications WHERE activity_id=? AND candidate_id=? AND unit_id='whole'").get(activityId, id) as {
            data_json: string;
        } | undefined;
        const expected = receipt ? JSON.parse(receipt.data_json).stageHash : undefined;
        if (!expected || expected !== adoptedStageHash(store.getDraft(activityId)!.document, String(previous.scope.stageId)))
            fail('candidate_dependency', '已采用的前序阶段又发生了变化，请重新生成后续候选');
    }
}
function adoptedStageHash(doc: ContentDocument, stageId: string): string {
    const posts = doc.posts.filter(p => p.stageId === stageId);
    return valueHash({ stage: doc.stages.find(s => s.id === stageId), messages: doc.messages.filter(m => m.stageId === stageId), posts, comments: doc.comments.filter(c => posts.some(p => p.id === c.postId)), facts: doc.facts.filter(f => f.stageId === stageId), slots: doc.mediaSlots.filter(s => s.stageId === stageId) });
}
export function recordWholeApplication(database: ServiceDatabase, activityId: string, candidateId: string, doc: ContentDocument, stageId: string, revisionId: string): void {
    database.connection.prepare("INSERT OR IGNORE INTO activity_candidate_applications(activity_id,candidate_id,unit_id,request_key,content_revision_id,data_json,created_at) VALUES(?,?,'whole',?,?,?,?)")
        .run(activityId, candidateId, `whole_${candidateId}`, revisionId, JSON.stringify({ stageHash: adoptedStageHash(doc, stageId) }), new Date().toISOString());
}
export function candidateFactContext(doc: ContentDocument, stageId: string, excludeStageIds: string[] = []) {
    const order = doc.stages.find(s => s.id === stageId)?.order || 0;
    const stageIds = doc.stages.filter(s => s.order < order && !excludeStageIds.includes(s.id)).map(s => s.id);
    return { stageIds, hash: valueHash(doc.facts.filter(f => stageIds.includes(f.stageId))) };
}
