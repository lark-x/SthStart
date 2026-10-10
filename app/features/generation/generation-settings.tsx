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
import { ActivityImagePromptPolicyPanel } from './components/activity-image-prompt-policy-panel';
import { ActivityLoraPolicyPanel } from './components/activity-lora-policy-panel';
import { ActivityImageQuickSettings } from './components/activity-image-quick-settings';

/**
 * 生成配置工作台：工作流、连接、预设与用途，以及按工作流版本保存的活动生图提示词策略。
 * 原「诊断」保留为连接详情内的高级诊断；不再以技术对象罗列配置。
 */
export function GenerationSettingsFeature() {
  const toast = useToast();
  const [section, setSection] = useState('quick');
  const [advancedSection, setAdvancedSection] = useState('workflows');
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
      const results = await Promise.allSettled([
        fetchGenerationEngines(), fetchGenerationWorkers(), fetchGenerationWorkflows(),
        fetchGenerationAssignments(), fetchMediaDiagnostics(),
      ]);
      const [engineItems, workerItems, workflowItems, assignmentItems, diagnosticsData] = results;
      if (engineItems.status === 'fulfilled') setEngines(engineItems.value);
      if (workerItems.status === 'fulfilled') setWorkers(workerItems.value);
      if (workflowItems.status === 'fulfilled') setWorkflows(workflowItems.value);
      if (assignmentItems.status === 'fulfilled') setAssignments(assignmentItems.value);
      if (diagnosticsData.status === 'fulfilled') setDiagnostics(diagnosticsData.value);
      const labels = ['连接', '工作节点', '工作流', '用途绑定', '媒体诊断'];
      setError(results.flatMap((result, index) => result.status === 'rejected'
        ? [`${labels[index]}：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []).join('；'));
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
        backLabel="返回图像工坊"
        title="生成配置"
        description="管理连接、工作流、生成方案与提示词策略。生图页面中的修改仅用于本次任务；这里保存的设置用于后续任务。"
        actions={(
          <Button size="sm" variant="outline" onClick={() => { void load(); }}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />刷新
          </Button>
        )}
      />
      {error && <Alert variant="danger" title="部分生成配置未能读取" onDismiss={() => setError('')}>{error}</Alert>}
      <PageTabs
        ariaLabel="生成配置分类"
        value={section}
        onChange={setSection}
        tabs={[
          { id: 'quick', label: '常用设置', panelId: 'generation-panel-quick' },
          { id: 'advanced', label: '高级配置', panelId: 'generation-panel-advanced' },
        ]}
      />
      {loading ? (
        <div className="tpl-panel p-12 text-center text-sm text-muted" role="status">正在读取生成配置…</div>
      ) : (
        <>
          <div id="generation-panel-quick" role="tabpanel" hidden={section !== 'quick'}>
            <ActivityImageQuickSettings workflows={workflows} assignments={assignments} onDataChanged={load} onManagePrompts={() => { setSection('advanced'); setAdvancedSection('prompts'); }} />
          </div>
          <div id="generation-panel-advanced" role="tabpanel" hidden={section !== 'advanced'} className="space-y-4">
            <PageTabs ariaLabel="高级生成配置分类" value={advancedSection} onChange={setAdvancedSection} tabs={[
              { id: 'workflows', label: '工作流', panelId: 'generation-advanced-workflows' },
              { id: 'connections', label: '连接', panelId: 'generation-advanced-connections' },
              { id: 'presets', label: '预设与用途', panelId: 'generation-advanced-presets' },
              { id: 'prompts', label: '提示词策略', panelId: 'generation-advanced-prompts' },
              { id: 'loras', label: 'LoRA / 细化', panelId: 'generation-advanced-loras' },
            ]} />
          <div id="generation-advanced-workflows" role="tabpanel" hidden={advancedSection !== 'workflows'}>
            <WorkflowWorkspace
              workflows={workflows}
              engines={engines}
              onDataChanged={load}
              onSaveAsPreset={(values, workflowId, workflowVersion) => {
                setSavePresetRequest({ workflowId, workflowVersion, values });
                setSection('advanced');
                setAdvancedSection('presets');
                toast.info('请在预设面板确认参数', '已带入试运行参数，保存后可在图像工坊选择。');
              }}
            />
          </div>
          <div id="generation-advanced-connections" role="tabpanel" hidden={advancedSection !== 'connections'}>
            <ConnectionsPanel engines={engines} workers={workers} diagnostics={diagnostics} onRefresh={load} />
          </div>
          <div id="generation-advanced-presets" role="tabpanel" hidden={advancedSection !== 'presets'}>
            <PresetPanel
              workflows={workflows}
              engines={engines}
              assignments={assignments}
              draftFor={savePresetRequest}
              onDataChanged={load}
            />
          </div>
          <div id="generation-advanced-prompts" role="tabpanel" hidden={advancedSection !== 'prompts'} className="space-y-3">
            <p className="text-sm text-muted">策略按工作流版本保存；图像工坊与角色头像使用各自应用绑定的文本模型，活动使用活动文本模型。手动最终提示词会跳过 AI 改写。</p>
            <ActivityImagePromptPolicyPanel workflows={workflows} />
          </div>
          <div id="generation-advanced-loras" role="tabpanel" hidden={advancedSection !== 'loras'}>
            <p className="mb-3 text-sm text-muted">活动可继承全局与角色 LoRA；其他用途的 LoRA 通过工作流映射参数配置。放大细化继承原图冻结配置，在结果旁进入。</p>
            <ActivityLoraPolicyPanel workflows={workflows} />
          </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
