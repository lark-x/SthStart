'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, RotateCcw, Sparkles } from 'lucide-react';
import type { CreativeBudget, CreativeScope } from '@sthstart/contracts';
import { useStoryWorlds, useStoryWorldOverview } from '@/app/features/story-worlds/queries';
import { useStoryProjects } from '@/app/features/story/queries';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { Drawer } from '@/app/components/ui/drawer';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { creativeApi } from './api';
import { creativeKeys, useCreativeRun } from './queries';
import { AssistantArtifact } from './assistant-artifact';
import { runStatus } from './run-detail';

const SESSION_KEY = 'sthstart_global_ai_conversation';
const emptyScope: CreativeScope = { workName: null, worldId: null, branchId: null, projectId: null };
const drawerBudget: CreativeBudget = {
  maxTextCalls: 12,
  maxImages: 0,
  maxTokens: 500_000,
  maxRevisions: 0,
};

function inferRouteScope(pathname: string, searchParams: URLSearchParams): {
  worldId: string | null;
  branchId: string | null;
  projectId: string | null;
} {
  const worldMatch = /^\/apps\/story-worlds\/([A-Za-z0-9_-]+)/.exec(pathname);
  const projectMatch = /^\/apps\/projects\/([A-Za-z0-9_-]+)/.exec(pathname);
  return {
    worldId: worldMatch?.[1] ?? searchParams.get('world') ?? searchParams.get('worldId') ?? null,
    branchId: searchParams.get('branchId') ?? searchParams.get('branch') ?? null,
    projectId: projectMatch?.[1] ?? searchParams.get('projectId') ?? null,
  };
}

