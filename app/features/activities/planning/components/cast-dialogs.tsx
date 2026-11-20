'use client';
import type React from 'react';
import type {
  ActivityPlanningActorResolveInput,
  ActivityPlanningPersonaDraft,
  ActorSnapshot,
  ResearchCharacterCandidate,
  ResearchTask,
} from '@sthstart/contracts';
import { CharacterPickerDialog } from '@/app/features/activities/components/character-picker-dialog';
import { CharacterImportDialog } from '@/app/features/characters/components/character-import-dialog';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { mergeCast } from '../intake-model';
import { evidenceFor } from '../research-model';
import type { CastPickerTarget, IntakeForm } from '../types';

export interface PlanningCastDialogsProps {
  intake: IntakeForm;
  setIntake: React.Dispatch<React.SetStateAction<IntakeForm>>;
  maxActors: number;
  castSnapshotsRef: React.MutableRefObject<Map<string, ActorSnapshot>>;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  pickerTarget: CastPickerTarget | null;
  setPickerTarget: (target: CastPickerTarget | null) => void;
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  importTarget: string | null;
  setImportTarget: (target: string | null) => void;
  evidenceOpen: ResearchCharacterCandidate | null;
  setEvidenceOpen: (candidate: ResearchCharacterCandidate | null) => void;
  personaOpen: { actorId: string; draft: ActivityPlanningPersonaDraft } | null;
  setPersonaOpen: (value: { actorId: string; draft: ActivityPlanningPersonaDraft } | null) => void;
  personaValue: { displayName: string; work: string; summary: string; personaText: string; baseText: string; defaultOutfitText: string; versionLabel: string };
  setPersonaValue: React.Dispatch<React.SetStateAction<{ displayName: string; work: string; summary: string; personaText: string; baseText: string; defaultOutfitText: string; versionLabel: string }>>;
  research: ResearchTask | null;
  busy: boolean;
  resolveActor: (actorId: string, input: ActivityPlanningActorResolveInput) => Promise<unknown>;
  confirmPersonaDraft: () => Promise<void>;
  onAddImportedCharacter: (characterId: string) => Promise<void>;
}

