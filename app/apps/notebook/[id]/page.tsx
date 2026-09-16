import type { Metadata } from 'next';
import { NotebookWorkspace } from '@/app/features/notebook/components/notebook-workspace';

export const metadata: Metadata = {
  title: '创作资料库 — SthStart',
  description: '查看与编辑资料；正文、来源与参考状态一并保留。',
};

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NotebookWorkspace initialNoteId={id} />;
}
