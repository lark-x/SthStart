'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { fetchGenerationPresets, setDefaultGenerationPreset, updateGenerationPreset } from '../api';
import type { Assignment, GenerationPreset, Workflow } from '../types';


function isAvailableImagePreset(preset: GenerationPreset, workflows: Workflow[]) {
  const workflow = workflows.find((item) => item.id === preset.workflowId);
  const version = workflow?.versions.find((item) => item.version === preset.workflowVersion);
  return preset.enabled && Boolean(version?.isPublished && (version.category ?? workflow?.category) === 'image');
}

function dimensionLimit(workflow: Workflow | undefined, versionNumber: number, key: 'width' | 'height') {
  const version = workflow?.versions.find((item) => item.version === versionNumber);
  const schema = version?.inputSchema[key] as { minimum?: number; maximum?: number; step?: number } | undefined;
  return { minimum: schema?.minimum ?? 1, maximum: schema?.maximum ?? Number.MAX_SAFE_INTEGER, step: schema?.step ?? 1 };
}

/** Common settings use published presets; raw workflow graphs remain in advanced configuration. */
export function ActivityImageQuickSettings({ workflows, assignments, onDataChanged, onManagePrompts }: {
  workflows: Workflow[];
  assignments: Assignment[];
  onDataChanged: () => Promise<void>;
  onManagePrompts?: () => void;
}) {
  const [presets, setPresets] = useState<GenerationPreset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const assignment = assignments.find((item) => item.app_id === 'activities' && item.purpose === 'activity_image_text');
  const available = useMemo(() => presets.filter((item) => isAvailableImagePreset(item, workflows)), [presets, workflows]);
  const selected = available.find((item) => item.id === selectedId);
  const selectedWorkflow = workflows.find((item) => item.id === selected?.workflowId);
  const selectedVersion = selectedWorkflow?.versions.find(item => item.version === selected?.workflowVersion);
  const resolutions = selectedVersion?.editorConfig?.sizePresets ?? [];
  const dimensionDefault = (key: 'width' | 'height') => selected?.values[key] ?? (selectedVersion?.inputSchema[key] as { default?: unknown } | undefined)?.default ?? '';
  const widthLimit = dimensionLimit(selectedWorkflow, selected?.workflowVersion ?? 0, 'width');
  const heightLimit = dimensionLimit(selectedWorkflow, selected?.workflowVersion ?? 0, 'height');
  const dimensionsDirty = Boolean(selected && (width !== String(dimensionDefault('width')) || height !== String(dimensionDefault('height'))));
  const defaultPreset = available.find((item) => item.id === assignment?.default_preset_id);

  const reload = async () => {
    const response = await fetchGenerationPresets({ appId: 'activities', purpose: 'activity_image_text' });
    setPresets(response.items);
  };

  useEffect(() => {
    let active = true;
    void fetchGenerationPresets({ appId: 'activities', purpose: 'activity_image_text' }).then((response) => {
      if (active) setPresets(response.items);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '读取绘制预设失败。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!available.length || available.some((item) => item.id === selectedId)) return;
    const preferred = available.find((item) => item.id === assignment?.default_preset_id)

      ?? available[0];
    setSelectedId(preferred.id);
  }, [available, selectedId, assignment?.default_preset_id]);

  useEffect(() => {
    if (!selected) return;
    setWidth(String(dimensionDefault('width')));
    setHeight(String(dimensionDefault('height')));
  }, [selected?.id, selected?.revision]);

  const applyDefault = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await setDefaultGenerationPreset(selected.id);
      await Promise.all([reload(), onDataChanged()]);
      setNotice(`已将「${selected.name}」设为活动默认；已单独选择工作流的镜头不会改变。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '设置默认预设失败。'); }
    finally { setBusy(false); }
  };

  const saveDimensions = async () => {
    if (!selected || busy) return;
    const nextWidth = Number(width);
    const nextHeight = Number(height);
    if (!Number.isInteger(nextWidth) || !Number.isInteger(nextHeight)
      || nextWidth < widthLimit.minimum || nextWidth > widthLimit.maximum
      || nextHeight < heightLimit.minimum || nextHeight > heightLimit.maximum) {
      setError(`宽度需在 ${widthLimit.minimum}–${widthLimit.maximum}，高度需在 ${heightLimit.minimum}–${heightLimit.maximum}，且均为整数。`);
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      await updateGenerationPreset(selected.id, { revision: selected.revision, values: { ...selected.values, width: nextWidth, height: nextHeight } });
      await reload();
      setNotice(`已保存「${selected.name}」的出图尺寸；之后使用该预设的任务会采用新尺寸。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存出图尺寸失败。'); }
    finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <section className="rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 sm:p-6" aria-labelledby="activity-image-default-title">
      <h2 id="activity-image-default-title" className="text-base font-semibold text-ink">默认绘制模式</h2>
      <p className="mt-1 text-sm text-muted">这里管理活动默认方案。创作中心和角色头像的默认方案在“预设与用途”中分别设置。</p>
      <p className="mt-3 rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm text-ink">
        当前活动默认：{defaultPreset ? `${defaultPreset.name} · v${defaultPreset.workflowVersion}` : assignment ? `${workflows.find((item) => item.id === assignment.workflow_id)?.name ?? assignment.workflow_id} v${assignment.workflow_version}（未绑定预设）` : '未配置'}
      </p>
      {loading ? <p className="mt-4 text-sm text-muted">正在读取可用预设…</p> : available.length ? <div className="mt-4 space-y-4">
        <label className="block max-w-xl space-y-1.5"><span className="text-sm font-medium text-ink">选择模型与工作流预设</span>
          <Select value={selectedId} onChange={(event) => {
            if (dimensionsDirty && !window.confirm('当前尺寸尚未保存，确定切换预设吗？')) return;
            setSelectedId(event.target.value); setError(''); setNotice('');
          }} aria-label="活动默认绘制预设">
            {available.map((item) => <option key={item.id} value={item.id}>{item.name} · {workflows.find((workflow) => workflow.id === item.workflowId)?.name ?? item.workflowId} v{item.workflowVersion}</option>)}
          </Select>
        </label>
        {selected && <>
          <div className="flex flex-wrap gap-2">{resolutions.filter((item) => item.width <= widthLimit.maximum && item.height <= heightLimit.maximum).map((item) => <Button type="button" key={item.label} size="sm" variant={width === String(item.width) && height === String(item.height) ? 'accent' : 'outline'} onClick={() => { setWidth(String(item.width)); setHeight(String(item.height)); }}>{item.label} · {item.width}×{item.height}</Button>)}</div>
          <details className="max-w-xl rounded-[var(--radius-control)] border border-border-subtle px-3 py-2"><summary className="cursor-pointer text-sm text-muted">自定义宽高</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm text-ink">宽度<Input type="number" min={widthLimit.minimum} max={widthLimit.maximum} step="8" value={width} onChange={(event) => setWidth(event.target.value)} /></label><label className="space-y-1 text-sm text-ink">高度<Input type="number" min={heightLimit.minimum} max={heightLimit.maximum} step="8" value={height} onChange={(event) => setHeight(event.target.value)} /></label></div>
          </details>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="accent" disabled={busy || dimensionsDirty || selected.id === assignment?.default_preset_id} onClick={() => void applyDefault()}>{busy ? '正在保存…' : selected.id === assignment?.default_preset_id ? '已是活动默认' : '设为活动默认'}</Button><Button type="button" variant="outline" disabled={busy || !dimensionsDirty} onClick={() => void saveDimensions()}>保存尺寸</Button></div>
          <p className="text-xs text-muted">修改尺寸只影响这个预设；设为活动默认会影响后续未单独指定工作流的生图，不改已有图片和镜头设置。</p>
        </>}
      </div> : <Alert variant="warning" title="暂无可用活动生图预设">请在高级配置中为活动创建并启用已发布的图片预设。</Alert>}
      {notice && <p role="status" className="mt-3 text-sm text-success">{notice}</p>}
      {error && <Alert variant="danger" title="常用设置未保存">{error}</Alert>}
    </section>
    <Button variant="outline" onClick={onManagePrompts}>管理提示词策略</Button>
  </div>;
}
