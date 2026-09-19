'use client';

import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';
import { Check, X } from 'lucide-react';
import type { ActivityCandidate, ActorSnapshot } from '@sthstart/contracts';

interface InlineCandidatePanelProps {
  candidates: ActivityCandidate[];
  actors: ActorSnapshot[];
  running: boolean;
  failed: boolean;
  errorMsg: string | null;
  adopting: boolean;
  onAdopt: (candidateId: string) => void;
  onDismiss: () => void;
}

/**
 * 视图内生成的候选预览。
 *
 * 群聊/朋友圈的一键生成不直接写入文档，先生成候选让用户确认。
 * 这里只渲染这次生成产生的消息与动态摘要，完整对比仍在生成弹窗里。
 */
export function InlineCandidatePanel({
  candidates, actors, running, failed, errorMsg, adopting, onAdopt, onDismiss,
}: InlineCandidatePanelProps) {
  if (!running && !failed && !candidates.length && !errorMsg) return null;

  const nameOf = (actorId?: string) => actors.find((actor) => actor.id === actorId)?.displayName || actorId || '未指定';
  const lines = candidates.flatMap((candidate) => {
    const payload = candidate.payload as { messages?: Array<{ text?: string; speakerActorId?: string }>; posts?: Array<{ text?: string; authorActorId?: string }> };
    return [
      ...(payload.messages || []).map((message) => `${nameOf(message.speakerActorId)}：${message.text || ''}`),
      ...(payload.posts || []).map((post) => `${nameOf(post.authorActorId)}（朋友圈）：${post.text || ''}`),
    ];
  });

  return (
    <section aria-label="生成结果预览" className="rounded-[var(--radius-panel)] border border-accent/40 bg-accent/5 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {running ? '正在生成…' : failed ? '生成失败' : `已生成 ${candidates.length} 个候选，确认后才会写入`}
        </p>
        <div className="flex items-center gap-2">
          {!running && candidates.map((candidate) => (
            <Button key={candidate.id} size="sm" disabled={adopting} onClick={() => onAdopt(candidate.id)} className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" />
              采用
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onDismiss} className="flex items-center gap-1.5">
            <X className="h-3.5 w-3.5" />
            关闭
          </Button>
        </div>
      </div>
      {running && <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="h-3.5 w-3.5 animate-spin" />生成中，可以继续编辑，完成后这里会出现候选。</p>}
      {errorMsg && <Alert variant="danger" title="生成未完成">{errorMsg}</Alert>}
      {!running && lines.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-ink">
          {lines.map((line, index) => <li key={index} className="rounded bg-surface px-2 py-1">{line}</li>)}
        </ul>
      )}
    </section>
  );
}

