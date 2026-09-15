'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeCreationProfile } from '@sthstart/contracts';
import type { CreationProfileValues } from '@sthstart/contracts';
import { getJson, postJson } from '@/app/lib/api-client';
import { useActivityPresets, useImageConfigDraft } from '../queries';
import { useCreateActivityPreset, useUpdateActivityPreset } from '../mutations';
import { Button } from '@/app/components/ui/button';
const base = normalizeCreationProfile({});
export function CreationProfilePicker({ value, onChange, allowDefault = true }: {
    value?: Record<string, unknown>;
    onChange: (value: Record<string, unknown>) => void;
    allowDefault?: boolean;
}) {
    const { data } = useActivityPresets('creation_profile');
    const { data: defaults } = useQuery({ queryKey: ['creation-profile-default'], queryFn: () => getJson<{
            id: string | null;
        }>('/api/admin/activity-creation-profile/default') });
    const initialized = useRef(false);
    useEffect(() => { if (!data || !defaults || initialized.current)
        return; initialized.current = true; if (value || !allowDefault)
        return; const preset = data.items.find(p => p.id === defaults.id); if (preset)
        onChange({ presetId: preset.id, name: preset.name, version: preset.version, values: normalizeCreationProfile(preset.payload) }); }, [data, defaults, value, allowDefault, onChange]);
    const values = normalizeCreationProfile((value?.values || {}) as Record<string, unknown>);
    return <div className="space-y-2 rounded-lg border border-border-default p-3"><label className="text-sm font-semibold">创作配置</label>
    <select aria-label="创作配置" className="w-full rounded border border-border-default bg-surface p-2 text-sm" value={String(value?.presetId || '')} onChange={e => { const p = data?.items.find(p => p.id === e.target.value); onChange(p ? { presetId: p.id, name: p.name, version: p.version, values: normalizeCreationProfile(p.payload) } : {}); }}><option value="">使用普通设置</option>{data?.items.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}</select>
    {value?.presetId ? <p className="text-xs text-muted">已冻结「{String(value.name)}」v{String(value.version)}：每镜头 {values.candidateCount} 张候选，{values.expandMedia ? '展开' : '不展开'}媒体。修改预设不会改变本场活动；可重新选择套用新版。</p> : <p className="text-xs text-muted">可在活动的模板与预设管理中保存常用文字、生图、回放和导出偏好。</p>}
  </div>;
}
export function CreationProfileEditor({ initial }: {
    initial?: Record<string, unknown>;
}) {
    const [name, setName] = useState('我的创作配置');
    const [values, setValues] = useState<CreationProfileValues>(() => normalizeCreationProfile((initial?.values || base) as Record<string, unknown>));
    const [selected, setSelected] = useState('');
    const [notice, setNotice] = useState('');
    const { data } = useActivityPresets('creation_profile');
    const create = useCreateActivityPreset();
    const update = useUpdateActivityPreset();
    const qc = useQueryClient();
    const save = async (asDefault: boolean) => { try {
        if (!name.trim())
            throw new Error('请输入配置名称');
        const p = selected ? await update.mutateAsync({ id: selected, input: { name, payload: { ...values } } }) : await create.mutateAsync({ kind: 'creation_profile', name, payload: { ...values } });
        if (asDefault) {
            await postJson('/api/admin/activity-creation-profile/default', { id: p.id });
            await qc.invalidateQueries({ queryKey: ['creation-profile-default'] });
        }
        setNotice('已保存。活动中已冻结的配置保持原版本。');
    }
    catch (e) {
        setNotice((e as Error).message);
    } };
    const textField = (key: 'instruction' | 'globalStylePrompt' | 'globalNegativePrompt', label: string) => <label className="block text-sm">{label}<textarea className="mt-1 w-full rounded border border-border-default bg-surface p-2" value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })}/></label>;
    return <section className="space-y-3 border-t border-border-default pt-4"><h3 className="font-semibold">创作配置</h3>
    <select aria-label="编辑创作配置" className="w-full bg-surface p-2" value={selected} onChange={e => { setSelected(e.target.value); const p = data?.items.find(p => p.id === e.target.value); setName(p?.name || '我的创作配置'); setValues(normalizeCreationProfile(p?.payload || {})); }}><option value="">新建配置</option>{data?.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <input aria-label="配置名称" className="w-full rounded border border-border-default bg-surface p-2" value={name} onChange={e => setName(e.target.value)}/>
    <label className="block text-sm">默认文字范围 <select value={values.textMode} onChange={e => setValues({ ...values, textMode: e.target.value as CreationProfileValues['textMode'] })}><option value="plan">阶段规划</option><option value="stage">当前阶段</option><option value="whole-text">整场活动</option></select></label>
    {textField('instruction', '默认文字补充要求')}{textField('globalStylePrompt', '默认图像风格')}{textField('globalNegativePrompt', '默认负面提示词')}
    <label className="block text-sm">每镜头候选数量 <select value={values.candidateCount} onChange={e => setValues({ ...values, candidateCount: Number(e.target.value) as 1 | 2 | 3 })}>{[1, 2, 3].map(n => <option key={n}>{n}</option>)}</select></label>
    <label className="block text-sm">回放方式 <select value={values.playbackMode} onChange={e => setValues({ ...values, playbackMode: e.target.value as CreationProfileValues['playbackMode'] })}><option value="by_stage">按阶段</option><option value="story_order">故事顺序</option><option value="chat_only">仅聊天</option><option value="moments_only">仅朋友圈</option></select></label>
    <label className="block text-sm"><input type="checkbox" checked={values.expandMedia} onChange={e => setValues({ ...values, expandMedia: e.target.checked })}/> 回放展开媒体</label>
    <label className="block text-sm">默认导出 <select value={values.exportFormat} onChange={e => setValues({ ...values, exportFormat: e.target.value as CreationProfileValues['exportFormat'] })}><option value="hyperframes-project">完整包（包含渲染工程）</option><option value="project">项目包</option><option value="reader">离线阅读器</option></select></label>
    <div className="flex flex-wrap gap-2"><Button disabled={create.isPending || update.isPending} onClick={() => void save(false)}>保存配置</Button><Button variant="outline" disabled={create.isPending || update.isPending} onClick={() => void save(true)}>保存并设为默认</Button><Button variant="ghost" onClick={async () => { try {
        await postJson('/api/admin/activity-creation-profile/default', { id: null });
        await qc.invalidateQueries({ queryKey: ['creation-profile-default'] });
        setNotice('已取消默认配置');
    }
    catch (e) {
        setNotice((e as Error).message);
    } }}>取消默认</Button></div>{notice && <p className="text-sm">{notice}</p>}
  </section>;
}
export function ActivityCreationProfile({ activityId, headVersion, value, disabled, onApplied }: {
    activityId: string;
    headVersion: number;
    value?: Record<string, unknown>;
    disabled?: boolean;
    onApplied: () => void;
}) {
    const [pending, setPending] = useState<Record<string, unknown> | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const qc = useQueryClient();
    const { data: config } = useImageConfigDraft(activityId);
    const frozen = normalizeCreationProfile((value?.values || {}) as Record<string, unknown>);
    const current = { ...frozen, ...(config ? { globalStylePrompt: config.document.globalStylePrompt, globalNegativePrompt: config.document.globalNegativePrompt } : {}) };
    const next = normalizeCreationProfile((pending?.values || {}) as Record<string, unknown>);
    const rows: Array<[
        keyof CreationProfileValues,
        string
    ]> = [['textMode', '文字范围'], ['instruction', '补充要求'], ['candidateCount', '每镜头候选数'], ['globalStylePrompt', '画风'], ['globalNegativePrompt', '负面提示词'], ['playbackMode', '回放方式'], ['expandMedia', '展开媒体'], ['exportFormat', '导出类型']];
    const display = (v: unknown) => typeof v === 'boolean' ? (v ? '是' : '否') : ({ plan: '阶段规划', stage: '当前阶段', 'whole-text': '整场活动', by_stage: '按阶段', story_order: '故事顺序', chat_only: '仅聊天', moments_only: '仅朋友圈', reader: '阅读包', project: '项目包', 'hyperframes-project': '完整包（含渲染工程）' } as Record<string, string>)[String(v)] || String(v || '（空）');
    const apply = async () => {
        setBusy(true);
        setError('');
        try {
            const activity = await getJson<{
                draft: {
                    draftVersion: number;
                };
            }>(`/api/admin/activities/${activityId}`);
            await postJson(`/api/admin/activities/${activityId}/creation-profile/apply`, { presetId: pending?.presetId || null, presetVersion: pending?.version || 0, expectedHeadVersion: headVersion, expectedDraftVersion: activity.draft.draftVersion });
            setPending(null);
            await qc.invalidateQueries();
            onApplied();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    return <section className="space-y-2 border-t border-border-default pt-3"><CreationProfilePicker value={value} allowDefault={false} onChange={setPending}/>
    <details><summary className="text-xs cursor-pointer">查看本场配置快照</summary><dl className="mt-2 space-y-1 text-xs text-muted">{rows.map(([key, label]) => <div key={key} className="break-words"><dt className="font-medium inline">{label}：</dt><dd className="inline">{display(frozen[key])}</dd></div>)}</dl></details>
    {pending && <div className="space-y-3 rounded-lg border border-border-default p-3"><h4 className="text-sm font-semibold">套用「{String(pending.name || '系统默认')}」的参数预览</h4><p className="text-xs text-muted">文字、图片和回放偏好用于后续操作。现有画风与负面提示词将更新；已有图像保留，并进入影响复核。请先保存活动新版本。</p><div className="max-h-64 overflow-auto text-xs">{rows.map(([key, label]) => <p key={key} className="mb-2 break-words"><strong>{label}</strong>：{display(next[key])}{JSON.stringify(current[key]) !== JSON.stringify(next[key]) ? '（将更新）' : ''}</p>)}</div>{error && <p className="text-sm text-red-600">{error}</p>}<div className="flex gap-2"><Button size="sm" disabled={busy || disabled} onClick={() => void apply()}>确认套用</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setPending(null)}>取消</Button></div></div>}
  </section>;
}
