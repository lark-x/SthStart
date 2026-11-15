'use client';
import type React from 'react';
import Image from 'next/image';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { WorkbenchColumns } from '@/app/components/shared/page-layout';
import { FileText, Lock, MapPin, Plus, Trash2, UserPlus, Wand2, X } from 'lucide-react';
import type { ActivityPlanningJob, ResearchCharacterCandidate, ResearchTask } from '@sthstart/contracts';
import { createCustomCastMember } from '../intake-model';
import { isTerminalResearch, normalizedCandidateStatus } from '../research-model';
import type { CandidateStatus, CustomCastMember, CustomLocation, IntakeForm } from '../types';
import { BasisBadge, CustomCastEditor, StatusToggle } from './planning-controls';

export interface PlanningCandidatesStepProps {
  intake: IntakeForm;
  setIntake: React.Dispatch<React.SetStateAction<IntakeForm>>;
  customCast: CustomCastMember[];
  setCustomCast: React.Dispatch<React.SetStateAction<CustomCastMember[]>>;
  maxActors: number;
  tab: 'characters' | 'locations';
  setTab: (tab: 'characters' | 'locations') => void;
  onOpenCastPicker: () => void;
  research: ResearchTask | null;
  leadName: string;
  onCandidateStatus: (candidateId: string, status: CandidateStatus) => void;
  onLocationStatus: (candidateId: string, status: CandidateStatus) => void;
  onLockLocation: (candidateId: string) => void;
  onEvidence: (candidate: ResearchCharacterCandidate) => void;
  customLocations: CustomLocation[];
  setCustomLocations: React.Dispatch<React.SetStateAction<CustomLocation[]>>;
  customForm: { name: string; note: string };
  setCustomForm: React.Dispatch<React.SetStateAction<{ name: string; note: string }>>;
  planCount: number;
  setPlanCount: (count: number) => void;
  generating: boolean;
  job: ActivityPlanningJob | null;
  runningJob: boolean;
  hasSession: boolean;
  researchStale: boolean;
  llmReady: boolean | null;
  lockedLocationName: string | null;
  onGenerate: () => void;
  onCancelGeneration: () => void;
  mcpSettingsHref: string;
}

