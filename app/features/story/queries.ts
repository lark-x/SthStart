import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { StoryDocumentKind } from '@sthstart/contracts';
import { storyKeys } from '@/app/lib/query-keys';
import { storyApi } from './api';

type QueryOptions = { enabled?: boolean; refetchInterval?: number | false };

export function useStoryProjects(options?: QueryOptions) {
  return useQuery({ queryKey: storyKeys.projects(), queryFn: storyApi.listProjects, ...options });
}

export function useStoryProject(projectId: string) {
  return useQuery({ queryKey: storyKeys.project(projectId), queryFn: () => storyApi.getProject(projectId) });
}

export function useStoryDocuments(projectId: string, options?: QueryOptions) {
  return useQuery({
    queryKey: storyKeys.documents(projectId),
    queryFn: () => storyApi.listDocuments(projectId),
    ...options,
    enabled: Boolean(projectId) && (options?.enabled ?? true),
  });
}

export function useStoryCharacters(projectId: string) {
  return useQuery({ queryKey: storyKeys.characters(projectId), queryFn: () => storyApi.listCharacters(projectId) });
}

export function useStoryProposals(projectId: string, options?: QueryOptions) {
  return useQuery({ queryKey: storyKeys.proposals(projectId), queryFn: () => storyApi.listProposals(projectId), ...options });
}

export function useStoryBridgeStatus(projectId: string, options?: QueryOptions) {
  return useQuery({ queryKey: storyKeys.bridgeStatus(projectId), queryFn: () => storyApi.bridgeStatus(projectId), ...options });
}

export function useStoryDshStatus(projectId: string, options?: QueryOptions) {
  return useQuery({ queryKey: storyKeys.dshStatus(projectId), queryFn: () => storyApi.dshStatus(projectId), ...options });
}

export function useStorySearch(projectId: string, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: storyKeys.search(projectId, trimmed),
    queryFn: () => storyApi.searchEntries(projectId, trimmed),
    enabled: trimmed.length >= 2,
  });
}

export function useStoryArchiveSessions(projectId: string) {
  return useQuery({ queryKey: storyKeys.archiveSessions(projectId), queryFn: () => storyApi.listSessions(projectId) });
}

export function useStoryArchiveMessages(projectId: string, sessionId?: string) {
  return useQuery({
    queryKey: storyKeys.archiveMessages(projectId, sessionId),
    queryFn: () => storyApi.listMessages(projectId, sessionId!),
    enabled: Boolean(sessionId),
  });
}

export function useStoryRevisions(
  projectId: string,
  kind: StoryDocumentKind | 'character' | null,
  entryId: string | undefined,
  options?: QueryOptions,
) {
  return useQuery({
    queryKey: storyKeys.revisions(projectId, kind ?? '', entryId),
    queryFn: () => storyApi.listRevisions(projectId, kind!, entryId!),
    ...options,
    enabled: Boolean(projectId && kind && entryId) && (options?.enabled ?? true),
  });
}

/** 正文、角色或项目元数据被外部改动（提案接受、恢复版本、冲突）后整体刷新。 */
export function useInvalidateStoryContent(projectId: string) {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: storyKeys.documents(projectId) }),
      client.invalidateQueries({ queryKey: storyKeys.characters(projectId) }),
      client.invalidateQueries({ queryKey: storyKeys.project(projectId) }),
    ]);
  }, [client, projectId]);
}
