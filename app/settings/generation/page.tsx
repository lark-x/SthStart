import type { Metadata } from 'next';
import { GenerationSettings } from './generation-client';

export const metadata: Metadata = {
  title: '生成工作流配置 — SthStart',
  description: '管理生成引擎、版本化工作流与创作中心绑定。',
};

export default function GenerationSettingsPage() {
  return <GenerationSettings />;
}
