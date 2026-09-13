'use client';

import React, { useEffect, useRef, useState } from 'react';
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
import { narrativeKeys } from '@/app/lib/query-keys';
import { useToast } from '@/app/providers/ui-provider';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { cn } from '@/app/lib/cn';

export function NarrativeWorkspace() {
  const toast = useToast();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // 窄屏下目录默认收起：正文优先，目录与检索各自单独打开（§8.9）。
  const [treeOpen, setTreeOpen] = useState(false);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'read' | 'import'>('read');
  const [selectedWorkId, setSelectedWorkId] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [conceptTaskId, setConceptTaskId] = useState<string | null>(null);
  const [submittingConcept, setSubmittingConcept] = useState(false);
  const activeNodeIdRef = useRef('');
  // 概念图任务绑定提交时的节点；轮询与 attach 始终使用该节点，
  // 避免用户切换节点后轮询用新节点查询旧任务导致 404 和任务孤儿。
  const submittedNodeIdRef = useRef('');

  const { data: worksData, refetch: refetchWorks } = useNarrativeWorks();
  const works = worksData?.items ?? [];

  const activeWorkId = works.some((work) => work.id === selectedWorkId)
    ? selectedWorkId
    : works[0]?.id ?? '';

  const { data: treeData } = useNarrativeTree(activeWorkId);
  const nodes = treeData?.items ?? [];

  const firstReadableNode = nodes.find((node) => node.kind !== 'chapter') ?? nodes[0];
  const activeNodeId = nodes.some((node) => node.id === selectedNodeId)
    ? selectedNodeId
    : firstReadableNode?.id ?? '';

  const { data: readingData, isLoading: readingLoading, refetch: refetchReading } = useNarrativeReading(activeNodeId);
  useEffect(() => {
    activeNodeIdRef.current = activeNodeId;
  }, [activeNodeId]);
  const { data: searchData } = useNarrativeSearch(searchQuery, activeWorkId);
  const { data: connectorsData } = useNarrativeConnectors();
  const connectors = connectorsData?.items ?? [];

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

  return (
    <div className="flex min-h-0 w-full flex-col md:h-dvh">
      {/* 页头与工作模式：与外框统一的标题区，模式用 tab 语义而非自绘分段控件。 */}
      <div className="shrink-0 border-b border-border-subtle bg-surface">
        <PageContainer className="pt-4">
          <PageHeader
            compact
            title="叙事档案"
            description="任务链阅读、多作品追溯与原文检索。"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 pt-1">
            <PageTabs
              ariaLabel="叙事工作模式"
              value={mode}
              onChange={(id) => setMode(id as 'read' | 'import')}
              tabs={[
                { id: 'read', label: '阅读' },
                { id: 'import', label: '数据源与导入' },
              ]}
            />

            {mode === 'read' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-expanded={treeOpen}
                  onClick={() => setTreeOpen((open) => !open)}
                  className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-border-default bg-surface px-3 text-sm font-medium text-muted transition-colors hover:text-ink md:hidden"
                >
                  目录
                </button>

                <button
                  type="button"
                  aria-expanded={inspectorOpen}
                  onClick={() => setInspectorOpen((open) => !open)}
                  className={cn(
                    'inline-flex h-9 items-center rounded-[var(--radius-control)] border px-3 text-sm font-medium transition-colors',
                    inspectorOpen
                      ? 'border-accent/30 bg-accent/12 font-semibold text-accent-dark'
                      : 'border-border-default bg-surface text-muted hover:text-ink',
                  )}
                >
                  检索原文
                </button>
              </div>
            )}
          </div>
        </PageContainer>
      </div>

      {/* Main Workspace */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {mode === 'read' ? (
          <>
            {/* 宽屏常驻左栏；窄屏默认隐藏，由页头「目录」按钮单独打开。 */}
            <div className={cn('min-h-0 md:flex md:w-64 md:flex-none', treeOpen ? 'flex' : 'hidden')}>
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
            </div>

            <NarrativeReader
              reading={readingData ?? null}
              loading={readingLoading}
              onSaveUtteranceToNotebook={handleSaveToNotebook}
              onOpenImport={() => setMode('import')}
              onGenerateConcept={() => void handleGenerateConcept()}
              generatingConcept={Boolean(conceptTaskId) || submittingConcept}
            />

            {inspectorOpen && <NarrativeInspector
              query={searchQuery}
              onQueryChange={setSearchQuery}
              results={searchData?.items ?? []}
              onSelectResult={handleSelectSearchResult}
            />}
          </>
        ) : (
          <NarrativeImport
            connectors={connectors}
            onImportComplete={handleImportComplete}
          />
        )}
      </div>
    </div>
  );
}
