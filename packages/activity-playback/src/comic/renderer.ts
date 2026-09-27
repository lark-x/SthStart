import type { ComicBubble, ComicDocument, ComicPage, ComicPanel, ComicRect } from '@sthstart/contracts';
import { COMIC_CANVAS, COMIC_STYLE, computeCoverCrop, normalizedRectToCanvas, panelLayoutForPage } from './layout.js';
import { layoutBubbleText } from './text-layout.js';

export interface ComicFrameState {
  pageId: string;
  visiblePanelIds: string[];
  visibleBubbleIds: string[];
  activePanelId: string | null;
  activeBubbleId?: string | null;
  effectProgress: number;
  reducedMotion: boolean;
}

export interface ComicAssetResolver {
  getImage(artifactId: string): CanvasImageSource | null;
}

export interface ComicLayoutIssue {
  code: 'bubble_overflow' | 'missing_image';
  panelId: string;
  bubbleId?: string;
  message: string;
}

function canvasSourceSize(image: CanvasImageSource): { width: number; height: number } {
  const value = image as CanvasImageSource & {
    width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number;
  };
  return {
    width: value.naturalWidth || value.videoWidth || value.width || 0,
    height: value.naturalHeight || value.videoHeight || value.height || 0,
  };
}

function traceRoundedRect(ctx: CanvasRenderingContext2D, rect: ComicRect, radius: number) {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.lineTo(rect.x + rect.width - r, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + r);
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - r);
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - r, rect.y + rect.height);
  ctx.lineTo(rect.x + r, rect.y + rect.height);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - r);
  ctx.lineTo(rect.x, rect.y + r);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
  ctx.closePath();
}

