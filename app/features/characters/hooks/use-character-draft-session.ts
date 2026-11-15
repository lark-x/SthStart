'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import type { QueryObserverResult } from '@tanstack/react-query';
import type { UseFormClearErrors, UseFormGetValues, UseFormReset, UseFormSetError } from 'react-hook-form';
import type { CharacterVariant } from '@sthstart/contracts';
import { ApiClientError } from '@/app/lib/api-client';
import { useToast } from '@/app/providers/ui-provider';
import type { CharacterDetail } from '../api';
import { useCreateCharacter, useUpdateCharacter } from '../mutations';
import { characterDraftToFormValues, characterFormValuesToDraft, type CharacterFormValues } from '../model/character-form-values';
import { characterDraftSnapshot, type CharacterEditorStatus } from '../model/character-editor-model';

function subscribeRecovery(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('sthstart:character-recovery', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('sthstart:character-recovery', callback);
  };
}

type CharacterDraftSessionOptions = {
  characterId?: string;
  detailData?: CharacterDetail;
  refetchDetail: () => Promise<QueryObserverResult<CharacterDetail, Error>>;
  getValues: UseFormGetValues<CharacterFormValues>;
  reset: UseFormReset<CharacterFormValues>;
  setError: UseFormSetError<CharacterFormValues>;
  clearErrors: UseFormClearErrors<CharacterFormValues>;
  setStatus: Dispatch<SetStateAction<CharacterEditorStatus>>;
  tags: string[];
  setTags: Dispatch<SetStateAction<string[]>>;
  variants: CharacterVariant[];
  setVariants: Dispatch<SetStateAction<CharacterVariant[]>>;
};

/**
 * 角色编辑会话：服务器快照、表单脏值、保存冲突与本机恢复的唯一协调者。
 * 表单只提供读值和重置方法，不另存一份完整角色状态。
 */
