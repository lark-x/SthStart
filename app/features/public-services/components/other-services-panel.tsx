'use client';

import React from 'react';
import type { PublicServiceOverview } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { AppTokens } from './app-tokens';
import { WebSearchPanel } from './web-search-panel';
import { McpSourceManager } from '@/app/features/mcp-sources/mcp-source-manager';
import { useCreateApp } from '../mutations';
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

  return (
    <div className="space-y-6">
      {overview && !overview.keyring.available && (
        <Alert variant="warning" title="安全存储未连接">
          暂时无法保存新密钥，可继续使用免密钥搜索。需要密钥的服务请前往运行诊断检查。
        </Alert>
      )}

      <div className="tpl-panel p-4">
        <WebSearchPanel />
      </div>

      <div className="tpl-panel p-4">
        <McpSourceManager />
      </div>

      <details className="tpl-panel p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink">应用访问授权（高级）</summary>
        <p className="my-3 text-sm text-muted">仅在外部应用需要调用 SthStart 服务时使用。日常创作无需配置。</p>
        <AppTokens overview={overview} onCreateApp={handleCreateApp} />
      </details>
    </div>
  );
}