export function GlobalAiDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const client = useQueryClient();
  const inferred = useMemo(() => inferRouteScope(pathname, searchParams), [pathname, searchParams]);
  const worlds = useStoryWorlds();
  const projects = useStoryProjects();
  const [manualScope, setManualScope] = useState<CreativeScope | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try {
      return typeof window !== 'undefined' ? window.sessionStorage.getItem(SESSION_KEY) : null;
    } catch {
      return null;
    }
  });
  const [runId, setRunId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<{ signature: string; key: string } | null>(null);

  const routeWorld = worlds.data?.items.find((item) => item.id === inferred.worldId);
  const routeProject = projects.data?.items.find((item) => item.id === inferred.projectId);
  const overview = useStoryWorldOverview((manualScope?.worldId ?? routeWorld?.id) || undefined);

  const activeScope: CreativeScope = useMemo(() => {
    if (manualScope) return manualScope;
    if (routeWorld) {
      return {
        workName: routeWorld.title,
        worldId: routeWorld.id,
        branchId: inferred.branchId ?? overview.data?.branches[0]?.id ?? null,
        projectId: null,
      };
    }
    if (routeProject) {
      return {
        workName: routeProject.workId ?? routeProject.title,
        worldId: null,
        branchId: null,
        projectId: routeProject.id,
      };
    }
    return emptyScope;
  }, [manualScope, routeWorld, routeProject, inferred.branchId, overview.data?.branches]);

  const conversation = useQuery({
    queryKey: creativeKeys.conversation(conversationId ?? ''),
    queryFn: () => creativeApi.conversation(conversationId!),
    enabled: open && Boolean(conversationId),
    refetchInterval: open && conversationId ? 4000 : false,
  });

  const activeRun = useCreativeRun(open ? runId : null);

  useEffect(() => {
    if (!open || !activeRun.data) return;
    if (activeRun.data.run.status === 'completed' && conversationId) {
      void client.invalidateQueries({ queryKey: creativeKeys.conversation(conversationId) });
    }
  }, [open, activeRun.data?.run.status, conversationId, client]);

  const saveSessionConversation = (id: string | null) => {
    setConversationId(id);
    try {
      if (id) window.sessionStorage.setItem(SESSION_KEY, id);
      else window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore restricted storage contexts.
    }
  };

  const resetConversation = () => {
    saveSessionConversation(null);
    setRunId(null);
    setError('');
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !message.trim()) return;
    const submitted = message.trim();
    const targetScope = conversation.data?.scope ?? activeScope;
    const signature = JSON.stringify({ conversationId, targetScope, submitted });
    if (requestRef.current?.signature !== signature) {
      requestRef.current = { signature, key: `drawer_${crypto.randomUUID().replaceAll('-', '')}` };
    }
    setSending(true);
    setError('');
    try {
      const res = await creativeApi.message({
        ...(conversationId ? { conversationId } : {}),
        scope: targetScope,
        message: submitted,
        mode: 'ai',
        budget: drawerBudget,
        idempotencyKey: requestRef.current.key,
      });
      requestRef.current = null;
      saveSessionConversation(res.conversationId);
      setMessage('');
      if (res.runId) setRunId(res.runId);
      await client.invalidateQueries({ queryKey: creativeKeys.conversation(res.conversationId) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发送失败，请重试');
    } finally {
      setSending(false);
    }
  };

  const studioHref = useMemo(() => {
    const params = new URLSearchParams();
    const s = conversation.data?.scope ?? activeScope;
    if (conversationId) params.set('conversation', conversationId);
    if (runId) params.set('run', runId);
    if (s.workName) params.set('workName', s.workName);
    if (s.worldId) params.set('worldId', s.worldId);
    if (s.branchId) params.set('branchId', s.branchId);
    if (s.projectId) params.set('projectId', s.projectId);
    const qs = params.toString();
    return qs ? `/apps/ai-studio?${qs}` : '/apps/ai-studio';
  }, [conversationId, runId, conversation.data?.scope, activeScope]);

  const pendingApproval = activeRun.data?.approvals.find((a) => a.status === 'pending');
  const assistantPlan = activeRun.data?.artifacts.find(
    (a) => a.kind === 'plan' && a.content.kind === 'assistant-proposal',
  );
  const resultProposal = activeRun.data?.artifacts.find(
    (a) => a.kind === 'result' && a.content.executionStatus === 'awaiting_budget_confirmation',
  );

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="AI 创作助手"
      description="随时与创作总管商议剧情、梳理设定或发起工作流，支持跨页面延续对话。"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={resetConversation} disabled={!conversationId || sending}>
            <RotateCcw size={14} aria-hidden="true" />
            新对话
          </Button>
          <Link
            href={studioHref}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            在 AI 工作台展开
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="space-y-2 rounded-control bg-surface-sunken p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <Sparkles size={13} aria-hidden="true" />
              当前上下文范围
            </span>
            <div className="flex items-center gap-2">
              {activeScope.worldId && (
                <Link
                  href={`/apps/story-worlds?world=${encodeURIComponent(activeScope.worldId)}&view=chapters`}
                  onClick={onClose}
                  className="font-medium text-accent hover:underline"
                >
                  打开章节写作助手
                </Link>
              )}
              {(routeWorld || routeProject) && !manualScope && <Badge variant="secondary">自动识别</Badge>}
            </div>
          </div>
          <Select
            aria-label="全局助手范围"
            disabled={sending || Boolean(conversationId)}
            value={
              activeScope.worldId
                ? `world:${activeScope.worldId}`
                : activeScope.projectId
                  ? `project:${activeScope.projectId}`
                  : ''
            }
            onChange={(event) => {
              const [kind, id] = event.target.value.split(':');
              const w = kind === 'world' ? worlds.data?.items.find((item) => item.id === id) : undefined;
              const p = kind === 'project' ? projects.data?.items.find((item) => item.id === id) : undefined;
              setManualScope({
                workName: w?.title ?? p?.workId ?? p?.title ?? null,
                worldId: w?.id ?? null,
                branchId: null,
                projectId: p?.id ?? null,
              });
            }}
          >
            <option value="">全站讨论（可创建新作品或流程）</option>
            <optgroup label="作品">
              {worlds.data?.items.map((world) => (
                <option key={world.id} value={`world:${world.id}`}>
                  {world.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="写作项目">
              {projects.data?.items.map((project) => (
                <option key={project.id} value={`project:${project.id}`}>
                  {project.title}
                </option>
              ))}
            </optgroup>
          </Select>
          {activeScope.worldId && overview.data?.branches && (
            <Select
              aria-label="全局助手分支"
              disabled={sending || Boolean(conversationId)}
              value={activeScope.branchId ?? ''}
              onChange={(event) =>
                setManualScope({ ...activeScope, branchId: event.target.value || null })
              }
            >
              <option value="">选择时间线</option>
              {overview.data.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.title}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="space-y-4">
          {!conversationId && (
            <p className="text-sm leading-relaxed text-muted">
              输入你的问题或创作目标。普通咨询直接回复；需要创建作品、修改流程或发起创作时生成待确认提案。
            </p>
          )}
          {conversation.data?.messages.map((item) => (
            <article
              key={item.id}
              className={`space-y-1 text-sm ${item.role === 'user' ? 'rounded-panel bg-surface-sunken p-3' : ''}`}
            >
              <div className="text-xs font-semibold text-muted">{item.role === 'user' ? '你' : '创作总管'}</div>
              <p className="whitespace-pre-wrap break-words leading-relaxed">{item.content}</p>
            </article>
          ))}
        </div>

        {activeRun.data && (
          <Card variant="sunken" className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">总管执行状态</span>
              <Badge variant={activeRun.data.run.status === 'waiting_approval' ? 'warning' : 'secondary'}>
                {runStatus[activeRun.data.run.status]}
              </Badge>
            </div>
            {assistantPlan && pendingApproval && (
              <>
                <AssistantArtifact content={assistantPlan.content} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      await creativeApi.decide(pendingApproval.id, {
                        expectedRevision: pendingApproval.revision,
                        bundleHash: pendingApproval.bundleHash,
                        decision: 'approve',
                        comment: '通过全站 AI 助手确认执行',
                      });
                      await client.invalidateQueries({ queryKey: creativeKeys.run(activeRun.data!.run.id) });
                    }}
                  >
                    确认执行此操作
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await creativeApi.decide(pendingApproval.id, {
                        expectedRevision: pendingApproval.revision,
                        bundleHash: pendingApproval.bundleHash,
                        decision: 'reject',
                        comment: '在全站 AI 助手取消',
                      });
                      await client.invalidateQueries({ queryKey: creativeKeys.run(activeRun.data!.run.id) });
                    }}
                  >
                    取消
                  </Button>
                </div>
              </>
            )}
            {resultProposal && (
              <Link
                href={studioHref}
                onClick={onClose}
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                方案已就绪，点击前往工作台启动任务
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            )}
          </Card>
        )}

        {error && <Alert variant="danger">{error}</Alert>}

        <form onSubmit={(event) => void send(event)} className="space-y-2">
          <Textarea
            rows={3}
            required
            maxLength={20000}
            disabled={sending}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="提问、梳理剧情或描述想要调整的内容…"
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">Ctrl / ⌘ + Enter 发送</span>
            <Button size="sm" type="submit" variant="primary" loading={sending}>
              发送给总管
            </Button>
          </div>
        </form>
      </div>
    </Drawer>
  );
}
