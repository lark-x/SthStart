'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity, Server, Sliders, Cpu, Terminal, RefreshCw } from 'lucide-react';
import type { RuntimeSettings } from '@sthstart/contracts';
import { useRuntimeOverview } from '@/app/features/runtime/queries';
import {
  useStartService,
  useStopService,
  useRestartService,
  useUpdateRuntimeSettings,
  useUpdateCreativeSettings,
  useUpdateLogPolicy,
  useImportLauncherConfig,
  useSyncPublicModel,
} from '@/app/features/runtime/mutations';
import { useLogStream } from '@/app/features/runtime/hooks/use-log-stream';
import { fetchLinsheLaunchUrl, previewLauncherImport, type ImportPreview } from '@/app/features/runtime/api';
import { RuntimeOverviewPanel } from '@/app/features/runtime/components/runtime-overview-panel';
import { RemotePerformancePanel } from '@/app/features/runtime/components/remote-performance-panel';
import { RuntimeServiceList } from '@/app/features/runtime/components/runtime-service-list';
import { RuntimeSettingsForm } from '@/app/features/runtime/components/runtime-settings-form';
import { CreativeSettingsForm } from '@/app/features/runtime/components/creative-settings-form';
import { ModelSettingsPanel } from '@/app/features/runtime/components/model-settings-panel';
import { LogViewer } from '@/app/features/runtime/components/log-viewer';
import { ImportConfigDialog } from '@/app/features/runtime/components/import-config-dialog';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { buttonVariants } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Skeleton } from '@/app/components/ui/skeleton';
import { useToast } from '@/app/providers/ui-provider';

type Tab = 'overview' | 'runtime' | 'creative' | 'models' | 'logs';

