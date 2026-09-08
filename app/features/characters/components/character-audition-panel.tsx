'use client';

import React, { useState } from 'react';
import { MessageCircle, Sparkles } from 'lucide-react';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { auditionCharacter, type CharacterAuditionResult } from '../api';

const PRESETS = [
  { label: '收到生日邀请', value: '你收到朋友发来的生日聚会邀请，请用角色的口吻回复。' },
  { label: '群里有人迟到', value: '群聊里有人迟到了十分钟，角色现在会怎么说？' },
  { label: '写朋友圈配文', value: '角色要为一张生日合照写一条朋友圈配文。' },
];

export function CharacterAuditionPanel({ characterId, draftRevision }: { characterId?: string; draftRevision?: number }) {
  const [scenario, setScenario] = useState(PRESETS[0].value);
  const [feedback, setFeedback] = useState('');
  const [result, setResult] = useState<CharacterAuditionResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

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
    <section className="rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/12%)] bg-surface p-4 space-y-3">
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
      {error && <p className="text-sm text-[#a84427]">{error}</p>}
      {result && <div className="rounded border border-accent/20 bg-accent/5 p-3 space-y-2"><p className="text-sm leading-relaxed text-ink whitespace-pre-wrap">{result.output}</p>{result.suggestions.length > 0 && <div className="space-y-1"><p className="text-xs font-semibold text-accent-dark">可选修改建议</p>{result.suggestions.map((suggestion, index) => <p key={`${suggestion.fieldPath}-${index}`} className="text-xs text-muted">{suggestion.fieldPath}：{suggestion.reason}</p>)}</div>}</div>}
    </section>
  );
}
