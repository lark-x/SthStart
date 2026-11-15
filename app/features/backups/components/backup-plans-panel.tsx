'use client';

import React, { useEffect, useState } from 'react';
import { CalendarClock, Play, Plus, Trash2 } from 'lucide-react';
import type { BackupPlan, BackupScope } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Switch } from '@/app/components/ui/switch';
import { Select } from '@/app/components/ui/select';
import { Checkbox } from '@/app/components/ui/checkbox';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { Badge } from '@/app/components/ui/badge';
import { EmptyState } from '@/app/components/ui/empty-state';
import { FormField } from '@/app/components/ui/form-field';
import { useActivities } from '@/app/features/activities/queries/activities';
import { useToast } from '@/app/providers/ui-provider';
import { useRemoveBackupPlan, useRunBackupPlan, useSaveBackupPlan } from '../mutations';
import type { BackupTargetView } from '../api';
import { describeError, formatTime } from '../model';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface PlanDraft {
  id?: string;
  name: string;
  scope: BackupScope;
  activityIds: string[];
  works: string;
  targetIds: string[];
  frequency: BackupPlan['frequency'];
  dailyTime: string;
  weekday: number;
  retainCount: number;
  enabled: boolean;
}

const emptyDraft: PlanDraft = {
  name: '云备份计划', scope: 'workspace', activityIds: [], works: '', targetIds: [],
  frequency: 'daily', dailyTime: '03:00', weekday: 1, retainCount: 10, enabled: true,
};

function draftFrom(plan: BackupPlan): PlanDraft {
  return {
    id: plan.id,
    name: plan.name,
    scope: plan.scope,
    activityIds: plan.activityIds,
    works: plan.works.join('、'),
    targetIds: plan.targetIds,
    frequency: plan.frequency,
    dailyTime: plan.dailyTime,
    weekday: plan.weekday ?? 1,
    retainCount: plan.retainCount,
    enabled: plan.enabled,
  };
}

