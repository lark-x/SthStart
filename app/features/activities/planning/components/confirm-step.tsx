'use client';
import { Check, RefreshCw, Search, Sparkles, Trash2, UserPlus } from 'lucide-react';
import type {
  ActivityPlanningCandidate,
  ActivityPlanningOutput,
  ActivityPlanningPendingActor,
  ActivityPlanningSessionResponse,
  ResearchTask,
} from '@sthstart/contracts';
import { isUnresolvedPlanningActor } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { WorkbenchColumns } from '@/app/components/shared/page-layout';
import { BasisBadge } from './planning-controls';
import type { IntakeForm } from '../types';
import type { PlanOverride } from '../plan-model';

export interface PlanningConfirmStepProps {
  intake: IntakeForm;
  session: ActivityPlanningSessionResponse | null;
  selectedCandidate: ActivityPlanningCandidate | null;
  activePayload: ActivityPlanningOutput | null;
  pendingActors: ActivityPlanningPendingActor[];
  research: ResearchTask | null;
  busy: boolean;
  planOverride: PlanOverride | null;
  llmReady: boolean | null;
  actorName: (actorId: string) => string;
  onRefreshSession: () => void;
  onMatchActor: (actorId: string) => void;
  onImportActor: (actorId: string) => void;
  onOpenPersona: (actorId: string) => void;
  onRemoveActor: (actorId: string) => void;
  onCreateActivity: () => void;
}

export function PlanningConfirmStep({
  intake,
  session,
  selectedCandidate,
  activePayload,
  pendingActors,
  research,
  busy,
  planOverride,
  llmReady,
  actorName,
  onRefreshSession,
  onMatchActor,
  onImportActor,
  onOpenPersona,
  onRemoveActor,
  onCreateActivity,
}: PlanningConfirmStepProps) {
  return (
    <WorkbenchColumns
      left={(
        <>
          <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
            <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Check className="h-4 w-4 text-accent" />最终确认</h3>
            {!selectedCandidate && <Alert variant="warning">请先在「方案对比」中选择一份方案。</Alert>}
            {selectedCandidate && activePayload && (
              <div className="space-y-2 text-sm">
                <p><span className="font-semibold">标题：</span>{activePayload.activity.title}</p>
                <p><span className="font-semibold">主题：</span>{activePayload.activity.theme || '—'}</p>
                <p><span className="font-semibold">地点：</span>{activePayload.activity.location || '—'}</p>
                <p><span className="font-semibold">日期：</span>{intake.scheduledDate || '未排期'}</p>
                <div>
                  <span className="font-semibold">参与名单（{session?.session.document.actors.length ?? 0}）：</span>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {(session?.session.document.actors ?? []).map((actor) => (
                      <li key={actor.id}>
                        {actor.displayName} · {actor.activityRole || '参与者'}
                        {isUnresolvedPlanningActor(actor) ? ' · 待处理人设' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="font-semibold">阶段（{activePayload.stages.length}）：</span>
                  <ol className="mt-1 space-y-1 text-xs text-muted">
                    {activePayload.stages.map((stage, index) => (
                      <li key={stage.clientId}>
                        {index + 1}. {stage.title}（{stage.location || '—'}）· 参与：{stage.actorIds.map((id) => actorName(id)).join('、') || '—'}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><UserPlus className="h-4 w-4 text-accent" />待处理人设（{pendingActors.length}）</h3>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRefreshSession}><RefreshCw className="h-3.5 w-3.5" />重新读取企划</Button>
            </div>
            {!pendingActors.length && <p className="text-sm text-muted">没有待处理人设，方案里的人都有对应的本地角色快照。</p>}
            <ul className="space-y-2">
              {pendingActors.map((actor) => {
                const candidate = research?.characterCandidates.find((item) => item.id === actor.candidateRefId);
                return (
                  <li key={actor.actorId} className="space-y-2 rounded-lg border border-border-subtle p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-ink">{actor.displayName}</span>
                      {actor.work && <span className="text-xs text-muted">《{actor.work}》</span>}
                      {actor.basis && <BasisBadge basis={actor.basis} />}
                      <Badge variant="outline" className="text-xs">{actor.activityRole || '受邀参与者'}</Badge>
                    </div>
                    {actor.relationshipToLead && <p className="text-xs text-muted">关系依据：{actor.relationshipToLead}</p>}
                    <p className="text-xs text-muted">
                      出现在 {actor.affectedStageIds.length} 个阶段：
                      {actor.affectedStageIds.map((id) => {
                        const index = activePayload?.stages.findIndex((stage) => stage.clientId === id) ?? -1;
                        return index >= 0 ? '第 ' + (index + 1) + ' 阶段' : id;
                      }).join('、') || '—'}
                    </p>
                    {candidate?.localMatchStatus === 'multiple' && (
                      <Alert variant="warning" title="角色库中有多张同名卡">请手动选定要匹配的角色，系统不会自动挑选。</Alert>
                    )}
                    {!candidate && <p className="text-xs text-muted">该角色来自本地方案编辑，没有关联研究候选。</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onMatchActor(actor.actorId)}><Search className="h-3.5 w-3.5" />匹配已有角色</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onImportActor(actor.actorId)}><UserPlus className="h-3.5 w-3.5" />导入角色卡</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onOpenPersona(actor.actorId)}><Sparkles className="h-3.5 w-3.5" />补齐人设并入库</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemoveActor(actor.actorId)}><Trash2 className="h-3.5 w-3.5" />从企划移除</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
      right={(
        <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
          <h3 className="text-base font-semibold text-ink">创建前检查</h3>
          <ul className="space-y-1 text-xs text-muted">
            <li>{selectedCandidate ? '已选择方案：' + (activePayload?.activity.title || '未命名') : '尚未选择方案'}</li>
            <li>{pendingActors.length ? '还有 ' + pendingActors.length + ' 位人物待匹配或补齐人设' : '所有人物都已匹配本地角色'}</li>
            <li>{activePayload && activePayload.stages.length >= 2 ? '阶段数满足要求' : '需要至少两个阶段'}</li>
            <li>{intake.scheduledDate ? '将出现在 ' + intake.scheduledDate + ' 的角色日历' : '未填写日期，创建后可在活动内补充'}</li>
            {planOverride && <li>已在页面内编辑过方案内容，创建时会使用编辑后的版本。</li>}
          </ul>
          {!!pendingActors.length && <Alert variant="warning" title="暂时无法创建">待处理人设完成后才能创建活动，这样活动里的人都有真实的人设快照。</Alert>}
          {llmReady === false && <Alert variant="warning" title="文本模型未就绪">创建活动不需要模型，但后续生成内容需要。</Alert>}
          <Button variant="primary" disabled={busy || !selectedCandidate || !!pendingActors.length} onClick={onCreateActivity}>
            {busy ? '正在创建…' : '创建活动'}
          </Button>
        </section>
      )}
    />
  );
}
