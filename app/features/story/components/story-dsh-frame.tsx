'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Play, Square, RotateCw, ExternalLink, Minimize2, Maximize2, Sparkles, Terminal,
  AlertCircle, Copy, Check, FileText, ChevronRight,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { storyApi } from '../api';

interface StoryDshFrameProps {
  projectId: string;
  projectTitle?: string;
  activeEntryTitle?: string;
  activeEntryContent?: string;
  onCollapse?: () => void;
  onSetWidth?: (width: number) => void;
  currentWidth?: number;
}

export function StoryDshFrame({
  projectId,
  projectTitle,
  activeEntryTitle,
  activeEntryContent,
  onCollapse,
  onSetWidth,
  currentWidth,
}: StoryDshFrameProps) {
  const queryClient = useQueryClient();
  const [iframeKey, setIframeKey] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [contextCopied, setContextCopied] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['story', projectId, 'dsh-status'],
    queryFn: () => storyApi.dshStatus(projectId),
    refetchInterval: (query) => (query.state.data?.running ? 4000 : 15000),
  });

  const isRunning = Boolean(statusQuery.data?.running);
  const dshUrl = statusQuery.data?.url || (statusQuery.data?.port ? `http://127.0.0.1:${statusQuery.data.port}` : 'http://127.0.0.1:3081');

  // 一键抽取当前小说章节设定与正文为 DSH 提问上下文
  const handleCopyStoryContext = useCallback(async () => {
    if (!activeEntryTitle && !activeEntryContent) return;
    const prompt = `【当前剧情上下文】
项目作品：${projectTitle || '未命名故事'}
当前条目：${activeEntryTitle || '未命名章节'}
---
正文草稿内容：
${activeEntryContent || '（暂无正文）'}
---
请基于以上剧情设定与小说正文，继续推进情节、分析角色互动或提供具体润色建议：`;

    try {
      await navigator.clipboard.writeText(prompt);
      setContextCopied(true);
      setTimeout(() => setContextCopied(false), 2200);
    } catch (e) {
      console.error('复制上下文失败', e);
    }
  }, [projectTitle, activeEntryTitle, activeEntryContent]);

  const startMutation = useMutation({
    mutationFn: () => storyApi.startDsh(projectId),
    onSuccess: (data) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['story', projectId, 'dsh-status'] });
      void queryClient.invalidateQueries({ queryKey: ['story', projectId, 'bridge-status'] });
      setIframeKey((prev) => prev + 1);
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : '启动 DSH 终端失败');
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => storyApi.stopDsh(projectId),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['story', projectId, 'dsh-status'] });
      void queryClient.invalidateQueries({ queryKey: ['story', projectId, 'bridge-status'] });
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : '停止 DSH 终端失败');
    },
  });

  const handleRefresh = useCallback(() => {
    setIframeKey((prev) => prev + 1);
    void statusQuery.refetch();
  }, [statusQuery]);

  const handleOpenExternal = useCallback(() => {
    if (dshUrl) {
      window.open(dshUrl, '_blank', 'noopener,noreferrer');
    }
  }, [dshUrl]);

  return (
    <div
      className={
        isMaximized
          ? 'fixed inset-0 z-50 flex flex-col bg-surface shadow-2xl animate-in fade-in'
          : 'flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface'
      }
    >
      {/* 终端控制顶栏 */}
      <div className="flex h-11 shrink-0 flex-wrap items-center justify-between border-b border-border-default bg-surface-muted/60 px-3 text-xs">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-accent" />
          <span className="font-semibold text-ink">DSH 创作终端</span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
              isRunning ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-surface text-muted'
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-muted/50'
              }`}
            />
            {isRunning ? '已连接 (3081)' : '未连接'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 一键提取正文上下文为提示词 */}
          {isRunning && (activeEntryTitle || activeEntryContent) && (
            <Button
              size="sm"
              variant="outline"
              className={`h-7 gap-1 px-2 text-xs transition-colors ${
                contextCopied ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'text-muted hover:text-accent'
              }`}
              title="一键提取当前小说章节正文与设定，格式化复制为 DSH 提示词"
              onClick={() => void handleCopyStoryContext()}
            >
              {contextCopied ? <Check className="size-3 text-emerald-600" /> : <FileText className="size-3" />}
              <span className="hidden xl:inline">{contextCopied ? '已复制上下文' : '注入本章上下文'}</span>
            </Button>
          )}

          {/* 快捷分屏宽度预设 */}
          {onSetWidth && !isMaximized && (
            <div className="hidden sm:flex items-center rounded border border-border-default/80 bg-surface p-0.5 text-[10px]">
              {[
                { label: '窄', width: 380, title: '窄栏辅助 (380px)' },
                { label: '半', width: typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.5) : 640, title: '半屏对等创作 (50%)' },
                { label: '宽', width: 680, title: 'AI 深度探讨 (680px)' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  title={preset.title}
                  onClick={() => onSetWidth(preset.width)}
                  className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-hover hover:text-ink transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {isRunning ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-muted hover:text-ink"
                title="刷新终端界面"
                onClick={handleRefresh}
              >
                <RotateCw className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-muted hover:text-ink"
                title="在新标签页中打开"
                onClick={handleOpenExternal}
              >
                <ExternalLink className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                title="停止 DSH 后台服务"
                disabled={stopMutation.isPending}
                onClick={() => stopMutation.mutate()}
              >
                <Square className="size-3.5" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2.5 text-xs text-accent hover:bg-accent/10"
              disabled={startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              <Play className="size-3" />
              {startMutation.isPending ? '启动中…' : '启动'}
            </Button>
          )}

          {/* 全屏放大 / 还原 */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted hover:text-ink"
            title={isMaximized ? '退出全屏沉浸' : '全屏展开 DSH 终端'}
            onClick={() => setIsMaximized((prev) => !prev)}
          >
            {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>

          {onCollapse && !isMaximized && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-muted hover:text-ink"
              title="收起右栏"
              onClick={onCollapse}
            >
              <Minimize2 className="size-3.5 rotate-90" />
            </Button>
          )}
        </div>
      </div>

      {/* 终端主体区 */}
      <div className="relative min-h-0 flex-1 bg-surface">
        {isRunning ? (
          <iframe
            key={iframeKey}
            src={dshUrl}
            title="DeepSeek Harness Native Web Terminal"
            className="h-full w-full border-0 bg-surface"
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col items-center justify-center p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Sparkles className="size-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">原生 DSH 创作终端已就绪</h3>
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
              原生 DeepSeek Harness 提供思考链展现、模型参数微调与草稿自动提案。一键启动后直接在此侧栏呈现，无需切换网页。
            </p>

            {errorMsg && (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <Button
              size="sm"
              className="mt-5 gap-2"
              disabled={startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              <Play className="size-3.5" />
              {startMutation.isPending ? '正在拉起 DSH 守护进程…' : '一键启动 DSH 终端'}
            </Button>

            <div className="mt-6 border-t border-border-default/60 pt-4 text-[11px] text-muted">
              <span>端口：3081 · 协议：跨平台守护代理 · 权限已对 SthStart 放行</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
