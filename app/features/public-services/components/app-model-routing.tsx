'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import type { ProviderProfile, PublicServiceOverview } from '@sthstart/contracts';
import type { LlmBindingStatus } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/app/components/ui/card';
import { Select } from '@/app/components/ui/select';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useAppLlmStatus } from '../queries';

type AssignmentFormValues = {
  textProfileId: string;
  multimodalProfileId: string;
};

function statusTone(status: LlmBindingStatus['status']) {
  if (status === 'ready') return { color: 'text-green-700', Icon: CheckCircle2 };
  if (status === 'unassigned') return { color: 'text-amber-700', Icon: AlertCircle };
  return { color: 'text-red-700', Icon: XCircle };
}

/** 应用单角色状态：ready 显示模型名，未就绪显示具体原因，不把失败折叠成「未配置」。 */
function RoleStatusLine({ appId, role, label }: { appId: string; role: 'text' | 'multimodal'; label: string }) {
  const { data, isLoading, isError, refetch } = useAppLlmStatus(appId);
  if (isLoading) return <Skeleton className="h-4 w-40" />;
  if (isError || !data) {
    return (
      <button type="button" onClick={() => void refetch()} className="flex items-center gap-1 text-xs text-muted underline decoration-dotted">
        暂时无法确认{label}模型配置，点击重试
      </button>
    );
  }
  const status = data[role];
  const { color, Icon } = statusTone(status.status);
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${color}`} title={status.message ?? undefined}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}：{status.ready ? `${status.profile?.name ?? ''}${status.profile?.model ? ` / ${status.profile.model}` : ''}` : status.message || '未就绪'}
    </span>
  );
}

function AssignmentForm({
  app,
  assignment,
  textOptions,
  multimodalOptions,
  highlighted,
  onSaveAssignment,
}: {
  app: PublicServiceOverview['apps'][number];
  assignment?: PublicServiceOverview['llmAssignments'][number];
  textOptions: ProviderProfile[];
  multimodalOptions: ProviderProfile[];
  highlighted?: boolean;
  onSaveAssignment: (
    appId: string,
    assignments: { textProfileId: string | null; multimodalProfileId: string | null }
  ) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { isDirty, isSubmitting },
  } = useForm<AssignmentFormValues>({
    defaultValues: {
      textProfileId: assignment?.textProfileId ?? '',
      multimodalProfileId: assignment?.multimodalProfileId ?? '',
    },
  });

  useEffect(() => {
    if (!isDirty) {
      reset({
        textProfileId: assignment?.textProfileId ?? '',
        multimodalProfileId: assignment?.multimodalProfileId ?? '',
      });
    }
  }, [assignment, isDirty, reset]);

  const onSubmit = async (values: AssignmentFormValues) => {
    await onSaveAssignment(app.id, {
      textProfileId: values.textProfileId || null,
      multimodalProfileId: values.multimodalProfileId || null,
    });
    reset(values);
  };

  return (
    <form
      id={`app-row-${app.id}`}
      onSubmit={handleSubmit(onSubmit)}
      className={`flex flex-col md:flex-row items-start md:items-end justify-between gap-3 p-4 rounded-[var(--radius-panel)] border bg-surface assignment-card transition-shadow ${
        highlighted ? 'border-accent ring-2 ring-accent' : 'border-border-subtle'
      }`}
    >
      <div className="min-w-[140px] space-y-1">
        <div className="flex items-center gap-1.5">
          <strong className="text-sm font-semibold text-ink">{app.name}</strong>
          {app.id === 'linshe' && <span className="system-app-badge">系统</span>}
        </div>
        <code className="text-sm text-muted block font-mono">{app.id}</code>
        <div className="flex flex-col gap-0.5 pt-1">
          <RoleStatusLine appId={app.id} role="text" label="文本" />
          <RoleStatusLine appId={app.id} role="multimodal" label="图文" />
        </div>
      </div>

      <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm font-semibold text-muted">
          <span>文本模型</span>
          <Select {...register('textProfileId')} className="mt-1 text-sm">
            <option value="">尚未选择文本模型</option>
            {textOptions.map((profile) => (
              <option value={profile.id} key={profile.id}>
                {profile.name} ({profile.model})
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-sm font-semibold text-muted">
          <span>多模态模型 (图文)</span>
          <Select {...register('multimodalProfileId')} className="mt-1 text-sm">
            <option value="">尚未选择多模态模型</option>
            {multimodalOptions.map((profile) => (
              <option value={profile.id} key={profile.id}>
                {profile.name} ({profile.model})
              </option>
            ))}
          </Select>
        </label>
      </div>

      <Button
        size="md"
        variant="primary"
        type="submit"
        className="flex-shrink-0 w-full md:w-auto"
        loading={isSubmitting}
        disabled={!isDirty}
      >
        保存应用选择
      </Button>
    </form>
  );
}

export function AppModelRouting({
  overview,
  profiles,
  highlightAppId,
  appNotFound = false,
  onSaveAssignment,
}: {
  overview?: PublicServiceOverview | null;
  profiles: ProviderProfile[];
  highlightAppId?: string | null;
  appNotFound?: boolean;
  onSaveAssignment: (
    appId: string,
    assignments: { textProfileId: string | null; multimodalProfileId: string | null }
  ) => Promise<void>;
}) {
  const textOptions = profiles.filter((p) => p.enabled && p.capabilities.includes('text'));
  const multimodalOptions = profiles.filter(
    (p) => p.enabled && p.capabilities.includes('multimodal')
  );

  return (
    <Card id="app-model-routing">
      <CardHeader>
        <CardTitle>应用角色模型绑定</CardTitle>
        <CardDescription>
          每个接入应用分别绑定文本角色与多模态角色使用的 LLM 模板。系统没有全局默认模型；未绑定的应用在调用生成功能前需要先在此完成选择。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {appNotFound && (
          <Alert variant="warning" title="未找到目标应用">
            链接指向的应用不存在或已被移除。下面是当前全部可绑定应用。
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-3 assignment-grid">
          {overview?.apps.filter((app) => app.capabilities.includes('llm')).map((app) => {
            const assignment = overview.llmAssignments.find((item) => item.appId === app.id);

            return (
              <AssignmentForm
                key={app.id}
                app={app}
                assignment={assignment}
                textOptions={textOptions}
                multimodalOptions={multimodalOptions}
                highlighted={highlightAppId === app.id}
                onSaveAssignment={onSaveAssignment}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
