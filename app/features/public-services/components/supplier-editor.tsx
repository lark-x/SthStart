'use client';

import { useState, type FormEvent } from 'react';
import type { ServiceConnection } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { saveConnection } from '../api';
import { generateInternalId } from './public-services-model-settings';

export function SupplierEditor({ connection, groupConnections, connections, onClose, onSaved }: {
  connection: ServiceConnection | null;
  groupConnections?: ServiceConnection[];
  connections: ServiceConnection[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const editingConnections = groupConnections?.length ? groupConnections : connection ? [connection] : [];
  const mixedProtocols = editingConnections.length > 1 && new Set(editingConnections.map(item => item.kind)).size > 1;
  const [name, setName] = useState(connection?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [secret, setSecret] = useState('');
  const [savedId, setSavedId] = useState(connection?.id ?? '');
  const [kind, setKind] = useState<ServiceConnection['kind']>(connection?.kind ?? 'openai-compatible-text');
  const [timeoutMs, setTimeoutMs] = useState(connection?.timeoutMs ?? 60000);
  const [headers, setHeaders] = useState(JSON.stringify(connection?.headers ?? {}, null, 2));
  const [options, setOptions] = useState(JSON.stringify(connection?.options ?? {}, null, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    let parsedHeaders: Record<string, string>;
    let parsedOptions: Record<string, unknown>;
    try {
      parsedHeaders = JSON.parse(headers);
      parsedOptions = JSON.parse(options);
      if (!parsedHeaders || Array.isArray(parsedHeaders) || typeof parsedHeaders !== 'object'
        || Object.values(parsedHeaders).some(value => typeof value !== 'string')
        || !parsedOptions || Array.isArray(parsedOptions) || typeof parsedOptions !== 'object') throw new Error();
    } catch {
      setError('请求头和额外参数必须是 JSON 对象，请检查高级设置。');
      return;
    }
    setSaving(true);
    try {
      const targets = editingConnections.length > 0
        ? editingConnections.map(item => ({ id: item.id, kind: mixedProtocols ? item.kind : kind }))
        : [{ id: savedId || generateInternalId('conn', name, new Set(connections.map(item => item.id))), kind }];
      const warnings: string[] = [];
      const failures: string[] = [];
      let firstId = savedId;
      for (const target of targets) {
        try {
          const result = await saveConnection({
            id: target.id,
            name: name.trim(), baseUrl: baseUrl.trim(), kind: target.kind, timeoutMs,
            headers: parsedHeaders, options: parsedOptions,
            ...(secret.trim() ? { secret: secret.trim() } : {}),
          });
          firstId = firstId || result.id;
          if (result.warning) warnings.push(result.warning);
        } catch (caught) {
          failures.push(`${target.id}：${caught instanceof Error ? caught.message : '保存失败'}`);
        }
      }
      setSavedId(firstId);
      if (failures.length) {
        setError(`部分连接未保存：${failures.join('；')}`);
        return;
      }
      if (warnings.length === 0) setSecret('');
      try {
        await onSaved();
      } catch (caught) {
        setError(`配置已保存，但页面刷新失败：${caught instanceof Error ? caught.message : String(caught)}`);
        return;
      }
      if (warnings.length) setError([...new Set(warnings)].join('；'));
      else onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试。');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}
      title={connection ? '编辑供应商' : '添加供应商'} description={editingConnections.length > 1
        ? `此供应商包含 ${editingConnections.length} 条历史连接；名称、地址和密钥会统一保存。`
        : '保存一次连接信息，之后可反复添加模型。'}>
      <form aria-label="供应商配置" className="space-y-4" onSubmit={handleSave}>
        {error && <Alert variant="warning" title="请检查配置">{error}</Alert>}
        <FormField label="供应商名称" required>
          <Input required name="supplier-name" maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="例如 Magpie、本地模型" />
        </FormField>
        <FormField label="API 地址" required hint="OpenAI 兼容地址通常以 /v1 结尾。">
          <Input required name="base-url" type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" autoCapitalize="none" spellCheck={false} />
        </FormField>
        <FormField label="API Key" hint={connection?.hasCredential ? '已配置。留空保留现有密钥。' : '本地免认证服务可留空。'}>
          <Input name="api-key" type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} />
        </FormField>
        <details className="space-y-3">
          <summary className="cursor-pointer text-sm font-medium text-muted">高级连接设置</summary>
          {mixedProtocols ? (
            <p className="text-sm text-muted">此供应商包含多种历史协议，将保留各自协议；模型用途在添加模型时选择。</p>
          ) : (
            <FormField label="连接协议" hint="模型用途在添加模型时选择。ComfyUI 和 Worker 通过生成方案使用。">
              <Select value={kind} onChange={event => setKind(event.target.value as ServiceConnection['kind'])}>
                <option value="openai-compatible-text">OpenAI 兼容</option>
                <option value="openai-compatible-image">OpenAI 兼容（历史绘图连接）</option>
                <option value="comfyui">ComfyUI</option>
                <option value="worker">Windows Worker</option>
                <option value="vector">本地向量服务</option>
              </Select>
            </FormField>
          )}
          <FormField label="超时（毫秒）">
            <Input type="number" min={1000} max={600000} step={1000} value={timeoutMs} onChange={event => setTimeoutMs(Number(event.target.value))} />
          </FormField>
          <FormField label="自定义请求头 JSON" hint="认证密钥请填写在 API Key 中。">
            <Textarea rows={3} className="font-mono" value={headers} onChange={event => setHeaders(event.target.value)} />
          </FormField>
          <FormField label="额外请求参数 JSON">
            <Textarea rows={3} className="font-mono" value={options} onChange={event => setOptions(event.target.value)} />
          </FormField>
        </details>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={saving}>保存供应商</Button>
        </div>
      </form>
    </Dialog>
  );
}
