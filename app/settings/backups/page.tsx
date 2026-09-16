import type { Metadata } from 'next';
import { BackupsWorkspace } from '@/app/features/backups/components/backups-workspace';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '云备份 — SthStart',
  description: '把工作区、活动与创作资料加密备份到多个网盘，并按版本恢复。',
};

export default function BackupsSettingsPage() {
  return <BackupsWorkspace />;
}
