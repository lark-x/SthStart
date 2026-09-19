'use client';

import React, { useState } from 'react';
import { Check, X, ExternalLink, RefreshCw, Loader2, FileText, Trash2, AlertTriangle } from 'lucide-react';
import type { NarrativeResearchClaim, NarrativeResearchEvidence, NarrativeResearchDraft } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Textarea } from '@/app/components/ui/textarea';
import { cn } from '@/app/lib/cn';

const CLAIM_LABELS: Record<string, string> = {
  fact: '原作明确', inference: '推论', speculation: '猜想', contradiction: '矛盾', 'open-question': '开放问题',
};

/** 类型不同语气也不同：事实可以直接引用，猜想只能参考。 */
function claimTone(claimType: string | null): string {
  switch (claimType) {
    case 'fact': return 'bg-success-bg text-success-fg border-success-border';
    case 'inference': return 'bg-info-bg text-info-fg border-info-border';
    case 'contradiction': return 'bg-warning-bg text-warning-fg border-warning-border';
    default: return 'bg-ink/6 text-muted border-border-default';
  }
}

/**
 * 第二次人工确认：三栏审核。
 * 左栏结论列表、中栏编辑与状态、右栏证据原文与来源定位。
 */
export function ResearchReview({
  claims,
  draft,
  onUpdateClaim,
  onRevalidate,
  onDeleteEvidence,
  onSaveDraft,
  onRegenerate,
  regenerating,
}: {
  claims: NarrativeResearchClaim[];
  draft: NarrativeResearchDraft | null;
  onUpdateClaim: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onRevalidate: (id: string) => Promise<void>;
  onDeleteEvidence: (id: string) => Promise<void>;
  onSaveDraft: (patch: { title?: string; summary?: string }) => Promise<void>;
  onRegenerate?: () => Promise<void>;
  regenerating?: boolean;
}) {
  /*
   * 选中的结论用可空值保存：没选时回落到第一条。
   * 用 useEffect 去补默认值会多一次渲染，也容易在列表变化时跳到错误条目。
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [busy, setBusy] = useState(false);
  /*
   * 总稿输入框只在切换版本时同步一次：直接跟随 draft 会在用户输入后
   * 又被服务端回包覆盖，光标也会跳。用「已同步版本」在渲染期派生。
   */
  const [syncedDraftId, setSyncedDraftId] = useState<string | null>(null);

  const activeClaim = claims.find((claim) => claim.id === selectedId) ?? claims[0] ?? null;
  if (draft && syncedDraftId !== draft.id) {
    setSyncedDraftId(draft.id);
    setDraftTitle(draft.title);
    setDraftSummary(draft.summary);
  }

  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); } finally { setBusy(false); }
  };

  const accepted = claims.filter((claim) => claim.status === 'accepted').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          已接受 <strong className="text-ink">{accepted}</strong> / {claims.length} 条结论。只有点击「确认并写入资料库」才会发布。
        </p>
        {onRegenerate && (
          <Button size="sm" variant="outline" onClick={() => void act(onRegenerate)} disabled={busy || regenerating}>
            {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>重新生成总稿</span>
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]">
        {/* 左栏：结论列表 */}
        <div className="space-y-2">
          {claims.map((claim) => (
            <button
              key={claim.id}
              type="button"
              onClick={() => setSelectedId(claim.id)}
              className={cn(
                'w-full rounded-[var(--radius-panel)] border p-3 text-left transition-colors',
                activeClaim?.id === claim.id ? 'border-accent/50 bg-accent/8' : 'border-border-default bg-surface hover:border-accent/30',
              )}
            >
              <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', claimTone(claim.claimType))}>
                {CLAIM_LABELS[claim.claimType ?? 'open-question'] ?? '未分类'}
              </span>
              <span className="mt-1.5 block text-sm font-semibold leading-snug text-ink">{claim.title}</span>
              <span className="mt-1 block text-xs text-muted">
                {claim.status === 'accepted' ? '已接受' : claim.status === 'rejected' ? '已拒绝' : '待处理'}
              </span>
            </button>
          ))}
          {!claims.length && <p className="text-sm text-muted">本次运行没有生成通过校验的结论。</p>}
        </div>

        {/* 中栏：编辑与状态 */}
        <div className="space-y-3">
          {activeClaim ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{CLAIM_LABELS[activeClaim.claimType ?? 'open-question'] ?? '未分类'}</Badge>
                  <span className="text-xs text-muted">来源：{activeClaim.origin === 'ai' ? 'AI 生成' : '手动添加'}</span>
                </div>
                <h3 className="text-sm font-semibold text-ink">{activeClaim.title}</h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{activeClaim.body}</p>
                {activeClaim.explanation && <p className="text-xs leading-relaxed text-muted">判断依据：{activeClaim.explanation}</p>}
                {activeClaim.uncertainty && <Alert variant="warning">不确定点：{activeClaim.uncertainty}</Alert>}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="primary" onClick={() => void act(() => onUpdateClaim(activeClaim.id, { status: 'accepted' }))} disabled={busy}>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /><span>接受</span>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void act(() => onUpdateClaim(activeClaim.id, { status: 'pending' }))} disabled={busy}>
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /><span>待验证</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void act(() => onUpdateClaim(activeClaim.id, { status: 'rejected' }))} disabled={busy}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" /><span>拒绝</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void act(() => onRevalidate(activeClaim.id))} disabled={busy}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /><span>重新校验证据</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="p-4 text-sm text-muted">选择左侧一条结论开始审核。</CardContent></Card>
          )}

          {draft && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-accent" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-ink">研究总稿（第 {draft.revision} 版）</h3>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-ink">标题</span>
                  <input
                    className="h-9 w-full rounded-[var(--radius-control)] border border-border-default bg-surface px-3 text-sm"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-ink">概述</span>
                  <Textarea rows={2} value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} />
                </label>
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => void act(() => onSaveDraft({ title: draftTitle, summary: draftSummary }))} disabled={busy}>
                    <span>保存总稿</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右栏：证据原文与来源定位 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted">证据原文（研究当时的冻结快照）</p>
          {(activeClaim?.evidence ?? []).map((evidence: NarrativeResearchEvidence) => (
            <div key={evidence.id} className={cn('rounded-[var(--radius-panel)] border p-3', evidence.valid ? 'border-border-default bg-surface' : 'border-warning-border bg-warning-bg/40')}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-ink">{evidence.locator}</p>
                <div className="flex flex-none gap-1">
                  {evidence.archiveHref && (
                    <a href={evidence.archiveHref} className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs text-accent hover:underline">
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />原文
                    </a>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void act(() => onDeleteEvidence(evidence.id))} disabled={busy} title="删除这条证据">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {evidence.contextBefore && <p className="mt-2 text-xs leading-relaxed text-muted">{evidence.contextBefore}</p>}
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{evidence.quoteSnapshot}</p>
              {evidence.contextAfter && <p className="mt-1 text-xs leading-relaxed text-muted">{evidence.contextAfter}</p>}
              {!evidence.valid && evidence.validationMessage && <Alert variant="warning">{evidence.validationMessage}</Alert>}
            </div>
          ))}
          {activeClaim && !(activeClaim.evidence ?? []).length && (
            <p className="text-sm text-muted">这条结论还没有证据。</p>
          )}
        </div>
      </div>
    </div>
  );
}
