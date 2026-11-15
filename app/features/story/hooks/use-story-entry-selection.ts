'use client';

import { useCallback, useMemo, useState } from 'react';
import type { StoryDocument, StoryEntry } from '@sthstart/contracts';
import type { EntryRow, NewKind, SelectedEntry, StoryNavTab } from '../model/story-entry';
import { chaptersOf, defaultEntryOf, neighborChapters, resolveActiveEntry } from '../model/story-entry';

export function useStoryEntrySelection({
  entries, documents, isReflection, urlEntryId, flush, onNotice, closeTree,
}: {
  entries: EntryRow[];
  documents: StoryDocument[] | undefined;
  isReflection: boolean;
  urlEntryId: string | null;
  flush: () => Promise<boolean>;
  onNotice: (message: string) => void;
  closeTree: () => void;
}) {
  const [selected, setSelected] = useState<SelectedEntry>(null);
  const [navTab, setNavTab] = useState<StoryNavTab>('chapters');

  const chapters = useMemo(() => chaptersOf(documents), [documents]);
  const defaultEntry = useMemo(
    () => defaultEntryOf(entries, documents, isReflection),
    [documents, entries, isReflection],
  );
  const activeEntry = useMemo<StoryEntry | null>(
    () => resolveActiveEntry(entries, selected, urlEntryId, defaultEntry),
    [defaultEntry, entries, selected, urlEntryId],
  );
  const activeId = activeEntry?.id;
  const neighbors = useMemo(() => neighborChapters(chapters, activeEntry), [chapters, activeEntry]);

  const chooseEntry = useCallback(async (row: EntryRow) => {
    if (row.item.id === activeId) { closeTree(); return; }
    if (!await flush()) { onNotice('当前文本尚未保存成功。处理保存状态后再切换条目。'); return; }
    setSelected({ kind: row.kind, id: row.item.id });
    if (!isReflection) setNavTab(row.kind === 'document' && row.item.kind === 'chapter' ? 'chapters' : 'bible');
    onNotice('');
    closeTree();
  }, [activeId, closeTree, flush, isReflection, onNotice]);

  const selectCreated = useCallback((kind: NewKind, id: string) => {
    setSelected({ kind: kind === 'character' ? 'character' : 'document', id });
    if (!isReflection) setNavTab(kind === 'chapter' ? 'chapters' : 'bible');
    closeTree();
  }, [closeTree, isReflection]);

  const switchChapter = useCallback(async (targetId: string) => {
    const target = chapters.find((chapter) => chapter.id === targetId);
    if (!target) return;
    await chooseEntry({ kind: 'document', item: target });
  }, [chapters, chooseEntry]);

  return {
    selected, activeEntry, activeId, navTab, setNavTab, chapters,
    previousChapter: neighbors.previous, nextChapter: neighbors.next,
    chooseEntry, selectCreated, switchChapter,
  };
}
