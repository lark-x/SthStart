import type { Metadata } from 'next';
import { NotebookEditorEntry } from '@/app/workspaces/resources/notebook-entry';

export const metadata: Metadata = {
  title: '创作笔记 — SthStart',
  description: '查看和编辑笔记正文、来源与参考状态。',
};

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NotebookEditorEntry initialNoteId={id} />;
}
