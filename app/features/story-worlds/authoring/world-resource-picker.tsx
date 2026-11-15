'use client';

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  FolderOpen,
  Globe2,
  Library,
  ListTree,
  Search,
  UserRound,
} from 'lucide-react';
import type {
  CharacterProfile,
  CharacterVersion,
  CreativeNote,
  KnowledgePendingItem,
  NarrativeReading,
  NarrativeStoryNode,
  NarrativeWork,
  ProjectLink,
  ProjectOverview,
  StoryDocument,
  WebSearchResult,
  WorldActor,
  WorldAuthoringDraft,
  WorldSource,
} from '@sthstart/contracts';
import { postJson } from '@/app/lib/api-client';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Input } from '@/app/components/ui/input';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Pagination } from '@/app/components/ui/pagination';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { useCharacterBrowser } from '@/app/features/characters/public';
import { CharacterPagination } from '@/app/features/characters/public-ui';
import { fetchCharacterDetail } from '@/app/features/characters/api';
import { fetchPending } from '@/app/features/knowledge/api';
import { fetchNotes } from '@/app/features/notebook/api';
import { fetchReadingNode, fetchWorks, fetchWorkTree } from '@/app/features/narrative/api';
import { projectsApi } from '@/app/features/projects/api';
import {
  extractWebSearchItems,
  searchWeb,
} from '@/app/features/public-services/web-search-api';
import {
  actorFromCharacterVersion,
  describeError,
  sourceFromKnowledge,
  sourceFromNote,
  sourceFromNarrative,
} from '../hooks/world-format';
import {
  createEmptyActor,
  mergeActors,
  mergeSources,
  sourceFromWeb,
} from './model';

export type WorldResourceTab =
  | 'characters'
  | 'knowledge'
  | 'notes'
  | 'narrative'
  | 'project'
  | 'web';

export interface WorldResourcePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: WorldAuthoringDraft;
  projectId?: string;
  disabled?: boolean;
  onAddActors: (actors: WorldActor[]) => void;
  onAddSources: (sources: WorldSource[]) => void;
  onReplaceActors?: (actors: WorldActor[]) => void;
  onReplaceSources?: (sources: WorldSource[]) => void;
}

type ProjectCharacter = ProjectOverview['characters'][number];
type ProjectSection = 'documents' | 'characters' | 'links';

const PAGE_SIZES = [20, 50, 100] as const;

const PROJECT_SECTION_LABELS: Record<ProjectSection, string> = {
  documents: '文档',
  characters: '角色',
  links: '引用',
};

const DOCUMENT_KIND_LABELS: Record<StoryDocument['kind'], string> = {
  outline: '大纲',
  world: '世界设定',
  scene: '场景',
  chapter: '章节',
};

const WEB_STATUS_LABELS: Record<WebSearchResult['status'], string> = {
  snippet: '搜索摘要',
  extracted: '已提取正文',
  failed: '提取失败',
};

const WEB_STATUS_VARIANTS: Record<
  WebSearchResult['status'],
  'warning' | 'online' | 'error'
> = {
  snippet: 'warning',
  extracted: 'online',
  failed: 'error',
};

const PROJECT_NATURE_MAP: Record<string, WorldSource['nature']> = {
  canon: 'canon',
  author: 'author',
  personal: 'author',
  ai: 'ai',
  community: 'unverified',
  unconfirmed: 'unverified',
};

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function clipText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function previewText(value: string, maxLength = 180): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  return clipText(normalized, maxLength);
}

export function filterByText<Item>(
  items: readonly Item[],
  query: string,
  fields: (item: Item) => readonly string[],
): Item[] {
  const normalizedQuery = normalizedText(query);
  if (!normalizedQuery) return [...items];
  return items.filter((item) =>
    fields(item).some((value) => normalizedText(value).includes(normalizedQuery)),
  );
}

export function pageItems<Item>(
  items: readonly Item[],
  page: number,
  pageSize: number,
): Item[] {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  return items.slice((safePage - 1) * safePageSize, safePage * safePageSize);
}

