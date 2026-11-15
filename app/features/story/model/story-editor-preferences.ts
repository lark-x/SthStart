export type ViewMode = 'source' | 'preview' | 'split' | 'script';
export type PaperTheme = 'interface' | 'parchment' | 'pure' | 'midnight' | 'sage';
export type FontChoice = 'serif' | 'sans' | 'kai';
export type CanvasWidth = 'comfortable' | 'wide' | 'full';

export const STORY_CANVAS_WIDTH_KEY = 'sthstart_story_canvas_width';
export const STORY_SIDEBAR_COLLAPSED_KEY = 'sthstart_story_sidebar_collapsed';

// 独立纸张配色仅作用于阅读/编辑表面，默认跟随全局主题。
export const themeNames: Record<PaperTheme, string> = {
  interface: '跟随界面', parchment: '水墨暖白', pure: '素笺明净', midnight: '深阁夜读', sage: '竹简素青',
};

export const fontFamilies: Record<FontChoice, { name: string; style: string }> = {
  serif: {
    name: '思源宋体',
    style: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "Noto Sans SC VF", Georgia, serif',
  },
  sans: {
    name: '思源黑体',
    style: 'var(--font-reading)',
  },
  kai: {
    name: '古风楷体',
    style: '"KaiTi", "STKaiti", "楷体", "Noto Sans SC VF", serif',
  },
};

export function parseCanvasWidth(value: string | null | undefined): CanvasWidth | null {
  return value === 'comfortable' || value === 'wide' || value === 'full' ? value : null;
}

export function canvasWidthClass(width: CanvasWidth) {
  return width === 'full' ? 'max-w-none' : width === 'comfortable' ? 'max-w-3xl' : 'max-w-5xl';
}

export function paperWidthClass(width: CanvasWidth, split: boolean) {
  return split ? 'max-w-7xl' : canvasWidthClass(width);
}
