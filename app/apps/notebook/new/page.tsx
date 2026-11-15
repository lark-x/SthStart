import type { Metadata } from 'next';
import { NotebookEditorEntry } from '@/app/workspaces/resources/notebook-entry';

export const metadata: Metadata = {
  title: '新建笔记 — SthStart',
  description: '写下一段资料、随想、灵感或设定；需要时可以标记为可参考。',
};

export default function NewNotePage() {
  return <NotebookEditorEntry isNew />;
}
