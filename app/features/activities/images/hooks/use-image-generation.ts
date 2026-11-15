'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  Activity,
  ContentDocument,
  GenerationAttempt,
  PromptCompilation,
  PromptRecipe,
} from '@sthstart/contracts';
import { ApiClientError } from '@/app/lib/api-client';
import { fetchActivity } from '../../api/activities';
import { transferCharacterReferenceToActivity } from '../../api/images';
import { useActivityAssets, useActivityGenerationPresets, useActivityImageGenerationAssignments } from '../../queries/images';
import {
  useCreateImageAttempt,
  usePreparePromptRecipe,
  useUploadActivityAsset,
} from '../../mutations/images';
import { buildDrawSignature, buildPromptCustomParams, buildPromptReferences, type WorkbenchReferenceRole } from '../model/prompt-request';
import type { ImageConfigEditorState, WorkbenchSetNotice } from '../types';
import { useCharacterReferences, type CharacterVisualReference } from './use-character-references';

type PendingDraw = {
  signature: string;
  recipe: PromptRecipe;
  compilation: PromptCompilation;
  headVersion: number;
  idempotencyKey: string;
};

type UseImageGenerationOptions = {
  isOpen: boolean;
  activity: Activity;
  document: ContentDocument;
  slotId: string | undefined;
  config: ImageConfigEditorState;
  setNotice: WorkbenchSetNotice;
  onPrepared(): void;
  onAttemptCreated(attempt: GenerationAttempt): void;
};

export type ImageGenerationState = {
  assets: import('@sthstart/contracts').ActivityAsset[];
  generationPresets: import('@sthstart/contracts').GenerationPreset[];
  generationPresetsLoading: boolean;
  selectedGenerationPreset: import('@sthstart/contracts').GenerationPreset | undefined;
  generationPresetOptions: import('@sthstart/contracts').GenerationPreset[];
  selectedGenerationPresetId: string;
  setSelectedGenerationPresetId(value: string): void;
  selectedReferenceKey: string | null;
  referenceRole: WorkbenchReferenceRole;
  setReferenceRole(value: WorkbenchReferenceRole): void;
  denoise: number;
  setDenoise(value: number): void;
  seed: number;
  setSeed(value: number): void;
  overrides: Array<{ id: string; fieldPath: string; overrideText: string; reason?: string }>;
  setOverrides(value: Array<{ id: string; fieldPath: string; overrideText: string; reason?: string }>): void;
  preparedRecipe: PromptRecipe | null;
  preparedCompilation: PromptCompilation | null;
  invalidatePreparation(): void;
  selectReferenceAsset(assetKey: string | null): void;
  uploadReference(file: File): Promise<boolean>;
  isUploadingReference: boolean;
  characterReferences: CharacterVisualReference[];
  transferringReference: string | null;
  transferCharacterReference(reference: CharacterVisualReference): Promise<void>;
  prepareRecipe(quiet?: boolean): Promise<{ recipe: PromptRecipe; compilation: PromptCompilation; headVersion: number } | undefined>;
  draw(): Promise<void>;
  isPreparing: boolean;
  isDrawing: boolean;
  handlePresetChange(presetId: string): void;
};

