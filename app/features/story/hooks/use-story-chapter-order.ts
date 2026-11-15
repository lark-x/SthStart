'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StoryDocument, StoryProject } from '@sthstart/contracts';
import { storyKeys } from '@/app/lib/query-keys';
import { storyApi } from '../api';
import { chaptersOf } from '../model/story-entry';

export function useStoryChapterReorder({
  projectId, project, documents, flush, onNotice,
}: {
  projectId: string;
  project: StoryProject | undefined;
  documents: StoryDocument[] | undefined;
  flush: () => Promise<boolean>;
  onNotice: (message: string) => void;
}) {
  const client = useQueryClient();
  return useCallback(async (chapterId: string, direction: -1 | 1) => {
    if (!project || !await flush()) return;
    const chapters = chaptersOf(documents);
    const index = chapters.findIndex((chapter) => chapter.id === chapterId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= chapters.length) return;
    const ids = chapters.map((chapter) => chapter.id);
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    try {
      const updated = await storyApi.reorderChapters(projectId, project.revision, ids);
      client.setQueryData(storyKeys.project(projectId), updated);
      await client.invalidateQueries({ queryKey: storyKeys.documents(projectId) });
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '章节顺序更新失败。');
    }
  }, [client, documents, flush, onNotice, project, projectId]);
}
