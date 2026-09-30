'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  X,
  ExternalLink,
  RefreshCw,
  Loader2,
  FileText,
  Trash2,
  AlertTriangle,
  PanelRightClose,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import type { NarrativeResearchClaim, NarrativeResearchEvidence, NarrativeResearchDraft } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Textarea } from '@/app/components/ui/textarea';
import { cn } from '@/app/lib/cn';
import { Drawer } from '@/app/components/ui/drawer';

const CLAIM_LABELS: Record<string, string> = {
  fact: '原作明确',
  inference: '推论',
  speculation: '猜想',
  contradiction: '矛盾',
  'open-question': '开放问题',
};

function claimTone(claimType: string | null): string {
  switch (claimType) {
    case 'fact':
      return 'bg-success-bg text-success-fg border-success-border';
    case 'inference':
      return 'bg-info-bg text-info-fg border-info-border';
    case 'contradiction':
      return 'bg-warning-bg text-warning-fg border-warning-border';
    default:
      return 'bg-ink/6 text-muted border-border-default';
  }
}

export function ResearchReview({
  claims,
  draft,
  onUpdateClaim,
  onRevalidate,
  onDeleteEvidence,
  onSaveDraft,
  onRegenerate,
  regenerating,
  isStandaloneWorkspace = false,
}: {
  claims: NarrativeResearchClaim[];
  draft: NarrativeResearchDraft | null;
  onUpdateClaim: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onRevalidate: (id: string) => Promise<void>;
  onDeleteEvidence: (id: string) => Promise<void>;
  onSaveDraft: (patch: { title?: string; summary?: string }) => Promise<void>;
  onRegenerate?: () => Promise<void>;
  regenerating?: boolean;
  /** 是否处于全屏专注工作区 */
  isStandaloneWorkspace?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncedDraftId, setSyncedDraftId] = useState<string | null>(null);
  // 证据栏展开与宽视口控制
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [evidenceWide, setEvidenceWide] = useState(false);
  const [claimsDrawerOpen, setClaimsDrawerOpen] = useState(false);
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setPaneWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const showEvidenceInline = paneWidth >= 1200 && evidenceOpen;
  const showClaimsInline = paneWidth >= 900 && !(showEvidenceInline && evidenceWide);
  useEffect(() => {
    if (showClaimsInline) setClaimsDrawerOpen(false);
    if (showEvidenceInline) setEvidenceDrawerOpen(false);
  }, [showClaimsInline, showEvidenceInline]);

  const activeClaim = claims.find((claim) => claim.id === selectedId) ?? claims[0] ?? null;
  if (draft && syncedDraftId !== draft.id) {
    setSyncedDraftId(draft.id);
    setDraftTitle(draft.title);
    setDraftSummary(draft.summary);
  }

  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const accepted = claims.filter((claim) => claim.status === 'accepted').length;

  const claimsPanel = (
        <aside
          className={cn(
            'h-full min-h-0 w-full flex flex-col rounded-[var(--radius-panel)] border border-border-default bg-surface overflow-hidden',
            !isStandaloneWorkspace && 'max-h-[600px]'
          )}
        >
          <div className="px-3 py-2 border-b border-border-default bg-surface-muted/40 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-ink">结论清单 ({claims.length})</span>
            <span className="text-[11px] text-muted">接受 {accepted}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {claims.map((claim) => {
              const isSelected = activeClaim?.id === claim.id;
              return (
                <button
                  key={claim.id}
                  type="button"
                  onClick={() => { setSelectedId(claim.id); setClaimsDrawerOpen(false); }}
                  className={cn(
                    'w-full rounded-lg border p-2.5 text-left transition-all cursor-pointer',
                    isSelected
                      ? 'border-accent bg-accent/8 shadow-2xs'
                      : 'border-border-default bg-surface hover:border-accent/40 hover:bg-surface-muted/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold', claimTone(claim.claimType))}>
                      {CLAIM_LABELS[claim.claimType ?? 'open-question'] ?? '未分类'}
                    </span>
                    <span className="text-[11px] font-medium text-muted">
                      {claim.status === 'accepted' ? (
                        <span className="text-success-fg">已接受</span>
                      ) : claim.status === 'rejected' ? (
                        <span className="text-danger-fg">已拒绝</span>
                      ) : (
                        '待处理'
                      )}
                    </span>
                  </div>
                  <span className="mt-1.5 block text-xs font-bold leading-snug text-ink line-clamp-2">{claim.title}</span>
                  <span className="mt-1 block text-[10px] text-muted">
                    证据 {claim.evidence?.length ?? 0} 条 · {claim.origin === 'ai' ? 'AI 发现' : '手动'}
                  </span>
                </button>
              );
            })}
            {!claims.length && <p className="p-4 text-center text-xs text-muted">本次运行没有生成通过校验的结论。</p>}
          </div>
        </aside>
  );
  const evidencePanel = (
          <aside
            className={cn(
              'h-full min-h-0 w-full flex flex-col rounded-[var(--radius-panel)] border border-border-default bg-surface overflow-hidden',
              !isStandaloneWorkspace && 'max-h-[600px]'
            )}
          >
            <div className="px-3 py-2 border-b border-border-default bg-surface-muted/40 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-ink">
                证据原文快照 ({activeClaim?.evidence?.length ?? 0})
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEvidenceWide(!evidenceWide)}
                  hidden={!showEvidenceInline}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-muted hover:text-ink hover:bg-surface-muted/60 transition-colors"
                  title={evidenceWide ? '还原宽度' : '展开更宽证据视口'}
                >
                  {evidenceWide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => { setEvidenceOpen(false); setEvidenceDrawerOpen(false); }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-muted hover:text-ink hover:bg-surface-muted/60 transition-colors"
                  title="收起证据面板"
                >
                  <PanelRightClose className="size-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {(activeClaim?.evidence ?? []).map((evidence: NarrativeResearchEvidence) => (
                <div
                  key={evidence.id}
                  className={cn(
                    'rounded-lg border p-3 text-xs space-y-1.5 transition-colors',
                    evidence.valid ? 'border-border-default bg-surface shadow-2xs' : 'border-warning-border bg-warning-bg/30'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-ink">{evidence.locator}</p>
                    <div className="flex flex-none items-center gap-1">
                      {evidence.archiveHref && (
                        <a
                          href={evidence.archiveHref}
                          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-accent hover:underline bg-accent/8"
                          title="跳转至归档原文"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          <span>原文</span>
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void act(() => onDeleteEvidence(evidence.id))}
                        disabled={busy}
                        className="h-6 w-6 p-0 text-muted hover:text-danger-fg"
                        title="删除该证据"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>

                  {evidence.contextBefore && <p className="text-[11px] leading-relaxed text-muted font-serif">{evidence.contextBefore}</p>}
                  <p className="whitespace-pre-wrap font-serif text-xs leading-relaxed text-ink font-medium bg-surface-muted/40 p-2 rounded border border-border-subtle">
                    {evidence.quoteSnapshot}
                  </p>
                  {evidence.contextAfter && <p className="text-[11px] leading-relaxed text-muted font-serif">{evidence.contextAfter}</p>}
                  {!evidence.valid && evidence.validationMessage && (
                    <Alert variant="warning" className="text-[11px] py-1">
                      {evidence.validationMessage}
                    </Alert>
                  )}
                </div>
              ))}

              {activeClaim && !(activeClaim.evidence ?? []).length && (
                <p className="p-4 text-center text-xs text-muted">该结论当前暂无引用证据。</p>
              )}
            </div>
          </aside>
  );

  return (
    <div ref={containerRef} className={cn('w-full min-w-0 flex flex-col', isStandaloneWorkspace ? 'h-full min-h-0 flex-1 overflow-hidden' : 'space-y-4')}>
      {/* 顶部简报：非专注工作区时展示操作条 */}
      {!isStandaloneWorkspace && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default pb-3">
          <p className="text-xs sm:text-sm text-muted">
            已接受 <strong className="text-ink font-semibold">{accepted}</strong> / {claims.length} 条结论。只有点击「确认并写入资料库」才会发布。
          </p>
          {onRegenerate && (
            <Button size="sm" variant="outline" onClick={() => void act(onRegenerate)} disabled={busy || regenerating}>
              {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>重新生成总稿</span>
            </Button>
          )}
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <Button size="sm" variant="outline" className={cn(showClaimsInline && 'hidden')} onClick={() => setClaimsDrawerOpen(true)}>
          结论清单 ({claims.length})
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{activeClaim?.title ?? '请选择结论'}</span>
        <Button size="sm" variant="outline" onClick={() => {
          if (paneWidth >= 1200) setEvidenceOpen(!evidenceOpen);
          else setEvidenceDrawerOpen(true);
        }}>
          {showEvidenceInline ? '收起证据' : '查看证据'} ({activeClaim?.evidence?.length ?? 0})
        </Button>
      </div>
      {error && <Alert variant="danger" className="mx-3 my-2 shrink-0">{error}</Alert>}
      {/* 三栏核心区：结论列表(220-250px) ｜ 结论与总稿(主区受控自适应) ｜ 证据原文(340-420px) */}
      <div className={cn('min-w-0 flex-1 flex flex-row gap-3', isStandaloneWorkspace && 'min-h-0 overflow-hidden p-3')}>
        {/* 左栏：结论列表 */}
        {showClaimsInline && <div className="h-full min-h-0 w-[220px] shrink-0">{claimsPanel}</div>}

        {/* 中栏：结论正文与总稿编辑（主区受控，独立平滑滚动） */}
        <main
          className={cn(
            'flex-1 min-w-0 flex flex-col rounded-xl border border-border-default bg-surface overflow-hidden shadow-2xs',
            isStandaloneWorkspace && 'h-full min-h-0'
          )}
        >
          <div className="px-4 py-2 border-b border-border-default bg-surface-muted/40 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-ink">审核正文与总稿</span>
            <div className="flex items-center gap-2">

            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-3xl mx-auto w-full">
            {activeClaim ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
                  <div className="flex items-center gap-2">
                    <Badge>{CLAIM_LABELS[activeClaim.claimType ?? 'open-question'] ?? '未分类'}</Badge>
                    <span className="text-xs text-muted">来源：{activeClaim.origin === 'ai' ? 'AI 综合分析' : '手动添加'}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant={activeClaim.status === 'accepted' ? 'primary' : 'outline'}
                      onClick={() => void act(() => onUpdateClaim(activeClaim.id, { status: 'accepted' }))}
                      disabled={busy}
                      className="gap-1"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>接受</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void act(() => onUpdateClaim(activeClaim.id, { status: 'pending' }))}
                      disabled={busy}
                      className="gap-1"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-warning-fg" aria-hidden="true" />
                      <span>待确认</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void act(() => onUpdateClaim(activeClaim.id, { status: 'rejected' }))}
                      disabled={busy}
                      className="gap-1 text-muted hover:text-danger-fg"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>拒绝</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void act(() => onRevalidate(activeClaim.id))} disabled={busy} title="重新校验证据">
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h2 className="text-base sm:text-lg font-bold text-ink leading-snug">{activeClaim.title}</h2>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90 font-serif p-4 rounded-lg bg-surface-muted/30 border border-border-subtle">
                    {activeClaim.body}
                  </div>
                </div>

                {activeClaim.explanation && (
                  <div className="rounded-lg border border-border-default bg-surface p-3 text-xs leading-relaxed text-muted space-y-1">
                    <span className="font-semibold text-ink">推导判断依据：</span>
                    <p>{activeClaim.explanation}</p>
                  </div>
                )}

                {activeClaim.uncertainty && (
                  <Alert variant="warning" className="text-xs">
                    不确定与矛盾点：{activeClaim.uncertainty}
                  </Alert>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted">请从左侧选择一条结论开始人工核验。</div>
            )}

            {/* 研究总稿 */}
            {draft && (
              <div className="mt-8 pt-6 border-t border-border-default space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-accent" aria-hidden="true" />
                    <h3 className="text-sm font-bold text-ink">研究总稿（第 {draft.revision} 版）</h3>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void act(() => onSaveDraft({ title: draftTitle, summary: draftSummary }))} disabled={busy}>
                    <span>保存总稿修改</span>
                  </Button>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-muted">总稿标题</span>
                  <input
                    className="h-9 w-full rounded-[var(--radius-control)] border border-border-default bg-surface px-3 text-sm font-medium"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-muted">事实概述与结论提炼</span>
                  <Textarea rows={4} value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} className="text-sm leading-relaxed" />
                </label>
              </div>
            )}
          </div>
        </main>

        {/* 右栏：证据原文与来源定位（可折叠、可调宽） */}
        {showEvidenceInline && (
          <div className="h-full min-h-0 shrink-0" style={{ width: evidenceWide ? 480 : 340 }}>
            {evidencePanel}
          </div>
        )}
      </div>
      <Drawer open={claimsDrawerOpen} onOpenChange={setClaimsDrawerOpen} title="结论清单">
        {claimsPanel}
      </Drawer>
      <Drawer open={evidenceDrawerOpen} onOpenChange={setEvidenceDrawerOpen} title="证据原文与来源">
        {evidencePanel}
      </Drawer>
    </div>
  );
}
