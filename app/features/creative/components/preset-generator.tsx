'use client';

import type { ArtifactDescriptor } from '@sthstart/contracts';
import { Sparkles } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Select } from '@/app/components/ui/select';
import { SchemaForm } from './schema-form';
import { ArtifactPicker } from './artifact-picker';
import { creativeImageAccept, creativeInputMaxBytes, formatByteLimit } from '../types';
import type { CreativePurposeOptions } from '@/app/features/generation/types';

/**
 * 预设生成卡片（规划 §10.1）：第一行工作流选择 → 预设选择；
 * 模型仅在当前配置允许单独调整时展示，否则显示预设中的模型组合摘要。
 */

export function PresetGenerator({
  mode,
  options,
  selectedWorkflowId,
  selectedPresetId,
  values,
  sourceArtifact,
  sourcePreview,
  uploading,
  submitting,
  onWorkflowChange,
  onPresetChange,
  onValueChange,
  onSubmit,
  onSourceSelect,
  onSourceRemove,
}: {
  mode: 'text-to-image' | 'image-to-image';
  options: CreativePurposeOptions;
  selectedWorkflowId: string;
  selectedPresetId: string;
  values: Record<string, unknown>;
  sourceArtifact: ArtifactDescriptor | null;
  sourcePreview: string | null;
  uploading: boolean;
  submitting: boolean;
  onWorkflowChange: (workflowId: string) => void;
  onPresetChange: (presetId: string) => void;
  onValueChange: (key: string, value: unknown) => void;
  onSubmit: () => void;
  onSourceSelect: (file: File | undefined) => void;
  onSourceRemove: () => void;
}) {
  const distinctWorkflows = [...new Set(options.presets.map((preset) => preset.workflowId))];
  const presetsOfWorkflow = options.presets.filter((preset) => preset.workflowId === selectedWorkflowId);
  const selectedPreset = presetsOfWorkflow.find((preset) => preset.id === selectedPresetId);
  const workflowNameOf = (workflowId: string) => options.presets.find((preset) => preset.workflowId === workflowId)?.workflowName ?? workflowId;
  const modelField = options.fields.find((field) => field.type === 'model');
  const modelChoices = options.modelChoices ?? [];
  const modelValue = modelField ? values[modelField.key] : undefined;
  const modelSummary = (() => {
    const modelEntries = options.fields
      .filter((field) => field.type === 'model')
      .map((field) => {
        const fromPreset = selectedPreset?.values[field.key];
        const current = modelField && field.key === modelField.key ? modelValue : fromPreset ?? values[field.key];
        return current ? String(current) : null;
      })
      .filter(Boolean);
    return modelEntries.length ? modelEntries.join(' + ') : null;
  })();

  return (
    <Card>
      <CardHeader><CardTitle>图片创作</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="preset-workflow-select" className="mb-1 block text-sm font-medium text-ink">工作流</label>
            <Select id="preset-workflow-select" value={selectedWorkflowId} onChange={(event) => onWorkflowChange(event.target.value)}>
              {distinctWorkflows.map((workflowId) => (
                <option key={workflowId} value={workflowId}>{workflowNameOf(workflowId)}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="preset-preset-select" className="mb-1 block text-sm font-medium text-ink">预设</label>
            <Select id="preset-preset-select" value={selectedPresetId} onChange={(event) => onPresetChange(event.target.value)}>
              {presetsOfWorkflow.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}{preset.isDefault ? '（默认）' : ''}</option>
              ))}
            </Select>
          </div>
        </div>

        {modelField && modelChoices.length > 0 ? (
          <div>
            <label htmlFor="preset-model-select" className="mb-1 block text-sm font-medium text-ink">主模型</label>
            <Select id="preset-model-select" value={modelValue == null ? '' : String(modelValue)} onChange={(event) => onValueChange(modelField.key, event.target.value || undefined)}>
              <option value="">（使用预设/默认）</option>
              {modelChoices.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </Select>
            {options.modelChoicesStale && <p className="mt-1 text-sm text-warning-fg">模型列表来自过期缓存，请刷新后再选择。</p>}
          </div>
        ) : modelSummary ? (
          <p className="rounded-[var(--radius-control)] bg-ink/4 px-3 py-2 text-sm text-muted">模型组合：{modelSummary}（随预设成套切换）</p>
        ) : null}

        <SchemaForm
          fields={options.fields}
          idPrefix="preset-field"
          values={values}
          onValueChange={onValueChange}
        />

        {mode === 'image-to-image' && (
          <ArtifactPicker
            id="preset-source"
            label="参考图片"
            hint={`图片会先安全保存到中央媒体库，最大 ${formatByteLimit(creativeInputMaxBytes(undefined, 'sourceImage'))}。`}
            accept={creativeImageAccept(undefined, 'sourceImage')}
            previewUrl={sourcePreview}
            artifact={sourceArtifact}
            uploading={uploading}
            onSelect={onSourceSelect}
            onRemove={onSourceRemove}
          />
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 text-sm text-muted">
          {options.ready ? `${options.workflow?.name ?? '已配置'} · ${options.engine?.name ?? 'ComfyUI'}` : '当前模式尚未就绪'}
        </div>
        <Button variant="accent" size="md" onClick={onSubmit} loading={submitting} disabled={!options.ready || uploading}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />开始生成
        </Button>
      </CardFooter>
    </Card>
  );
}
