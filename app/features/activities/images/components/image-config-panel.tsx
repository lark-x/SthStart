'use client';

import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import type { ImageConfigEditorState } from '../types';

type ImageConfigPanelProps = {
  advanced: boolean;
  scopeTab: 'override' | 'slot' | 'global';
  onScopeChange(tab: 'override' | 'slot' | 'global'): void;
  overrides: Array<{ id: string; fieldPath: string; overrideText: string; reason?: string }>;
  onOverridesChange(value: Array<{ id: string; fieldPath: string; overrideText: string; reason?: string }>): void;
  config: ImageConfigEditorState;
};

export function ImageConfigPanel({
  advanced,
  scopeTab,
  onScopeChange,
  overrides,
  onOverridesChange,
  config,
}: ImageConfigPanelProps) {
  return (
    <div className={`${advanced ? '' : 'hidden'} xl:col-span-3 min-w-0 border-r border-border-default p-4 overflow-y-auto space-y-4 bg-surface/30`}>
      <div className="flex items-center justify-between pb-2 border-b border-border-default">
        <span className="text-sm font-bold text-muted uppercase tracking-wider">
          1. 设定范围与覆盖
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-sm px-2 text-muted"
            onClick={() => void config.saveDraft()}
            disabled={config.isSavingDraft}
          >
            保存草稿
          </Button>
          <Button
            size="sm"
            className="h-6 text-sm px-2 bg-accent hover:bg-accent/90 text-paper"
            onClick={() => void config.commitRevision()}
            disabled={config.isCommittingRevision}
          >
            提交版本
          </Button>
        </div>
      </div>

      <div className="flex rounded bg-paper p-1 border border-border-default text-sm">
        {(
          [
            { id: 'override', label: '单次尝试覆盖' },
            { id: 'slot', label: '镜头默认' },
            { id: 'global', label: '活动全局预设' },
          ] as const
        ).map((item) => {
          const active = scopeTab === item.id;
          return (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={active ? 'accent' : 'ghost'}
              aria-pressed={active}
              className={`h-auto min-h-0 flex-1 rounded px-2 py-1 text-xs font-medium ${
                active ? 'text-paper shadow-sm' : 'text-muted hover:bg-transparent hover:text-ink'
              }`}
              onClick={() => onScopeChange(item.id)}
            >
              {item.label}
            </Button>
          );
        })}
      </div>

      {scopeTab === 'override' && (
        <div className="space-y-3 text-sm">
          <div className="p-2.5 rounded bg-paper/60 border border-border-default text-muted leading-relaxed text-sm">
            提示：单次尝试覆盖只在此次配方编译生效，不会污染活动全局或角色基准设定。
          </div>

          <div className="space-y-1.5">
            <label htmlFor="image-override-text" className="text-muted font-medium">覆盖文本 (Override Text)</label>
            <Textarea
              id="image-override-text"
              placeholder="如：特别要求该镜头角色手持发光信物..."
              value={overrides[0]?.overrideText || ''}
              onChange={(event) => {
                const text = event.target.value;
                if (text.trim()) {
                  onOverridesChange([{ id: 'override_1', fieldPath: 'attempt.override', overrideText: text }]);
                } else {
                  onOverridesChange([]);
                }
              }}
              rows={3}
              className="bg-paper text-sm"
            />
          </div>
        </div>
      )}

      {scopeTab === 'slot' && (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label htmlFor="image-slot-shot-type" className="text-muted">景别 (Shot Type)</label>
              <Input
                id="image-slot-shot-type"
                placeholder="close-up, medium shot..."
                value={config.activeSlotConfig.shotType || ''}
                onChange={(event) => config.updateSlotConfig({ shotType: event.target.value })}
                className="bg-paper text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="image-slot-lighting" className="text-muted">光影 (Lighting)</label>
              <Input
                id="image-slot-lighting"
                placeholder="cinematic lighting, soft..."
                value={config.activeSlotConfig.lighting || ''}
                onChange={(event) => config.updateSlotConfig({ lighting: event.target.value })}
                className="bg-paper text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="image-slot-composition" className="text-muted">构图与视角 (Composition)</label>
            <Input
              id="image-slot-composition"
              placeholder="rule of thirds, wide angle..."
              value={config.activeSlotConfig.composition || ''}
              onChange={(event) => config.updateSlotConfig({ composition: event.target.value })}
              className="bg-paper text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="image-slot-negative" className="text-muted">镜头负向提示词 (Negative)</label>
            <Textarea
              id="image-slot-negative"
              placeholder="针对本镜头的排除项..."
              value={config.activeSlotConfig.negativePrompt || ''}
              onChange={(event) => config.updateSlotConfig({ negativePrompt: event.target.value })}
              rows={2}
              className="bg-paper text-sm"
            />
            {config.activeSlotConfig.negativePrompt !== undefined && (
              <Button type="button" variant="ghost" size="sm" onClick={() => config.updateSlotConfig({ negativePrompt: undefined })}>
                恢复继承负面词
              </Button>
            )}
          </div>
        </div>
      )}

      {scopeTab === 'global' && (
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <label htmlFor="image-global-style-preset" className="text-muted">风格预设代号</label>
            <Input
              id="image-global-style-preset"
              value={config.currentConfigDoc?.stylePreset || 'anime_standard'}
              onChange={(event) => config.updateGlobalConfig({ stylePreset: event.target.value })}
              className="bg-paper text-sm font-mono"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="image-global-style-prompt" className="text-muted">全局风格正向提示词 (Global Style)</label>
            <Textarea
              id="image-global-style-prompt"
              value={config.currentConfigDoc?.globalStylePrompt || ''}
              onChange={(event) => config.updateGlobalConfig({ globalStylePrompt: event.target.value })}
              rows={3}
              className="bg-paper text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="image-global-negative" className="text-muted">全局负向提示词 (Global Negative)</label>
            <Textarea
              id="image-global-negative"
              value={config.currentConfigDoc?.globalNegativePrompt || ''}
              onChange={(event) => config.updateGlobalConfig({ globalNegativePrompt: event.target.value })}
              rows={3}
              className="bg-paper text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
