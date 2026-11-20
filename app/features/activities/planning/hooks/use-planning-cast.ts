'use client';
import type React from 'react';
import { useState } from 'react';
import type { ActivityPlanningActorResolveInput, ActivityPlanningPersonaDraft, ActorSnapshot, ResearchCharacterCandidate } from '@sthstart/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { fetchActivityCharacterSnapshot } from '@/app/features/activities/api/images';
import { fetchPlanningPersonaDraft, resolvePlanningActor } from '@/app/features/activities/api/planning';
import { characterKeys } from '@/app/lib/query-keys';
import { mergeCast } from '../intake-model';
import type { CastPickerTarget, CustomCastMember, IntakeForm } from '../types';

export function usePlanningCast({
  sessionId,
  maxActors,
  castSnapshotsRef,
  setIntake,
  refreshSession,
  setBusy,
  setError,
  setNotice,
  mountedRef,
  client,
}: {
  sessionId: string | null;
  maxActors: number;
  castSnapshotsRef: React.MutableRefObject<Map<string, ActorSnapshot>>;
  setIntake: React.Dispatch<React.SetStateAction<IntakeForm>>;
  refreshSession: () => Promise<unknown>;
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  mountedRef: React.MutableRefObject<boolean>;
  client: QueryClient;
}) {
  const [customCast, setCustomCast] = useState<CustomCastMember[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<CastPickerTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState<ResearchCharacterCandidate | null>(null);
  const [personaOpen, setPersonaOpen] = useState<{ actorId: string; draft: ActivityPlanningPersonaDraft } | null>(null);
  const [personaValue, setPersonaValue] = useState({ displayName: '', work: '', summary: '', personaText: '', baseText: '', defaultOutfitText: '', versionLabel: '' });

  const resolveActor = async (actorId: string, input: ActivityPlanningActorResolveInput) => {
    if (!sessionId) return false;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await resolvePlanningActor(sessionId, actorId, input);
      await refreshSession();
      if (input.mode === 'remove') {
        setNotice(result.affectedStageIds.length
          ? '已从企划中移除该角色，' + result.affectedStageIds.length + ' 个阶段的人物引用已同步更新。'
          : '已从企划中移除该角色。');
      } else if (input.mode === 'persona') {
        setNotice(result.createdCharacterId ? '已把确认后的人设写入本地角色库并匹配到本企划。' : '已完成人设匹配。');
      } else {
        setNotice('已匹配到本地角色快照。');
      }
      void client.invalidateQueries({ queryKey: characterKeys.all });
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '处理待补人设失败。');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openPersonaDraft = async (actorId: string) => {
    if (!sessionId) return;
    setBusy(true); setError(null);
    try {
      const draft = await fetchPlanningPersonaDraft(sessionId, actorId);
      const persona = draft.persona as Record<string, unknown>;
      const appearance = (persona.appearance && typeof persona.appearance === 'object' ? persona.appearance : {}) as Record<string, unknown>;
      setPersonaValue({
        displayName: draft.displayName,
        work: typeof persona.work === 'string' ? persona.work : '',
        summary: typeof persona.summary === 'string' ? persona.summary : '',
        personaText: typeof persona.personaText === 'string' ? persona.personaText : '',
        baseText: typeof appearance.baseText === 'string' ? appearance.baseText : '',
        defaultOutfitText: typeof appearance.defaultOutfitText === 'string' ? appearance.defaultOutfitText : '',
        versionLabel: '',
      });
      setPersonaOpen({ actorId, draft });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成人设草稿失败。');
    } finally {
      setBusy(false);
    }
  };

  const confirmPersonaDraft = async () => {
    if (!personaOpen) return;
    const base = personaOpen.draft.persona as Record<string, unknown>;
    if (base.originType !== 'ip' && base.originType !== 'derivative' && !personaValue.versionLabel.trim()) {
      setError('请填写阶段名称，再保存阶段并用于企划。');
      return;
    }
    const displayName = personaValue.displayName.trim() || personaOpen.draft.displayName;
    const saved = await resolveActor(personaOpen.actorId, {
      mode: 'persona',
      displayName,
      persona: {
        ...base,
        displayName,
        work: personaValue.work,
        summary: personaValue.summary,
        personaText: personaValue.personaText,
        appearance: { ...(base.appearance as Record<string, unknown> | undefined), baseText: personaValue.baseText, defaultOutfitText: personaValue.defaultOutfitText },
      },
      sourceNote: personaOpen.draft.basisNote,
      ...(base.originType !== 'ip' && base.originType !== 'derivative' ? { versionLabel: personaValue.versionLabel.trim() } : {}),
    });
    if (saved) setPersonaOpen(null);
  };

  /** 导入角色卡后把新角色加入名单：先读快照，避免把未发布草稿当作已发布版本使用。 */
  const addImportedCharacterToCast = async (characterId: string) => {
    try {
      const actor = await fetchActivityCharacterSnapshot(characterId);
      if (!mountedRef.current) return;
      if (actor.sourceCharacterId) castSnapshotsRef.current.set(String(actor.sourceCharacterId), actor);
      setIntake((current) => ({ ...current, cast: mergeCast(current.cast, [actor], maxActors) }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取导入的角色失败。');
    }
  };

  return {
    customCast,
    setCustomCast,
    pickerOpen,
    setPickerOpen,
    pickerTarget,
    setPickerTarget,
    importOpen,
    setImportOpen,
    importTarget,
    setImportTarget,
    evidenceOpen,
    setEvidenceOpen,
    personaOpen,
    setPersonaOpen,
    personaValue,
    setPersonaValue,
    resolveActor,
    openPersonaDraft,
    confirmPersonaDraft,
    addImportedCharacterToCast,
    handleEvidence: setEvidenceOpen,
  };
}
