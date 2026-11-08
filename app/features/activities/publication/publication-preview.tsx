'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicationDocument } from '@sthstart/contracts';
import { compilePublicationCards, renderPublicationCard, publicationCanvasSize } from '@sthstart/activity-playback';
import { publicationFile } from './api';
import { Button } from '@/app/components/ui/button';
import { AlertCircle } from 'lucide-react';

// Module-level font loading singleton to prevent retry loops
let fontLoadPromise: Promise<boolean> | null = null;
function ensurePreviewFont(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.document.fonts.check('32px "Noto Sans SC"')) return Promise.resolve(true);
  if (!fontLoadPromise) {
    try {
      const font = new FontFace('Noto Sans SC', 'url(/fonts/NotoSansSC-VF.ttf)');
      fontLoadPromise = font.load().then((loaded) => {
        window.document.fonts.add(loaded);
        return window.document.fonts.ready.then(() => true);
      }).catch(() => false);
    } catch {
      fontLoadPromise = Promise.resolve(false);
    }
  }
  return fontLoadPromise;
}

// A stable card effect controls requests; failures are retried only on explicit action.
function loadPreviewImage(artifactId: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = publicationFile(artifactId);
  });
}

export function PublicationComicPreview({ document }: { document: PublicationDocument }) {
  const cards = useMemo(() => compilePublicationCards(document), [document]);
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [issues, setIssues] = useState<string[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);

  const safeIndex = Math.min(Math.max(0, index), Math.max(0, cards.length - 1));
  const card = cards[safeIndex];
  const size = publicationCanvasSize(document.orientation);

  const currentShot = document.shots.find((s) => s.id === card?.shotId);
  const artifactId = currentShot?.selectedImage?.artifactId;
  const utteranceKey = card ? card.utteranceIds.join(',') : '';

  useEffect(() => {
    let cancelled = false;
    const paint = async () => {
      const node = canvas.current;
      const ctx = node?.getContext('2d');
      if (!node || !ctx || !card) return;
      const errors: string[] = [];

      try {
        await ensurePreviewFont();
        let image: HTMLImageElement | null = null;
        if (artifactId) {
          image = await loadPreviewImage(artifactId);
          if (!image) errors.push('画面暂不可读取，可以重新加载预览。');
        }
        if (cancelled) return;

        errors.push(...renderPublicationCard(ctx, document, card, image ? { source: image, width: image.naturalWidth, height: image.naturalHeight } : null));

        // If image failed or missing, draw a stable legible placeholder in the image box
        if (!image) {
          const margin = 48;
          const imageHeight = document.orientation === 'portrait' ? 840 : 660;
          ctx.save();
          ctx.fillStyle = '#22272b';
          ctx.fillRect(margin, margin, size.width - 2 * margin, imageHeight);
          ctx.fillStyle = '#9ca3af';
          ctx.font = '500 28px "Noto Sans SC", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(artifactId ? '画面文件不可读取或仍在制作中' : '镜头尚未生成或绑定画面', size.width / 2, margin + imageHeight / 2);
          ctx.restore();
        }
      } catch {
        errors.push('预览字体或画面不可读取，请检查产物或重试。');
      }

      if (!cancelled) {
        setIssues((prev) => {
          if (prev.length === errors.length && prev.every((v, i) => v === errors[i])) {
            return prev;
          }
          return errors;
        });
      }
    };

    void paint();
    return () => {
      cancelled = true;
    };
  }, [document, card, safeIndex, artifactId, utteranceKey, size.width, size.height, retry]);

  if (!card) return <p className="p-6 text-sm text-muted">先准备关键镜头，再查看漫画预览。</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button disabled={safeIndex === 0} onClick={() => setIndex((v) => v - 1)}>上一张</Button>
        <span className="text-sm font-medium text-ink">{Math.min(safeIndex + 1, cards.length)} / {cards.length} 张卡片</span>
        <Button disabled={safeIndex >= cards.length - 1} onClick={() => setIndex((v) => v + 1)}>下一张</Button>
      </div>

      {/* Error / issue notice placed above the tall canvas so it is immediately visible */}
      {issues.length > 0 && (
        <div role="alert" className="rounded-control border border-warning/40 bg-warning/5 p-3 text-sm text-ink space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-warning-fg text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>预览提示（{issues.length}）</span>
          </div>
          <ul className="space-y-0.5 text-sm text-muted list-disc list-inside">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <Button size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>重新加载预览</Button>
        </div>
      )}

      <div className="relative mx-auto w-full max-w-xl">
        <canvas ref={canvas} width={size.width} height={size.height} aria-label="漫画发布预览" className="mx-auto h-auto w-full rounded-panel border border-border-subtle shadow-sm bg-[#f5f0e7]" />
      </div>
    </div>
  );
}
