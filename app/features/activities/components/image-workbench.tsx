'use client';

import { SourceFieldEditor } from './source-field-editor';
import { fetchActivity, saveMediaRevision, fetchPromptRecipe, fetchImageExecutionSnapshots, transferCharacterReferenceToActivity } from '../api';
import { fetchCharacterVisualReferences } from '@/app/features/characters/api';
import { useQueryClient } from '@tanstack/react-query';
import type { SourceRef } from '@sthstart/contracts';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Sparkles,
  Camera,
  Layers,
  Image as ImageIcon,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Settings2,
  Sliders,
  Upload,
  Link as LinkIcon,
  HelpCircle,
  GitBranch,
  SplitSquareVertical,
  Trash2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import type {
  Activity,
  ContentDocument,
  MediaRevision,
  PromptRecipe,
  PromptCompilation,
  GenerationAttempt,
  ImageConfigDocument,
  SlotImageConfig,
  PromptBlock,
} from '@sthstart/contracts';
import { Drawer } from '@/app/components/ui/drawer';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import {
  useImageConfigDraft,
  useImageAttempts,
  useActivityCapabilities,
  useActivityAssets,
  useAssetLineage,
} from '../queries';
import {
  useSaveImageConfigDraft,
  useCommitImageConfigRevision,
  usePreparePromptRecipe,
  useCreateImageAttempt,
  useRetryImageAttempt,
  useCancelImageAttempt,
  useUploadActivityAsset,
} from '../mutations';
import { PromptSourcePanel } from './prompt-source-panel';

interface ImageWorkbenchProps {
  isOpen: boolean;
  onClose: () => void;
  activity: Activity;
  document: ContentDocument;
  initialSlotId?: string;
  currentMediaRevision?: MediaRevision | null;
  onAdoptSlotAsset?: (slotId: string, assetKey: string) => Promise<void>;
  onLocateField?: (entityKind: string, entityId: string, fieldPath: string) => void;
}

