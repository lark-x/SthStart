'use client';

import { useSyncExternalStore } from 'react';
import { NoteEditor } from './note-editor';
import { NotebookList } from './notebook-list';

function subscribe() {
  return () => undefined;
}

function currentPathname() {
  return window.location.pathname;
}

export function OfflineNotebook() {
  const pathname = useSyncExternalStore(subscribe, currentPathname, () => '');
  const match = pathname.match(/^\/apps\/notebook\/([^/]+)$/);
  const noteId = match?.[1] && match[1] !== 'new' && match[1] !== 'offline' ? decodeURIComponent(match[1]) : undefined;
  return noteId ? <NoteEditor noteId={noteId} /> : <NotebookList />;
}
