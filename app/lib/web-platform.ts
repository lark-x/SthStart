/**
 * Modern web platform helpers shared by client-side views.
 *
 * These utilities are intentionally dependency-free and safe to import from
 * server components: every browser API is feature-detected at call time.
 */

interface SchedulerWithYield {
  yield?: () => Promise<void> | void;
}

function getScheduler(): SchedulerWithYield | undefined {
  const candidate = (globalThis as { scheduler?: unknown }).scheduler;
  if (!candidate || typeof candidate !== 'object') return undefined;
  return candidate as SchedulerWithYield;
}

/**
 * Yield control back to the browser so it can paint and handle input.
 *
 * Uses `scheduler.yield()` when the browser supports it (Chrome's prioritized
 * task scheduling keeps the continuation near the front of the queue), and
 * falls back to a zero-delay timeout everywhere else.
 */
export async function yieldToMain(): Promise<void> {
  const scheduler = getScheduler();
  if (typeof scheduler?.yield === 'function') {
    try {
      await scheduler.yield();
      return;
    } catch {
      // A discarded frame can reject the yield; fall through to the timer.
    }
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Process `items` in chunks, yielding to the main thread between chunks.
 *
 * Keeps large parsing/filtering loops from blocking input so interaction to
 * next paint (INP) stays responsive. Results keep the input order.
 */
export async function processInChunks<T, R>(
  items: readonly T[],
  processor: (item: T, index: number) => R,
  chunkSize = 50
): Promise<R[]> {
  const size = Math.max(1, Math.floor(chunkSize) || 1);
  const results = new Array<R>(items.length);

  for (let start = 0; start < items.length; start += size) {
    const end = Math.min(start + size, items.length);
    for (let index = start; index < end; index += 1) {
      results[index] = processor(items[index], index);
    }
    if (end < items.length) {
      await yieldToMain();
    }
  }

  return results;
}

type ViewTransitionStarter = (
  callback: () => void | Promise<void>
) => { finished: Promise<void> };

/**
 * Run a DOM update inside the View Transitions API when available.
 *
 * Honors `prefers-reduced-motion: reduce` by applying the update directly,
 * and resolves after the transition settles (or immediately on unsupported
 * browsers) so callers can await the visual state.
 */
export async function runViewTransition(
  updateCallback: () => void | Promise<void>
): Promise<void> {
  if (typeof document === 'undefined') {
    await updateCallback();
    return;
  }

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const doc = document as Document & { startViewTransition?: unknown };
  const startViewTransition =
    'startViewTransition' in doc
      ? (doc.startViewTransition as ViewTransitionStarter | undefined)
      : undefined;

  if (prefersReducedMotion || typeof startViewTransition !== 'function') {
    await updateCallback();
    return;
  }

  const transition = startViewTransition.call(document, updateCallback);
  await transition.finished.catch(() => {});
}
