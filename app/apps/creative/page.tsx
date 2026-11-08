import type { Metadata } from 'next';
import { CreativeClient } from './creative-client';

export const metadata: Metadata = {
  title: '自由生成 — SthStart',
  description: '独立尝试画面与视频创意，生成结果可加入创作项目。',
};

export default function CreativePage() {
  return <CreativeClient />;
}
