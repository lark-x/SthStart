'use client';

import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

const key = 'sthstart_story_outline_width';
let fallbackWidth = 256;
let storageWriteFailed = false;
const clamp = (value: number) => Number.isFinite(value) ? Math.max(220, Math.min(420, Math.round(value))) : 256;
function readWidth() {
  if (storageWriteFailed) return fallbackWidth;
  try { return clamp(Number(localStorage.getItem(key) || fallbackWidth)); } catch { return fallbackWidth; }
}
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener('story-outline-width', listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener('story-outline-width', listener); };
}

export function StoryOutlinePane({hidden, children}: {hidden: boolean; children: ReactNode}) {
  const saved = useSyncExternalStore(subscribe, readWidth, () => 256);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{x: number; width: number} | null>(null);
  const width = dragWidth ?? saved;
  const save = (value: number) => {
    fallbackWidth = clamp(value);
    try {
      localStorage.setItem(key, String(fallbackWidth));
      storageWriteFailed = false;
    } catch { storageWriteFailed = true; }
    setDragWidth(null);
    window.dispatchEvent(new Event('story-outline-width'));
  };
  return <aside aria-label="正式剧情资料树" style={{width}} className={`story-tree-aside relative h-full min-h-0 shrink-0 overflow-hidden rounded-panel bg-surface shadow-xs ${hidden ? 'hidden' : 'hidden lg:block'}`}>
    {children}
    <div role="separator" tabIndex={hidden ? -1 : 0} aria-label="调整大纲宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={420} aria-valuenow={width} aria-valuetext={`${width} 像素；方向键调整，Home 复位`}
      className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none hover:bg-accent/15 focus-visible:bg-accent/20 focus-visible:outline focus-visible:outline-accent"
      onDoubleClick={() => save(256)}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); drag.current = {x: event.clientX, width}; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) setDragWidth(clamp(drag.current.width + event.clientX - drag.current.x)); }}
      onPointerUp={event => { if (!drag.current) return; save(drag.current.width + event.clientX - drag.current.x); drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { setDragWidth(null); drag.current = null; }}
      onLostPointerCapture={() => { setDragWidth(null); drag.current = null; }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); setDragWidth(null); drag.current = null; }
        if (event.key === 'Home') { event.preventDefault(); save(256); }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); save(width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10)); }
      }} />
  </aside>;
}
