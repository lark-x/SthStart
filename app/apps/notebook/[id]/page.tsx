import { NoteEditor } from '../note-editor';

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NoteEditor noteId={id} />;
}