export function ImageWorkbench({
  isOpen,
  onClose,
  activity,
  document,
  initialSlotId,
  currentMediaRevision,
  onAdoptSlotAsset,
  onLocateField,
}: ImageWorkbenchProps) {
  const mediaSlots = document.mediaSlots || [];
  const [activeSlotId, setActiveSlotId] = useState<string>(
    initialSlotId || mediaSlots[0]?.id || ''
  );

  // Sync initialSlotId when dialog opens
  useEffect(() => {
    if (initialSlotId) setActiveSlotId(initialSlotId);
  }, [initialSlotId]);

  const activeSlot = useMemo(
    () => mediaSlots.find((s) => s.id === activeSlotId) || mediaSlots[0],
    [mediaSlots, activeSlotId]
  );

  const actorMap = useMemo(() => {
    return new Map((document.actors || []).map((a) => [a.id, a]));
  }, [document.actors]);

  const stageMap = useMemo(() => {
    return new Map((document.stages || []).map((s) => [s.id, s]));
  }, [document.stages]);

  // Queries
  const { data: configDraftData, refetch: refetchDraft } = useImageConfigDraft(activity.id);
  const { data: attemptsData, refetch: refetchAttempts } = useImageAttempts(activity.id, activeSlot?.id);
  const { data: capabilitiesData } = useActivityCapabilities();
  const { data: assetsData } = useActivityAssets(activity.id);

  // Mutations
  const saveDraftMutation = useSaveImageConfigDraft();
  const commitRevisionMutation = useCommitImageConfigRevision();
  const prepareRecipeMutation = usePreparePromptRecipe();
  const createAttemptMutation = useCreateImageAttempt();
  const retryAttemptMutation = useRetryImageAttempt();
  const cancelAttemptMutation = useCancelImageAttempt();
  const uploadAssetMutation = useUploadActivityAsset();

  // Local Scope Editing State
  const [scopeTab, setScopeTab] = useState<'override' | 'slot' | 'global'>('slot');
  const [currentConfigDoc, setCurrentConfigDoc] = useState<ImageConfigDocument | null>(null);

  useEffect(() => {
    if (configDraftData?.document) {
      setCurrentConfigDoc(configDraftData.document);
    }
  }, [configDraftData]);

  const queryClient = useQueryClient();
  const [editingSource, setEditingSource] = useState<SourceRef | null>(null);
  // Recipe & Compilation state
  const [executionSnapshots, setExecutionSnapshots] = useState<unknown[]>([]);
  const [historicalRecipe, setHistoricalRecipe] = useState<PromptRecipe | null>(null);
  const [preparedRecipe, setPreparedRecipe] = useState<PromptRecipe | null>(null);
  const [preparedCompilation, setPreparedCompilation] = useState<PromptCompilation | null>(null);
  const [overrides, setOverrides] = useState<
    Array<{ id: string; fieldPath: string; overrideText: string; reason?: string }>
  >([]);

  // Generation Params
  const [seed, setSeed] = useState<number>(-1);
  const [selectedReferenceKey, setSelectedReferenceKey] = useState<string | null>(null);
  const [referenceRole, setReferenceRole] = useState<'init_image' | 'identity' | 'outfit' | 'style'>('init_image');
  const [denoise, setDenoise] = useState<number>(0.75);
  const [characterReferences, setCharacterReferences] = useState<Array<{ characterId: string; characterName: string; version?: number; referenceId: string; url: string }>>([]);
  const [transferringReference, setTransferringReference] = useState<string | null>(null);

  // Comparison State
  const [compareAttemptId, setCompareAttemptId] = useState<string | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [adoptingAssetKey, setAdoptingAssetKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- character references are loaded from the character service for this activity. */
  useEffect(() => {
    const actors = (document.actors || []).filter((actor) => actor.sourceCharacterId);
    if (!actors.length) { setCharacterReferences([]); return; }
    let active = true;
    void Promise.all(actors.map(async (actor) => {
      const characterId = actor.sourceCharacterId!;
      const response = await fetchCharacterVisualReferences(characterId);
      const frozenAssetIds = Array.isArray(actor.appearanceReferenceAssetIds) ? new Set(actor.appearanceReferenceAssetIds) : null;
      return response.items.flatMap((item) => typeof item.id === 'string' && typeof item.url === 'string'
        && (!frozenAssetIds || (typeof item.assetId === 'string' && frozenAssetIds.has(item.assetId)))
        ? [{ characterId, characterName: actor.displayName, version: actor.sourceVersion, referenceId: item.id, url: item.url }]
        : []);
    })).then((groups) => { if (active) setCharacterReferences(groups.flat()); }).catch(() => { if (active) setCharacterReferences([]); });
    return () => { active = false; };
  }, [document.actors]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Active slot config lookup
  const activeSlotConfig: SlotImageConfig = useMemo(() => {
    if (!currentConfigDoc || !activeSlot) return { slotId: activeSlot?.id || '' };
    return currentConfigDoc.slotConfigs.find((s) => s.slotId === activeSlot.id) || {
      slotId: activeSlot.id,
    };
  }, [currentConfigDoc, activeSlot]);

  // Handle slot config changes
  const handleUpdateSlotConfig = (patch: Partial<SlotImageConfig>) => {
    if (!currentConfigDoc || !activeSlot) return;
    const existing = currentConfigDoc.slotConfigs || [];
    const idx = existing.findIndex((s) => s.slotId === activeSlot.id);
    let updatedConfigs: SlotImageConfig[];
    if (idx >= 0) {
      updatedConfigs = [...existing];
      updatedConfigs[idx] = { ...updatedConfigs[idx], ...patch };
    } else {
      updatedConfigs = [...existing, { slotId: activeSlot.id, ...patch }];
    }
    setCurrentConfigDoc({
      ...currentConfigDoc,
      slotConfigs: updatedConfigs,
    });
  };

  // Handle global preset changes
  const handleUpdateGlobalConfig = (patch: Partial<ImageConfigDocument>) => {
    if (!currentConfigDoc) return;
    setCurrentConfigDoc({
      ...currentConfigDoc,
      ...patch,
    });
  };

  // Save Draft
  const handleSaveDraft = async () => {
    if (!currentConfigDoc) return;
    try {
      await saveDraftMutation.mutateAsync({ id: activity.id, document: currentConfigDoc });
      setStatusMessage({ type: 'success', text: '图像配置草稿已保存' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage({ type: 'error', text: '保存草稿失败: ' + String(err) });
    }
  };

  // Commit Revision
  const handleCommitRevision = async () => {
    if (!currentConfigDoc) return;
    try {
      await commitRevisionMutation.mutateAsync({ id: activity.id, document: currentConfigDoc });
      setStatusMessage({ type: 'success', text: '图像配置新版本已提交发布' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage({ type: 'error', text: '提交版本失败: ' + String(err) });
    }
  };

  const handleTransferCharacterReference = async (reference: typeof characterReferences[number]) => {
    setTransferringReference(reference.referenceId);
    try {
      const asset = await transferCharacterReferenceToActivity(activity.id, { characterId: reference.characterId, version: reference.version, referenceId: reference.referenceId });
      await queryClient.invalidateQueries();
      setSelectedReferenceKey(asset.assetKey);
      setStatusMessage({ type: 'success', text: `已将${reference.characterName}的角色参考图转入本活动。` });
    } catch (error) {
      setStatusMessage({ type: 'error', text: `转入角色参考图失败：${error instanceof Error ? error.message : String(error)}` });
    } finally { setTransferringReference(null); }
  };

  // Prepare recipe
  const handlePrepareRecipe = async () => {
    if (!activeSlot || !activity.currentContentRevisionId) return;
    try {
      const configRevision = currentConfigDoc ? await commitRevisionMutation.mutateAsync({ id: activity.id, document: currentConfigDoc }) : null;
      const fresh = await fetchActivity(activity.id);
      const res = await prepareRecipeMutation.mutateAsync({
        id: activity.id,
        input: {
          contentRevisionId: fresh.activity.currentContentRevisionId!,
          imageConfigRevisionId: configRevision?.id || configDraftData?.baseRevisionId || undefined,
          slotId: activeSlot.id,
          expectedHeadVersion: fresh.activity.headVersion,
          overrides: overrides.length > 0 ? overrides : undefined,
          references: selectedReferenceKey ? (() => {
            const asset = assetsData?.items.find((item) => item.assetKey === selectedReferenceKey);
            if (!asset) throw new Error('参考图尚未加载，请重试');
            return [{ referenceId: crypto.randomUUID(), assetKey: asset.assetKey, artifactId: asset.artifactId,
              sha256: asset.sha256 || '', role: referenceRole, inputKey: 'sourceImage' }];
          })() : [],
          customParams: {
            denoise: selectedReferenceKey ? denoise : undefined,
          },
        },
      });
      await queryClient.invalidateQueries();
      setSelectedAttemptId(null);
      setPreparedRecipe(res.recipe);
      setPreparedCompilation(res.compilation);
      setStatusMessage({ type: 'success', text: '配方准备与提示词编译就绪' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage({ type: 'error', text: '准备配方失败: ' + String(err) });
    }
  };

  // Submit generation attempt
  const handleSubmitAttempt = async () => {
    if (!preparedRecipe || !preparedCompilation || !activeSlot) return;
    try {
      const res = await createAttemptMutation.mutateAsync({
        id: activity.id,
        input: {
          contentRevisionId: preparedRecipe.contentRevisionId,
          imageConfigRevisionId: preparedRecipe.imageConfigRevisionId,
          slotId: activeSlot.id,
          recipeId: preparedRecipe.id,
          compilationId: preparedCompilation.id,
          executionPlanHash: preparedCompilation.executionPlanHash,
          expectedHeadVersion: activity.headVersion,
          seed: seed >= 0 ? seed : undefined,
          idempotencyKey: `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        },
      });
      setSelectedAttemptId(res.id);
      setStatusMessage({ type: 'success', text: '生成尝试已提交排队' });
      setTimeout(() => setStatusMessage(null), 3000);
      refetchAttempts();
    } catch (err) {
      setStatusMessage({ type: 'error', text: '提交生图尝试失败: ' + String(err) });
    }
  };

  // Adopt asset as slot candidate
  const handleAdopt = async (assetKey: string) => {
    if (!activeSlot) return;
    try {
      setAdoptingAssetKey(assetKey);
      if (onAdoptSlotAsset) await onAdoptSlotAsset(activeSlot.id, assetKey);
      else {
        const fresh = await fetchActivity(activity.id);
        const bindings = (fresh.currentMediaRevision?.slotBindings || []).filter(b => b.slotId !== activeSlot.id);
        bindings.push({ slotId: activeSlot.id, slotFingerprint: '', assets: [{ assetKey, order: 10 }] });
        await saveMediaRevision(activity.id, fresh.activity.currentContentRevisionId!, bindings);
        await queryClient.invalidateQueries();
      }
      setStatusMessage({ type: 'success', text: '已成功将该图片采用为镜头画面' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage({ type: 'error', text: '采用候选失败: ' + String(err) });
    } finally {
      setAdoptingAssetKey(null);
    }
  };

  // Upload reference image
  const handleUploadReference = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const asset = await uploadAssetMutation.mutateAsync({ id: activity.id, file });
      setSelectedReferenceKey(asset.assetKey);
      handleUpdateSlotConfig({
        referenceAssetKeys: [asset.assetKey],
      });
      setStatusMessage({ type: 'success', text: '参考图上传成功' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage({ type: 'error', text: '上传参考图失败: ' + String(err) });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const attempts = attemptsData?.items || [];
  const currentAttempt = attempts.find((a) => a.id === selectedAttemptId) || attempts[0];
  useEffect(() => {
    let active = true;
    setHistoricalRecipe(null);
    if (currentAttempt?.recipeId) fetchPromptRecipe(activity.id, currentAttempt.recipeId)
      .then(result => { if (active) setHistoricalRecipe(result.recipe); }).catch(error => { if (active) setStatusMessage({ type: 'error', text: String(error) }); });
    return () => { active = false; };
  }, [activity.id, currentAttempt?.recipeId]);
  useEffect(() => {
    let active = true;
    setExecutionSnapshots([]);
    if (currentAttempt?.id) fetchImageExecutionSnapshots(activity.id, currentAttempt.id).then(result => { if (active) setExecutionSnapshots(result.items); }).catch(() => {});
    return () => { active = false; };
  }, [activity.id, currentAttempt?.id, currentAttempt?.status]);
  const sourceRecipe = historicalRecipe && selectedAttemptId ? historicalRecipe : preparedRecipe || historicalRecipe;
  const compareAttempt = attempts.find((a) => a.id === compareAttemptId);

  const t2iCap = capabilitiesData?.images?.textToImage;
  const i2iCap = capabilitiesData?.images?.imageToImage;

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="图片生成与提示词来源"
      className="max-w-[1100px] w-full flex flex-col p-4 overflow-hidden bg-surface text-ink"
    >
      {editingSource && <SourceFieldEditor activityId={activity.id} source={editingSource} onClose={() => setEditingSource(null)} onSaved={() => { setPreparedRecipe(null); setPreparedCompilation(null); }} />}
      {/* Top Bar */}
      <div className="px-6 py-3 border-b border-border-default bg-surface/90 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap min-w-0 items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-muted">目标镜头:</span>
            <select
              value={activeSlot?.id || ''}
              onChange={(e) => setActiveSlotId(e.target.value)}
              className="bg-paper border border-border-control text-ink text-sm rounded px-2.5 py-1.5 focus:border-sky-500 outline-none"
            >
              {mediaSlots.map((slot) => {
                const stage = stageMap.get(slot.stageId);
                return (
                  <option key={slot.id} value={slot.id}>
                    {slot.id} - {stage?.title || '未指定阶段'} ({slot.kind})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">槽位:</span>
            <code className="text-muted font-mono text-sm bg-surface-muted px-1.5 py-0.5 rounded">
              {activeSlot?.id || 'default'}
            </code>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">关联角色:</span>
            <div className="flex items-center gap-1">
              {(activeSlot?.actorIds || []).map((aid) => {
                const actor = actorMap.get(aid);
                return (
                  <Badge key={aid} variant="secondary" className="text-sm px-1.5 py-0">
                    {actor?.displayName || aid}
                  </Badge>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">生图引擎就绪度:</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium border ${
                t2iCap?.readiness === 'ready'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60'
                  : 'bg-amber-950 text-amber-300 border-amber-700/60'
              }`}
            >
              文生图: {t2iCap?.readiness || '未配置'}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium border ${
                i2iCap?.readiness === 'ready'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60'
                  : 'bg-surface-muted text-muted border-border-default'
              }`}
            >
              图生图: {i2iCap?.readiness || '未配置'}
            </span>
          </div>

          {statusMessage && (
            <div
              className={`text-sm px-2.5 py-1 rounded border font-medium ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                  : 'bg-red-950/80 text-red-300 border-red-800'
              }`}
            >
              {statusMessage.text}
            </div>
          )}
        </div>
      </div>

      {/* Main 3-Column Body */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-0 min-w-0">
        {/* Left Column (3 cols): Scopes & Controls */}
        <div className="xl:col-span-3 min-w-0 border-r border-border-default p-4 overflow-y-auto space-y-4 bg-surface/30">
          <div className="flex items-center justify-between pb-2 border-b border-border-default">
            <span className="text-sm font-bold text-muted uppercase tracking-wider">
              1. 设定范围与覆盖
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-sm px-2 text-muted"
                onClick={handleSaveDraft}
                disabled={saveDraftMutation.isPending}
              >
                保存草稿
              </Button>
              <Button
                size="sm"
                className="h-6 text-sm px-2 bg-sky-600 hover:bg-sky-500 text-white"
                onClick={handleCommitRevision}
                disabled={commitRevisionMutation.isPending}
              >
                提交版本
              </Button>
            </div>
          </div>

          {/* Scope Selector Tabs */}
          <div className="flex rounded bg-paper p-1 border border-border-default text-sm">
            <button
              type="button"
              className={`flex-1 py-1 text-center rounded font-medium transition ${
                scopeTab === 'override' ? 'bg-sky-600 text-white shadow-sm' : 'text-muted hover:text-ink'
              }`}
              onClick={() => setScopeTab('override')}
            >
              单次尝试覆盖
            </button>
            <button
              type="button"
              className={`flex-1 py-1 text-center rounded font-medium transition ${
                scopeTab === 'slot' ? 'bg-sky-600 text-white shadow-sm' : 'text-muted hover:text-ink'
              }`}
              onClick={() => setScopeTab('slot')}
            >
              镜头默认
            </button>
            <button
              type="button"
              className={`flex-1 py-1 text-center rounded font-medium transition ${
                scopeTab === 'global' ? 'bg-sky-600 text-white shadow-sm' : 'text-muted hover:text-ink'
              }`}
              onClick={() => setScopeTab('global')}
            >
              活动全局预设
            </button>
          </div>

          {/* Tab 1: Attempt Override */}
          {scopeTab === 'override' && (
            <div className="space-y-3 text-sm">
              <div className="p-2.5 rounded bg-paper/60 border border-border-default text-muted leading-relaxed text-sm">
                提示：单次尝试覆盖只在此次配方编译生效，不会污染活动全局或角色基准设定。
              </div>

              <div className="space-y-1.5">
                <label className="text-muted font-medium">覆盖文本 (Override Text)</label>
                <Textarea
                  placeholder="如：特别要求该镜头角色手持发光信物..."
                  value={overrides[0]?.overrideText || ''}
                  onChange={(e) => {
                    const text = e.target.value;
                    if (text.trim()) {
                      setOverrides([
                        {
                          id: 'override_1',
                          fieldPath: 'attempt.override',
                          overrideText: text,
                        },
                      ]);
                    } else {
                      setOverrides([]);
                    }
                  }}
                  rows={3}
                  className="bg-paper text-sm"
                />
              </div>
            </div>
          )}

          {/* Tab 2: Slot Default */}
          {scopeTab === 'slot' && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-muted">景别 (Shot Type)</label>
                  <Input
                    placeholder="close-up, medium shot..."
                    value={activeSlotConfig.shotType || ''}
                    onChange={(e) => handleUpdateSlotConfig({ shotType: e.target.value })}
                    className="bg-paper text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-muted">光影 (Lighting)</label>
                  <Input
                    placeholder="cinematic lighting, soft..."
                    value={activeSlotConfig.lighting || ''}
                    onChange={(e) => handleUpdateSlotConfig({ lighting: e.target.value })}
                    className="bg-paper text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-muted">构图与视角 (Composition)</label>
                <Input
                  placeholder="rule of thirds, wide angle..."
                  value={activeSlotConfig.composition || ''}
                  onChange={(e) => handleUpdateSlotConfig({ composition: e.target.value })}
                  className="bg-paper text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-muted">镜头补充提示词 (Supplement)</label>
                <Textarea
                  placeholder="补充镜头氛围细节..."
                  value={activeSlotConfig.supplementPrompt || ''}
                  onChange={(e) => handleUpdateSlotConfig({ supplementPrompt: e.target.value })}
                  rows={2}
                  className="bg-paper text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-muted">镜头负向提示词 (Negative)</label>
                <Textarea
                  placeholder="针对本镜头的排除项..."
                  value={activeSlotConfig.negativePrompt || ''}
                  onChange={(e) => handleUpdateSlotConfig({ negativePrompt: e.target.value })}
                  rows={2}
                  className="bg-paper text-sm"
                />
              </div>
            </div>
          )}

          {/* Tab 3: Global Preset */}
          {scopeTab === 'global' && (
            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <label className="text-muted">风格预设代号</label>
                <Input
                  value={currentConfigDoc?.stylePreset || 'anime_standard'}
                  onChange={(e) => handleUpdateGlobalConfig({ stylePreset: e.target.value })}
                  className="bg-paper text-sm font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-muted">全局风格正向提示词 (Global Style)</label>
                <Textarea
                  value={currentConfigDoc?.globalStylePrompt || ''}
                  onChange={(e) => handleUpdateGlobalConfig({ globalStylePrompt: e.target.value })}
                  rows={3}
                  className="bg-paper text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-muted">全局负向提示词 (Global Negative)</label>
                <Textarea
                  value={currentConfigDoc?.globalNegativePrompt || ''}
                  onChange={(e) => handleUpdateGlobalConfig({ globalNegativePrompt: e.target.value })}
                  rows={3}
                  className="bg-paper text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* Middle Column (5 cols): Recipe, Source Provenance & Params */}
        <div className="xl:col-span-5 min-w-0 border-r border-border-default p-4 overflow-y-auto space-y-4 bg-paper">
          <div className="flex items-center justify-between pb-2 border-b border-border-default">
            <span className="text-sm font-bold text-muted uppercase tracking-wider">
              2. 配方准备与生成参数
            </span>
            <Button
              size="sm"
              className="h-7 text-sm bg-sky-600 hover:bg-sky-500 text-white font-medium"
              disabled={prepareRecipeMutation.isPending}
              onClick={handlePrepareRecipe}
            >
              {prepareRecipeMutation.isPending ? (
                <>
                  <Spinner className="w-3.5 h-3.5 mr-1" />
                  准备编译中...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1" />
                  准备配方 / 编译
                </>
              )}
            </Button>
          </div>

          {/* Reference Image Section (I2I) */}
          <div className="bg-surface/60 border border-border-default rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-muted flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                单图参考 / 图生图 (I2I)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleUploadReference}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-sm px-2 text-muted"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadAssetMutation.isPending}
                >
                  <Upload className="w-3 h-3 mr-1" />
                  上传参考图
                </Button>
                {selectedReferenceKey && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-sm px-1 text-muted hover:text-red-400"
                    onClick={() => setSelectedReferenceKey(null)}
                  >
                    清除
                  </Button>
                )}
              </div>
            </div>

            <select aria-label="选择已有参考图片" value={selectedReferenceKey || ''} onChange={(e) => setSelectedReferenceKey(e.target.value || null)} className="w-full bg-surface border border-border-control rounded p-2 text-sm">
              <option value="">不使用参考图</option>
              {(assetsData?.items || []).filter((asset) => asset.type === 'image').map((asset) => <option key={asset.assetKey} value={asset.assetKey}>{asset.assetKey}</option>)}
            </select>
            {characterReferences.length > 0 && <div className="space-y-1.5 rounded border border-accent/20 bg-accent/5 p-2"><p className="text-xs font-semibold text-accent-dark">公共角色参考图（先转入活动再参与生成）</p>{characterReferences.map((reference) => <div key={`${reference.characterId}:${reference.referenceId}`} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-muted">{reference.characterName} · {reference.referenceId.slice(0, 8)}</span><Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={Boolean(transferringReference)} onClick={() => void handleTransferCharacterReference(reference)}>{transferringReference === reference.referenceId ? '转入中…' : '转入并选择'}</Button></div>)}</div>}
            {selectedReferenceKey ? (
              <div className="flex items-center gap-3 bg-paper p-2 rounded border border-border-default">
                <div className="w-12 h-12 rounded bg-surface border border-border-default overflow-hidden flex items-center justify-center flex-shrink-0">
                  <span className="text-sm text-muted font-mono">
                    {selectedReferenceKey.slice(0, 6)}
                  </span>
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-muted">{selectedReferenceKey}</span>
                    <select
                      value={referenceRole}
                      onChange={(e) => setReferenceRole(e.target.value as typeof referenceRole)}
                      className="bg-surface border border-border-default text-muted text-sm rounded px-1.5 py-0.5"
                    >
                      <option value="init_image">图生图 (init_image)</option>
                      <option value="identity">人物参考 (identity)</option>
                      <option value="outfit">服装参考 (outfit)</option>
                      <option value="style">风格参考 (style)</option>
                    </select>
                  </div>
                  {referenceRole === 'init_image' && (
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <span>重绘幅度: {denoise}</span>
                      <input
                        type="range"
                        min="0.1"
                        max="0.95"
                        step="0.05"
                        value={denoise}
                        onChange={(e) => setDenoise(parseFloat(e.target.value))}
                        className="flex-1 h-1 bg-surface-muted rounded accent-sky-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic">
                未选择参考图，将使用纯文本提示词进行文生图 (T2I)
              </p>
            )}
          </div>

          {/* Prompt Source Panel */}
          <div className="bg-surface/40 border border-border-default rounded-lg p-3">
            <PromptSourcePanel
              activityId={activity.id}
              blocks={sourceRecipe?.blocks || []}
              sourceRefs={sourceRecipe?.sourceRefs || []}
              onLocateSource={(kind, id, path) => {
                const source = sourceRecipe?.sourceRefs.find(r => r.entityKind === kind && r.entityId === id && r.fieldPath === path);
                if (source?.entityKind === 'override') {
                  setScopeTab('override');
                  setOverrides(sourceRecipe?.overrides || []);
                  setSelectedAttemptId(null);
                  setStatusMessage({ type: 'success', text: '已载入当时的单次覆盖，修改后重新准备即可；历史记录不会更改。' });
                } else if (source && ['character', 'character_version', 'reference'].includes(source.entityKind)) {
                  window.open(`/apps/characters/${encodeURIComponent(source.entityId)}?fieldPath=${encodeURIComponent(source.fieldPath)}`, '_blank', 'noopener,noreferrer');
                } else if (source) setEditingSource(source);
              }}
            />
          </div>

          {/* Execution Plan Hash & Seed Input */}
          <div className="bg-surface/60 border border-border-default rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted font-medium">随机种子 (Seed)</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-sm px-2 text-muted hover:text-ink"
                  onClick={() => setSeed(-1)}
                >
                  随机 (-1)
                </Button>
                <Input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value === '' ? -1 : Number(e.target.value))}
                  className="w-32 h-6 bg-paper text-sm font-mono"
                />
              </div>
            </div>

            {preparedCompilation && <div className="text-sm space-y-2">
              <p>{preparedCompilation.executionPlan ? `工作流 ${preparedCompilation.executionPlan.workflowId} v${preparedCompilation.executionPlan.workflowVersion} · 引擎 ${preparedCompilation.executionPlan.engineId}` : '尚未分配可执行工作流；配置后需要重新准备。'}</p>
              <details><summary>将提交的完整提示词与有效参数</summary><pre className="whitespace-pre-wrap break-words max-h-60 overflow-auto">{JSON.stringify({ channels: preparedCompilation.channels, parameters: preparedCompilation.effectiveParams, references: preparedRecipe?.references }, null, 2)}</pre></details>
              {!!executionSnapshots.length && <details><summary>所选历史图片的实际执行快照</summary><pre className="whitespace-pre-wrap break-words max-h-60 overflow-auto">{JSON.stringify(executionSnapshots, null, 2)}</pre></details>}
            </div>}
            {preparedCompilation && (
              <div className="text-sm text-muted font-mono flex items-center justify-between pt-1 border-t border-border-default">
                <span>执行计划哈希:</span>
                <span className="text-sky-400">{preparedCompilation.executionPlanHash.slice(0, 16)}...</span>
              </div>
            )}

            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold h-9 mt-2"
              disabled={!preparedRecipe || !preparedCompilation || createAttemptMutation.isPending}
              onClick={handleSubmitAttempt}
            >
              {createAttemptMutation.isPending ? (
                <>
                  <Spinner className="w-4 h-4 mr-2" />
                  提交生成任务中...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  提交生成尝试 (Generate)
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Right Column (4 cols): Candidate Stream & Actions */}
        <div className="xl:col-span-4 min-w-0 p-4 overflow-y-auto space-y-4 bg-surface/30">
          <div className="flex items-center justify-between pb-2 border-b border-border-default">
            <span className="text-sm font-bold text-muted uppercase tracking-wider">
              3. 生成尝试与候选流 ({attempts.length})
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-sm px-1 text-muted hover:text-ink"
              onClick={() => refetchAttempts()}
            >
              刷新
            </Button>
          </div>

          {attempts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 border border-dashed border-border-default rounded-lg">
              本镜头尚无生成记录，请在左侧编译配方并点击“提交生成尝试”。
            </div>
          ) : (
            <div className="space-y-3">
              {attempts.map((attempt) => {
                const isSelected = attempt.id === (currentAttempt?.id || '');
                const isComparing = attempt.id === compareAttemptId;
                const isRunning = ['preparing', 'submitting', 'queued', 'running'].includes(attempt.status);
                const isSucceeded = attempt.status === 'succeeded';
                const isFailed = attempt.status === 'failed';
                const output = attempt.outputs?.[0];

                return (
                  <div
                    key={attempt.id}
                    onClick={() => setSelectedAttemptId(attempt.id)}
                    className={`rounded-lg border p-3 cursor-pointer transition ${
                      isSelected
                        ? 'bg-surface border-sky-500 shadow-md ring-1 ring-sky-500/20'
                        : 'bg-paper/60 border-border-default hover:border-border-default'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium border ${
                            isSucceeded
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : isRunning
                              ? 'bg-sky-950 text-sky-300 border-sky-800'
                              : isFailed
                              ? 'bg-red-950 text-red-300 border-red-800'
                              : 'bg-surface-muted text-muted border-border-default'
                          }`}
                        >
                          {isRunning && <Spinner className="w-2.5 h-2.5 mr-1" />}
                          {attempt.status}
                        </span>
                        <span className="text-sm text-muted font-mono">
                          Seed: {attempt.actualSeed}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        {isRunning && (
                          <Button
                            variant="danger"
                            size="sm"
                            className="h-5 text-sm px-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelAttemptMutation.mutate({ id: activity.id, attemptId: attempt.id });
                            }}
                          >
                            取消
                          </Button>
                        )}
                        {isFailed && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-5 text-sm px-1.5 text-muted"
                            onClick={(e) => {
                              e.stopPropagation();
                              retryAttemptMutation.mutate({ id: activity.id, attemptId: attempt.id });
                            }}
                          >
                            重试
                          </Button>
                        )}
                        {isSucceeded && output && (
                          <Button
                            variant={isComparing ? 'secondary' : 'outline'}
                            size="sm"
                            className="h-5 text-sm px-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCompareAttemptId(isComparing ? null : attempt.id);
                            }}
                          >
                            <SplitSquareVertical className="w-2.5 h-2.5 mr-1" />
                            对比
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Output Preview */}
                    {isSucceeded && output ? (
                      <div className="space-y-2">
                        <div className="relative aspect-video rounded bg-paper border border-border-default overflow-hidden flex items-center justify-center">
                          <img
                            src={`/api/admin/artifacts/${output.artifactId}/file`}
                            alt="Candidate"
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              // Fallback if local preview not yet rendered
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-sm font-mono text-muted">
                            {output.width && output.height ? `${output.width}x${output.height}` : output.assetKey}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div className="text-sm text-slate-500 font-mono">
                            {output.sha256 ? `${output.sha256.slice(0, 10)}...` : output.assetKey}
                          </div>

                          <Button
                            size="sm"
                            className="h-6 text-sm px-2 bg-sky-600 hover:bg-sky-500 text-white font-medium"
                            disabled={adoptingAssetKey === output.assetKey}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAdopt(output.assetKey);
                            }}
                          >
                            {adoptingAssetKey === output.assetKey ? (
                              <Spinner className="w-3 h-3 mr-1" />
                            ) : (
                              <Check className="w-3 h-3 mr-1" />
                            )}
                            采用为镜头画面
                          </Button>
                        </div>
                      </div>
                    ) : isRunning ? (
                      <div className="aspect-video rounded bg-paper border border-border-default/80 flex flex-col items-center justify-center text-sm text-sky-400 gap-2">
                        <Spinner className="w-5 h-5 text-sky-400" />
                        <span>ComfyUI 生图中...</span>
                      </div>
                    ) : isFailed ? (
                      <div className="p-3 rounded bg-red-950/40 border border-red-900/60 text-sm text-red-300 space-y-1">
                        <div className="font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          生成失败: {attempt.errorCode || 'error'}
                        </div>
                        <p className="text-sm text-red-400 break-words">{attempt.errorMessage || '未知错误'}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {/* Comparison Split View Modal */}
          {compareAttempt && currentAttempt && compareAttempt.id !== currentAttempt.id && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
              <div className="bg-surface border border-border-default rounded-xl max-w-5xl w-full p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-border-default pb-2">
                  <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                    <SplitSquareVertical className="w-4 h-4 text-sky-400" />
                    候选双屏对比 (Side-by-side Candidate Comparison)
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => setCompareAttemptId(null)}>
                    关闭对比
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Left Candidate */}
                  <div className="bg-paper p-3 rounded-lg border border-border-default space-y-2">
                    <div className="flex items-center justify-between text-sm text-muted font-semibold">
                      <span>尝试 A: {currentAttempt.id.slice(0, 8)}</span>
                      <span className="font-mono text-muted">Seed: {currentAttempt.actualSeed}</span>
                    </div>
                    <div className="aspect-video bg-black rounded overflow-hidden flex items-center justify-center border border-border-default">
                      {currentAttempt.outputs?.[0] ? (
                        <img
                          src={`/api/admin/artifacts/${currentAttempt.outputs[0].artifactId}/file`}
                          alt="Candidate A"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-sm text-slate-500">无画面</span>
                      )}
                    </div>
                    {currentAttempt.outputs?.[0] && (
                      <Button
                        size="sm"
                        className="w-full bg-sky-600 hover:bg-sky-500 text-white text-sm h-7"
                        onClick={() => {
                          handleAdopt(currentAttempt.outputs[0].assetKey);
                          setCompareAttemptId(null);
                        }}
                      >
                        采用方案 A
                      </Button>
                    )}
                  </div>

                  {/* Right Candidate */}
                  <div className="bg-paper p-3 rounded-lg border border-border-default space-y-2">
                    <div className="flex items-center justify-between text-sm text-muted font-semibold">
                      <span>尝试 B: {compareAttempt.id.slice(0, 8)}</span>
                      <span className="font-mono text-muted">Seed: {compareAttempt.actualSeed}</span>
                    </div>
                    <div className="aspect-video bg-black rounded overflow-hidden flex items-center justify-center border border-border-default">
                      {compareAttempt.outputs?.[0] ? (
                        <img
                          src={`/api/admin/artifacts/${compareAttempt.outputs[0].artifactId}/file`}
                          alt="Candidate B"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-sm text-slate-500">无画面</span>
                      )}
                    </div>
                    {compareAttempt.outputs?.[0] && (
                      <Button
                        size="sm"
                        className="w-full bg-sky-600 hover:bg-sky-500 text-white text-sm h-7"
                        onClick={() => {
                          handleAdopt(compareAttempt.outputs[0].assetKey);
                          setCompareAttemptId(null);
                        }}
                      >
                        采用方案 B
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
