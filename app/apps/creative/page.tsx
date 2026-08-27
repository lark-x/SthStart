import type { Metadata } from 'next';
import { CreativeClient } from './creative-client';

export const metadata: Metadata = {
  title: '创作中心 — SthStart',
  description: '通过公共生成工作流创作、管理与复用图片素材。',
};

export default function CreativePage() {
  return <CreativeClient />;
}
