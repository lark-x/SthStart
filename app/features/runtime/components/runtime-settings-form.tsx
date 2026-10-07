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
  linsheImageViaGateway: boolean;
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
      linsheImageViaGateway: initialValues?.linsheImageViaGateway ?? false,
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
        linsheImageViaGateway: initialValues.linsheImageViaGateway,
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
      linsheImageViaGateway: data.linsheImageViaGateway,
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
          <CardTitle>运行参数与自启配置</CardTitle>
          <CardDescription>
            控制 SthStart 启动时是否自动拉起邻舍核心服务，以及镜像下载和本地辅助服务。
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
              label="邻舍生图使用 SthStart 公共网关"
              description="关闭时邻舍直连自己的 ComfyUI；其生图不会进入 SthStart 的生成队列与 AI 调用日志。启用前必须先为邻舍绑定 linshe-chat-image 已发布的图片工作流。"
              {...register('linsheImageViaGateway')}
            />
          </div>

          <div className="rounded border border-accent/25 bg-accent/10 px-3.5 py-3 text-sm text-ink">
            本项目管理的邻舍始终通过 SthStart 公共网关使用 LLM 与向量服务；生图是否走公共网关由上方开关决定。启动前会检查应用令牌与模型路由，仅在生图开关打开时检查图片用途绑定；配置不足时会列出需要补齐的项目。
          </div>

          <div className="pt-4 border-t border-border-subtle space-y-4">
            <div>
              <label htmlFor="runtime-comfyui-executable" className="block text-sm font-semibold text-ink mb-1.5">
                ComfyUI 独立执行路径
              </label>
              <Input
                id="runtime-comfyui-executable"
                placeholder="留空使用默认内部路径，或填写自定义 python/comfyui 脚本路径"
                {...register('comfyuiExecutable')}
              />
              <p className="mt-1 text-sm text-muted">
                若使用已有 ComfyUI 环境，可在此指定绝对路径。
              </p>
            </div>

            <div>
              <label htmlFor="runtime-extra-lora-folders" className="block text-sm font-semibold text-ink mb-1.5">
                额外 LoRA 模型目录（每行一个）
              </label>
              <Textarea
                id="runtime-extra-lora-folders"
                rows={3}
                className="font-mono text-sm"
                placeholder="/path/to/custom/loras"
                {...register('extraLoraFolders')}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-border-subtle space-y-3">
            <h4 className="text-sm font-bold uppercase tracking-wider text-muted">
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
          <div className="text-sm text-muted">
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
