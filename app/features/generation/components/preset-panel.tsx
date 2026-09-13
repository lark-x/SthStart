'use client';

import { useEffect, useMemo, useState } from 'react';
import { Ban, Copy, Plus, Save, Star, Trash2 } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import {
  copyGenerationPreset,
  createGenerationPreset,
  deleteGenerationPreset,
  fetchEngineModels,
  fetchGenerationPresets,
  saveCreativeCenterAssignments,
  setDefaultGenerationPreset,
  updateGenerationPreset,
} from '../api';
import type { Assignment, Engine, GenerationPreset, ModelEntry, Workflow } from '../types';

/**
 * 预设与用途（规划 §8.3 / §10.2）：预设 = 确切工作流版本 + 连接 + 覆盖值 + 开放用途。
 * 「设为默认」由服务端在短事务中同步用途绑定；显式选择非默认预设不影响全站默认。
 */

interface PresetEditorState {
  preset: GenerationPreset | null;
  appId: string;
  purpose: string;
  name: string;
  description: string;
  workflowId: string;
  workflowVersion: number | null;
  engineId: string | null;
  values: Record<string, unknown>;
  revision: number;
}

const CREATIVE_PURPOSES = [
  ['text-to-image', '文本生图'],
  ['image-to-image', '图生图'],
  ['h3-t2v', 'H3 文生视频'],
  ['h3-i2v', 'H3 图生视频'],
  ['h3-fl2va', 'H3 首尾帧视频'],
] as const;

function versionFields(workflow: Workflow | undefined, versionNumber: number | null) {
  if (!workflow) return [];
  const version = workflow.versions.find((item) => item.version === (versionNumber ?? workflow.latest_version));
  if (!version) return [];
  const editorFields = version.editorConfig ? Object.values(version.editorConfig.fields) : [];
  if (editorFields.length) {
    return editorFields
      .filter((field) => field.section !== 'fixed' && field.type !== 'seed')
      .sort((left, right) => left.order - right.order)
      .map((field) => {
        const schema = (version.inputSchema[field.key] ?? {}) as Record<string, unknown>;
        return {
          key: field.key,
          label: field.label,
          type: String(field.type ?? schema.type ?? 'text'),
          enumValues: Array.isArray(schema.enum) ? schema.enum as string[] : [],
          defaultValue: schema.default,
          modelCategory: field.modelCategory,
        };
      });
  }
  // V1 回退：既有创作固定字段中出现在 schema 里的键。
  const legacy: Array<{ key: string; label: string; type: string; enumValues: string[]; defaultValue: unknown; modelCategory?: string }> = [];
  const schema = version.inputSchema;
  for (const [key, label, type] of [['prompt', '提示词', 'long-text'], ['negativePrompt', '反向提示词', 'long-text'], ['width', '宽度', 'integer'], ['height', '高度', 'integer'], ['steps', '步数', 'integer'], ['cfg', 'CFG', 'number'], ['denoise', '重绘强度', 'number'], ['sampler_name', '采样器', 'enum'], ['scheduler', '调度器', 'enum']] as const) {
    if (schema[key]) {
      const entry = schema[key] as Record<string, unknown>;
      legacy.push({ key, label, type, enumValues: Array.isArray(entry.enum) ? entry.enum as string[] : [], defaultValue: entry.default, modelCategory: undefined });
    }
  }
  return legacy;
}

