'use client';
import type { ActivityPlanningSessionResponse } from '@sthstart/contracts';
import { GapCollectionDialog, RecommendationDialog, ReferenceUpdateDialog, type AssistantSelection } from '@/app/features/knowledge/components/reference-assistant';
import { KnowledgePicker } from '@/app/features/knowledge/components/knowledge-picker';
import { authorshipLabels, natureLabels } from '@/app/features/notebook/schemas';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import type { IntakeForm, ReferencePreviewState } from '../types';

export interface PlanningReferenceDialogsProps {
  session: ActivityPlanningSessionResponse | null;
  sessionId: string | null;
  intake: IntakeForm;
  recommendOpen: boolean;
  setRecommendOpen: (open: boolean) => void;
  updateCheckOpen: boolean;
  setUpdateCheckOpen: (open: boolean) => void;
  gapOpen: boolean;
  setGapOpen: (open: boolean) => void;
  referencePickerOpen: boolean;
  setReferencePickerOpen: (open: boolean) => void;
  referencePreview: ReferencePreviewState | null;
  setReferencePreview: (value: ReferencePreviewState | null) => void;
  onAddAssistantReferences: (items: AssistantSelection[]) => void;
  onAddReferences: (items: Array<{ item: import('@sthstart/contracts').KnowledgeSearchItem; usage: import('@sthstart/contracts').PlanningReferenceUsage }>) => Promise<void>;
  onPinOldReference: (referenceId: string, excerpt: string) => void;
  onRefreshReference: (referenceId: string, currentSourceId?: string) => Promise<void>;
}

export function PlanningReferenceDialogs({
  session,
  sessionId,
  intake,
  recommendOpen,
  setRecommendOpen,
  updateCheckOpen,
  setUpdateCheckOpen,
  gapOpen,
  setGapOpen,
  referencePickerOpen,
  setReferencePickerOpen,
  referencePreview,
  setReferencePreview,
  onAddAssistantReferences,
  onAddReferences,
  onPinOldReference,
  onRefreshReference,
}: PlanningReferenceDialogsProps) {
  return (
    <>
      <RecommendationDialog
        open={recommendOpen}
        onOpenChange={setRecommendOpen}
        works={session?.session.form.crossoverWorks ?? []}
        characters={intake.cast.map((member) => member.displayName)}
        theme={intake.theme}
        onAdd={onAddAssistantReferences}
      />

      <ReferenceUpdateDialog
        open={updateCheckOpen}
        onOpenChange={setUpdateCheckOpen}
        snapshot={session?.session.form.knowledgeSnapshot ?? null}
        onPinOld={onPinOldReference}
        onRefresh={onRefreshReference}
      />

      <GapCollectionDialog
        open={gapOpen}
        onOpenChange={setGapOpen}
        sessionId={sessionId ?? ''}
        works={session?.session.form.crossoverWorks ?? []}
        characters={intake.cast.map((member) => member.displayName)}
        theme={intake.theme}
        onAdd={onAddAssistantReferences}
      />
      <KnowledgePicker
        open={referencePickerOpen}
        onOpenChange={setReferencePickerOpen}
        onAdd={onAddReferences}
      />

      <Dialog
        open={Boolean(referencePreview)}
        onOpenChange={(open) => { if (!open) setReferencePreview(null); }}
        title="本次引用"
        description="下面就是生成时会送给模型的内容；超出预算的部分已截断。"
        className="max-w-3xl"
        footer={<Button variant="outline" onClick={() => setReferencePreview(null)}>关闭</Button>}
      >
        {referencePreview && (
          <div className="space-y-3 text-sm">
            {referencePreview.truncated && <Alert variant="warning" title="内容已截取">部分引用超出长度预算，已按预算截断；如需完整内容请减少引用条数。</Alert>}
            {!!referencePreview.unresolved.length && (
              <Alert variant="warning" title="部分来源未匹配">
                {referencePreview.unresolved.map((item) => item.reason).join('；')}。这些来源不会进入本次生成。
              </Alert>
            )}
            {!referencePreview.snapshot.references.length && <p className="text-muted">没有任何可用的引用内容。</p>}
            <ul className="space-y-2">
              {referencePreview.snapshot.references.map((item) => (
                <li key={item.id} className="space-y-1 rounded-lg border border-border-subtle p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong className="text-sm text-ink">{item.title}</strong>
                    <Badge variant="outline" className="text-xs">{item.usage === 'requirement' ? '本次要求' : '背景参考'}</Badge>
                    <Badge variant="secondary" className="text-xs">{natureLabels[item.nature as keyof typeof natureLabels] ?? item.nature}</Badge>
                    <span className="text-xs text-muted">{authorshipLabels[item.authorship as keyof typeof authorshipLabels] ?? item.authorship}</span>
                    {item.truncated && <Badge variant="warning" className="text-xs">已截取</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-muted">{item.excerpt.slice(0, 600)}{item.excerpt.length > 600 ? '…' : ''}</p>
                  {!!item.evidence.length && (
                    <p className="text-xs text-muted">来源：{item.evidence.map((evidence) => evidence.title).join('、')}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
    </>
  );
}
