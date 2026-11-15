'use client';

import React, { useState } from 'react';
import type { LlmModelCapability, ModelProfile, ModelThinkingLevel } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { useToast } from '@/app/providers/ui-provider';
import { saveModelProfile } from '../api';
import { optionalTimeout, thinkingLevelLabel } from './public-services-model-settings';

const THINKING_LEVELS: ModelThinkingLevel[] = ['auto', 'off', 'low', 'medium', 'high'];

function parseTokenLimit(label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { value: null as number | null, error: null as string | null };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { value: null, error: `${label}应为正整数，可留空。` };
  }
  return { value: parsed, error: null };
}

export function ModelProfileEditorDialog({
  open,
  onOpenChange,
  model,
  connectionName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ModelProfile;
  connectionName: string;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const isChat = (model.modelType ?? 'chat') === 'chat';
  const [name, setName] = useState(model.name);
  const [modelId, setModelId] = useState(model.modelId);
  const [capabilities, setCapabilities] = useState<LlmModelCapability[]>([...model.capabilities]);
  const [contextLength, setContextLength] = useState(
    model.contextLength === null ? '' : String(model.contextLength),
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    model.maxOutputTokens === null ? '' : String(model.maxOutputTokens),
  );
  const [thinkingLevel, setThinkingLevel] = useState<ModelThinkingLevel>(
    model.thinkingLevel ?? 'auto',
  );
  const [timeoutMs, setTimeoutMs] = useState(
    model.timeoutMs ? String(model.timeoutMs) : '',
  );
  const [enabled, setEnabled] = useState(model.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleCapability = (capability: LlmModelCapability) => {
    setCapabilities((previous) =>
      previous.includes(capability)
        ? previous.filter((item) => item !== capability)
        : [...previous, capability],
    );
    setError('');
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (isChat && capabilities.length === 0) {
      setError('请至少选择文本或看图一种能力。');
      return;
    }
    if (!name.trim() || !modelId.trim()) {
      setError('显示名称和 modelId 不能为空。');
      return;
    }
    const context = parseTokenLimit('上下文', contextLength);
    const output = parseTokenLimit('最大输出', maxOutputTokens);
    const timeout = optionalTimeout(timeoutMs);
    if (context.error || output.error) {
      setError(context.error ?? output.error ?? '');
      return;
    }
    if (timeoutMs.trim() && timeout === null) {
      setError('超时应为 1000–600000 毫秒，可留空。');
      return;
    }

    setSaving(true);
    try {
      await saveModelProfile({
        id: model.id,
        connectionId: model.connectionId,
        name: name.trim(),
        modelId: modelId.trim(),
        modelType: model.modelType ?? 'chat',
        capabilities: isChat ? capabilities : [],
        contextLength: context.value,
        maxOutputTokens: output.value,
        thinkingLevel,
        timeoutMs: timeout,
        enabled,
      });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      setError(reason);
      toast.error('模型保存失败', reason);
      setSaving(false);
      return;
    }

    toast.success('模型配置已更新。');
    try {
      await onSaved();
      onOpenChange(false);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      setError(`模型已保存，但页面刷新失败：${reason}`);
      toast.warning('模型已保存，但页面刷新失败', reason);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => { if (!saving) onOpenChange(next); }}
      title="编辑模型"
      description={`${connectionName} · ${model.id}`}
      size="lg"
    >
      <form onSubmit={handleSave} className="space-y-4">
        {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <FormField label="显示名称" required>
            <Input required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
              autoComplete="off"
            />
          </FormField>
          <FormField label="modelId" required>
            <Input required
              value={modelId}
              onChange={(event) => {
                setModelId(event.target.value);
                setError('');
              }}
              className="font-mono"
              autoComplete="off"
            />
          </FormField>
        </div>

        {isChat && <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">类型</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Checkbox
              label="文本"
              checked={capabilities.includes('text')}
              onChange={() => toggleCapability('text')}
            />
            <Checkbox
              label="看图（多模态）"
              checked={capabilities.includes('multimodal')}
              onChange={() => toggleCapability('multimodal')}
            />
          </div>
        </fieldset>}

        {isChat && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <FormField label="上下文">
            <Input
              type="number"
              min={1}
              value={contextLength}
              onChange={(event) => setContextLength(event.target.value)}
              placeholder="例如 128000"
              className="font-mono"
            />
          </FormField>
          <FormField label="最大输出">
            <Input
              type="number"
              min={1}
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
              placeholder="例如 8192"
              className="font-mono"
            />
          </FormField>
        </div>}

        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          {isChat && <FormField label="思考强度">
            <Select
              value={thinkingLevel}
              onChange={(event) => setThinkingLevel(event.target.value as ModelThinkingLevel)}
            >
              {THINKING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {thinkingLevelLabel(level)}
                </option>
              ))}
            </Select>
          </FormField>}
          <FormField label="超时（毫秒）">
            <Input
              type="number"
              min={1000}
              max={600000}
              step={1000}
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
              placeholder="留空"
              className="font-mono"
            />
          </FormField>
          <div className="flex items-center pt-6">
            <Checkbox
              label="启用该模型"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" type="button" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" type="submit" loading={saving}>
            保存模型
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
