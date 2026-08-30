import type { Metadata } from 'next';
import { NotebookWorkspace } from '@/app/features/notebook/components/notebook-workspace';

export const metadata: Metadata = {
  title: '新建创作笔记 — SthStart',
  description: '写下一段随想、灵感、日记或设定。',
};

export default function NewNotePage() {
  return <NotebookWorkspace isNew={true} />;
}
