'use client';

import type { ArtifactDescriptor, CreativeWorkflowBinding } from '@sthstart/contracts';
import { ImagePlus, Sparkles } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
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
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-[#b83b1b]">{needsFirst ? <ImagePlus className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}<span className="text-[10px] font-bold tracking-[0.16em] uppercase">MAKE A VIDEO</span></div>
        <CardTitle>开始一次视频创作</CardTitle>
        <CardDescription>视频任务由 SthStart 公共生成核心异步执行；Worker 与工作流由管理端绑定。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <InputLabel htmlFor="video-prompt">正向提示词</InputLabel>
          <Textarea id="video-prompt" className="mt-1.5 min-h-[112px]" value={form.prompt} onChange={(event) => onFormChange('prompt', event.target.value)} placeholder="描述镜头、主体动作与氛围…" maxLength={10000} />
        </div>
        {needsFirst && (
          <ArtifactPicker
            id="creative-first-frame"
            label="首帧图片"
            hint={`图片会先安全保存到中央媒体库，最大 ${formatByteLimit(firstFrameMaxBytes)}。`}
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
            hint={`尾帧会与首帧一起提交给 H3 工作流，最大 ${formatByteLimit(lastFrameMaxBytes)}。`}
            accept={creativeImageAccept(binding, 'lastFrame')}
            previewUrl={lastFramePreview}
            artifact={lastFrameArtifact}
            uploading={uploading}
            onSelect={onLastFrameSelect}
            onRemove={onLastFrameRemove}
          />
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div><InputLabel htmlFor="creative-duration">视频时长（秒）</InputLabel><Input id="creative-duration" className="mt-1.5" type="number" min={1} max={maxDuration} step={1} value={form.duration} onChange={(event) => onFormChange('duration', event.target.value)} /></div>
          <div><InputLabel htmlFor="creative-aspect">画幅比例</InputLabel><Input id="creative-aspect" className="mt-1.5" type="text" value={form.aspectRatio} onChange={(event) => onFormChange('aspectRatio', event.target.value)} placeholder="16:9" /></div>
          <div><InputLabel htmlFor="creative-seed-h3" hint="可选">种子</InputLabel><Input id="creative-seed-h3" className="mt-1.5" type="number" min={0} max={2147483647} step={1} value={form.seed} onChange={(event) => onFormChange('seed', event.target.value)} placeholder="随机" /></div>
        </div>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 text-xs text-[#68716d]">{binding ? <><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${ready ? 'bg-[#4e9b6b]' : 'bg-[#d0a731]'}`} />{ready ? `${binding.workflow?.name ?? '已配置'} · ${binding.engine?.name ?? 'Worker'}` : '当前视频模式尚未就绪'}</> : '正在检查公共生成状态…'}</div>
        <Button variant="accent" size="lg" onClick={onSubmit} loading={submitting} disabled={!ready || uploading}><Sparkles className="h-4 w-4" aria-hidden="true" />开始生成</Button>
      </CardFooter>
    </Card>
  );
}
