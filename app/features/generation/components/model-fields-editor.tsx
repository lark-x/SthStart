'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { EmptyState } from '@/app/components/ui/empty-state';
import { fetchEngineModels } from '../api';
import type { DraftPayload, Engine, ModelEntry } from '../types';

/**
 * 模型页签（规划 §7）：主模型/组件模型的默认值来自真实连接库存；
 * 允许列表由配置者圈定；LoRA 槽位只映射已有节点，不动态插入。
 */

export function ModelFieldsEditor({
  draft,
  engines,
  updateDraft,
}: {
  draft: DraftPayload;
  engines: Engine[];
  updateDraft: (mutator: (current: DraftPayload) => DraftPayload) => void;
}) {
  const editorConfig = draft.editorConfig;
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsError, setModelsError] = useState('');
  const [modelsStale, setModelsStale] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [search, setSearch] = useState('');

  const engine = engines.find((item) => item.id === draft.engineId);
  const modelFields = useMemo(() => {
    if (!editorConfig) return [];
    return Object.values(editorConfig.fields)
      .filter((field) => field.type === 'model')
      .sort((left, right) => left.order - right.order);
  }, [editorConfig]);
  const categories = useMemo(() => new Set(modelFields.map((field) => field.modelCategory ?? '').filter(Boolean)), [modelFields]);

  const loadModels = async (refresh = false) => {
    if (!engine) return;
    setLoadingModels(true);
    setModelsError('');
    try {
      const response = await fetchEngineModels(engine.id, { refresh });
      setModels(response.items);
      setModelsStale(response.stale);
      if (response.error) setModelsError(response.error);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    // 库存来自连接发现接口（外部系统）；engine 切换时重新拉取一次。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadModels(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine?.id]);

  const visibleModels = models
    .filter((item) => !categories.size || categories.has(item.category))
    .filter((item) => !search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()));

  if (!editorConfig || modelFields.length === 0) {
    return (
      <EmptyState
        title="此工作流没有可配置的模型节点"
        description="没有识别到 CheckpointLoader、VAELoader 等模型加载节点；请在「高级」页签检查工作流定义。"
      />
    );
  }

  const schemaFor = (key: string) => {
    const entry = draft.inputSchema[key];
    return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
  };

  const setFieldConfig = (key: string, patch: Record<string, unknown>) => {
    updateDraft((current) => {
      if (!current.editorConfig) return current;
      const field = current.editorConfig.fields[key];
      if (!field) return current;
      return {
        ...current,
        editorConfig: {
          ...current.editorConfig,
          fields: { ...current.editorConfig.fields, [key]: { ...field, ...patch } },
        },
      };
    });
  };

  const setSchemaDefault = (key: string, value: unknown) => {
    updateDraft((current) => ({
      ...current,
      inputSchema: { ...current.inputSchema, [key]: { ...schemaFor(key), default: value } },
    }));
  };

  const toggleAllowedModel = (key: string, modelName: string) => {
    updateDraft((current) => {
      if (!current.editorConfig) return current;
      const field = current.editorConfig.fields[key];
      if (!field) return current;
      const allowed = new Set(field.allowedModels ?? []);
      if (allowed.has(modelName)) allowed.delete(modelName);
      else allowed.add(modelName);
      return {
        ...current,
        editorConfig: {
          ...current.editorConfig,
          fields: { ...current.editorConfig.fields, [key]: { ...field, allowedModels: [...allowed] } },
        },
      };
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="model-search" className="mb-1 block text-sm font-medium text-ink">从连接库存中筛选模型</label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
              <Input id="model-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型文件名" className="pl-7" />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => { void loadModels(true); }} loading={loadingModels}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />刷新库存
            </Button>
          </div>
        </div>
      </div>
      {modelsError && <p className="text-sm text-danger-fg" role="alert">读取模型列表失败：{modelsError}{modelsStale ? '（显示的可能是过期缓存）' : ''}</p>}
      {modelsStale && !modelsError && <p className="text-sm text-warning-fg">模型列表来自过期缓存，建议刷新。</p>}
      {!engine && <p className="text-sm text-warning-fg">尚未选择连接；保存版本前请在下方选择，模型库存无法读取。</p>}

      <div className="flex flex-wrap gap-4 rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="model-selection" checked={editorConfig.modelSelection === 'individual'} onChange={() => updateDraft((current) => current.editorConfig ? { ...current, editorConfig: { ...current.editorConfig, modelSelection: 'individual' } } : current)} />
          允许单独切换主模型
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="model-selection" checked={editorConfig.modelSelection === 'preset-locked'} onChange={() => updateDraft((current) => current.editorConfig ? { ...current, editorConfig: { ...current.editorConfig, modelSelection: 'preset-locked' } } : current)} />
          多组件模型：通过预设成套切换
        </label>
        <p className="w-full text-sm text-muted">若不能证明跨组件兼容，请选择「成套切换」；日常界面将显示模型组合摘要而不是单独下拉框。</p>
      </div>

      <div className="space-y-3">
        {modelFields.map((field) => {
          const schema = schemaFor(field.key);
          const currentDefault = typeof schema.default === 'string' ? schema.default : '';
          const allowed = field.allowedModels ?? [];
          const relevant = visibleModels.filter((item) => !field.modelCategory || !categories.size || item.category === field.modelCategory);
          return (
            <div key={field.key} className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`model-label-${field.key}`} className="mb-1 block text-sm font-medium text-ink">显示名称</label>
                  <Input id={`model-label-${field.key}`} value={field.label} onChange={(event) => setFieldConfig(field.key, { label: event.target.value })} />
                </div>
                <div className="min-w-0 flex-1">
                  <label htmlFor={`model-default-${field.key}`} className="mb-1 block text-sm font-medium text-ink">默认模型（写入 {String(schemaFor(field.key) && draft.nodeBindings[field.key]?.join(' · ') || field.key)}）</label>
                  <Select id={`model-default-${field.key}`} value={currentDefault} onChange={(event) => setSchemaDefault(field.key, event.target.value)}>
                    <option value="">（保持工作流原值）</option>
                    {(relevant.length || !currentDefault ? relevant : [{ name: currentDefault, category: field.modelCategory ?? '' }]).map((item) => (
                      <option key={item.name} value={item.name}>{item.name}</option>
                    ))}
                  </Select>
                  {!models.length && currentDefault && <p className="mt-1 text-sm text-muted">库存未加载，仅显示当前值 {currentDefault}</p>}
                </div>
              </div>
              <div className="mt-3">
                <p className="text-sm font-medium text-ink">允许选择的模型（不勾选任何项 = 允许库存中全部同类别模型）</p>
                <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-border-subtle p-2">
                  {relevant.length === 0 && <p className="text-sm text-muted">没有可用模型；请刷新库存或检查连接。</p>}
                  {relevant.map((item) => (
                    <label key={`${item.category}/${item.name}`} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={allowed.includes(item.name)}
                        onChange={() => toggleAllowedModel(field.key, item.name)}
                      />
                      <span className="min-w-0 truncate">{item.name}</span>
                      <span className="text-fg-subtle">{item.category}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editorConfig.loraSlots.length > 0 && (
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-4">
          <h3 className="text-sm font-semibold text-ink">LoRA 槽位</h3>
          <p className="mt-1 text-sm text-muted">LoRA 槽位来自工作流已有的加载节点；关闭语义由工作流定义（映射开关或强度归零），不动态插入节点。</p>
          <div className="mt-2 space-y-2">
            {editorConfig.loraSlots.map((slot) => {
              const strengthSchema = schemaFor(slot.strengthKey);
              return (
                <div key={`${slot.nameKey}-${slot.strengthKey}`} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{draft.editorConfig?.fields[slot.nameKey]?.label ?? slot.nameKey}</p>
                    <p className="text-muted">{schemaFor(slot.nameKey).default ? String(schemaFor(slot.nameKey).default) : '未选择 LoRA 文件'}</p>
                  </div>
                  <div className="w-32">
                    <label htmlFor={`lora-strength-${slot.strengthKey}`} className="mb-1 block text-sm font-medium text-ink">强度默认</label>
                    <Input
                      id={`lora-strength-${slot.strengthKey}`}
                      type="number"
                      step="0.05"
                      value={strengthSchema.default == null ? '' : String(strengthSchema.default)}
                      onChange={(event) => setSchemaDefault(slot.strengthKey, event.target.value === '' ? undefined : Number(event.target.value))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
