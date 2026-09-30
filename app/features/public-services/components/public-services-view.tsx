'use client';

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import type {
  ModelProfile,
  PublicServiceOverview,
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
import { Button, buttonVariants } from '@/app/components/ui/button';
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
  const { data: overview, isLoading: overviewLoading, error: queryError, refetch: refetchOverview } = usePublicOverview();

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
    if (loaded) toast.success('配置数据已同步刷新喵。');
  };

  useEffect(() => {
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
    <PageContainer width="settings" className="py-5 space-y-4">
      <PageHeader
        title="模型与公共服务"
        description="分层管理服务连接凭据、文本模型推理、云端与本地生图引擎，并为各应用配置业务用途绑定喵。"
      />

      {/* 服务概况横条 */}
      <section
        aria-label="服务概况"
        className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border-default bg-surface px-4 py-2.5 text-sm"
      >
        <span>
          <strong>{connections.length}</strong> 个连接
        </span>
        <span>
          <strong>{models.length}</strong> 个模型
        </span>
        <span>
          <strong>{engines.length}</strong> 个绘图引擎
        </span>
        <span>
          <strong>{overview?.apps.length ?? 0}</strong> 个应用
        </span>
        <span className="text-muted">
          安全存储：
          {!overview ? '检查中' : overview.keyring.available ? keyringLabel(overview.keyring.backend) : '未连接'}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Link href="/apps/characters" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            角色资料库
          </Link>
          <Link href="/settings/control-center" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            控制中心
          </Link>
          <Button size="sm" variant="ghost" onClick={() => void handleRefreshAll()}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
      </section>

      {queryError && (
        <Alert variant="danger" title="公共服务数据读取失败">
          {queryError instanceof Error ? queryError.message : String(queryError)}。已有配置安全无损喵。
        </Alert>
      )}

      {errorMsg && (
        <Alert variant="warning" title="数据提示">
          {errorMsg}喵。
        </Alert>
      )}

      {/* 5 个核心页签切换 */}
      <PageTabs
        ariaLabel="公共服务分类"
        value={tab}
        onChange={setTab}
        tabs={tabsConfig}
      />

      {/* 各页签面板 */}
      {dataLoading && !connections.length && !models.length ? (
        <Skeleton className="h-64 w-full rounded-lg" />
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
    </PageContainer>
  );
}
