'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { useToast } from '@/app/providers/ui-provider';
import {
  fetchGenerationAssignments,
  fetchGenerationEngines,
  fetchGenerationWorkers,
  fetchGenerationWorkflows,
  fetchMediaDiagnostics,
} from './api';
import type { Assignment, Engine, MediaDiagnostics, Workflow, Worker } from './types';
import { ConnectionsPanel } from './components/connection-panel';
import { PresetPanel } from './components/preset-panel';
import { WorkflowWorkspace } from './components/workflow-workspace';

/**
 * 生成配置工作台（规划 §4.1）：三个主标签——工作流（默认）、连接、预设与用途。
 * 原「诊断」保留为连接详情内的高级诊断；不再以技术对象罗列配置。
 */
export function GenerationSettingsFeature() {
  const toast = useToast();
  const [section, setSection] = useState('workflows');
  const [engines, setEngines] = useState<Engine[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [diagnostics, setDiagnostics] = useState<MediaDiagnostics | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savePresetRequest, setSavePresetRequest] = useState<{ workflowId: string; workflowVersion: number; values: Record<string, unknown> } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [engineItems, workerItems, workflowItems, assignmentItems, diagnosticsData] = await Promise.all([
        fetchGenerationEngines(),
        fetchGenerationWorkers(),
        fetchGenerationWorkflows(),
        fetchGenerationAssignments(),
        fetchMediaDiagnostics(),
      ]);
      // 数据局部加载：部分数据源失败不应让整个配置页进入失败空白。
      setEngines(engineItems);
      setWorkers(workerItems);
      setWorkflows(workflowItems);
      setAssignments(assignmentItems);
      setDiagnostics(diagnosticsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 页面数据来自管理 API（外部系统）；挂载时加载一次（沿用本页既有约定）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <PageContainer width="wide" className="space-y-4 py-6">
      <PageHeader
        backHref="/apps/creative"
        backLabel="返回创作中心"
        title="生成配置工作台"
        description="选工作流 → 选兼容模型 → 配置参数 → 生成。连接、工作流、预设与默认用途统一在这里管理。"
        actions={(
          <Button size="sm" variant="outline" onClick={() => { void load(); }}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />刷新
          </Button>
        )}
      />
      {error && <Alert variant="danger" title="生成配置读取失败" onDismiss={() => setError('')}>{error}</Alert>}
      <PageTabs
        ariaLabel="生成配置分类"
        value={section}
        onChange={setSection}
        tabs={[
          { id: 'workflows', label: '工作流', panelId: 'generation-panel-workflows' },
          { id: 'connections', label: '连接', panelId: 'generation-panel-connections' },
          { id: 'presets', label: '预设与用途', panelId: 'generation-panel-presets' },
        ]}
      />
      {loading ? (
        <div className="tpl-panel p-12 text-center text-sm text-muted" role="status">正在读取生成配置…</div>
      ) : (
        <>
          <div id="generation-panel-workflows" role="tabpanel" hidden={section !== 'workflows'}>
            <WorkflowWorkspace
              workflows={workflows}
              engines={engines}
              onDataChanged={load}
              onSaveAsPreset={(values, workflowId, workflowVersion) => {
                setSavePresetRequest({ workflowId, workflowVersion, values });
                setSection('presets');
                toast.info('请在预设面板确认参数', '已带入试运行参数，保存后可在创作中心选择。');
              }}
            />
          </div>
          <div id="generation-panel-connections" role="tabpanel" hidden={section !== 'connections'}>
            <ConnectionsPanel engines={engines} workers={workers} diagnostics={diagnostics} onRefresh={load} />
          </div>
          <div id="generation-panel-presets" role="tabpanel" hidden={section !== 'presets'}>
            <PresetPanel
              workflows={workflows}
              engines={engines}
              assignments={assignments}
              draftFor={savePresetRequest}
              onDataChanged={load}
            />
          </div>
        </>
      )}
    </PageContainer>
  );
}
