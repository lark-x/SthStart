'use client';

import React, { useState } from 'react';
import { MessageCircle, Sparkles } from 'lucide-react';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { isCharacterAuditionFieldPath, type CharacterAuditionFieldPath } from '@sthstart/contracts';
import { auditionCharacter, type CharacterAuditionResult } from '../api';

const PRESETS = [
  { label: '收到生日邀请', value: '你收到朋友发来的生日聚会邀请，请用角色的口吻回复。' },
  { label: '群里有人迟到', value: '群聊里有人迟到了十分钟，角色现在会怎么说？' },
  { label: '写朋友圈配文', value: '角色要为一张生日合照写一条朋友圈配文。' },
];

type SuggestionField = CharacterAuditionFieldPath;

export function CharacterAuditionPanel({
  characterId,
  draftRevision,
  onAdoptSuggestion,
}: {
  characterId?: string;
  draftRevision?: number;
  /** 采用建议：只把建议值写进当前草稿，仍需用户保存。 */
  onAdoptSuggestion?: (fieldPath: SuggestionField, after: string) => void;
}) {
  const [scenario, setScenario] = useState(PRESETS[0].value);
  const [feedback, setFeedback] = useState('');
  const [result, setResult] = useState<CharacterAuditionResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [adopted, setAdopted] = useState<string[]>([]);

  const runAudition = async () => {
    if (!characterId || !scenario.trim()) return;
    setRunning(true);
    setError('');
    try {
      setResult(await auditionCharacter(characterId, { scenario: scenario.trim(), feedback: feedback.trim() || undefined, draftRevision }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '试演失败，请检查文本模型配置。');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink"><MessageCircle className="h-4 w-4 text-accent" />轻量试演</h4>
          <p className="mt-0.5 text-sm text-muted">只读取当前草稿，结果不会写入活动记录；修改建议需要你确认后再采用。</p>
        </div>
        <Badge variant="outline">草稿预览</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => <Button key={preset.label} type="button" size="sm" variant="outline" onClick={() => setScenario(preset.value)} disabled={!characterId}>{preset.label}</Button>)}
      </div>
      <Textarea value={scenario} onChange={(event) => setScenario(event.target.value)} rows={3} placeholder="输入一句场景…" disabled={!characterId} />
      <Textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={2} placeholder="可选反馈：语气太正式、口头禅太多…" disabled={!characterId} />
      <Button type="button" variant="accent" size="sm" onClick={() => void runAudition()} loading={running} disabled={!characterId || !scenario.trim()}><Sparkles className="h-3.5 w-3.5" />开始试演</Button>
      {!characterId && <p className="text-sm text-muted">保存角色后即可试演。</p>}
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      {result && (
        <div className="rounded border border-accent/20 bg-accent/5 p-3 space-y-2">
          <p className="text-sm leading-relaxed text-ink whitespace-pre-wrap">{result.output}</p>
          {result.suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-accent-dark">可选修改建议（先看差异，再决定是否采用）</p>
              {result.suggestions.map((suggestion, index) => {
                const key = `${suggestion.fieldPath}-${index}`;
                const supported = isCharacterAuditionFieldPath(suggestion.fieldPath);
                const isEmpty = !suggestion.after.trim();
                const disabled = !supported || isEmpty || !onAdoptSuggestion || adopted.includes(key);
                return (
                  <div key={key} className="rounded border border-border-subtle bg-surface p-2 text-xs">
                    <p className="font-semibold text-ink">{suggestion.fieldPath}</p>
                    {suggestion.reason && <p className="mt-0.5 text-muted">{suggestion.reason}</p>}
                    <p className="mt-1 text-muted"><span className="text-muted">当前：</span>{suggestion.before.trim() || '（空）'}</p>
                    <p className="mt-1 text-muted"><span className="text-muted">建议：</span>{suggestion.after.trim() || '（空）'}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => { onAdoptSuggestion?.(suggestion.fieldPath as SuggestionField, suggestion.after); setAdopted((current) => [...current, key]); }}
                      >
                        {adopted.includes(key) ? '已写入草稿' : '采用到草稿'}
                      </Button>
                      {!supported && <span className="text-muted">该字段在当前编辑器里没有对应位置，未提供采用入口</span>}
                      {supported && isEmpty && <span className="text-muted">建议值为空，未提供采用入口</span>}
                      {adopted.includes(key) && <span className="text-muted">记得保存草稿</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
