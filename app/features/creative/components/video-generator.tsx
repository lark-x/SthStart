'use client';

import type { ArtifactDescriptor, CreativeWorkflowBinding } from '@sthstart/contracts';
import { Sparkles } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { InputLabel } from '../input-label';
import { ArtifactPicker } from './artifact-picker';
import { creativeImageAccept, creativeInputMaxBytes, formatByteLimit, type CreativeFormState } from '../types';

export function VideoGenerator({
  form,
  mode,
  binding,
  firstFrameArtifact,
  firstFramePreview,
  lastFrameArtifact,
  lastFramePreview,
  uploading,
  submitting,
  onFormChange,
  onSubmit,
  onFirstFrameSelect,
  onFirstFrameRemove,
  onLastFrameSelect,
  onLastFrameRemove,
}: {
  form: CreativeFormState;
  mode: 'h3-t2v' | 'h3-i2v' | 'h3-fl2va';
  binding?: CreativeWorkflowBinding;
  firstFrameArtifact: ArtifactDescriptor | null;
  firstFramePreview: string | null;
  lastFrameArtifact: ArtifactDescriptor | null;
  lastFramePreview: string | null;
  uploading: boolean;
  submitting: boolean;
  onFormChange: (key: keyof CreativeFormState, value: string) => void;
  onSubmit: () => void;
  onFirstFrameSelect: (file: File | undefined) => void;
  onFirstFrameRemove: () => void;
  onLastFrameSelect: (file: File | undefined) => void;
  onLastFrameRemove: () => void;
}) {
  const ready = Boolean(binding?.ready);
  const needsFirst = mode !== 'h3-t2v';
  const needsLast = mode === 'h3-fl2va';
  const maxDuration = binding?.constraints?.maxDurationSeconds ?? 10;
  const firstFrameMaxBytes = creativeInputMaxBytes(binding, 'firstFrame');
  const lastFrameMaxBytes = creativeInputMaxBytes(binding, 'lastFrame');

  return (
    <div className="space-y-4 rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-5">
      <div className="border-b border-border-subtle pb-3">
        <h3 className="text-base font-semibold text-ink">视频创作配置</h3>
        <p className="text-xs text-muted mt-0.5">配置镜头提示词与画幅参数，提交至视频合成工作流。</p>
      </div>

      <div className="space-y-4">
        <div>
          <InputLabel htmlFor="video-prompt">正向提示词</InputLabel>
          <Textarea
            id="video-prompt"
            className="mt-1.5 min-h-[112px] text-base sm:text-sm"
            value={form.prompt}
            onChange={(event) => onFormChange('prompt', event.target.value)}
            placeholder="描述镜头、主体动作与氛围…"
            maxLength={10000}
          />
        </div>

        {needsFirst && (
          <ArtifactPicker
            id="creative-first-frame"
            label="首帧图片"
            hint={`图片会先安全保存到中央媒体库，最大 ${formatByteLimit(firstFrameMaxBytes)}。和`}
            accept={creativeImageAccept(binding, 'firstFrame')}
            previewUrl={firstFramePreview}
            artifact={firstFrameArtifact}
            uploading={uploading}
            onSelect={onFirstFrameSelect}
            onRemove={onFirstFrameRemove}
          />
        )}

        {needsLast && (
          <ArtifactPicker
            id="creative-last-frame"
            label="尾帧图片"
            hint={`尾帧会与首帧一起提交给 H3 工作流，最大 ${formatByteLimit(lastFrameMaxBytes)}。和`}
            accept={creativeImageAccept(binding, 'lastFrame')}
            previewUrl={lastFramePreview}
            artifact={lastFrameArtifact}
            uploading={uploading}
            onSelect={onLastFrameSelect}
            onRemove={onLastFrameRemove}
          />
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <InputLabel htmlFor="creative-duration">视频时长（秒）</InputLabel>
            <Input
              id="creative-duration"
              className="mt-1.5 text-base sm:text-sm"
              type="number"
              min={1}
              max={maxDuration}
              step={1}
              value={form.duration}
              onChange={(event) => onFormChange('duration', event.target.value)}
            />
          </div>
          <div>
            <InputLabel htmlFor="creative-aspect">画幅比例</InputLabel>
            <Input
              id="creative-aspect"
              className="mt-1.5 text-base sm:text-sm"
              type="text"
              value={form.aspectRatio}
              onChange={(event) => onFormChange('aspectRatio', event.target.value)}
              placeholder="16:9"
            />
          </div>
          <div>
            <InputLabel htmlFor="creative-seed-h3" hint="可选">种子</InputLabel>
            <Input
              id="creative-seed-h3"
              className="mt-1.5 text-base sm:text-sm"
              type="number"
              min={0}
              max={2147483647}
              step={1}
              value={form.seed}
              onChange={(event) => onFormChange('seed', event.target.value)}
              placeholder="随机"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-3 border-t border-border-subtle pt-4 sm:flex-row sm:items-center">
        <div className="flex-1 text-xs text-muted">
          {binding ? (
            <>
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${ready ? 'bg-success' : 'bg-warning'}`} />
              {ready ? `${binding.workflow?.name ?? '已配置'} · ${binding.engine?.name ?? 'Worker'}` : '当前视频模式尚未就绪'}
            </>
          ) : (
            '正在检查公共生成状态…'
          )}
        </div>
        <Button
          variant="accent"
          size="md"
          onClick={onSubmit}
          loading={submitting}
          disabled={!ready || uploading}
          className="font-semibold"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          <span>开始生成</span>
        </Button>
      </div>
    </div>
  );
}
