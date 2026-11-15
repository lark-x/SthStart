import type { Metadata } from 'next';
import { PublicServicesSettings } from './settings-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '模型与公共服务 — SthStart',
  description: '管理公共常用模型、应用例外、扩展服务与高级接入。',
};

export default function PublicServicesPage() {
  return <PublicServicesSettings />;
}
