import type { ComicDocument, ComicPage } from '@sthstart/contracts';
import type { ComicFrameState } from './renderer.js';

export type ComicReadingStep =
  | { kind: 'panel'; pageId: string; panelId: string }
  | { kind: 'bubble'; pageId: string; panelId: string; bubbleId: string };

export function compileComicReadingSteps(document: ComicDocument): ComicReadingStep[] {
  const panels = new Map(document.panels.map((panel) => [panel.id, panel]));
  const steps: ComicReadingStep[] = [];
  for (const page of document.pages) {
    for (const panelId of page.panelIds) {
      const panel = panels.get(panelId);
      if (!panel) continue;
      steps.push({ kind: 'panel', pageId: page.id, panelId });
      for (const bubble of panel.bubbles) steps.push({ kind: 'bubble', pageId: page.id, panelId, bubbleId: bubble.id });
    }
  }
  return steps;
}

export function getComicFrameState(
  document: ComicDocument,
  stepIndex: number,
  effectProgress: number,
  reducedMotion: boolean,
): ComicFrameState {
  const steps = compileComicReadingSteps(document);
  const lastIndex = Math.min(steps.length - 1, Math.floor(stepIndex));
  const visiblePanelIds = new Set<string>();
  const visibleBubbleIds = new Set<string>();
  for (let index = 0; index <= lastIndex; index++) {
    const step = steps[index];
    if (step.kind === 'panel') visiblePanelIds.add(step.panelId);
    else visibleBubbleIds.add(step.bubbleId);
  }
  const active = lastIndex >= 0 ? steps[lastIndex] : null;
  return {
    pageId: active?.pageId ?? document.pages[0]?.id ?? '',
    visiblePanelIds: [...visiblePanelIds],
    visibleBubbleIds: [...visibleBubbleIds],
    activePanelId: active?.panelId ?? null,
    activeBubbleId: active?.kind === 'bubble' ? active.bubbleId : null,
    effectProgress: Number.isFinite(effectProgress) ? Math.max(0, Math.min(1, effectProgress)) : 0,
    reducedMotion,
  };
}

function countGraphemes(value: string) {
  const Segmenter = Intl.Segmenter;
  if (Segmenter) return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
  return Array.from(value).length;
}

export function getComicReadingHoldMs(document: ComicDocument, step: ComicReadingStep): number | null {
  if (step.kind !== 'panel') {
    const panel = document.panels.find((item) => item.id === step.panelId);
    if (!panel?.bubbles.length || panel.bubbles.at(-1)?.id !== step.bubbleId) return null;
    if (panel.presentation.holdMs !== null) return panel.presentation.holdMs;
    const characters = panel.bubbles.reduce((total, bubble) => total + countGraphemes(bubble.text), 0);
    return Math.max(1_800, Math.min(8_000, 800 + characters * 100));
  }
  const panel = document.panels.find((item) => item.id === step.panelId);
  if (!panel || panel.bubbles.length) return null;
  return panel.presentation.holdMs ?? 1_800;
}

export function comicPageForStep(document: ComicDocument, stepIndex: number): ComicPage | null {
  const step = compileComicReadingSteps(document)[stepIndex];
  return step ? document.pages.find((page) => page.id === step.pageId) ?? null : null;
}
