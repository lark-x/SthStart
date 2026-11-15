'use client';

import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Spinner } from '@/app/components/ui/spinner';
import type { ImageSourcesSlotProps } from '@/app/features/generation/components/image-generation-panel';
import {
  isCharacterInContext,
  isNoteInContext,
  toggleCharacterInContext,
  toggleNoteInContext,
} from './source-options';

/**
 * 角色与设定来源选择器插槽组件。
 * 可作为 ImageGenerationPanel 的 sourcesSlot 传入，也可以在自定义工作台独立使用。
 */
export function GenerationSourcesPicker({
  effectiveContext,
  setSelectedContext,
  contextChoices,
  contextLoading,
  loadContextChoices,
  hasFixedContext,
  sourcesOpen,
  setSourcesOpen,
}: ImageSourcesSlotProps) {
  return (
    <details className="space-y-3" open={sourcesOpen}>
      <summary
        className="cursor-pointer text-sm font-medium text-ink"
        onClick={event => {
          event.preventDefault();
          setSourcesOpen(previous => !previous);
          if (!contextChoices.characters.length && !contextLoading) {
            void loadContextChoices();
          }
        }}
      >
        角色与设定来源
      </summary>
      {contextLoading ? (
        <Spinner size="sm" label="正在读取来源…" className="mt-3" />
      ) : (
        <div className="mt-3 space-y-3">
          <Button type="button" size="sm" variant="outline" onClick={() => void loadContextChoices()}>
            刷新来源
          </Button>
          {!hasFixedContext && (
            <div className="space-y-2">
              <p className="text-xs text-muted">选择本次画面中的角色，保留外观和 LoRA。</p>
              {contextChoices.characters.map(item => (
                <Checkbox
                  key={item.id}
                  label={item.label}
                  checked={isCharacterInContext(effectiveContext, item.id)}
                  onChange={event => {
                    setSelectedContext(previous =>
                      toggleCharacterInContext(previous, item.id, event.target.checked),
                    );
                  }}
                />
              ))}
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs text-muted">选择与画面相关的世界观资料，准备时记录其版本。</p>
            {contextChoices.notes.map(item => (
              <Checkbox
                key={item.id}
                label={item.label}
                checked={isNoteInContext(effectiveContext, item.id)}
                onChange={event => {
                  setSelectedContext(previous =>
                    toggleNoteInContext(previous, item.id, event.target.checked),
                  );
                }}
              />
            ))}
            {!contextChoices.notes.length && (
              <p className="text-xs text-muted">暂无世界观资料，可在创作笔记中添加。</p>
            )}
          </div>
        </div>
      )}
    </details>
  );
}
