'use client';

import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Ban, RotateCcw, CheckCircle2, BookOpen, AlertTriangle } from 'lucide-react';
import type { NarrativeWork, ResearchScope } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { EmptyState } from '@/app/components/ui/empty-state';
import { PageContainer } from '@/app/components/shared/page-layout';
import { narrativeKeys } from '@/app/lib/query-keys';
import { useToast } from '@/app/providers/ui-provider';
import { useResearchProject, useResearchProjects, useResearchProvider, useResearchRun } from '../research-queries';
import {
  archiveResearchProject, cancelResearchRun, confirmResearchProject, createResearchProject,
  deleteResearchEvidence, previewResearchPublish, publishResearch, revalidateResearchClaim,
  retryResearchRun, startResearchRun, suggestResearchTopics,
  regenerateResearchDraft, updateResearchClaim, updateResearchDraft,
} from '../research-api';
import { ResearchTopicPicker } from './research-topic-picker';
import { ResearchReview } from './research-review';

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿', confirmed: '已确认', researching: '研究中', review: '待审核', published: '已发布', archived: '已归档',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '运行中', 'needs-review': '等待审核', succeeded: '已完成',
  incomplete: '结果不完整', failed: '失败', cancelled: '已取消', interrupted: '已中断',
};

/**
 * 研究专题工作台：专题列表 → 第一次确认 → 运行进度 → 结论审核 → 发布。
 * 两次人工确认不可绕过，AI 不能自行发布。
 */
