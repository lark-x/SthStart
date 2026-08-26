'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/app/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/app/components/ui/card';
import { Textarea } from '@/app/components/ui/textarea';

type CreativeFormValues = { jsonText: string };

export function CreativeSettingsForm({
  creative,
  onSubmit,
  onSyncPublicModel,
  loading,
}: {
  creative?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  onSyncPublicModel?: () => Promise<void>;
  loading?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<CreativeFormValues>({
    defaultValues: { jsonText: creative ? JSON.stringify(creative, null, 2) : '{}' },
  });

  useEffect(() => {
    if (creative && !isDirty) {
      // Server-provided configuration hydrates the editor when it changes.
      reset({ jsonText: JSON.stringify(creative, null, 2) });
    }
  }, [creative, isDirty, reset]);

  const handleSave = async (values: CreativeFormValues) => {
    clearErrors('jsonText');
    try {
      const parsed = JSON.parse(values.jsonText) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('配置必须是 JSON 对象');
      }
      await onSubmit(parsed);
      reset(values);
    } catch (e) {
      setError('jsonText', {
        type: 'validate',
        message: e instanceof Error ? e.message : 'JSON 语法错误',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(handleSave)}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">
              CREATIVE WORKFLOW CONFIG
            </span>
            {onSyncPublicModel && (
              <Button type="button" size="sm" variant="outline" onClick={onSyncPublicModel}>
                同步公共模型到邻舍
              </Button>
            )}
          </div>
          <CardTitle>创作扩展与生图参数</CardTitle>
          <CardDescription>
            管理 ComfyUI 工作流映射、提示词前后缀及各生图管线参数。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="creative-json-text" className="block text-xs font-semibold text-[#18201d] mb-1.5">
              JSON 配置结构
            </label>
            <Textarea
              id="creative-json-text"
              rows={12}
              {...register('jsonText', { required: '请输入 JSON 配置' })}
              error={errors.jsonText?.message}
              aria-describedby={errors.jsonText ? 'creative-json-error' : undefined}
              className="bg-[#18201d] p-3 text-xs text-[#dae2de] font-mono leading-relaxed"
              spellCheck={false}
            />
            {errors.jsonText?.message && (
              <p id="creative-json-error" role="alert" className="mt-1.5 text-xs text-[#c9674a] font-medium">
                {errors.jsonText.message}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <span className="text-xs text-[#68716d]">修改将实时写入 runtime.creative 配置</span>
          <Button
            type="submit"
            variant="primary"
            loading={loading || isSubmitting}
            disabled={!isDirty}
          >
            保存创作配置
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