function useDebouncedText(value: string, delay = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function toggleRecord<Item>(
  current: Record<string, Item>,
  key: string,
  item: Item,
): Record<string, Item> {
  const next = { ...current };
  if (next[key]) delete next[key];
  else next[key] = item;
  return next;
}

export function actorAlreadyPresent(
  actors: readonly WorldActor[],
  candidate: WorldActor,
): boolean {
  if (candidate.characterId) {
    return actors.some((actor) => actor.characterId === candidate.characterId);
  }
  const candidateName = normalizedText(candidate.name);
  const candidateBackground = normalizedText(candidate.background);
  return actors.some(
    (actor) =>
      !actor.characterId
      && normalizedText(actor.name) === candidateName
      && normalizedText(actor.background) === candidateBackground,
  );
}

export function sourceAlreadyPresent(
  sources: readonly WorldSource[],
  candidate: WorldSource,
): boolean {
  return sources.some((source) => source.id === candidate.id);
}

export function projectCharacterAlreadyPresent(
  actors: readonly WorldActor[],
  character: ProjectCharacter,
): boolean {
  if (character.sourceCharacterId && character.sourceVersion) {
    return actors.some(
      (actor) => actor.characterId === character.sourceCharacterId,
    );
  }
  const characterName = normalizedText(character.name);
  const characterNotes = normalizedText(character.notes);
  return actors.some(
    (actor) =>
      !actor.characterId
      && normalizedText(actor.name) === characterName
      && normalizedText(actor.background) === characterNotes,
  );
}

export function resolveCharacterVersion(
  versions: readonly CharacterVersion[],
  version: number | null,
): CharacterVersion | null {
  if (version === null) return null;
  return versions.find((item) => item.version === version) ?? null;
}

export interface ActorVersionDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

function fullText(value: string): string {
  return value.trim() ? value : '（空）';
}

export function actorVersionDiff(
  current: WorldActor,
  incoming: WorldActor,
): ActorVersionDiff[] {
  const fields: Array<{
    field: string;
    label: string;
    before: string;
    after: string;
  }> = [
    {
      field: 'version',
      label: '版本',
      before: current.characterVersion === null
        ? '未绑定'
        : `v${current.characterVersion}`,
      after: incoming.characterVersion === null
        ? '未绑定'
        : `v${incoming.characterVersion}`,
    },
    { field: 'name', label: '名称', before: current.name, after: incoming.name },
    { field: 'background', label: '背景', before: current.background, after: incoming.background },
    { field: 'personality', label: '性格', before: current.personality, after: incoming.personality },
    { field: 'speechStyle', label: '说话方式', before: current.speechStyle, after: incoming.speechStyle },
    { field: 'appearance', label: '外观', before: current.appearance, after: incoming.appearance },
    {
      field: 'goals',
      label: '目标',
      before: current.goals.join('、'),
      after: incoming.goals.join('、'),
    },
  ];
  return fields
    .filter((item) => item.before !== item.after)
    .map((item) => ({
      field: item.field,
      label: item.label,
      before: fullText(item.before),
      after: fullText(item.after),
    }));
}

export function mergeActorVersion(
  current: WorldActor,
  incoming: WorldActor,
): WorldActor {
  return {
    ...incoming,
    id: current.id,
    locationId: current.locationId,
    role: current.role,
    referenceArtifactIds: [...current.referenceArtifactIds],
  };
}

export interface ActorVersionSelection {
  profile: CharacterProfile;
  versions: CharacterVersion[];
  version: number | null;
  actorId: string | null;
  draftSignature: string | null;
}

export interface ActorUpdateCandidate {
  current: WorldActor;
  incoming: WorldActor;
}

export type ActorSelectionBlockReason =
  | 'missing'
  | 'unbound'
  | 'identity-changed'
  | 'appeared';

export interface ActorSelectionLookup {
  current: WorldActor | null;
  blocked: ActorSelectionBlockReason | null;
  stale: boolean;
}

export function actorDraftSignature(current: WorldActor | null): string | null {
  if (!current) return null;
  return JSON.stringify([
    current.id,
    current.name,
    current.role,
    current.characterId,
    current.characterVersion,
    current.background,
    current.personality,
    current.speechStyle,
    current.appearance,
    current.goals,
    current.locationId,
    current.referenceArtifactIds,
  ]);
}

export function resolveActorSelection(
  selection: ActorVersionSelection,
  actors: readonly WorldActor[],
): ActorSelectionLookup {
  if (selection.actorId) {
    const current = actors.find((actor) => actor.id === selection.actorId) ?? null;
    if (!current) return { current: null, blocked: 'missing', stale: false };
    if (!current.characterId) return { current, blocked: 'unbound', stale: false };
    if (current.characterId !== selection.profile.id) {
      return { current, blocked: 'identity-changed', stale: false };
    }
    return {
      current,
      blocked: null,
      stale: actorDraftSignature(current) !== selection.draftSignature,
    };
  }
  const appeared = actors.find(
    (actor) => actor.characterId === selection.profile.id,
  ) ?? null;
  if (appeared) return { current: appeared, blocked: 'appeared', stale: false };
  return { current: null, blocked: null, stale: false };
}

export function actorSelectionIsStale(
  selection: ActorVersionSelection,
  actors: readonly WorldActor[],
): boolean {
  const lookup = resolveActorSelection(selection, actors);
  return Boolean(lookup.blocked) || lookup.stale;
}

export function actorUpdateCandidates(
  selections: readonly ActorVersionSelection[],
  actors: readonly WorldActor[],
): ActorUpdateCandidate[] {
  return selections.flatMap((selection) => {
    if (selection.version === null) return [];
    const lookup = resolveActorSelection(selection, actors);
    const current = lookup.current;
    if (lookup.blocked || !current) return [];
    const version = resolveCharacterVersion(selection.versions, selection.version);
    if (!version) return [];
    const incoming = mergeActorVersion(
      current,
      actorFromCharacterVersion(
        selection.profile,
        version,
        current.locationId,
      ),
    );
    if (current.characterVersion === incoming.characterVersion) return [];
    return [{ current, incoming }];
  });
}

export interface SourceVersionDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

export function sourceVersionDiff(
  current: WorldSource,
  incoming: WorldSource,
): SourceVersionDiff[] {
  const fields: Array<{
    field: string;
    label: string;
    before: string;
    after: string;
  }> = [
    { field: 'version', label: '版本', before: current.sourceVersion, after: incoming.sourceVersion },
    { field: 'title', label: '标题', before: current.title, after: incoming.title },
    { field: 'nature', label: '性质', before: current.nature, after: incoming.nature },
    { field: 'content', label: '正文', before: current.content, after: incoming.content },
    { field: 'url', label: '链接', before: current.sourceUrl, after: incoming.sourceUrl },
    { field: 'capturedAt', label: '采集时间', before: current.capturedAt, after: incoming.capturedAt },
  ];
  return fields
    .filter((item) => item.before !== item.after)
    .map((item) => ({
      field: item.field,
      label: item.label,
      before: fullText(item.before),
      after: fullText(item.after),
    }));
}

export function mergeSourceVersion(
  current: WorldSource,
  incoming: WorldSource,
): WorldSource {
  return { ...incoming, id: current.id };
}

export type WorldSourceFamily =
  | 'web'
  | 'knowledge'
  | 'note'
  | 'narrative'
  | 'project'
  | 'manual'
  | 'unknown';

export function worldSourceFamily(source: WorldSource): WorldSourceFamily {
  if (source.id.startsWith('source-web-')) return 'web';
  if (source.id.startsWith('source-note-')) return 'note';
  if (source.id.startsWith('source-narrative-')) return 'narrative';
  if (source.id.startsWith('source-project-')) return 'project';
  if (source.sourceVersion === 'manual') return 'manual';
  if (source.id.startsWith('source-')) return 'knowledge';
  return 'unknown';
}

export function findExistingSource(
  sources: readonly WorldSource[],
  incoming: WorldSource,
): WorldSource | null {
  const sameId = sources.find((source) => source.id === incoming.id);
  if (sameId) return sameId;
  const url = incoming.sourceUrl.trim();
  if (!url) return null;
  const family = worldSourceFamily(incoming);
  if (family === 'unknown') return null;
  return sources.find(
    (source) => source.sourceUrl.trim() === url
      && worldSourceFamily(source) === family,
  ) ?? null;
}

export type SourceChangeState = 'new' | 'update' | 'same';

export function sourceChangeState(
  sources: readonly WorldSource[],
  incoming: WorldSource,
): SourceChangeState {
  const current = findExistingSource(sources, incoming);
  if (!current) return 'new';
  return sourceVersionDiff(current, incoming).length ? 'update' : 'same';
}

export interface SourceUpdateCandidate {
  current: WorldSource;
  incoming: WorldSource;
  merged: WorldSource;
}

export function sourceUpdateCandidates(
  sources: readonly WorldSource[],
  incoming: readonly WorldSource[],
): SourceUpdateCandidate[] {
  const candidates = new Map<string, SourceUpdateCandidate>();
  for (const source of incoming) {
    const current = findExistingSource(sources, source);
    if (!current || !sourceVersionDiff(current, source).length) continue;
    if (candidates.has(current.id)) continue;
    candidates.set(current.id, {
      current,
      incoming: source,
      merged: mergeSourceVersion(current, source),
    });
  }
  return [...candidates.values()];
}

function VersionDifferenceList({
  differences,
}: {
  differences: readonly ActorVersionDiff[];
}) {
  return (
    <div className="space-y-2">
      {differences.map((difference) => (
        <details
          key={difference.field}
          className="rounded bg-surface-sunken p-2 text-xs"
        >
          <summary className="cursor-pointer font-medium text-ink">
            {difference.label}
            <span className="ml-2 font-normal text-muted">展开完整对照</span>
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="font-medium text-muted">当前</p>
              <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans leading-relaxed text-muted">
                {difference.before}
              </pre>
            </div>
            <div>
              <p className="font-medium text-ink">更新后</p>
              <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans leading-relaxed text-ink">
                {difference.after}
              </pre>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

export function newSourcesOnly(
  sources: readonly WorldSource[],
  incoming: readonly WorldSource[],
): WorldSource[] {
  return incoming.filter((source) => !findExistingSource(sources, source));
}

export function filterNarrativeNodes(
  nodes: readonly NarrativeStoryNode[],
  query: string,
): NarrativeStoryNode[] {
  return filterByText(nodes, query, (node) => [
    node.title,
    node.summary,
    node.kind,
  ]);
}

export function actorFromProjectCharacter(
  character: ProjectCharacter,
  locationId: string,
): WorldActor {
  return {
    ...createEmptyActor(locationId),
    name: character.name,
    background: character.notes,
  };
}

export function sourceFromProjectDocument(
  projectTitle: string,
  document: StoryDocument,
): WorldSource {
  return {
    id: `source-project-document-${document.projectId}-${document.id}`,
    title: clipText(`${projectTitle} · ${document.title}`, 300),
    nature: 'author',
    content: document.body.trim()
      || `项目文档「${document.title}」没有正文。`,
    sourceUrl: `/apps/story/${encodeURIComponent(document.projectId)}?entry=${encodeURIComponent(document.id)}`,
    sourceVersion: `project-document:${document.id}:r${document.revision}`,
    capturedAt: document.updatedAt,
  };
}

export function sourceFromProjectLink(
  projectTitle: string,
  link: ProjectLink,
): WorldSource {
  const excerpt = link.excerpt.trim()
    || `项目引用「${link.title}」没有可复制正文。`;
  const content = link.truncated
    ? `${excerpt}\n\n[项目快照已截断]`
    : excerpt;
  return {
    id: `source-project-link-${link.id}`,
    title: clipText(`${projectTitle} · ${link.title}`, 300),
    nature: PROJECT_NATURE_MAP[link.nature] ?? 'unverified',
    content,
    sourceUrl: link.sourceHref,
    sourceVersion: clipText(link.sourceVersion ?? `project-link:${link.id}`, 200),
    capturedAt: link.capturedAt,
  };
}

export function webSourceForDraft(item: WebSearchResult): WorldSource {
  const source = sourceFromWeb(item);
  const body = item.content.trim();
  const snippet = item.snippet.trim();
  let content = '';
  if (item.status === 'extracted' && body) {
    content = body;
    if (item.truncated) {
      content += '\n\n[正文已截断，以上为提取到的正文片段。]';
    }
  } else if (item.status === 'failed') {
    content = [
      `[正文提取失败${item.error ? `：${item.error}` : ''}]`,
      '[以下为搜索摘要，尚未核实]',
      snippet || body || '没有可用摘要。',
    ].join('\n\n');
  } else {
    content = [
      '[以下为搜索摘要，尚未核实]',
      snippet || body || '没有可用摘要。',
    ].join('\n\n');
  }
  if (item.truncated && !content.includes('已截断')) {
    content += '\n\n[摘要或正文已截断，以上内容不完整。]';
  }
  return {
    ...source,
    title: clipText(source.title, 300),
    content,
  };
}

export function webSourcesForDraft(
  items: readonly WebSearchResult[],
  existing: readonly WorldSource[] = [],
): WorldSource[] {
  const merged = mergeSources([...existing], items.map(webSourceForDraft));
  return merged.slice(existing.length);
}

export function sourceFromKeptKnowledge(
  item: KnowledgePendingItem,
): WorldSource {
  return {
    ...sourceFromKnowledge(item),
    sourceVersion: clipText(item.sourceVersionId, 200),
  };
}

export async function saveWebSearchSource(
  item: WebSearchResult,
): Promise<{ id: string }> {
  const response = await postJson<{ id?: unknown }>(
    'web-search/save-source',
    { item },
  );
  if (typeof response?.id !== 'string' || !response.id.trim()) {
    throw new Error('服务端未返回资料库条目 ID，保存结果无法确认。');
  }
  return { id: response.id.trim() };
}

function QueryError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Alert variant="danger" title={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{describeError(error)}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          重试
        </Button>
      </div>
    </Alert>
  );
}

function SelectionActions({
  count,
  busy,
  confirmDisabled = false,
  label,
  onConfirm,
  onClear,
  notice,
  error,
  onDismissNotice,
  onDismissError,
}: {
  count: number;
  busy: boolean;
  confirmDisabled?: boolean;
  label: string;
  onConfirm: () => void;
  onClear: () => void;
  notice: string;
  error: string;
  onDismissNotice: () => void;
  onDismissError: () => void;
}) {
  return (
    <div className="sticky bottom-0 space-y-2 border-t border-border-subtle bg-surface pt-3">
      {notice && (
        <Alert variant="success" onDismiss={onDismissNotice}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert variant="danger" onDismiss={onDismissError}>
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          已选 {count} 项
          {count > 0 ? ' · 跨页选择会保留' : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {count > 0 && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
              清空
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={busy || count === 0 || confirmDisabled}
            loading={busy}
            onClick={onConfirm}
          >
            {label}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CharactersTab({
  active,
  draft,
  onAddActors,
  onReplaceActors,
}: {
  active: boolean;
  draft: WorldAuthoringDraft;
  onAddActors: (actors: WorldActor[]) => void;
  onReplaceActors?: (actors: WorldActor[]) => void;
}) {
  const browser = useCharacterBrowser({}, active);
  const [selected, setSelected] = useState<Record<string, ActorVersionSelection>>({});
  const [versionLoadingId, setVersionLoadingId] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const actors = draft.definition.actors;
  const pageSize = browser.filter.pageSize ?? PAGE_SIZES[0];
  const total = browser.data?.total ?? 0;
  const changeQuery = browser.change;

  useEffect(() => {
    changeQuery({ q: deferredQuery, page: 1 });
  }, [deferredQuery, changeQuery]);

  const changePage = (next: number) => {
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    browser.change({ page: Math.min(Math.max(1, next), lastPage) });
  };

  const changePageSize = (nextPageSize: number) => {
    browser.change({ pageSize: nextPageSize, page: 1 });
  };

  const toggle = async (profile: CharacterProfile) => {
    if (selected[profile.id]) {
      setSelected((current) => toggleRecord(current, profile.id, current[profile.id]));
      setError('');
      setNotice('');
      return;
    }
    if (!profile.latestVersion) {
      setError(`角色「${profile.displayName}」还没有已发布版本，不能建立真实快照。`);
      return;
    }
    setVersionLoadingId(profile.id);
    setError('');
    setNotice('');
    try {
      const detail = await fetchCharacterDetail(profile.id);
      const versions = [...detail.versions].sort(
        (left, right) => right.version - left.version,
      );
      const version = resolveCharacterVersion(versions, profile.latestVersion);
      if (!version) {
        setError(`角色「${profile.displayName}」的已发布版本不可读取。`);
        return;
      }
      const currentActor = actors.find(
        (actor) => actor.characterId === profile.id,
      ) ?? null;
      setSelected((current) => ({
        ...current,
        [profile.id]: {
          profile: detail,
          versions,
          version: version.version,
          actorId: currentActor?.id ?? null,
          draftSignature: actorDraftSignature(currentActor),
        },
      }));
    } catch (versionError) {
      setError(describeError(versionError));
    } finally {
      setVersionLoadingId('');
    }
  };

  const chooseVersion = (profileId: string, version: number) => {
    setSelected((current) => {
      const entry = current[profileId];
      if (!entry) return current;
      return {
        ...current,
        [profileId]: { ...entry, version },
      };
    });
    setError('');
    setNotice('');
  };

  const updateCandidates = useMemo(
    () => actorUpdateCandidates(Object.values(selected), actors),
    [selected, actors],
  );
  const selectionLookups = Object.values(selected).map((selection) => ({
    selection,
    lookup: resolveActorSelection(selection, actors),
  }));
  const blockedSelections = selectionLookups.filter(
    ({ lookup }) => Boolean(lookup.blocked),
  );
  const staleSelections = selectionLookups.filter(
    ({ lookup }) => !lookup.blocked && lookup.stale,
  );
  const hasBlockedSelections = blockedSelections.length > 0;
  const hasStaleSelections = staleSelections.length > 0;

  const handleRecheckDraft = () => {
    setSelected((current) => {
      const next: typeof current = {};
      for (const [profileId, entry] of Object.entries(current)) {
        const lookup = resolveActorSelection(entry, actors);
        if (lookup.blocked) {
          next[profileId] = entry;
          continue;
        }
        next[profileId] = {
          ...entry,
          actorId: lookup.current?.id ?? null,
          draftSignature: actorDraftSignature(lookup.current),
        };
      }
      return next;
    });
    setError('');
    setNotice('已按当前草稿重新核对版本差异；请再次确认后再更新。');
  };

  const handleClearBlockedSelections = () => {
    const blockedProfileIds = new Set(
      blockedSelections.map(({ selection }) => selection.profile.id),
    );
    setSelected((current) => {
      const next: typeof current = {};
      for (const [profileId, entry] of Object.entries(current)) {
        if (!blockedProfileIds.has(profileId)) next[profileId] = entry;
      }
      return next;
    });
    setError('');
    setNotice('已移除失效选择；请按当前草稿重新选择人物版本。');
  };

  const handleImport = async () => {
    if (importing) return;
    if (hasBlockedSelections) {
      setError('当前草稿中的人物已删除、解绑或更换身份。请移除失效选择后重新选择。');
      return;
    }
    if (hasStaleSelections) {
      setError('当前草稿中的人物已发生变化。请先按当前草稿重新核对差异，再确认加入。');
      return;
    }
    const candidates = Object.values(selected).filter(
      (entry) => entry.actorId === null && !actors.some(
        (actor) => actor.characterId === entry.profile.id,
      ),
    );
    if (!candidates.length) {
      setError('所选角色已经在当前世界中；请在角色卡选择新版本并确认更新。');
      return;
    }
    const locationId = draft.definition.locations[0]?.id;
    if (!locationId) {
      setError('请先在主页面添加至少一个地点，再引入角色库人物。');
      return;
    }
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const nextActors: WorldActor[] = [];
      for (const entry of candidates) {
        const version = resolveCharacterVersion(entry.versions, entry.version);
        if (!version) {
          throw new Error(`角色「${entry.profile.displayName}」的所选版本不可读取。`);
        }
        nextActors.push(actorFromCharacterVersion(entry.profile, version, locationId));
      }
      const added = mergeActors(actors, nextActors).length - actors.length;
      if (!added) {
        setError('所选角色已经在当前世界中；请在角色卡选择新版本并确认更新。');
        return;
      }
      onAddActors(nextActors);
      setSelected({});
      setNotice(`已加入 ${added} 位人物，使用已发布版本快照。`);
    } catch (importError) {
      setError(describeError(importError));
    } finally {
      setImporting(false);
    }
  };

  const handleVersionUpdate = () => {
    if (hasBlockedSelections) {
      setError('当前草稿中的人物已删除、解绑或更换身份。旧候选已失效，请移除选择后重新选择。');
      return;
    }
    if (hasStaleSelections) {
      setError('当前草稿中的人物已发生变化。请先按当前草稿重新核对差异，再确认更新。');
      return;
    }
    if (!updateCandidates.length) {
      setError('所选版本与当前人物快照相同，没有需要更新的内容。');
      return;
    }
    const replace = onReplaceActors ?? onAddActors;
    replace(updateCandidates.map((item) => item.incoming));
    setSelected({});
    setNotice(`已更新 ${updateCandidates.length} 位人物；地点、身份和媒体引用保持不变。`);
    setError('');
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="搜索角色库"
          placeholder="按名称搜索角色库"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="flex-1"
        />
        <p className="text-xs leading-relaxed text-muted">
          已发布角色可加入并选择版本；未发布角色需先在角色库发布。
        </p>
      </div>

      {browser.isError && (
        <QueryError
          title="角色库读取失败"
          error={browser.error}
          onRetry={() => void browser.refetch()}
        />
      )}
      {browser.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" label="正在读取角色库…" />
        </div>
      ) : null}
      {!browser.isLoading
        && !browser.isError
        && (browser.data?.items.length ?? 0) === 0 && (
          <EmptyState
            icon={UserRound}
            title="没有匹配角色"
            description="调整搜索词，或先在角色库发布一个版本。"
          />
        )}

      <div className="grid gap-2 sm:grid-cols-2">
        {(browser.data?.items ?? []).map((profile) => {
          const existing = draft.definition.actors.find(
            (actor) => actor.characterId === profile.id,
          );
          const added = Boolean(existing);
          const selectedItem = selected[profile.id];
          const unavailable = !profile.latestVersion;
          return (
            <div
              key={profile.id}
              className="space-y-2"
            >
              <div
                className={[
                  'flex items-start gap-3 rounded-panel border p-3 transition-colors',
                  selectedItem
                    ? 'border-accent bg-[var(--selection-bg)]'
                    : 'border-border-subtle bg-surface',
                ].join(' ')}
              >
                <Checkbox
                  aria-label={`选择 ${profile.displayName}`}
                    checked={Boolean(selectedItem)}
                  disabled={unavailable || importing || versionLoadingId === profile.id}
                  onChange={() => void toggle(profile)}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  disabled={unavailable || importing || versionLoadingId === profile.id}
                  onClick={() => void toggle(profile)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-9 shrink-0 place-items-center rounded-control bg-surface-sunken text-sm font-semibold text-muted">
                      {profile.displayName.slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {profile.displayName}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {profile.draft.work || '未分类'}
                        {profile.latestVersion
                          ? ` · 已发布 v${profile.latestVersion}`
                          : ' · 尚无已发布版本'}
                      </span>
                    </span>
                  </span>
                  <span className="mt-2 line-clamp-2 block text-xs leading-relaxed text-muted">
                    {profile.draft.summary || '没有角色摘要'}
                  </span>
                  {added && (
                    <Badge variant="secondary" className="mt-2">
                      已在当前世界
                      {existing?.characterVersion
                        ? ` · v${existing.characterVersion}`
                        : ''}
                    </Badge>
                  )}
                  {versionLoadingId === profile.id && (
                    <span className="mt-2 block text-xs text-muted">
                      正在读取已发布版本…
                    </span>
                  )}
                </button>
              </div>
              {selectedItem && (
                <label className="flex flex-wrap items-center gap-2 rounded-panel bg-surface-sunken px-3 py-2 text-xs text-muted">
                  <span className="font-medium text-ink">采用版本</span>
                  <Select
                    aria-label={`选择 ${profile.displayName} 的版本`}
                    value={String(selectedItem.version ?? '')}
                    disabled={importing}
                    className="min-w-32 flex-1"
                    onChange={(event) => chooseVersion(
                      profile.id,
                      Number(event.target.value),
                    )}
                  >
                    {selectedItem.versions.map((version) => (
                      <option key={version.version} value={version.version}>
                        v{version.version}
                        {version.version === profile.latestVersion ? ' · 最新' : ''}
                        {` · ${version.createdAt}`}
                      </option>
                    ))}
                  </Select>
                  {existing && selectedItem.version !== null
                    && selectedItem.version !== existing.characterVersion && (
                      <span className="basis-full text-warning-fg">
                        将从 v{existing.characterVersion ?? '未绑定'}
                        {' '}更新到 v{selectedItem.version}；确认后替换同一个人物快照。
                      </span>
                    )}
                </label>
              )}
            </div>
          );
        })}
      </div>

      <CharacterPagination
        data={browser.data}
        onPage={changePage}
        onPageSizeChange={changePageSize}
        loading={browser.isFetching}
      />

      <SelectionActions
        count={Object.keys(selected).length}
        busy={importing}
        confirmDisabled={hasStaleSelections || hasBlockedSelections}
        label="确认加入人物"
        onConfirm={() => void handleImport()}
        onClear={() => setSelected({})}
        notice={notice}
        error={error}
        onDismissNotice={() => setNotice('')}
        onDismissError={() => setError('')}
      />

      {hasBlockedSelections && (
        <Alert variant="danger" title="人物绑定已变化">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              当前草稿中的所选人物已删除、解除角色库绑定或更换身份。旧候选不会恢复，请移除失效选择后重新选择。
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={importing}
              onClick={handleClearBlockedSelections}
            >
              移除失效选择
            </Button>
          </div>
        </Alert>
      )}

      {hasStaleSelections && (
        <Alert variant="warning" title="草稿中的人物已发生变化">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              版本对照已改用当前草稿中的最新人物内容。请重新核对完整差异后再确认更新，避免覆盖后台修改。
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={importing}
              onClick={handleRecheckDraft}
            >
              按当前草稿重新核对
            </Button>
          </div>
        </Alert>
      )}

      {updateCandidates.length > 0 && (
        <div className="space-y-3 rounded-panel border border-border-default bg-surface-raised p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">确认人物版本更新</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              更新只替换所选人物的版本正文；人物 ID、地点、主要人物身份和媒体引用保持不变。
            </p>
          </div>
          <ul className="space-y-3">
            {updateCandidates.map(({ current, incoming }) => {
              const differences = actorVersionDiff(current, incoming);
              return (
                <li key={current.id} className="space-y-2 rounded-control bg-surface p-3">
                  <p className="text-sm font-medium text-ink">
                    {current.name}
                    {' · '}
                    v{current.characterVersion ?? '未绑定'}
                    {' → '}
                    v{incoming.characterVersion ?? '未绑定'}
                  </p>
                  <p className="text-xs text-muted">
                    保留：地点「{draft.definition.locations.find(
                      (location) => location.id === current.locationId,
                    )?.name ?? current.locationId}」
                    {' · '}
                    {current.role === 'main' ? '主要人物' : '配角'}
                    {' · '}
                    {current.referenceArtifactIds.length} 个媒体引用
                  </p>
                  {differences.length ? (
                    <VersionDifferenceList differences={differences} />
                  ) : (
                    <p className="text-xs text-muted">
                      版本号变化，但快照正文与当前人物一致。
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={importing}
              onClick={() => {
                setSelected({});
              }}
            >
              取消更新
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={importing}
              disabled={importing || hasStaleSelections || hasBlockedSelections}
              onClick={handleVersionUpdate}
            >
              确认更新 {updateCandidates.length} 位人物
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function KnowledgeTab({
  active,
  draft,
  onAddSources,
  onReplaceSources,
}: {
  active: boolean;
  draft: WorldAuthoringDraft;
  onAddSources: (sources: WorldSource[]) => void;
  onReplaceSources?: (sources: WorldSource[]) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedText(query);
  const [selected, setSelected] = useState<Record<string, KnowledgePendingItem>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const pending = useQuery({
    queryKey: [
      'story-worlds',
      'authoring',
      'resource-picker',
      'knowledge',
      debouncedQuery,
      page,
      pageSize,
    ],
    queryFn: () => fetchPending({
      state: 'kept',
      q: debouncedQuery.trim() || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    enabled: active,
    staleTime: 30_000,
  });

  const visibleItems = pending.data?.items ?? [];
  const incomingSources = Object.values(selected).map(sourceFromKeptKnowledge);
  const updates = sourceUpdateCandidates(
    draft.definition.sources,
    incomingSources,
  );
  const newSources = newSourcesOnly(
    draft.definition.sources,
    incomingSources,
  );

  const toggle = (item: KnowledgePendingItem) => {
    setSelected((current) => toggleRecord(current, item.id, item));
    setError('');
    setNotice('');
  };

  const handleImport = () => {
    if (!newSources.length && !updates.length) {
      setError('所选资料与当前来源相同，没有需要加入或更新的内容。');
      return;
    }
    if (newSources.length) onAddSources(newSources);
    if (updates.length) {
      const replace = onReplaceSources ?? onAddSources;
      replace(updates.map((item) => item.merged));
    }
    setSelected({});
    setNotice([
      newSources.length ? `已加入 ${newSources.length} 条资料` : '',
      updates.length ? `已更新 ${updates.length} 条资料版本` : '',
    ].filter(Boolean).join('，') + '；性质标记为待核实。');
    setError('');
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="筛选已保留资料"
          placeholder="搜索资料标题、摘要、来源或搜集名称"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          className="flex-1"
        />
        <p className="text-xs leading-relaxed text-muted">
          只读取已保留条目；搜索会匹配全部资料后分页。
        </p>
      </div>

      {pending.isError && (
        <QueryError
          title="资料库读取失败"
          error={pending.error}
          onRetry={() => void pending.refetch()}
        />
      )}
      {pending.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" label="正在读取资料库…" />
        </div>
      ) : null}
      {!pending.isLoading
        && !pending.isError
        && (pending.data?.items.length ?? 0) === 0 && (
          <EmptyState
            icon={Library}
            title="没有已保留资料"
            description="先在资料库保留条目，再回来加入世界来源。"
          />
        )}
      {!pending.isLoading
        && !pending.isError
        && (pending.data?.items.length ?? 0) > 0
        && visibleItems.length === 0 && (
          <EmptyState
            icon={Search}
            title="没有匹配资料"
            description="清空搜索，或换一个关键词。"
          />
        )}
      <div className="space-y-2">
        {visibleItems.map((item) => {
          const source = sourceFromKeptKnowledge(item);
          const change = sourceChangeState(draft.definition.sources, source);
          const added = change === 'same';
          const updating = change === 'update';
          const selectedItem = Boolean(selected[item.id]);
          return (
            <div
              key={item.id}
              className={[
                'flex items-start gap-3 rounded-panel border p-3 transition-colors',
                selectedItem
                  ? 'border-accent bg-[var(--selection-bg)]'
                  : 'border-border-subtle bg-surface',
              ].join(' ')}
            >
              <Checkbox
                aria-label={`选择资料 ${item.title}`}
                checked={selectedItem}
                disabled={added}
                onChange={() => toggle(item)}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={added}
                onClick={() => toggle(item)}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-ink">
                    {item.title}
                  </span>
                  <Badge variant="outline">{item.sourceName}</Badge>
                  {item.truncated && <Badge variant="warning">摘要截断</Badge>}
                  {added && <Badge variant="secondary">已加入</Badge>}
                  {updating && <Badge variant="warning">可更新版本</Badge>}
                </span>
                <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                  {item.excerpt || '没有摘要'}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {item.collectionName} · 采集于 {item.retrievedAt}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <Pagination
        total={pending.data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        loading={pending.isFetching}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
      />

      <SelectionActions
        count={Object.keys(selected).length}
        busy={false}
        label="确认加入资料"
        onConfirm={handleImport}
        onClear={() => setSelected({})}
        notice={notice}
        error={error}
        onDismissNotice={() => setNotice('')}
        onDismissError={() => setError('')}
      />

      {updates.length > 0 && (
        <div className="space-y-3 rounded-panel border border-border-default bg-surface-raised p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">确认资料版本更新</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              同一条资料将保留原来源 ID，并替换为所选版本快照；不会静默跳过。
            </p>
          </div>
          <ul className="space-y-3">
            {updates.map(({ current, incoming, merged }) => {
              const differences = sourceVersionDiff(current, incoming);
              return (
                <li key={current.id} className="space-y-2 rounded-control bg-surface p-3">
                  <p className="text-sm font-medium text-ink">
                    {current.title}
                    {' · '}
                    {current.sourceVersion}
                    {' → '}
                    {incoming.sourceVersion}
                  </p>
                  <p className="text-xs text-muted">
                    保留来源 ID：{current.id}
                    {merged.sourceUrl ? ` · ${merged.sourceUrl}` : ''}
                  </p>
                  <VersionDifferenceList differences={differences} />
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">
            点击底部确认后写入更新；更新不会自动发生。
          </p>
        </div>
      )}
    </div>
  );
}

function NotesTab({
  active,
  draft,
  onAddSources,
  onReplaceSources,
}: {
  active: boolean;
  draft: WorldAuthoringDraft;
  onAddSources: (sources: WorldSource[]) => void;
  onReplaceSources?: (sources: WorldSource[]) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedText(query);
  const [loadedQuery, setLoadedQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, CreativeNote>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (loadedQuery !== debouncedQuery) {
    setLoadedQuery(debouncedQuery);
    setPage(1);
  }

  const notes = useQuery({
    queryKey: [
      'story-worlds',
      'authoring',
      'resource-picker',
      'notes',
      debouncedQuery,
      page,
      pageSize,
    ],
    queryFn: () => fetchNotes({
      q: debouncedQuery.trim() || undefined,
      page,
      pageSize,
    }),
    enabled: active,
    staleTime: 30_000,
  });
  const incomingSources = Object.values(selected).map(sourceFromNote);
  const updates = sourceUpdateCandidates(
    draft.definition.sources,
    incomingSources,
  );
  const newSources = newSourcesOnly(
    draft.definition.sources,
    incomingSources,
  );

  const toggle = (note: CreativeNote) => {
    const key = note.id ?? sourceFromNote(note).id;
    setSelected((current) => toggleRecord(current, key, note));
    setError('');
    setNotice('');
  };

  const handleImport = () => {
    if (!newSources.length && !updates.length) {
      setError('所选笔记与当前来源相同，没有需要加入或更新的内容。');
      return;
    }
    if (newSources.length) onAddSources(newSources);
    if (updates.length) {
      const replace = onReplaceSources ?? onAddSources;
      replace(updates.map((item) => item.merged));
    }
    setSelected({});
    setNotice([
      newSources.length ? `已加入 ${newSources.length} 条笔记` : '',
      updates.length ? `已更新 ${updates.length} 条笔记版本` : '',
    ].filter(Boolean).join('，') + '。');
    setError('');
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="搜索笔记"
          placeholder="按标题或内容搜索笔记"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          className="flex-1"
        />
        <p className="text-xs leading-relaxed text-muted">
          加入时复制笔记正文与资料性质。
        </p>
      </div>

      {notes.isError && (
        <QueryError
          title="笔记读取失败"
          error={notes.error}
          onRetry={() => void notes.refetch()}
        />
      )}
      {notes.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" label="正在读取笔记…" />
        </div>
      ) : null}
      {!notes.isLoading
        && !notes.isError
        && (notes.data?.items.length ?? 0) === 0 && (
          <EmptyState
            icon={FileText}
            title={debouncedQuery.trim() ? '没有匹配笔记' : '还没有笔记'}
            description={debouncedQuery.trim()
              ? '换一个关键词，或清空搜索。'
              : '先在笔记库写下可参考的内容。'}
          />
        )}

      <div className="space-y-2">
        {(notes.data?.items ?? []).map((note) => {
          const source = sourceFromNote(note);
          const key = note.id ?? source.id;
          const change = sourceChangeState(draft.definition.sources, source);
          const added = change === 'same';
          const updating = change === 'update';
          const selectedItem = Boolean(selected[key]);
          return (
            <div
              key={key}
              className={[
                'flex items-start gap-3 rounded-panel border p-3 transition-colors',
                selectedItem
                  ? 'border-accent bg-[var(--selection-bg)]'
                  : 'border-border-subtle bg-surface',
              ].join(' ')}
            >
              <Checkbox
                aria-label={`选择笔记 ${note.title}`}
                checked={selectedItem}
                disabled={added}
                onChange={() => toggle(note)}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={added}
                onClick={() => toggle(note)}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-ink">
                    {note.title}
                  </span>
                  <Badge variant="outline">{note.kind}</Badge>
                  {note.knowledge?.nature && (
                    <Badge variant="secondary">{note.knowledge.nature}</Badge>
                  )}
                  {added && <Badge variant="secondary">已加入</Badge>}
                  {updating && <Badge variant="warning">可更新版本</Badge>}
                </span>
                <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                  {note.summary || source.content.slice(0, 180) || '没有摘要'}
                </span>
                {note.updatedAt && (
                  <span className="mt-1 block text-xs text-muted">
                    更新于 {note.updatedAt}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <Pagination
        total={notes.data?.total ?? (notes.data?.items.length ?? 0)}
        page={page}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        loading={notes.isFetching || loadedQuery !== debouncedQuery}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
      />

      <SelectionActions
        count={Object.keys(selected).length}
        busy={false}
        label="确认加入笔记"
        onConfirm={handleImport}
        onClear={() => setSelected({})}
        notice={notice}
        error={error}
        onDismissNotice={() => setNotice('')}
        onDismissError={() => setError('')}
      />

      {updates.length > 0 && (
        <div className="space-y-3 rounded-panel border border-border-default bg-surface-raised p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">确认笔记版本更新</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              同一条笔记保留原来源 ID，并替换为所选修订快照。
            </p>
          </div>
          <ul className="space-y-3">
            {updates.map(({ current, incoming }) => (
              <li key={current.id} className="space-y-2 rounded-control bg-surface p-3">
                <p className="text-sm font-medium text-ink">
                  {current.title}
                  {' · '}
                  {current.sourceVersion}
                  {' → '}
                  {incoming.sourceVersion}
                </p>
                <VersionDifferenceList
                  differences={sourceVersionDiff(current, incoming)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NarrativeTab({
  active,
  draft,
  onAddSources,
  onReplaceSources,
}: {
  active: boolean;
  draft: WorldAuthoringDraft;
  onAddSources: (sources: WorldSource[]) => void;
  onReplaceSources?: (sources: WorldSource[]) => void;
}) {
  const [selectedWorkId, setSelectedWorkId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<Record<string, {
    work: NarrativeWork;
    node: NarrativeStoryNode;
  }>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const works = useQuery({
    queryKey: ['story-worlds', 'authoring', 'resource-picker', 'narrative-works'],
    queryFn: fetchWorks,
    enabled: active,
    staleTime: 60_000,
  });

  const workId = selectedWorkId || works.data?.items[0]?.id || '';

  const tree = useQuery({
    queryKey: ['story-worlds', 'authoring', 'resource-picker', 'narrative-tree', workId],
    queryFn: () => fetchWorkTree(workId),
    enabled: active && Boolean(workId),
    staleTime: 60_000,
  });

  const activeWork = works.data?.items.find((work) => work.id === workId);
  const filteredNodes = useMemo(
    () => filterNarrativeNodes(tree.data?.items ?? [], deferredQuery),
    [deferredQuery, tree.data],
  );

  const pageNodes = pageItems(filteredNodes, page, pageSize);
  const toggle = (work: NarrativeWork, node: NarrativeStoryNode) => {
    setSelected((current) => toggleRecord(current, node.id, { work, node }));
    setError('');
    setNotice('');
  };

  const handleImport = async () => {
    if (importing) return;
    const selections = Object.values(selected);
    if (!selections.length) {
      setError('请先选择叙事节点。');
      return;
    }
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const sources: WorldSource[] = [];
      for (const { work, node } of selections) {
        const reading: NarrativeReading = await fetchReadingNode(node.id);
        sources.push(sourceFromNarrative(work, node, reading));
      }
      const pendingUpdates = sourceUpdateCandidates(
        draft.definition.sources,
        sources,
      );
      const newSources = newSourcesOnly(
        draft.definition.sources,
        sources,
      );
      if (!newSources.length && !pendingUpdates.length) {
        setError('所选叙事节点与当前来源相同，没有需要加入或更新的内容。');
        return;
      }
      if (newSources.length) onAddSources(newSources);
      if (pendingUpdates.length) {
        const replace = onReplaceSources ?? onAddSources;
        replace(pendingUpdates.map((item) => item.merged));
      }
      setSelected({});
      setNotice([
        newSources.length ? `已加入 ${newSources.length} 条叙事来源` : '',
        pendingUpdates.length ? `已更新 ${pendingUpdates.length} 条叙事来源` : '',
      ].filter(Boolean).join('，') + '。');
    } catch (importError) {
      setError(describeError(importError));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">叙事作品</span>
          <Select
            aria-label="选择叙事作品"
            value={workId}
            onChange={(event) => {
              setSelectedWorkId(event.target.value);
              setSelected({});
              setPage(1);
              setError('');
              setNotice('');
            }}
          >
            <option value="">选择作品</option>
            {(works.data?.items ?? []).map((work) => (
              <option key={work.id} value={work.id}>
                {work.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">筛选节点</span>
          <Input
            aria-label="筛选叙事节点"
            placeholder="按标题、摘要或节点类型筛选"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      {works.isError && (
        <QueryError
          title="叙事作品读取失败"
          error={works.error}
          onRetry={() => void works.refetch()}
        />
      )}
      {works.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" label="正在读取叙事作品…" />
        </div>
      ) : null}
      {!works.isLoading
        && !works.isError
        && (works.data?.items.length ?? 0) === 0 && (
          <EmptyState
            icon={ListTree}
            title="还没有叙事作品"
            description="先在叙事档案导入或创建作品。"
          />
        )}

      {tree.isError && (
        <QueryError
          title="叙事节点读取失败"
          error={tree.error}
          onRetry={() => void tree.refetch()}
        />
      )}
      {tree.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" label="正在读取叙事节点…" />
        </div>
      ) : null}
      {!tree.isLoading
        && !tree.isError
        && workId
        && (tree.data?.items.length ?? 0) === 0 && (
          <EmptyState
            icon={ListTree}
            title="这个作品没有节点"
            description="换一个作品，或先在叙事档案补充节点。"
          />
        )}
      {!tree.isLoading
        && !tree.isError
        && (tree.data?.items.length ?? 0) > 0
        && filteredNodes.length === 0 && (
          <EmptyState
            icon={Search}
            title="没有匹配节点"
            description="清空筛选，或换一个关键词。"
          />
        )}

      <div className="space-y-2">
        {pageNodes.map((node) => {
          const existing = draft.definition.sources.find(
            (source) => source.id === `source-narrative-${node.id}`,
          );
          const added = Boolean(existing);
          const selectedItem = Boolean(selected[node.id]);
          return (
            <div
              key={node.id}
              className={[
                'flex items-start gap-3 rounded-panel border p-3 transition-colors',
                selectedItem
                  ? 'border-accent bg-[var(--selection-bg)]'
                  : 'border-border-subtle bg-surface',
              ].join(' ')}
            >
              <Checkbox
                aria-label={`选择叙事节点 ${node.title}`}
                checked={selectedItem}
                disabled={!activeWork}
                onChange={() => {
                  if (activeWork) toggle(activeWork, node);
                }}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={!activeWork}
                onClick={() => {
                  if (activeWork) toggle(activeWork, node);
                }}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-ink">
                    {node.title}
                  </span>
                  <Badge variant="outline">{node.kind}</Badge>
                  {added && (
                    <Badge variant="secondary">
                      已加入 · {existing?.sourceVersion}
                    </Badge>
                  )}
                </span>
                <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                  {node.summary || '没有节点摘要'}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <Pagination
        total={filteredNodes.length}
        page={page}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        loading={tree.isFetching}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
      />

      <SelectionActions
        count={Object.keys(selected).length}
        busy={importing}
        label="确认加入叙事"
        onConfirm={() => void handleImport()}
        onClear={() => setSelected({})}
        notice={notice}
        error={error}
        onDismissNotice={() => setNotice('')}
        onDismissError={() => setError('')}
      />
    </div>
  );
}

function ProjectTab({
  active,
  draft,
  projectId,
  onAddActors,
  onAddSources,
  onReplaceActors,
  onReplaceSources,
}: {
  active: boolean;
  draft: WorldAuthoringDraft;
  projectId?: string;
  onAddActors: (actors: WorldActor[]) => void;
  onAddSources: (sources: WorldSource[]) => void;
  onReplaceActors?: (actors: WorldActor[]) => void;
  onReplaceSources?: (sources: WorldSource[]) => void;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '');
  const [section, setSection] = useState<ProjectSection>('documents');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedDocuments, setSelectedDocuments] = useState<Record<string, StoryDocument>>({});
  const [selectedCharacters, setSelectedCharacters] = useState<Record<string, ProjectCharacter>>({});
  const [selectedLinks, setSelectedLinks] = useState<Record<string, ProjectLink>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const projects = useQuery({
    queryKey: ['story-worlds', 'authoring', 'resource-picker', 'projects'],
    queryFn: () => projectsApi.list(),
    enabled: active,
    staleTime: 60_000,
  });

  const effectiveProjectId = selectedProjectId
    || projects.data?.items[0]?.project.id
    || '';

  const overview = useQuery({
    queryKey: ['story-worlds', 'authoring', 'resource-picker', 'project-overview', effectiveProjectId],
    queryFn: () => projectsApi.overview(effectiveProjectId),
    enabled: active && Boolean(effectiveProjectId),
    staleTime: 30_000,
  });

  const filteredDocuments = useMemo(
    () => filterByText(
      overview.data?.documents ?? [],
      deferredQuery,
      (document) => [document.title, document.body, document.kind],
    ),
    [deferredQuery, overview.data],
  );

  const filteredCharacters = useMemo(
    () => filterByText(
      overview.data?.characters ?? [],
      deferredQuery,
      (character) => [character.name, character.notes],
    ),
    [deferredQuery, overview.data],
  );

  const filteredLinks = useMemo(
    () => filterByText(
      overview.data?.links ?? [],
      deferredQuery,
      (link) => [link.title, link.excerpt, link.kind, link.nature],
    ),
    [deferredQuery, overview.data],
  );

  const activeCount = section === 'documents'
    ? filteredDocuments.length
    : section === 'characters'
      ? filteredCharacters.length
      : filteredLinks.length;
  const pageDocuments = pageItems(filteredDocuments, page, pageSize);
  const pageCharacters = pageItems(filteredCharacters, page, pageSize);
  const pageLinks = pageItems(filteredLinks, page, pageSize);
  const projectActorUpdates = useMemo(() => {
    if (!overview.data) return [];
    const updates: Array<{ current: WorldActor; incoming: WorldActor }> = [];
    for (const character of Object.values(selectedCharacters)) {
      if (!character.sourceCharacterId || !character.sourceVersion) continue;
      const current = draft.definition.actors.find(
        (actor) => actor.characterId === character.sourceCharacterId,
      );
      if (!current || current.characterVersion === character.sourceVersion) continue;
      updates.push({
        current,
        incoming: {
          ...current,
          characterVersion: character.sourceVersion,
          name: character.name,
          background: character.notes,
        },
      });
    }
    return updates;
  }, [draft.definition.actors, overview.data, selectedCharacters]);
  const projectSourceUpdates = useMemo(() => {
    if (!overview.data) return [];
    const projectTitle = overview.data.project.title;
    const selectedSources = [
      ...Object.values(selectedDocuments).map((document) => (
        sourceFromProjectDocument(projectTitle, document)
      )),
      ...Object.values(selectedLinks).map((link) => (
        sourceFromProjectLink(projectTitle, link)
      )),
    ];
    return sourceUpdateCandidates(
      draft.definition.sources,
      selectedSources,
    );
  }, [draft.definition.sources, overview.data, selectedDocuments, selectedLinks]);
  const selectedCount = Object.keys(selectedDocuments).length
    + Object.keys(selectedCharacters).length
    + Object.keys(selectedLinks).length;

  const toggleDocument = (document: StoryDocument) => {
    setSelectedDocuments((current) => toggleRecord(current, document.id, document));
    setError('');
    setNotice('');
  };

  const toggleCharacter = (character: ProjectCharacter) => {
    setSelectedCharacters((current) => toggleRecord(current, character.id, character));
    setError('');
    setNotice('');
  };

  const toggleLink = (link: ProjectLink) => {
    setSelectedLinks((current) => toggleRecord(current, link.id, link));
    setError('');
    setNotice('');
  };

  const handleImport = async () => {
    if (importing || !overview.data) return;
    const documents = Object.values(selectedDocuments);
    const characters = Object.values(selectedCharacters);
    const links = Object.values(selectedLinks);
    if (!documents.length && !characters.length && !links.length) {
      setError('请先选择要加入的项目内容。');
      return;
    }
    const locationId = draft.definition.locations[0]?.id;
    if (characters.length && !locationId) {
      setError('请先在主页面添加至少一个地点，再引入项目角色。');
      return;
    }
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const actors: WorldActor[] = [];
      for (const character of characters) {
        if (character.sourceCharacterId && character.sourceVersion) {
          const detail = await fetchCharacterDetail(character.sourceCharacterId);
          const version = detail.versions.find(
            (item) => item.version === character.sourceVersion,
          );
          if (!version) {
            throw new Error(`项目角色「${character.name}」的来源版本 v${character.sourceVersion} 不可读取。`);
          }
          actors.push(actorFromCharacterVersion(detail, version, locationId!));
        } else {
          actors.push(actorFromProjectCharacter(character, locationId!));
        }
      }
      const projectTitle = overview.data.project.title;
      const sources = [
        ...documents.map((document) => sourceFromProjectDocument(projectTitle, document)),
        ...links.map((link) => sourceFromProjectLink(projectTitle, link)),
      ];
      const newActors: WorldActor[] = [];
      for (const actor of actors) {
        if (actorAlreadyPresent([...draft.definition.actors, ...newActors], actor)) continue;
        newActors.push(actor);
      }
      const actorUpdates: Array<{ current: WorldActor; incoming: WorldActor }> = [];
      for (const incoming of actors) {
        const current = incoming.characterId
          ? draft.definition.actors.find((actor) => actor.characterId === incoming.characterId)
          : undefined;
        if (!current || current.characterVersion === incoming.characterVersion) continue;
        const merged = mergeActorVersion(current, incoming);
        if (actorUpdates.some((item) => item.current.id === current.id)) continue;
        actorUpdates.push({ current, incoming: merged });
      }
      const sourceUpdates = sourceUpdateCandidates(
        draft.definition.sources,
        sources,
      );
      const newSources = newSourcesOnly(draft.definition.sources, sources);
      if (!newActors.length && !newSources.length && !sourceUpdates.length && !actorUpdates.length) {
        setError('所选内容已经在当前世界中。');
        return;
      }
      if (newActors.length) onAddActors(newActors);
      if (actorUpdates.length) {
        const replace = onReplaceActors ?? onAddActors;
        replace(actorUpdates.map((item) => item.incoming));
      }
      if (newSources.length) onAddSources(newSources);
      if (sourceUpdates.length) {
        const replace = onReplaceSources ?? onAddSources;
        replace(sourceUpdates.map((item) => item.merged));
      }
      setSelectedDocuments({});
      setSelectedCharacters({});
      setSelectedLinks({});
      setNotice(`已加入 ${newActors.length} 位人物、${newSources.length} 条来源；更新 ${actorUpdates.length} 位人物、${sourceUpdates.length} 条来源。`);
    } catch (importError) {
      setError(describeError(importError));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">创作项目</span>
          <Select
            aria-label="选择创作项目"
            value={effectiveProjectId}
            onChange={(event) => {
              setSelectedProjectId(event.target.value);
              setSelectedDocuments({});
              setSelectedCharacters({});
              setSelectedLinks({});
              setPage(1);
              setQuery('');
              setError('');
              setNotice('');
            }}
          >
            <option value="">选择项目</option>
            {(projects.data?.items ?? []).map(({ project }) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">筛选当前分类</span>
          <Input
            aria-label="筛选项目内容"
            placeholder="按标题、正文或名称筛选"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      {projects.isError && (
        <QueryError
          title="创作项目读取失败"
          error={projects.error}
          onRetry={() => void projects.refetch()}
        />
      )}
      {projects.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" label="正在读取创作项目…" />
        </div>
      ) : null}
      {!projects.isLoading
        && !projects.isError
        && (projects.data?.items.length ?? 0) === 0 && (
          <EmptyState
            icon={FolderOpen}
            title="还没有创作项目"
            description="先在创作项目中建立文档、角色或参考资料。"
          />
        )}

      {effectiveProjectId && overview.isError && (
        <QueryError
          title="项目内容读取失败"
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      )}
      {effectiveProjectId && overview.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" label="正在读取项目内容…" />
        </div>
      ) : null}

      {overview.data && (
        <>
          <PageTabs
            variant="local"
            ariaLabel="项目内容分类"
            value={section}
            onChange={(next) => {
              setSection(next as ProjectSection);
              setQuery('');
              setPage(1);
            }}
            tabs={[
              {
                id: 'documents',
                label: PROJECT_SECTION_LABELS.documents,
                count: overview.data.documents.length,
              },
              {
                id: 'characters',
                label: PROJECT_SECTION_LABELS.characters,
                count: overview.data.characters.length,
              },
              {
                id: 'links',
                label: PROJECT_SECTION_LABELS.links,
                count: overview.data.links.length,
              },
            ]}
          />

          <div className="space-y-2">
            {section === 'documents' && pageDocuments.map((document) => {
              const source = sourceFromProjectDocument(
                overview.data.project.title,
                document,
              );
              const change = sourceChangeState(draft.definition.sources, source);
              const added = change === 'same';
              const updating = change === 'update';
              const selectedItem = Boolean(selectedDocuments[document.id]);
              return (
                <div
                  key={document.id}
                  className={[
                    'flex items-start gap-3 rounded-panel border p-3 transition-colors',
                    selectedItem
                      ? 'border-accent bg-[var(--selection-bg)]'
                      : 'border-border-subtle bg-surface',
                  ].join(' ')}
                >
                  <Checkbox
                    aria-label={`选择项目文档 ${document.title}`}
                    checked={selectedItem}
                    disabled={added}
                    onChange={() => toggleDocument(document)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    disabled={added}
                    onClick={() => toggleDocument(document)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {document.title}
                      </span>
                      <Badge variant="outline">
                        {DOCUMENT_KIND_LABELS[document.kind]}
                      </Badge>
                      <Badge variant="secondary">修订 {document.revision}</Badge>
                      {added && <Badge variant="secondary">已加入</Badge>}
                      {updating && <Badge variant="warning">可更新版本</Badge>}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                      {previewText(document.body) || '没有正文'}
                    </span>
                  </button>
                </div>
              );
            })}

            {section === 'characters' && pageCharacters.map((character) => {
              const existing = character.sourceCharacterId
                ? draft.definition.actors.find(
                    (actor) => actor.characterId === character.sourceCharacterId,
                  )
                : undefined;
              const added = projectCharacterAlreadyPresent(
                draft.definition.actors,
                character,
              );
              const updating = Boolean(
                existing
                && character.sourceVersion
                && existing.characterVersion !== character.sourceVersion,
              );
              const selectedItem = Boolean(selectedCharacters[character.id]);
              return (
                <div
                  key={character.id}
                  className={[
                    'flex items-start gap-3 rounded-panel border p-3 transition-colors',
                    selectedItem
                      ? 'border-accent bg-[var(--selection-bg)]'
                      : 'border-border-subtle bg-surface',
                  ].join(' ')}
                >
                  <Checkbox
                    aria-label={`选择项目角色 ${character.name}`}
                    checked={selectedItem}
                    disabled={added && !updating}
                    onChange={() => toggleCharacter(character)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    disabled={added && !updating}
                    onClick={() => toggleCharacter(character)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {character.name}
                      </span>
                      {character.sourceCharacterId && character.sourceVersion ? (
                        <Badge variant="online">
                          角色库 v{character.sourceVersion}
                        </Badge>
                      ) : (
                        <Badge variant="outline">项目原创</Badge>
                      )}
                      {added && <Badge variant="secondary">已加入</Badge>}
                      {updating && (
                        <Badge variant="warning">
                          v{existing?.characterVersion ?? '未绑定'} → v{character.sourceVersion}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                      {previewText(character.notes) || '没有项目角色说明'}
                    </span>
                  </button>
                </div>
              );
            })}

            {section === 'links' && pageLinks.map((link) => {
              const source = sourceFromProjectLink(
                overview.data.project.title,
                link,
              );
              const change = sourceChangeState(draft.definition.sources, source);
              const added = change === 'same';
              const updating = change === 'update';
              const selectedItem = Boolean(selectedLinks[link.id]);
              return (
                <div
                  key={link.id}
                  className={[
                    'flex items-start gap-3 rounded-panel border p-3 transition-colors',
                    selectedItem
                      ? 'border-accent bg-[var(--selection-bg)]'
                      : 'border-border-subtle bg-surface',
                  ].join(' ')}
                >
                  <Checkbox
                    aria-label={`选择项目引用 ${link.title}`}
                    checked={selectedItem}
                    disabled={added}
                    onChange={() => toggleLink(link)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    disabled={added}
                    onClick={() => toggleLink(link)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {link.title}
                      </span>
                      <Badge variant="outline">{link.kind}</Badge>
                      {link.nature && (
                        <Badge variant="secondary">{link.nature}</Badge>
                      )}
                      {link.state === 'updated' && (
                        <Badge variant="warning">来源已更新</Badge>
                      )}
                      {link.state === 'missing' && (
                        <Badge variant="error">来源不可用</Badge>
                      )}
                      {added && <Badge variant="secondary">已加入</Badge>}
                      {updating && <Badge variant="warning">可更新版本</Badge>}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                      {previewText(link.excerpt) || '没有引用摘要'}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {activeCount === 0 && (
            <EmptyState
              icon={Search}
              title="当前分类没有匹配内容"
              description="清空筛选，或切换分类继续查找。"
            />
          )}

          <Pagination
            total={activeCount}
            page={page}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZES}
            loading={overview.isFetching}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />

          <SelectionActions
            count={selectedCount}
            busy={importing}
            label="确认加入项目内容"
            onConfirm={() => void handleImport()}
            onClear={() => {
              setSelectedDocuments({});
              setSelectedCharacters({});
              setSelectedLinks({});
            }}
            notice={notice}
            error={error}
            onDismissNotice={() => setNotice('')}
            onDismissError={() => setError('')}
          />

          {projectSourceUpdates.length > 0 && (
            <div className="space-y-3 rounded-panel border border-border-default bg-surface-raised p-4">
              <div>
                <h3 className="text-sm font-semibold text-ink">确认项目来源版本更新</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  这些项目来源将在确认后以原来源 ID 替换为新版本快照。
                </p>
              </div>
              <ul className="space-y-3">
                {projectSourceUpdates.map(({ current, incoming }) => (
                  <li key={current.id} className="space-y-2 rounded-control bg-surface p-3">
                    <p className="text-sm font-medium text-ink">
                      {current.title}
                      {' · '}
                      {current.sourceVersion}
                      {' → '}
                      {incoming.sourceVersion}
                    </p>
                    <VersionDifferenceList
                      differences={sourceVersionDiff(current, incoming)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {projectActorUpdates.length > 0 && (
            <div className="space-y-3 rounded-panel border border-border-default bg-surface-raised p-4">
              <div>
                <h3 className="text-sm font-semibold text-ink">确认项目人物版本更新</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  更新将保留人物地点、身份和媒体引用，并替换为项目所选角色版本。
                </p>
              </div>
              <ul className="space-y-3">
                {projectActorUpdates.map(({ current, incoming }) => (
                  <li key={current.id} className="space-y-2 rounded-control bg-surface p-3">
                    <p className="text-sm font-medium text-ink">
                      {current.name}
                      {' · '}
                      v{current.characterVersion ?? '未绑定'}
                      {' → '}
                      v{incoming.characterVersion ?? '未绑定'}
                    </p>
                    <VersionDifferenceList
                      differences={actorVersionDiff(current, incoming)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WebTab({
  draft,
  onAddSources,
  onReplaceSources,
}: {
  draft: WorldAuthoringDraft;
  onAddSources: (sources: WorldSource[]) => void;
  onReplaceSources?: (sources: WorldSource[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [results, setResults] = useState<WebSearchResult[]>([]);
  const [selected, setSelected] = useState<Record<string, WebSearchResult>>({});
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveStates, setSaveStates] = useState<Record<string, {
    status: 'saving' | 'saved' | 'error';
    id?: string;
    message?: string;
  }>>({});
  const [extractedIds, setExtractedIds] = useState<Record<string, true>>({});
  const selectedItems = Object.values(selected);
  const incomingSources = selectedItems.map(webSourceForDraft);
  const sourceUpdates = sourceUpdateCandidates(
    draft.definition.sources,
    incomingSources,
  );
  const newSources = newSourcesOnly(
    draft.definition.sources,
    incomingSources,
  );

  const removeSelectedSources = (handledSources: readonly WorldSource[]) => {
    const handledIds = new Set(handledSources.map((source) => source.id));
    setSelected((current) => {
      const next = { ...current };
      for (const item of Object.values(current)) {
        if (handledIds.has(`source-web-${item.id}`)) delete next[item.id];
      }
      return next;
    });
  };

  const handleSearch = async () => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || searching) return;
    setSearching(true);
    setSearchError('');
    setExtractError('');
    setError('');
    setNotice('');
    setConfirming(false);
    setResults([]);
    setSelected({});
    setSaveStates({});
    setExtractedIds({});
    setSearchedQuery(normalizedQuery);
    try {
      const response = await searchWeb(normalizedQuery, 10);
      setResults(response.items);
    } catch (searchFailure) {
      setSearchError(describeError(searchFailure));
    } finally {
      setSearching(false);
    }
  };

  const toggle = (item: WebSearchResult) => {
    setSelected((current) => toggleRecord(current, item.id, item));
    setExtractError('');
    setError('');
    setNotice('');
    setConfirming(false);
  };

  const handleExtract = async () => {
    const items = Object.values(selected);
    if (!items.length) {
      setExtractError('请先选择网页结果。');
      return;
    }
    setExtracting(true);
    setExtractError('');
    setError('');
    setNotice('');
    try {
      const response = await extractWebSearchItems(items);
      const byId = new Map(response.items.map((item) => [item.id, item]));
      setExtractedIds((current) => {
        const next = { ...current };
        for (const item of response.items) next[item.id] = true;
        return next;
      });
      setResults((current) => current.map((item) => byId.get(item.id) ?? item));
      setSelected((current) => {
        const next = { ...current };
        for (const item of response.items) {
          if (next[item.id]) next[item.id] = item;
        }
        return next;
      });
      const failed = response.items.filter((item) => item.status === 'failed').length;
      setNotice(failed
        ? `已处理 ${response.items.length} 个网页；${failed} 个提取失败，可重试或仅以摘要加入。`
        : `已提取 ${response.items.length} 个网页正文。`);
    } catch (extractFailure) {
      setExtractError(describeError(extractFailure));
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async (item: WebSearchResult) => {
    setSaveStates((current) => ({
      ...current,
      [item.id]: { status: 'saving' },
    }));
    setError('');
    try {
      const saved = await saveWebSearchSource(item);
      setSaveStates((current) => ({
        ...current,
        [item.id]: { status: 'saved', id: saved.id },
      }));
      setNotice(`已保存到资料库：${saved.id}`);
    } catch (saveFailure) {
      setSaveStates((current) => ({
        ...current,
        [item.id]: {
          status: 'error',
          message: describeError(saveFailure),
        },
      }));
    }
  };

  const handleConfirmNewSources = () => {
    if (importing || !newSources.length) return;
    setImporting(true);
    setError('');
    setNotice('');
    try {
      onAddSources(newSources);
      removeSelectedSources(newSources);
      setConfirming(false);
      setNotice(`已加入 ${newSources.length} 条网页来源；性质标记为待核实。`);
    } catch (importFailure) {
      setError(describeError(importFailure));
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmSourceUpdates = () => {
    if (importing || !sourceUpdates.length) return;
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const replace = onReplaceSources ?? onAddSources;
      replace(sourceUpdates.map((item) => item.merged));
      removeSelectedSources(sourceUpdates.map((item) => item.incoming));
      setConfirming(false);
      setNotice(`已更新 ${sourceUpdates.length} 条已有网页来源；性质标记为待核实。`);
    } catch (importFailure) {
      setError(describeError(importFailure));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSearch();
        }}
      >
        <Input
          aria-label="搜索公共网页"
          placeholder="输入要搜索的主题"
          value={query}
          maxLength={500}
          onChange={(event) => setQuery(event.target.value)}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          loading={searching}
          disabled={!query.trim() || searching}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          搜索网页
        </Button>
      </form>

      <p className="text-xs leading-relaxed text-muted">
        网页内容先搜索、再选择并提取正文，最后确认加入草稿。加入后标记为待核实，不会自动生成世界设定。
      </p>

      {searchError && (
        <Alert variant="danger" title="网页搜索失败">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{searchError}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={searching}
              onClick={() => void handleSearch()}
            >
              重试搜索
            </Button>
          </div>
        </Alert>
      )}

      {searching && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" label="正在搜索网页…" />
        </div>
      )}

      {!searching && searchedQuery && !searchError && results.length === 0 && (
        <EmptyState
          icon={Globe2}
          title="没有搜索结果"
          description="换一个关键词，或检查网页搜索设置是否启用。"
        />
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((item) => {
            const change = sourceChangeState(
              draft.definition.sources,
              webSourceForDraft(item),
            );
            const added = change === 'same' || change === 'update';
            const selectedItem = Boolean(selected[item.id]);
            const saveState = saveStates[item.id];
            return (
              <div
                key={item.id}
                className={[
                  'space-y-2 rounded-panel border p-3 transition-colors',
                  selectedItem
                    ? 'border-accent bg-[var(--selection-bg)]'
                    : 'border-border-subtle bg-surface',
                ].join(' ')}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    aria-label={`选择网页 ${item.title || item.url}`}
                    checked={selectedItem}
                    onChange={() => toggle(item)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => toggle(item)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {item.title || item.url}
                      </span>
                      <Badge variant={WEB_STATUS_VARIANTS[item.status]}>
                        {WEB_STATUS_LABELS[item.status]}
                      </Badge>
                      {item.truncated && <Badge variant="warning">已截断</Badge>}
                      {added && (
                        <Badge variant="secondary">
                          {change === 'update' ? '已在草稿 · 可核对版本' : '已在草稿'}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 block break-all text-xs text-muted">
                      {item.siteName || '未知站点'} · {item.url}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">
                      {item.snippet || item.content || item.error || '没有摘要'}
                    </span>
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={saveState?.status === 'saving'}
                    disabled={saveState?.status === 'saved'}
                    onClick={() => void handleSave(item)}
                  >
                    {saveState?.status === 'error'
                      ? '重试保存至资料库'
                      : saveState?.status === 'saved'
                        ? '已保存至资料库'
                        : '保存至资料库'}
                  </Button>
                  {saveState?.status === 'saved' && saveState.id && (
                    <Badge variant="online">资料库 {saveState.id}</Badge>
                  )}
                  {saveState?.status === 'error' && saveState.message && (
                    <span className="text-xs text-danger-fg">{saveState.message}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {extractError && (
        <Alert variant="danger" title="正文提取失败">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{extractError}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={extracting || !selectedItems.length}
              onClick={() => void handleExtract()}
            >
              重试提取
            </Button>
          </div>
        </Alert>
      )}

      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert variant="danger" onDismiss={() => setError('')}>
          {error}
        </Alert>
      )}

      {confirming && (
        <div className="space-y-4 rounded-panel border border-border-default bg-surface-raised p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">确认网页来源变更</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              新来源和已有来源更新分开确认；内容只会写入世界草稿的来源列表并标记为待核实，不会直接生成人物、地点或剧情。
            </p>
          </div>

          {newSources.length > 0 && (
            <section className="space-y-2 rounded-control border border-border-subtle bg-surface p-3">
              <div>
                <h4 className="text-sm font-semibold text-ink">
                  新增来源
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  以下内容尚未存在于当前草稿，确认后逐条加入来源列表。
                </p>
              </div>
              <ul className="space-y-2">
                {newSources.map((source) => (
                  <li
                    key={source.id}
                    className="rounded bg-surface-sunken p-2 text-xs leading-relaxed text-muted"
                  >
                    <span className="font-medium text-ink">{source.title}</span>
                    <span className="ml-2 break-all">{source.sourceUrl}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  loading={importing}
                  disabled={importing}
                  onClick={handleConfirmNewSources}
                >
                  确认加入 {newSources.length} 条新来源
                </Button>
              </div>
            </section>
          )}

          {sourceUpdates.length > 0 && (
            <section className="space-y-2 rounded-control border border-border-default bg-surface p-3">
              <div>
                <h4 className="text-sm font-semibold text-ink">
                  已有来源版本更新
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  以下来源保留原来源 ID，仅在独立确认后替换为所选版本快照。请展开每一项核对完整差异。
                </p>
              </div>
              <ul className="space-y-3">
                {sourceUpdates.map(({ current, incoming, merged }) => (
                  <li
                    key={current.id}
                    className="space-y-2 rounded bg-surface-sunken p-2"
                  >
                    <p className="text-xs font-medium text-ink">
                      {current.title}
                      {' · '}
                      {current.sourceVersion}
                      {' → '}
                      {incoming.sourceVersion}
                    </p>
                    <p className="break-all text-xs text-muted">
                      保留来源 ID：{merged.id}
                      {merged.sourceUrl ? ` · ${merged.sourceUrl}` : ''}
                    </p>
                    <VersionDifferenceList
                      differences={sourceVersionDiff(current, incoming)}
                    />
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  loading={importing}
                  disabled={importing}
                  onClick={handleConfirmSourceUpdates}
                >
                  确认更新已有来源 ({sourceUpdates.length})
                </Button>
              </div>
            </section>
          )}

          {!newSources.length && !sourceUpdates.length && (
            <Alert variant="warning">
              所选网页已经在当前草稿中，且没有可确认的新增或版本差异。
            </Alert>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={importing}
              onClick={() => setConfirming(false)}
            >
              返回选择
            </Button>
          </div>
        </div>
      )}

      {!confirming && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle bg-surface pt-3">
          <p className="text-sm text-muted">
            已选 {selectedItems.length} 项
            {selectedItems.length > 0 ? ' · 跨页结果会保留' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedItems.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={extracting || importing}
                onClick={() => setSelected({})}
              >
                清空
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              loading={extracting}
              disabled={extracting || selectedItems.length === 0}
              onClick={() => void handleExtract()}
            >
              提取正文
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={selectedItems.length === 0 || extracting}
              onClick={() => {
                if (!selectedItems.length) {
                  setError('请先选择网页结果。');
                  return;
                }
                if (selectedItems.some((item) => !extractedIds[item.id])) {
                  setExtracting(true);
                  void extractWebSearchItems(selectedItems)
                    .then((response) => {
                      const byId = new Map(response.items.map((item) => [item.id, item]));
                      setExtractedIds((current) => {
                        const next = { ...current };
                        for (const item of response.items) next[item.id] = true;
                        return next;
                      });
                      setResults((current) => current.map((item) => byId.get(item.id) ?? item));
                      setSelected((current) => {
                        const next = { ...current };
                        for (const item of response.items) {
                          if (next[item.id]) next[item.id] = item;
                        }
                        return next;
                      });
                      const failed = response.items.filter((item) => item.status === 'failed');
                      if (failed.length) {
                        setExtractError(`${failed.length} 个网页正文提取失败；已保留搜索摘要，可重试提取后再加入。`);
                        return;
                      }
                      setConfirming(true);
                    })
                    .catch((extractFailure) => {
                      setExtractError(describeError(extractFailure));
                    })
                    .finally(() => setExtracting(false));
                  return;
                }
                setConfirming(true);
                setError('');
              }}
            >
              {extracting ? '正在提取正文…' : '准备加入草稿'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WorldResourcePicker({
  open,
  onOpenChange,
  draft,
  projectId,
  disabled = false,
  onAddActors,
  onAddSources,
  onReplaceActors,
  onReplaceSources,
}: WorldResourcePickerProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加世界资源"
      description="从角色库、资料库、笔记、叙事档案、创作项目和网页中选择；导入只写入当前草稿。"
      size="lg"
      className="max-w-5xl"
    >
      {open && (
        <WorldResourcePickerBody
          draft={draft}
          projectId={projectId}
          disabled={disabled}
          onAddActors={onAddActors}
          onAddSources={onAddSources}
          onReplaceActors={onReplaceActors}
          onReplaceSources={onReplaceSources}
        />
      )}
    </Dialog>
  );
}

function WorldResourcePickerBody({
  draft,
  projectId,
  disabled,
  onAddActors,
  onAddSources,
  onReplaceActors,
  onReplaceSources,
}: Omit<WorldResourcePickerProps, 'open' | 'onOpenChange'>) {
  const [tab, setTab] = useState<WorldResourceTab>(
    projectId ? 'project' : 'characters',
  );

  const tabs = [
    {
      id: 'characters',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
          角色
        </span>
      ),
    },
    {
      id: 'knowledge',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Library className="h-3.5 w-3.5" aria-hidden="true" />
          资料库
        </span>
      ),
    },
    {
      id: 'notes',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          笔记
        </span>
      ),
    },
    {
      id: 'narrative',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
          叙事
        </span>
      ),
    },
    {
      id: 'project',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
          项目
        </span>
      ),
    },
    {
      id: 'web',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
          网页
        </span>
      ),
    },
  ];

  return (
    <fieldset
      disabled={disabled}
      aria-busy={disabled || undefined}
      className="min-w-0 min-h-0 space-y-4 border-0 p-0"
    >
        <PageTabs
          ariaLabel="世界资源来源"
          value={tab}
          onChange={(next) => setTab(next as WorldResourceTab)}
          tabs={tabs}
        />

        <div hidden={tab !== 'characters'}>
          <CharactersTab
            active={tab === 'characters'}
            draft={draft}
            onAddActors={onAddActors}
            onReplaceActors={onReplaceActors}
          />
        </div>
        <div hidden={tab !== 'knowledge'}>
          <KnowledgeTab
            active={tab === 'knowledge'}
            draft={draft}
            onAddSources={onAddSources}
            onReplaceSources={onReplaceSources}
          />
        </div>
        <div hidden={tab !== 'notes'}>
          <NotesTab
            active={tab === 'notes'}
            draft={draft}
            onAddSources={onAddSources}
            onReplaceSources={onReplaceSources}
          />
        </div>
        <div hidden={tab !== 'narrative'}>
          <NarrativeTab
            active={tab === 'narrative'}
            draft={draft}
            onAddSources={onAddSources}
            onReplaceSources={onReplaceSources}
          />
        </div>
        <div hidden={tab !== 'project'}>
          <ProjectTab
            active={tab === 'project'}
            draft={draft}
            projectId={projectId}
            onAddActors={onAddActors}
            onAddSources={onAddSources}
            onReplaceActors={onReplaceActors}
            onReplaceSources={onReplaceSources}
          />
        </div>
        <div hidden={tab !== 'web'}>
          <WebTab
            draft={draft}
            onAddSources={onAddSources}
            onReplaceSources={onReplaceSources}
          />
        </div>
    </fieldset>
  );
}
