import type { StoryCharacter, StoryDocument, StoryEntry } from '@sthstart/contracts';

export type EntryRow = { kind: 'document'; item: StoryDocument } | { kind: 'character'; item: StoryCharacter };
export type NewKind = StoryDocument['kind'] | 'character';
export type ReviewTab = 'proposals' | 'revisions' | 'agent' | 'archive';
export type StoryNavTab = 'chapters' | 'bible';
export type SelectedEntry = { kind: 'document' | 'character'; id: string } | null;

export const groupLabel: Record<NewKind, string> = { outline: '大纲', world: '世界观', scene: '场景', chapter: '章节', character: '角色' };

export function getEntryLabel(kind: NewKind, isReflection = false) {
  if (isReflection) {
    if (kind === 'outline') return '思考纲要';
    if (kind === 'chapter') return '随笔篇目';
  }
  return groupLabel[kind];
}

export const documentOf = (entry: StoryEntry): entry is StoryDocument => !('name' in entry);
export const entryTitle = (entry: StoryEntry) => 'name' in entry ? entry.name : entry.title;
export const entryBody = (entry: StoryEntry) => 'notes' in entry ? entry.notes : entry.body;
export const entryKind = (entry: StoryEntry): NewKind => 'name' in entry ? 'character' : entry.kind;

export function entryMatchesSearch(row: EntryRow, search: string) {
  const trimmed = search.trim().toLocaleLowerCase();
  if (!trimmed) return true;
  return `${entryTitle(row.item)}\n${entryBody(row.item)}`.toLocaleLowerCase().includes(trimmed);
}

export function buildEntryRows(documents: readonly StoryDocument[] | undefined, characters: readonly StoryCharacter[] | undefined): EntryRow[] {
  return [
    ...(documents ?? []).map((item) => ({ kind: 'document' as const, item })),
    ...(characters ?? []).map((item) => ({ kind: 'character' as const, item })),
  ];
}

export function chaptersOf(documents: readonly StoryDocument[] | undefined) {
  return (documents ?? [])
    .filter((item): item is StoryDocument => item.kind === 'chapter')
    .sort((a, b) => a.position - b.position);
}

export function totalWordCount(chapters: readonly StoryDocument[]) {
  return chapters.reduce((sum, chapter) => sum + [...chapter.body.trim()].length, 0);
}

export function filteredChaptersOf(chapters: readonly StoryDocument[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return [...chapters];
  return chapters.filter((chapter) => `${chapter.title}\n${chapter.body}`.toLowerCase().includes(query));
}

export function bibleGroupsOf(entries: readonly EntryRow[]): Array<{ kind: Exclude<NewKind, 'chapter'>; rows: EntryRow[] }> {
  return [
    { kind: 'outline', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'outline') },
    { kind: 'character', rows: entries.filter((entry) => entry.kind === 'character') },
    { kind: 'world', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'world') },
    { kind: 'scene', rows: entries.filter((entry) => entry.kind === 'document' && entry.item.kind === 'scene') },
  ];
}

export function bibleEntryCount(entries: readonly EntryRow[]) {
  return entries.filter((entry) => !(entry.kind === 'document' && entry.item.kind === 'chapter')).length;
}

export function defaultEntryOf(
  entries: readonly EntryRow[],
  documents: readonly StoryDocument[] | undefined,
  isReflection: boolean,
): StoryEntry | null {
  const items = documents ?? [];
  if (isReflection) {
    return items.find((item) => item.kind === 'outline') ?? entries[0]?.item ?? null;
  }
  const firstChapter = chaptersOf(items)[0];
  return firstChapter ?? entries[0]?.item ?? null;
}

export function resolveActiveEntry(
  entries: readonly EntryRow[],
  selected: SelectedEntry,
  urlEntryId: string | null,
  fallback: StoryEntry | null,
): StoryEntry | null {
  return entries.find((entry) => entry.kind === selected?.kind && entry.item.id === selected.id)?.item
    ?? entries.find((entry) => !selected && entry.item.id === urlEntryId)?.item
    ?? fallback;
}

export function chapterIndexOf(chapters: readonly StoryDocument[], activeEntry: StoryEntry | null) {
  if (!activeEntry || !documentOf(activeEntry) || activeEntry.kind !== 'chapter') return -1;
  return chapters.findIndex((chapter) => chapter.id === activeEntry.id);
}

export function neighborChapters(chapters: readonly StoryDocument[], activeEntry: StoryEntry | null) {
  const index = chapterIndexOf(chapters, activeEntry);
  return {
    index,
    previous: index > 0 ? chapters[index - 1] ?? null : null,
    next: index >= 0 && index < chapters.length - 1 ? chapters[index + 1] ?? null : null,
  };
}

export function chapterWordLabel(wordCount: number) {
  return wordCount >= 1000 ? `${(wordCount / 1000).toFixed(1)}k字` : `${wordCount}字`;
}

export function chapterStatus(wordCount: number) {
  return wordCount === 0 ? '空白' : wordCount < 1000 ? '草稿' : '正文';
}
