'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Compass, Plus, RefreshCw } from 'lucide-react';
import type {
  LlmModelCapability,
  ModelProfile,
  ModelThinkingLevel,
  ServiceConnection,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { EmptyState } from '@/app/components/ui/empty-state';
import { FormField } from '@/app/components/ui/form-field';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { useToast } from '@/app/providers/ui-provider';
import {
  discoverConnectionModels,
  saveConnection,
  saveModelProfile,
} from '../api';
import {
  PROVIDER_PRESETS,
  providerPreset,
  type ProviderPreset,
} from '../provider-presets';
import {
  generateInternalId,
  optionalPositiveInteger,
  optionalTimeout,
  thinkingLevelLabel,
} from './public-services-model-settings';

type WizardStep = 'preset' | 'connection' | 'models' | 'params';
type CreatedConnection = { id: string; name: string };

const MODEL_PRESETS = PROVIDER_PRESETS.filter(
  (preset) => preset.capabilities.length > 0,
);
const THINKING_LEVELS: ModelThinkingLevel[] = ['auto', 'off', 'low', 'medium', 'high'];

function capabilityState(
  preset: ProviderPreset,
  existing: LlmModelCapability[] | undefined,
) {
  return existing?.length ? existing : [...preset.capabilities];
}

function parseLimit(label: string, value: string) {
  const parsed = optionalPositiveInteger(value);
  if (value.trim() && parsed === null) {
    return { value: null as number | null, error: `${label}应为正整数，可留空。` };
  }
  return { value: parsed, error: null as string | null };
}

export function AddProviderWizard({
  open,
  onOpenChange,
  connections,
  models,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: ServiceConnection[];
  models: ModelProfile[];
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [step, setStep] = useState<WizardStep>('preset');
  const [presetId, setPresetId] = useState(MODEL_PRESETS[0]?.id ?? 'openai-compatible');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [connectionWarning, setConnectionWarning] = useState('');
  const [createdConnection, setCreatedConnection] = useState<CreatedConnection | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [manualModelId, setManualModelId] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [capabilitiesByModel, setCapabilitiesByModel] = useState<
    Record<string, LlmModelCapability[]>
  >({});
  const [contextLength, setContextLength] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState<ModelThinkingLevel>('auto');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [savingModels, setSavingModels] = useState(false);

  const preset = providerPreset(presetId);
  const existingIdSet = useMemo(
    () => new Set(connections.map((connection) => connection.id)),
    [connections],
  );
  const existingModelKeys = useMemo(
    () =>
      new Set(
        models.map((model) => `${model.connectionId}\u0000${model.modelId}`),
      ),
    [models],
  );
  const availableDiscovered = discoveredModels.filter(
    (modelName) =>
      !createdConnection ||
      !existingModelKeys.has(`${createdConnection.id}\u0000${modelName}`),
  );

  const selectModel = (modelName: string) => {
    setSelectedModels((previous) =>
      previous.includes(modelName) ? previous : [...previous, modelName],
    );
    setCapabilitiesByModel((previous) => ({
      ...previous,
      [modelName]: capabilityState(preset, previous[modelName]),
    }));
    setSubmitError('');
  };

  const unselectModel = (modelName: string) => {
    setSelectedModels((previous) => previous.filter((item) => item !== modelName));
  };

  const toggleModel = (modelName: string) => {
    if (selectedModels.includes(modelName)) unselectModel(modelName);
    else selectModel(modelName);
  };

  const runDiscovery = async (connectionId: string) => {
    setDiscovering(true);
    setDiscoveryError('');
    try {
      const result = await discoverConnectionModels({ connectionId });
      setDiscoveredModels([...new Set(result.models.filter(Boolean))]);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      setDiscoveryError(reason);
    } finally {
      setDiscovering(false);
    }
  };

  const handleSaveConnection = async () => {
    setConnectionError('');
    setConnectionWarning('');
    if (!name.trim()) {
      setConnectionError('请填写显示名称。');
      return;
    }
    if (!baseUrl.trim()) {
      setConnectionError('请填写 Base URL。');
      return;
    }

    const connectionId =
      createdConnection?.id ??
      generateInternalId('conn', `${preset.id}-${name}`, existingIdSet);
    setConnectionSaving(true);
    try {
      const result = await saveConnection({
        id: connectionId,
        name: name.trim(),
        kind: preset.kind,
        baseUrl: baseUrl.trim(),
        secret: secret.trim() || undefined,
        timeoutMs: 60_000,
        headers: {},
        enabled: true,
      });
      setCreatedConnection({ id: result.id, name: name.trim() });
      if (result.warning) {
        setConnectionWarning(result.warning);
        toast.warning('连接已保存，但密钥未写入', result.warning);
      } else {
        toast.success(createdConnection ? '服务连接已更新。' : '服务连接已保存。');
      }
      setStep('models');
      try {
        await onRefresh();
      } catch {
        // 页面数据刷新失败不撤销已保存的连接；后续仍以服务端发现结果为准。
      }
      if (preset.supportsDiscovery) {
        void runDiscovery(result.id);
      }
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      setConnectionError(reason);
      toast.error('连接保存失败', reason);
    } finally {
      setConnectionSaving(false);
    }
  };

  const handleAddManualModel = () => {
    const modelId = manualModelId.trim();
    if (!modelId) return;
    if (!createdConnection) {
      setDiscoveryError('请先保存服务连接。');
      return;
    }
    if (existingModelKeys.has(`${createdConnection.id}\u0000${modelId}`)) {
      setDiscoveryError('该连接下已存在同名 modelId。');
      return;
    }
    setDiscoveredModels((previous) =>
      previous.includes(modelId) ? previous : [...previous, modelId],
    );
    selectModel(modelId);
    setManualModelId('');
    setDiscoveryError('');
  };

  const handleToggleCapability = (
    modelName: string,
    capability: LlmModelCapability,
  ) => {
    setCapabilitiesByModel((previous) => {
      const current = capabilityState(preset, previous[modelName]);
      const next = current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability];
      return { ...previous, [modelName]: next };
    });
    setSubmitError('');
  };

  const handleSaveModels = async () => {
    setSubmitError('');
    if (!createdConnection) {
      setSubmitError('服务连接尚未保存。');
      return;
    }
    if (selectedModels.length === 0) {
      setSubmitError('请选择至少一个模型。');
      return;
    }
    const emptyCapabilityModel = selectedModels.find(
      (modelName) => capabilityState(preset, capabilitiesByModel[modelName]).length === 0,
    );
    if (emptyCapabilityModel) {
      setSubmitError(`模型 ${emptyCapabilityModel} 至少需要文本或看图一种能力。`);
      return;
    }
    const context = parseLimit('上下文', contextLength);
    const output = parseLimit('最大输出', maxOutputTokens);
    if (context.error || output.error) {
      setSubmitError(context.error ?? output.error ?? '');
      return;
    }
    const timeout = optionalTimeout(timeoutMs);
    if (timeoutMs.trim() && timeout === null) {
      setSubmitError('超时应为 1000–600000 毫秒，可留空。');
      return;
    }

    setSavingModels(true);
    const generatedIds = new Set([
      ...models.map((model) => model.id),
      ...connections.map((connection) => connection.id),
    ]);
    const failedModels: string[] = [];
    let savedCount = 0;
    let firstFailure = '';
    let refreshFailure = '';

    for (const modelName of selectedModels) {
      const internalId = generateInternalId(
        'model',
        `${createdConnection.id}-${modelName}`,
        generatedIds,
      );
      generatedIds.add(internalId);
      try {
        await saveModelProfile({
          id: internalId,
          connectionId: createdConnection.id,
          name: `${createdConnection.name} · ${modelName}`,
          modelId: modelName,
          capabilities: capabilityState(preset, capabilitiesByModel[modelName]),
          contextLength: context.value,
          maxOutputTokens: output.value,
          thinkingLevel,
          timeoutMs: timeout,
          enabled: true,
        });
        savedCount += 1;
      } catch (caught) {
        failedModels.push(modelName);
        if (!firstFailure) {
          firstFailure = caught instanceof Error ? caught.message : String(caught);
        }
      }
    }

    try {
      await onRefresh();
    } catch (caught) {
      refreshFailure = caught instanceof Error ? caught.message : String(caught);
    } finally {
      setSavingModels(false);
    }

    if (failedModels.length > 0) {
      setSelectedModels(failedModels);
      setSubmitError(
        `${savedCount > 0 ? `已保存 ${savedCount} 个，` : ''}${failedModels.length} 个失败：${firstFailure}${
          refreshFailure ? `；刷新失败：${refreshFailure}` : ''
        }`,
      );
      toast.error('部分模型未保存', firstFailure);
      return;
    }
    if (refreshFailure) {
      setSubmitError(`模型已保存，但页面刷新失败：${refreshFailure}`);
      toast.error('模型已保存但刷新失败', refreshFailure);
      return;
    }

    toast.success(`已添加 ${savedCount} 个模型。`);
    onOpenChange(false);
  };

  const stepTitles: Record<WizardStep, string> = {
    preset: '选择供应商类型',
    connection: '填写接入信息',
    models: '选择模型',
    params: '确认模型参数',
  };

  const canGoNextFromPreset = Boolean(preset);
  const canGoNextFromModels = selectedModels.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (connectionSaving || savingModels)) return;
        onOpenChange(next);
      }}
      title="添加模型 / 供应商"
      description={`${stepTitles[step]} · 内部 ID 自动生成`}
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              if (step === 'preset') onOpenChange(false);
              else if (step === 'connection') setStep('preset');
              else if (step === 'models') setStep('connection');
              else setStep('models');
            }}
            disabled={connectionSaving || savingModels}
          >
            {step === 'preset' ? '取消' : '上一步'}
          </Button>
          {step === 'preset' && (
            <Button
              variant="primary"
              disabled={!canGoNextFromPreset}
              onClick={() => setStep('connection')}
            >
              下一步
            </Button>
          )}
          {step === 'connection' && (
            <Button
              variant="primary"
              loading={connectionSaving}
              onClick={() => void handleSaveConnection()}
            >
              保存连接并继续
            </Button>
          )}
          {step === 'models' && (
            <Button
              variant="primary"
              disabled={!canGoNextFromModels || discovering}
              onClick={() => setStep('params')}
            >
              {selectedModels.length > 0 ? `配置 ${selectedModels.length} 个模型` : '下一步'}
            </Button>
          )}
          {step === 'params' && (
            <Button
              variant="primary"
              loading={savingModels}
              disabled={selectedModels.length === 0}
              onClick={() => void handleSaveModels()}
            >
              添加 {selectedModels.length} 个模型
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted" aria-label="添加模型步骤">
          {(['preset', 'connection', 'models', 'params'] as const).map((item, index) => (
            <span
              key={item}
              aria-current={step === item ? 'step' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                step === item ? 'bg-accent/10 font-semibold text-accent-dark' : 'bg-surface-sunken'
              }`}
            >
              <span className="font-mono">{index + 1}</span>
              {stepTitles[item]}
            </span>
          ))}
        </div>

        {step === 'preset' && (
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {MODEL_PRESETS.map((item) => {
              const selected = item.id === presetId;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setPresetId(item.id)}
                  className={`min-w-0 rounded-panel border p-3 text-left transition-colors ${
                    selected
                      ? 'border-accent bg-accent/5'
                      : 'border-border-subtle bg-surface hover:bg-surface-hover'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <strong className="text-sm font-semibold text-ink">{item.label}</strong>
                    {selected && <Check className="h-4 w-4 text-accent" aria-hidden="true" />}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{item.hint}</span>
                  <span className="mt-2 block truncate font-mono text-xs text-muted">
                    {item.baseUrlPlaceholder}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {step === 'connection' && (
          <div className="space-y-4">
            <Alert variant="info" title={preset.label}>
              {preset.hint}
            </Alert>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <FormField label="显示名称" required>
                <Input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setConnectionError('');
                  }}
                  placeholder={`例如 ${preset.label} 主接入`}
                  autoComplete="off"
                />
              </FormField>
              <FormField label="Base URL" required>
                <Input
                  type="url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    setConnectionError('');
                  }}
                  placeholder={preset.baseUrlPlaceholder}
                  className="font-mono"
                  autoComplete="off"
                />
              </FormField>
            </div>
            <FormField
              label="API Key"
              hint="写入系统凭据存储，不在页面回显。可留空，若供应商不需要密钥。"
            >
              <Input
                type="password"
                value={secret}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setConnectionError('');
                }}
                placeholder="sk-..."
                autoComplete="new-password"
              />
            </FormField>
            {connectionError && <Alert variant="danger" title="连接未保存">{connectionError}</Alert>}
          </div>
        )}

        {step === 'models' && createdConnection && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{createdConnection.name}</p>
                <code className="text-xs text-muted">{createdConnection.id}</code>
              </div>
              {preset.supportsDiscovery && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={discovering}
                  onClick={() => void runDiscovery(createdConnection.id)}
                >
                  {!discovering && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  重新发现
                </Button>
              )}
            </div>

            {connectionWarning && (
              <Alert variant="warning" title="连接已保存，但密钥未写入">
                {connectionWarning}
              </Alert>
            )}
            {discoveryError && (
              <Alert variant="warning" title="自动发现未完成">
                {discoveryError}。仍可在下面手动填写 modelId。
              </Alert>
            )}

            {discovering ? (
              <div className="flex items-center gap-2 border-y border-border-subtle py-5 text-sm text-muted">
                <Spinner className="h-4 w-4" />
                正在读取供应商模型列表…
              </div>
            ) : availableDiscovered.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">
                    发现 {availableDiscovered.length} 个模型
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      for (const modelName of availableDiscovered) {
                        if (!selectedModels.includes(modelName)) selectModel(modelName);
                      }
                    }}
                  >
                    全选可用
                  </Button>
                </div>
                <ul className="divide-y divide-border-subtle border-y border-border-subtle">
                  {availableDiscovered.map((modelName) => (
                    <li key={modelName} className="py-2.5">
                      <Checkbox
                        label={modelName}
                        checked={selectedModels.includes(modelName)}
                        onChange={() => toggleModel(modelName)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <EmptyState
                icon={Compass}
                title={preset.supportsDiscovery ? '没有可导入的新模型' : '手动填写模型'}
                description={
                  preset.supportsDiscovery
                    ? '供应商未返回模型，或返回的模型已存在。仍可在下面手动填写。'
                    : '当前类型不提供自动发现。'
                }
              />
            )}

            <div className="flex flex-col gap-2 border-t border-border-subtle pt-3 sm:flex-row sm:items-end">
              <FormField label="手动添加 modelId" className="min-w-0 flex-1">
                <Input
                  value={manualModelId}
                  onChange={(event) => setManualModelId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleAddManualModel();
                    }
                  }}
                  placeholder="例如 gpt-4o-mini"
                  className="font-mono"
                  autoComplete="off"
                />
              </FormField>
              <Button variant="outline" onClick={handleAddManualModel} disabled={!manualModelId.trim()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                加入列表
              </Button>
            </div>

            {selectedModels.length > 0 && (
              <p className="text-xs text-muted">已选择 {selectedModels.length} 个模型。</p>
            )}
            <p className="text-xs leading-relaxed text-muted">
              图片引擎 / ComfyUI 工作流请前往 <Link href="/settings/generation" className="text-accent hover:underline">生成配置</Link>。
            </p>
          </div>
        )}

        {step === 'params' && createdConnection && (
          <div className="space-y-4">
            <div className="divide-y divide-border-subtle border-y border-border-subtle">
              {selectedModels.map((modelName) => {
                const capabilities = capabilityState(preset, capabilitiesByModel[modelName]);
                return (
                  <div key={modelName} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <code className="min-w-0 break-all font-mono text-sm text-ink">{modelName}</code>
                      <Badge variant="secondary">{createdConnection.name}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <Checkbox
                        label="文本"
                        checked={capabilities.includes('text')}
                        onChange={() => handleToggleCapability(modelName, 'text')}
                      />
                      <Checkbox
                        label="看图"
                        checked={capabilities.includes('multimodal')}
                        onChange={() => handleToggleCapability(modelName, 'multimodal')}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <FormField label="上下文">
                <Input
                  type="number"
                  min={1}
                  value={contextLength}
                  onChange={(event) => setContextLength(event.target.value)}
                  placeholder="128000"
                  className="font-mono"
                />
              </FormField>
              <FormField label="最大输出">
                <Input
                  type="number"
                  min={1}
                  value={maxOutputTokens}
                  onChange={(event) => setMaxOutputTokens(event.target.value)}
                  placeholder="8192"
                  className="font-mono"
                />
              </FormField>
              <FormField label="思考强度">
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
              </FormField>
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
            </div>

            {submitError && <Alert variant="danger" title="未全部添加">{submitError}</Alert>}
            <p className="text-xs leading-relaxed text-muted">
              共用参数会应用到本次所选模型；内部 ID 和显示名称按 modelId 自动生成。
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
