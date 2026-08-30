import type { Metadata } from 'next';
import { NotebookWorkspace } from '@/app/features/notebook/components/notebook-workspace';

export const metadata: Metadata = {
  title: '创作笔记 — SthStart',
  description: '记录日记、灵感、角色与世界故事。',
};

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NotebookWorkspace initialNoteId={id} />;
}
