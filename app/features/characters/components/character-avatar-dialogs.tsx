'use client';

import type { ComponentType } from 'react';
import type { CreativePurposeOptions, GenerationTaskDescriptor } from '@sthstart/contracts';
import { ImageGenerationPanel, type ImageGenerationPanelProps } from '@/app/features/generation/components/image-generation-panel';
import type { ImageGenerationSubmission } from '@/app/features/generation/image-api';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';

/**
 * 页面注入的生成面板（可带来源加载装配）。角色模块只依赖生成模块的公开面板契约，
 * 不引入 workspaces，也不复制生成表单。
 */
export type CharacterAvatarGenerationPanel = ComponentType<ImageGenerationPanelProps>;

export function CharacterAvatarUrlDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="从图片链接获取头像"
      description="输入公开可访问的图片 URL，系统将自动下载并设为角色头像。"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            variant="accent"
            disabled={!value.trim() || pending}
            loading={pending}
            onClick={onSubmit}
          >
            抓取并应用
          </Button>
        </div>
      }
    >
      <div className="space-y-3 py-2">
        <Input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="https://example.com/avatar.png"
          autoFocus
        />
      </div>
    </Dialog>
  );
}

/** 头像生成浮层；生成模块继续拥有参数表单，角色模块只提供上下文与采用动作。 */
export function CharacterAvatarGenerationOverlay({
  open,
  onOpenChange,
  dirty,
  options,
  optionsLoading,
  prompt,
  characterId,
  draftRevision,
  taskId,
  pollError,
  result,
  applying,
  onRefreshOptions,
  onGenerate,
  onApply,
  generationPanel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dirty: boolean;
  options?: CreativePurposeOptions;
  optionsLoading: boolean;
  prompt: string;
  characterId?: string;
  draftRevision?: number;
  taskId: string | null;
  pollError: string;
  result: GenerationTaskDescriptor | null;
  applying: boolean;
  onRefreshOptions: () => void;
  onGenerate: (input: ImageGenerationSubmission) => Promise<void>;
  onApply: () => Promise<void>;
  generationPanel?: CharacterAvatarGenerationPanel;
}) {
  const GenerationPanel = generationPanel ?? ImageGenerationPanel;
  return (
    <ResponsiveEditOverlay
      open={open}
      onOpenChange={onOpenChange}
      title="生成角色头像"
      description="根据角色外观生成图片，预览后再应用为头像。"
    >
      <div className="space-y-4">
        {dirty && <p role="status" className="rounded-control bg-surface-sunken p-3 text-xs text-muted">角色修改尚未保存完成；生成读取已保存的角色版本。请先保存外观或 LoRA 修改，再生成头像。</p>}
        <GenerationPanel
          appId="characters"
          purpose="character-avatar"
          contextKey={`character-avatar:${characterId}`}
          options={options}
          loading={optionsLoading}
          initialDescription={prompt}
          context={characterId ? { characters: [{ characterId, draftRevision }] } : undefined}
          onRefresh={onRefreshOptions}
          blockedReason={taskId ? '已有头像任务正在生成，完成后可预览结果。' : undefined}
          onGenerate={onGenerate}
        />
        {pollError && (
          <p role="status" className="text-sm text-muted">
            状态暂时无法读取，正在重试：{pollError}
          </p>
        )}
        {taskId && (
          <p role="status" className="text-sm text-muted">
            头像正在生成，可关闭面板继续编辑角色。
          </p>
        )}
        {result && (
          <section aria-label="头像生成结果" className="space-y-3">
            {result.artifacts
              .filter((item) => item.mediaKind === 'image')
              .map((item) => (
                <img
                  key={item.artifactId}
                  src={`/api/admin/artifacts/${encodeURIComponent(item.artifactId)}/file`}
                  alt="新生成的角色头像"
                  className="mx-auto max-h-80 max-w-full rounded-panel object-contain"
                />
              ))}
            <Button variant="accent" loading={applying} onClick={onApply}>
              应用为头像
            </Button>
          </section>
        )}
      </div>
    </ResponsiveEditOverlay>
  );
}
