'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Play,
  RotateCcw,
  CheckCircle2,
  BookOpen,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import type { NarrativeWork, ResearchScope } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { EmptyState } from '@/app/components/ui/empty-state';
import { PageContainer, WorkspaceShell } from '@/app/components/shared/page-layout';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { narrativeKeys } from '@/app/lib/query-keys';
import { useToast } from '@/app/providers/ui-provider';
import { useResearchProject, useResearchProjects, useResearchProvider, useResearchRun } from '../research-queries';
import {
  archiveResearchProject,
  cancelResearchRun,
  confirmResearchProject,
  createResearchProject,
  deleteResearchEvidence,
  previewResearchPublish,
  publishResearch,
  retryResearchRun,
  revalidateResearchClaim,
  startResearchRun,
  suggestResearchTopics,
  regenerateResearchDraft,
  updateResearchClaim,
  updateResearchDraft,
} from '../research-api';
import { ResearchTopicPicker } from './research-topic-picker';
import { ResearchReview } from './research-review';

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  researching: '研究中',
  review: '待审核',
  published: '已发布',
  archived: '已归档',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  'needs-review': '等待审核',
  succeeded: '已完成',
  incomplete: '结果不完整',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

/**
 * 研究专题工作台：
 * 拆解为两个清晰层级：
 * 1. 专题概览：专题列表 + 摘要详情 + 运行与配置
 * 2. 研究审核独立工作区：隐藏专题列表与全局导航，结论(240px) + 正文(受控主区) + 证据(360px)，独占全屏！
 */
