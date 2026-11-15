'use client';

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ImageIcon, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ModelProfile, ServiceConnection } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useToast } from '@/app/providers/ui-provider';
import { usePublicOverview, useModelRoutes } from '../queries';
import { fetchConnections, fetchModelProfiles } from '../api';
import { AppExceptionsDrawer } from './app-exceptions-drawer';
import { AppExceptionsSummary } from './app-exceptions-summary';
import { CommonModelsCard } from './common-models-card';
import { ModelLibrary } from './model-library';
import { ExtensionsSettings } from './extensions-settings';
import {
  buildAppExceptionRows,
  buildPublicServicesSearch,
  parsePublicServicesLocation,
} from './public-services-model-settings';

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

function readLocationKey() {
  return `${window.location.search}\u0000${window.location.hash}`;
}

function parseLocationKey(key: string) {
  const [search, hash] = key.split('\u0000');
  return parsePublicServicesLocation(search ?? '', hash ?? '');
}

const keyringBackendLabels: Record<string, string> = {
  'native-windows': 'Windows 凭据管理器',
  'native-macos': 'macOS 钥匙串',
  'native-linux': 'Linux 密钥环',
  'secret-service': 'Secret Service',
  windows: 'Windows 凭据管理器',
  macos: 'macOS 钥匙串',
  file: '容器内加密文件存储',
};

function keyringLabel(backend: string | null | undefined) {
  return (backend && keyringBackendLabels[backend]) || backend || '未知后端';
}

