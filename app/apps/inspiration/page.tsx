import type { Metadata } from 'next';
import { TopicLibraryView } from '@/app/features/topics/components/topic-library-view';

export const metadata: Metadata = {
  title: '灵感素材 — SthStart',
  description: '定时搜集关注作品的新梗与讨论，生成活动点子并无缝带入企划与笔记。',
};

export default function InspirationPage() {
  return <TopicLibraryView />;
}
