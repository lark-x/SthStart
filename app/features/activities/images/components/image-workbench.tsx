'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SourceRef } from '@sthstart/contracts';
import { Drawer } from '@/app/components/ui/drawer';
import { Badge } from '@/app/components/ui/badge';
import { Select } from '@/app/components/ui/select';
import { ImageModeSwitch, useImageAdvancedMode } from '@/app/features/generation/components/image-mode-switch';
import { restoreVisualProfessionalDefaults, visualProfessionalChanges } from '@/app/features/generation/image-settings';
import { SourceFieldEditor } from '../../components/source-field-editor';
import { StudioHiresDialog } from '../../components/studio-hires-dialog';
import { useActivityCapabilities } from '../../queries/activities';
import { useImageConfigEditor } from '../hooks/use-image-config-editor';
import { useImageGeneration } from '../hooks/use-image-generation';
import { useImageAttempts } from '../hooks/use-image-attempts';
import { ImageConfigPanel } from './image-config-panel';
import { ImageGenerationPanel } from './image-generation-panel';
import { ImageAttemptPanel } from './image-attempt-panel';
import type { ImageWorkbenchProps } from '../types';

export function ImageWorkbench({
  isOpen,
  onClose,
  registerFlush,
  activity,
  document,
  initialSlotId,
  onAdoptSlotAsset,
}: ImageWorkbenchProps) {
  const mediaSlots = useMemo(() => document.mediaSlots || [], [document.mediaSlots]);
  const [advanced, setAdvanced] = useImageAdvancedMode('activity-image');
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const activeSlotId = selectedSlotId ?? initialSlotId ?? mediaSlots[0]?.id ?? '';
  const [scopeTab, setScopeTab] = useState<'override' | 'slot' | 'global'>('slot');
  const [editingSource, setEditingSource] = useState<SourceRef | null>(null);
  const [notice, setNotice] = useState<import('../model/workbench-status').WorkbenchNotice | null>(null);

  const activeSlot = useMemo(
    () => mediaSlots.find((slot) => slot.id === activeSlotId) || mediaSlots[0],
    [mediaSlots, activeSlotId],
  );
  const actorMap = useMemo(() => new Map((document.actors || []).map((actor) => [actor.id, actor])), [document.actors]);
  const stageMap = useMemo(() => new Map((document.stages || []).map((stage) => [stage.id, stage])), [document.stages]);
  const { data: capabilitiesData } = useActivityCapabilities();

  const config = useImageConfigEditor({
    activityId: activity.id,
    slotId: activeSlot?.id,
    isOpen,
    setNotice,
  });
  const attempts = useImageAttempts({
    activity,
    slotId: activeSlot?.id,
    onAdoptSlotAsset,
    setNotice,
  });
  const generation = useImageGeneration({
    isOpen,
    activity,
    document,
    slotId: activeSlot?.id,
    config,
    setNotice,
    onPrepared: () => attempts.selectAttempt(null),
    onAttemptCreated: (attempt) => {
      attempts.selectAttempt(attempt.id);
      void attempts.refresh();
    },
  });

  useEffect(() => {
    registerFlush?.(config.flushConfig);
    return () => registerFlush?.(null);
  }, [config.flushConfig, registerFlush]);

  const sourceRecipe = attempts.historicalRecipe && attempts.selectedAttemptId
    ? attempts.historicalRecipe
    : generation.preparedRecipe || attempts.historicalRecipe;
  const t2iCap = capabilitiesData?.images?.textToImage;
  const i2iCap = capabilitiesData?.images?.imageToImage;

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) void config.flushConfig().then((saved) => { if (saved) onClose(); });
      }}
      title="素材绘制"
      className="max-w-[1100px] w-full flex flex-col p-2 sm:p-4 overflow-hidden bg-surface text-ink"
    >
      {editingSource && (
        <SourceFieldEditor
          activityId={activity.id}
          source={editingSource}
          onClose={() => setEditingSource(null)}
          onSaved={() => generation.invalidatePreparation()}
        />
      )}
      <div className="px-2 py-3 sm:px-6 border-b border-border-default bg-surface/90 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex w-full flex-wrap min-w-0 items-center gap-3 sm:w-auto sm:gap-4">
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-[26rem] sm:max-w-full sm:flex-row sm:items-center sm:gap-2">
            <label htmlFor="activity-image-target-slot" className="shrink-0 text-sm font-semibold text-muted">目标镜头</label>
            <Select
              id="activity-image-target-slot"
              value={activeSlot?.id || ''}
              onChange={(event) => setSelectedSlotId(event.target.value)}
              className="min-w-0 text-sm"
            >
              {mediaSlots.map((slot, index) => {
                const stage = stageMap.get(slot.stageId);
                return (
                  <option key={slot.id} value={slot.id}>
                    {index + 1}. {slot.caption?.trim() || stage?.title || '未命名镜头'}（{slot.kind === 'image' ? '图片' : '视频'}）
                  </option>
                );
              })}
            </Select>
          </div>

          <div className={`${advanced ? 'flex' : 'hidden'} items-center gap-2 text-sm`}>
            <span className="text-muted">槽位:</span>
            <code className="text-muted font-mono text-sm bg-surface-muted px-1.5 py-0.5 rounded">
              {activeSlot?.id || 'default'}
            </code>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">关联角色:</span>
            <div className="flex items-center gap-1">
              {(activeSlot?.actorIds || []).map((actorId) => {
                const actor = actorMap.get(actorId);
                return (
                  <Badge key={actorId} variant="secondary" className="text-sm px-1.5 py-0">
                    {actor?.displayName || actorId}
                  </Badge>
                );
              })}
            </div>
          </div>
        </div>

        <div className={`${advanced ? 'flex' : 'hidden'} items-center gap-3`}>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">生图引擎就绪度:</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium border ${t2iCap?.readiness === 'ready' ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60' : 'bg-amber-950 text-amber-300 border-amber-700/60'}`}>
              文生图: {t2iCap?.readiness || '未配置'}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium border ${i2iCap?.readiness === 'ready' ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60' : 'bg-surface-muted text-muted border-border-default'}`}>
              图生图: {i2iCap?.readiness || '未配置'}
            </span>
          </div>

          {notice && (
            <div className={`text-sm px-2.5 py-1 rounded border font-medium ${notice.type === 'success' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800' : 'bg-red-950/80 text-red-300 border-red-800'}`}>
              {notice.text}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-2">
        <p className="text-sm text-muted">使用活动默认配置，点击绘制即可。提示词准备与配置检查会自动完成。</p>
        <ImageModeSwitch
          advanced={advanced}
          onChange={setAdvanced}
          changes={[
            ...visualProfessionalChanges({ ...config.activeSlotConfig, parameters: config.activeSlotConfig.params }, config.visualPreview?.fields),
            ...(generation.selectedReferenceKey && generation.referenceRole === 'init_image' && generation.denoise !== 0.75 ? [`重绘幅度：${generation.denoise}`] : []),
          ]}
          onRestore={() => {
            config.updateSlotConfig({
              ...restoreVisualProfessionalDefaults(config.activeSlotConfig),
              finalPositivePrompt: undefined,
              negativePrompt: undefined,
              params: undefined,
            });
            generation.setDenoise(0.75);
            generation.invalidatePreparation();
          }}
        />
      </div>

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-0 min-w-0 min-h-0 overflow-y-auto xl:overflow-hidden">
        <ImageConfigPanel
          advanced={advanced}
          scopeTab={scopeTab}
          onScopeChange={setScopeTab}
          overrides={generation.overrides}
          onOverridesChange={generation.setOverrides}
          config={config}
        />
        <ImageGenerationPanel
          advanced={advanced}
          activityId={activity.id}
          currentContentRevisionId={activity.currentContentRevisionId ?? undefined}
          activeSlot={activeSlot}
          config={config}
          generation={generation}
          sourceRecipe={sourceRecipe}
          preparedCompilation={generation.preparedCompilation}
          executionSnapshots={attempts.executionSnapshots}
          onPromptSettingsChange={(patch) => {
            config.updateSlotConfig(patch);
            generation.invalidatePreparation();
          }}
          onLocateSource={(kind, id, path, source) => {
            if (source?.entityKind === 'override') {
              setScopeTab('override');
              generation.setOverrides(sourceRecipe?.overrides || []);
              attempts.selectAttempt(null);
              setNotice({ type: 'success', text: '已载入当时的单次覆盖，修改后重新准备即可；历史记录不会更改。' });
            } else if (source && ['character', 'character_version', 'reference'].includes(source.entityKind)) {
              window.open(`/apps/characters/${encodeURIComponent(source.entityId)}?fieldPath=${encodeURIComponent(source.fieldPath)}`, '_blank', 'noopener,noreferrer');
            } else if (source) {
              setEditingSource(source);
            }
          }}
        />
        <ImageAttemptPanel advanced={advanced} slotId={activeSlot?.id} attemptsState={attempts} />
      </div>

      <StudioHiresDialog
        activityId={activity.id}
        target={{ kind: 'media_slot', slotId: activeSlot?.id ?? '' }}
        sourceArtifactId={attempts.hiresAttempt?.artifactId ?? null}
        sourceImageUrl={attempts.hiresAttempt ? `/api/admin/artifacts/${encodeURIComponent(attempts.hiresAttempt.artifactId)}/file` : null}
        sourceLabel={attempts.hiresAttempt?.label}
        open={Boolean(attempts.hiresAttempt)}
        onOpenChange={(next) => { if (!next) attempts.setHiresAttempt(null); }}
        beforePreview={async () => true}
        onCreated={() => { void attempts.refresh(); }}
      />
    </Drawer>
  );
}