function ValueInputs({
  workflow,
  workflowVersion,
  engineId,
  values,
  onValuesChange,
}: {
  workflow: Workflow | undefined;
  workflowVersion: number | null;
  engineId: string | null;
  values: Record<string, unknown>;
  onValuesChange: (next: Record<string, unknown>) => void;
}) {
  const fields = versionFields(workflow, workflowVersion);
  const categories = new Set(fields.map((field) => field.modelCategory).filter(Boolean)) as Set<string>;
  const [models, setModels] = useState<ModelEntry[]>([]);
  const modelFieldCount = fields.filter((field) => field.type === 'model').length;

  useEffect(() => {
    if (!engineId || !modelFieldCount) return;
    let cancelled = false;
    void fetchEngineModels(engineId, {}).then((response) => { if (!cancelled) setModels(response.items); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [engineId, modelFieldCount]);

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const id = `preset-value-${field.key}`;
        const current = values[field.key];
        const modelOptions = models
          .filter((item) => !field.modelCategory || !categories.size || item.category === field.modelCategory);
        return (
          <div key={field.key}>
            <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
              {field.label}
              <span className="ml-1 text-fg-subtle">（{field.key}）</span>
            </label>
            {field.type === 'model' ? (
              <Select id={id} value={current == null ? '' : String(current)} onChange={(event) => onValuesChange({ ...values, [field.key]: event.target.value || undefined })}>
                <option value="">（使用工作流默认）</option>
                {modelOptions.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                {current != null && current !== '' && !modelOptions.some((item) => item.name === current) && <option value={String(current)}>{String(current)}（不在当前库存中）</option>}
              </Select>
            ) : field.type === 'enum' && field.enumValues.length ? (
              <Select id={id} value={current == null ? '' : String(current)} onChange={(event) => onValuesChange({ ...values, [field.key]: event.target.value || undefined })}>
                <option value="">（使用工作流默认）</option>
                {field.enumValues.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            ) : field.type === 'long-text' ? (
              <Textarea id={id} rows={2} value={current == null ? '' : String(current)} onChange={(event) => onValuesChange({ ...values, [field.key]: event.target.value || undefined })} placeholder="（使用工作流默认）" />
            ) : field.type === 'integer' || field.type === 'number' ? (
              <Input id={id} type="number" step="any" value={current == null ? '' : String(current)} onChange={(event) => onValuesChange({ ...values, [field.key]: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder={field.defaultValue == null ? '' : `默认 ${String(field.defaultValue)}`} />
            ) : field.type === 'boolean' ? (
              <Select id={id} value={current === true ? 'true' : 'false'} onChange={(event) => onValuesChange({ ...values, [field.key]: event.target.value === 'true' })}>
                <option value="false">关</option>
                <option value="true">开</option>
              </Select>
            ) : (
              <Input id={id} value={current == null ? '' : String(current)} onChange={(event) => onValuesChange({ ...values, [field.key]: event.target.value || undefined })} placeholder="（使用工作流默认）" />
            )}
          </div>
        );
      })}
      {fields.length === 0 && <p className="text-sm text-muted">该工作流版本没有可编辑字段。</p>}
    </div>
  );
}

export function PresetPanel({
  workflows,
  engines,
  assignments,
  draftFor,
  onDataChanged,
}: {
  workflows: Workflow[];
  engines: Engine[];
  assignments: Assignment[];
  /** 「另存预设」入口带入的初始值（来自试运行结果）。 */
  draftFor?: { workflowId: string; workflowVersion: number; values: Record<string, unknown> } | null;
  onDataChanged: () => Promise<void>;
}) {
  const [presets, setPresets] = useState<GenerationPreset[]>([]);
  const [editor, setEditor] = useState<PresetEditorState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const reloadPresets = async () => {
    const response = await fetchGenerationPresets();
    setPresets(response.items);
  };

  useEffect(() => {
    // 预设列表来自管理 API（外部系统）；挂载时加载一次。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadPresets();
  }, []);
  useEffect(() => {
    if (draftFor?.workflowId && draftFor.values) {
      // 「另存预设」入口带入试运行参数：仅在该入口变化时打开编辑器。
      const workflow = workflows.find((item) => item.id === draftFor.workflowId);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditor({
        preset: null,
        appId: 'creative-center',
        purpose: 'text-to-image',
        name: `${workflow?.name ?? draftFor.workflowId} 预设`,
        description: '来自试运行结果',
        workflowId: draftFor.workflowId,
        workflowVersion: draftFor.workflowVersion,
        engineId: workflow?.versions.find((version) => version.version === draftFor.workflowVersion)?.engineId ?? null,
        values: Object.fromEntries(Object.entries(draftFor.values).filter(([key]) => versionFields(workflow, draftFor.workflowVersion).some((field) => field.key === key))),
        revision: 0,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFor]);

  const workflowById = useMemo(() => new Map(workflows.map((item) => [item.id, item])), [workflows]);

  const openCreate = () => {
    setEditor({
      preset: null, appId: 'creative-center', purpose: 'text-to-image', name: '', description: '',
      workflowId: workflows[0]?.id ?? '', workflowVersion: workflows[0]?.latest_version ?? null,
      engineId: workflows[0]?.versions[0]?.engineId ?? null, values: {}, revision: 0,
    });
  };

  const openEdit = (preset: GenerationPreset) => {
    setEditor({
      preset, appId: preset.appId, purpose: preset.purpose, name: preset.name, description: preset.description,
      workflowId: preset.workflowId, workflowVersion: preset.workflowVersion, engineId: preset.engineId,
      values: preset.values, revision: preset.revision,
    });
  };

  const saveEditor = async () => {
    if (!editor) return;
    setBusy('preset');
    setError('');
    try {
      if (editor.preset) {
        await updateGenerationPreset(editor.preset.id, {
          name: editor.name, description: editor.description, values: editor.values,
          enabled: editor.preset.enabled,
          revision: editor.revision,
        });
      } else {
        await createGenerationPreset({
          appId: editor.appId, purpose: editor.purpose, name: editor.name, description: editor.description,
          workflowId: editor.workflowId, workflowVersion: editor.workflowVersion ?? undefined,
          engineId: editor.engineId, values: editor.values,
        });
      }
      await reloadPresets();
      await onDataChanged();
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const setDefault = async (preset: GenerationPreset) => {
    setBusy(`default-${preset.id}`);
    setError('');
    try {
      await setDefaultGenerationPreset(preset.id);
      await Promise.all([reloadPresets(), onDataChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const toggleEnabled = async (preset: GenerationPreset) => {
    setBusy(`toggle-${preset.id}`);
    setError('');
    try {
      await updateGenerationPreset(preset.id, { enabled: !preset.enabled, revision: preset.revision, ...(preset.isDefault ? { clearDefault: true } : {}) });
      await Promise.all([reloadPresets(), onDataChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const copyPreset = async (preset: GenerationPreset) => {
    setBusy(`copy-${preset.id}`);
    setError('');
    try {
      await copyGenerationPreset(preset.id, { name: `${preset.name} 副本` });
      await reloadPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const removePreset = async (preset: GenerationPreset) => {
    if (!window.confirm(`确定删除预设「${preset.name}」吗？`)) return;
    setBusy(`delete-${preset.id}`);
    setError('');
    try {
      await deleteGenerationPreset(preset.id);
      await reloadPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const clearDefault = async (appId: string, purpose: string) => {
    setBusy(`clear-${appId}-${purpose}`);
    setError('');
    try {
      const appAssignments = assignments.filter((item) => item.app_id === appId).map((item) => ({
        purpose: item.purpose,
        workflowId: item.workflow_id,
        workflowVersion: item.workflow_version,
        engineId: item.engine_id,
        defaultPresetId: item.purpose === purpose ? null : (item.default_preset_id ?? null),
      }));
      await saveCreativeCenterAssignments(appAssignments);
      await Promise.all([reloadPresets(), onDataChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  const purposes = CREATIVE_PURPOSES.map(([purpose, label]) => {
    const assignment = assignments.find((item) => item.app_id === 'creative-center' && item.purpose === purpose);
    const purposePresets = presets.filter((preset) => preset.appId === 'creative-center' && preset.purpose === purpose && preset.enabled);
    return { purpose, label, assignment, presets: purposePresets };
  });

  return (
    <div className="space-y-4">
      {error && <Alert variant="danger" title="预设操作未完成" onDismiss={() => setError('')}>{error}</Alert>}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>常用生成预设</CardTitle>
              <CardDescription>预设绑定确切工作流版本与连接，只保存覆盖值；不随 latest 自动升级。</CardDescription>
            </div>
            <Button size="sm" variant="primary" onClick={openCreate} disabled={!workflows.length}><Plus className="h-3.5 w-3.5" aria-hidden="true" />新建预设</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {presets.length === 0 && <p className="text-sm text-fg-subtle">还没有预设。为常用场景（如「角色立绘」「横向场景图」）各建一个，创作中心即可按预设生成。</p>}
          {presets.map((preset) => {
            const workflow = workflowById.get(preset.workflowId);
            const engine = engines.find((item) => item.id === preset.engineId);
            return (
              <div key={preset.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{preset.name}</strong>
                    {preset.isDefault && <Badge variant="accent">默认</Badge>}
                    {!preset.enabled && <Badge variant="stopped">已禁用</Badge>}
                  </div>
                  <code className="mt-0.5 block truncate text-sm text-muted">
                    {workflow?.name ?? preset.workflowId} · v{preset.workflowVersion} · {engine?.name ?? '连接缺失'} · {preset.appId}/{preset.purpose}
                  </code>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => { void setDefault(preset); }} loading={busy === `default-${preset.id}`} disabled={preset.isDefault || !preset.enabled}>
                    <Star className="h-3.5 w-3.5" aria-hidden="true" />设为默认
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(preset)}>编辑</Button>
                  <Button size="sm" variant="outline" onClick={() => { void copyPreset(preset); }} loading={busy === `copy-${preset.id}`}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />复制
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { void toggleEnabled(preset); }} loading={busy === `toggle-${preset.id}`}>
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />{preset.enabled ? '禁用' : '启用'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { void removePreset(preset); }} loading={busy === `delete-${preset.id}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />删除
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>用途默认配置</CardTitle>
          <CardDescription>每个用途可以设一个默认预设；未设置时沿用下方高级区的工作流绑定，行为与旧版本一致。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {purposes.map(({ purpose, label, assignment, presets: purposePresets }) => (
            <div key={purpose} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-subtle bg-surface px-3 py-2">
              <span className="text-sm font-semibold">{label}</span>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                {assignment ? (
                  <code className="min-w-0 truncate text-sm text-muted">{(workflowById.get(assignment.workflow_id)?.name) ?? assignment.workflow_id} · v{assignment.workflow_version}</code>
                ) : (
                  <span className="text-sm text-fg-subtle">未绑定工作流</span>
                )}
                <div className="w-56">
                  <Select
                    aria-label={`${label}默认预设`}
                    value={assignment?.default_preset_id ?? ''}
                    onChange={(event) => {
                      const presetId = event.target.value;
                      const preset = purposePresets.find((item) => item.id === presetId);
                      if (preset) void setDefault(preset);
                      else if (!presetId && assignment) void clearDefault('creative-center', purpose);
                    }}
                  >
                    <option value="">（无默认预设）</option>
                    {purposePresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.name}</option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null); }} title={editor?.preset ? '编辑预设' : '新建预设'} size="lg">
        {editor && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="preset-name" className="mb-1 block text-sm font-medium text-ink">名称</label>
                <Input id="preset-name" value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
              </div>
              {!editor.preset && (
                <div>
                  <label htmlFor="preset-purpose" className="mb-1 block text-sm font-medium text-ink">开放用途</label>
                  <Select id="preset-purpose" value={editor.purpose} onChange={(event) => setEditor({ ...editor, purpose: event.target.value })}>
                    {CREATIVE_PURPOSES.map(([purpose, label]) => <option key={purpose} value={purpose}>{label}</option>)}
                  </Select>
                </div>
              )}
              {!editor.preset && (
                <div>
                  <label htmlFor="preset-workflow" className="mb-1 block text-sm font-medium text-ink">工作流（固定版本）</label>
                  <Select id="preset-workflow" value={editor.workflowId} onChange={(event) => {
                    const workflow = workflowById.get(event.target.value);
                    setEditor({ ...editor, workflowId: event.target.value, workflowVersion: workflow?.latest_version ?? null, engineId: workflow?.versions[0]?.engineId ?? null });
                  }}>
                    {workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </div>
              )}
              {!editor.preset && (
                <div>
                  <label htmlFor="preset-version" className="mb-1 block text-sm font-medium text-ink">版本</label>
                  <Select id="preset-version" value={String(editor.workflowVersion ?? '')} onChange={(event) => setEditor({ ...editor, workflowVersion: Number(event.target.value) })}>
                    {(workflowById.get(editor.workflowId)?.versions ?? []).filter((item) => item.isPublished).map((item) => (
                      <option key={item.version} value={item.version}>v{item.version}</option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="preset-desc" className="mb-1 block text-sm font-medium text-ink">说明</label>
              <Input id="preset-desc" value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} />
            </div>
            <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
              <h3 className="text-sm font-semibold text-ink">参数覆盖值</h3>
              <p className="mt-0.5 text-sm text-muted">仅保存与默认不同的值；提示词默认不保存进共享预设，由使用者填写。</p>
              <div className="mt-2">
                <ValueInputs
                  workflow={workflowById.get(editor.workflowId)}
                  workflowVersion={editor.workflowVersion}
                  engineId={editor.engineId}
                  values={editor.values}
                  onValuesChange={(values) => setEditor({ ...editor, values })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditor(null)}>取消</Button>
              <Button variant="primary" onClick={() => { void saveEditor(); }} loading={busy === 'preset'}>
                <Save className="h-3.5 w-3.5" aria-hidden="true" />保存预设
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