export function useCharacterDraftSession({
  characterId,
  detailData,
  refetchDetail,
  getValues,
  reset,
  setError,
  clearErrors,
  setStatus,
  tags,
  setTags,
  variants,
  setVariants,
}: CharacterDraftSessionOptions) {
  const router = useRouter();
  const toast = useToast();
  const baseline = useRef<{ id?: string; snapshot: string; revision?: number } | null>(null);
  const liveSnapshot = useRef('');
  const saving = useRef(false);
  const recovering = useRef(false);

  const [errorMessage, setErrorMessage] = useState('');
  const [revisionConflict, setRevisionConflict] = useState(false);
  const recoveryKey = `sthstart:character-recovery:${characterId ?? 'new'}`;
  const recoveryAvailable = useSyncExternalStore(subscribeRecovery, useCallback(() => {
    try { return Boolean(sessionStorage.getItem(recoveryKey)); } catch { return false; }
  }, [recoveryKey]), () => false);

  const createMutation = useCreateCharacter();
  const updateMutation = useUpdateCharacter();

  useEffect(() => {
    liveSnapshot.current = characterDraftSnapshot(getValues(), tags, variants);
  });

  // 服务器内容载入后建立基线；后台刷新不能覆盖正在编辑的脏表单。
  useEffect(() => {
    if (!detailData) return;
    if (recovering.current) return;
    const values = characterDraftToFormValues(detailData.draft);
    const snapshot = characterDraftSnapshot(values, detailData.tags || [], detailData.variants || []);
    const previous = baseline.current;
    if (previous && previous.id === characterId) {
      if ((detailData.draftRevision ?? 0) < (previous.revision ?? 0)) return;
      if (previous.snapshot === snapshot && previous.revision === detailData.draftRevision) return;
      // A background refresh may update the avatar while text is still dirty.
      // Preserve both the input and the revision on which it was based.
      if (characterDraftSnapshot(getValues(), tags, variants) !== previous.snapshot) return;
    }
    baseline.current = { id: characterId, snapshot, revision: detailData.draftRevision };
    reset(values);
    setTags(detailData.tags || []);
    setVariants(detailData.variants || []);
    setStatus('saved');
  }, [characterId, detailData, getValues, reset, setStatus, setTags, setVariants, tags, variants]);

  const handleSave = useCallback(async () => {
    if (saving.current) return null;
    const currentValues = getValues();
    const currentDraft = characterFormValuesToDraft(currentValues);
    if (!currentDraft.displayName.trim()) {
      setError('displayName', { type: 'required', message: '请先填写角色名称' });
      setErrorMessage('请先填写角色名称');
      toast.warning('请先填写角色名称');
      return null;
    }
    clearErrors('displayName');
    const submittedSnapshot = characterDraftSnapshot(currentValues, tags, variants);
    saving.current = true;
    setErrorMessage('');
    setRevisionConflict(false);
    setStatus('saving');

    try {
      if (characterId) {
        const res = await updateMutation.mutateAsync({
          id: characterId,
          draft: currentDraft,
          tags,
          variants,
          expectedDraftRevision: baseline.current?.revision,
        });
        const savedValues = characterDraftToFormValues(res.draft);
        baseline.current = {
          id: characterId,
          revision: res.draftRevision,
          snapshot: characterDraftSnapshot(savedValues, res.tags, res.variants || []),
        };
        if (liveSnapshot.current === submittedSnapshot) {
          reset(savedValues); setTags(res.tags); setVariants(res.variants || []);
          setStatus('saved');
        } else setStatus('dirty');
        toast.success('角色档案已保存');
        await refetchDetail();
        return res.id;
      } else {
        const res = await createMutation.mutateAsync({
          displayName: currentDraft.displayName.trim(),
          draft: currentDraft,
          tags,
          variants,
        });
        setStatus('saved');
        toast.success('角色档案创建成功');
        router.push(`/apps/characters/${res.id}`);
        return res.id;
      }
    } catch (err: unknown) {
      setStatus('error');
      setRevisionConflict(err instanceof ApiClientError && err.code === 'draft_revision_conflict');
      const msg = err instanceof ApiClientError && err.code === 'draft_revision_conflict'
        ? '角色已在其他页面更新，当前未保存输入仍保留。请保留草稿后载入最新版本，再合并修改。'
        : err instanceof Error ? err.message : '保存失败，请检查网络或稍后重试';
      setErrorMessage(msg);
      toast.error('保存失败', msg);
      return null;
    } finally { saving.current = false; }
  }, [characterId, clearErrors, createMutation, getValues, refetchDetail, reset, router, setError, setStatus, setTags, setVariants, tags, toast, updateMutation, variants]);

  const preserveAndReload = async () => {
    if (saving.current) return;
    saving.current = true;
    recovering.current = true;
    setStatus('saving');
    const snapshot = characterDraftSnapshot(getValues(), tags, variants);
    try {
      // Do not replace the form unless its complete local draft was preserved.
      sessionStorage.setItem(recoveryKey, JSON.stringify({
        characterId,
        draft: characterFormValuesToDraft(getValues()),
        tags,
        variants,
      }));
      window.dispatchEvent(new Event('sthstart:character-recovery'));
      const latest = await refetchDetail();
      if (latest.error || !latest.data) throw latest.error ?? new Error('无法载入最新角色档案。');
      if (liveSnapshot.current !== snapshot) throw new Error('载入期间又有新修改，已保留当前输入，请重新操作。');
      const values = characterDraftToFormValues(latest.data.draft);
      baseline.current = {
        id: characterId,
        revision: latest.data.draftRevision,
        snapshot: characterDraftSnapshot(values, latest.data.tags, latest.data.variants || []),
      };
      reset(values); setTags(latest.data.tags); setVariants(latest.data.variants || []);
      setStatus('saved'); setErrorMessage(''); setRevisionConflict(false);
      toast.success('已载入最新版本', '原有本机草稿已保留，可下载后对照合并。');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally { saving.current = false; recovering.current = false; }
  };

  const downloadRecovery = () => {
    try {
      const backup = sessionStorage.getItem(recoveryKey);
      if (!backup) throw new Error('未找到保留的本机草稿。');
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `character-${characterId ?? 'new'}-local-draft.json`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { toast.error('草稿下载失败', error instanceof Error ? error.message : String(error)); }
  };

  return {
    errorMessage,
    setErrorMessage,
    revisionConflict,
    recoveryAvailable,
    handleSave,
    preserveAndReload,
    downloadRecovery,
  };
}
