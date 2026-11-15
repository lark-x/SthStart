'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StoryProject } from '@sthstart/contracts';
import { storyKeys } from '@/app/lib/query-keys';
import { storyApi } from '../api';

export function useStoryProjectSettings(projectId: string, onNotice: (message: string) => void) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [workId, setWorkId] = useState('');

  const openSettings = useCallback((project: StoryProject | undefined, options?: { workId?: string }) => {
    if (!project) return;
    setTitle(project.title);
    setSummary(project.summary);
    setWorkId(options?.workId ?? project.workId ?? '');
    setOpen(true);
  }, []);

  const save = useCallback(async (project: StoryProject | undefined) => {
    if (!project) return;
    try {
      const updated = await storyApi.updateProject(projectId, project.revision, {
        title: title.trim(),
        summary,
        workId: workId.trim() || null,
      });
      client.setQueryData(storyKeys.project(projectId), updated);
      setOpen(false);
      onNotice('项目资料已保存。');
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '项目保存失败。');
    }
  }, [client, onNotice, projectId, summary, title, workId]);

  return {
    projectSettingsOpen: open, setProjectSettingsOpen: setOpen, openSettings,
    projectTitle: title, setProjectTitle: setTitle,
    projectSummary: summary, setProjectSummary: setSummary,
    projectWorkId: workId, setProjectWorkId: setWorkId,
    saveProject: save,
  };
}