function drawBubble(ctx: CanvasRenderingContext2D, bubble: ComicBubble, panelRect: ComicRect, issues: ComicLayoutIssue[], panelId: string, alpha = 1) {
  const rect = normalizedRectToCanvas(bubble.rect, panelRect);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (bubble.kind === 'speech') {
    ctx.beginPath();
    ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = COMIC_STYLE.bubble;
    ctx.fill();
    ctx.strokeStyle = COMIC_STYLE.ink;
    ctx.lineWidth = 4;
    ctx.stroke();
  } else {
    traceRoundedRect(ctx, rect, bubble.kind === 'emphasis' ? 10 : 3);
    ctx.fillStyle = bubble.kind === 'caption' ? '#f7f0df' : COMIC_STYLE.bubble;
    ctx.fill();
    ctx.strokeStyle = COMIC_STYLE.ink;
    ctx.lineWidth = bubble.kind === 'emphasis' ? 5 : 3;
    ctx.stroke();
  }

  if (bubble.kind === 'speech' && bubble.tail) {
    const tipX = panelRect.x + bubble.tail.x * panelRect.width;
    const tipY = panelRect.y + bubble.tail.y * panelRect.height;
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const radiusX = rect.width / 2;
    const radiusY = rect.height / 2;
    const baseX = Math.max(centerX - radiusX * 0.55, Math.min(centerX + radiusX * 0.55, tipX));
    const halfWidth = Math.min(18, radiusX * 0.1);
    const edgeY = (x: number) => centerY + (tipY < centerY ? -1 : 1)
      * radiusY * Math.sqrt(Math.max(0, 1 - ((x - centerX) / radiusX) ** 2));
    const leftX = baseX - halfWidth;
    const rightX = baseX + halfWidth;
    const leftY = edgeY(leftX);
    const rightY = edgeY(rightX);
    const insideY = centerY + (tipY < centerY ? -1 : 1) * radiusY * 0.65;
    ctx.beginPath();
    ctx.moveTo(leftX, leftY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(rightX, rightY);
    ctx.lineTo(baseX, insideY);
    ctx.closePath();
    ctx.fillStyle = COMIC_STYLE.bubble;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(leftX, leftY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(rightX, rightY);
    ctx.strokeStyle = COMIC_STYLE.ink;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const inset = 18;
  ctx.font = `${bubble.kind === 'emphasis' ? '700 ' : '500 '}${bubble.fontSize}px "Sthstart Comic Noto Sans SC", sans-serif`;
  ctx.fillStyle = COMIC_STYLE.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = layoutBubbleText(ctx, bubble, rect.width - inset * 2, rect.height - inset * 2);
  if (text.overflow) issues.push({ code: 'bubble_overflow', panelId, bubbleId: bubble.id, message: `气泡文字超出边界（需要 ${Math.ceil(text.requiredHeight)}px，高度为 ${Math.floor(rect.height - inset * 2)}px）。` });
  const startY = rect.y + rect.height / 2 - ((text.lines.length - 1) * bubble.fontSize * 1.35) / 2;
  text.lines.forEach((line, index) => ctx.fillText(line, rect.x + rect.width / 2, startY + index * bubble.fontSize * 1.35, rect.width - inset * 2));
  ctx.restore();
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  panel: ComicPanel,
  rect: ComicRect,
  state: ComicFrameState,
  assets: ComicAssetResolver,
  issues: ComicLayoutIssue[],
) {
  const progress = state.reducedMotion ? 1 : Math.max(0, Math.min(1, state.effectProgress));
  const isActivePanel = panel.id === state.activePanelId;
  const panelTransitionActive = isActivePanel && state.activeBubbleId == null && !state.reducedMotion;
  const panelMotionProgress = isActivePanel && state.activeBubbleId != null && !state.reducedMotion ? 1 : progress;
  const panelAlpha = panelTransitionActive ? progress : 1;
  ctx.save();
  ctx.globalAlpha *= panelAlpha;
  if (isActivePanel && !state.reducedMotion) {
    if (panel.presentation.camera === 'push_in') {
      const scale = 1 + 0.04 * panelMotionProgress;
      ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(rect.x + rect.width / 2), -(rect.y + rect.height / 2));
    } else if (panel.presentation.camera === 'pan_left' || panel.presentation.camera === 'pan_right') {
      const direction = panel.presentation.camera === 'pan_left' ? -1 : 1;
      ctx.translate(direction * rect.width * 0.02 * panelMotionProgress, 0);
    }
    if (panel.presentation.impact === 'shake' && panelMotionProgress < 1) {
      ctx.translate(Math.sin(panelMotionProgress * Math.PI * 12) * 6 * (1 - panelMotionProgress), Math.cos(panelMotionProgress * Math.PI * 9) * 4 * (1 - panelMotionProgress));
    }
  }
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.fillStyle = COMIC_STYLE.panelFallback;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  if (state.visiblePanelIds.includes(panel.id)) {
    const image = panel.selectedImage ? assets.getImage(panel.selectedImage.artifactId) : null;
    if (image) {
      const { width, height } = canvasSourceSize(image);
      if (width > 0 && height > 0) {
        const crop = computeCoverCrop(width, height, rect.width, rect.height, panel.crop);
        ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, rect.x, rect.y, rect.width, rect.height);
      }
    } else {
      issues.push({ code: 'missing_image', panelId: panel.id, message: panel.selectedImage ? '画格图片不可用。' : '画格尚未选择图片。' });
      ctx.fillStyle = COMIC_STYLE.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '500 30px "Sthstart Comic Noto Sans SC", sans-serif';
      ctx.fillText(panel.visualDescription || '尚未选择图片', rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width * 0.8);
    }
  }
  if (panel.presentation.impact === 'flash' && panelTransitionActive && panelMotionProgress < 0.2) {
    ctx.fillStyle = `rgba(255,255,255,${0.18 * (1 - panelMotionProgress / 0.2)})`;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();

  if (state.visiblePanelIds.includes(panel.id)) {
    ctx.save();
    ctx.globalAlpha *= panelAlpha;
    for (const bubble of panel.bubbles) {
      if (state.visibleBubbleIds.includes(bubble.id)) {
        const bubbleAlpha = bubble.id === state.activeBubbleId && !state.reducedMotion ? progress : 1;
        drawBubble(ctx, bubble, rect, issues, panel.id, bubbleAlpha);
      }
    }
    ctx.restore();
  }
}

/** Shared renderer for the editor, reader, and static PNG export. It has no DOM, network, or filesystem dependency. */
export function renderComicPage(
  ctx: CanvasRenderingContext2D,
  document: ComicDocument,
  page: ComicPage,
  state: ComicFrameState,
  assets: ComicAssetResolver,
): ComicLayoutIssue[] {
  const issues: ComicLayoutIssue[] = [];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COMIC_STYLE.page;
  ctx.fillRect(0, 0, COMIC_CANVAS.width, COMIC_CANVAS.height);
  const panels = new Map(document.panels.map((panel) => [panel.id, panel]));
  for (const { panelId, rect } of panelLayoutForPage(page.template, page.panelIds)) {
    const panel = panels.get(panelId);
    if (panel) drawPanel(ctx, panel, rect, state, assets, issues);
    ctx.strokeStyle = COMIC_STYLE.gutter;
    ctx.lineWidth = 8;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();
  return issues;
}
