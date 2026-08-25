import { NoteEditor } from '../note-editor';
import type { NoteKind } from '../types';

const allowed = new Set<NoteKind>(['diary', 'idea', 'note', 'story', 'character', 'world']);

export default async function NewNotePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  return <NoteEditor initialKind={allowed.has(kind as NoteKind) ? kind as NoteKind : 'note'} />;
}
