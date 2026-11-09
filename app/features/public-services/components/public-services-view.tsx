'use client';

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import type {
  ModelProfile,
  PurposeBinding,
  ServiceConnection,
} from '@sthstart/contracts';
import { usePublicOverview } from '../queries';
import {
  fetchConnections,
  fetchModelProfiles,
  fetchPurposeBindings,
} from '../api';
import { fetchGenerationEngines } from '@/app/features/generation/api';
import type { Engine } from '@/app/features/generation/types';
import { ConnectionsPanel } from './connections-panel';
import { TextModelsPanel } from './text-models-panel';
import { ImageModelsPanel } from './image-models-panel';
import { PurposesPanel } from './purposes-panel';
import { OtherServicesPanel } from './other-services-panel';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useToast } from '@/app/providers/ui-provider';

const TAB_IDS = ['connections', 'text-models', 'image-models', 'purposes', 'other'] as const;
type TabId = (typeof TAB_IDS)[number];
const DEFAULT_TAB: TabId = 'connections';

function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
}

const locationListeners = new Set<() => void>();
function notifyLocationListeners() {
  for (const listener of locationListeners) listener();
}
function subscribeToLocation(callback: () => void) {
  locationListeners.add(callback);
  window.addEventListener('popstate', callback);
  return () => {
    locationListeners.delete(callback);
    window.removeEventListener('popstate', callback);
  };
}

function readTabFromUrl(): TabId {
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab');
  if (isTabId(tabParam)) return tabParam;

  // 兼容旧 URL 结构
  const sectionParam = params.get('section');
  if (sectionParam === 'routing' || window.location.hash === '#app-model-routing') return 'purposes';
  if (sectionParam === 'models') return 'text-models';
  if (sectionParam === 'access') return 'other';

  return DEFAULT_TAB;
}

const keyringBackendLabels: Record<string, string> = {
  'native-windows': '系统凭据管理器 (Windows)',
  'native-macos': '系统钥匙串 (macOS)',
  'native-linux': '系统密钥环 (Linux)',
  'secret-service': '系统密钥环 (Secret Service)',
  windows: 'Windows 凭据管理器',
  macos: 'macOS 钥匙串',
  file: '容器内加密文件存储',
};

function keyringLabel(backend: string | null | undefined) {
  return (backend && keyringBackendLabels[backend]) || backend || '未知后端';
}

