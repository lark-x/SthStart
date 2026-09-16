import type { Metadata } from 'next';
import { NotebookWorkspace } from '@/app/features/notebook/components/notebook-workspace';

export const metadata: Metadata = {
  title: '新建资料 — SthStart',
  description: '写下一段资料、随想、灵感或设定；需要时可以标记为可参考。',
};

export default function NewNotePage() {
  return <NotebookWorkspace isNew={true} />;
}
