'use client';

import {
  ImageGenerationPanel,
  type ImageGenerationPanelProps,
  type ImageGenerationInitial,
} from '@/app/features/generation/components/image-generation-panel';
import { GenerationSourcesPicker } from './generation-sources-picker';
import { loadGenerationContextChoices } from './source-options';

export type ConnectedImageGenerationPanelProps = ImageGenerationPanelProps;

/**
 * 装配了来源选项加载（角色与世界观笔记）的图片生成面板。
 * 导出原行为与原签名，供外部页面（如 creative-client、character-editor）无缝接入。
 */
export function ConnectedImageGenerationPanel({
  contextLoader = loadGenerationContextChoices,
  ...props
}: ConnectedImageGenerationPanelProps) {
  return (
    <ImageGenerationPanel
      {...props}
      contextLoader={contextLoader}
      sourcesSlot={props.sourcesSlot ?? (sourceProps => <GenerationSourcesPicker {...sourceProps} />)}
    />
  );
}

export type { ImageGenerationInitial };
