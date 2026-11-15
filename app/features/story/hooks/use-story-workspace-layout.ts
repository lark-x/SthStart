'use client';

import { useCallback, useEffect, useState } from 'react';
import { STORY_SIDEBAR_COLLAPSED_KEY } from '../model/story-editor-preferences';

function readSidebarCollapsed() {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(STORY_SIDEBAR_COLLAPSED_KEY) === 'true'; } catch { return false; }
}

export function useStoryWorkspaceLayout() {
  const [treeOpen, setTreeOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      try { localStorage.setItem(STORY_SIDEBAR_COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const toggleZen = useCallback(() => setZenMode((previous) => !previous), []);

  // Ctrl/Cmd + B：桌面折叠大纲栏，窄屏打开资料抽屉。
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.altKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        if (!window.matchMedia('(min-width: 1024px)').matches) { setTreeOpen((previous) => !previous); return; }
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleSidebar]);

  return { treeOpen, setTreeOpen, zenMode, toggleZen, sidebarCollapsed, toggleSidebar };
}
