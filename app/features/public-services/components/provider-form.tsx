'use client';

import React, { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { LlmModelCapability } from '@sthstart/contracts';
import { discoverModels, type LlmDraft } from '../api';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { useToast } from '@/app/providers/ui-provider';

export function ProviderForm({
  draft,
  onReset,
  onSubmit,
  editingId,
  cloneSourceId,
  loading,
}: {
  draft: LlmDraft;
  onReset: () => void;
  onSubmit: (draft: LlmDraft) => Promise<void>;
  editingId: string | null;
  cloneSourceId: string | null;
  loading?: boolean;
}) {
  const toast = useToast();
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setValue,
    control,
    formState: { errors, isDirty },
  } = useForm<LlmDraft>({ defaultValues: draft });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const capabilities = useWatch({ control, name: 'capabilities' }) ?? [];

  useEffect(() => {
    reset(draft);
  }, [draft, reset]);

  const toggleCapability = (cap: LlmModelCapability) => {
    const next = capabilities.includes(cap)
      ? capabilities.filter((item) => item !== cap)
      : [...capabilities, cap];
    setValue('capabilities', next, { shouldDirty: true, shouldValidate: true });
  };

  const handleDiscover = async () => {
    const current = getValues();
    if (!current.baseUrl.trim()) {
      toast.warning('请先填写 API Base URL');
      return;
    }
    setDiscovering(true);
    try {
      const headers = current.headers.trim() ? JSON.parse(current.headers) : {};
      const res = await discoverModels({
        profileId: editingId ?? cloneSourceId ?? undefined,
        baseUrl: current.baseUrl.trim(),
        secret: current.secret || undefined,
        headers,
      });
      setAvailableModels(res.models);
      toast.info(`已获取 ${res.models.length} 个模型`);
    } catch (err) {
      toast.error('模型获取失败', err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <Card className="border-0 bg-surface p-0 shadow-none">
      <form onSubmit={handleSubmit(onSubmit)} className="settings-form llm-editor space-y-4">
        <div className="editor-title hidden">
          <div>
            <h3 className="tpl-section-title">
              {cloneSourceId ? '复制为独立模板' : editingId ? '编辑 LLM 模板' : '添加 LLM 模板'}
            </h3>
          </div>
          {(editingId || cloneSourceId) && (
            <button type="button" className="text-button text-sm text-muted hover:text-ink" onClick={onReset}>
              取消
            </button>
          )}
        </div>

        <div className="form-columns grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-sm font-semibold text-ink">
            <span>配置 ID</span>
            <Input
              {...register('id', {
                required: '请输入配置 ID',
                validate: (value: string) => /^[a-z][a-z0-9-]+$/.test(value) || '配置 ID 格式不正确',
                maxLength: { value: 63, message: '配置 ID 不能超过 63 个字符' },
                setValueAs: (value: string) => value.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, ''),
              })}
              readOnly={Boolean(editingId)}
              placeholder="例如 deepseek-chat"
              aria-invalid={Boolean(errors.id)}
              aria-describedby={errors.id ? 'provider-id-error' : undefined}
              error={errors.id?.message}
              className="mt-1"
            />
            {errors.id?.message && <small id="provider-id-error" role="alert" className="text-sm text-danger">{errors.id.message}</small>}
            <small className="text-sm text-muted block mt-0.5 font-normal">
              以小写字母开头，只能使用小写字母、数字和连字符。
            </small>
          </label>

          <label className="block text-sm font-semibold text-ink">
            <span>显示名称</span>
            <Input
              {...register('name', { required: '请输入显示名称' })}
              placeholder="例如 DeepSeek 对话"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'provider-name-error' : undefined}
              error={errors.name?.message}
              className="mt-1"
            />
            {errors.name?.message && <small id="provider-name-error" role="alert" className="text-sm text-danger">{errors.name.message}</small>}
          </label>

          <label className="block text-sm font-semibold text-ink">
            <span>API Base URL</span>
            <Input
              {...register('baseUrl', { required: '请输入 API Base URL', pattern: { value: /^https?:\/\//, message: '请输入有效的 HTTP(S) 地址' } })}
              type="url"
              placeholder="https://api.example.com/v1"
              aria-invalid={Boolean(errors.baseUrl)}
              aria-describedby={errors.baseUrl ? 'provider-base-url-error' : undefined}
              error={errors.baseUrl?.message}
              className="mt-1"
            />
            {errors.baseUrl?.message && <small id="provider-base-url-error" role="alert" className="text-sm text-danger">{errors.baseUrl.message}</small>}
          </label>

          {!cloneSourceId && (
            <label className="block text-sm font-semibold text-ink">
              <span>API Key</span>
              <Input
                {...register('secret')}
                type="password"
                placeholder={editingId ? '留空表示保持原 Key' : '保存到系统凭据库'}
                autoComplete="new-password"
                className="mt-1"
              />
            </label>
          )}

          <label className="span-two col-span-full block text-sm font-semibold text-ink model-picker-label">
            <span>模型 ID</span>
            <div className="model-picker-row flex gap-2 mt-1">
              <Input
                {...register('model', { required: '请输入模型 ID' })}
                list="public-llm-models"
                placeholder="可获取列表，也可手动输入"
                aria-invalid={Boolean(errors.model)}
                aria-describedby={errors.model ? 'provider-model-error' : undefined}
                error={errors.model?.message}
                className="flex-1"
              />
              {errors.model?.message && (
                <small id="provider-model-error" role="alert" className="text-sm text-danger">
                  {errors.model.message}
                </small>
              )}
              <button
                type="button"
                onClick={handleDiscover}
                disabled={discovering}
                className="min-h-[42px] px-4 rounded-[var(--radius-control)] border border-border-default bg-surface hover:bg-ink/6 text-sm font-medium text-ink cursor-pointer transition-colors"
              >
                {discovering ? '正在获取…' : '获取模型'}
              </button>
            </div>
            <datalist id="public-llm-models">
              {availableModels.map((m) => (
                <option value={m} key={m} />
              ))}
            </datalist>
          </label>

          <label className="block text-sm font-semibold text-ink">
            <span>思考参数</span>
            <Select
              {...register('thinkingMode')}
              className="mt-1"
            >
              <option value="omit">不发送</option>
              <option value="disabled">关闭思考</option>
              <option value="enabled">开启思考</option>
            </Select>
          </label>

          <div className="flex items-center pt-6">
            <label className="inline-check flex items-center gap-2 cursor-pointer text-sm font-medium text-ink">
              <input
                {...register('enabled')}
                type="checkbox"
                className="h-4 w-4 rounded border-border-strong text-accent accent-accent"
              />
              <span>启用此配置</span>
            </label>
          </div>
        </div>

        <fieldset className="capability-picker p-3.5 rounded border border-border-subtle space-y-2">
          <legend className="text-sm font-bold text-muted px-1">模型能力</legend>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={capabilities.includes('text')}
                onChange={() => toggleCapability('text')}
                className="h-4 w-4 accent-accent"
              />
              <span>文本</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={capabilities.includes('multimodal')}
                onChange={() => toggleCapability('multimodal')}
                className="h-4 w-4 accent-accent"
              />
              <span>多模态（文本＋图片输入）</span>
            </label>
          </div>
        </fieldset>

        {!cloneSourceId && (
          <details className="pt-2">
            <summary className="text-sm font-semibold text-muted cursor-pointer hover:text-ink">
              高级请求设置
            </summary>
            <div className="form-columns advanced-fields grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
              <label className="block text-sm text-muted">
                <span>自定义请求头 JSON</span>
                <Textarea
                  {...register('headers')}
                  rows={3}
                  className="mt-1 font-mono text-sm"
                />
              </label>
              <label className="block text-sm text-muted">
                <span>额外请求参数 JSON</span>
                <Textarea
                  {...register('extraBody')}
                  rows={3}
                  className="mt-1 font-mono text-sm"
                />
              </label>
            </div>
          </details>
        )}

        <div className="sticky bottom-0 flex justify-end gap-2 bg-surface py-2">
          <Button variant="ghost" type="button" disabled={loading} onClick={onReset}>取消</Button>
          <Button variant="primary" type="submit" loading={loading}>
            {cloneSourceId ? '创建独立副本' : editingId ? '保存修改' : '保存模板配置'}
          </Button>
        </div>
        {isDirty && <p className="text-right text-sm text-muted">有未保存的修改</p>}
      </form>
    </Card>
  );
}
