'use client';

import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import type { ActivityLora, BeatRenderActivityLoraPolicyResponse } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { fetchActivityLoraPolicy, saveActivityLoraPolicy } from '../api';
import type { Workflow } from '../types';

export function ActivityLoraPolicyPanel({ workflows }: { workflows: Workflow[] }) {
  const versions = useMemo(() => workflows.flatMap((workflow) => workflow.versions
    .filter((version) => version.isPublished && (version.category ?? workflow.category) === 'image' && version.editorConfig?.activityLoraInjection)
    .map((version) => ({ id: workflow.id, name: workflow.name, version: version.version }))), [workflows]);
  const [selection, setSelection] = useState('');
  const [response, setResponse] = useState<BeatRenderActivityLoraPolicyResponse | null>(null);
  const [entries, setEntries] = useState<ActivityLora[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const selected = versions.find((item) => `${item.id}::${item.version}` === selection);

  useEffect(() => {
    if (!versions.length || selection) return;
    setSelection(`${versions[0].id}::${versions[0].version}`);
  }, [selection, versions]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setLoading(true); setError(''); setSaved(false);
    void fetchActivityLoraPolicy(selected.id, selected.version).then((next) => {
      if (!active) return;
      setResponse(next); setEntries(next.policy.entries);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '读取 LoRA 配置失败。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected?.id, selected?.version]);

  const save = async () => {
    if (!selected || !response || saving) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const next = await saveActivityLoraPolicy({ workflowId: selected.id, workflowVersion: selected.version,
        expectedRevision: response.policy.revision, entries });
      setResponse(next); setEntries(next.policy.entries); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存全局 LoRA 配置失败。'); }
    finally { setSaving(false); }
  };

  const update = (index: number, patch: Partial<ActivityLora>) => setEntries((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, ...patch } : entry));

  return (
    <section className="space-y-4 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 sm:p-6" aria-labelledby="activity-lora-policy-title">
      <div>
        <h2 id="activity-lora-policy-title" className="text-base font-semibold text-ink">活动全局 LoRA</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">这里配置活动统一画风。实际加载顺序为全局 → 角色 → 镜头；同名文件只加载一次，后一级覆盖强度和触发词。设置按已发布工作流版本保存。</p>
      </div>
      {!versions.length ? <Alert variant="warning" title="暂无支持 LoRA 的活动图片工作流">请先发布一个声明了动态 LoRA 插入点的图片工作流版本。</Alert> : <>
        <label className="block max-w-2xl space-y-1.5">
          <span className="text-sm font-medium text-ink">应用到工作流版本</span>
          <Select aria-label="全局 LoRA 工作流版本" value={selection} onChange={(event) => setSelection(event.target.value)}>
            {versions.map((item) => <option key={`${item.id}::${item.version}`} value={`${item.id}::${item.version}`}>{item.name} · v{item.version}</option>)}
          </Select>
        </label>
        {response?.message && <Alert variant="warning" title="LoRA 运行环境尚未就绪">{response.message}{response.models.length === 0 ? ' 当前实例的 LoRA 文件清单为空；请把兼容文件放入 models/loras 并刷新。' : ''}</Alert>}
        {error && <Alert variant="danger" title="LoRA 配置操作失败">{error}</Alert>}
        {loading || !response ? <div className="py-10 text-center text-sm text-muted" role="status">正在检查工作流节点和 LoRA 文件…</div> : <>
          <div className="space-y-3">
            {entries.map((entry, index) => <div key={`${entry.model}-${index}`} className="grid gap-3 rounded-[var(--radius-control)] border border-border-subtle bg-surface-raised p-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
              <div className="min-w-0 space-y-2">
                <Select aria-label={`全局 LoRA 文件 ${index + 1}`} value={entry.model} onChange={(event) => update(index, { model: event.target.value })}>
                  {!response.models.includes(entry.model) && <option value={entry.model}>{entry.model} · 当前实例不可用</option>}
                  {response.models.map((model) => <option key={model} value={model}>{model}</option>)}
                </Select>
                <Input aria-label={`全局 LoRA 触发词 ${index + 1}`} value={entry.triggerWord} onChange={(event) => update(index, { triggerWord: event.target.value })} placeholder="触发词（可选）" />
              </div>
              <label className="space-y-1"><span className="text-xs text-muted">模型强度</span><Input aria-label={`全局 LoRA 强度 ${index + 1}`} type="number" min={-10} max={10} step={0.05} value={entry.strength} onChange={(event) => update(index, { strength: Number(event.target.value) })} /></label>
              <div className="flex items-center justify-between gap-3 md:flex-col md:items-end">
                <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={entry.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />启用</label>
                <Button type="button" size="sm" variant="ghost" aria-label={`移除全局 LoRA ${index + 1}`} onClick={() => setEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" />移除</Button>
              </div>
            </div>)}
            {!entries.length && <p className="rounded border border-dashed border-border-default p-4 text-center text-sm text-muted">尚未配置全局 LoRA。活动仍可仅使用工作流模型绘制。</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={!response.models.length || entries.length >= 32} onClick={() => setEntries((current) => [...current, { model: response.models.find((model) => !current.some((item) => item.model === model)) ?? response.models[0], strength: 1, triggerWord: '', enabled: true }])}>
              <Plus className="h-4 w-4" />添加 LoRA
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? '保存中…' : '保存全局配置'}
            </Button>
            {saved && <span role="status" className="text-sm text-success">已保存修订 r{response.policy.revision}</span>}
          </div>
        </>}
      </>}
    </section>
  );
}
