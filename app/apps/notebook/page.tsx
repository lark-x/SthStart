import type { Metadata } from 'next';
import { NotebookClient } from './notebook-client';

export const metadata: Metadata = { title: '创作笔记 — SthStart', description: '记录日记、灵感、角色与世界故事的本地创作笔记。' };

export default function NotebookPage() { return <NotebookClient />; }