export function useImageGeneration({
  isOpen,
  activity,
  document,
  slotId,
  config,
  setNotice,
  onPrepared,
  onAttemptCreated,
}: UseImageGenerationOptions): ImageGenerationState {
  const queryClient = useQueryClient();
  const { data: assetsData } = useActivityAssets(activity.id);
  const { data: generationPresets = [], isLoading: generationPresetsLoading } = useActivityGenerationPresets(isOpen);
  const { data: imageAssignments = [] } = useActivityImageGenerationAssignments(isOpen);
  const prepareRecipeMutation = usePreparePromptRecipe();
  const createAttemptMutation = useCreateImageAttempt();
  const uploadAssetMutation = useUploadActivityAsset();

  const [selectedReferenceKey, setSelectedReferenceKey] = useState<string | null>(null);
  const [selectedGenerationPresetId, setSelectedGenerationPresetId] = useState('');
  const [referenceRole, setReferenceRole] = useState<WorkbenchReferenceRole>('init_image');
  const [denoise, setDenoise] = useState(0.75);
  const [seed, setSeed] = useState(-1);
  const [preparedRecipe, setPreparedRecipe] = useState<PromptRecipe | null>(null);
  const [preparedCompilation, setPreparedCompilation] = useState<PromptCompilation | null>(null);
  const [overrides, setOverrides] = useState<Array<{ id: string; fieldPath: string; overrideText: string; reason?: string }>>([]);
  const [drawing, setDrawing] = useState(false);
  const [transferringReference, setTransferringReference] = useState<string | null>(null);
  const drawLock = useRef(false);
  const pendingDraw = useRef<PendingDraw | null>(null);
  const characterReferences = useCharacterReferences(document.actors);

  const preferredPurpose = selectedReferenceKey ? 'activity_image_edit' : 'activity_image_text';
  const activePurpose = imageAssignments.some((assignment) => assignment.purpose === preferredPurpose)
    ? preferredPurpose
    : 'activity_media_slot';
  const generationPresetOptions = useMemo(
    () => generationPresets.filter((preset) => preset.enabled && preset.purpose === activePurpose),
    [activePurpose, generationPresets],
  );
  const selectedGenerationPreset = generationPresetOptions.find((preset) => preset.id === selectedGenerationPresetId);

  const invalidatePreparation = useCallback(() => {
    setPreparedRecipe(null);
    setPreparedCompilation(null);
  }, []);

  const selectReferenceAsset = useCallback((assetKey: string | null) => {
    setSelectedReferenceKey(assetKey);
    setSelectedGenerationPresetId('');
    config.updateSlotConfig({
      presetId: undefined,
      presetRevision: undefined,
      workflowId: undefined,
      workflowVersion: undefined,
      purpose: undefined,
      params: undefined,
    });
    invalidatePreparation();
  }, [config, invalidatePreparation]);

  const uploadReference = useCallback(async (file: File) => {
    try {
      const asset = await uploadAssetMutation.mutateAsync({ id: activity.id, file });
      selectReferenceAsset(asset.assetKey);
      config.updateSlotConfig({ referenceAssetKeys: [asset.assetKey] });
      setNotice({ type: 'success', text: '参考图上传成功' });
      setTimeout(() => setNotice(null), 3_000);
      return true;
    } catch (error) {
      setNotice({ type: 'error', text: '上传参考图失败: ' + String(error) });
      return false;
    }
  }, [activity.id, config, selectReferenceAsset, setNotice, uploadAssetMutation]);

  const transferCharacterReference = useCallback(async (reference: CharacterVisualReference) => {
    setTransferringReference(reference.referenceId);
    try {
      const asset = await transferCharacterReferenceToActivity(activity.id, {
        characterId: reference.characterId,
        version: reference.version,
        referenceId: reference.referenceId,
      });
      await queryClient.invalidateQueries();
      selectReferenceAsset(asset.assetKey);
      setNotice({ type: 'success', text: `已将${reference.characterName}的角色参考图转入本活动。` });
    } catch (error) {
      setNotice({ type: 'error', text: `转入角色参考图失败：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setTransferringReference(null);
    }
  }, [activity.id, queryClient, selectReferenceAsset, setNotice]);

  const prepareRecipe = useCallback(async (quiet = false) => {
    if (!slotId || !activity.currentContentRevisionId) return;
    try {
      if (!config.parametersValid) throw new Error('请先修正采样参数。');
      const configRevision = config.currentConfigDoc
        ? await config.commitRevisionForPreparation()
        : null;
      const fresh = await fetchActivity(activity.id);
      const selectedAsset = selectedReferenceKey
        ? assetsData?.items.find((item) => item.assetKey === selectedReferenceKey)
        : undefined;
      const res = await prepareRecipeMutation.mutateAsync({
        id: activity.id,
        input: {
          contentRevisionId: fresh.activity.currentContentRevisionId!,
          imageConfigRevisionId: configRevision?.id || config.baseRevisionId || undefined,
          slotId,
          expectedHeadVersion: fresh.activity.headVersion,
          ...(selectedGenerationPreset ? { presetId: selectedGenerationPreset.id, presetRevision: selectedGenerationPreset.revision } : {}),
          overrides: overrides.length > 0 ? overrides : undefined,
          references: selectedReferenceKey ? buildPromptReferences({
            selectedReferenceKey,
            asset: selectedAsset,
            role: referenceRole,
            referenceId: crypto.randomUUID(),
          }) : [],
          customParams: buildPromptCustomParams(selectedReferenceKey, denoise),
        },
      });
      await queryClient.invalidateQueries();
      onPrepared();
      setPreparedRecipe(res.recipe);
      setPreparedCompilation(res.compilation);
      if (!quiet) setNotice({ type: 'success', text: '提示词与绘制配置已准备好' });
      return { ...res, headVersion: (await fetchActivity(activity.id)).activity.headVersion };
    } catch (error) {
      setNotice({ type: 'error', text: '准备配方失败: ' + String(error) });
      return undefined;
    }
  }, [activity.id, activity.currentContentRevisionId, assetsData, config, denoise, onPrepared, overrides, prepareRecipeMutation, queryClient, referenceRole, selectedGenerationPreset, selectedReferenceKey, setNotice, slotId]);

  const draw = useCallback(async () => {
    if (drawLock.current || !slotId) return;
    drawLock.current = true;
    setDrawing(true);
    setNotice({ type: 'success', text: '正在准备提示词与绘制配置…' });
    try {
      const signature = buildDrawSignature({
        slotId,
        config: config.currentConfigDoc,
        overrides,
        referenceKey: selectedReferenceKey,
        referenceRole,
        denoise,
        preset: selectedGenerationPreset,
        seed,
        contentRevisionId: activity.currentContentRevisionId,
      });
      if (pendingDraw.current?.signature !== signature) {
        const prepared = await prepareRecipe(true);
        if (!prepared) return;
        pendingDraw.current = {
          signature,
          recipe: prepared.recipe,
          compilation: prepared.compilation,
          headVersion: prepared.headVersion,
          idempotencyKey: crypto.randomUUID(),
        };
      }
      const attempt = pendingDraw.current;
      if (!attempt) return;
      const result = await createAttemptMutation.mutateAsync({
        id: activity.id,
        input: {
          contentRevisionId: attempt.recipe.contentRevisionId,
          imageConfigRevisionId: attempt.recipe.imageConfigRevisionId,
          slotId,
          recipeId: attempt.recipe.id,
          compilationId: attempt.compilation.id,
          executionPlanHash: attempt.compilation.executionPlanHash,
          expectedHeadVersion: attempt.headVersion,
          seed: seed >= 0 ? seed : undefined,
          idempotencyKey: attempt.idempotencyKey,
        },
      });
      pendingDraw.current = null;
      onAttemptCreated(result);
      setNotice({ type: 'success', text: '已开始绘制，图片完成后会出现在历史记录中。' });
    } catch (error) {
      if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) pendingDraw.current = null;
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '无法开始绘制，请重试。' });
    } finally {
      drawLock.current = false;
      setDrawing(false);
    }
  }, [activity.id, activity.currentContentRevisionId, config.currentConfigDoc, createAttemptMutation, denoise, onAttemptCreated, overrides, prepareRecipe, referenceRole, seed, selectedGenerationPreset, selectedReferenceKey, setNotice, slotId]);

  const handlePresetChange = useCallback((presetId: string) => {
    setSelectedGenerationPresetId(presetId);
    const preset = generationPresetOptions.find((item) => item.id === presetId);
    config.updateSlotConfig({
      presetId: preset?.id,
      presetRevision: preset?.revision,
      purpose: preset?.purpose,
      workflowId: preset?.workflowId,
      workflowVersion: preset?.workflowVersion,
      params: undefined,
    });
    invalidatePreparation();
  }, [config, generationPresetOptions, invalidatePreparation]);

  return {
    assets: assetsData?.items || [],
    generationPresets,
    generationPresetsLoading,
    selectedGenerationPreset,
    generationPresetOptions,
    selectedGenerationPresetId,
    setSelectedGenerationPresetId,
    selectedReferenceKey,
    referenceRole,
    setReferenceRole,
    denoise,
    setDenoise,
    seed,
    setSeed,
    overrides,
    setOverrides,
    preparedRecipe,
    preparedCompilation,
    invalidatePreparation,
    selectReferenceAsset,
    uploadReference,
    isUploadingReference: uploadAssetMutation.isPending,
    characterReferences,
    transferringReference,
    transferCharacterReference,
    prepareRecipe,
    draw,
    isPreparing: prepareRecipeMutation.isPending,
    isDrawing: drawing,
    handlePresetChange,
  };
}
