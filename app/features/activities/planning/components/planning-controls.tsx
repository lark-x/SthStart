'use client';
import { ArrowLeft, ArrowRight, Check, Search, Trash2, X } from 'lucide-react';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { Input } from '@/app/components/ui/input';
import { Spinner } from '@/app/components/ui/spinner';
import { statusLabel } from '../research-model';
import { STEPS, type CandidateStatus, type CustomCastMember, type StepIndex } from '../types';

const BASIS_LABEL: Record<string, string> = { documented: '资料支持', inferred: '资料推测', creative: '联动建议' };
const BASIS_CLASS: Record<string, string> = {
  documented: 'bg-green-50 text-green-700 border-green-200',
  inferred: 'bg-amber-50 text-amber-800 border-amber-200',
  creative: 'bg-accent/10 text-accent-dark border-accent/30',
};

/** 候选的三态处理：必选 / 可选 / 排除。 */
export function StatusToggle({ value, onChange, lockedLabel }: {
  value: CandidateStatus;
  onChange: (next: CandidateStatus) => void;
  lockedLabel?: string;
}) {
  if (lockedLabel) return <Badge variant="accent" className="text-xs">{lockedLabel}</Badge>;
  return (
    <div role="radiogroup" aria-label="候选处理方式" className="flex flex-wrap gap-1">
      {(['required', 'optional', 'excluded'] as CandidateStatus[]).map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant="outline"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={'h-auto min-h-0 px-2 py-1 text-xs font-normal ' +
            (value === option
              ? option === 'excluded' ? 'border-danger bg-danger/10 text-danger-fg hover:bg-danger/15' : 'border-accent bg-accent/10 text-accent-dark hover:bg-accent/15'
              : 'border-border-default bg-transparent text-muted hover:bg-surface-hover')}
        >
          {statusLabel(option)}
        </Button>
      ))}
    </div>
  );
}

export function BasisBadge({ basis }: { basis: string }) {
  return <Badge variant="outline" className={'text-xs ' + (BASIS_CLASS[basis] || '')}>{BASIS_LABEL[basis] || basis}</Badge>;
}

/**
 * 自定义参与者编辑器。第一步与第二步都会用到：页头的「从空白开始」在任何一步都能点，
 * 所以添加自定义参与者的入口不能只放在第二步。
 */
export function CustomCastEditor({ members, onChange }: {
  members: CustomCastMember[];
  onChange: (next: CustomCastMember[]) => void;
}) {
  if (!members.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-muted/40 p-3">
      <p className="text-xs text-muted">
        自定义参与者只在本场活动出现，不会写入角色库。它们没有角色库人设，
        因此不能用于「查资料并推荐」或「生成方案」，只能配合页头的「从空白开始」创建。
      </p>
      {members.map((member, index) => (
        <div key={member.key} className="space-y-2 rounded-lg border border-border-subtle bg-surface p-2">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`自定义参与者 ${index + 1} 名称`}
              value={member.displayName}
              placeholder="角色名称"
              onChange={(event) => onChange(members.map((item) => item.key === member.key ? { ...item, displayName: event.target.value } : item))}
              className="h-8 text-sm"
            />
            <Input
              aria-label={`自定义参与者 ${index + 1} 本场职责`}
              value={member.activityRole}
              placeholder="本场职责"
              onChange={(event) => onChange(members.map((item) => item.key === member.key ? { ...item, activityRole: event.target.value } : item))}
              className="h-8 w-32 text-sm"
            />
            <IconButton
              icon={Trash2}
              label={`移除自定义参与者 ${index + 1}`}
              size="icon"
              className="size-9 shrink-0 text-fg-subtle hover:text-danger-fg lg:size-8"
              iconClassName="h-3.5 w-3.5"
              onClick={() => onChange(members.filter((item) => item.key !== member.key))}
            />
          </div>
          <Input
            aria-label={`自定义参与者 ${index + 1} 身份描述`}
            value={member.identity}
            placeholder="身份描述（会作为人设交给模型）"
            onChange={(event) => onChange(members.map((item) => item.key === member.key ? { ...item, identity: event.target.value } : item))}
            className="h-8 text-sm"
          />
        </div>
      ))}
    </div>
  );
}

