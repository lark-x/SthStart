'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CandidateComparison } from '@sthstart/contracts';
import { getJson, postJson } from '@/app/lib/api-client';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
export function CandidateReviewPanel({ activityId, candidateId, onApplied }: {
    activityId: string;
    candidateId: string;
    onApplied: () => void;
}) {
    const client = useQueryClient();
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [onlyChanges, setOnlyChanges] = useState(true);
    const { data, isLoading, error: queryError } = useQuery({ queryKey: ['candidate-comparison', activityId, candidateId], queryFn: () => getJson<CandidateComparison>(`/api/admin/activities/${activityId}/candidates/${candidateId}/comparison`) });
    const apply = async () => {
        setBusy(true);
        setError('');
        try {
            const current = await getJson<{
                activity: {
                    headVersion: number;
                };
                draft: {
                    draftVersion: number;
                };
            }>(`/api/admin/activities/${activityId}`);
            await postJson(`/api/admin/activities/${activityId}/candidates/${candidateId}/apply-selection`, { unitIds: selected, expectedHeadVersion: current.activity.headVersion, expectedDraftVersion: current.draft.draftVersion, idempotencyKey: crypto.randomUUID() });
            setSelected([]);
            await client.invalidateQueries();
            onApplied();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    if (isLoading)
        return <p className="text-sm">正在比较当前版本与候选…</p>;
    return <div className="space-y-3 rounded-lg border border-border-default p-3">
    <div className="flex flex-wrap justify-between gap-2"><strong>对比并采用所选内容</strong><label className="text-xs"><input type="checkbox" checked={onlyChanges} onChange={e => setOnlyChanges(e.target.checked)}/> 仅看变化</label></div>
    {data?.legacy && <Alert variant="warning">旧候选缺少逐条快照，仅支持原范围采用。</Alert>}
    {(error || queryError) && <Alert variant="danger">{error || String(queryError)}</Alert>}
    <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setSelected(data?.units.filter(u => !u.applied && !u.conflict).map(u => u.id) || [])}>选择所有可采用项</Button><Button size="sm" variant="outline" onClick={() => setSelected([])}>清空</Button></div>
    <div className="space-y-3 max-h-[50vh] overflow-auto">{data?.units.filter(u => !onlyChanges || u.before !== u.after || u.applied).map(unit => <article key={unit.id} className="border border-border-default rounded p-3 space-y-2">
      <label className="flex gap-2 text-sm font-medium"><input type="checkbox" disabled={unit.applied || !!unit.conflict} checked={selected.includes(unit.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, unit.id] : ids.filter(id => id !== unit.id))}/>{unit.title} {unit.applied ? '（已采用）' : ''}</label>
      {unit.kind === 'replace_stage' && <p className="text-xs text-muted">整阶段替换：原阶段记录将被候选替换，相关媒体和事实会重新检查。若只改几句，请使用局部重写。</p>}
      <div className="grid md:grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted mb-1">当前版本</p><div className="rounded-xl bg-surface-raised p-3 whitespace-pre-wrap break-words">{unit.before || '（新增）'}</div></div><div><p className="text-xs text-muted mb-1">候选内容</p><div className="rounded-xl bg-accent/10 p-3 whitespace-pre-wrap break-words">{unit.after}</div></div></div>
      {unit.conflict && <p className="text-xs text-amber-700">{unit.conflict}，请核对后重新生成。</p>}
    </article>)}</div>
    <div className="flex gap-2 flex-wrap"><Button size="sm" disabled={busy || !selected.length} onClick={apply}>采用所选 {selected.length} 项</Button><Button size="sm" variant="outline" onClick={async () => { try {
        await postJson(`/api/admin/activities/${activityId}/candidates/${candidateId}/dismiss`, { dismissed: !data?.dismissed });
        await client.invalidateQueries();
    }
    catch (e) {
        setError((e as Error).message);
    } }}>{data?.dismissed ? '重新显示候选' : '收起备用候选'}</Button></div>
  </div>;
}