export function PublicServicesSettings() {
  const toast = useToast();
  const { data: overview, error: queryError, refetch: refetchOverview } = usePublicOverview();

  const tab = useSyncExternalStore(subscribeToLocation, readTabFromUrl, () => DEFAULT_TAB);

  const setTab = useCallback((nextTab: string) => {
    if (!isTabId(nextTab)) return;
    const params = new URLSearchParams(window.location.search);
    if (nextTab === DEFAULT_TAB) params.delete('tab');
    else params.set('tab', nextTab);
    params.delete('section');
    const query = params.toString();
    window.history.pushState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    notifyLocationListeners();
  }, []);

  // 本地数据状态
  const [connections, setConnections] = useState<ServiceConnection[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [purposeBindings, setPurposeBindings] = useState<PurposeBinding[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    setErrorMsg('');
    try {
      const [connsData, modelsData, enginesData, purposesData] = await Promise.all([
        fetchConnections(),
        fetchModelProfiles(),
        fetchGenerationEngines(),
        fetchPurposeBindings(),
      ]);
      setConnections(connsData);
      setModels(modelsData);
      setEngines(enginesData);
      setPurposeBindings(purposesData);
      return true;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setDataLoading(false);
    }
  }, []);

  const handleRefreshAll = async () => {
    setDataLoading(true);
    const [, loaded] = await Promise.all([refetchOverview(), loadData()]);
    if (loaded) toast.success('配置数据已同步刷新。');
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 页面挂载时读取外部管理 API。
    void loadData();
  }, [loadData]);

  const tabsConfig = [
    { id: 'connections', label: '服务连接', count: connections.length, panelId: 'panel-connections' },
    { id: 'text-models', label: '文本模型', count: models.length, panelId: 'panel-text-models' },
    { id: 'image-models', label: '绘图模型与引擎', count: engines.length, panelId: 'panel-image-models' },
    { id: 'purposes', label: '用途绑定', count: overview?.apps.length ?? 0, panelId: 'panel-purposes' },
    { id: 'other', label: '其他服务', panelId: 'panel-other' },
  ];

  return (
    <PageContainer width="settings" className="space-y-4">
      <PageHeader
        compact
        title="模型与公共服务"
        actions={<Button size="sm" variant="ghost" aria-label="刷新全部服务配置" onClick={() => void handleRefreshAll()}><RefreshCw className="h-3.5 w-3.5" /><span>刷新</span></Button>}
        navigation={
          <PageTabs
            variant="local"
            ariaLabel="公共服务分类"
            value={tab}
            onChange={setTab}
            tabs={tabsConfig}
          />
        }
      />
      <section className="tpl-panel space-y-4 p-4" aria-label="当前设置内容">

      {queryError && (
        <Alert variant="danger" title="公共服务数据读取失败">
          {queryError instanceof Error ? queryError.message : String(queryError)}。已有配置安全无损。
        </Alert>
      )}

      {errorMsg && (
        <Alert variant="warning" title="数据提示">
          {errorMsg}
        </Alert>
      )}

      {/* 低频服务概况收敛到 details，避免手机首屏反复挤占 */}
      <details className="group border-y border-border-subtle py-2 text-xs text-muted">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>服务概览：<span className="font-semibold text-ink">{connections.length}</span> 连接 · <span className="font-semibold text-ink">{models.length}</span> 模型 · <span className="font-semibold text-ink">{engines.length}</span> 绘图引擎</span>
            <span className="hidden sm:inline">· 安全存储：{!overview ? '检查中' : overview.keyring.available ? keyringLabel(overview.keyring.backend) : '未连接'}</span>
          </div>
          <span className="ml-2 text-xs text-fg-subtle group-open:rotate-180 transition-transform duration-150">▼</span>
        </summary>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-subtle/50 pt-2 text-xs">
          <span><span className="font-semibold text-ink">{connections.length}</span> 个连接</span>
          <span><span className="font-semibold text-ink">{models.length}</span> 个模型</span>
          <span><span className="font-semibold text-ink">{engines.length}</span> 个绘图引擎</span>
          <span><span className="font-semibold text-ink">{overview?.apps.length ?? 0}</span> 个应用</span>
          <span>
            安全存储：{!overview ? '检查中' : overview.keyring.available ? keyringLabel(overview.keyring.backend) : '未连接'}
          </span>
        </div>
      </details>

      {/* 各页签面板 */}
      {dataLoading && !connections.length && !models.length ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          <div id="panel-connections" role="tabpanel" hidden={tab !== 'connections'}>
            <ConnectionsPanel connections={connections} onRefresh={async () => { await loadData(); }} />
          </div>

          <div id="panel-text-models" role="tabpanel" hidden={tab !== 'text-models'}>
            <TextModelsPanel
              models={models}
              connections={connections}
              onRefresh={async () => { await loadData(); }}
            />
          </div>

          <div id="panel-image-models" role="tabpanel" hidden={tab !== 'image-models'}>
            <ImageModelsPanel engines={engines} onRefresh={async () => { await loadData(); }} />
          </div>

          <div id="panel-purposes" role="tabpanel" hidden={tab !== 'purposes'}>
            <PurposesPanel
              overview={overview ?? null}
              models={models}
              engines={engines}
              purposeBindings={purposeBindings}
              onRefresh={async () => { await loadData(); }}
            />
          </div>

          <div id="panel-other" role="tabpanel" hidden={tab !== 'other'}>
            <OtherServicesPanel
              overview={overview ?? null}
              onRefresh={handleRefreshAll}
            />
          </div>
        </>
      )}
      </section>
    </PageContainer>
  );
}