export function PublicServicesSettings() {
  const router = useRouter();
  const toast = useToast();
  const locationKey = useSyncExternalStore(
    subscribeToLocation,
    readLocationKey,
    () => '',
  );
  const location = parseLocationKey(locationKey);
  const { data: overview, error: overviewError, refetch: refetchOverview } = usePublicOverview();
  const {
    data: modelRoutes = [],
    error: routesError,
    refetch: refetchRoutes,
  } = useModelRoutes();

  const [connections, setConnections] = useState<ServiceConnection[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataInitialized, setDataInitialized] = useState(false);
  const [dataError, setDataError] = useState('');

  const loadData = useCallback(async () => {
    setDataError('');
    try {
      const [nextConnections, nextModels] = await Promise.all([
        fetchConnections(),
        fetchModelProfiles(),
      ]);
      setConnections(nextConnections);
      setModels(nextModels);
      setDataInitialized(true);
      return { ok: true, error: null as string | null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setDataError(reason);
      return { ok: false, error: reason };
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 页面挂载时读取管理 API 列表。
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (location.redirectTo) router.replace(location.redirectTo);
  }, [location.redirectTo, router]);

  const runRefresh = useCallback(async () => {
    setDataLoading(true);
    try {
      const [overviewResult, routesResult, dataResult] = await Promise.all([
        refetchOverview(),
        refetchRoutes(),
        loadData(),
      ]);
      const failures = [
        overviewResult.error
          ? `概览：${overviewResult.error instanceof Error ? overviewResult.error.message : String(overviewResult.error)}`
          : null,
        routesResult.error
          ? `路由：${routesResult.error instanceof Error ? routesResult.error.message : String(routesResult.error)}`
          : null,
        dataResult.ok ? null : `列表：${dataResult.error}`,
      ].filter((item): item is string => Boolean(item));
      return { ok: failures.length === 0, error: failures.join('；') || null };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      setDataLoading(false);
    }
  }, [loadData, refetchOverview, refetchRoutes]);

  const refreshAll = useCallback(async () => {
    const result = await runRefresh();
    if (!result.ok) throw new Error(result.error ?? '配置已保存，但页面刷新失败。');
  }, [runRefresh]);

  const handleRefresh = async () => {
    const result = await runRefresh();
    if (result.ok) toast.success('模型与扩展服务数据已刷新。');
    else toast.error('刷新未完成', result.error ?? undefined);
  };

  const applyLocation = useCallback(
    (tab: 'models' | 'extensions', options: { openAppExceptions?: boolean; appId?: string | null } = {}) => {
      const search = buildPublicServicesSearch(tab, options);
      window.history.pushState(
        null,
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`,
      );
      notifyLocationListeners();
    },
    [],
  );

  const setTab = useCallback(
    (nextTab: string) => {
      if (nextTab !== 'models' && nextTab !== 'extensions') return;
      applyLocation(nextTab);
    },
    [applyLocation],
  );

  const openAppExceptions = useCallback(() => {
    applyLocation('models', {
      openAppExceptions: true,
      appId: location.highlightAppId,
    });
  }, [applyLocation, location.highlightAppId]);

  const closeAppExceptions = useCallback(() => {
    applyLocation('models');
  }, [applyLocation]);

  const appRows = useMemo(
    () => buildAppExceptionRows(overview?.apps ?? [], modelRoutes),
    [modelRoutes, overview?.apps],
  );
  const routableModels = useMemo(() => models.map(model => ({
    ...model,
    enabled: model.enabled && connections.some(connection => connection.id === model.connectionId && connection.enabled),
  })), [connections, models]);

  const initialLoading = dataLoading && !dataInitialized;

  return (
    <PageContainer width="settings" className="space-y-4">
      <PageHeader
        compact
        title="模型与公共服务"
        actions={
          <Button
            size="sm"
            variant="ghost"
            loading={dataLoading}
            aria-label="刷新模型与扩展服务配置"
            onClick={() => void handleRefresh()}
          >
            {!dataLoading && <RefreshCw className="size-4" aria-hidden="true" />}
            刷新
          </Button>
        }
        navigation={
          <PageTabs
            variant="local"
            ariaLabel="公共服务分类"
            value={location.tab}
            onChange={setTab}
            tabs={[
              {
                id: 'models',
                label: '模型',
                panelId: 'panel-models',
              },
              {
                id: 'extensions',
                label: '扩展服务',
                panelId: 'panel-extensions',
              },
            ]}
          />
        }
      />

      {overviewError && (
        <Alert variant="danger" title="公共服务数据读取失败">
          {overviewError instanceof Error ? overviewError.message : String(overviewError)}
        </Alert>
      )}
      {routesError && (
        <Alert variant="danger" title="模型路由读取失败">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{routesError instanceof Error ? routesError.message : String(routesError)}</span>
            <Button size="sm" variant="outline" onClick={() => void refetchRoutes()}>
              重试
            </Button>
          </div>
        </Alert>
      )}
      {dataError && (
        <Alert variant="warning" title="连接或模型列表读取提示">
          {dataError}
        </Alert>
      )}

      {location.tab === 'models' ? (
        <div id="panel-models" role="tabpanel" aria-label="模型设置">
          {initialLoading ? (
            <Skeleton className="h-64 w-full rounded-panel" />
          ) : dataError && connections.length === 0 && models.length === 0 ? (
            <Button variant="outline" onClick={() => void handleRefresh()}>重新加载供应商与模型</Button>
          ) : (
            <div className="space-y-4">
              <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.75fr)]">
                <ModelLibrary
                  models={models}
                  connections={connections}
                  onRefresh={refreshAll}
                />

                <aside className="min-w-0 space-y-4">
                  <AppExceptionsSummary
                    rows={appRows}
                    models={models}
                    loading={!overview && !overviewError}
                    onOpen={openAppExceptions}
                  />

                  <section className="tpl-panel space-y-3 p-4" aria-labelledby="model-links-title">
                    <h2 id="model-links-title" className="text-base font-semibold text-ink">
                      相关入口
                    </h2>
                    <Link
                      href="/settings/generation"
                      className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink hover:text-accent"
                    >
                      <ImageIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                      绘图方案与工作流
                    </Link>
                    <div className="flex items-start gap-2 border-t border-border-subtle pt-3 text-xs leading-relaxed text-muted">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        凭据存储：
                        {overview
                          ? overview.keyring.available
                            ? `${keyringLabel(overview.keyring.backend)}`
                            : '暂不可用，可到运行诊断检查'
                          : '读取中'}
                      </span>
                    </div>
                  </section>
                </aside>
              </div>

              <CommonModelsCard
                routes={modelRoutes}
                models={routableModels}
                onRefresh={refreshAll}
              />
            </div>
          )}
        </div>
      ) : (
        <div id="panel-extensions" role="tabpanel" aria-label="扩展服务设置">
          <ExtensionsSettings overview={overview ?? null} onRefresh={refreshAll} />
        </div>
      )}

      <AppExceptionsDrawer
        key={`${location.openAppExceptions}:${location.highlightAppId ?? ''}`}
        open={location.tab === 'models' && location.openAppExceptions}
        onOpenChange={(next) => {
          if (next) openAppExceptions();
          else closeAppExceptions();
        }}
        rows={appRows}
        models={routableModels}
        highlightAppId={location.highlightAppId}
        onRefresh={refreshAll}
      />
    </PageContainer>
  );
}
