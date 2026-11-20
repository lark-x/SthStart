'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { ModelProfile, ServiceConnection } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { FormField } from '@/app/components/ui/form-field';
import { discoverConnectionModels, saveModelProfile } from '../api';
import {
  generateInternalId,
  selectConnectionForModelType,
  supplierConnectionSupportsType,
  type SupplierModelType,
} from './public-services-model-settings';

export function SupplierModelPicker({ connections, supplierName, initialType, models, onClose, onSaved }: {
  connections: ServiceConnection[];
  supplierName: string;
  initialType?: SupplierModelType;
  models: ModelProfile[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const availableTypes = (['chat', 'embedding', 'image'] as const).filter(type =>
    connections.some(connection => supplierConnectionSupportsType(connection.kind, type)),
  );
  const workflowOnly = connections.length > 0 && connections.every(connection => ['comfyui', 'worker'].includes(connection.kind));
  const initialModelType = initialType && availableTypes.includes(initialType) ? initialType : availableTypes[0] ?? 'chat';
  const [modelType, setModelType] = useState<SupplierModelType>(initialModelType);
  const [vision, setVision] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const discoveryRequest = useRef(0);
  const [savedModels, setSavedModels] = useState(new Set<string>());
  const groupConnectionIds = new Set(connections.map(connection => connection.id));
  const targetConnection = selectConnectionForModelType(connections, modelType);
  const existing = new Set(models.filter(model => groupConnectionIds.has(model.connectionId) && (model.modelType ?? 'chat') === modelType).map(model => model.modelId));
  for (const saved of savedModels) {
    if (saved.startsWith(`${modelType}:`)) existing.add(saved.slice(modelType.length + 1));
  }
  const rows = [...new Set([...catalog, ...selected])].filter(id => id.toLowerCase().includes(query.toLowerCase()));

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!selected.length) { setError('请选择模型，或输入模型 ID 后点击“加入”。'); return; }
    if (!targetConnection) { setError('当前供应商没有支持该用途的连接。'); return; }
    setSaving(true);
    setError('');
    const failed: string[] = [];
    const reasons: string[] = [];
    const ids = new Set(models.map(model => model.id));
    for (const modelId of selected) {
      try {
        const savedKey = `${modelType}:${modelId}`;
        if (existing.has(modelId) || savedModels.has(savedKey)) continue;
        const id = generateInternalId('model', `${targetConnection.id}-${modelType}-${modelId}`, ids);
        ids.add(id);
        await saveModelProfile({ id, connectionId: targetConnection.id, name: modelId, modelId, modelType,
          capabilities: modelType === 'chat' ? vision ? ['text', 'multimodal'] : ['text'] : [] });
        setSavedModels(previous => new Set([...previous, savedKey]));
      } catch (caught) {
        failed.push(modelId);
        reasons.push(`${modelId}：${caught instanceof Error ? caught.message : '保存失败'}`);
      }
    }
    setSelected(failed);
    try {
      await onSaved();
      if (failed.length) { setSelected(failed); setError(`部分模型未保存。${reasons.join('；')}`); }
      else onClose();
    } catch { setError(failed.length
      ? `部分模型未保存。${reasons.join('；')}。列表刷新失败，可重试未保存项。`
      : '模型已保存，列表刷新失败，请关闭后刷新页面。'); }
    finally { setSaving(false); }
  };

  const discover = async () => {
    if (!targetConnection) return;
    const request = ++discoveryRequest.current;
    setLoading(true);
    setError('');
    try {
      const result = await discoverConnectionModels({ connectionId: targetConnection.id });
      if (request === discoveryRequest.current) setCatalog(result.models);
    }
    catch { if (request === discoveryRequest.current) setError('模型目录暂时不可用，可在下方手动填写模型 ID。'); }
    finally { if (request === discoveryRequest.current) setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }} title={`添加模型 · ${supplierName}`} size="lg">
      {workflowOnly ? <div className="space-y-4 text-sm text-muted">
        <p>此连接通过工作流提供绘图能力。请在生成方案中选择模型文件并配置工作流。</p>
        <Link className="inline-flex py-2 text-accent underline" href="/settings/generation">打开生成方案</Link>
      </div> : <form aria-label="添加供应商模型" className="space-y-4" onSubmit={handleSave}>
        {error && <Alert variant="warning" title="操作提示">{error}</Alert>}
        {targetConnection && !targetConnection.enabled && <p className="text-sm text-muted">对应连接已停用。仍可手动添加模型，启用供应商后才能获取目录或调用。</p>}
        <FormField label="模型用途">
          <Select value={modelType} disabled={saving} onChange={event => { discoveryRequest.current += 1; setLoading(false); setModelType(event.target.value as SupplierModelType); setSelected([]); setCatalog([]); setQuery(''); setManual(''); setVision(false); setError(''); }}>
            {availableTypes.includes('chat') && <option value="chat">文本 / 看图</option>}
            {availableTypes.includes('embedding') && <option value="embedding">向量计算</option>}
            {availableTypes.includes('image') && <option value="image">绘图</option>}
          </Select>
        </FormField>
        {modelType === 'chat' && <Checkbox label="所选模型同时支持看图" checked={vision} disabled={saving} onChange={event => setVision(event.target.checked)} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" loading={loading} disabled={saving || !targetConnection?.enabled} onClick={() => void discover()}>获取模型列表</Button>
          <span className="text-xs text-muted">请按供应商说明确认用途与能力。</span>
        </div>
        {catalog.length > 0 && <Input type="search" aria-label="筛选模型目录" placeholder="搜索模型" value={query} onChange={event => setQuery(event.target.value)} />}
        {rows.length > 0 && <div className="max-h-64 space-y-3 overflow-y-auto py-2">
          {rows.map(id => <Checkbox key={id} label={`${id}${existing.has(id) ? ' · 已添加' : ''}`} checked={existing.has(id) || selected.includes(id)} disabled={existing.has(id) || saving}
            onChange={event => setSelected(value => event.target.checked ? [...value, id] : value.filter(item => item !== id))} />)}
        </div>}
        <FormField label="手动添加模型 ID">
          <Input name="model-id" value={manual} disabled={saving} onChange={event => setManual(event.target.value)} spellCheck={false} autoCapitalize="none" placeholder="填写供应商提供的实际模型 ID" />
        </FormField>
        <Button type="button" variant="outline" disabled={saving} onClick={() => {
          const id = manual.trim();
          if (!id) { setError('请先填写模型 ID。'); return; }
          if (existing.has(id)) { setError('该用途下已添加此模型，可直接编辑已有配置。'); return; }
          setSelected(value => [...new Set([...value, id])]); setManual(''); setError('');
        }}>加入</Button>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={saving}>保存所选模型{selected.length ? `（${selected.length}）` : ''}</Button>
        </div>
      </form>}
    </Dialog>
  );
}
