'use client';

import { useSyncExternalStore } from 'react';
import { NoteEditor } from './note-editor';
import { NotebookList } from './notebook-list';

// 离线 shell 由 Service Worker 直接返回静态页面，路由变化不会触发 React
// 重渲染，因此监听 popstate 保证 shell 内的返回/前进能更新视图。
function subscribe(onStoreChange: () => void) {
  window.addEventListener('popstate', onStoreChange);
  return () => window.removeEventListener('popstate', onStoreChange);
}

function currentPathname() {
  return window.location.pathname;
}

export function OfflineNotebook() {
  const pathname = useSyncExternalStore(subscribe, currentPathname, () => '');
  if (pathname.endsWith('/new')) return <NoteEditor standalone />;
  const match = pathname.match(/^\/apps\/notebook\/([^/]+)$/);
  const noteId = match?.[1] && match[1] !== 'new' && match[1] !== 'offline' ? decodeURIComponent(match[1]) : undefined;
  return noteId ? <NoteEditor noteId={noteId} standalone /> : <NotebookList />;
}
