'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { RuntimeSettings } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Switch } from '@/app/components/ui/switch';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/app/components/ui/card';

export interface RuntimeFormValues {
  autoStart: boolean;
  autoOpenBrowser: boolean;
  useMirror: boolean;
  publicLlmEnabled: boolean;
  comfyuiExecutable: string;
  extraLoraFolders: string;
  maibotAutostart: boolean;
  maibotBrowserMaibot: boolean;
  maibotBrowserSnowluma: boolean;
}

export function RuntimeSettingsForm({
  initialValues,
  onSubmit,
  loading,
}: {
  initialValues?: RuntimeSettings;
  onSubmit: (values: Partial<RuntimeSettings>) => Promise<void>;
  loading?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { isDirty, isSubmitting },
  } = useForm<RuntimeFormValues>({
    defaultValues: {
      autoStart: initialValues?.autoStart ?? true,
      autoOpenBrowser: initialValues?.autoOpenBrowser ?? true,
      useMirror: initialValues?.useMirror ?? true,
      publicLlmEnabled: initialValues?.publicLlmEnabled ?? false,
      comfyuiExecutable: initialValues?.comfyuiExecutable ?? '',
      extraLoraFolders: initialValues?.extraLoraFolders?.join('\n') ?? '',
      maibotAutostart: initialValues?.maibotAutostart ?? false,
      maibotBrowserMaibot: initialValues?.maibotBrowserMaibot ?? true,
      maibotBrowserSnowluma: initialValues?.maibotBrowserSnowluma ?? false,
    },
  });

  // Only reset from server if user hasn't modified the form
  useEffect(() => {
    if (initialValues && !isDirty) {
      reset({
        autoStart: initialValues.autoStart,
        autoOpenBrowser: initialValues.autoOpenBrowser,
        useMirror: initialValues.useMirror,
        publicLlmEnabled: initialValues.publicLlmEnabled,
        comfyuiExecutable: initialValues.comfyuiExecutable,
        extraLoraFolders: initialValues.extraLoraFolders?.join('\n') ?? '',
        maibotAutostart: initialValues.maibotAutostart,
        maibotBrowserMaibot: initialValues.maibotBrowserMaibot,
        maibotBrowserSnowluma: initialValues.maibotBrowserSnowluma,
      });
    }
  }, [initialValues, isDirty, reset]);

  const onFormSubmit = async (data: RuntimeFormValues) => {
    const payload: Partial<RuntimeSettings> = {
      autoStart: data.autoStart,
      autoOpenBrowser: data.autoOpenBrowser,
      useMirror: data.useMirror,
      publicLlmEnabled: data.publicLlmEnabled,
      comfyuiExecutable: data.comfyuiExecutable.trim(),
      extraLoraFolders: data.extraLoraFolders
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      maibotAutostart: data.maibotAutostart,
      maibotBrowserMaibot: data.maibotBrowserMaibot,
      maibotBrowserSnowluma: data.maibotBrowserSnowluma,
    };
    await onSubmit(payload);
    reset(data);
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">
            STARTUP & NETWORK
          </span>
          <CardTitle>运行参数与自启配置</CardTitle>
          <CardDescription>
            控制 SthStart 启动时是否自动拉起邻舍核心服务，以及镜像下载和公共模型接入模式。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 divide-y divide-[rgb(24_32_29/10%)]">
            <Switch
              label="启动 SthStart 时自动拉起邻舍服务"
              description="包括主服务网关与运行时组件。"
              {...register('autoStart')}
            />
            <Switch
              label="启动后自动打开浏览器"
              description="在默认浏览器中打开门户主页。"
              {...register('autoOpenBrowser')}
            />
            <Switch
              label="启用国内镜像源加速"
              description="模型与依赖拉取时优先使用镜像。"
              {...register('useMirror')}
            />
            <Switch
              label="启用公共大语言模型服务"
              description="将请求路由到在公共服务中配置的 LLM 模型。"
              {...register('publicLlmEnabled')}
            />
          </div>

          <div className="pt-4 border-t border-[rgb(24_32_29/10%)] space-y-4">
            <div>
              <label htmlFor="runtime-comfyui-executable" className="block text-xs font-semibold text-[#18201d] mb-1.5">
                ComfyUI 独立执行路径
              </label>
              <Input
                id="runtime-comfyui-executable"
                placeholder="留空使用默认内部路径，或填写自定义 python/comfyui 脚本路径"
                {...register('comfyuiExecutable')}
              />
              <p className="mt-1 text-[11px] text-[#68716d]">
                若使用已有 ComfyUI 环境，可在此指定绝对路径。
              </p>
            </div>

            <div>
              <label htmlFor="runtime-extra-lora-folders" className="block text-xs font-semibold text-[#18201d] mb-1.5">
                额外 LoRA 模型目录（每行一个）
              </label>
              <Textarea
                id="runtime-extra-lora-folders"
                rows={3}
                className="font-mono text-xs"
                placeholder="/path/to/custom/loras"
                {...register('extraLoraFolders')}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[rgb(24_32_29/10%)] space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#68716d]">
              MAIBOT 辅助生态
            </h4>
            <Switch
              label="同时启动 MaiBot 机器人"
              description="可选生态扩展服务。"
              {...register('maibotAutostart')}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-4">
              <Checkbox label="MaiBot 网页控制台" {...register('maibotBrowserMaibot')} />
              <Checkbox label="SnowLuma 视图" {...register('maibotBrowserSnowluma')} />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <div className="text-xs text-[#68716d]">
            {isDirty ? '有未保存的修改' : '所有修改已与系统同步'}
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting || loading}
            disabled={!isDirty}
          >
            保存运行配置
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
