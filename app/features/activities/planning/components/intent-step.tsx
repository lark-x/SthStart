'use client';
import type React from 'react';
import Image from 'next/image';
import { BookOpen, Compass, ExternalLink, Lightbulb, Link2, Plus, Search, Sparkles, Trash2, Users, X } from 'lucide-react';
import { ACTIVITY_TEMPLATES, findActivityTemplate, suggestRoleMappings } from '@sthstart/contracts';
import type { PlanningReferenceUsage } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { IconButton } from '@/app/components/ui/icon-button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { Textarea } from '@/app/components/ui/textarea';
import { WorkbenchColumns } from '@/app/components/shared/page-layout';
import { natureLabels } from '@/app/features/notebook/schemas';
import { CreationProfilePicker } from '@/app/features/activities/components/creation-profile-picker';
import { TemplateRoleMapping } from '@/app/features/activities/components/template-role-mapping';
import { createCustomCastMember, type PlanningTemplatePreset } from '../intake-model';
import type { CustomCastMember, IntakeForm, ReferenceDraft } from '../types';
import { CustomCastEditor } from './planning-controls';

interface SourceOption { id: string; name: string; purpose?: string; url?: string }

export interface PlanningIntentStepProps {
  intake: IntakeForm;
  setIntake: React.Dispatch<React.SetStateAction<IntakeForm>>;
  setIntakeField: <K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) => void;
  userTemplates: Array<{ id: string; name: string }>;
  userTemplateMap: Map<string, PlanningTemplatePreset>;
  paramsHasSession: boolean;
  hasSession: boolean;
  customCast: CustomCastMember[];
  setCustomCast: React.Dispatch<React.SetStateAction<CustomCastMember[]>>;
  maxActors: number;
  references: ReferenceDraft[];
  onChangeReferenceUsage: (key: string, usage: PlanningReferenceUsage) => void;
  onRemoveReference: (key: string) => void;
  onOpenReferencePicker: () => void;
  onOpenRecommend: () => void;
  onOpenGap: () => void;
  onOpenUpdateCheck: () => void;
  onPreviewReferences: () => void;
  hasKnowledgeSnapshot: boolean;
  busy: boolean;
  onOpenInspiration: () => void;
  enabledSources: SourceOption[];
  sourcesLoading: boolean;
  sourcesError: boolean;
  workOptions: string[];
  toggleWork: (work: string) => void;
  llmReady: boolean | null;
  mcpSettingsHref: string;
  onOpenLeadPicker: () => void;
  onOpenCastPicker: () => void;
}

