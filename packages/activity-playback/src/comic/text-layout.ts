import type { ComicBubble } from '@sthstart/contracts';

export interface BubbleTextLayout {
  lines: string[];
  requiredHeight: number;
  overflow: boolean;
}

const lineHeight = 1.35;

function graphemes(value: string): string[] {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> };
  }).Segmenter;
  if (Segmenter) return [...new Segmenter('zh', { granularity: 'grapheme' }).segment(value)].map((part) => part.segment);
  return Array.from(value);
}

function words(value: string): string[] {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (locale?: string, options?: { granularity: 'word' }) => { segment(input: string): Iterable<{ segment: string }> };
  }).Segmenter;
  if (Segmenter) return [...new Segmenter('zh', { granularity: 'word' }).segment(value)].map((part) => part.segment);
  return value.split(/(\s+)/u).filter(Boolean);
}

function appendWord(ctx: CanvasRenderingContext2D, line: string, token: string, width: number): string[] {
  const candidate = line + token;
  if (ctx.measureText(candidate).width <= width || !line) {
    if (!line && ctx.measureText(token).width > width) {
      const chunks: string[] = [];
      let chunk = '';
      for (const grapheme of graphemes(token)) {
        if (chunk && ctx.measureText(chunk + grapheme).width > width) {
          chunks.push(chunk);
          chunk = grapheme;
        } else chunk += grapheme;
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    }
    return [candidate];
  }
  if (ctx.measureText(token).width <= width) return [line, token.replace(/^\s+/u, '')];

  const result = [line];
  let chunk = '';
  for (const grapheme of graphemes(token)) {
    if (chunk && ctx.measureText(chunk + grapheme).width > width) {
      result.push(chunk);
      chunk = grapheme;
    } else chunk += grapheme;
  }
  if (chunk) result.push(chunk);
  return result;
}

/** Wraps without deleting or shrinking text; `overflow` means the bubble box is too short. */
export function layoutBubbleText(
  ctx: CanvasRenderingContext2D,
  bubble: Pick<ComicBubble, 'text' | 'fontSize' | 'rect'>,
  innerWidth: number,
  innerHeight = Number.POSITIVE_INFINITY,
): BubbleTextLayout {
  const width = Math.max(1, innerWidth);
  const lineHeightPx = bubble.fontSize * lineHeight;
  const output: string[] = [];
  for (const paragraph of bubble.text.split('\n')) {
    if (paragraph.length === 0) {
      output.push('');
      continue;
    }
    let current = '';
    for (const token of words(paragraph)) {
      const parts = appendWord(ctx, current, token, width);
      current = parts.pop() ?? '';
      output.push(...parts);
    }
    output.push(current);
  }
  // Callers pass the inner box after subtracting the 18px top/bottom inset.
  const requiredHeight = output.length * lineHeightPx;
  return { lines: output, requiredHeight, overflow: requiredHeight > innerHeight };
}

export function bubbleTextFits(layout: BubbleTextLayout, bubbleHeight: number): boolean {
  return layout.requiredHeight <= bubbleHeight;
}
