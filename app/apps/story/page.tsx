import type { Metadata } from 'next';
import { StoryProjectList } from '@/app/features/story/story-project-list';

export const metadata: Metadata = { title: '剧情工作室 — SthStart', description: '整理世界观、角色、场景，并与 AI 讨论剧情。' };
export default function StoryPage() { return <StoryProjectList />; }
