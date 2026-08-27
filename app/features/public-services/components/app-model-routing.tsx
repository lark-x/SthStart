'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { ProviderProfile, PublicServiceOverview } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/app/components/ui/card';
import { Select } from '@/app/components/ui/select';

type AssignmentFormValues = {
  textProfileId: string;
  multimodalProfileId: string;
};

function AssignmentForm({
  app,
  assignment,
  textOptions,
  multimodalOptions,
  onSaveAssignment,
}: {
  app: PublicServiceOverview['apps'][number];
  assignment?: PublicServiceOverview['llmAssignments'][number];
  textOptions: ProviderProfile[];
  multimodalOptions: ProviderProfile[];
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
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col md:flex-row items-start md:items-end justify-between gap-3 p-4 rounded-[3px_14px_3px_3px] border border-[rgb(24_32_29/12%)] bg-[#fffdf8] assignment-card"
    >
      <div className="min-w-[140px]">
        <div className="flex items-center gap-1.5">
          <strong className="text-sm font-semibold text-[#18201d]">{app.name}</strong>
          {app.id === 'linshe' && <span className="system-app-badge">系统</span>}
        </div>
        <code className="text-xs text-[#68716d] block font-mono mt-0.5">{app.id}</code>
      </div>

      <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-[11px] font-semibold text-[#68716d]">
          <span>文本模型</span>
          <Select {...register('textProfileId')} className="mt-1 text-xs">
            <option value="">尚未选择文本模型</option>
            {textOptions.map((profile) => (
              <option value={profile.id} key={profile.id}>
                {profile.name} ({profile.model})
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-[11px] font-semibold text-[#68716d]">
          <span>多模态模型 (图文)</span>
          <Select {...register('multimodalProfileId')} className="mt-1 text-xs">
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
  onSaveAssignment,
}: {
  overview?: PublicServiceOverview | null;
  profiles: ProviderProfile[];
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
        <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">
          APP MODEL ROLE BINDING
        </span>
        <CardTitle>应用角色模型绑定</CardTitle>
        <CardDescription>
          每个接入应用分别绑定文本角色与多模态角色使用的 LLM 模板。系统无全局默认模型；未绑定时调用将直接返回 llm_profile_not_assigned。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
                onSaveAssignment={onSaveAssignment}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
