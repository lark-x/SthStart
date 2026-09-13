'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FilePlus2, Play, Save, Upload } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Drawer } from '@/app/components/ui/drawer';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { SaveStatus } from '@/app/components/ui/save-status';
import { Select } from '@/app/components/ui/select';
import { EmptyState } from '@/app/components/ui/empty-state';
import {
  duplicateWorkflow,
  fetchWorkflowDraft,
  publishWorkflowVersion,
  saveWorkflowDraft,
} from '../api';
import type { DraftPayload, Engine, Workflow } from '../types';
import { AdvancedFieldsEditor } from './advanced-fields-editor';
import { IoFieldsEditor } from './io-fields-editor';
import { ModelFieldsEditor } from './model-fields-editor';
import { ParameterFieldsEditor } from './parameter-fields-editor';
import { TestRunPanel } from './test-run-panel';
import { WorkflowImportDialog } from './workflow-import-dialog';

/**
 * 工作流工作区（规划 §4.2 / §6 / §9）：
 * 可用宽度 ≥1172px 三栏（列表 240 / 编辑区自适应 / 试运行 340）；不足时试运行走抽屉；
 * <1024 单列。切换工作流保留草稿；保存失败或版本冲突必须提示，不静默覆盖。
 */

type SaveState = 'idle' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

/** 稳定序列化：键序无关，用于「草稿内容未变化则复用版本」的对比（规划 §9.2）。 */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function draftContentKey(draft: DraftPayload | null): string {
  if (!draft) return '';
  return stableKey([
    draft.definition, draft.inputSchema, draft.nodeBindings, draft.outputDeclarations,
    draft.inputCapabilities, draft.outputMediaTypes, draft.outputSchema, draft.engineId, draft.editorConfig,
  ]);
}

