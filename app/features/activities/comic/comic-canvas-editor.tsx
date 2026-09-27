'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComicDocument, ComicPage, ComicRect } from '@sthstart/contracts';
import { panelLayoutForPage, renderComicPage, type ComicAssetResolver } from '@sthstart/activity-playback';

interface ComicCanvasEditorProps {
  document: ComicDocument;
  page: ComicPage;
  selectedPanelId: string | null;
  selectedBubbleId: string | null;
  onSelectPanel(panelId: string): void;
  onSelectBubble(panelId: string, bubbleId: string | null): void;
  onMoveBubble(panelId: string, bubbleId: string, x: number, y: number): void;
  assets: ComicAssetResolver;
}

function contains(rect: ComicRect, x: number, y: number) {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
}

export function ComicCanvasEditor({ document, page, selectedPanelId, selectedBubbleId, onSelectPanel, onSelectBubble, onMoveBubble, assets }: ComicCanvasEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusCanvasRef = useRef<HTMLCanvasElement>(null);
  const [showFullPage, setShowFullPage] = useState(false);
  const drag = useRef<{ panelId: string; bubbleId: string; offsetX: number; offsetY: number } | null>(null);
  const layout = useMemo(() => panelLayoutForPage(page.template, page.panelIds), [page]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    renderComicPage(ctx, document, page, {
      pageId: page.id,
      visiblePanelIds: page.panelIds,
      visibleBubbleIds: document.panels.flatMap((panel) => panel.bubbles.map((bubble) => bubble.id)),
      activePanelId: selectedPanelId,
      effectProgress: 1,
      reducedMotion: true,
    }, assets);
    if (selectedPanelId) {
      const selected = layout.find((item) => item.panelId === selectedPanelId);
      if (selected) {
        ctx.save();
        ctx.strokeStyle = '#d1492e';
        ctx.lineWidth = 7;
        ctx.setLineDash([18, 10]);
        ctx.strokeRect(selected.rect.x + 4, selected.rect.y + 4, selected.rect.width - 8, selected.rect.height - 8);
        ctx.restore();
        const panel = document.panels.find((item) => item.id === selectedPanelId);
        const bubble = panel?.bubbles.find((item) => item.id === selectedBubbleId);
        if (bubble) {
          ctx.save();
          ctx.strokeStyle = '#277c66';
          ctx.lineWidth = 6;
          ctx.strokeRect(selected.rect.x + bubble.rect.x * selected.rect.width, selected.rect.y + bubble.rect.y * selected.rect.height,
            bubble.rect.width * selected.rect.width, bubble.rect.height * selected.rect.height);
          ctx.restore();
        }
      }
    }
    const focus = focusCanvasRef.current;
    const focusContext = focus?.getContext('2d');
    const selectedRect = layout.find((item) => item.panelId === selectedPanelId)?.rect;
    if (focus && focusContext && selectedRect) {
      focus.width = selectedRect.width;
      focus.height = selectedRect.height;
      focusContext.drawImage(canvas, selectedRect.x, selectedRect.y, selectedRect.width, selectedRect.height,
        0, 0, selectedRect.width, selectedRect.height);
    }
  }, [assets, document, layout, page, selectedBubbleId, selectedPanelId]);

  function locate(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * 1920 / bounds.width, y: (event.clientY - bounds.top) * 1080 / bounds.height };
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = locate(event);
    const selected = [...layout].reverse().find((item) => contains(item.rect, point.x, point.y));
    if (!selected) { onSelectBubble('', null); return; }
    onSelectPanel(selected.panelId);
    const panel = document.panels.find((item) => item.id === selected.panelId);
    const bubble = panel?.bubbles.find((item) => {
      const rect = { x: selected.rect.x + item.rect.x * selected.rect.width, y: selected.rect.y + item.rect.y * selected.rect.height,
        width: item.rect.width * selected.rect.width, height: item.rect.height * selected.rect.height };
      return contains(rect, point.x, point.y);
    });
    onSelectBubble(selected.panelId, bubble?.id ?? null);
    if (bubble) {
      drag.current = { panelId: selected.panelId, bubbleId: bubble.id,
        offsetX: point.x - (selected.rect.x + bubble.rect.x * selected.rect.width),
        offsetY: point.y - (selected.rect.y + bubble.rect.y * selected.rect.height) };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const active = drag.current;
    if (!active) return;
    const point = locate(event);
    const panel = document.panels.find((item) => item.id === active.panelId);
    const panelRect = layout.find((item) => item.panelId === active.panelId)?.rect;
    const bubble = panel?.bubbles.find((item) => item.id === active.bubbleId);
    if (!panelRect || !bubble) return;
    onMoveBubble(active.panelId, active.bubbleId,
      Math.max(0, Math.min(1 - bubble.rect.width, (point.x - active.offsetX - panelRect.x) / panelRect.width)),
      Math.max(0, Math.min(1 - bubble.rect.height, (point.y - active.offsetY - panelRect.y) / panelRect.height)));
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-start gap-2 overflow-auto bg-ink p-3 xl:justify-center">
      <div className="sticky top-0 z-10 flex w-full shrink-0 items-center gap-1 overflow-x-auto bg-ink py-1 xl:hidden">{page.panelIds.map((panelId, index) => <button type="button" key={panelId} onClick={() => { onSelectPanel(panelId); setShowFullPage(false); }}
        aria-pressed={panelId === selectedPanelId && !showFullPage} className={`shrink-0 rounded-[var(--radius-control)] border px-2 py-1 text-xs ${panelId === selectedPanelId && !showFullPage ? 'border-accent bg-accent/10 text-accent' : 'border-border-default bg-surface text-ink'}`}>第 {index + 1} 格</button>)}
        <button type="button" onClick={() => setShowFullPage(true)} aria-pressed={showFullPage} className={`shrink-0 rounded-[var(--radius-control)] border px-2 py-1 text-xs ${showFullPage ? 'border-accent bg-accent/10 text-accent' : 'border-border-default bg-surface text-ink'}`}>整页</button>
      </div>
      {selectedPanelId && <div className={`w-full space-y-2 xl:hidden ${showFullPage ? 'hidden' : ''}`}><div className="max-h-24 space-y-1 overflow-y-auto rounded-[var(--radius-panel)] bg-surface p-2 text-sm leading-relaxed text-ink">{document.panels.find((panel) => panel.id === selectedPanelId)?.bubbles.map((bubble) => <button key={bubble.id} type="button" onClick={() => onSelectBubble(selectedPanelId, bubble.id)} className="block w-full text-left"><span className="mr-2 text-xs text-muted">{bubble.kind === 'caption' ? '旁白' : '气泡'}</span>{bubble.text}</button>)}
          {!document.panels.find((panel) => panel.id === selectedPanelId)?.bubbles.length && <p className="text-muted">本格没有台词。</p>}</div><canvas ref={focusCanvasRef} aria-label="选中画格放大预览" className="max-h-[45dvh] w-full bg-surface object-contain shadow-lg" /></div>}
      <canvas ref={canvasRef} width={1920} height={1080} onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        aria-label="漫画页面画布；点击画格选择，拖动气泡调整位置"
        className={`max-h-full w-auto max-w-full touch-none cursor-crosshair bg-surface shadow-lg ${showFullPage ? 'block' : 'hidden xl:block'}`}
        style={{ aspectRatio: '16 / 9' }} />
    </div>
  );
}
