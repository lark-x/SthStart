'use client';

import React, { useState } from 'react';
import { ChevronDown, Wrench } from 'lucide-react';
import type { ModelProfile, ServiceConnection } from '@sthstart/contracts';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { ConnectionsPanel } from './connections-panel';
import { TextModelsPanel } from './text-models-panel';

type AdvancedPanel = 'connections' | 'all-models';

export function AdvancedAccessSection({
  connections,
  models,
  onRefresh,
}: {
  connections: ServiceConnection[];
  models: ModelProfile[];
  onRefresh: () => Promise<void>;
}) {
  const [panel, setPanel] = useState<AdvancedPanel>('connections');

  return (
    <details className="group tpl-panel p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">高级接入管理</span>
          <span className="hidden text-xs font-normal text-muted sm:inline">
            {connections.length} 个连接 · {models.length} 个模型
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-4 border-t border-border-subtle pt-4">
        <p className="text-xs leading-relaxed text-muted">
          管理连接、凭据和模型。图片引擎在「生成配置」中设置。
        </p>
        <PageTabs
          variant="local"
          ariaLabel="高级接入视图"
          value={panel}
          onChange={(next) => setPanel(next as AdvancedPanel)}
          tabs={[
            {
              id: 'connections',
              label: '服务连接',
              count: connections.length,
              panelId: 'advanced-connections',
            },
            {
              id: 'all-models',
              label: '完整模型表',
              count: models.length,
              panelId: 'advanced-models',
            },
          ]}
        />
        <div id="advanced-connections" role="tabpanel" hidden={panel !== 'connections'}>
          <ConnectionsPanel connections={connections} onRefresh={onRefresh} />
        </div>
        <div id="advanced-models" role="tabpanel" hidden={panel !== 'all-models'}>
          <TextModelsPanel models={models} connections={connections} onRefresh={onRefresh} />
        </div>
      </div>
    </details>
  );
}
