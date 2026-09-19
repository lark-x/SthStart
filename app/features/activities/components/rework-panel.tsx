'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityReviewItem, ContentDocument } from '@sthstart/contracts';
import { getJson, postJson } from '@/app/lib/api-client';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
const labels = { invalid_reference: '引用已失效', source_changed: '生成依据已变更', possible: '可能受影响', playback_outdated: '回放需更新' };
const decisions = { pending: '待复核', keep: '已确认保留', rework: '待处理', resolved: '已完成', superseded: '历史变化' };
export function reviewTargetUrl(activityId: string, item: Pick<ActivityReviewItem, 'targetKind' | 'targetId'>) {
    const tab = item.targetKind === 'image' ? 'media' : item.targetKind === 'playback' ? 'playback' : 'records';
    return `/apps/activities/${activityId}?tab=${tab}&${item.targetKind === 'image' ? 'slotId' : item.targetKind === 'stage' ? 'stageId' : 'recordId'}=${encodeURIComponent(item.targetId)}`;
}
function reviewSourceUrl(activityId: string, ref: ActivityReviewItem['sourceRefs'][number]) {
    const image = ref.kind === 'image' || ref.kind === 'image_config';
    const tab = image ? 'media' : ref.kind === 'actor' || ref.kind === 'stage' ? 'settings' : 'records';
    const key = image ? 'slotId' : ref.kind === 'actor' ? 'actorId' : ref.kind === 'fact' ? 'factId' : 'stageId';
    return `/apps/activities/${activityId}?tab=${tab}&${key}=${encodeURIComponent(ref.id)}`;
}
export function ReworkPanel({ activityId, headVersion, document, onSaved, open, onOpenChange }: {
    activityId: string;
    headVersion: number;
    document: ContentDocument;
    onSaved?: () => void;
    open: boolean;
    onOpenChange: (open:boolean)=>void;
}) {
    const client = useQueryClient();
    const setOpen = onOpenChange;
    const [category, setCategory] = useState('all');
    const [history, setHistory] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const query = useQuery({ queryKey: ['activity-review', activityId, headVersion], queryFn: () => getJson<{
            items: ActivityReviewItem[];
        }>(`/api/admin/activities/${activityId}/review-items`), refetchInterval: open ? 5000 : false });
    const preview = useQuery({ queryKey: ['activity-impact-preview', activityId, document], queryFn: () => postJson<{
            items: ActivityReviewItem[];
        }>(`/api/admin/activities/${activityId}/change-impact/preview`, { document }), enabled: open, staleTime: 1000 });
    const items = query.data?.items || [];
    const pending = items.filter(i => i.decision === 'pending' || i.decision === 'rework');
    const visible = (history ? items : pending).filter(item => category === 'all' || category === 'text' && ['message', 'post', 'stage'].includes(item.targetKind) || category === item.targetKind);
    const act = async (decision: ActivityReviewItem['decision']) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await postJson(`/api/admin/activities/${activityId}/review-items/decide`, { items: items.filter(i => selected.includes(i.id)).map(i => ({ id: i.id, changeKey: i.changeKey })), decision, expectedHeadVersion: headVersion });
            setSelected([]);
            await client.invalidateQueries({ queryKey: ['activity-review', activityId] });
            onSaved?.();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    const start = async () => { setBusy(true); setError(''); try {
        const result = await postJson<{
            results: Array<{
                message?: string;
                jobId?: string;
            }>;
        }>(`/api/admin/activities/${activityId}/review-items/start`, { ids: selected });
        setNotice(result.results.map(r => r.message || '文本任务已开始，可在全局任务中心查看').join('；'));
        await query.refetch();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    return <>
    <Dialog open={open} onOpenChange={setOpen} title="本场活动的修改影响与待处理项" size="lg">
      <div className="space-y-4 py-3">
        <p className="text-sm text-muted">保存新版本后产生复核项。生成、采用与确认保留分别进行；锁定内容不会自动替换。</p>
        {!!preview.data?.items.length && <Alert variant="warning" title="尚未采用的草稿变化">预计影响 {preview.data.items.length} 项。请先保存新版本，再处理这些变化。</Alert>}
        {(error || query.error || preview.error) && <Alert variant="danger">{error || String(query.error || preview.error)}</Alert>}
        {notice && <Alert variant="info">{notice}</Alert>}
        <div className="flex flex-wrap gap-3 items-center"><label className="text-sm"><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)}/> 显示已处理和历史变化</label><select aria-label="待处理内容类型" className="bg-surface text-sm" value={category} onChange={e => { setCategory(e.target.value); setSelected([]); }}><option value="all">全部内容</option><option value="text">文字与阶段</option><option value="image">图片</option><option value="playback">回放</option></select><Button size="sm" variant="outline" onClick={() => setSelected(visible.filter(i => !i.locked && i.severity !== 'invalid_reference').map(i => i.id))}>选择可处理项</Button><Button size="sm" variant="outline" onClick={() => setSelected([])}>清空</Button></div>
        <div className="max-h-[55vh] overflow-auto space-y-3">{!visible.length && <p className="text-sm text-muted">没有待复核内容，可以继续创作。</p>}{visible.map(item => <article key={item.id} className="border border-border-default rounded-lg p-3 space-y-2">
          <label className="flex gap-2 items-start"><input type="checkbox" checked={selected.includes(item.id)} disabled={item.decision === 'superseded'} onChange={e => setSelected(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))}/><span className="font-medium text-ink">{item.title}</span></label>
          <p className="text-xs text-muted">{labels[item.severity]} · {decisions[item.decision]}{item.locked ? ' · 已锁定' : ''}{item.execution ? ` · ${item.execution.kind === 'image' ? '图片批次' : '文本任务'}：${item.execution.status === 'succeeded' ? '候选待采用' : item.execution.status === 'failed' ? '失败，可重试' : '处理中'}` : ''}</p>
          <ul className="text-sm text-muted list-disc pl-5">{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
          {item.targetKind === 'image' && item.decision === 'rework' && !item.execution && <p className="text-xs text-muted">图片待处理，尚未生成；请在媒体页手动开始对应镜头批次。</p>}
          <div className="flex gap-3 text-sm text-accent"><a href={reviewTargetUrl(activityId, item)}>查看目标</a>{item.targetKind === 'image' && item.decision === 'rework' && <a href={`/apps/activities/${activityId}?tab=media&reworkSlots=${encodeURIComponent(item.targetId)}`}>为此镜头准备批次</a>}{item.sourceRefs.filter(ref => ref.kind === 'actor' || ref.kind === 'stage' || ref.kind === 'image' || ref.kind === 'image_config' || ref.kind === 'fact').map(ref => <a key={`${ref.kind}:${ref.id}:${ref.field}`} href={reviewSourceUrl(activityId, ref)}>修改本场源头</a>)}{item.execution && <a href={`/apps/activities/${activityId}?tab=${item.execution.kind === 'image' ? 'media' : 'records'}&${item.execution.kind === 'image' ? 'batchId' : 'jobId'}=${item.execution.id}`}>查看候选 / 继续任务</a>}</div>
        </article>)}</div>
        {selected.some(id => items.some(i => i.id === id && i.targetKind === 'image' && i.decision === 'rework')) && <a className="block text-sm text-accent" href={`/apps/activities/${activityId}?tab=media&reworkSlots=${encodeURIComponent(items.filter(i => selected.includes(i.id) && i.targetKind === 'image' && i.decision === 'rework' && !i.locked).map(i => i.targetId).join(','))}`}>将所选图片带到批次页（手动开始）</a>}
        <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !selected.length} onClick={() => act('keep')}>确认保留</Button><Button size="sm" variant="outline" disabled={busy || !selected.length} onClick={() => act('pending')}>稍后处理</Button><Button size="sm" variant="outline" disabled={busy || !selected.length} onClick={() => act('rework')}>加入返工</Button><Button size="sm" disabled={busy || !selected.length} onClick={start}>开始所选文本返工</Button></div>
      </div>
    </Dialog></>;
}
