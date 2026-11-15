import type { Metadata } from 'next';
import { NotebookClient } from './notebook-client';

export const metadata: Metadata = { title: '创作笔记 — SthStart', description: '记下资料、日记、灵感与世界设定。笔记标为可参考后，可在活动企划中引用。' };

export default function NotebookPage() { return <NotebookClient />; }
