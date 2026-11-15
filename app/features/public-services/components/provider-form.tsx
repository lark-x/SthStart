'use client';

import React, { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { LlmModelCapability } from '@sthstart/contracts';
import { discoverModels, type LlmDraft } from '../api';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { FormField } from '@/app/components/ui/form-field';
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
            <Button type="button" variant="ghost" size="sm" onClick={onReset}>
              取消
            </Button>
          )}
        </div>

        <div className="form-columns grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            label="配置 ID"
            required
            error={errors.id?.message}
            hint="以小写字母开头，只能使用小写字母、数字和连字符。"
          >
            <Input
              {...register('id', {
                required: '请输入配置 ID',
                validate: (value: string) => /^[a-z][a-z0-9-]+$/.test(value) || '配置 ID 格式不正确',
                maxLength: { value: 63, message: '配置 ID 不能超过 63 个字符' },
                setValueAs: (value: string) => value.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, ''),
              })}
              readOnly={Boolean(editingId)}
              placeholder="例如 deepseek-chat"
              aria-invalid={Boolean(errors.id) || undefined}
            />
          </FormField>

          <FormField label="显示名称" required error={errors.name?.message}>
            <Input
              {...register('name', { required: '请输入显示名称' })}
              placeholder="例如 DeepSeek 对话"
              aria-invalid={Boolean(errors.name) || undefined}
            />
          </FormField>

          <FormField label="API Base URL" required error={errors.baseUrl?.message}>
            <Input
              {...register('baseUrl', { required: '请输入 API Base URL', pattern: { value: /^https?:\/\//, message: '请输入有效的 HTTP(S) 地址' } })}
              type="url"
              placeholder="https://api.example.com/v1"
              aria-invalid={Boolean(errors.baseUrl) || undefined}
            />
          </FormField>

          {!cloneSourceId && (
            <FormField label="API Key" hint="留空表示保持现有 Key；新 Key 保存到系统凭据库。">
              <Input
                {...register('secret')}
                type="password"
                placeholder={editingId ? '留空表示保持原 Key' : '保存到系统凭据库'}
                autoComplete="new-password"
              />
            </FormField>
          )}

          <div className="span-two col-span-full flex flex-col gap-2 sm:flex-row sm:items-start">
            <FormField
              label="模型 ID"
              required
              error={errors.model?.message}
              hint="可从服务获取列表，也可手动输入。"
              className="min-w-0 flex-1"
            >
              <Input
                {...register('model', { required: '请输入模型 ID' })}
                list="public-llm-models"
                placeholder="可获取列表，也可手动输入"
                aria-invalid={Boolean(errors.model) || undefined}
              />
            </FormField>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="sm:mt-7"
              onClick={handleDiscover}
              loading={discovering}
            >
              {discovering ? '正在获取…' : '获取模型'}
            </Button>
            <datalist id="public-llm-models">
              {availableModels.map((m) => (
                <option value={m} key={m} />
              ))}
            </datalist>
          </div>

          <FormField label="思考参数">
            <Select {...register('thinkingMode')}>
              <option value="omit">不发送</option>
              <option value="disabled">关闭思考</option>
              <option value="enabled">开启思考</option>
            </Select>
          </FormField>

          <div className="flex items-center pt-6">
            <Checkbox label="启用此配置" {...register('enabled')} />
          </div>
        </div>

        <fieldset className="capability-picker p-3.5 rounded border border-border-subtle space-y-2">
          <legend className="text-sm font-semibold text-muted px-1">模型能力</legend>
          <div className="flex gap-6">
            <Checkbox label="文本" checked={capabilities.includes('text')} onChange={() => toggleCapability('text')} />
            <Checkbox label="多模态（文本＋图片输入）" checked={capabilities.includes('multimodal')} onChange={() => toggleCapability('multimodal')} />
          </div>
        </fieldset>

        {!cloneSourceId && (
          <details className="pt-2">
            <summary className="text-sm font-semibold text-muted cursor-pointer hover:text-ink">
              高级请求设置
            </summary>
            <div className="form-columns advanced-fields grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
              <FormField label="自定义请求头 JSON">
                <Textarea {...register('headers')} rows={3} className="font-mono text-sm" />
              </FormField>
              <FormField label="额外请求参数 JSON">
                <Textarea {...register('extraBody')} rows={3} className="font-mono text-sm" />
              </FormField>
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
