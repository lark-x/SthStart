'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Drawer } from '@/app/components/ui/drawer';
import { useQueryClient } from '@tanstack/react-query';
import type { NarrativeSearchResult } from '@sthstart/contracts';
import {
  useNarrativeWorks,
  useNarrativeTree,
  useNarrativeReading,
  useNarrativeSearch,
  useNarrativeConnectors,
} from '../queries';
import { attachNarrativeConcept, fetchNarrativeGenerationTask, generateNarrativeConcept, saveUtteranceToNotebook } from '../api';
import { NarrativeTree } from './narrative-tree';
import { NarrativeReader } from './narrative-reader';
import { NarrativeInspector } from './narrative-inspector';
import { NarrativeImport } from './narrative-import';
import { ResearchWorkspace } from './research-workspace';
import { narrativeKeys } from '@/app/lib/query-keys';
import { useToast } from '@/app/providers/ui-provider';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { AsyncState } from '@/app/components/ui/async-state';
import { Button } from '@/app/components/ui/button';
import { cn } from '@/app/lib/cn';
import type { NarrativeAdoptAction } from '../adopt-action';
import { narrativeModeFromParams, nextNarrativeReadingHref, type NarrativeMode } from '../model/narrative-route';

export function NarrativeWorkspace({ adoptAction }: { adoptAction?: NarrativeAdoptAction }) {
  const toast = useToast();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // 窄屏下目录默认收起：正文优先，目录与检索各自单独打开（§8.9）。
  const [treeOpen, setTreeOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrow(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedReturn = searchParams.get('returnTo');
  const resourceReturnHref = requestedReturn === '/apps/resources' || requestedReturn?.startsWith('/apps/resources?')
    ? requestedReturn
    : searchParams.get('from') === 'resources'
    ? '/apps/resources'
    : undefined;
  const urlMode: NarrativeMode = narrativeModeFromParams(searchParams);
  /*
   * 模式先落在本地，再写入 URL。阅读态的 work/node 同步使用原生 replaceState，
   * 因此不会发起第二次 RSC 导航；但旧版本可能已经排入一次 replace，故点击时
   * 同步记录模式意图，避免延迟任务以旧 URL 覆盖刚选中的导入/研究页。
   * URL 仍是最终来源：刷新、前进后退和深链接会把模式同步回来。
   */
  const [mode, setModeState] = useState<NarrativeMode>(urlMode);
  const [lastUrlMode, setLastUrlMode] = useState<NarrativeMode>(urlMode);
  const modeRef = useRef<NarrativeMode>(urlMode);
  if (urlMode !== lastUrlMode) {
    setLastUrlMode(urlMode);
    setModeState(urlMode);
  }
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const setMode = (next: NarrativeMode) => {
    modeRef.current = next;
    setModeState(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('mode', next);
    if (next !== 'research') { params.delete('project'); params.delete('view'); }
    router.push(`${pathname}?${params}`, { scroll: false });
  };
  const [selectedWorkId, setSelectedWorkId] = useState<string>(() => searchParams.get('work') ?? '');
  const [selectedNodeId, setSelectedNodeId] = useState<string>(() => searchParams.get('node') ?? '');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [conceptTaskId, setConceptTaskId] = useState<string | null>(null);
  const [submittingConcept, setSubmittingConcept] = useState(false);
  const activeNodeIdRef = useRef('');
  // 概念图任务绑定提交时的节点；轮询与 attach 始终使用该节点，
  // 避免用户切换节点后轮询用新节点查询旧任务导致 404 和任务孤儿。
  const submittedNodeIdRef = useRef('');

  const { data: worksData, refetch: refetchWorks, isPending: worksLoading, error: worksError } = useNarrativeWorks();
  const works = worksData?.items ?? [];

  const activeWorkId = works.some((work) => work.id === selectedWorkId)
    ? selectedWorkId
    : works[0]?.id ?? '';

  const { data: treeData, refetch: refetchTree, isLoading: treeLoading, error: treeError } = useNarrativeTree(activeWorkId);
  const nodes = treeData?.items ?? [];

  const firstReadableNode = nodes.find((node) => node.kind !== 'chapter') ?? nodes[0];
  const activeNodeId = nodes.some((node) => node.id === selectedNodeId)
    ? selectedNodeId
    : firstReadableNode?.id ?? '';

  const { data: readingData, isLoading: readingLoading, refetch: refetchReading, error: readingError } = useNarrativeReading(activeNodeId);
  const sourceError = worksError ?? treeError ?? readingError;
  useEffect(() => {
    activeNodeIdRef.current = activeNodeId;
  }, [activeNodeId]);
  const { data: searchData, isLoading: searchLoading, isError: searchError, error: searchFailure, refetch: refetchSearch } = useNarrativeSearch(searchQuery, activeWorkId);
  const { data: connectorsData, isLoading: connectorsLoading, isError: connectorsError, error: connectorsFailure, refetch: refetchConnectors } = useNarrativeConnectors();
  const connectors = connectorsData?.items ?? [];
  const searchErrorMessage = searchError
    ? (searchFailure instanceof Error ? searchFailure.message : '原文检索失败')
    : null;
  const connectorsErrorMessage = connectorsError
    ? (connectorsFailure instanceof Error ? connectorsFailure.message : '数据源连接器读取失败')
    : null;

  // 选中的作品与节点进入 URL，刷新、前进后退和从检索结果跳转后都能恢复阅读位置。
  useEffect(() => {
    const current = window.location.pathname + window.location.search + window.location.hash;
    const next = nextNarrativeReadingHref({
      currentHref: current,
      workId: activeWorkId,
      nodeId: activeNodeId,
      mode,
      intendedMode: modeRef.current,
      worksLoading,
      treeLoading,
    });
    if (next) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [activeNodeId, activeWorkId, mode, treeLoading, worksLoading]);

  const handleGenerateConcept = async () => {
    if (!activeNodeId || conceptTaskId || submittingConcept) return;
    setSubmittingConcept(true);
    // 记住提交时的节点；等待期间用户可能已切到其他节点。
    const submittedNodeId = activeNodeId;
    try {
      const task = await generateNarrativeConcept(submittedNodeId);
      submittedNodeIdRef.current = submittedNodeId;
      setConceptTaskId(task.id);
      if (activeNodeIdRef.current !== submittedNodeId) {
        toast.info('概念图生成任务已提交', '你已切换到其他剧情节点，完成后会自动附加到原节点。');
      } else {
        toast.success('概念图生成任务已提交');
      }
    } catch (error) {
      toast.error('提交概念图生成失败', error instanceof Error ? error.message : String(error));
    } finally {
      setSubmittingConcept(false);
    }
  };

  useEffect(() => {
    if (!conceptTaskId) return;
    // 使用提交时的节点而不是当前 activeNodeId：切换节点不应中断轮询，
    // 任务完成后 attach 到原节点，避免生成结果变成孤儿。
    const targetNodeId = submittedNodeIdRef.current || activeNodeIdRef.current;
    if (!targetNodeId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const task = await fetchNarrativeGenerationTask(targetNodeId, conceptTaskId);
        if (stopped) return;
        if (task.status === 'succeeded') {
          await attachNarrativeConcept(targetNodeId, conceptTaskId);
          if (!stopped) {
            setConceptTaskId(null);
            await refetchReading();
            toast.success('概念图已附加到原剧情节点');
          }
          return;
        }
        if (['failed', 'cancelled', 'abandoned'].includes(task.status)) {
          setConceptTaskId(null);
          toast.error('概念图生成失败', task.errorMessage || '生成任务未完成');
          return;
        }
        timer = window.setTimeout(() => void poll(), 1_500);
      } catch (error) {
        if (!stopped) {
          setConceptTaskId(null);
          toast.error('查询概念图状态失败', error instanceof Error ? error.message : String(error));
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [conceptTaskId, refetchReading, toast]);

  const handleSaveToNotebook = async (utteranceId: string) => {
    try {
      const res = await saveUtteranceToNotebook(utteranceId);
      toast.success('已存入创作笔记');
      window.location.assign(res.href);
    } catch (e) {
      toast.error('存入笔记失败', e instanceof Error ? e.message : String(e));
    }
  };

  const handleSelectSearchResult = (res: NarrativeSearchResult) => {
    setMode('read');
    setInspectorOpen(false);
    if (res.nodeId) {
      setConceptTaskId(null);
      setSelectedNodeId(res.nodeId);
    } else if (res.workId !== activeWorkId) {
      setConceptTaskId(null);
      setSelectedWorkId(res.workId);
      setSelectedNodeId('');
    }
  };

  const handleImportComplete = async (workId: string) => {
    setSelectedWorkId(workId);
    setSelectedNodeId('');
    setMode('read');
    // 增量导入后 tree/reading 有 20-30s 的 staleTime 且不随焦点刷新，
    // 不显式失效的话新导入的内容会“看起来没生效”。
    await queryClient.invalidateQueries({ queryKey: narrativeKeys.all });
    await refetchWorks();
  };

  const treePanel = (
              <NarrativeTree
                works={works}
                selectedWorkId={activeWorkId}
                onSelectWork={(workId) => {
                  setConceptTaskId(null);
                  setSelectedWorkId(workId);
                  setSelectedNodeId('');
                }}
                nodes={nodes}
                selectedNodeId={activeNodeId}
                onSelectNode={(nodeId) => {
                  setConceptTaskId(null);
                  setSelectedNodeId(nodeId);
                  setTreeOpen(false);
                }}
                onOpenImport={() => setMode('import')}
              />
  );

  const modeTabs = (
            <PageTabs
              variant="local"
              ariaLabel="叙事工作模式"
              value={mode}
              onChange={(id) => setMode(id as 'read' | 'research' | 'import')}
              tabs={[
                { id: 'read', label: '阅读' },
                { id: 'research', label: '研究专题' },
                { id: 'import', label: '数据源与导入' },
              ]}
            />
  );
  const readingActions = (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="md:hidden"
                  aria-expanded={treeOpen}
                  onClick={() => setTreeOpen((open) => !open)}
                >
                  目录
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant={inspectorOpen ? 'secondary' : 'outline'}
                  aria-expanded={inspectorOpen}
                  onClick={() => setInspectorOpen((open) => !open)}
                >
                  检索原文
                </Button>
              </div>
  );

  const WorkspaceRoot = 'div';

  return (
    <WorkspaceRoot className={cn("flex min-h-0 min-w-0 w-full flex-col", mode === 'read' && 'h-full overflow-hidden')}>
      {/* 页头与工作模式：与外框统一的标题区，模式用 tab 语义而非自绘分段控件。 */}
      {mode === 'read' ? <WorkspaceHeader
        title="叙事档案"
        backHref={resourceReturnHref}
        backLabel={resourceReturnHref ? "返回资料库" : undefined}
        centerSlotOnMobile
        centerSlot={modeTabs}
        actions={readingActions}
      /> : <div className="narrative-workspace-header shrink-0 bg-paper">
        <PageContainer className="pt-3 pb-0">
          <PageHeader
            compact
            backHref={resourceReturnHref}
            backLabel={resourceReturnHref ? "返回资料库" : undefined}
            title="叙事档案"
            description="任务链阅读、多作品追溯与原文检索。"
            navigation={modeTabs}
          />
        </PageContainer>
      </div>}

      {/* Main Workspace */}
      <div className={cn("flex min-h-0 flex-1 flex-col", mode === 'read' && 'md:flex-row md:gap-4 md:px-5 md:pb-4')}>
        {mode === 'read' ? (
          <>
            {/* 宽屏常驻左栏；窄屏默认隐藏，由页头「目录」按钮单独打开。 */}
            <div className="hidden min-h-0 md:flex md:w-64 md:flex-none md:overflow-hidden md:rounded-panel md:bg-surface md:shadow-xs">
              {treePanel}
            </div>

            {sourceError ? <div className="flex min-w-0 flex-1 items-center justify-center rounded-panel bg-surface p-6 shadow-xs">
              <AsyncState
                status="error"
                title="档案暂时无法读取"
                description="已有内容未被删除。请重试读取，不必重新导入。"
                onRetry={() => { void refetchWorks(); if (activeWorkId) void refetchTree(); if (activeNodeId) void refetchReading(); }}
                retryLabel="重试读取"
              />
            </div> : worksLoading || treeLoading ? <div className="min-w-0 flex-1 rounded-panel bg-surface p-6 shadow-xs"><AsyncState status="loading" rows={5} /></div> : <NarrativeReader
              reading={readingData ?? null}
              loading={readingLoading}
              onSaveUtteranceToNotebook={handleSaveToNotebook}
              onOpenImport={() => setMode('import')}
              onGenerateConcept={() => void handleGenerateConcept()}
              generatingConcept={Boolean(conceptTaskId) || submittingConcept}
              adoptAction={adoptAction}
            />}

            {inspectorOpen && <div className="hidden min-h-0 md:flex md:overflow-hidden md:rounded-panel md:shadow-xs"><NarrativeInspector
              query={searchQuery}
              onQueryChange={setSearchQuery}
              results={searchData?.items ?? []}
              loading={searchLoading}
              error={searchErrorMessage}
              onRetry={() => { void refetchSearch(); }}
              onSelectResult={handleSelectSearchResult}
            /></div>}
            <Drawer open={narrow && treeOpen} onOpenChange={setTreeOpen} title="作品目录" className="md:hidden">{treePanel}</Drawer>
            <Drawer open={narrow && inspectorOpen} onOpenChange={setInspectorOpen} title="检索原文" className="md:hidden">
              <NarrativeInspector query={searchQuery} onQueryChange={setSearchQuery} results={searchData?.items ?? []} loading={searchLoading} error={searchErrorMessage} onRetry={() => { void refetchSearch(); }} onSelectResult={handleSelectSearchResult} />
            </Drawer>
          </>
        ) : mode === 'research' ? (
          <ResearchWorkspace works={works} />
        ) : (
          <NarrativeImport
            connectors={connectors}
            connectorsLoading={connectorsLoading}
            connectorsError={connectorsErrorMessage}
            onRetryConnectors={() => { void refetchConnectors(); }}
            onImportComplete={handleImportComplete}
          />
        )}
      </div>
    </WorkspaceRoot>
  );
}
