import type { ActivityReviewItem } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { ActivityStore } from './store.js';
import type { SecretStore } from '../security.js';
import { isReviewLocked, reviewTarget, currentReviewValues, valueHash } from './change-impact.js';
import { runTextGenerationJob } from './text-jobs.js';
export function listReviewItems(database: ServiceDatabase, store: ActivityStore, activityId: string): ActivityReviewItem[] {
    const doc = store.getDraft(activityId)?.document;
    if (!doc)
        return [];
    return (database.connection.prepare('SELECT * FROM activity_review_items WHERE activity_id=? ORDER BY created_at DESC').all(activityId) as Array<Record<string, unknown>>).map(row => {
        const item = JSON.parse(String(row.data_json)) as ActivityReviewItem;
        const execution = row.execution_json ? JSON.parse(String(row.execution_json)) : undefined;
        if (execution?.kind === 'text')
            execution.status = (database.connection.prepare('SELECT status FROM activity_jobs WHERE id=? AND activity_id=?').get(execution.id, activityId) as {
                status: string;
            } | undefined)?.status || 'missing';
        if (execution?.kind === 'image') {
            const rows = database.connection.prepare('SELECT state FROM activity_media_batch_items WHERE batch_id=?').all(execution.id) as {
                state: string;
            }[];
            execution.status = rows.some(r => r.state === 'failed') ? 'failed' : rows.length && rows.every(r => ['succeeded', 'skipped', 'cancelled'].includes(r.state)) ? 'succeeded' : 'running';
        }
        return { ...item, id: String(row.id), decision: row.decision as ActivityReviewItem['decision'], createdAt: String(row.created_at), locked: isReviewLocked(doc, item), execution };
    });
}
const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 409, code: 'review_conflict' }); };
export function decideReviewItems(database: ServiceDatabase, store: ActivityStore, activityId: string, input: {
    items: Array<{
        id: string;
        changeKey: string;
    }>;
    decision: ActivityReviewItem['decision'];
    expectedHeadVersion: number;
}) {
    if (!['pending', 'keep', 'rework'].includes(input.decision) || !input.items?.length)
        fail('请选择处理方式和项目');
    if (store.getActivity(activityId)?.headVersion !== input.expectedHeadVersion)
        fail('活动版本已变化，请刷新待处理列表');
    const all = listReviewItems(database, store, activityId);
    const doc = store.getDraft(activityId)!.document;
    const items = input.items.map(ref => all.find(item => item.id === ref.id && item.changeKey === ref.changeKey) || fail('变化已更新，请重新查看'));
    for (const item of items) {
        if (item.decision === 'superseded')
            fail('这项变化已被新的变化取代');
        if (input.decision === 'keep' && item.severity === 'invalid_reference')
            fail('引用已失效，请先修复关联，不能直接确认保留');
        if (item.targetKind !== 'playback' && valueHash(reviewTarget(doc, item.targetKind, item.targetId)) !== item.targetHash)
            fail('目标在草稿中已修改，请保存新版本后再处理');
        if (item.sourceRefs.length && valueHash(currentReviewValues(database.connection, activityId, doc, item)) !== item.sourceHash)
            fail('来源已修改，请保存新版本后再处理');
        if (input.decision === 'rework' && item.locked)
            fail('目标已锁定，请先解锁再加入返工');
    }
    database.transaction(() => { for (const item of items)
        database.connection.prepare('UPDATE activity_review_items SET decision=?,updated_at=? WHERE id=? AND activity_id=?').run(input.decision, new Date().toISOString(), item.id, activityId); });
    return { items: listReviewItems(database, store, activityId) };
}
export async function startReviewItems(database: ServiceDatabase, secrets: SecretStore, store: ActivityStore, activityId: string, input: {
    ids: string[];
}, fetcher?: typeof fetch) {
    const doc = store.getDraft(activityId)!.document;
    const activity = store.getActivity(activityId)!;
    if (valueHash(doc) !== valueHash(store.getContentRevision(activityId, activity.currentContentRevisionId!)?.document))
        fail('请先保存新版本，再开始返工');
    if (!Array.isArray(input.ids) || !input.ids.length)
        fail('请选择待处理项');
    const items = listReviewItems(database, store, activityId).filter(item => input.ids.includes(item.id));
    if (items.length !== new Set(input.ids).size)
        fail('待处理项不存在，请刷新');
    const results: Array<{
        id: string;
        jobId?: string;
        message?: string;
    }> = [];
    for (const item of items) {
        if (item.decision !== 'rework') {
            results.push({ id: item.id, message: '请先加入返工' });
            continue;
        }
        if (item.locked) {
            results.push({ id: item.id, message: '已锁定' });
            continue;
        }
        if (item.targetKind === 'image') {
            results.push({ id: item.id, message: '图片已保存在待处理清单；请到媒体页选中对应镜头后手动开始批次，当前不会连接 ComfyUI' });
            continue;
        }
        if (item.targetKind === 'playback') {
            results.push({ id: item.id, message: '请到回放页确认设置并更新回放' });
            continue;
        }
        if (item.severity === 'invalid_reference') {
            results.push({ id: item.id, message: '请先修复失效引用' });
            continue;
        }
        if (valueHash(reviewTarget(doc, item.targetKind, item.targetId)) !== item.targetHash || valueHash(currentReviewValues(database.connection, activityId, doc, item)) !== item.sourceHash) {
            results.push({ id: item.id, message: '来源或目标已变化，请重新查看' });
            continue;
        }
        if (item.execution) {
            results.push({ id: item.id, jobId: item.execution.id, message: '已关联任务，请在原任务中继续或采用候选' });
            continue;
        }
        const active = database.connection.prepare("SELECT j.id FROM activity_review_items r JOIN activity_jobs j ON j.id=json_extract(r.execution_json,'$.id') WHERE r.activity_id=? AND r.target_kind=? AND r.target_id=? AND j.status IN ('queued','running') LIMIT 1").get(activityId, item.targetKind, item.targetId) as {
            id: string;
        } | undefined;
        if (active) {
            results.push({ id: item.id, jobId: active.id, message: '同一目标的前一个任务仍在运行，请等待或取消原任务后再开始' });
            continue;
        }
        try {
            const job = await runTextGenerationJob(database, secrets, store, activityId, { mode: item.targetKind === 'stage' ? 'stage' : 'rewrite-records', scope: item.targetKind === 'stage' ? { stageId: item.targetId } : { recordIds: [item.targetId] }, userInstruction: item.reasons.join('；'), idempotencyKey: `review_${item.changeKey}` }, fetcher);
            database.connection.prepare('UPDATE activity_review_items SET execution_json=?,updated_at=? WHERE id=?').run(JSON.stringify({ kind: 'text', id: job.id }), new Date().toISOString(), item.id);
            results.push({ id: item.id, jobId: job.id });
        }
        catch (error) {
            results.push({ id: item.id, message: (error as Error).message });
        }
    }
    return { results };
}
