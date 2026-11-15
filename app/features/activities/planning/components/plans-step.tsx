'use client';
import { ChevronDown, FileText, RefreshCw } from 'lucide-react';
import type {
  ActivityPlanningCandidate,
  ActivityPlanningOutput,
  PlanningCandidateSummary,
  PlanningKnowledgeReference,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { natureLabels } from '@/app/features/notebook/schemas';
import { basisFor, type PlanOverride } from '../plan-model';

export interface PlanningPlansStepProps {
  plans: ActivityPlanningCandidate[];
  summaries: PlanningCandidateSummary[];
  planOverride: PlanOverride | null;
  selectedPlanId: string | null;
  setSelectedPlanId: (id: string) => void;
  expandedPlanId: string | null;
  setExpandedPlanId: (id: string | null) => void;
  revisionNote: string;
  setRevisionNote: (note: string) => void;
  generating: boolean;
  onGenerateAnother: () => void;
  onOpenPlanEditor: () => void;
  actorName: (actorId: string) => string;
  snapshotReferences: PlanningKnowledgeReference[];
}

export function PlanningPlansStep({
  plans,
  summaries,
  planOverride,
  selectedPlanId,
  setSelectedPlanId,
  expandedPlanId,
  setExpandedPlanId,
  revisionNote,
  setRevisionNote,
  generating,
  onGenerateAnother,
  onOpenPlanEditor,
  actorName,
  snapshotReferences,
}: PlanningPlansStepProps) {
  const summaryFor = (candidate: ActivityPlanningCandidate): PlanningCandidateSummary | null => (
    summaries.find((summary) => summary.id === candidate.id) ?? null
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">共 {plans.length} 份方案。可以选择、编辑、展开时间线，或带着修改意见再生成一份。</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="修改意见" className="h-9 w-56 text-sm" placeholder="修改意见（用于重新生成）" value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} />
          <Button size="sm" variant="outline" disabled={generating} onClick={onGenerateAnother}><RefreshCw className="h-3.5 w-3.5" />重生成一份</Button>
        </div>
      </div>
      {!plans.length && <Alert variant="info">还没有方案：请回到上一步点击「根据候选生成方案」。</Alert>}
      <div className="grid gap-3 lg:grid-cols-3">
        {plans.map((plan) => {
          const summary = summaryFor(plan);
          const payload: ActivityPlanningOutput = planOverride && planOverride.candidateId === plan.id ? planOverride.payload : plan.payload;
          const active = plan.id === selectedPlanId;
          const expanded = expandedPlanId === plan.id;
          return (
            <article key={plan.id} className={'flex flex-col gap-2 rounded-panel border bg-surface p-3 shadow-xs ' + (active ? 'border-accent' : 'border-border-default')}>
              <header className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="min-w-0 flex-1 text-sm font-semibold text-ink">{payload.activity.title || '未命名方案'}</h3>
                  {plan.adopted && <Badge variant="accent" className="text-xs">已采用</Badge>}
                  {summary?.stale && <Badge variant="warning" className="text-xs">基于旧设置</Badge>}
                </div>
                <p className="text-xs text-muted">{payload.activity.overview}</p>
              </header>
              <dl className="space-y-0.5 text-xs text-muted">
                <div><dt className="inline font-medium text-ink">风格：</dt><dd className="inline">{summary?.style || payload.activity.theme || '—'}</dd></div>
                <div><dt className="inline font-medium text-ink">主要地点：</dt><dd className="inline">{summary?.primaryLocation || payload.activity.location || '—'}</dd></div>
                <div><dt className="inline font-medium text-ink">阶段数：</dt><dd className="inline">{summary?.stageCount ?? payload.stages.length}</dd></div>
                <div><dt className="inline font-medium text-ink">待补人设：</dt><dd className="inline">{summary?.pendingPersonaCount ?? 0}</dd></div>
              </dl>
              {!!(summary?.participants?.length ?? payload.actorRoles.length) && (
                <p className="text-xs text-muted">参与者：{(summary?.participants ?? payload.actorRoles.map((role) => actorName(role.actorId))).join('、')}</p>
              )}
              {!!summary?.highlights?.length && (
                <ul className="space-y-0.5 text-xs text-muted">
                  {summary.highlights.map((highlight) => <li key={highlight}>· {highlight}</li>)}
                </ul>
              )}
              {/* 主要依据：只展示本次真实存在且被方案引用的资料。 */}
              {(() => {
                const basis = basisFor(payload, snapshotReferences);
                if (!basis.length) {
                  return snapshotReferences.length
                    ? <p className="text-xs text-muted">这份方案没有标注具体依据。</p>
                    : null;
                }
                return (
                  <div className="space-y-0.5 text-xs text-muted">
                    <p className="font-medium text-ink">主要依据</p>
                    {basis.map((item) => (
                      <p key={item.id} className="truncate">
                        · {item.title}
                        <span className="ml-1">{natureLabels[item.nature as keyof typeof natureLabels] ?? item.nature}</span>
                      </p>
                    ))}
                  </div>
                );
              })()}
              {!!summary?.caveats?.length && (
                <ul className="space-y-0.5 text-xs text-amber-700">
                  {summary.caveats.map((caveat) => <li key={caveat}>· {caveat}</li>)}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={active ? 'primary' : 'outline'} onClick={() => setSelectedPlanId(plan.id)}>{active ? '已选择' : '选择此方案'}</Button>
                <Button size="sm" variant="ghost" onClick={() => setExpandedPlanId(expanded ? null : plan.id)}><ChevronDown className={'h-3.5 w-3.5 ' + (expanded ? 'rotate-180' : '')} />{expanded ? '收起' : '展开时间线'}</Button>
                <Button size="sm" variant="ghost" disabled={!active} onClick={onOpenPlanEditor}><FileText className="h-3.5 w-3.5" />编辑</Button>
              </div>
              {expanded && (
                <ol className="space-y-2 border-t border-border-subtle pt-2">
                  {payload.stages.map((stage, index) => (
                    <li key={stage.clientId} className="space-y-1">
                      <p className="text-xs font-semibold text-ink">{index + 1}. {stage.title}{stage.location ? '（' + stage.location + '）' : ''}</p>
                      <p className="text-xs text-muted">{stage.description}</p>
                      <p className="text-xs text-muted">参与：{stage.actorIds.map((id) => actorName(id)).join('、') || '—'}</p>
                      {!!stage.requiredBeats.length && <p className="text-xs text-muted">关键事件：{stage.requiredBeats.join('；')}</p>}
                      {stage.endCondition && <p className="text-xs text-muted">结束条件：{stage.endCondition}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