export function ResearchWorkspace({ works }: { works: NarrativeWork[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [workId, setWorkId] = useState('');
  /*
   * 支持从创作资料库跳回：资料属性里的「来自研究专题」链接带 ?project=。
   * 用惰性初始值读取，避免用 effect 补状态而多渲染一次。
   */
  const [selectedProjectId, setSelectedProjectId] = useState(() => (
    typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('project') ?? ''
  ));
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishBlocked, setPublishBlocked] = useState<string[]>([]);

  const activeWorkId = workId || works[0]?.id || '';
  const { data: provider } = useResearchProvider();
  const { data: projectsData, refetch: refetchProjects } = useResearchProjects(activeWorkId || undefined);
  const projects = projectsData?.items ?? [];
  const { data: detail, refetch: refetchDetail } = useResearchProject(selectedProjectId || undefined);

  const project = detail?.project ?? null;
  const runs = detail?.runs ?? [];
  const latestRun = runs[0] ?? null;
  const runActive = latestRun ? ['queued', 'running'].includes(latestRun.status) : false;
  const { data: runDetail } = useResearchRun(latestRun?.id, runActive);

  // 运行结束后刷新专题详情，结论与总稿随之出现。
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
    } finally { setBusy(false); }
  };

  const emptyCorpus = provider?.status === 'empty';


  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageContainer className="space-y-4 py-4">
        {emptyCorpus && (
          <Alert variant="warning">
            本地还没有叙事原文，可以创建研究专题，但无法开始研究运行。请先在「数据源与导入」导入规范化 JSON。
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
                <Button size="sm" onClick={() => { setCreating(true); setSelectedProjectId(''); }}>新建</Button>
              </div>
              <div className="space-y-2">
                {projects.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setSelectedProjectId(item.id); setCreating(false); }}
                    className={`w-full rounded-[var(--radius-panel)] border p-3 text-left transition-colors ${selectedProjectId === item.id ? 'border-accent/50 bg-accent/8' : 'border-border-default bg-surface hover:border-accent/30'}`}
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

            {/* 右栏：当前专题 */}
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
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /><span>确认主题</span>
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
                          }, '专题已归档')}><span>归档</span></Button>
                        </div>
                      </div>
                      {project.status === 'draft' && (
                        <p className="text-xs text-muted">确认后才会开始检索。研究期间修改主题会让旧运行标记为基于旧主题。</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* 运行进度 */}
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
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void guard(async () => {
                                await cancelResearchRun(latestRun.id);
                                await refresh();
                              }, '运行已取消')}>
                                <Ban className="h-3.5 w-3.5" aria-hidden="true" /><span>取消</span>
                              </Button>
                            )}
                            {!runActive && ['failed', 'incomplete', 'cancelled', 'interrupted'].includes(latestRun.status) && (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => void guard(async () => {
                                await retryResearchRun(latestRun.id);
                                await refresh();
                              }, '已重新运行')}>
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /><span>重试</span>
                              </Button>
                            )}
                          </div>
                        </div>
                        {latestRun.progressLabel && <p className="text-sm text-ink">{latestRun.progressLabel}</p>}
                        {latestRun.errorMessage && <Alert variant="danger">{latestRun.errorMessage}</Alert>}
                        {latestRun.incompleteReason && <Alert variant="warning">{latestRun.incompleteReason}</Alert>}

                        {latestRun.queryPlan.length > 0 && (
                          <details className="text-xs text-muted">
                            <summary className="cursor-pointer">检索计划（{latestRun.queryPlan.length} 个问题）</summary>
                            <ul className="mt-2 space-y-1">
                              {latestRun.queryPlan.map((item, index) => (
                                <li key={index} className="leading-relaxed">
                                  · {String((item as Record<string, unknown>).question ?? '')}
                                  <span className="text-muted">（{(Array.isArray((item as Record<string, unknown>).keywords) ? ((item as Record<string, unknown>).keywords as unknown[]).map(String) : []).join('、')}）</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}

                        {/* 校验失败的结论与读取失败要如实展示，而不是静默丢弃。 */}
                        {Array.isArray((latestRun.synthesis as Record<string, unknown>).rejectedClaims) && ((latestRun.synthesis as Record<string, unknown>).rejectedClaims as unknown[]).length > 0 && (
                          <details className="text-xs text-muted">
                            <summary className="flex cursor-pointer items-center gap-1">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              未通过校验的结论（{((latestRun.synthesis as Record<string, unknown>).rejectedClaims as unknown[]).length} 条）
                            </summary>
                            <ul className="mt-2 space-y-1">
                              {(((latestRun.synthesis as Record<string, unknown>).rejectedClaims) as Array<{ title: string; reason: string }>).map((item, index) => (
                                <li key={index}>· {item.title}：{item.reason}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* 结论审核 */}
                  {(runDetail?.claims.length ?? detail?.claims.length ?? 0) > 0 && (
                    <ResearchReview
                      claims={runDetail?.claims ?? detail?.claims ?? []}
                      draft={detail?.latestDraft ?? null}
                      regenerating={runActive}
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
                      onDeleteEvidence={async (id) => { await deleteResearchEvidence(id); await refresh(); }}
                      onSaveDraft={async (patch) => {
                        const draftId = detail?.latestDraft?.id;
                        if (!draftId) return;
                        await updateResearchDraft(draftId, patch);
                        await refresh();
                      }}
                      onRegenerate={async () => {
                        const result = await regenerateResearchDraft(project.id);
                        if (!result.ok) { toast.error('重新生成总稿失败', result.reason ?? ''); return; }
                        toast.success('已生成新的总稿版本');
                        await refresh();
                      }}
                    />
                  )}

                  {/* 发布 */}
                  {detail?.latestDraft && (
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-ink">写入创作资料库</h3>
                            <p className="mt-1 text-xs text-muted">发布前会检查已接受结论、证据有效性与总稿引用。</p>
                          </div>
                          <div className="flex flex-none gap-2">
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void guard(async () => {
                              const preview = await previewResearchPublish(project.id);
                              setPublishBlocked(preview.blocked);
                              setPublishOpen(true);
                            })}><span>检查发布条件</span></Button>
                            <Button size="sm" variant="primary" disabled={busy} onClick={() => void guard(async () => {
                              const result = await publishResearch(project.id, { revision: project.revision });
                              toast.success(result.created ? '已写入资料库' : '这篇资料已存在', result.href);
                              await refresh();
                            })}><span>确认并写入资料库</span></Button>
                          </div>
                        </div>
                        {publishOpen && publishBlocked.length > 0 && (
                          <Alert variant="warning">
                            还不能发布：
                            <ul className="mt-1 list-disc pl-4">
                              {publishBlocked.map((item, index) => <li key={index}>{item}</li>)}
                            </ul>
                          </Alert>
                        )}
                        {project.publishedNoteId && (
                          <a href={`/apps/notebook/${project.publishedNoteId}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />打开已发布的资料
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              {!creating && !project && (
                <EmptyState
                  title="选择一个研究专题"
                  description="或点左上「新建」，让 AI 从本地原文里发现值得研究的主题。"
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
