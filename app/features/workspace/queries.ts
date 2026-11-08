import { useQuery } from '@tanstack/react-query';
import { mediaLibraryKeys, notebookKeys, projectKeys, workspaceKeys } from '@/app/lib/query-keys';
import { fetchRecentWork } from './api';
import { projectsApi } from '../projects/api';
import { fetchNotes } from '../notebook/api';
import { fetchMediaLibrary } from '../media-library/api';
import { useCharacters } from '../characters/queries';

export function useRecentWork(limit: number) {
  return useQuery({
    queryKey: workspaceKeys.recent(limit),
    queryFn: ({ signal }) => fetchRecentWork(limit, signal),
    staleTime: 0,
  });
}

const SUMMARY_STALE = 60_000;
const NOTE_COUNT_FILTERS = { pageSize: 1 };

/**
 * 首页模块入口卡的数量。项目与角色复用各自列表页的缓存；资料与媒体只取总数（pageSize/limit = 1）。
 * 任何一项失败只让该卡不显示数字，不影响其他卡片。
 */
export function useWorkspaceCounts() {
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list, staleTime: SUMMARY_STALE });
  const characters = useCharacters();
  const notes = useQuery({
    queryKey: notebookKeys.list(NOTE_COUNT_FILTERS),
    queryFn: () => fetchNotes(NOTE_COUNT_FILTERS),
    staleTime: SUMMARY_STALE,
  });
  const media = useQuery({
    queryKey: mediaLibraryKeys.summary(),
    queryFn: ({ signal }) => fetchMediaLibrary({ limit: 1 }, { signal }),
    staleTime: SUMMARY_STALE,
  });

  return {
    projects: projects.data?.items.length,
    characters: characters.data?.items.length,
    notes: notes.data ? notes.data.total ?? notes.data.items.length : undefined,
    media: media.data?.total,
  };
}