export function PlanningCastDialogs({
  intake,
  setIntake,
  maxActors,
  castSnapshotsRef,
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
  research,
  busy,
  resolveActor,
  confirmPersonaDraft,
  onAddImportedCharacter,
}: PlanningCastDialogsProps) {
  const personaOrigin = personaOpen?.draft.persona?.originType;
  const savingOriginalStage = personaOrigin !== 'ip' && personaOrigin !== 'derivative';
  return (
    <>
      <CharacterPickerDialog
        open={pickerOpen}
        onOpenChange={(open) => { setPickerOpen(open); if (!open) setPickerTarget(null); }}
        existingSourceCharacterIds={pickerTarget && typeof pickerTarget === 'object' ? [] : intake.cast.map((member) => member.characterId)}
        existingActorCount={pickerTarget && typeof pickerTarget === 'object' ? 0 : intake.cast.length}
        onSelectCharacter={(actor) => {
          const characterId = String(actor.sourceCharacterId || actor.id);
          if (actor.sourceCharacterId) castSnapshotsRef.current.set(characterId, actor);
          if (pickerTarget === 'lead') {
            setIntake((current) => ({
              ...current,
              cast: current.cast.some((member) => member.characterId === characterId)
                ? current.cast
                : mergeCast(current.cast, [actor], maxActors),
              leadCharacterId: characterId,
              birthdayIds: current.templateId === 'birthday' ? [...new Set([...current.birthdayIds, characterId])] : current.birthdayIds,
            }));
          } else if (pickerTarget && typeof pickerTarget === 'object') {
            void resolveActor(pickerTarget.match, { mode: 'match', characterId, version: actor.sourceVersion,
              variantId: actor.sourceVariantId, costumeAssetId: actor.sourceCostumeAssetId });
          } else {
            setIntake((current) => ({ ...current, cast: mergeCast(current.cast, [actor], maxActors) }));
          }
        }}
      />

      <CharacterImportDialog
        open={importOpen}
        onOpenChange={(open) => { setImportOpen(open); if (!open) setImportTarget(null); }}
        onCommitted={(characterId) => {
          setImportOpen(false);
          if (importTarget) void resolveActor(importTarget, { mode: 'match', characterId });
          else void onAddImportedCharacter(characterId);
        }}
      />

      <Dialog
        open={Boolean(evidenceOpen)}
        onOpenChange={(open) => { if (!open) setEvidenceOpen(null); }}
        title="候选依据"
        description="以下摘录来自本次检索已保存的资料；没有引用资料的候选会被标注为推测或联动建议。"
        className="max-w-3xl"
        footer={<Button variant="outline" onClick={() => setEvidenceOpen(null)}>关闭</Button>}
      >
        <ul className="space-y-3">
          {evidenceOpen?.evidenceIds.length
            ? evidenceFor(research, evidenceOpen.evidenceIds).map((evidence) => (
              <li key={evidence.id} className="space-y-1 rounded-lg border border-border-subtle p-3">
                <p className="text-xs font-semibold text-ink">{evidence.sourceName}</p>
                <p className="text-xs text-muted">定位：{evidence.documentLocator}</p>
                <p className="whitespace-pre-wrap text-sm text-ink">{evidence.excerpt}</p>
                <p className="text-xs text-muted">工具：{evidence.tool} · 获取于 {evidence.retrievedAt}</p>
              </li>
            ))
            : <li className="text-sm text-muted">该候选没有关联资料摘录。请按「联动建议」对待，不要当作原作设定。</li>}
        </ul>
      </Dialog>

      <Dialog
        open={Boolean(personaOpen)}
        onOpenChange={(open) => { if (!open && !busy) setPersonaOpen(null); }}
        title="补齐人设并入库"
        description={personaOpen ? (personaOpen.draft.hasEvidence ? '以下内容依据已保存的资料摘录生成，保存前请确认。' : '本次没有可引用的外部资料，内容是创作建议；未查到的设定请自行补充或留空。') : ''}
        className="max-w-3xl"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setPersonaOpen(null)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => void confirmPersonaDraft()}>{busy ? '正在写入…' : savingOriginalStage ? '保存阶段并用于企划' : '确认并写入角色库'}</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          {savingOriginalStage && <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">阶段名称（必填）</span>
            <Input required maxLength={120} aria-label="阶段名称" value={personaValue.versionLabel}
              placeholder="例如：初到港口"
              onChange={(event) => setPersonaValue((current) => ({ ...current, versionLabel: event.target.value }))} />
            <span className="block text-xs text-muted">确认后会保存这个阶段，并将其固定用于本次企划。</span>
          </label>}
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">角色名</span>
            <Input aria-label="角色名" value={personaValue.displayName} onChange={(event) => setPersonaValue((current) => ({ ...current, displayName: event.target.value }))} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">作品</span>
            <Input aria-label="作品" value={personaValue.work} onChange={(event) => setPersonaValue((current) => ({ ...current, work: event.target.value }))} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">一句话简介</span>
            <Textarea aria-label="一句话简介" rows={2} value={personaValue.summary} onChange={(event) => setPersonaValue((current) => ({ ...current, summary: event.target.value }))} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">人设正文</span>
            <Textarea aria-label="人设正文" rows={8} value={personaValue.personaText} onChange={(event) => setPersonaValue((current) => ({ ...current, personaText: event.target.value }))} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">外貌描写</span>
              <Textarea aria-label="外貌描写" rows={3} value={personaValue.baseText} onChange={(event) => setPersonaValue((current) => ({ ...current, baseText: event.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">默认服装</span>
              <Textarea aria-label="默认服装" rows={3} value={personaValue.defaultOutfitText} onChange={(event) => setPersonaValue((current) => ({ ...current, defaultOutfitText: event.target.value }))} />
            </label>
          </div>
          {personaOpen && !personaOpen.draft.hasEvidence && <Alert variant="warning" title="没有资料依据">资料未覆盖的设定请留空，避免把推测写进角色库。</Alert>}
        </div>
      </Dialog>
    </>
  );
}