export function BackupPlansPanel({ plans, targets }: { plans: BackupPlan[]; targets: BackupTargetView[] }) {
  const toast = useToast();
  const saveMutation = useSaveBackupPlan();
  const removeMutation = useRemoveBackupPlan();
  const runMutation = useRunBackupPlan();
  const activities = useActivities({ limit: 100 });
  const [draft, setDraft] = useState<PlanDraft>({ ...emptyDraft });
  const [deleteTarget, setDeleteTarget] = useState<BackupPlan | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 目标列表异步到达后补齐新计划默认值。
    if (!draft.targetIds.length && targets.length) setDraft((current) => ({ ...current, targetIds: targets.map((target) => target.id) }));
  }, [targets, draft.targetIds.length]);

  const update = (patch: Partial<PlanDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    try {
      await saveMutation.mutateAsync({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        scope: draft.scope,
        activityIds: draft.activityIds,
        works: draft.works.split(/[、,，\s]+/).filter(Boolean),
        targetIds: draft.targetIds,
        frequency: draft.frequency,
        dailyTime: draft.dailyTime,
        weekday: draft.weekday,
        timezone: 'Asia/Shanghai',
        enabled: draft.enabled,
        retainCount: draft.retainCount,
      });
      toast.success('计划已保存', '保存计划不会立即上传；需要时点「立即执行」。');
      setDraft({ ...emptyDraft, targetIds: targets.map((target) => target.id) });
    } catch (error) {
      toast.error('保存失败', describeError(error));
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
      <section className={plans.length === 0 ? "order-2 border-y border-border-subtle py-5 lg:order-1" : "border-y border-border-subtle py-5"}>
        <div className="pb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <CalendarClock className="h-4 w-4 text-muted" aria-hidden="true" />备份计划
          </h2>
          <p className="mt-1 text-sm text-muted">按时区计算执行时间；服务重启后错过的计划最多补一次。</p>
        </div>
        <div className="divide-y divide-border-subtle">
          {plans.length === 0 && <EmptyState title="还没有备份计划" description="填写新建计划表单，安排每天或每周自动执行的备份。" />}
          {plans.map((plan) => (
            <div key={plan.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">{plan.name}</div>
                <div className="flex items-center gap-2">
                  <Badge variant={plan.enabled ? 'online' : 'warning'}>{plan.enabled ? '已启用' : '已暂停'}</Badge>
                  <Badge variant="accent">
                    {plan.frequency === 'manual' ? '仅手动' : plan.frequency === 'daily' ? '每天 ' + plan.dailyTime : '每' + WEEKDAYS[plan.weekday ?? 1] + ' ' + plan.dailyTime}
                  </Badge>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted">
                {plan.scope === 'workspace' ? '完整工作区' : plan.scope === 'activities' ? '指定活动 ' + plan.activityIds.length + ' 项' : '创作资料'}
                {' · '}{plan.targetIds.length} 个目标 · 保留最近 {plan.retainCount} 次 · 下次 {formatTime(plan.nextRunAt)}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft(draftFrom(plan))}>修改</Button>
                <Button size="sm" variant="ghost" onClick={async () => {
                  try { await runMutation.mutateAsync(plan.id); toast.success('已开始执行', '后端会继续执行，关闭页面不影响。'); }
                  catch (error) { toast.error('无法执行', describeError(error)); }
                }}>
                  <Play className="mr-1 h-3.5 w-3.5" aria-hidden="true" />立即执行
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    // WebKit 的指针点击不会先聚焦按钮；显式聚焦后，确认框打开时
                    // 才能采到真实触发器，取消后焦点也会回到这里。
                    event.currentTarget.focus({ preventScroll: true });
                    setDeleteTarget(plan);
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={plans.length === 0 ? "order-1 border-y border-border-subtle py-5 lg:order-2 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-5" : "border-y border-border-subtle py-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-5"}>
        <div className="pb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Plus className="h-4 w-4 text-muted" aria-hidden="true" />{draft.id ? '修改计划' : '新建计划'}
          </h2>
          <p className="mt-1 text-sm text-muted">设置执行时间、备份范围和保留数量。</p>
        </div>
        <div className="space-y-3">
          <FormField label="名称">
            <Input value={draft.name} onChange={(event) => update({ name: event.target.value })} />
          </FormField>
          <FormField label="备份范围">
            <Select
              value={draft.scope}
              onChange={(event) => update({ scope: event.target.value as BackupScope })}
            >
              <option value="workspace">完整工作区</option>
              <option value="activities">指定活动</option>
              <option value="knowledge">创作资料</option>
            </Select>
          </FormField>
          {draft.scope === 'activities' && (
            <div className="text-sm">
              <span className="text-muted">选择活动</span>
              <div className="mt-1 max-h-40 space-y-1 overflow-auto rounded-control border border-border-default p-2">
                {(activities.data?.items ?? []).map((activity) => (
                  <Checkbox
                    key={activity.id}
                    label={activity.title}
                    checked={draft.activityIds.includes(activity.id)}
                    onChange={(event) => update({
                      activityIds: event.target.checked
                        ? [...draft.activityIds, activity.id]
                        : draft.activityIds.filter((id) => id !== activity.id),
                    })}
                  />
                ))}
                {(activities.data?.items ?? []).length === 0 && <div className="text-xs text-muted">还没有可备份的活动。</div>}
              </div>
            </div>
          )}
          {draft.scope === 'knowledge' && (
            <FormField label="按作品筛选" hint="留空表示全部资料。">
              <Input value={draft.works} onChange={(event) => update({ works: event.target.value })} placeholder="例如：原神、崩坏" />
            </FormField>
          )}
          <div className="text-sm">
            <span className="text-muted">目标网盘</span>
            <div className="mt-1 space-y-1">
              {targets.map((target) => (
                <Checkbox
                  key={target.id}
                  label={target.accountLabel || target.kind}
                  checked={draft.targetIds.includes(target.id)}
                  onChange={(event) => update({
                    targetIds: event.target.checked
                      ? [...draft.targetIds, target.id]
                      : draft.targetIds.filter((id) => id !== target.id),
                  })}
                />
              ))}
              {targets.length === 0 && <div className="text-xs text-muted">请先在「网盘与加密」里连接一个网盘。</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <FormField label="频率">
              <Select
                value={draft.frequency}
                onChange={(event) => update({ frequency: event.target.value as BackupPlan['frequency'] })}
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="manual">仅手动</option>
              </Select>
            </FormField>
            <FormField label="时间">
              <Input type="time" value={draft.dailyTime} onChange={(event) => update({ dailyTime: event.target.value })} />
            </FormField>
            {draft.frequency === 'weekly' && (
              <FormField label="星期">
                <Select
                  value={draft.weekday}
                  onChange={(event) => update({ weekday: Number(event.target.value) })}
                >
                  {WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}
                </Select>
              </FormField>
            )}
            <FormField label="保留最近 N 次">
              <Input type="number" min={1} max={200} value={draft.retainCount} onChange={(event) => update({ retainCount: Number(event.target.value) || 10 })} />
            </FormField>
          </div>
          <Switch
            label="启用这个计划"
            checked={draft.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          <div className="flex gap-2">
            <Button onClick={submit} disabled={saveMutation.isPending || !draft.targetIds.length}>{draft.id ? '保存修改' : '保存计划'}</Button>
            {draft.id && <Button variant="ghost" onClick={() => setDraft({ ...emptyDraft, targetIds: targets.map((target) => target.id) })}>取消修改</Button>}
          </div>
          <p className="text-xs text-muted">计划按 Asia/Shanghai 计算；修改只影响之后的执行，正在进行的备份继续使用原配置。</p>
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={deleteTarget ? `删除备份计划“${deleteTarget.name}”` : '删除备份计划'}
        description="之后不会再按这个计划自动备份；云端已有的备份版本不会被删除。"
        confirmLabel="删除计划"
        danger
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await removeMutation.mutateAsync(deleteTarget.id);
            toast.info('计划已删除', '云端已有的备份版本不会被删除。');
            setDeleteTarget(null);
          } catch (error) {
            toast.error('删除失败', describeError(error));
          }
        }}
      />
    </div>
  );
}
