'use client';

import { useEffect, type RefObject } from 'react';

export function useScrollFade(
  ref: RefObject<HTMLElement | null>,
  orientation: 'vertical' | 'horizontal' | 'both',
  fadeSize: number,
) {
  useEffect(() => {
    if (orientation === 'both') return;
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      if (orientation === 'vertical') {
        const { scrollTop, scrollHeight, clientHeight } = el;
        el.style.setProperty('--scroll-fade-top', scrollTop > 2 ? `${fadeSize}px` : '0px');
        el.style.setProperty('--scroll-fade-bottom', scrollTop + clientHeight < scrollHeight - 2 ? `${fadeSize}px` : '0px');
      } else {
        const { scrollLeft, scrollWidth, clientWidth } = el;
        el.style.setProperty('--scroll-fade-left', scrollLeft > 2 ? `${fadeSize}px` : '0px');
        el.style.setProperty('--scroll-fade-right', scrollLeft + clientWidth < scrollWidth - 2 ? `${fadeSize}px` : '0px');
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    apply();
    el.addEventListener('scroll', schedule, { passive: true });
    document.fonts?.addEventListener?.('loadingdone', schedule);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener('scroll', schedule);
      document.fonts?.removeEventListener?.('loadingdone', schedule);
      ro?.disconnect();
      mo?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, orientation, fadeSize]);
}
