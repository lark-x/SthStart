'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageConfigDocument, ImageConfigRevision, SlotImageConfig } from '@sthstart/contracts';
import { useImageConfigDraft } from '../../queries/images';
import { useCommitImageConfigRevision, useSaveImageConfigDraft } from '../../mutations/images';
import { fetchActivity } from '../../api/activities';
import { fetchImageConfigDraft } from '../../api/images';
import { previewActivitySlotVisual } from '../../api/studio';
import { findSlotConfig, upsertSlotConfig } from '../model/image-config';
import { clearImageConfigRecovery, configRecoveryKey, readImageConfigRecovery, writeImageConfigRecovery } from '../lib/config-recovery-storage';
import { describeImageConfigCommitError, describeImageConfigSaveError, isImageConfigConflict } from '../model/workbench-status';
import type { ImageConfigEditorState, WorkbenchSetNotice } from '../types';

type UseImageConfigEditorOptions = {
  activityId: string;
  slotId: string | undefined;
  isOpen: boolean;
  setNotice: WorkbenchSetNotice;
};

const SUCCESS_MESSAGE_MS = 3_000;

export function useImageConfigEditor({
  activityId,
  slotId,
  isOpen,
  setNotice,
}: UseImageConfigEditorOptions): ImageConfigEditorState {
  const { data: configDraftData } = useImageConfigDraft(activityId);
  const saveDraftMutation = useSaveImageConfigDraft();
  const commitRevisionMutation = useCommitImageConfigRevision();

  const [currentConfigDoc, setCurrentConfigDoc] = useState<ImageConfigDocument | null>(null);
  const [visualPreview, setVisualPreview] = useState<ImageConfigEditorState['visualPreview']>(null);
  const [parametersValid, setParametersValid] = useState(true);
  const [hasSaveConflict, setHasSaveConflict] = useState(false);
  const configVersion = useRef(0);
  const configBaseline = useRef('');
  const restoredConfig = useRef(false);
  const recoveryKey = configRecoveryKey(activityId);
  const localDocument = useRef(currentConfigDoc);

  useEffect(() => {
    localDocument.current = currentConfigDoc;
  }, [currentConfigDoc]);

  /* eslint-disable react-hooks/set-state-in-effect -- the server draft snapshot is an external store synchronized into the local editor. */
  useEffect(() => {
    if (!configDraftData?.document) return;
    if (localDocument.current && JSON.stringify(localDocument.current) !== configBaseline.current) return;
    if (!restoredConfig.current) {
      restoredConfig.current = true;
      const stored = readImageConfigRecovery(recoveryKey);
      if (stored) {
        configVersion.current = stored.version;
        configBaseline.current = stored.baseline;
        setCurrentConfigDoc(stored.document);
        return;
      }
    }
    configVersion.current = configDraftData.draftVersion;
    configBaseline.current = JSON.stringify(configDraftData.document);
    setCurrentConfigDoc(configDraftData.document);
  }, [configDraftData, recoveryKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!currentConfigDoc) return;
    if (JSON.stringify(currentConfigDoc) === configBaseline.current) clearImageConfigRecovery(recoveryKey);
    else writeImageConfigRecovery(recoveryKey, {
      version: configVersion.current,
      baseline: configBaseline.current,
      document: currentConfigDoc,
    });
  }, [currentConfigDoc, recoveryKey]);

  const activeSlotConfig: SlotImageConfig = useMemo(
    () => findSlotConfig(currentConfigDoc, slotId),
    [currentConfigDoc, slotId],
  );

  const updateSlotConfig = useCallback((patch: Partial<SlotImageConfig>) => {
    if (!slotId) return;
    setCurrentConfigDoc((document) => document ? upsertSlotConfig(document, slotId, patch) : document);
  }, [slotId]);

  const updateGlobalConfig = useCallback((patch: Partial<ImageConfigDocument>) => {
    setCurrentConfigDoc((document) => document ? { ...document, ...patch } : document);
  }, []);

  const clearRecovery = useCallback(() => clearImageConfigRecovery(recoveryKey), [recoveryKey]);

  const saveDraft = useCallback(async () => {
    if (!currentConfigDoc || !parametersValid) return false;
    try {
      const saved = await saveDraftMutation.mutateAsync({
        id: activityId,
        document: currentConfigDoc,
        expectedDraftVersion: configVersion.current,
      });
      configVersion.current = saved.draftVersion;
      configBaseline.current = JSON.stringify(currentConfigDoc);
      clearRecovery();
      setHasSaveConflict(false);
      setNotice({ type: 'success', text: '图像配置草稿已保存' });
      setTimeout(() => setNotice(null), SUCCESS_MESSAGE_MS);
      return true;
    } catch (error) {
      setHasSaveConflict(isImageConfigConflict(error));
      setNotice({ type: 'error', text: describeImageConfigSaveError(error) });
      return false;
    }
  }, [activityId, clearRecovery, currentConfigDoc, parametersValid, saveDraftMutation, setNotice]);

  const flushConfig = useCallback(async () => {
    if (!parametersValid) {
      setNotice({ type: 'error', text: '请修正采样参数，输入仍保留。' });
      return false;
    }
    if (!currentConfigDoc || JSON.stringify(currentConfigDoc) === configBaseline.current) return true;
    return saveDraft();
  }, [currentConfigDoc, parametersValid, saveDraft, setNotice]);

  const commitDocument = useCallback(async (): Promise<ImageConfigRevision | null> => {
    if (!currentConfigDoc) return null;
    const revision = await commitRevisionMutation.mutateAsync({
      id: activityId,
      document: currentConfigDoc,
      expectedDraftVersion: configVersion.current,
      expectedHeadVersion: (await fetchActivity(activityId)).activity.headVersion,
    });
    const saved = await fetchImageConfigDraft(activityId);
    configVersion.current = saved.draftVersion;
    configBaseline.current = JSON.stringify(currentConfigDoc);
    clearRecovery();
    setHasSaveConflict(false);
    return revision;
  }, [activityId, clearRecovery, commitRevisionMutation, currentConfigDoc]);

  const commitRevision = useCallback(async () => {
    try {
      const revision = await commitDocument();
      setNotice({ type: 'success', text: '图像配置新版本已提交发布' });
      setTimeout(() => setNotice(null), SUCCESS_MESSAGE_MS);
      return revision;
    } catch (error) {
      setNotice({ type: 'error', text: describeImageConfigCommitError(error) });
      return null;
    }
  }, [commitDocument, setNotice]);

  const commitRevisionForPreparation = useCallback(async () => commitDocument(), [commitDocument]);

  useEffect(() => {
    if (!isOpen || !currentConfigDoc || !slotId) return;
    let active = true;
    const timer = setTimeout(() => {
      void previewActivitySlotVisual(activityId, { slotId, document: currentConfigDoc }).then((result) => {
        if (active) setVisualPreview(result);
      }).catch((error) => {
        if (active) setNotice({ type: 'error', text: error instanceof Error ? error.message : '配置检查失败' });
      });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activityId, currentConfigDoc, isOpen, setNotice, slotId]);

  return {
    currentConfigDoc,
    baseRevisionId: configDraftData?.baseRevisionId ?? null,
    activeSlotConfig,
    parametersValid,
    setParametersValid,
    visualPreview,
    isSavingDraft: saveDraftMutation.isPending,
    isCommittingRevision: commitRevisionMutation.isPending,
    hasSaveConflict,
    updateSlotConfig,
    updateGlobalConfig,
    saveDraft,
    flushConfig,
    commitRevision,
    commitRevisionForPreparation,
    clearRecovery,
  };
}
