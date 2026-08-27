'use client';

import type { ArtifactDescriptor, CreativeStatusResponse } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
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
  mode: 'text-to-image' | 'image-to-image' | 'h3-t2v' | 'h3-i2v' | 'h3-fl2va';
  binding?: CreativeStatusResponse['modes']['textToImage'];
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
  const needsSource = mode === 'image-to-image' || mode === 'h3-i2v' || mode === 'h3-fl2va';
  const maxDuration = binding?.constraints?.maxDurationSeconds ?? 10;
  const sourceInputKey = mode === 'image-to-image' ? 'sourceImage' : 'firstFrame';
  const sourceMaxBytes = creativeInputMaxBytes(binding, sourceInputKey);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-[#b83b1b]"><Sparkles className="h-4 w-4" aria-hidden="true" /><span className="text-[10px] font-bold tracking-[0.16em] uppercase">MAKE AN IMAGE</span></div>
        <CardTitle>开始一次创作</CardTitle>
        <CardDescription>只填写创作参数；实际模型、工作流与引擎由管理端绑定并在服务端执行。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <InputLabel htmlFor="creative-prompt">正向提示词</InputLabel>
          <Textarea id="creative-prompt" className="mt-1.5 min-h-[128px]" value={form.prompt} onChange={(event) => onFormChange('prompt', event.target.value)} placeholder="描述主体、场景、光线与画面气质…" maxLength={10000} />
          <p className="mt-1 text-right text-[10px] text-[#89908a]">{form.prompt.length}/10000</p>
        </div>
        <div>
          <InputLabel htmlFor="creative-negative" hint="可选">反向提示词</InputLabel>
          <Textarea id="creative-negative" className="mt-1.5" rows={3} value={form.negativePrompt} onChange={(event) => onFormChange('negativePrompt', event.target.value)} placeholder="不希望出现的内容，例如模糊、文字、水印…" maxLength={10000} />
        </div>
        {needsSource && (
          <ArtifactPicker
            id="creative-source"
            label={mode === 'image-to-image' ? '参考图片' : '首帧图片'}
            hint={`图片会先安全保存到中央媒体库，最大 ${formatByteLimit(sourceMaxBytes)}。`}
            accept={creativeImageAccept(binding, sourceInputKey)}
            previewUrl={sourcePreview}
            artifact={sourceArtifact}
            uploading={uploading}
            onSelect={onSourceSelect}
            onRemove={onSourceRemove}
          />
        )}
        {mode === 'h3-fl2va' && (
          <p className="rounded bg-[#d0a731]/12 p-3 text-[11px] leading-relaxed text-[#6b5410]">首尾帧视频需要同时上传尾帧图片，此表单当前提供公共入口，尾帧上传页即将开放。</p>
        )}
        {!mode.startsWith('h3-') ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><InputLabel htmlFor="creative-width">宽度</InputLabel><Input id="creative-width" className="mt-1.5" type="number" min={64} max={4096} step={1} value={form.width} onChange={(event) => onFormChange('width', event.target.value)} /></div>
            <div><InputLabel htmlFor="creative-height">高度</InputLabel><Input id="creative-height" className="mt-1.5" type="number" min={64} max={4096} step={1} value={form.height} onChange={(event) => onFormChange('height', event.target.value)} /></div>
            <div><InputLabel htmlFor="creative-steps">步数</InputLabel><Input id="creative-steps" className="mt-1.5" type="number" min={1} max={150} step={1} value={form.steps} onChange={(event) => onFormChange('steps', event.target.value)} /></div>
            <div><InputLabel htmlFor="creative-seed" hint="可选">种子</InputLabel><Input id="creative-seed" className="mt-1.5" type="number" min={0} max={2147483647} step={1} value={form.seed} onChange={(event) => onFormChange('seed', event.target.value)} placeholder="随机" /></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><InputLabel htmlFor="creative-duration">视频时长（秒）</InputLabel><Input id="creative-duration" className="mt-1.5" type="number" min={1} max={maxDuration} step={1} value={form.duration} onChange={(event) => onFormChange('duration', event.target.value)} /></div>
            <div><InputLabel htmlFor="creative-aspect">画幅比例</InputLabel><Input id="creative-aspect" className="mt-1.5" type="text" value={form.aspectRatio} onChange={(event) => onFormChange('aspectRatio', event.target.value)} placeholder="16:9" /></div>
            <div><InputLabel htmlFor="creative-seed-h3" hint="可选">种子</InputLabel><Input id="creative-seed-h3" className="mt-1.5" type="number" min={0} max={2147483647} step={1} value={form.seed} onChange={(event) => onFormChange('seed', event.target.value)} placeholder="随机" /></div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 text-xs text-[#68716d]">{binding ? <><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${ready ? 'bg-[#4e9b6b]' : 'bg-[#d0a731]'}`} />{ready ? `${binding.workflow?.name ?? '已配置'} · ${binding.engine?.name ?? 'ComfyUI'}` : '当前模式尚未就绪'}</> : '正在检查公共生成状态…'}</div>
        <Button variant="accent" size="lg" onClick={onSubmit} loading={submitting} disabled={!ready || uploading}><Sparkles className="h-4 w-4" aria-hidden="true" />开始生成</Button>
      </CardFooter>
    </Card>
  );
}