export function PlanningStepNav({
  step,
  setStep,
  done,
  generating,
  researching,
}: {
  step: StepIndex;
  setStep: (step: StepIndex) => void;
  done: (index: number) => boolean;
  generating: boolean;
  researching: boolean;
}) {
  return (
    <nav aria-label="企划步骤" className="flex flex-wrap items-center gap-2">
      {STEPS.map((label, index) => {
        const value = index as StepIndex;
        const reachable = value <= step || done(value);
        return (
          <Button
            key={label}
            type="button"
            size="sm"
            variant="outline"
            disabled={!reachable || generating || researching}
            aria-current={step === value ? 'step' : undefined}
            onClick={() => { if (reachable) setStep(value); }}
            className={'min-h-9 h-auto gap-2 px-3 py-1 text-sm font-normal ' +
              (step === value ? 'border-accent bg-accent/10 font-semibold text-accent-dark hover:bg-accent/15'
                : reachable ? 'border-border-default bg-transparent text-muted hover:bg-surface-hover' : 'border-border-subtle bg-transparent text-fg-subtle opacity-60')}
          >
            <span className={'flex h-5 w-5 items-center justify-center rounded-full bg-surface text-xs ' + (done(value) && step !== value ? 'bg-green-100 text-green-700' : '')}>
              {done(value) && step !== value ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            {label}
          </Button>
        );
      })}
    </nav>
  );
}

export function PlanningFooter({
  step,
  setStep,
  busy,
  generating,
  researching,
  researchLabel,
  sessionId,
  hasCast,
  selectedPlanId,
  selectedCandidate,
  pendingActorCount,
  onCancelResearch,
  onSkipResearch,
  onStartResearch,
  onGeneratePlans,
  onCreateActivity,
}: {
  step: StepIndex;
  setStep: (step: StepIndex) => void;
  busy: boolean;
  generating: boolean;
  researching: boolean;
  researchLabel?: string;
  sessionId: string | null;
  hasCast: boolean;
  selectedPlanId: string | null;
  selectedCandidate: unknown;
  pendingActorCount: number;
  onCancelResearch: () => void;
  onSkipResearch: () => void;
  onStartResearch: () => void;
  onGeneratePlans: () => void;
  onCreateActivity: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-border-subtle bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-xs text-muted">
          {researching ? <span className="flex items-center gap-1.5 text-amber-800"><Spinner size="sm" label="" />{researchLabel || '正在检索资料…'}</span>
            : generating ? <span className="flex items-center gap-1.5 text-amber-800"><Spinner size="sm" label="" />正在生成方案…</span>
              : sessionId ? '企划会话 ' + sessionId.slice(0, 8) + '（刷新页面后仍可继续）' : '还没有企划会话'}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {researching && <Button size="sm" variant="ghost" disabled={busy} onClick={onCancelResearch}><X className="h-3.5 w-3.5" />取消检索</Button>}
          {step > 0 && <Button size="sm" variant="outline" disabled={generating || researching} onClick={() => setStep((step - 1) as StepIndex)}><ArrowLeft className="h-3.5 w-3.5" />上一步</Button>}
          {step === 0 && <Button size="sm" variant="outline" disabled={busy || researching} onClick={onSkipResearch}>跳过检索，直接构思<ArrowRight className="h-3.5 w-3.5" /></Button>}
          {step === 0 && <Button size="sm" variant="primary" disabled={busy || researching || !hasCast} onClick={onStartResearch}>{researching ? '正在检索…' : '查资料并推荐'}<Search className="h-3.5 w-3.5" /></Button>}
          {step === 1 && <Button size="sm" variant="primary" disabled={generating || researching || !hasCast} onClick={onGeneratePlans}>{generating ? '正在生成…' : '根据候选生成方案'}</Button>}
          {step === 2 && <Button size="sm" variant="primary" disabled={!selectedPlanId} onClick={() => setStep(3)}>采用该方案并继续<ArrowRight className="h-3.5 w-3.5" /></Button>}
          {step === 3 && <Button size="sm" variant="primary" disabled={busy || !selectedCandidate || pendingActorCount > 0} onClick={onCreateActivity}>创建活动</Button>}
        </div>
      </div>
    </div>
  );
}