export function ControlCenter() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [launchUrl, setLaunchUrl] = useState('/apps/linshe');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [busyAction, setBusyAction] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const toast = useToast();
  const { data: overview, isLoading, error: queryError, refetch } = useRuntimeOverview();

  const startMutation = useStartService();
  const stopMutation = useStopService();
  const restartMutation = useRestartService();
  const settingsMutation = useUpdateRuntimeSettings();
  const creativeMutation = useUpdateCreativeSettings();
  const logPolicyMutation = useUpdateLogPolicy();
  const importMutation = useImportLauncherConfig();
  const syncModelMutation = useSyncPublicModel();

  const { logs, paused, connected, togglePause, clearLogs } = useLogStream();

  useEffect(() => {
    fetchLinsheLaunchUrl().then(setLaunchUrl).catch(() => undefined);
  }, []);

  const handleStartAll = async () => {
    setBusyAction('start-all');
    setErrorMessage('');
    try {
      const services = overview?.services ?? [];
      for (const service of services) {
        if (service.installed && service.state !== 'running') {
          await startMutation.mutateAsync(service.id);
        }
      }
      toast.success('已发送全量启动指令');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.error('启动服务失败', msg);
    } finally {
      setBusyAction('');
    }
  };

  const handleStopAll = async () => {
    setBusyAction('stop-all');
    setErrorMessage('');
    try {
      const services = overview?.services ?? [];
      for (const service of services) {
        if (service.state === 'running') {
          await stopMutation.mutateAsync(service.id);
        }
      }
      toast.success('已发送全量停止指令');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.error('停止服务失败', msg);
    } finally {
      setBusyAction('');
    }
  };

  const handleStart = async (id: string) => {
    setBusyAction(id);
    try {
      await startMutation.mutateAsync(id);
      toast.success('服务启动中');
    } catch (err) {
      toast.error('启动失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  };

  const handleStop = async (id: string) => {
    setBusyAction(id);
    try {
      await stopMutation.mutateAsync(id);
      toast.success('服务已停止');
    } catch (err) {
      toast.error('停止失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  };

  const handleRestart = async (id: string) => {
    setBusyAction(id);
    try {
      await restartMutation.mutateAsync(id);
      toast.success('正在重启服务');
    } catch (err) {
      toast.error('重启失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  };

  const handleSaveSettings = async (values: Partial<RuntimeSettings>) => {
    try {
      await settingsMutation.mutateAsync(values);
      toast.success('运行配置已保存');
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const handleSaveCreative = async (creative: Record<string, unknown>) => {
    try {
      await creativeMutation.mutateAsync(creative);
      toast.success('创作配置已保存');
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const handleSyncPublicModel = async () => {
    try {
      await syncModelMutation.mutateAsync();
      toast.success('已将公共模型配置同步到邻舍');
    } catch (err) {
      toast.error('同步失败', err instanceof Error ? err.message : String(err));
    }
  };

  const handleCheckImport = async () => {
    try {
      const preview = await previewLauncherImport();
      setImportPreview(preview);
      setImportDialogOpen(true);
    } catch (err) {
      toast.error('未能获取旧配置', err instanceof Error ? err.message : String(err));
    }
  };

  const handleCommitImport = async () => {
    try {
      await importMutation.mutateAsync();
      setImportDialogOpen(false);
      toast.success('已成功导入旧启动器配置');
    } catch (err) {
      toast.error('导入失败', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#f4f0e7] text-[#18201d] px-4 sm:px-8 md:px-12 py-6">
      <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader
        backHref="/"
        backLabel="返回门户首页"
        eyebrow="LOCAL SERVICE CONTROL"
        title="邻舍运行控制中心"
        description="统一管理邻舍主服务、ComfyUI、向量数据库与生图依赖，掌控实时日志与自启状态。"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/settings/public-services"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              公共服务
            </Link>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>刷新</span>
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleCheckImport()}>
              <span>导入旧配置</span>
            </Button>
          </div>
        }
      />

      {(errorMessage || queryError) && (
        <Alert
          variant="danger"
          title="服务通讯异常"
          onDismiss={() => setErrorMessage('')}
        >
          {errorMessage || (queryError instanceof Error ? queryError.message : String(queryError))}
        </Alert>
      )}

      {/* Tabs */}
      <div
        className="control-center-tabs sticky top-0 z-20 flex gap-1.5 overflow-x-auto pb-2 pt-2 bg-[#f4f0e7]/90 backdrop-blur-md border-b border-[rgb(24_32_29/12%)]"
        role="tablist"
        aria-label="控制中心分区"
      >
        {[
          { id: 'overview', label: '运行总览', icon: Activity },
          { id: 'runtime', label: '自启与服务', icon: Server },
          { id: 'creative', label: '创作扩展', icon: Sliders },
          { id: 'models', label: '模型接入', icon: Cpu },
          { id: 'logs', label: '实时日志', icon: Terminal },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(item.id as Tab)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#18201d] text-[#f4f0e7]'
                  : 'text-[#68716d] hover:text-[#18201d] hover:bg-[rgb(24_32_29/6%)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {isLoading && !overview && (
        <div className="space-y-4" aria-label="正在加载运行控制中心">
          <Skeleton className="h-40 w-full rounded-[4px_20px_4px_4px]" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Skeleton className="h-28 w-full rounded-[3px_14px_3px_3px]" />
            <Skeleton className="h-28 w-full rounded-[3px_14px_3px_3px]" />
          </div>
        </div>
      )}

      {/* Tab Panels */}
      {tab === 'overview' && (
        <div className="space-y-6 animate-in fade-in" data-visual-dynamic="true">
          <RuntimeOverviewPanel
            overview={overview}
            launchUrl={launchUrl}
            onStartAll={handleStartAll}
            onStopAll={handleStopAll}
            busy={busyAction}
          />
          <RemotePerformancePanel />
          <div>
            <h3 className="font-serif text-xl font-medium text-[#18201d] mb-3">
              已注册服务组件
            </h3>
            <RuntimeServiceList
              services={overview?.services ?? []}
              onStart={handleStart}
              onStop={handleStop}
              onRestart={handleRestart}
              busy={busyAction}
            />
          </div>
        </div>
      )}

      {tab === 'runtime' && (
        <div className="space-y-6 animate-in fade-in">
          <RuntimeSettingsForm
            initialValues={overview?.settings}
            onSubmit={handleSaveSettings}
            loading={settingsMutation.isPending}
          />
          <div>
            <h3 className="font-serif text-xl font-medium text-[#18201d] mb-3">
              服务启停调度
            </h3>
            <RuntimeServiceList
              services={overview?.services ?? []}
              onStart={handleStart}
              onStop={handleStop}
              onRestart={handleRestart}
              busy={busyAction}
            />
          </div>
        </div>
      )}

      {tab === 'creative' && (
        <div className="animate-in fade-in">
          <CreativeSettingsForm
            creative={overview?.settings?.creative}
            onSubmit={handleSaveCreative}
            onSyncPublicModel={handleSyncPublicModel}
            loading={creativeMutation.isPending}
          />
        </div>
      )}

      {tab === 'models' && (
        <div className="animate-in fade-in">
          <ModelSettingsPanel
            linsheLlm={overview?.linsheLlm}
            onSync={handleSyncPublicModel}
            syncing={syncModelMutation.isPending}
          />
        </div>
      )}

      {tab === 'logs' && (
        <div className="animate-in fade-in">
          <LogViewer
            logs={logs}
            paused={paused}
            connected={connected}
            onTogglePause={togglePause}
            onClear={clearLogs}
            policy={overview?.logPolicy}
            onUpdatePolicy={async (p) => {
              await logPolicyMutation.mutateAsync(p);
            }}
          />
        </div>
      )}

      <ImportConfigDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        preview={importPreview}
        onCommit={handleCommitImport}
        loading={importMutation.isPending}
      />
      </div>
    </main>
  );
}
