import type { Metadata } from 'next';
import { PublicServicesSettings } from './settings-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '模型与公共服务 — SthStart',
  description: '管理公共模型模板、应用模型绑定与服务能力。',
};

export default function PublicServicesPage() {
  return <PublicServicesSettings />;
}
