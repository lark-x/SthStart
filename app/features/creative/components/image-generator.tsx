'use client';

import type { ArtifactDescriptor, CreativeWorkflowBinding } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Sparkles } from 'lucide-react';
import { InputLabel } from '../input-label';
import { ArtifactPicker } from './artifact-picker';
import { creativeImageAccept, creativeInputMaxBytes, formatByteLimit, type CreativeFormState } from '../types';

export function ImageGenerator({
  form,
  mode,
  binding,
  sourceArtifact,
  sourcePreview,
  uploading,
  submitting,
  onFormChange,
  onSubmit,
  onSourceSelect,
  onSourceRemove,
}: {
  form: CreativeFormState;
  // 组件只在图片模式挂载（视频模式渲染 VideoGenerator）。
  mode: 'text-to-image' | 'image-to-image';
  binding?: CreativeWorkflowBinding;
  sourceArtifact: ArtifactDescriptor | null;
  sourcePreview: string | null;
  uploading: boolean;
  submitting: boolean;
  onFormChange: (key: keyof CreativeFormState, value: string) => void;
  onSubmit: () => void;
  onSourceSelect: (file: File | undefined) => void;
  onSourceRemove: () => void;
}) {
  const ready = Boolean(binding?.ready);
  const needsSource = mode === 'image-to-image';
  const sourceMaxBytes = creativeInputMaxBytes(binding, 'sourceImage');
  return (
    <Card>
      <CardHeader>

        <CardTitle>图片创作</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <InputLabel htmlFor="creative-prompt">正向提示词</InputLabel>
          <Textarea id="creative-prompt" className="mt-1.5 min-h-[128px]" value={form.prompt} onChange={(event) => onFormChange('prompt', event.target.value)} placeholder="描述主体、场景、光线与画面气质…" maxLength={10000} />
          <p className="mt-1 text-right text-sm text-fg-subtle">{form.prompt.length}/10000</p>
        </div>
        {needsSource && (
          <ArtifactPicker
            id="creative-source"
            label="参考图片"
            hint={`图片会先安全保存到中央媒体库，最大 ${formatByteLimit(sourceMaxBytes)}。`}
            accept={creativeImageAccept(binding, 'sourceImage')}
            previewUrl={sourcePreview}
            artifact={sourceArtifact}
            uploading={uploading}
            onSelect={onSourceSelect}
            onRemove={onSourceRemove}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><InputLabel htmlFor="creative-width">宽度</InputLabel><Input id="creative-width" className="mt-1.5" type="number" min={64} max={4096} step={1} value={form.width} onChange={(event) => onFormChange('width', event.target.value)} /></div>
          <div><InputLabel htmlFor="creative-height">高度</InputLabel><Input id="creative-height" className="mt-1.5" type="number" min={64} max={4096} step={1} value={form.height} onChange={(event) => onFormChange('height', event.target.value)} /></div>

        </div>
        <details className="border-t border-border-subtle pt-3">
          <summary className="cursor-pointer text-sm text-muted">高级参数 · 反向提示词、步数与种子</summary>
          <div className="mt-3 space-y-3">
        <div>
          <InputLabel htmlFor="creative-negative" hint="可选">反向提示词</InputLabel>
          <Textarea id="creative-negative" className="mt-1.5" rows={3} value={form.negativePrompt} onChange={(event) => onFormChange('negativePrompt', event.target.value)} placeholder="不希望出现的内容，例如模糊、文字、水印…" maxLength={10000} />
        </div>
<div className="grid grid-cols-2 gap-3">          <div><InputLabel htmlFor="creative-steps">步数</InputLabel><Input id="creative-steps" className="mt-1.5" type="number" min={1} max={150} step={1} value={form.steps} onChange={(event) => onFormChange('steps', event.target.value)} /></div>
          <div><InputLabel htmlFor="creative-seed" hint="可选">种子</InputLabel><Input id="creative-seed" className="mt-1.5" type="number" min={0} max={2147483647} step={1} value={form.seed} onChange={(event) => onFormChange('seed', event.target.value)} placeholder="随机" /></div></div></div>
        </details>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 text-sm text-muted">{binding ? <><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${ready ? 'bg-success' : 'bg-warning'}`} />{ready ? `${binding.workflow?.name ?? '已配置'} · ${binding.engine?.name ?? 'ComfyUI'}` : '当前模式尚未就绪'}</> : '正在检查公共生成状态…'}</div>
        <Button variant="accent" size="md" onClick={onSubmit} loading={submitting} disabled={!ready || uploading}><Sparkles className="h-4 w-4" aria-hidden="true" />开始生成</Button>
      </CardFooter>
    </Card>
  );
}
