'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchGenerationWorkflows } from '@/app/features/generation/api';
import { fetchCreativeArtifacts } from '@/app/features/creative/api';
import { Select } from '@/app/components/ui/select';
import { Input } from '@/app/components/ui/input';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';

export type CreativeMediaSettings = {
  workflowId: string;
  workflowVersion: number;
  inputs: Record<string, unknown>;
  references: { artifactId: string; inputKey: string }[];
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const labels: Record<string, string> = {
  width: '图片宽度',
  height: '图片高度',
  steps: '生成步数',
  seed: '随机种子',
  cfg: '提示词引导',
  guidance: '提示词引导',
  batch_size: '图片数量',
  image: '参考图片',
  sourceImage: '参考图片',
  reference_image: '参考图片',
  denoise: '重绘程度',
};

export function MediaSettings({
  value,
  onChange,
}: {
  value: CreativeMediaSettings | null;
  onChange: (value: CreativeMediaSettings | null) => void;
}) {
  const workflows = useQuery({ queryKey: ['generation', 'workflows'], queryFn: fetchGenerationWorkflows });
  const artifacts = useQuery({
    queryKey: ['creative-orchestration', 'media-references'],
    queryFn: () => fetchCreativeArtifacts(),
    staleTime: 30000,
  });
  const versions = (workflows.data ?? []).flatMap((workflow) =>
    workflow.archivedAt
      ? []
      : workflow.versions
          .filter((version) => version.isPublished && (version.category ?? workflow.category) === 'image')
          .map((version) => ({ workflow, version })),
  );
  const selected = versions.find(
    (item) => item.workflow.id === value?.workflowId && item.version.version === value.workflowVersion,
  );
  const schema = selected?.version.inputSchema ?? {};
  const capabilities = selected?.version.inputCapabilities ?? {};
  const fields = Object.entries({ ...schema, ...capabilities }).map(([key, item]) => ({
    key,
    spec: { ...record(schema[key]), ...record(item) },
  }));
  const promptField = (key: string, spec: Record<string, unknown>) =>
    ['positive_prompt', 'negative_prompt'].includes(String(spec.semantic)) ||
    /^(prompt|positivePrompt|positive_prompt|positive|negativePrompt|negative_prompt|negative)$/.test(key);
  const imageFields = fields.filter(
    ({ key, spec }) =>
      [
        'image',
        'reference_image',
        'source_image',
        'init_image',
        'reference_image_primary',
        'mask_image',
      ].includes(String(spec.semantic)) ||
      ['image', 'file', 'artifact'].includes(String(spec.type)) ||
      (Array.isArray(spec.mediaTypes) && spec.mediaTypes.some((type) => String(type).startsWith('image/'))) ||
      /image/i.test(key),
  );
  const ordinaryFields = fields.filter(
    (field) =>
      !promptField(field.key, field.spec) &&
      !imageFields.includes(field) &&
      ['string', 'number', 'integer', 'boolean'].includes(String(field.spec.type)),
  );
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 font-medium">图片生成方案</legend>
      <label className="co-field">
        已发布图片方案
        <Select
          required
          value={value ? `${value.workflowId}::${value.workflowVersion}` : ''}
          onChange={(event) => {
            const next = versions.find(
              (item) => `${item.workflow.id}::${item.version.version}` === event.target.value,
            );
            if (!next) return onChange(null);
            const inputs = Object.fromEntries(
              Object.entries(next.version.inputSchema).flatMap(([key, spec]) =>
                record(spec).default === undefined ? [] : [[key, record(spec).default]],
              ),
            );
            onChange({
              workflowId: next.workflow.id,
              workflowVersion: next.version.version,
              inputs,
              references: [],
            });
          }}
        >
          <option value="">选择公共生成中已发布的图片方案</option>
          {versions.map((item) => (
            <option
              key={`${item.workflow.id}-${item.version.version}`}
              value={`${item.workflow.id}::${item.version.version}`}
            >
              {item.workflow.name} · 第 {item.version.version} 版
            </option>
          ))}
        </Select>
      </label>
      {(workflows.error || artifacts.error) && (
        <Alert variant="danger">{workflows.error?.message || artifacts.error?.message}</Alert>
      )}
      {value && !selected && <Alert variant="warning">原图片方案已不可用，请重新选择。</Alert>}
      {versions.length === 0 && !workflows.isPending && (
        <p className="text-sm text-muted">
          暂无已发布图片方案。
          <Link className="ml-1 text-accent underline" href="/settings/public-services?section=generation">
            配置公共生成服务
          </Link>
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted">
        提示词由流程中的提示词岗位生成，以下参数使用该图片方案的真实输入定义。
      </p>
      {value && ordinaryFields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {ordinaryFields.map(({ key, spec }) => {
            const label = String(spec.label ?? spec.title ?? labels[key] ?? key);
            const current = value.inputs[key] ?? '';
            const set = (input: unknown) => onChange({ ...value, inputs: { ...value.inputs, [key]: input } });
            if (spec.type === 'boolean')
              return (
                <Checkbox
                  key={key}
                  label={label}
                  checked={current === true}
                  onChange={(event) => set(event.target.checked)}
                />
              );
            if (Array.isArray(spec.enum))
              return (
                <label key={key} className="co-field">
                  {label}
                  <Select
                    value={String(current)}
                    required={spec.required === true}
                    onChange={(event) =>
                      set(
                        (spec.enum as unknown[]).find((option) => String(option) === event.target.value) ??
                          event.target.value,
                      )
                    }
                  >
                    <option value="">使用方案默认值</option>
                    {spec.enum.map((option) => (
                      <option key={String(option)} value={String(option)}>
                        {String(option)}
                      </option>
                    ))}
                  </Select>
                </label>
              );
            return (
              <label key={key} className="co-field">
                {label}
                <Input
                  type={spec.type === 'string' ? 'text' : 'number'}
                  required={spec.required === true}
                  min={typeof spec.minimum === 'number' ? spec.minimum : undefined}
                  max={typeof spec.maximum === 'number' ? spec.maximum : undefined}
                  step={spec.type === 'integer' ? 1 : 'any'}
                  value={String(current)}
                  onChange={(event) =>
                    set(
                      spec.type === 'string' || event.target.value === ''
                        ? event.target.value
                        : Number(event.target.value),
                    )
                  }
                />
              </label>
            );
          })}
        </div>
      )}
      {value &&
        imageFields.map(({ key, spec }) => (
          <label key={key} className="co-field">
            {String(spec.label ?? spec.title ?? labels[key] ?? key)}
            <Select
              value={value.references.find((item) => item.inputKey === key)?.artifactId ?? ''}
              required={spec.required === true}
              onChange={(event) =>
                onChange({
                  ...value,
                  references: [
                    ...value.references.filter((item) => item.inputKey !== key),
                    ...(event.target.value ? [{ inputKey: key, artifactId: event.target.value }] : []),
                  ],
                })
              }
            >
              <option value="">不使用参考图</option>
              {artifacts.data?.items
                .filter((item) => item.contentType?.startsWith('image/') || item.mediaType === 'image')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.originalName || item.id}
                  </option>
                ))}
            </Select>
          </label>
        ))}
      {imageFields.length > 0 && (
        <p className="text-xs text-muted">显示最近 100 项媒体中的图片；使用前服务端会检查引用授权。</p>
      )}
      {workflows.isError && (
        <Button size="sm" onClick={() => void workflows.refetch()}>
          重新读取图片方案
        </Button>
      )}
    </fieldset>
  );
}
