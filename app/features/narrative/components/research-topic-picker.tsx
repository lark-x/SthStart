'use client';

import React, { useState } from 'react';
import { Sparkles, PenLine, Loader2, AlertTriangle, ChevronRight } from 'lucide-react';
import type { NarrativeWork, ResearchScope, ResearchTopicSuggestionResult } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Alert } from '@/app/components/ui/alert';

/**
 * 第一次人工确认：AI 选题或用户自定主题，两条路最终都落到同一种研究专题。
 * AI 候选必须带真实种子证据，扫描范围与丢弃原因如实展示。
 */
export function ResearchTopicPicker({
  works,
  activeWorkId,
  onWorkChange,
  onCreated,
  suggest,
  createProject,
}: {
  works: NarrativeWork[];
  activeWorkId: string;
  onWorkChange: (workId: string) => void;
  onCreated: (projectId: string) => void;
  suggest: (input: { workId: string; scope?: ResearchScope }) => Promise<ResearchTopicSuggestionResult>;
  createProject: (input: { workId: string; title: string; question: string; scope?: ResearchScope; origin?: 'ai-suggested' | 'user-defined' }) => Promise<{ id: string }>;
}) {
  const [mode, setMode] = useState<'choose' | 'ai' | 'manual'>('choose');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResearchTopicSuggestionResult | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState('');

  const runSuggest = async () => {
    if (!activeWorkId || busy) return;
    setBusy(true); setError('');
    try {
      setResult(await suggest({ workId: activeWorkId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  };

  const submitManual = async () => {
    if (!activeWorkId || !title.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const scope: ResearchScope = { workId: activeWorkId };
      const list = keywords.split(/[，,\s]+/).map((item) => item.trim()).filter(Boolean);
      if (list.length) scope.keywords = list;
      const project = await createProject({ workId: activeWorkId, title: title.trim(), question: question.trim(), scope, origin: 'user-defined' });
      onCreated(project.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  };

  const pickSuggestion = async (suggestionId: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const project = await createProjectFromSuggestion(suggestionId);
      onCreated(project.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  };

  // 选中候选即建专题；这里单独包一层，方便把错误收在同一个提示里。
  const createProjectFromSuggestion = async (suggestionId: string) => {
    const { selectTopicSuggestion } = await import('../research-api');
    return selectTopicSuggestion(suggestionId);
  };

  const candidates = (result?.items ?? []).filter((item) => !dismissed.includes(item.id));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-semibold text-ink" htmlFor="research-work">研究作品</label>
            <select
              id="research-work"
              value={activeWorkId}
              onChange={(event) => { onWorkChange(event.target.value); setResult(null); }}
              className="h-9 rounded-[var(--radius-control)] border border-border-default bg-surface px-3 text-sm"
            >
              {works.map((work) => <option key={work.id} value={work.id}>{work.title}</option>)}
            </select>
            <span className="text-xs text-muted">一个专题只对应一个作品，避免同名实体跨作品互相污染。</span>
          </div>

          {mode === 'choose' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => { setMode('ai'); void runSuggest(); }}
                className="flex items-start gap-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 text-left transition-colors hover:border-accent/40"
              >
                <Sparkles className="mt-0.5 h-5 w-5 flex-none text-accent" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold text-ink">AI 发现研究主题</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">扫描本地原文，给出带真实证据的候选主题。</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode('manual')}
                className="flex items-start gap-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 text-left transition-colors hover:border-accent/40"
              >
                <PenLine className="mt-0.5 h-5 w-5 flex-none text-accent" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold text-ink">自己提出研究主题</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">填写想回答的问题，再补充关键词。</span>
                </span>
              </button>
            </div>
          )}

          {mode === 'ai' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { setMode('choose'); setResult(null); }}>返回</Button>
                <Button size="sm" onClick={() => void runSuggest()} disabled={busy || !activeWorkId}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                  <span>{busy ? '扫描中…' : '重新扫描'}</span>
                </Button>
              </div>

              {result?.scopeNote && <Alert variant="warning">{result.scopeNote}</Alert>}
              {result?.incompleteReason && <Alert variant="warning">{result.incompleteReason}</Alert>}

              {result && (
                <p className="text-xs text-muted">
                  已扫描 {result.scanned.nodes} / {result.scanned.total} 个节点，{result.scanned.batches} 批，{result.scanned.modelCalls} 次模型调用。
                </p>
              )}

              <div className="space-y-2">
                {candidates.map((candidate) => (
                  <div key={candidate.id} className="rounded-[var(--radius-panel)] border border-border-default bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{candidate.title}</p>
                        <p className="mt-1 text-xs text-muted">{candidate.question}</p>
                      </div>
                      <div className="flex flex-none gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDismissed((list) => [...list, candidate.id])}>忽略</Button>
                        <Button size="sm" onClick={() => void pickSuggestion(candidate.id)} disabled={busy}>
                          <span>选它</span>
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    {candidate.reason && <p className="mt-2 text-xs text-muted">值得研究：{candidate.reason}</p>}
                    {/* 种子证据必须来自本地原文，用户能直接看到出处。 */}
                    {candidate.seedEvidence.length > 0 && (
                      <div className="mt-2 space-y-1 rounded-[var(--radius-control)] bg-ink/4 p-2">
                        <p className="text-[11px] font-semibold text-muted">本地种子证据</p>
                        {candidate.seedEvidence.slice(0, 2).map((seed, index) => (
                          <p key={`${seed.targetId}-${index}`} className="text-xs leading-relaxed text-ink/80">
                            <span className="text-muted">{seed.locator}：</span>{seed.quote.slice(0, 160)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {result && !candidates.length && (
                  <p className="text-sm text-muted">没有可用的候选主题，请调整作品范围或先补充原文。</p>
                )}
              </div>

              {(result?.discarded.length ?? 0) > 0 && (
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer">已丢弃 {result!.discarded.length} 个候选（点击查看原因）</summary>
                  <ul className="mt-2 space-y-1">
                    {result!.discarded.map((item, index) => (
                      <li key={`${item.title}-${index}`} className="flex gap-2">
                        <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" />
                        <span>{item.title}：{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {mode === 'manual' && (
            <div className="space-y-3">
              <Button size="sm" variant="outline" onClick={() => setMode('choose')}>返回</Button>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-ink">主题标题</span>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：赤王文明与禁忌知识的联系" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-ink">已知关键词（可选）</span>
                  <Input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="用逗号分隔，例如：赤王，禁忌知识" />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-ink">希望回答的问题</span>
                <Textarea rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：不同书籍对灾难原因的描述是否一致？" />
              </label>
              <div className="flex justify-end">
                <Button onClick={() => void submitManual()} disabled={busy || !title.trim()}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  <span>创建并进入确认</span>
                </Button>
              </div>
            </div>
          )}

          {error && <Alert variant="danger">{error}</Alert>}
        </CardContent>
      </Card>
    </div>
  );
}