export function PlanningCandidatesStep({
  intake,
  setIntake,
  customCast,
  setCustomCast,
  maxActors,
  tab,
  setTab,
  onOpenCastPicker,
  research,
  leadName,
  onCandidateStatus,
  onLocationStatus,
  onLockLocation,
  onEvidence,
  customLocations,
  setCustomLocations,
  customForm,
  setCustomForm,
  planCount,
  setPlanCount,
  generating,
  job,
  runningJob,
  hasSession,
  researchStale,
  llmReady,
  lockedLocationName,
  onGenerate,
  onCancelGeneration,
  mcpSettingsHref,
}: PlanningCandidatesStepProps) {
  return (
    <WorkbenchColumns
      left={(
        <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
          <PageTabs
            ariaLabel="人物与地点"
            value={tab}
            onChange={(value) => setTab(value === 'locations' ? 'locations' : 'characters')}
            tabs={[
              { id: 'characters', label: '人物', count: research ? research.characterCandidates.length : intake.cast.length },
              { id: 'locations', label: '地点', count: research ? research.locationCandidates.length : 0 },
            ]}
          />

          {tab === 'characters' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-ink">已选参与角色（{intake.cast.length}）</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={onOpenCastPicker}><UserPlus className="h-3.5 w-3.5" />从角色库添加</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={intake.cast.length + customCast.length >= maxActors}
                      onClick={() => setCustomCast((current) => [...current, createCustomCastMember(current.length)])}
                    ><Plus className="h-3.5 w-3.5" />添加自定义参与者</Button>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {intake.cast.map((member) => (
                    <li key={member.characterId} className="flex items-center gap-2 rounded-lg border border-border-subtle p-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                      {member.characterId === intake.leadCharacterId
                        ? <Badge variant="accent" className="text-xs">主角 · 固定必选</Badge>
                        : <Badge variant="outline" className="text-xs">必选</Badge>}
                      {member.characterId !== intake.leadCharacterId && (
                        <IconButton icon={Trash2} label={'移除 ' + member.displayName} size="icon" className="size-9 shrink-0 text-fg-subtle hover:text-danger-fg lg:size-8" iconClassName="h-3.5 w-3.5" onClick={() => setIntake((current) => ({ ...current, cast: current.cast.filter((item) => item.characterId !== member.characterId) }))} />
                      )}
                    </li>
                  ))}
                </ul>

                <CustomCastEditor members={customCast} onChange={setCustomCast} />
              </div>

              <div className="space-y-2 border-t border-border-subtle pt-3">
                <h4 className="text-sm font-semibold text-ink">检索推荐人物</h4>
                {!research && <p className="text-sm text-muted">本次没有发起资料检索，将只使用已选角色生成方案；可以返回上一步补充检索。</p>}
                {research?.status === 'running' && <Spinner size="sm" label={research.progressLabel || '正在检索资料…'} />}
                {research?.status === 'failed' && <Alert variant="warning" title="资料检索失败">{research.errorMessage || '未知原因'}。仍可用已选角色继续。</Alert>}
                {research?.status === 'incomplete' && <Alert variant="warning" title="资料检索未完成">{research.incompleteReason || '已达到检索预算'}，下面只列出已取得的候选。</Alert>}
                {research && !research.characterCandidates.length && isTerminalResearch(research.status) && <p className="text-sm text-muted">没有检索到可推荐的人物候选。</p>}
                <ul className="space-y-2">
                  {(research?.characterCandidates ?? []).map((candidate) => {
                    const status = normalizedCandidateStatus(candidate.userStatus);
                    const isLead = Boolean(leadName) && candidate.displayName === leadName;
                    return (
                      <li key={candidate.id} className="space-y-2 rounded-lg border border-border-subtle p-3">
                        <div className="flex items-start gap-3">
                          <div className="relative flex h-11 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-hover text-sm font-semibold">
                            {candidate.avatarUrl ? <Image src={candidate.avatarUrl} alt="" fill unoptimized className="object-cover" /> : candidate.displayName.slice(0, 1)}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-ink">{candidate.displayName}</span>
                              {candidate.work && <span className="truncate text-xs text-muted">《{candidate.work}》</span>}
                              <BasisBadge basis={candidate.basis} />
                              {candidate.localMatchStatus === 'unique' && <Badge variant="outline" className="text-xs">角色库已有</Badge>}
                              {candidate.localMatchStatus === 'multiple' && <Badge variant="warning" className="text-xs">角色库有 {candidate.localCharacterIds?.length ?? 2} 张同名卡</Badge>}
                              {candidate.localMatchStatus === 'none' && <Badge variant="outline" className="text-xs">尚未入库</Badge>}
                            </div>
                            <p className="text-xs text-muted">推荐原因：{candidate.reason}</p>
                            {candidate.relationshipToLead && <p className="text-xs text-muted">关系依据：{candidate.relationshipToLead}</p>}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StatusToggle
                            value={status}
                            lockedLabel={isLead ? '主角 · 固定必选' : undefined}
                            onChange={(next) => onCandidateStatus(candidate.id, next)}
                          />
                          {!!candidate.evidenceIds.length && (
                            <Button size="sm" variant="ghost" onClick={() => onEvidence(candidate)}><FileText className="h-3.5 w-3.5" />查看依据（{candidate.evidenceIds.length}）</Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {tab === 'locations' && (
            <div className="space-y-3">
              {!research && <p className="text-sm text-muted">本次没有检索到地点候选，可以自行填写活动地点。</p>}
              <ul className="space-y-2">
                {(research?.locationCandidates ?? []).map((candidate) => {
                  const status = normalizedCandidateStatus(candidate.userStatus);
                  return (
                    <li key={candidate.id} className="space-y-2 rounded-lg border border-border-subtle p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-ink">{candidate.name}</span>
                        {candidate.work && <span className="text-xs text-muted">《{candidate.work}》</span>}
                        <BasisBadge basis={candidate.basis} />
                        {candidate.locked && <Badge variant="accent" className="text-xs">主要地点</Badge>}
                      </div>
                      {candidate.environment && <p className="text-xs text-muted">环境：{candidate.environment}</p>}
                      {candidate.reasonForActivity && <p className="text-xs text-muted">适合理由：{candidate.reasonForActivity}</p>}
                      <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                        <p><span className="font-medium text-ink">原作依据：</span>{candidate.originalBasis || '—'}</p>
                        <p><span className="font-medium text-ink">本次安排：</span>{candidate.activityArrangement || '—'}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusToggle value={status} onChange={(next) => onLocationStatus(candidate.id, next)} />
                        <Button size="sm" variant={candidate.locked ? 'primary' : 'outline'} onClick={() => onLockLocation(candidate.id)}>
                          <Lock className="h-3.5 w-3.5" />{candidate.locked ? '取消主要地点' : '设为主要地点'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="space-y-2 rounded-lg border border-dashed border-border-default p-3">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-ink"><MapPin className="h-4 w-4 text-accent" />自行填写地点</h4>
                {!!customLocations.length && (
                  <ul className="space-y-2">
                    {customLocations.map((location) => (
                      <li key={location.id} className="space-y-2 rounded-lg border border-border-subtle p-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink">{location.name}</span>
                          <Badge variant="outline" className="text-xs">用户设定</Badge>
                          {location.locked && <Badge variant="accent" className="text-xs">主要地点</Badge>}
                        </div>
                        {location.note && <p className="text-xs text-muted">{location.note}</p>}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StatusToggle value={location.status} onChange={(next) => setCustomLocations((current) => current.map((item) => item.id === location.id ? { ...item, status: next } : item))} />
                          <div className="flex gap-2">
                            <Button size="sm" variant={location.locked ? 'primary' : 'outline'} onClick={() => onLockLocation(location.id)}><Lock className="h-3.5 w-3.5" />{location.locked ? '取消主要地点' : '设为主要地点'}</Button>
                            <IconButton icon={Trash2} label={'删除 ' + location.name} size="icon" className="size-9 shrink-0 text-fg-subtle hover:text-danger-fg lg:size-8" iconClassName="h-3.5 w-3.5" onClick={() => setCustomLocations((current) => current.filter((item) => item.id !== location.id))} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label="自定义地点名称" placeholder="地点名称" value={customForm.name} onChange={(event) => setCustomForm((current) => ({ ...current, name: event.target.value }))} />
                  <Input aria-label="自定义地点说明" placeholder="说明（可选）" value={customForm.note} onChange={(event) => setCustomForm((current) => ({ ...current, note: event.target.value }))} />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!customForm.name.trim() || customLocations.length >= 5}
                  onClick={() => {
                    const name = customForm.name.trim().slice(0, 60);
                    if (!name) return;
                    setCustomLocations((current) => [...current, { id: 'user_loc_' + crypto.randomUUID(), name, note: customForm.note.trim().slice(0, 300), status: 'optional', locked: false }]);
                    setCustomForm({ name: '', note: '' });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />添加地点
                </Button>
                <p className="text-xs text-muted">自填地点会标记为「用户设定」，最多 5 个；主要地点只能有一个。生成方案时会一并保存。</p>
              </div>
            </div>
          )}
        </section>
      )}
      right={(
        <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Wand2 className="h-4 w-4 text-accent" />生成方案</h3>
          <p className="text-xs text-muted">必选的人物会进入方案，排除的候选不会被使用；设为「主要地点」的会作为方案首选场地。</p>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">生成数量</span>
            <Select aria-label="生成方案数量" value={String(planCount)} onChange={(event) => setPlanCount(Number(event.target.value))}>
              <option value="1">1 份</option>
              <option value="2">2 份</option>
              <option value="3">3 份（推荐）</option>
            </Select>
          </label>
          <div className="space-y-1 text-xs text-muted">
            <p>已选参与角色：{intake.cast.length} 位</p>
            <p>推荐必选：{(research?.characterCandidates ?? []).filter((candidate) => candidate.userStatus === 'required').length} 位</p>
            <p>推荐排除：{(research?.characterCandidates ?? []).filter((candidate) => candidate.userStatus === 'excluded').length} 位</p>
            <p>地点候选：{research?.locationCandidates.length ?? 0} 个（含自填 {customLocations.length} 个）</p>
            {lockedLocationName && <p>主要地点：{lockedLocationName}</p>}
          </div>
          {llmReady === false && <Alert variant="warning" title="文本模型未就绪">请先前往 <a className="underline" href={mcpSettingsHref} target="_blank" rel="noreferrer">公共服务配置</a> 绑定文本模型。</Alert>}
          {researchStale && <Alert variant="warning" title="研究输入已过期">活动意图在研究之后有改动，生成的方案会标记为「基于旧设置」。</Alert>}
          <Button variant="primary" disabled={generating || !intake.cast.length} onClick={onGenerate}>
            {generating ? <><Spinner size="sm" label="" className="text-white" />正在生成…</> : <><Wand2 className="h-3.5 w-3.5" />根据候选生成方案</>}
          </Button>
          {generating && job && <p className="text-xs text-muted">任务状态：{job.status === 'queued' ? '排队中' : '生成中'}…</p>}
          {runningJob && hasSession && job && (
            <Button size="sm" variant="ghost" onClick={onCancelGeneration}><X className="h-3.5 w-3.5" />取消生成</Button>
          )}
        </section>
      )}
    />
  );
}
