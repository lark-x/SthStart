'use client';

import { useRef } from 'react';
import type { ContentDocument, PromptRecipe, PromptCompilation, SourceRef, SlotImageConfig } from '@sthstart/contracts';
import { Image as ImageIcon, Play, Sparkles, Upload } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { Textarea } from '@/app/components/ui/textarea';
import { ImagePromptOverride } from '@/app/features/generation/components/image-prompt-override';
import { PromptSourcePanel } from '../../components/prompt-source-panel';
import { StructuredDirectorControls, VisualParameterFields } from '../../components/visual-settings-controls';
import type { ImageConfigEditorState } from '../types';
import type { ImageGenerationState } from '../hooks/use-image-generation';

type ImageGenerationPanelProps = {
  advanced: boolean;
  activityId: string;
  currentContentRevisionId?: string;
  activeSlot: ContentDocument['mediaSlots'][number] | undefined;
  config: ImageConfigEditorState;
  generation: ImageGenerationState;
  sourceRecipe: PromptRecipe | null;
  preparedCompilation: PromptCompilation | null;
  executionSnapshots: unknown[];
  onLocateSource(kind: string, id: string, path: string, source: SourceRef | undefined): void;
  onPromptSettingsChange(patch: Partial<SlotImageConfig>): void;
};

