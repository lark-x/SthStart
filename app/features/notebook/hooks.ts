'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CreativeNote } from '@sthstart/contracts';
import { getLocalNote, listLocalNotes, saveServerNotes, subscribeNotebookLocalChanges, type LocalNoteRecord } from './local-store';

export function useLocalNotebookNotes(serverNotes?: CreativeNote[]) {
  const [records, setRecords] = useState<LocalNoteRecord[]>([]);
  const reload = useCallback(() => void listLocalNotes().then(setRecords), []);

  useEffect(() => {
    reload();
    return subscribeNotebookLocalChanges(reload);
  }, [reload]);

  useEffect(() => {
    if (!serverNotes) return;
    void saveServerNotes(serverNotes).then(reload);
  }, [reload, serverNotes]);

  return records;
}

export function useLocalNotebookNote(noteId: string) {
  const [record, setRecord] = useState<LocalNoteRecord>();
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    void getLocalNote(noteId)
      .then(setRecord)
      .catch(() => setRecord(undefined))
      .finally(() => setLoaded(true));
  }, [noteId]);
  useEffect(() => {
    reload();
    return subscribeNotebookLocalChanges((changedId) => {
      if (!changedId || changedId === noteId) reload();
    });
  }, [noteId, reload]);
  return { record, loaded };
}
