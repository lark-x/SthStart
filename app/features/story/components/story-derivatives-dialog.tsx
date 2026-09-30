'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  MessageSquare,
  Sparkles,
  Download,
  Copy,
  Check,
  Film,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import type { StoryScriptProject } from '@sthstart/contracts';
import { storyApi } from '../api';
import { createActivity } from '@/app/features/activities/api';

interface StoryDerivativesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
  chapterTitle: string;
  chapterBody: string;
}

export function StoryDerivativesDialog({
  open,
  onOpenChange,
  projectId,
  projectTitle,
  chapterTitle,
  chapterBody,
}: StoryDerivativesDialogProps) {
  const [tab, setTab] = useState<'script' | 'activity' | 'export'>('script');
  const [copied, setCopied] = useState(false);
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [createdActivityId, setCreatedActivityId] = useState<string | null>(null);
  const [activityError, setActivityError] = useState('');

  // 编译为剧本工程
  const scriptQuery = useQuery({
    queryKey: ['story', projectId, 'compile-script', chapterTitle, chapterBody],
    queryFn: () =>
      storyApi.compileScript(projectId, chapterBody, {
        chapterTitle,
        projectTitle,
      }),
    enabled: open && tab === 'script',
    staleTime: 30_000,
  });

  const scriptData: StoryScriptProject | undefined = scriptQuery.data;

  // 一键直通活动工作室：将小说剧情编译工程转为 SthStart 正式活动
  const handleCreateActivity = async () => {
    if (!scriptData || creatingActivity) return;
    setCreatingActivity(true);
    setActivityError('');
    try {
      const sceneLines = scriptData.lines.filter((l) => l.type === 'scene_header');
      let stageTitles = sceneLines.length > 0
        ? sceneLines.map((s) => s.content.trim() || '分幕')
        : [`${chapterTitle || '本章'} · 开局`, `${chapterTitle || '本章'} · 尾声`];
      if (stageTitles.length === 1) {
        stageTitles = [`${stageTitles[0]} · 上半幕`, `${stageTitles[0]} · 下半幕`];
      }

      const actors = scriptData.characters.map((name) => ({
        displayName: name,
        activityRole: '登场角色',
      }));

      const res = await createActivity({
        title: `${projectTitle || '小说'} · ${chapterTitle || '章节'}`,
        type: '视觉小说演出',
        theme: projectTitle || '剧情衍生',
        location: sceneLines[0]?.content.trim() || '剧情舞台',
        rules: '由纯文字小说一键编译生成，包含分幕与对白角色安排。',
        stageTitles,
        actors,
      });

      setCreatedActivityId(res.activity.id);
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : '创建活动工程失败');
    } finally {
      setCreatingActivity(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('复制失败', err);
    }
  };

  const handleDownload = (filename: string, content: string, type = 'application/json') => {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const dialoguesCount =
    scriptData?.lines.filter((l) => l.type === 'dialogue').length ?? 0;
  const narrationsCount =
    scriptData?.lines.filter((l) => l.type === 'narration').length ?? 0;

  // 生成活动群聊剧本格式
  const generateActivityChatText = () => {
    if (!scriptData) return '';
    return scriptData.lines
      .map((line) => {
        if (line.type === 'dialogue') {
          return `${line.speaker || '未知'}: ${line.emotion ? `[${line.emotion}] ` : ''}${line.content}`;
        }
        if (line.type === 'scene_header') {
          return `\n【场景：${line.content}】\n`;
        }
        return `（旁白）${line.content}`;
      })
      .join('\n');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="核心小说衍生工程与导出"
      description="基于纯文字小说正文，一键编译为下游剧本工程、多角色对白流或排版文件。"
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-xs text-muted">
            正文共 {chapterBody.length} 字 · {scriptData ? `${scriptData.lines.length} 行剧本` : ''}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 标签栏 */}
        <div className="flex border-b border-border-default pb-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab('script')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === 'script'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Film className="size-3.5" />
              剧本工程 (Script VN)
            </button>
            <button
              type="button"
              onClick={() => setTab('activity')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === 'activity'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <MessageSquare className="size-3.5" />
              活动对白流 (Chat Beats)
            </button>
            <button
              type="button"
              onClick={() => setTab('export')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === 'export'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <FileText className="size-3.5" />
              纯文本小说导出
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        {tab === 'script' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted/50 p-2.5 text-xs">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1 text-muted">
                  <Users className="size-3.5" />
                  出场角色：
                  <strong className="text-ink">
                    {scriptData?.characters.length || 0} 位
                  </strong>
                </span>
                <span className="text-muted">
                  对白：<strong className="text-ink">{dialoguesCount} 句</strong>
                </span>
                <span className="text-muted">
                  旁白：<strong className="text-ink">{narrationsCount} 段</strong>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {createdActivityId ? (
                  <Link
                    href={`/apps/activities/${createdActivityId}`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] bg-emerald-600 px-3 text-xs font-medium text-white shadow-2xs hover:bg-emerald-700"
                    target="_blank"
                  >
                    <Check className="size-3.5" />
                    已建档 · 前往活动工作室
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant="accent"
                    className="h-7 text-xs"
                    disabled={!scriptData || creatingActivity}
                    onClick={() => void handleCreateActivity()}
                    title="在 SthStart 中建立全新活动工程，无缝进入多媒体生图与演出管线"
                  >
                    <Sparkles className="size-3" />
                    {creatingActivity ? '正在建档…' : '创建为活动工程'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={!scriptData}
                  onClick={() =>
                    scriptData &&
                    void handleCopy(JSON.stringify(scriptData, null, 2))
                  }
                >
                  {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                  {copied ? '已复制' : '复制 JSON'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={!scriptData}
                  onClick={() =>
                    scriptData &&
                    handleDownload(
                      `${chapterTitle || 'script'}.script.json`,
                      JSON.stringify(scriptData, null, 2)
                    )
                  }
                >
                  <Download className="size-3" />
                  下载剧本工程
                </Button>
              </div>
            </div>
            {activityError && (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
                {activityError}
              </div>
            )}

            {/* 剧本预览 */}
            <div className="max-h-[46vh] min-h-[16rem] overflow-y-auto rounded-[var(--radius-control)] border border-border-default bg-surface p-3 font-mono text-xs" data-autohide-scroll>
              {scriptQuery.isLoading ? (
                <div className="flex h-36 items-center justify-center text-muted">
                  正在编译剧本工程…
                </div>
              ) : !scriptData || scriptData.lines.length === 0 ? (
                <div className="flex h-36 items-center justify-center text-muted">
                  章节内容暂未解析出剧本对白
                </div>
              ) : (
                <div className="space-y-2">
                  {scriptData.lines.map((line, idx) => (
                    <div
                      key={idx}
                      className={`rounded p-2 leading-relaxed ${
                        line.type === 'dialogue'
                          ? 'border-l-2 border-accent bg-accent/5'
                          : line.type === 'scene_header'
                          ? 'bg-surface-muted font-semibold text-accent'
                          : 'bg-surface text-muted'
                      }`}
                    >
                      {line.type === 'dialogue' && (
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="font-semibold text-accent">{line.speaker}</span>
                          {line.emotion && (
                            <span className="rounded bg-surface-muted px-1.5 py-0.2 text-[10px] text-muted">
                              {line.emotion}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap text-ink">{line.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'activity' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>可直接用于 SthStart 活动群聊或剧情分镜导入</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => void handleCopy(generateActivityChatText())}
              >
                {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                {copied ? '已复制' : '复制对白流'}
              </Button>
            </div>
            <textarea
              readOnly
              value={generateActivityChatText()}
              className="h-[46vh] w-full rounded-[var(--radius-control)] border border-border-default bg-surface p-3 font-mono text-xs leading-relaxed text-ink outline-none"
            />
          </div>
        )}

        {tab === 'export' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>纯文本小说正文 Markdown 格式</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => void handleCopy(chapterBody)}
                >
                  {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                  {copied ? '已复制' : '复制正文'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() =>
                    handleDownload(
                      `${chapterTitle || 'chapter'}.md`,
                      chapterBody,
                      'text/markdown'
                    )
                  }
                >
                  <Download className="size-3" />
                  下载 .md 文件
                </Button>
              </div>
            </div>
            <textarea
              readOnly
              value={chapterBody}
              className="h-[46vh] w-full rounded-[var(--radius-control)] border border-border-default bg-surface p-3 font-mono text-xs leading-relaxed text-ink outline-none"
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