export function WorkflowWorkspace({
  workflows,
  engines,
  onDataChanged,
  onSaveAsPreset,
}: {
  workflows: Workflow[];
  engines: Engine[];
  onDataChanged: () => Promise<void>;
  onSaveAsPreset?: (values: Record<string, unknown>, workflowId: string, workflowVersion: number) => void;
}) {
  const [selectedId, setSelectedId] = useState(workflows[0]?.id ?? '');
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveDetail, setSaveDetail] = useState('');
  const [editorTab, setEditorTab] = useState('model');
  const [importOpen, setImportOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [conflictServerDraft, setConflictServerDraft] = useState<DraftPayload | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<DraftPayload | null>(null);
  const revisionRef = useRef(1);
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const conflictRevisionRef = useRef<number | null>(null);
  const loadSequenceRef = useRef(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [inlineTest, setInlineTest] = useState(false);
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setInlineTest(entry.contentRect.width >= 1172);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [workflows.length]);
  /** 最近一次成功发布的版本所对应的内容键；「保存并试生成」据此复用版本（规划 §9.2）。 */
  const publishedKeyRef = useRef<string | null>(null);

  const workflow = workflows.find((item) => item.id === selectedId);

  const loadDraft = useCallback(async (workflowId: string) => {
    const sequence = ++loadSequenceRef.current;
    draftRef.current = null;
    dirtyRef.current = false;
    conflictRevisionRef.current = null;
    setConflictServerDraft(null);
    setDraft(null);
    setDirty(false);
    setSaveState('idle');
    setSaveDetail('');
    try {
      const serverDraft = await fetchWorkflowDraft(workflowId);
      if (sequence !== loadSequenceRef.current) return;
      setDraft(serverDraft.draft);
      setBaseVersion(serverDraft.baseVersion);
      revisionRef.current = serverDraft.revision;
      draftRef.current = serverDraft.draft;
      publishedKeyRef.current = null;
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      setSaveState('error');
      setSaveDetail(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      // 草稿来自服务端 API（外部系统）；切换工作流时重新加载。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDraft(selectedId);
    }
  }, [selectedId, loadDraft]);

  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (savingRef.current) return savingRef.current;
    if (conflictRevisionRef.current !== null) return false;
    if (!draftRef.current || !dirtyRef.current || !selectedId) return true;
    const save = async (): Promise<boolean> => {
      while (dirtyRef.current && draftRef.current) {
        const current = draftRef.current;
        setSaveState('saving');
        try {
          const result = await saveWorkflowDraft(selectedId, revisionRef.current, current);
          if ('error' in result) {
            setConflictServerDraft(result.draft.draft);
            conflictRevisionRef.current = result.draft.revision;
            setSaveState('conflict');
            setSaveDetail('草稿已被其他窗口修改。');
            return false;
          }
          revisionRef.current = result.revision;
          setBaseVersion(result.baseVersion);
          if (draftRef.current === current) {
            dirtyRef.current = false;
            setDirty(false);
            setSaveState('saved');
            setSaveDetail('');
          }
        } catch (error) {
          setSaveState('error');
          setSaveDetail(error instanceof Error ? error.message : String(error));
          return false;
        }
      }
      return true;
    };
    savingRef.current = save();
    try { return await savingRef.current; }
    finally { savingRef.current = null; }
  }, [selectedId]);

  const updateDraft = useCallback((mutator: (current: DraftPayload) => DraftPayload) => {
    if (!draftRef.current) return;
    const next = mutator(draftRef.current);
    draftRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
    setDirty(true);
    if (conflictRevisionRef.current === null) setSaveState('unsaved');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushDraft(); }, 900);
  }, [flushDraft]);

  const resolveDraftDirtyState = useMemo(() => (dirty && saveState === 'saved' ? 'unsaved' : saveState), [dirty, saveState]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      ++loadSequenceRef.current;
    };
  }, []);

  const selectWorkflow = async (id: string) => {
    if (id === selectedId || !await flushDraft()) return;
    setSelectedId(id);
    setTestOpen(false);
  };

  const adoptServerDraft = () => {
    if (!conflictServerDraft) return;
    setDraft(conflictServerDraft);
    draftRef.current = conflictServerDraft;
    revisionRef.current = conflictRevisionRef.current ?? revisionRef.current;
    conflictRevisionRef.current = null;
    dirtyRef.current = false;
    setDirty(false);
    setSaveState('saved');
    setConflictServerDraft(null);
    setSaveDetail('');
  };

  const overwriteServerDraft = async () => {
    if (!conflictServerDraft || !selectedId) return;
    try {
      const server = await fetchWorkflowDraft(selectedId);
      revisionRef.current = server.revision;
      conflictRevisionRef.current = null;
      setConflictServerDraft(null);
      dirtyRef.current = true;
      setDirty(true);
      await flushDraft();
    } catch (error) {
      setSaveDetail(error instanceof Error ? error.message : String(error));
    }
  };

  const publishCurrentDraft = async (): Promise<number | null> => {
    if (!draft || !workflow) return null;
    setPublishing(true);
    setPublishError('');
    const flushed = await flushDraft();
    if (!flushed) {
      setPublishing(false);
      return null;
    }
    const savedDraft = draftRef.current;
    if (!savedDraft) { setPublishing(false); return null; }
    // 草稿内容与最近发布版本一致时复用该版本，不重复发布（规划 §9.2）。
    const contentKey = draftContentKey(savedDraft);
    if (publishedKeyRef.current === contentKey) {
      setPublishing(false);
      return baseVersion;
    }
    try {
      const response = await publishWorkflowVersion(workflow.id, {
        engineId: savedDraft.engineId ?? undefined,
        definition: savedDraft.definition,
        inputSchema: savedDraft.inputSchema,
        inputCapabilities: savedDraft.inputCapabilities,
        nodeBindings: savedDraft.nodeBindings,
        outputDeclarations: savedDraft.outputDeclarations,
        outputMediaTypes: savedDraft.outputMediaTypes,
        outputSchema: savedDraft.outputSchema,
        ...(savedDraft.editorConfig ? { editorConfig: savedDraft.editorConfig } : {}),
      });
      setBaseVersion(response.version);
      publishedKeyRef.current = contentKey;
      setSaveState('saved');
      await onDataChanged();
      return response.version;
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setPublishing(false);
    }
  };

  const testRunForm = draft ? (
    <TestRunPanel
      key={selectedId}
      workflowId={selectedId}
      workflowName={draft.name ?? workflow?.name ?? selectedId}
      draft={draft}
      basicFieldKeys={Object.values(draft.editorConfig?.fields ?? {})
        .filter((field) => field.section === 'basic' && field.type !== 'model' && field.type !== 'seed' && field.key !== 'seed')
        .sort((left, right) => left.order - right.order)
        .map((field) => {
          const schema = draft.inputSchema[field.key];
          const entry = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema as Record<string, unknown> : {};
          return {
            key: field.key,
            label: field.label,
            type: String(field.type ?? entry.type ?? 'text'),
            ...(Array.isArray(entry.enum) ? { enumValues: entry.enum as string[] } : {}),
            ...(entry.default !== undefined ? { defaultValue: entry.default } : {}),
          };
        })}
      defaultValues={Object.fromEntries(Object.entries(draft.inputSchema).map(([key, entry]) => {
        const value = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>).default : undefined;
        return [key, value];
      }))}
      onClose={() => setTestOpen(false)}
      onBeforeRun={() => publishCurrentDraft()}
      onSaveAsPreset={(values, version) => onSaveAsPreset?.(values, selectedId, version)}
    />
  ) : null;

  if (!workflows.length) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="还没有生成工作流"
          description="导入一套 ComfyUI API 格式工作流开始配置：系统会自动分析节点并生成参数映射草稿。"
          actions={(
            <Button variant="primary" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" />导入工作流
            </Button>
          )}
        />
        <WorkflowImportDialog open={importOpen} onOpenChange={setImportOpen} engines={engines} onImported={async (id) => { await onDataChanged(); await selectWorkflow(id); }} />
      </div>
    );
  }

  return (
    <div ref={workspaceRef} className="space-y-3" data-testid="workflow-workspace">
      {/* 头部：固定当前工作流名称、保存状态与当前版本；技术信息折叠在高级页签。 */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-border-subtle bg-surface px-4 py-3">
        <Select
          aria-label="选择工作流"
          value={selectedId}
          onChange={(event) => { void selectWorkflow(event.target.value); }}
          className="w-auto min-w-44"
        >
          {workflows.map((item) => (
            <option key={item.id} value={item.id}>{item.name}{item.archivedAt ? '（已归档）' : ''}</option>
          ))}
        </Select>
        <Badge variant="outline">v{baseVersion || workflow?.latest_version || 0}</Badge>
        <SaveStatus state={resolveDraftDirtyState} detail={saveDetail} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />导入
          </Button>
          <Button size="sm" variant="outline" onClick={() => { void (async () => { if (!await flushDraft()) return; try { const result = await duplicateWorkflow(selectedId); await onDataChanged(); await selectWorkflow(result.id); } catch (error) { setPublishError(error instanceof Error ? error.message : String(error)); } })(); }}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />复制
          </Button>
          <Button size="sm" variant="outline" onClick={() => { void publishCurrentDraft(); }} loading={publishing}>
            <Save className="h-3.5 w-3.5" aria-hidden="true" />保存版本
          </Button>
          <Button size="sm" variant="primary" className={inlineTest ? 'hidden' : ''} onClick={() => setTestOpen(true)}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />试运行
          </Button>
        </div>
      </div>

      {publishError && <Alert variant="danger" title="保存版本失败" onDismiss={() => setPublishError('')}>{publishError}</Alert>}
      {saveState === 'conflict' && (
        <Alert variant="warning" title="草稿版本冲突">
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={adoptServerDraft}>采用服务器草稿</Button>
            <Button size="sm" variant="primary" onClick={() => { void overwriteServerDraft(); }}>以我的内容覆盖</Button>
          </div>
        </Alert>
      )}

      <div className={`grid grid-cols-1 gap-4 ${inlineTest ? 'grid-cols-[240px_minmax(560px,1fr)_340px]' : 'lg:grid-cols-[240px_minmax(0,1fr)]'}`}>
        {/* 工作流列表：<1024 由顶部选择器代替。 */}
        <aside className="hidden min-h-0 lg:block" aria-label="工作流列表">
          <ul className="space-y-1.5">
            {workflows.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => { void selectWorkflow(item.id); }}
                  aria-current={item.id === selectedId ? 'true' : undefined}
                  className={`w-full rounded-[var(--radius-control)] border p-2.5 text-left ${item.id === selectedId ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface hover:bg-ink/4'}`}
                >
                  <span className="block truncate text-sm font-semibold">{item.name}</span>
                  <span className="mt-0.5 block text-sm text-muted">v{item.latest_version} · {item.category ?? 'image'}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* 编辑区：四个页签。 */}
        <section className="min-w-0" aria-label="工作流编辑区">
          <PageTabs
            ariaLabel="工作流编辑页签"
            value={editorTab}
            onChange={setEditorTab}
            tabs={[
              { id: 'model', label: '模型', panelId: 'wf-panel-model' },
              { id: 'params', label: '参数', panelId: 'wf-panel-params' },
              { id: 'io', label: '输入与输出', panelId: 'wf-panel-io' },
              { id: 'advanced', label: '高级', panelId: 'wf-panel-advanced' },
            ]}
          />
          <div className="mt-3">
            {draft && editorTab === 'model' && <ModelFieldsEditor draft={draft} engines={engines} updateDraft={updateDraft} />}
            {draft && editorTab === 'params' && <ParameterFieldsEditor draft={draft} updateDraft={updateDraft} />}
            {draft && editorTab === 'io' && <IoFieldsEditor draft={draft} updateDraft={updateDraft} />}
            {draft && editorTab === 'advanced' && (
              <AdvancedFieldsEditor
                workflowId={selectedId}
                draft={draft}
                workflow={workflow}
                baseVersion={baseVersion}
                engines={engines}
                updateDraft={updateDraft}
                onDuplicated={async (newId) => { await onDataChanged(); await selectWorkflow(newId); }}
              />
            )}
            {!draft && <div className="tpl-panel p-12 text-center text-sm text-muted" role="status">正在读取草稿…</div>}
          </div>
        </section>

        {/* 根据工作区实际宽度决定常驻，避免侧栏挤占空间导致溢出。 */}
        {inlineTest && <aside aria-label="试运行区">
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
            {testRunForm}
          </div>
        </aside>}
      </div>

      <Drawer open={testOpen && !inlineTest} onOpenChange={setTestOpen} title="试运行">
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto">{testRunForm}</div>
      </Drawer>

      <WorkflowImportDialog open={importOpen} onOpenChange={setImportOpen} engines={engines} onImported={async (id) => { await onDataChanged(); await selectWorkflow(id); }} />
    </div>
  );
}
