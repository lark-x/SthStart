import type { Metadata } from 'next';
import { ResourcesClient } from './resources-client';

export const metadata: Metadata = {
  title: '资料库 — SthStart',
  description: '集中管理创作笔记、灵感素材、搜集任务与参考资料，提供统一的知识沉淀与项目引用支持。',
};

export default function ResourcesPage() {
  return <ResourcesClient />;
}
