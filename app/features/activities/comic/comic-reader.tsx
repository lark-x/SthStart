'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComicDocument } from '@sthstart/contracts';
import { getComicFrameState, getComicReadingHoldMs, compileComicReadingSteps, panelLayoutForPage, renderComicPage, type ComicAssetResolver } from '@sthstart/activity-playback';
import { Button } from '@/app/components/ui/button';

interface ComicReaderProps { document: ComicDocument; fontReady: boolean; assets: ComicAssetResolver; loading: boolean; missingArtifactIds: string[] }

function animationDuration(document: ComicDocument, stepIndex: number) {
  const step = compileComicReadingSteps(document)[stepIndex];
  if (!step) return 0;
  if (step.kind === 'bubble') return 120;
  const panel = document.panels.find((item) => item.id === step.panelId);
  if (!panel) return 220;
  const cameraDuration = panel.presentation.camera === 'none' ? 0 : 600;
  const impactDuration = panel.presentation.impact === 'shake' ? 180 : panel.presentation.impact === 'flash' ? 80 : 0;
  return Math.max(220, cameraDuration, impactDuration);
}

export function ComicReader({ document, fontReady, assets, loading, missingArtifactIds }: ComicReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const progressRef = useRef(1);
  const [stepIndex, setStepIndex] = useState(-1);
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const steps = useMemo(() => compileComicReadingSteps(document), [document]);
  const currentStep = steps[stepIndex];
  const currentPage = document.pages.find((page) => page.id === currentStep?.pageId) ?? document.pages[0] ?? null;
  const animationMs = stepIndex < 0 ? 0 : animationDuration(document, stepIndex);
  const frame = getComicFrameState(document, stepIndex, progress, reducedMotion);
  const activePanel = document.panels.find((panel) => panel.id === frame.activePanelId) ?? null;

  const beginStep = (index: number, completed = false) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    progressRef.current = completed ? 1 : 0;
    setProgress(progressRef.current);
    setStepIndex(index);
  };

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const update = () => setVisible(window.document.visibilityState === 'visible');
    update();
    window.document.addEventListener('visibilitychange', update);
    return () => window.document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !currentPage) return;
    renderComicPage(context, document, currentPage, frame, assets);
    const focus = focusCanvasRef.current;
    const focusContext = focus?.getContext('2d');
    const rect = currentPage && frame.activePanelId ? panelLayoutForPage(currentPage.template, currentPage.panelIds).find((item) => item.panelId === frame.activePanelId)?.rect : null;
    if (focus && focusContext && rect) {
      focus.width = rect.width;
      focus.height = rect.height;
      focusContext.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    }
  }, [assets, currentPage, document, frame, progress, reducedMotion, stepIndex]);

  useEffect(() => {
    if (stepIndex < 0 || reducedMotion) { progressRef.current = 1; setProgress(1); return; }
    if (!visible || progressRef.current >= 1) return;
    const duration = animationDuration(document, stepIndex);
    if (duration <= 0) { progressRef.current = 1; setProgress(1); return; }
    let start: number | null = null;
    const tick = (time: number) => {
      start ??= time - progressRef.current * duration;
      const next = Math.min(1, (time - start) / duration);
      progressRef.current = next;
      setProgress(next);
      if (next < 1) animationRef.current = requestAnimationFrame(tick);
      else animationRef.current = null;
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => { if (animationRef.current !== null) cancelAnimationFrame(animationRef.current); animationRef.current = null; };
  }, [document, reducedMotion, stepIndex, visible]);

  useEffect(() => {
    if (!playing || !visible || stepIndex < 0 || stepIndex >= steps.length) return;
    if (!reducedMotion && progress < 1) return;
    const step = steps[stepIndex];
    const explicitHold = getComicReadingHoldMs(document, step);
    const fallbackEntrance = step.kind === 'bubble' ? 120 : 0;
    const delay = Math.max(explicitHold ?? 0, fallbackEntrance);
    const timeout = window.setTimeout(() => {
      if (stepIndex >= steps.length - 1) setPlaying(false);
      else beginStep(stepIndex + 1);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [document, playing, progress, reducedMotion, stepIndex, steps, visible]);

  useEffect(() => () => { if (animationRef.current !== null) cancelAnimationFrame(animationRef.current); }, []);

  const next = () => {
    if (stepIndex < 0) { beginStep(0); return; }
    if (progress < 1 && !reducedMotion) {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      progressRef.current = 1;
      setProgress(1);
      return;
    }
    if (stepIndex < steps.length - 1) beginStep(stepIndex + 1);
  };

  const previousPanel = () => {
    setPlaying(false);
    const activePanelId = currentStep?.panelId;
    if (!activePanelId) { beginStep(-1, true); return; }
    const activePanelIndex = steps.findIndex((step) => step.kind === 'panel' && step.panelId === activePanelId);
    const previousPanelIndex = steps.slice(0, activePanelIndex).map((step, index) => step.kind === 'panel' ? index : -1).filter((index) => index >= 0).at(-1);
    if (previousPanelIndex === undefined) { beginStep(-1, true); return; }
    const previousPanelId = (steps[previousPanelIndex] as { panelId: string }).panelId;
    const lastStepOfPanel = steps.map((step, index) => step.panelId === previousPanelId ? index : -1).filter((index) => index >= 0).at(-1) ?? previousPanelIndex;
    beginStep(lastStepOfPanel, true);
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-default px-3 py-2">
      <div className="min-w-0"><p className="text-sm font-semibold text-ink">逐格阅读</p><p className="text-xs text-muted">{currentPage ? `${currentPage.title} · 第 ${document.pages.findIndex((page) => page.id === currentPage.id) + 1}/${document.pages.length} 页` : '没有可阅读页面'}</p></div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={previousPanel} disabled={stepIndex < 0}>上一格</Button>
        <Button size="sm" variant="outline" onClick={() => {
          if (playing) {
            setPlaying(false);
            if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
            progressRef.current = 1;
            setProgress(1);
            return;
          }
          if (stepIndex < 0 || stepIndex >= steps.length - 1) beginStep(0);
          setPlaying(true);
        }} disabled={!steps.length || !fontReady}>{playing ? '暂停' : stepIndex >= steps.length - 1 ? '重新播放' : '自动播放'}</Button>
        <Button size="sm" variant="primary" onClick={next} disabled={!steps.length || !fontReady}>下一步</Button>
      </div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto bg-ink p-3 md:flex-row">
      {currentPage ? <><canvas ref={canvasRef} width={1920} height={1080} aria-label="漫画逐格阅读画面" className="hidden max-h-full w-auto max-w-full bg-surface shadow-lg md:block" style={{ aspectRatio: '16 / 9' }} />
        {activePanel ? <div className="w-full max-w-full space-y-3 md:hidden"><div className="max-h-28 space-y-1 overflow-y-auto rounded-[var(--radius-panel)] bg-surface p-3 text-sm leading-relaxed text-ink">{activePanel.bubbles.filter((bubble) => frame.visibleBubbleIds.includes(bubble.id)).map((bubble) => <p key={bubble.id}><span className="mr-2 text-xs text-muted">{bubble.kind === 'caption' ? '旁白' : bubble.kind === 'emphasis' ? '强调' : '对话'}</span>{bubble.text}</p>)}
            {!activePanel.bubbles.some((bubble) => frame.visibleBubbleIds.includes(bubble.id)) && <p className="text-muted">当前画格还没有显示台词。</p>}</div><canvas ref={focusCanvasRef} aria-label="当前漫画画格" className="max-h-[58dvh] w-full bg-surface object-contain shadow-lg" /></div>
          : <p className="text-sm text-white md:hidden">点击“下一步”开始阅读。</p>}</>
        : <p className="text-sm text-muted">漫画还没有页面。</p>}
    </div>
    <div aria-live="polite" className="shrink-0 border-t border-border-default px-3 py-2 text-xs text-muted">
      {!fontReady ? '本地漫画字体尚未就绪。' : loading ? '正在载入画格图片…' : missingArtifactIds.length ? `有 ${missingArtifactIds.length} 张图片文件不可读取。` : `${Math.max(0, stepIndex + 1)} / ${steps.length} 阅读步骤${reducedMotion ? ' · 已启用减少动态效果' : ''}`}
    </div>
  </div>;
}