export function ResearchWorkspace({ works }: { works: NarrativeWork[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [workId, setWorkId] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedProjectId = searchParams.get('project') ?? '';
  const isReviewing = searchParams.get('view') === 'review';
  const navigateProject = (id: string, review = false) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('mode', 'research');
    if (id) params.set('project', id); else params.delete('project');
    if (review) params.set('view', 'review'); else params.delete('view');
    router.push(`${pathname}?${params}`, { scroll: false });
  };
  const setSelectedProjectId = (id: string) => navigateProject(id);
  const setIsReviewing = (review: boolean) => navigateProject(selectedProjectId, review);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBlocked, setPublishBlocked] = useState<string[]>([]);

  const activeWorkId = workId || works[0]?.id || '';
  const { data: provider } = useResearchProvider();
  const { data: projectsData, refetch: refetchProjects } = useResearchProjects(activeWorkId || undefined);
  const projects = projectsData?.items ?? [];
  const { data: detail, refetch: refetchDetail, isPending: loadingDetail, error: detailError } = useResearchProject(selectedProjectId || undefined);

  const project = detail?.project ?? null;
  const runs = detail?.runs ?? [];
  const latestRun = runs[0] ?? null;
  const runActive = latestRun ? ['queued', 'running'].includes(latestRun.status) : false;
  const { data: runDetail } = useResearchRun(latestRun?.id, runActive);

  const claims = runDetail?.claims ?? detail?.claims ?? [];
  const acceptedCount = claims.filter((c) => c.status === 'accepted').length;

  const latestRunStatus = latestRun?.status;
  const latestRunId = latestRun?.id;
  useEffect(() => {
    if (!runActive && latestRunStatus && ['needs-review', 'incomplete', 'failed', 'cancelled', 'interrupted'].includes(latestRunStatus)) {
      void refetchDetail();
    }
  }, [runActive, latestRunId, latestRunStatus, refetchDetail]);

  const refresh = async () => {
    await Promise.all([refetchProjects(), refetchDetail()]);
    await queryClient.invalidateQueries({ queryKey: narrativeKeys.all });
  };

  const guard = async (operation: () => Promise<void>, successMessage?: string) => {
    setBusy(true);
    try {
      await operation();
      if (successMessage) toast.success(successMessage);
    } catch (error) {
      toast.error('操作失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const emptyCorpus = provider?.status === 'empty';

  // ------------------------------------------------------------------
  // 模式 2：研究审核独立专注工作区 (全屏展开，彻底消除多层嵌套挤压)
  // ------------------------------------------------------------------
  if (isReviewing && !project) {
    return <WorkspaceShell>
      <WorkspaceHeader title="研究审核" backHref="/apps/narrative?mode=research" backLabel="专题概览" />
      <div className="p-4">
        {loadingDetail && selectedProjectId ? <p className="text-sm text-muted">正在读取研究结果…</p> : <Alert variant="danger" title="无法打开研究审核">{detailError instanceof Error ? detailError.message : '请选择一个研究专题。'}</Alert>}
      </div>
    </WorkspaceShell>;
  }
  if (isReviewing && project) {
    return (
      <WorkspaceShell className="fixed inset-0 z-30 bg-paper flex flex-col">
        <WorkspaceHeader
          title={`${project.title} · 研究审核`}
          backLabel="专题概览"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void guard(async () => {
                  const preview = await previewResearchPublish(project.id);
                  setPublishBlocked(preview.blocked);
                  setPublishOpen(true);
                })}
              >
                <span>检查条件</span>
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => void guard(async () => {
                  const result = await publishResearch(project.id, { revision: project.revision });
                  toast.success(result.created ? '已写入资料库' : '这篇资料已存在', result.href);
                  await refresh();
                })}
              >
                <span>确认并写入资料库</span>
              </Button>
              <button
                type="button"
                onClick={() => setIsReviewing(false)}
                className="inline-flex h-11 sm:h-9 items-center px-3 rounded-md text-xs font-semibold text-muted hover:text-ink hover:bg-surface-muted/60 transition-colors border border-border-default"
              >
                退出审核
              </button>
            </div>
          }
          status={
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-muted border border-border-subtle">
              <span>已接受</span>
              <strong className="text-accent">{acceptedCount}</strong>
              <span className="opacity-60">/ {claims.length}</span>
            </span>
          }
        />

        {publishOpen && publishBlocked.length > 0 && (
          <div className="px-4 py-2 bg-warning-bg/40 border-b border-warning-border">
            <Alert variant="warning" className="text-xs py-1">
              还不能发布：{publishBlocked.join('；')}
            </Alert>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          <ResearchReview
            claims={claims}
            draft={detail?.latestDraft ?? null}
            regenerating={runActive}
            isStandaloneWorkspace={true}
            onUpdateClaim={async (id, patch) => {
              await updateResearchClaim(id, patch as never);
              await refresh();
            }}
            onRevalidate={async (id) => {
              const result = await revalidateResearchClaim(id);
              const invalid = result.evidence.filter((item) => !item.valid).length;
              toast.info('证据已重新校验', invalid ? `有 ${invalid} 条证据已失效。` : '全部证据仍然有效。');
              await refresh();
            }}
            onDeleteEvidence={async (id) => {
              await deleteResearchEvidence(id);
              await refresh();
            }}
            onSaveDraft={async (patch) => {
              const draftId = detail?.latestDraft?.id;
              if (!draftId) return;
              await updateResearchDraft(draftId, patch);
              await refresh();
            }}
            onRegenerate={async () => {
              const result = await regenerateResearchDraft(project.id);
              if (!result.ok) {
                toast.error('重新生成总稿失败', result.reason ?? '');
                return;
              }
              toast.success('已生成新的总稿版本');
              await refresh();
            }}
          />
        </div>
      </WorkspaceShell>
    );
  }

  // ------------------------------------------------------------------
  // 模式 1：专题概览视图 (保留自然列表与主从浏览)
  // ------------------------------------------------------------------
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageContainer className="space-y-4 py-4">
        {emptyCorpus && (
          <Alert variant="warning">
            本地还没有叙事原文，可以创建研究专题，但无法开始研究运行。请先在「数据源与导入」导入规范化 JSON 。
          </Alert>
        )}

        {!works.length && (
          <EmptyState
            title="还没有可研究的作品"
            description="研究专题需要一个本地作品作为语料。先导入规范化 JSON，再回到这里。"
          />
        )}

        {works.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            {/* 左栏：专题列表 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">研究专题</h2>
                <Button size="sm" onClick={() => { setCreating(true); setSelectedProjectId(''); }}>
                  新建专题
                </Button>
              </div>
              <div className="space-y-2">
                {projects.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setSelectedProjectId(item.id); setCreating(false); }}
                    className={`w-full rounded-[var(--radius-panel)] border p-3 text-left transition-colors cursor-pointer ${
                      selectedProjectId === item.id
                        ? 'border-accent/50 bg-accent/8 shadow-2xs'
                        : 'border-border-default bg-surface hover:border-accent/30'
                    }`}
                  >
                    <span className="block text-sm font-semibold leading-snug text-ink">{item.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge>{STATUS_LABELS[item.status] ?? item.status}</Badge>
                      {item.origin === 'ai-suggested' && <Badge>AI 选题</Badge>}
                    </span>
                  </button>
                ))}
                {!projects.length && <p className="text-xs text-muted">还没有研究专题，点「新建」开始。</p>}
              </div>
            </div>

            {/* 右栏：当前专题概览详情 */}
            <div className="min-w-0 space-y-4">
              {creating && (
                <ResearchTopicPicker
                  works={works}
                  activeWorkId={activeWorkId}
                  onWorkChange={setWorkId}
                  onCreated={(projectId) => { setCreating(false); setSelectedProjectId(projectId); void refresh(); }}
                  suggest={suggestResearchTopics}
                  createProject={createResearchProject}
                />
              )}

              {!creating && project && (
                <>
                  <Card>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold text-ink">{project.title}</h2>
                            <Badge>{STATUS_LABELS[project.status] ?? project.status}</Badge>
                            <span className="text-xs text-muted">v{project.revision}</span>
                          </div>
                          {project.question && <p className="mt-1 text-sm text-muted">{project.question}</p>}
                        </div>
                        <div className="flex flex-none flex-wrap gap-2">
                          {project.status === 'draft' && (
                            <Button size="sm" variant="primary" disabled={busy} onClick={() => void guard(async () => {
                              await confirmResearchProject(project.id, { revision: project.revision });
                              await refresh();
                            }, '主题已确认')}>
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>确认主题</span>
                            </Button>
                          )}
                          {project.status !== 'draft' && project.status !== 'archived' && (
                            <Button size="sm" variant="primary" disabled={busy || runActive || emptyCorpus} onClick={() => void guard(async () => {
                              await startResearchRun(project.id);
                              await refresh();
                            }, '研究运行已开始')}>
                              {runActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                              <span>{runs.length ? '再研究一次' : '开始研究'}</span>
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void guard(async () => {
                            await archiveResearchProject(project.id);
                            await refresh();
                          }, '专题已归档')}>
                            <span>归档</span>
                          </Button>
                        </div>
                      </div>
                      {project.status === 'draft' && (
                        <p className="text-xs text-muted">确认后才会开始检索。研究期间修改主题会让旧运行标记为基于旧主题。</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* 核心入口：进入研究审核专注工作区 */}
                  {claims.length > 0 && (
                    <div className="p-4 rounded-xl border border-accent/30 bg-accent/5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Sparkles className="size-4 text-accent" />
                          <h3 className="text-sm font-bold text-ink">研究成果已生成，待人工核验</h3>
                        </div>
                        <p className="text-xs text-muted">
                          共生成 {claims.length} 条论点与证据（已接受 {acceptedCount} 条）。进入审核工作区，核验证据并修订总稿。
                        </p>
                      </div>
                      <Button
                        variant="primary"
                        onClick={() => setIsReviewing(true)}
                        className="gap-2 font-semibold shadow-xs"
                      >
                        <span>进入研究审核工作区</span>
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  )}

                  {/* 运行进度卡片 */}
                  {latestRun && (
                    <Card>
                      <CardContent className="space-y-2 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge>{RUN_STATUS_LABELS[latestRun.status] ?? latestRun.status}</Badge>
                            <span className="text-xs text-muted">阶段：{latestRun.stage}</span>
                            {latestRun.usedModelCalls > 0 && <span className="text-xs text-muted">模型调用 {latestRun.usedModelCalls} 次</span>}
                          </div>
                          <div className="flex flex-none gap-2">
                            {runActive && (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => void guard(async () => {
                                await cancelResearchRun(latestRun.id);
                                await refresh();
                              }, '运行已取消')}>
                                <span>取消运行</span>
                              </Button>
                            )}
                            {!runActive && ['failed', 'interrupted', 'incomplete'].includes(latestRun.status) && (
                              <Button size="sm" variant="outline" disabled={busy || emptyCorpus} onClick={() => void guard(async () => {
                                await retryResearchRun(latestRun.id);
                                await refresh();
                              }, '已重新运行')}>
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>重试</span>
                              </Button>
                            )}
                          </div>
                        </div>
                        {latestRun.progressLabel && <p className="text-sm text-ink">{latestRun.progressLabel}</p>}
                        {latestRun.errorMessage && <Alert variant="danger">{latestRun.errorMessage}</Alert>}
                        {latestRun.incompleteReason && <Alert variant="warning">{latestRun.incompleteReason}</Alert>}
                      </CardContent>
                    </Card>
                  )}

                  {/* 已发布资料快捷入口 */}
                  {project.publishedNoteId && (
                    <div className="p-3 rounded-lg border border-border-default bg-surface flex items-center justify-between">
                      <span className="text-xs text-muted">本专题已完成审核并写入创作资料库</span>
                      <a
                        href={`/apps/notebook/${project.publishedNoteId}`}
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline font-semibold"
                      >
                        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>打开已发布的资料</span>
                      </a>
                    </div>
                  )}
                </>
              )}

              {!creating && !project && (
                <EmptyState
                  title="选择一个研究专题"
                  description="或点左上「新建专题」，让 AI 从本地语料中发现值得研究的主题。"
                  actions={<Button onClick={() => setCreating(true)}>新建研究专题</Button>}
                />
              )}
            </div>
          </div>
        )}
      </PageContainer>
    </div>
  );
}

export type { ResearchScope };
