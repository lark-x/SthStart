import type { Metadata } from 'next';
import { CreativeClient } from './creative-client';

export const metadata: Metadata = {
  title: '图像工坊 — SthStart',
  description: '高质量文本生图、图生图与创作媒体资产库。',
};

export default function CreativePage() {
  return <CreativeClient />;
}
