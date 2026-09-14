import type { Metadata } from 'next';
import { TopicLibraryView } from '@/app/features/topics/components/topic-library-view';

export const metadata: Metadata = { title: '话题素材库 — SthStart', description: '定时搜集关注作品的新梗与讨论，勾选素材生成活动点子并带入企划。' };

export default function InspirationPage() {
  return <TopicLibraryView />;
}
