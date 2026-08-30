'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
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
import { useToast } from '@/app/providers/ui-provider';
import { EyeCareToggle } from '@/app/components/shared/eye-care-toggle';

export function NarrativeWorkspace() {
  const toast = useToast();
  const [mode, setMode] = useState<'read' | 'import'>('read');
  const [selectedWorkId, setSelectedWorkId] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [conceptTaskId, setConceptTaskId] = useState<string | null>(null);

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

  const { data: readingData, refetch: refetchReading } = useNarrativeReading(activeNodeId);
  const { data: searchData } = useNarrativeSearch(searchQuery, activeWorkId);
  const { data: connectorsData } = useNarrativeConnectors();
  const connectors = connectorsData?.items ?? [];

  const handleGenerateConcept = async () => {
    if (!activeNodeId) return;
    try {
      const task = await generateNarrativeConcept(activeNodeId);
      setConceptTaskId(task.id);
      toast.success('概念图生成任务已提交');
    } catch (error) {
      toast.error('提交概念图生成失败', error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!conceptTaskId || !activeNodeId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const task = await fetchNarrativeGenerationTask(activeNodeId, conceptTaskId);
        if (stopped) return;
        if (task.status === 'succeeded') {
          await attachNarrativeConcept(activeNodeId, conceptTaskId);
          if (!stopped) {
            setConceptTaskId(null);
            await refetchReading();
            toast.success('概念图已附加到当前剧情节点');
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
  }, [activeNodeId, conceptTaskId, refetchReading, toast]);

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
    await refetchWorks();
  };

  return (
    <main className="min-h-screen w-full bg-[#ece8df] text-[#202631] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-6 py-3 bg-[#f5f1e8] border-b border-[rgb(32_38_49/15%)]">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-serif text-lg font-medium text-[#202631]"
          >
            <span className="h-8 w-8 rounded-full bg-[#283548] text-[#f6ebd2] font-serif flex items-center justify-center text-sm">
              叙
            </span>
            <h1 className="text-lg font-medium">叙事档案</h1>
          </Link>
        </div>

        <div className="flex items-center gap-1 bg-[rgb(32_38_49/6%)] p-1 rounded-full">
          <EyeCareToggle />
          <button
            type="button"
            onClick={() => setMode('read')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
              mode === 'read'
                ? 'bg-[#283548] text-white'
                : 'text-[#6a7078] hover:text-[#202631]'
            }`}
          >
            阅读模式
          </button>
          <button
            type="button"
            onClick={() => setMode('import')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
              mode === 'import'
                ? 'bg-[#283548] text-white'
                : 'text-[#6a7078] hover:text-[#202631]'
            }`}
          >
            数据源与导入
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {mode === 'read' ? (
          <>
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
              }}
              onOpenImport={() => setMode('import')}
            />

            <NarrativeReader
              reading={readingData ?? null}
              onSaveUtteranceToNotebook={handleSaveToNotebook}
              onOpenImport={() => setMode('import')}
              onGenerateConcept={() => void handleGenerateConcept()}
              generatingConcept={Boolean(conceptTaskId)}
            />

            <NarrativeInspector
              query={searchQuery}
              onQueryChange={setSearchQuery}
              results={searchData?.items ?? []}
              onSelectResult={handleSelectSearchResult}
            />
          </>
        ) : (
          <NarrativeImport
            connectors={connectors}
            onImportComplete={handleImportComplete}
          />
        )}
      </div>
    </main>
  );
}