export function ImageGenerationPanel({
  advanced,
  activityId,
  currentContentRevisionId,
  activeSlot,
  config,
  generation,
  sourceRecipe,
  preparedCompilation,
  executionSnapshots,
  onLocateSource,
  onPromptSettingsChange,
}: ImageGenerationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSlotConfig = config.activeSlotConfig;

  return (
    <div className={`${advanced ? 'xl:col-span-5' : 'xl:col-span-6'} min-w-0 border-r border-border-default p-4 overflow-y-auto space-y-4 bg-paper`}>
      <div className="flex items-center justify-between pb-2 border-b border-border-default">
        <span className="text-sm font-bold text-muted uppercase tracking-wider">
          绘制设置
        </span>
        <Button
          size="sm"
          className={`${advanced ? '' : 'hidden'} h-7 text-sm bg-accent hover:bg-accent/90 text-paper font-medium`}
          disabled={generation.isPreparing || generation.isDrawing}
          onClick={() => void generation.prepareRecipe()}
        >
          {generation.isPreparing ? (
            <>
              <Spinner className="w-3.5 h-3.5 mr-1" />
              准备编译中...
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 mr-1" />
              准备配方 / 编译
            </>
          )}
        </Button>
      </div>

      <div className="bg-surface/60 border border-border-default rounded-panel p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-muted flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
            单图参考 / 图生图 (I2I)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void generation.uploadReference(file).finally(() => {
                  if (fileInputRef.current) fileInputRef.current.value = '';
                });
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-sm px-2 text-muted"
              onClick={() => fileInputRef.current?.click()}
              disabled={generation.isUploadingReference}
            >
              <Upload className="w-3 h-3 mr-1" />
              上传参考图
            </Button>
            {generation.selectedReferenceKey && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-sm px-1 text-muted hover:text-red-400"
                onClick={() => generation.selectReferenceAsset(null)}
              >
                清除
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="activity-image-reference" className="text-xs font-medium text-muted">已有参考图</label>
          <Select
            id="activity-image-reference"
            value={generation.selectedReferenceKey || ''}
            onChange={(event) => generation.selectReferenceAsset(event.target.value || null)}
            className="text-sm"
          >
            <option value="">不使用参考图</option>
            {generation.assets.filter((asset) => asset.type === 'image').map((asset) => (
              <option key={asset.assetKey} value={asset.assetKey}>{asset.assetKey}</option>
            ))}
          </Select>
        </div>

        {generation.characterReferences.length > 0 && (
          <div className="space-y-1.5 rounded border border-accent/20 bg-accent/5 p-2">
            <p className="text-xs font-semibold text-accent-dark">公共角色参考图（先转入活动再参与生成）</p>
            {generation.characterReferences.map((reference) => (
              <div key={`${reference.characterId}:${reference.referenceId}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted">{reference.characterName} · {reference.referenceId.slice(0, 8)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={Boolean(generation.transferringReference)}
                  onClick={() => void generation.transferCharacterReference(reference)}
                >
                  {generation.transferringReference === reference.referenceId ? '转入中…' : '转入并选择'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {generation.selectedReferenceKey ? (
          <div className="flex items-center gap-3 bg-paper p-2 rounded border border-border-default">
            <div className="w-12 h-12 rounded bg-surface border border-border-default overflow-hidden flex items-center justify-center flex-shrink-0">
              <span className="text-sm text-muted font-mono">
                {generation.selectedReferenceKey.slice(0, 6)}
              </span>
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-mono text-muted">{generation.selectedReferenceKey}</span>
                <div className="flex items-center gap-1.5">
                  <label htmlFor="activity-image-reference-role" className="text-xs text-muted">参考用途</label>
                  <Select
                    id="activity-image-reference-role"
                    value={generation.referenceRole}
                    onChange={(event) => generation.setReferenceRole(event.target.value as typeof generation.referenceRole)}
                    className="text-sm"
                  >
                    <option value="init_image">图生图 (init_image)</option>
                    <option value="identity">人物参考 (identity)</option>
                    <option value="outfit">服装参考 (outfit)</option>
                    <option value="style">风格参考 (style)</option>
                  </Select>
                </div>
              </div>
              {advanced && generation.referenceRole === 'init_image' && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span>重绘幅度: {generation.denoise}</span>
                  <input
                    type="range"
                    min="0.1"
                    max="0.95"
                    step="0.05"
                    value={generation.denoise}
                    onChange={(event) => generation.setDenoise(parseFloat(event.target.value))}
                    className="flex-1 h-1 bg-surface-muted rounded accent-sky-500"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">
            未选择参考图，将使用纯文本提示词进行文生图 (T2I)
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="activity-image-supplement-prompt" className="text-sm text-ink">补充画面要求</label>
        <Textarea
          id="activity-image-supplement-prompt"
          rows={3}
          value={activeSlotConfig.supplementPrompt ?? ''}
          onChange={(event) => config.updateSlotConfig({ supplementPrompt: event.target.value })}
          placeholder="补充动作、构图与氛围，角色和场景会自动带入。"
        />
      </div>
      <ImagePromptOverride
        advanced={advanced}
        finalPositivePrompt={activeSlotConfig.finalPositivePrompt}
        promptOptimization={activeSlotConfig.promptOptimization}
        finalSupported={config.visualPreview?.promptAssembly === 'service-finalized-v1'}
        sourcePrompt={config.visualPreview?.positivePrompt ?? ''}
        effectiveAI={config.visualPreview?.promptOptimization?.enabled ?? true}
        disabled={generation.isDrawing}
        onChange={(patch) => onPromptSettingsChange(patch)}
      />
      <div className={`${advanced ? '' : 'hidden'} bg-surface/40 border border-border-default rounded-panel p-3`}>
        <PromptSourcePanel
          activityId={activityId}
          blocks={sourceRecipe?.blocks || []}
          sourceRefs={sourceRecipe?.sourceRefs || []}
          onLocateSource={(kind, id, path) => {
            const source = sourceRecipe?.sourceRefs.find((refItem) => refItem.entityKind === kind && refItem.entityId === id && refItem.fieldPath === path);
            onLocateSource(kind, id, path, source);
          }}
        />
      </div>

      <div className="bg-surface/60 border border-border-default rounded-lg p-3 space-y-2.5">
        {!activeSlotConfig.presetId && !activeSlotConfig.workflowId && (
          <div className="space-y-1">
            <label htmlFor="activity-image-quality" className="text-sm text-muted">生成档位</label>
            <Select
              id="activity-image-quality"
              className="text-sm"
              value={activeSlotConfig.quality ?? ''}
              onChange={(event) => config.updateSlotConfig({ quality: event.target.value ? event.target.value as 'draft' | 'final' : undefined })}
            >
              <option value="">继承活动品质</option>
              <option value="draft">草图</option>
              <option value="final">成稿</option>
            </Select>
          </div>
        )}
        <StructuredDirectorControls
          value={activeSlotConfig.director}
          onChange={(director) => config.updateSlotConfig({ director })}
        />
        {advanced && config.visualPreview && (
          <VisualParameterFields
            key={`${activeSlot?.id}:${config.visualPreview.workflowId}:${config.visualPreview.workflowVersion}`}
            recoveryKey={`sthstart:visual-input:slot:${activityId}:${activeSlot?.id}:${config.visualPreview.workflowId}:${config.visualPreview.workflowVersion}`}
            fields={config.visualPreview.fields}
            values={activeSlotConfig.params ?? {}}
            onChange={(params) => config.updateSlotConfig({ params })}
            onValidityChange={config.setParametersValid}
          />
        )}
        <div className="space-y-1.5">
          <label htmlFor="activity-image-generation-preset" className="text-sm text-muted font-medium">生成方案</label>
          <Select
            id="activity-image-generation-preset"
            value={generation.selectedGenerationPreset ? generation.selectedGenerationPreset.id : ''}
            onChange={(event) => generation.handlePresetChange(event.target.value)}
            className="text-sm"
          >
            <option value="">沿用活动默认配置</option>
            {generation.generationPresetOptions.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}{advanced ? ` · ${preset.workflowId} v${preset.workflowVersion}` : ''}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">
            {generation.selectedGenerationPreset
              ? `本次固定使用「${generation.selectedGenerationPreset.name}」及其模型、采样参数。`
              : generation.generationPresetsLoading
                ? '正在读取可用预设…'
                : generation.generationPresetOptions.length
                  ? '不选预设时沿用活动当前默认；选择 Base/Turbo 只影响本次，不会改动全局默认。'
                  : '当前用途没有可选预设；不选时仍沿用活动当前默认配置。'}
          </p>
        </div>
        <div className={`${advanced ? 'flex' : 'hidden'} items-center justify-between text-sm`}>
          <span className="text-muted font-medium">随机种子 (Seed)</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-sm px-2 text-muted hover:text-ink"
              onClick={() => generation.setSeed(-1)}
            >
              随机 (-1)
            </Button>
            <Input
              type="number"
              value={generation.seed}
              onChange={(event) => generation.setSeed(event.target.value === '' ? -1 : Number(event.target.value))}
              className="w-32 h-6 bg-paper text-sm font-mono"
            />
          </div>
        </div>

        {advanced && preparedCompilation && (
          <div className="text-sm space-y-2">
            <p>{preparedCompilation.executionPlan ? `工作流 ${preparedCompilation.executionPlan.workflowId} v${preparedCompilation.executionPlan.workflowVersion} · 引擎 ${preparedCompilation.executionPlan.engineId}` : '尚未分配可执行工作流；配置后需要重新准备。'}</p>
            <details>
              <summary>将提交的完整提示词与有效参数</summary>
              <pre className="whitespace-pre-wrap break-words max-h-60 overflow-auto">
                {JSON.stringify({ channels: preparedCompilation.channels, parameters: preparedCompilation.effectiveParams, references: generation.preparedRecipe?.references }, null, 2)}
              </pre>
            </details>
            {!!executionSnapshots.length && (
              <details>
                <summary>所选历史图片的实际执行快照</summary>
                <pre className="whitespace-pre-wrap break-words max-h-60 overflow-auto">{JSON.stringify(executionSnapshots, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
        {advanced && preparedCompilation && (
          <div className="text-sm text-muted font-mono flex items-center justify-between pt-1 border-t border-border-default">
            <span>执行计划哈希:</span>
            <span className="text-sky-400">{preparedCompilation.executionPlanHash.slice(0, 16)}...</span>
          </div>
        )}

        <Button
          variant="primary"
          className="w-full font-semibold h-9 mt-2"
          disabled={generation.isDrawing || !activeSlot || !currentContentRevisionId}
          onClick={() => void generation.draw()}
        >
          {generation.isDrawing ? (
            <>
              <Spinner className="w-4 h-4 mr-2" />
              提交生成任务中...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              绘制新图
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
