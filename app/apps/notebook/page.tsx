import type { Metadata } from 'next';
import { NotebookClient } from './notebook-client';

export const metadata: Metadata = { title: '创作资料库 — SthStart', description: '记录资料、日记、灵感与世界设定；标记为可参考后可在活动企划中引用，并保留来源与引用快照。' };

export default function NotebookPage() { return <NotebookClient />; }
