'use client';

import React, { useState } from 'react';
import { Dialog } from '@/app/components/ui/dialog';
import { Alert } from '@/app/components/ui/alert';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { useActivityJob } from '../../queries';
import { CandidateReviewPanel } from '../candidate-review-panel';

const RUNNING = ['queued', 'preparing', 'submitting', 'accepted', 'running'];

interface StudioCandidateDialogProps {
  activityId: string;
  /** 记录链接（?tab=records&jobId=…）带来的文本任务；为空时不显示。 */
  jobId: string | null;
  onClose: () => void;
  onApplied: () => void;
}

/** 文本任务的候选对比：逐条比较当前版本与候选，只采用勾选的部分。 */
export function StudioCandidateDialog({ activityId, jobId, onClose, onApplied }: StudioCandidateDialogProps) {
  const { data, isLoading, error } = useActivityJob(activityId, jobId ?? undefined);
  const candidates = data?.candidates ?? [];
  const [pickedId, setPickedId] = useState<string | null>(null);
  // 默认停在第一份尚未采用的候选；之后保持用户所选，采用完不会跳到别的候选。
  const fallback = candidates.find(candidate => !candidate.adopted) ?? candidates[0];
  if (!pickedId && fallback) setPickedId(fallback.id);
  const current = candidates.find(candidate => candidate.id === pickedId) ?? fallback;
  const running = Boolean(data?.job && RUNNING.includes(data.job.status));

  return (
    <Dialog open={Boolean(jobId)} onOpenChange={open => { if (!open) onClose(); }} size="lg"
      title="生成候选审阅" description="逐条比较当前版本与候选内容，只采用勾选的部分；采用后自动保存为新版本。">
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-muted" role="status">正在读取生成任务…</p>}
        {error && <Alert variant="danger" title="无法读取生成任务">{error instanceof Error ? error.message : String(error)}</Alert>}
        {running && <Alert variant="info">任务仍在生成，完成后候选会出现在这里。</Alert>}
        {data && !running && !candidates.length && <p className="text-sm text-muted">这个任务没有可采用的候选。</p>}
        {candidates.length > 1 && (
          <PageTabs ariaLabel="候选列表" value={current?.id ?? ''} onChange={setPickedId}
            tabs={candidates.map((candidate, index) => ({ id: candidate.id, label: `候选 ${index + 1}${candidate.adopted ? ' · 已采用' : ''}` }))} />
        )}
        {current && <CandidateReviewPanel key={current.id} activityId={activityId} candidateId={current.id} onApplied={onApplied} />}
      </div>
    </Dialog>
  );
}
