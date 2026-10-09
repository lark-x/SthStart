'use client';

import React from 'react';
import type { PublicServiceOverview } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { AppTokens } from './app-tokens';
import { OtherProviders } from './other-providers';
import { McpSourceManager } from '@/app/features/mcp-sources/mcp-source-manager';
import { useCreateApp, useCreateProfile } from '../mutations';
import { useToast } from '@/app/providers/ui-provider';

export function OtherServicesPanel({
  overview,
  onRefresh,
}: {
  overview: PublicServiceOverview | null;
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const createAppMutation = useCreateApp();
  const createProfileMutation = useCreateProfile();

  const handleCreateApp = async (id: string, name: string) => {
    const created = await createAppMutation.mutateAsync({
      id,
      name,
      capabilities: ['llm', 'vector', 'image', 'persona', 'logs'],
    });
    toast.success('应用令牌已生成。');
    await onRefresh();
    return created.token;
  };

  const handleSaveOther = async (payload: unknown) => {
    await createProfileMutation.mutateAsync(payload);
    toast.success('能力配置已保存。');
    await onRefresh();
  };

  return (
    <div className="space-y-6">
      {overview && !overview.keyring.available && (
        <Alert variant="warning" title="安全存储未连接">
          配置 KEYRING_FILE_MASTER_KEY 可启用容器内加密存储，或使用环境变量提供模型密钥。
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AppTokens overview={overview} onCreateApp={handleCreateApp} />
        <OtherProviders overview={overview} onSaveOther={handleSaveOther} />
      </div>

      <div className="border-t border-border-subtle pt-6">
        <McpSourceManager />
      </div>
    </div>
  );
}
