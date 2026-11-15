'use client';
import type { ActivityIdea, ActivityIdeaBatch } from '@sthstart/contracts';
import { InspirationPicker } from '@/app/features/topics/components/inspiration-picker';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import type { IntakeForm } from '../types';

export function PlanningIdeaDialogs({
  intake,
  busy,
  inspirationOpen,
  setInspirationOpen,
  pendingIdea,
  setPendingIdea,
  replaceFields,
  setReplaceFields,
  onAdopt,
}: {
  intake: IntakeForm;
  busy: boolean;
  inspirationOpen: boolean;
  setInspirationOpen: (open: boolean) => void;
  pendingIdea: { batch: ActivityIdeaBatch; idea: ActivityIdea } | null;
  setPendingIdea: (idea: { batch: ActivityIdeaBatch; idea: ActivityIdea } | null) => void;
  replaceFields: boolean;
  setReplaceFields: (value: boolean) => void;
  onAdopt: (batch: ActivityIdeaBatch, idea: ActivityIdea, replaceFields: boolean) => void;
}) {
  return (
    <>
      <InspirationPicker
        open={inspirationOpen}
        onOpenChange={setInspirationOpen}
        activityType={intake.type}
        leadCharacterId={intake.leadCharacterId || intake.cast[0]?.characterId}
        initialRequirement={intake.instruction}
        onPickIdea={(batch, idea) => { setPendingIdea({ batch, idea }); setReplaceFields(false); }}
      />

      <Dialog
        open={Boolean(pendingIdea)}
        onOpenChange={(open) => { if (!open) setPendingIdea(null); }}
        title="应用这个点子"
        description="下面是会填入的内容。已填写的主角与日期不受影响；推荐人物只是候选，不会自动成为参与者。"
        className="max-w-2xl"
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setPendingIdea(null)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => { if (pendingIdea) onAdopt(pendingIdea.batch, pendingIdea.idea, replaceFields); }}>
              {busy ? '正在应用…' : replaceFields ? '替换标题与主题并应用' : '应用这个点子'}
            </Button>
          </div>
        )}
      >
        {pendingIdea && (
          <div className="space-y-3 text-sm">
            <p><span className="font-semibold">点子：</span>{pendingIdea.idea.name}</p>
            <div className="space-y-1 rounded-lg border border-border-subtle p-3 text-xs">
              <p><span className="font-semibold text-ink">标题：</span>{replaceFields ? pendingIdea.idea.name : (intake.title || pendingIdea.idea.name + '（将填入）')}</p>
              <p><span className="font-semibold text-ink">主题：</span>{replaceFields ? pendingIdea.idea.overview : (intake.theme || pendingIdea.idea.overview + '（将填入）')}</p>
              <p><span className="font-semibold text-ink">地点：</span>{replaceFields ? (pendingIdea.idea.location || '未指定') : (intake.location || pendingIdea.idea.location || '未指定')}</p>
              <p><span className="font-semibold text-ink">要求：</span>会追加点子说明，包含改编方式、推荐人物与初步阶段（作为参考，不是正式剧本）。</p>
            </div>
            <Checkbox label="替换标题与主题（不勾选时只填空）" checked={replaceFields} onChange={(event) => setReplaceFields(event.target.checked)} />
            {!!pendingIdea.idea.assumptions.length && (
              <Alert variant="warning" title="以下属于创作建议">{pendingIdea.idea.assumptions.join('；')}</Alert>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
