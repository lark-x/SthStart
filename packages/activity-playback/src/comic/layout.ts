import type { ComicCrop, ComicPage, ComicRect, ComicTemplate } from '@sthstart/contracts';

export const COMIC_CANVAS = { width: 1920, height: 1080 } as const;
export const COMIC_STYLE = {
  page: '#f3eddf',
  gutter: '#1f1d1a',
  panelFallback: '#d8d0c0',
  bubble: '#fffdf6',
  ink: '#211f1b',
  accent: '#c94224',
} as const;

export const comicTemplateRects = {
  single: [{ x: 32, y: 32, width: 1856, height: 1016 }],
  duo: [
    { x: 32, y: 32, width: 916, height: 1016 },
    { x: 972, y: 32, width: 916, height: 1016 },
  ],
  trio: [
    { x: 32, y: 32, width: 1088, height: 1016 },
    { x: 1144, y: 32, width: 744, height: 496 },
    { x: 1144, y: 552, width: 744, height: 496 },
  ],
  quad: [
    { x: 32, y: 32, width: 916, height: 496 },
    { x: 972, y: 32, width: 916, height: 496 },
    { x: 32, y: 552, width: 916, height: 496 },
    { x: 972, y: 552, width: 916, height: 496 },
  ],
} satisfies Record<ComicTemplate, ComicRect[]>;

export function getComicPanelRects(template: ComicTemplate): ComicRect[] {
  return comicTemplateRects[template].map((rect) => ({ ...rect }));
}

export function normalizedRectToCanvas(rect: ComicRect, panel: ComicRect): ComicRect {
  return {
    x: panel.x + rect.x * panel.width,
    y: panel.y + rect.y * panel.height,
    width: rect.width * panel.width,
    height: rect.height * panel.height,
  };
}

export interface CoverCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** A source-image rectangle suitable for the 9-argument drawImage overload. */
export function computeCoverCrop(
  imageWidth: number,
  imageHeight: number,
  panelWidth: number,
  panelHeight: number,
  crop: ComicCrop,
): CoverCrop {
  if (![imageWidth, imageHeight, panelWidth, panelHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('图片与画格尺寸必须是大于零的有限数值。');
  }
  const zoom = Math.max(1, Math.min(3, crop.zoom));
  const scale = Math.max(panelWidth / imageWidth, panelHeight / imageHeight) * zoom;
  const sw = Math.min(imageWidth, panelWidth / scale);
  const sh = Math.min(imageHeight, panelHeight / scale);
  const centerX = Math.max(0, Math.min(1, crop.focalX)) * imageWidth;
  const centerY = Math.max(0, Math.min(1, crop.focalY)) * imageHeight;
  const sx = Math.max(0, Math.min(imageWidth - sw, centerX - sw / 2));
  const sy = Math.max(0, Math.min(imageHeight - sh, centerY - sh / 2));
  return { sx, sy, sw, sh };
}

export function panelLayoutForPage(template: ComicTemplate, panelIds: string[]): Array<{ panelId: string; rect: ComicRect }> {
  const rects = getComicPanelRects(template);
  if (rects.length !== panelIds.length) throw new RangeError(`${template} 模板需要 ${rects.length} 个画格，实际收到 ${panelIds.length} 个。`);
  return panelIds.map((panelId, index) => ({ panelId, rect: rects[index] }));
}

export function findComicPage(document: { pages: ComicPage[] }, pageId: string): ComicPage | undefined {
  return document.pages.find((page) => page.id === pageId);
}