export function PlanningIntentStep({
  intake,
  setIntake,
  setIntakeField,
  userTemplates,
  userTemplateMap,
  paramsHasSession,
  hasSession,
  customCast,
  setCustomCast,
  maxActors,
  references,
  onChangeReferenceUsage,
  onRemoveReference,
  onOpenReferencePicker,
  onOpenRecommend,
  onOpenGap,
  onOpenUpdateCheck,
  onPreviewReferences,
  hasKnowledgeSnapshot,
  busy,
  onOpenInspiration,
  enabledSources,
  sourcesLoading,
  sourcesError,
  workOptions,
  toggleWork,
  llmReady,
  mcpSettingsHref,
  onOpenLeadPicker,
  onOpenCastPicker,
}: PlanningIntentStepProps) {
  const selectedPreset = userTemplateMap.get(intake.templateId);
  return (
    <WorkbenchColumns
      left={(
        <>
          <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
            <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Compass className="h-4 w-4 text-accent" />活动意图</h3>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted">活动模板</span>
              <Select aria-label="活动模板" value={intake.templateId} onChange={(event) => {
                const selectedId = event.target.value;
                const userPreset = userTemplateMap.get(selectedId);
                if (userPreset) {
                  const payload = (userPreset.payload || {}) as {
                    activityType?: string;
                    theme?: string;
                    location?: string;
                    rules?: string;
                  };
                  setIntake((current) => ({
                    ...current,
                    templateActorMappings: undefined,
                    templateId: userPreset.id,
                    type: payload.activityType || '自定义活动',
                    theme: payload.theme || '',
                    location: payload.location || '',
                    rules: payload.rules || '',
                  }));
                  return;
                }
                const next = findActivityTemplate(selectedId) || findActivityTemplate('blank')!;
                setIntake((current) => ({ ...current, templateId: next.id, type: next.type, theme: next.theme, location: next.location, rules: next.rules }));
              }}>
                <optgroup label="内置模板">
                  {ACTIVITY_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </optgroup>
                {userTemplates.length > 0 && (
                  <optgroup label="我的模板">
                    {userTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </optgroup>
                )}
              </Select>
              <CreationProfilePicker value={intake.creationProfile} allowDefault={!paramsHasSession} onChange={(value) => setIntake((current) => ({
                ...current,
                creationProfile: value,
                instruction: current.instruction === String((current.creationProfile?.values as Record<string, unknown>)?.instruction || '')
                  ? String((value.values as Record<string, unknown>)?.instruction || '')
                  : current.instruction,
              }))} />
              {selectedPreset && <TemplateRoleMapping
                payload={selectedPreset.payload}
                actors={intake.cast.map((actor) => ({ id: actor.characterId, displayName: actor.displayName }))}
                value={intake.templateActorMappings || suggestRoleMappings(
                  selectedPreset.payload,
                  intake.cast.map((actor) => ({ id: actor.characterId })),
                  intake.leadCharacterId,
                )}
                onChange={(value) => setIntakeField('templateActorMappings', value)}
              />}
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-ink">活动标题</span>
                <Input aria-label="活动标题" value={intake.title} onChange={(event) => setIntakeField('title', event.target.value)} placeholder="例如：海边营地烧烤与合照日" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-ink">活动日期（可选）</span>
                <Input aria-label="活动日期" type="date" value={intake.scheduledDate} onChange={(event) => setIntakeField('scheduledDate', event.target.value)} />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-ink">人数偏好</span>
                <Input aria-label="人数偏好" type="number" min={2} max={50} value={intake.guestCountPreference} onChange={(event) => setIntakeField('guestCountPreference', Math.max(2, Math.min(50, Number(event.target.value) || 6)))} />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-ink">活动主题与梗概</span>
                <Input aria-label="活动主题与梗概" value={intake.theme} onChange={(event) => setIntakeField('theme', event.target.value)} placeholder="如：夏日傍晚布置灯串与长桌，共进晚餐并拍照留念" />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-semibold text-ink">活动地点</span>
                <Input aria-label="活动地点" value={intake.location} onChange={(event) => setIntakeField('location', event.target.value)} />
              </label>
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-muted">活动规则与导演约束（可选）</summary>
              <Textarea aria-label="活动规则" value={intake.rules} rows={2} className="mt-2" onChange={(event) => setIntakeField('rules', event.target.value)} />
            </details>
          </section>

          <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Users className="h-4 w-4 text-accent" />主角与参与角色</h3>
                <p className="text-xs text-muted">主角是检索人物关系的锚点；候选人物与地点会在下一步确认。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={onOpenLeadPicker}><Sparkles className="h-3.5 w-3.5" />选择主角</Button>
                <Button size="sm" variant="ghost" onClick={onOpenCastPicker}><Plus className="h-3.5 w-3.5" />添加参与角色</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={intake.cast.length + customCast.length >= maxActors}
                  onClick={() => setCustomCast((current) => [...current, createCustomCastMember(current.length)])}
                ><Plus className="h-3.5 w-3.5" />自定义参与者</Button>
              </div>
            </div>
            {!intake.cast.length && <p className="text-sm text-muted">还没有参与角色，请先从角色库选择主角。</p>}
            <ul className="space-y-1.5">
              {intake.cast.map((member) => (
                <li key={member.characterId} className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface p-2">
                  <div className="relative flex h-9 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-hover text-xs font-semibold text-ink">
                    {member.avatarUrl ? <Image src={member.avatarUrl} alt="" fill unoptimized className="object-cover" /> : member.displayName.slice(0, 1)}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{member.displayName}</span>
                  {member.characterId === intake.leadCharacterId
                    ? <Badge variant="accent" className="text-xs">主角</Badge>
                    : <Button size="sm" variant="ghost" onClick={() => setIntakeField('leadCharacterId', member.characterId)}>设为主角</Button>}
                  {intake.templateId === 'birthday' && (
                    <Checkbox
                      label="寿星"
                      checked={intake.birthdayIds.includes(member.characterId)}
                      onChange={(event) => setIntake((current) => ({
                        ...current,
                        birthdayIds: event.target.checked ? [...new Set([...current.birthdayIds, member.characterId])] : current.birthdayIds.filter((id) => id !== member.characterId),
                      }))}
                    />
                  )}
                  <IconButton icon={Trash2} label={'移除 ' + member.displayName} size="icon" className="size-9 shrink-0 text-fg-subtle hover:text-danger-fg lg:size-8" iconClassName="h-3.5 w-3.5" onClick={() => setIntake((current) => ({
                    ...current,
                    cast: current.cast.filter((item) => item.characterId !== member.characterId),
                    birthdayIds: current.birthdayIds.filter((id) => id !== member.characterId),
                    leadCharacterId: current.leadCharacterId === member.characterId ? '' : current.leadCharacterId,
                  }))} />
                </li>
              ))}
            </ul>
            <CustomCastEditor members={customCast} onChange={setCustomCast} />
          </section>
        </>
      )}
      right={(
        <>
          <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
            <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Sparkles className="h-4 w-4 text-accent" />补充要求</h3>
            <details className="rounded-control bg-surface-muted p-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">参考资料与话题灵感 · {references.length} 项</summary>
              <div className="mt-4 space-y-5">
                {/* 参考资料：手动检索选择，不触发联网；正文由服务端在生成时冻结。 */}
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><BookOpen className="h-4 w-4 text-accent" />参考资料（{references.length}）</h3>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={onOpenReferencePicker}><Plus className="h-3.5 w-3.5" />添加资料</Button>
                      <Button size="sm" variant="outline" onClick={onOpenRecommend} disabled={!intake.cast.length}>推荐资料</Button>
                      <Button size="sm" variant="outline" onClick={onOpenGap} disabled={!hasSession}>补充搜集</Button>
                      <Button size="sm" variant="ghost" onClick={onOpenUpdateCheck} disabled={!hasKnowledgeSnapshot}>检查资料更新</Button>
                      {!!references.length && (
                        <Button size="sm" variant="ghost" onClick={onPreviewReferences}>查看本次引用</Button>
                      )}
                    </div>
                  </div>
                  {!references.length && (
                    <p className="text-xs text-muted">还没有选择资料。可以只写要求交给模型，也可以先挑几篇资料作为依据。</p>
                  )}
                  <ul className="space-y-1.5">
                    {references.map((item) => (
                      <li key={item.key} className="space-y-1 rounded-lg border border-border-subtle p-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.title}</span>
                          <Badge variant="outline" className="text-xs">{item.sourceKind === 'note' ? '资料' : item.sourceKind === 'narrative' ? '叙事档案' : item.sourceKind === 'topic' ? '话题素材' : '搜集来源'}</Badge>
                          {item.nature && <Badge variant="secondary" className="text-xs">{natureLabels[item.nature as keyof typeof natureLabels] ?? item.nature}</Badge>}
                          {item.pinnedExcerpt && <Badge variant="warning" className="text-xs">已固定旧内容</Badge>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            aria-label={'引用用途 ' + item.title}
                            value={item.usage}
                            className="h-7 text-xs"
                            onChange={(event) => onChangeReferenceUsage(item.key, event.target.value as PlanningReferenceUsage)}
                          >
                            <option value="background">背景参考</option>
                            <option value="requirement">本次要求</option>
                          </Select>
                          <IconButton icon={Trash2} label={'移除 ' + item.title} size="icon" className="size-9 shrink-0 text-fg-subtle hover:text-danger-fg lg:size-8" iconClassName="h-3.5 w-3.5" onClick={() => onRemoveReference(item.key)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted">背景参考按原作资料与未确认解释分开提交；「本次要求」优先于资料内容。未选择的资料不会被悄悄加入。</p>
                </section>
                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Lightbulb className="h-4 w-4 text-accent" />从话题素材找灵感</h3>
                  <p className="text-xs text-muted">
                    {intake.cast.length
                      ? '从已搜集的话题素材里选几条让模型给出活动点子，再决定是否采用；不会重新搜集。'
                      : '请先选择主角：采用点子会写入企划会话，需要先有一位参与角色。'}
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy || !intake.cast.length}
                    title={intake.cast.length ? undefined : '请先选择主角'}
                    onClick={onOpenInspiration}
                  >
                    <Lightbulb className="h-3.5 w-3.5" />打开话题素材
                  </Button>
                  {!intake.cast.length && <p className="text-xs text-warning-fg">也可以先去「话题素材库」页面独立挑素材、生成点子。</p>}
                </section>
              </div>
            </details>
            <Textarea
              aria-label="补充要求"
              rows={4}
              value={intake.instruction}
              placeholder="例如：想在天台准备惊喜，希望每位寿星都有单独的祝福环节。"
              onChange={(event) => setIntakeField('instruction', event.target.value)}
            />
            <details>
              <summary className="cursor-pointer text-sm text-muted">剧情范围说明（可选）</summary>
              <label className="mt-2 block space-y-1.5">
                <span className="text-xs font-semibold text-ink">剧情范围说明</span>
                <Textarea aria-label="剧情范围说明" rows={2} value={intake.storyScopeNote} placeholder="如：只使用主线已公开的剧情，不涉及后续章节。" onChange={(event) => setIntakeField('storyScopeNote', event.target.value)} />
              </label>
            </details>
          </section>

          <details className="rounded-control bg-surface-muted p-3">
            <summary className="cursor-pointer text-sm font-medium text-ink">资料检索与联动范围 · {intake.sourceIds.length} 个资料源</summary>
            <div className="mt-4 space-y-5">
              <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Link2 className="h-4 w-4 text-accent" />联动范围</h3>
                  <p className="text-xs text-muted">选择允许联动的作品，检索与人物推荐会限制在这些范围内。</p>
                </div>
                <Checkbox label="不限制作品范围" checked={intake.unrestrictedWorks} onChange={(event) => setIntakeField('unrestrictedWorks', event.target.checked)} />
                {!intake.unrestrictedWorks && (
                  <div className="space-y-2">
                    {workOptions.length ? (
                      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border-subtle p-2">
                        {workOptions.map((work) => (
                          <Checkbox key={work} label={work} checked={intake.crossoverWorks.includes(work)} onChange={() => toggleWork(work)} />
                        ))}
                      </div>
                    ) : <p className="text-xs text-muted">角色库里还没有作品记录，可以直接输入作品名。</p>}
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-ink">添加联动作品</span>
                      <Input
                        placeholder="输入作品名后回车"
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        const value = event.currentTarget.value.trim();
                        if (value && !intake.crossoverWorks.includes(value)) setIntakeField('crossoverWorks', [...intake.crossoverWorks, value]);
                        event.currentTarget.value = '';
                      }}
                      />
                    </label>
                    {!!intake.crossoverWorks.length && (
                      <div className="flex flex-wrap gap-1.5">
                        {intake.crossoverWorks.map((work) => (
                          <Button key={work} type="button" size="sm" variant="ghost" className="h-auto min-h-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-normal text-accent-dark hover:bg-accent/20" onClick={() => toggleWork(work)}>
                            {work}<X className="h-3 w-3" />
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="space-y-3 rounded-panel border border-border-default bg-surface p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Search className="h-4 w-4 text-accent" />资料源</h3>
                  <a href={mcpSettingsHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">配置资料源<ExternalLink className="h-3 w-3" /></a>
                </div>
                {sourcesLoading && <Spinner size="sm" label="正在读取资料源…" />}
                {sourcesError && <p className="text-xs text-warning-fg">暂时无法读取资料源列表；不选择资料源时请使用「跳过检索，直接构思」。</p>}
                {!sourcesLoading && !enabledSources.length && (
                  <p className="text-xs text-muted">还没有启用的资料源。可以先去配置，或跳过检索直接构思。</p>
                )}
                {!!enabledSources.length && (
                  <div className="space-y-1.5">
                    {enabledSources.map((source) => (
                      <Checkbox
                        key={source.id}
                        label={source.name}
                        description={source.purpose || source.url}
                        checked={intake.sourceIds.includes(source.id)}
                        onChange={(event) => setIntake((current) => ({
                          ...current,
                          sourceIds: event.target.checked ? [...new Set([...current.sourceIds, source.id])] : current.sourceIds.filter((id) => id !== source.id),
                        }))}
                      />
                    ))}
                  </div>
                )}
                {llmReady === false && <Alert variant="warning" title="文本模型未就绪">方案生成需要文本模型，请先前往 <a className="underline" href={mcpSettingsHref} target="_blank" rel="noreferrer">公共服务配置</a>。</Alert>}
              </section>
            </div>
          </details>
        </>
      )}
    />
  );
}
