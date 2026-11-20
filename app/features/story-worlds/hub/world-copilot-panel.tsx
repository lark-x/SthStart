'use client';

import React, { useState } from 'react';
import {
  GitBranch,
  ArrowDownToLine,
  Bookmark,
  FilePlus2,
  ListOrdered,
  PenLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  WorldActor,
  WorldChapterCopilotMode,
  WorldCopilotIssue,
  WorldCopilotReference,
  WorldHubCharacterCard,
  WorldHubDocSummary,
  WorldHubScopePolicy,
  WorldLocation,
  WorldStoryLine,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { cn } from '@/app/lib/cn';
import { runWorldChapterCopilot } from '../api';
import { describeError } from '../hooks/world-format';

const ISSUE_CATEGORY_LABELS: Record<WorldCopilotIssue['category'], string> = {
  canon: '原作设定',
  tom: '认知边界',
  voice: '角色声纹',
  style: '文风节奏',
};

const ISSUE_SEVERITY_META: Record<WorldCopilotIssue['severity'], { label: string; variant: 'warning' | 'secondary' }> = {
  warning: { label: '需留意', variant: 'warning' },
  suggestion: { label: '建议', variant: 'secondary' },
};

export interface WorldCopilotPanelProps {
  worldId: string;
  branchId?: string;
  activeArc: WorldStoryLine | null;
  activeDoc: WorldHubDocSummary | null;
  liveDocTitle?: string;
  liveDocBody?: string;
  cast: WorldActor[];
  location?: WorldLocation | null;
  scopePolicy: WorldHubScopePolicy | null;
  characterCards: WorldHubCharacterCard[];
  references: WorldCopilotReference[];
  highlightReferences?: boolean;
  onRemoveReference: (index: number) => void;
  onInsertProse: (prose: string) => void | Promise<void>;
  onCreateChapterFromProse: (title: string, prose: string) => void | Promise<void>;
}

export function WorldCopilotPanel({
  worldId,
  branchId,
  activeArc,
  activeDoc,
  liveDocTitle,
  liveDocBody,
  cast,
  location,
  scopePolicy,
  characterCards,
  references,
  highlightReferences = false,
  onRemoveReference,
  onInsertProse,
  onCreateChapterFromProse,
}: WorldCopilotPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [targetWordCount, setTargetWordCount] = useState<'1500' | '2500' | '3500'>('2500');
  const [beats, setBeats] = useState<string[]>([]);
  const [prose, setProse] = useState('');
  const [issues, setIssues] = useState<WorldCopilotIssue[]>([]);
  const [extractedFacts, setExtractedFacts] = useState<string[]>([]);
  const [checkCompleted, setCheckCompleted] = useState(false);
  const [turns, setTurns] = useState<Array<{ prose: string; choices: string[]; action: string }>>([]);
  const [customAction, setCustomAction] = useState('');

  const [busyMode, setBusyMode] = useState<WorldChapterCopilotMode | null>(null);
  const [savingAction, setSavingAction] = useState<'insert' | 'create' | null>(null);
  const [modelUsed, setModelUsed] = useState('');
  const [error, setError] = useState('');

  const effectiveTitle = (liveDocTitle ?? activeDoc?.title ?? activeArc?.title ?? '').trim();
  const effectiveBody = liveDocBody ?? activeDoc?.body ?? '';
  const hasManuscriptBody = effectiveBody.trim().length > 0;
  const checkSourceBody = hasManuscriptBody ? effectiveBody : prose;
  const proseCharCount = prose.replace(/\s+/g, '').length;
  const linkedCardCount = cast.filter((actor) => actor.characterId && characterCards.some((c) => c.id === actor.characterId)).length;

  const invokeCopilot = async (mode: WorldChapterCopilotMode, turnAction?: string) => {
    if (busyMode) return;
    if (mode === 'polish' && !hasManuscriptBody) {
      setError('当前手稿正文为空，请先打开或撰写章节正文后再润色续写。');
      return;
    }
    if (mode === 'check' && !checkSourceBody.trim()) {
      setError('请先撰写或选中包含正文内容的章节后再执行体检。');
      return;
    }

    setBusyMode(mode);
    setError('');
    const cleanedBeats = beats
      .map((item) => item.trim().slice(0, 1000))
      .filter(Boolean)
      .slice(0, 12);

    try {
      const response = await runWorldChapterCopilot(worldId, {
        mode,
        ...(mode === 'turn' ? { action: (turnAction ?? customAction.trim()) || instruction.trim() || undefined } : {}),
        branchId: branchId || undefined,
        arcId: activeArc?.id || undefined,
        chapterTitle: effectiveTitle ? effectiveTitle.slice(0, 200) : undefined,
        instruction: instruction.trim() ? instruction.trim().slice(0, 8000) : undefined,
        beats: cleanedBeats.length > 0 ? cleanedBeats : undefined,
        actorIds: cast.length > 0 ? cast.map((actor) => actor.id).slice(0, 20) : undefined,
        locationId: location?.id || undefined,
        existingBody:
          mode === 'turn'
            ? [effectiveBody, ...turns.map((turn) => `作者行动：${turn.action}\n${turn.prose}`)].filter(Boolean).join('\n\n').slice(0, 100000) || undefined
            : mode === 'check'
            ? checkSourceBody.slice(0, 100000)
            : effectiveBody.trim()
              ? effectiveBody.slice(0, 100000)
              : undefined,
        references: references.length > 0 ? references.slice(0, 10) : undefined,
        targetWordCount: Number(targetWordCount),
      });

      setModelUsed(response.modelUsed);
      if (mode === 'beats') {
        setBeats(response.beats);
      } else if (mode === 'turn') {
        const action = turnAction ?? (customAction.trim() || instruction.trim());
        setTurns((previous) => [...previous, { prose: response.prose, choices: response.choices, action }]);
        setCustomAction('');
      } else if (mode === 'draft' || mode === 'polish') {
        setProse(response.prose);
      } else if (mode === 'check') {
        setIssues(response.issues);
        setExtractedFacts(response.extractedFacts);
        setCheckCompleted(true);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyMode(null);
    }
  };

  const appendTurnsToChapter = async () => {
    if (turns.length === 0 || savingAction) return;
    const record = turns.map((turn, index) => [
      `### 推演 ${index + 1}${turn.action ? ` · ${turn.action}` : ''}`,
      turn.prose,
      turn.choices.length ? `\n下一步\n${turn.choices.map((choice) => `- ${choice}`).join('\n')}` : '',
    ].join('\n\n')).join('\n\n');
    setSavingAction('insert');
    setError('');
    try {
      if (activeDoc) await onInsertProse(record);
      else await onCreateChapterFromProse(`${effectiveTitle || activeArc?.title || '互动推演'} · 推演记录`, record);
      setTurns([]);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSavingAction(null);
    }
  };

  const handleInsert = async () => {
    if (!prose.trim() || !activeDoc || savingAction) return;
    setSavingAction('insert');
    setError('');
    try {
      await onInsertProse(prose);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSavingAction(null);
    }
  };

  const handleCreateChapter = async () => {
    if (!prose.trim() || savingAction) return;
    setSavingAction('create');
    setError('');
    const baseName = effectiveTitle || activeArc?.title || '未命名章节';
    const nextTitle = `${baseName} · AI 草稿`.slice(0, 120);
    try {
      await onCreateChapterFromProse(nextTitle, prose);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSavingAction(null);
    }
  };

  return (
    <div className="space-y-5 p-4">
      {/* 上下文摘要 */}
      <div className="rounded-[var(--radius-control)] bg-surface-sunken/60 p-3 text-xs leading-relaxed">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="font-semibold text-ink">
            {effectiveTitle || '未选定章节上下文'}
          </span>
          {modelUsed && (
            <span className="truncate text-xs text-muted" title={modelUsed}>
              模型：{modelUsed}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-muted">
          <span>{cast.length} 位出场角色</span>
          {linkedCardCount > 0 && <span>· {linkedCardCount} 份角色卡</span>}
          {location && <span>· 舞台：{location.name}</span>}
          {scopePolicy?.styleGuide?.tone && <span>· 文风约束已加载</span>}
        </div>
      </div>

      {error && (
        <Alert variant="danger" title="AI 写作助手未完成" onDismiss={() => setError('')}>
          {error}
        </Alert>
      )}

      <section className="space-y-3 border-t border-hairline pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            <span>互动推演 · 第 {turns.length + 1} 回合</span>
          </h3>
          {turns.length > 0 && (
            <Button size="sm" variant="outline" loading={savingAction === 'insert'} disabled={Boolean(savingAction)} onClick={() => void appendTurnsToChapter()}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
              汇入章节
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted">由你决定人物、处境和每一步行动。推演内容留在当前会话，汇入章节后才成为手稿。</p>
        {turns.map((turn, index) => (
          <article key={index} className="space-y-2 border-l-2 border-accent/40 pl-3">
            {turn.action && <p className="text-xs font-medium text-accent">你的行动 · {turn.action}</p>}
            <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink">{turn.prose}</p>
            {index === turns.length - 1 && turn.choices.map((choice) => (
              <Button key={choice} size="sm" variant="secondary" disabled={Boolean(busyMode)} onClick={() => void invokeCopilot('turn', choice)}>
                {choice}
              </Button>
            ))}
          </article>
        ))}
        <div className="space-y-2">
          <Textarea
            rows={2}
            maxLength={2000}
            value={customAction}
            onChange={(event) => setCustomAction(event.target.value)}
            placeholder={turns.length === 0 ? '写一个人物、处境或开场念头…' : '也可以写下你自己的行动…'}
            aria-label={turns.length === 0 ? '互动推演的开场方向' : '互动推演的自定义行动'}
          />
          <Button
            size="sm"
            variant="primary"
            loading={busyMode === 'turn'}
            disabled={Boolean(busyMode) || !customAction.trim()}
            onClick={() => void invokeCopilot('turn', customAction.trim())}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {turns.length === 0 ? '开始推演' : '按我的行动继续'}
          </Button>
        </div>
      </section>

      {/* 参考篮 */}
      <section
        aria-label="MCP 参考篮"
        className={cn(
          'space-y-2 rounded-[var(--radius-control)] border p-3 transition-shadow',
          highlightReferences
            ? 'border-accent bg-surface-raised shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_22%,transparent)]'
            : 'border-hairline bg-surface-raised/60',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Bookmark className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>参考篮 ({references.length})</span>
          </h3>
          <span className="text-xs text-muted">最多 10 条</span>
        </div>

        {references.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted">
            在左侧正史章节「MCP 检索」结果中点击「加入参考篮」，即可把原著原文片段固定为本次写作依据。
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {references.map((ref, idx) => (
              <div
                key={`${ref.locator || ref.title}-${idx}`}
                className="group flex max-w-full items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 text-xs text-ink shadow-xs"
                title={ref.excerpt}
              >
                <span className="max-w-47.5 truncate font-medium">{ref.title}</span>
                <button
                  type="button"
                  aria-label={`移出参考「${ref.title}」`}
                  onClick={() => onRemoveReference(idx)}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 写作指令与篇幅 */}
      <section className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="copilot-instruction" className="block text-xs font-semibold text-muted">
            本幕写作指令与情节转折
          </label>
          <Textarea
            id="copilot-instruction"
            rows={3}
            maxLength={8000}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void invokeCopilot('draft');
              }
            }}
            placeholder="写明本幕冲突、出场情绪、希望保留的对白或节奏要求…"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor="copilot-word-count" className="shrink-0 text-xs font-semibold text-muted">
            目标篇幅
          </label>
          <Select
            id="copilot-word-count"
            value={targetWordCount}
            onChange={(event) => setTargetWordCount(event.target.value as '1500' | '2500' | '3500')}
            className="w-48"
          >
            <option value="1500">约 1500 字（短幕）</option>
            <option value="2500">约 2500 字（标准）</option>
            <option value="3500">约 3500 字（长章）</option>
          </Select>
        </div>
      </section>

      {/* Stage 1: 场纲节拍 */}
      <section className="space-y-2.5 border-t border-hairline pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
            <span>1. 场纲节拍</span>
          </h3>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(busyMode) || beats.length >= 12}
              onClick={() => setBeats((prev) => [...prev, ''])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              添加
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busyMode === 'beats'}
              disabled={Boolean(busyMode)}
              onClick={() => void invokeCopilot('beats')}
            >
              {busyMode !== 'beats' && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              生成场纲节拍
            </Button>
          </div>
        </div>

        {beats.length > 0 ? (
          <div className="space-y-2">
            {beats.map((beat, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <span className="w-5 shrink-0 text-center text-xs font-medium text-muted">
                  {index + 1}.
                </span>
                <Input
                  value={beat}
                  maxLength={1000}
                  aria-label={`第 ${index + 1} 拍场纲`}
                  placeholder="描述这一拍发生的行动或情绪转变…"
                  onChange={(event) => {
                    const value = event.target.value;
                    setBeats((prev) => prev.map((item, idx) => (idx === index ? value : item)));
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Enter' && beats.length < 12) {
                      event.preventDefault();
                      setBeats((prev) => [
                        ...prev.slice(0, index + 1),
                        '',
                        ...prev.slice(index + 1),
                      ]);
                    }
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`删除第 ${index + 1} 拍`}
                  onClick={() => setBeats((prev) => prev.filter((_, idx) => idx !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted">
            先拟定 4~6 拍场纲再写正文，可明显提升剧情推进稳定性；也可以跳过此步直接写正文。
          </p>
        )}
      </section>

      {/* Stage 2: 撰写正文 / 润色续写 */}
      <section className="space-y-3 border-t border-hairline pt-4">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
          <span>2. 撰写与润色正文</span>
        </h3>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            size="sm"
            variant="primary"
            loading={busyMode === 'draft'}
            disabled={Boolean(busyMode)}
            onClick={() => void invokeCopilot('draft')}
          >
            {busyMode !== 'draft' && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            撰写正文
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busyMode === 'polish'}
            disabled={Boolean(busyMode) || !hasManuscriptBody}
            title={!hasManuscriptBody ? '当前章节尚无正文内容' : '基于当前手稿润色或续写'}
            onClick={() => void invokeCopilot('polish')}
          >
            {busyMode !== 'polish' && <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />}
            润色/续写当前手稿
          </Button>
        </div>

        {prose && (
          <div className="space-y-2.5 rounded-[var(--radius-control)] bg-surface-raised p-3.5 shadow-[0_0_0_1px_var(--hairline)]">
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span>正文草稿预览 · {proseCharCount} 字</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setProse('')}
              >
                清空
              </Button>
            </div>

            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-surface-sunken/40 p-3 font-serif text-sm leading-relaxed text-ink">
              {prose}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={!activeDoc || Boolean(savingAction)}
                loading={savingAction === 'insert'}
                title={!activeDoc ? '请先在左侧选择或新建一个章节手稿' : undefined}
                onClick={() => void handleInsert()}
              >
                {savingAction !== 'insert' && <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />}
                插入当前章节
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(savingAction)}
                loading={savingAction === 'create'}
                onClick={() => void handleCreateChapter()}
              >
                {savingAction !== 'create' && <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />}
                存为新章节
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Stage 3: 设定与人设体检（非阻断） */}
      <section className="space-y-3 border-t border-hairline pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>3. 设定与人设体检</span>
          </h3>
          <Button
            size="sm"
            variant="outline"
            loading={busyMode === 'check'}
            disabled={Boolean(busyMode) || !checkSourceBody.trim()}
            onClick={() => void invokeCopilot('check')}
          >
            {busyMode !== 'check' && <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
            设定与人设体检
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          非阻断审校：检查原作事实冲突、角色信息边界、人物声纹与文风节奏，仅提供参考提示。
        </p>

        {checkCompleted && issues.length === 0 && (
          <Alert variant="success" title="体检通过">
            未发现明显的设定矛盾、角色失声或认知越界问题。
          </Alert>
        )}

        {issues.length > 0 && (
          <div className="space-y-2">
            {issues.map((issue, idx) => {
              const severityMeta = ISSUE_SEVERITY_META[issue.severity];
              return (
                <div
                  key={idx}
                  className="space-y-1.5 rounded-[var(--radius-control)] bg-surface-raised p-3 text-xs shadow-[0_0_0_1px_var(--hairline)]"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={severityMeta.variant}>{severityMeta.label}</Badge>
                    <Badge variant="outline">{ISSUE_CATEGORY_LABELS[issue.category]}</Badge>
                  </div>
                  {issue.quote && (
                    <p className="border-l-2 border-border-default pl-2 font-serif text-muted">
                      {issue.quote}
                    </p>
                  )}
                  <p className="leading-relaxed text-ink">{issue.detail}</p>
                </div>
              );
            })}
          </div>
        )}

        {extractedFacts.length > 0 && (
          <div className="space-y-1.5 rounded-[var(--radius-control)] bg-surface-sunken/60 p-3 text-xs">
            <p className="font-semibold text-ink">本段新提取事实 / 伏笔线索</p>
            <ul className="space-y-1 text-muted">
              {extractedFacts.map((fact, idx) => (
                <li key={idx} className="leading-relaxed">
                  · {fact}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
