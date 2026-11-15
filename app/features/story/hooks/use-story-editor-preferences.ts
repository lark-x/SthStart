'use client';

import { useCallback, useState } from 'react';
import {
  parseCanvasWidth, STORY_CANVAS_WIDTH_KEY,
  type CanvasWidth, type FontChoice, type PaperTheme, type ViewMode,
} from '../model/story-editor-preferences';

function readCanvasWidth(): CanvasWidth {
  if (typeof window === 'undefined') return 'wide';
  try { return parseCanvasWidth(localStorage.getItem(STORY_CANVAS_WIDTH_KEY)) ?? 'wide'; } catch { return 'wide'; }
}

/** Per-editor view preferences. The editor remounts per entry, matching existing reset behavior. */
export function useStoryEditorPreferences() {
  const [mode, setMode] = useState<ViewMode>('source');
  const [theme, setTheme] = useState<PaperTheme>('interface');
  const [font, setFont] = useState<FontChoice>('sans');
  const [indent2em, setIndent2em] = useState(true);
  const [canvasWidth, setCanvasWidth] = useState<CanvasWidth>(readCanvasWidth);

  const changeCanvasWidth = useCallback((width: CanvasWidth) => {
    setCanvasWidth(width);
    try { localStorage.setItem(STORY_CANVAS_WIDTH_KEY, width); } catch {}
  }, []);

  return {
    mode, setMode, theme, setTheme, font, setFont,
    indent2em, setIndent2em, canvasWidth, setCanvasWidth: changeCanvasWidth,
  };
}
